import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { parseEther, parseEventLogs } from "viem";

const ZERO = "0x0000000000000000000000000000000000000000" as const;

// ComplianceStatus enum
const MONITORING = 0;
const PAUSED = 1;
const UNDER_REVIEW = 2;

// CaseOutcome enum
const OUT_CLEAR = 1;
const OUT_VIOLATION = 2;
const OUT_AMBIGUOUS = 3;

const emptyRequest = {
  id: 0n,
  requester: ZERO,
  callbackAddress: ZERO,
  callbackSelector: "0x00000000" as `0x${string}`,
  subcommittee: [] as `0x${string}`[],
  responses: [] as unknown[],
  responseCount: 0n,
  failureCount: 0n,
  threshold: 0n,
  createdAt: 0n,
  deadline: 0n,
  status: 0,
  consensusType: 0,
  remainingBudget: 0n,
  perAgentBudget: 0n,
};

/**
 * Fresh deployment per test: a mock platform + a ComplianceMonitor wired to it.
 */
async function deploy(depositWei: bigint = 0n) {
  const { viem } = await network.create();
  const publicClient = await viem.getPublicClient();
  const [deployer, guardian, treasury, other] = await viem.getWalletClients();

  const mock = await viem.deployContract("MockAgentRequester", [depositWei]);
  const monitor = await viem.deployContract("ComplianceMonitor", [
    mock.address,
    1n,
    2n,
    3n,
    guardian.account.address,
    treasury.account.address,
  ]);

  return { viem, publicClient, deployer, guardian, treasury, other, mock, monitor };
}

/**
 * Runs a sanction check and returns the generated caseId + platform requestId.
 */
async function runCheck(ctx: Awaited<ReturnType<typeof deploy>>, listType = "OFAC_SDN", value = parseEther("1")) {
  const hash = await ctx.monitor.write.checkSanctions([listType], { value });
  const receipt = await ctx.publicClient.waitForTransactionReceipt({ hash });
  const [evt] = parseEventLogs({ abi: ctx.monitor.abi, logs: receipt.logs, eventName: "SanctionCheckRequested" });
  const caseId = (evt.args as any).requestId as `0x${string}`;
  const c = (await ctx.monitor.read.getCase([caseId])) as any;
  return { caseId, requestId: c.platformRequestId as bigint, receipt };
}

describe("ComplianceMonitor", () => {
  it("deploys with the correct immutable configuration", async () => {
    const ctx = await deploy();
    assert.equal(((await ctx.monitor.read.agentRequester()) as string).toLowerCase(), ctx.mock.address.toLowerCase());
    assert.equal(await ctx.monitor.read.jsonApiAgentId(), 1n);
    assert.equal(await ctx.monitor.read.llmParseWebsiteAgentId(), 2n);
    assert.equal(await ctx.monitor.read.llmInferenceAgentId(), 3n);
    assert.equal(((await ctx.monitor.read.guardianMultisig()) as string).toLowerCase(), ctx.guardian.account.address.toLowerCase());
  });

  it("starts in Monitoring state", async () => {
    const ctx = await deploy();
    assert.equal(await ctx.monitor.read.getComplianceStatus(), MONITORING);
  });

  it("rejects a zero agent requester address", async () => {
    const ctx = await deploy();
    await assert.rejects(
      ctx.viem.deployContract("ComplianceMonitor", [
        ZERO,
        1n,
        2n,
        3n,
        ctx.guardian.account.address,
        ctx.treasury.account.address,
      ])
    );
  });

  it("rejects a zero agent ID", async () => {
    const ctx = await deploy();
    await assert.rejects(
      ctx.viem.deployContract("ComplianceMonitor", [
        ctx.mock.address,
        0n,
        2n,
        3n,
        ctx.guardian.account.address,
        ctx.treasury.account.address,
      ])
    );
  });

  it("rejects a zero guardian/treasury address", async () => {
    const ctx = await deploy();
    await assert.rejects(
      ctx.viem.deployContract("ComplianceMonitor", [ctx.mock.address, 1n, 2n, 3n, ZERO, ctx.treasury.account.address])
    );
    await assert.rejects(
      ctx.viem.deployContract("ComplianceMonitor", [ctx.mock.address, 1n, 2n, 3n, ctx.guardian.account.address, ZERO])
    );
  });

  it("emits SanctionCheckRequested and accrues the 0.1% fee", async () => {
    const ctx = await deploy();
    const { receipt } = await runCheck(ctx, "OFAC_SDN", parseEther("1"));
    const events = parseEventLogs({ abi: ctx.monitor.abi, logs: receipt.logs, eventName: "SanctionCheckRequested" });
    assert.equal(events.length, 1);
    assert.equal((events[0].args as any).listType, "OFAC_SDN");
    // 0.1% of 1 STT = 0.001 STT
    assert.equal(await ctx.monitor.read.accruedNativeFees(), parseEther("0.001"));
  });

  it("rejects an empty list type", async () => {
    const ctx = await deploy();
    await assert.rejects(ctx.monitor.write.checkSanctions([""], { value: parseEther("1") }));
  });

  it("keeps Monitoring on a CLEAR result", async () => {
    const ctx = await deploy();
    const { caseId, requestId } = await runCheck(ctx);
    await ctx.mock.write.deliver([requestId, "CLEAR"]);
    assert.equal(await ctx.monitor.read.getComplianceStatus(), MONITORING);
    const c = (await ctx.monitor.read.getCase([caseId])) as any;
    assert.equal(Number(c.outcome), OUT_CLEAR);
  });

  it("auto-pauses on a VIOLATION result", async () => {
    const ctx = await deploy();
    const { caseId, requestId } = await runCheck(ctx);
    await ctx.mock.write.deliver([requestId, "VIOLATION"]);
    assert.equal(await ctx.monitor.read.getComplianceStatus(), PAUSED);
    const c = (await ctx.monitor.read.getCase([caseId])) as any;
    assert.equal(Number(c.outcome), OUT_VIOLATION);
    // High-risk action is blocked while paused.
    await assert.rejects(ctx.monitor.write.highRiskAction());
  });

  it("escalates to UnderReview on an AMBIGUOUS result", async () => {
    const ctx = await deploy();
    const { caseId, requestId } = await runCheck(ctx);
    await ctx.mock.write.deliver([requestId, "AMBIGUOUS"]);
    assert.equal(await ctx.monitor.read.getComplianceStatus(), UNDER_REVIEW);
    const c = (await ctx.monitor.read.getCase([caseId])) as any;
    assert.equal(Number(c.outcome), OUT_AMBIGUOUS);
    assert.equal(c.escalated, true);
  });

  it("treats a failed/empty platform response as AMBIGUOUS", async () => {
    const ctx = await deploy();
    const { requestId } = await runCheck(ctx);
    await ctx.mock.write.deliverFailure([requestId]);
    assert.equal(await ctx.monitor.read.getComplianceStatus(), UNDER_REVIEW);
  });

  it("rejects unauthorized handleResolution calls", async () => {
    const ctx = await deploy();
    const { requestId } = await runCheck(ctx);
    await assert.rejects(
      ctx.other.writeContract({
        address: ctx.monitor.address,
        abi: ctx.monitor.abi,
        functionName: "handleResolution",
        args: [requestId, [], 2, emptyRequest],
      })
    );
  });

  it("lets the guardian resume after a violation pause", async () => {
    const ctx = await deploy();
    const { caseId, requestId } = await runCheck(ctx);
    await ctx.mock.write.deliver([requestId, "VIOLATION"]);
    assert.equal(await ctx.monitor.read.getComplianceStatus(), PAUSED);

    // Guardian dismisses the case -> resume Monitoring.
    await ctx.guardian.writeContract({
      address: ctx.monitor.address,
      abi: ctx.monitor.abi,
      functionName: "guardianResolveCase",
      args: [caseId, false],
    });
    assert.equal(await ctx.monitor.read.getComplianceStatus(), MONITORING);
    const c = (await ctx.monitor.read.getCase([caseId])) as any;
    assert.equal(c.resolved, true);
  });

  it("rejects guardian-only calls from non-guardians", async () => {
    const ctx = await deploy();
    await assert.rejects(ctx.monitor.write.emergencyPause()); // deployer != guardian
    await assert.rejects(
      ctx.other.writeContract({
        address: ctx.monitor.address,
        abi: ctx.monitor.abi,
        functionName: "emergencyPause",
        args: [],
      })
    );
  });

  it("supports guardian emergency pause and resume", async () => {
    const ctx = await deploy();
    await ctx.guardian.writeContract({
      address: ctx.monitor.address,
      abi: ctx.monitor.abi,
      functionName: "emergencyPause",
      args: [],
    });
    assert.equal(await ctx.monitor.read.getComplianceStatus(), PAUSED);
    await ctx.guardian.writeContract({
      address: ctx.monitor.address,
      abi: ctx.monitor.abi,
      functionName: "resumeProtocol",
      args: [],
    });
    assert.equal(await ctx.monitor.read.getComplianceStatus(), MONITORING);
  });

  it("gates simulateSanctionListUpdate to the authority", async () => {
    const ctx = await deploy();
    // Owner (deployer) can emit.
    const hash = await ctx.monitor.write.simulateSanctionListUpdate(["OFAC_SDN"]);
    const receipt = await ctx.publicClient.waitForTransactionReceipt({ hash });
    const events = parseEventLogs({ abi: ctx.monitor.abi, logs: receipt.logs, eventName: "SanctionListUpdate" });
    assert.equal(events.length, 1);
    // A random account cannot.
    await assert.rejects(
      ctx.other.writeContract({
        address: ctx.monitor.address,
        abi: ctx.monitor.abi,
        functionName: "simulateSanctionListUpdate",
        args: ["OFAC_SDN"],
      })
    );
  });

  it("withdraws accrued native fees to the treasury", async () => {
    const ctx = await deploy();
    await runCheck(ctx, "OFAC_SDN", parseEther("1"));
    const fee = (await ctx.monitor.read.accruedNativeFees()) as bigint;
    assert.equal(fee, parseEther("0.001"));

    const before = await ctx.publicClient.getBalance({ address: ctx.treasury.account.address });
    await ctx.monitor.write.withdrawNativeFees(); // deployer is owner -> authority
    const after = await ctx.publicClient.getBalance({ address: ctx.treasury.account.address });
    assert.equal(after - before, fee);
    assert.equal(await ctx.monitor.read.accruedNativeFees(), 0n);
  });

  it("allows high-risk actions only while Monitoring", async () => {
    const ctx = await deploy();
    // OK while monitoring.
    await ctx.monitor.write.highRiskAction();
    // Pause via guardian, then it must revert.
    await ctx.guardian.writeContract({
      address: ctx.monitor.address,
      abi: ctx.monitor.abi,
      functionName: "emergencyPause",
      args: [],
    });
    await assert.rejects(ctx.monitor.write.highRiskAction());
  });
});
