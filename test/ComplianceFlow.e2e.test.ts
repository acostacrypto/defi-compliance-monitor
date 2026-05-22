import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { parseEther, parseEventLogs } from "viem";

const MONITORING = 0;
const PAUSED = 1;

/**
 * End-to-end compliance flow:
 *   1. Protocol starts Monitoring.
 *   2. A sanction-list update is signalled (reactivity trigger).
 *   3. The reactive handler runs a sanction check.
 *   4. The agent consensus returns VIOLATION.
 *   5. The protocol auto-pauses and high-risk functions are blocked.
 *   6. The case is recorded on-chain.
 *   7. The guardian reviews and resumes the protocol.
 */
describe("ComplianceFlow (e2e)", () => {
  it("runs update -> check -> violation -> pause -> guardian resume", async () => {
    const { viem } = await network.create();
    const publicClient = await viem.getPublicClient();
    const [deployer, guardian, treasury] = await viem.getWalletClients();

    const mock = await viem.deployContract("MockAgentRequester", [0n]);
    const monitor = await viem.deployContract("ComplianceMonitor", [
      mock.address,
      1n,
      2n,
      3n,
      guardian.account.address,
      treasury.account.address,
    ]);

    // 1) Monitoring.
    assert.equal(await monitor.read.getComplianceStatus(), MONITORING);
    await monitor.write.highRiskAction(); // allowed

    // 2) Sanction list update (reactivity trigger), emitted by the owner.
    const updHash = await monitor.write.simulateSanctionListUpdate(["OFAC_SDN"]);
    const updRcpt = await publicClient.waitForTransactionReceipt({ hash: updHash });
    const updEvents = parseEventLogs({ abi: monitor.abi, logs: updRcpt.logs, eventName: "SanctionListUpdate" });
    assert.equal(updEvents.length, 1);

    // 3) Reactive handler dispatches the sanction check.
    const checkHash = await monitor.write.checkSanctions(["OFAC_SDN"], { value: parseEther("1") });
    const checkRcpt = await publicClient.waitForTransactionReceipt({ hash: checkHash });
    const [requested] = parseEventLogs({ abi: monitor.abi, logs: checkRcpt.logs, eventName: "SanctionCheckRequested" });
    const caseId = (requested.args as any).requestId as `0x${string}`;
    const caseRec = (await monitor.read.getCase([caseId])) as any;

    // 4 + 5) Consensus returns VIOLATION -> auto-pause.
    await mock.write.deliver([caseRec.platformRequestId as bigint, "VIOLATION"]);
    assert.equal(await monitor.read.getComplianceStatus(), PAUSED);
    await assert.rejects(monitor.write.highRiskAction(), "high-risk action must be blocked while paused");

    // 6) Case recorded.
    const c = (await monitor.read.getCase([caseId])) as any;
    assert.equal(c.listType, "OFAC_SDN");
    assert.equal(Number(c.outcome), 2 /* Violation */);

    // 7) Guardian reviews and resumes (dismiss = false alarm).
    await guardian.writeContract({
      address: monitor.address,
      abi: monitor.abi,
      functionName: "guardianResolveCase",
      args: [caseId, false],
    });
    assert.equal(await monitor.read.getComplianceStatus(), MONITORING);
    await monitor.write.highRiskAction(); // allowed again

    const resolved = (await monitor.read.getCase([caseId])) as any;
    assert.equal(resolved.resolved, true);
  });

  it("keeps the protocol paused when the guardian confirms the violation", async () => {
    const { viem } = await network.create();
    const publicClient = await viem.getPublicClient();
    const [deployer, guardian, treasury] = await viem.getWalletClients();

    const mock = await viem.deployContract("MockAgentRequester", [0n]);
    const monitor = await viem.deployContract("ComplianceMonitor", [
      mock.address,
      1n,
      2n,
      3n,
      guardian.account.address,
      treasury.account.address,
    ]);

    const checkHash = await monitor.write.checkSanctions(["EU_CONSOLIDATED"], { value: parseEther("1") });
    const checkRcpt = await publicClient.waitForTransactionReceipt({ hash: checkHash });
    const [requested] = parseEventLogs({ abi: monitor.abi, logs: checkRcpt.logs, eventName: "SanctionCheckRequested" });
    const caseId = (requested.args as any).requestId as `0x${string}`;
    const caseRec = (await monitor.read.getCase([caseId])) as any;

    await mock.write.deliver([caseRec.platformRequestId as bigint, "AMBIGUOUS"]);
    assert.equal(await monitor.read.getComplianceStatus(), 2 /* UnderReview */);

    await guardian.writeContract({
      address: monitor.address,
      abi: monitor.abi,
      functionName: "guardianResolveCase",
      args: [caseId, true],
    });
    assert.equal(await monitor.read.getComplianceStatus(), PAUSED);
  });
});
