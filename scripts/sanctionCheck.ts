import { network } from "hardhat";
import {
  decodeFunctionData,
  parseAbiItem,
  parseEther,
  parseEventLogs,
  toFunctionSelector,
  type PublicClient,
} from "viem";
import { readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const STATUS = ["Monitoring", "Paused", "UnderReview"];
const OUTCOME = ["Pending", "Clear", "Violation", "Ambiguous"];

/** Minimal platform ABI for the advanced-request deposit. */
const PLATFORM_ABI = [
  {
    name: "getAdvancedRequestDeposit",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "subcommitteeSize", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

/** ABI used to decode the inferString payload in the RequestCreated log. */
const LLM_ABI = [
  {
    name: "inferString",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "prompt", type: "string" },
      { name: "system", type: "string" },
      { name: "chainOfThought", type: "bool" },
      { name: "allowedValues", type: "string[]" },
    ],
    outputs: [{ name: "response", type: "string" }],
  },
] as const;

/**
 * Loads the deployment record written by deploy.ts.
 */
function loadDeployment() {
  const path = join(ROOT, "deployments", "somnia-testnet.json");
  return JSON.parse(readFileSync(path, "utf-8")) as {
    ComplianceMonitor: `0x${string}`;
    agentRequester: `0x${string}`;
    llmInferenceAgentId: string;
    explorer: string;
  };
}

/**
 * Runs the full sanction-check flow: computes the platform deposit, dispatches
 * checkSanctions (which fires the LLM-inference advanced request), then polls
 * for the asynchronous consensus callback.
 */
async function main() {
  const { viem } = await network.create();
  const publicClient = (await viem.getPublicClient()) as unknown as PublicClient;
  const [wallet] = await viem.getWalletClients();

  const dep = loadDeployment();
  const contract = await viem.getContractAt("ComplianceMonitor", dep.ComplianceMonitor);

  const listType = process.env.LIST_TYPE ?? "OFAC_SDN";

  // Required deposit for a 3-validator advanced request, per the platform.
  const deposit = (await publicClient.readContract({
    address: dep.agentRequester,
    abi: PLATFORM_ABI,
    functionName: "getAdvancedRequestDeposit",
    args: [3n],
  })) as bigint;

  // TODO formula: deposit + parseEther("0.5"). Raise RESOLVE_TOPUP_STT if the
  // subcommittee needs more budget to run inference.
  const topup = parseEther(process.env.RESOLVE_TOPUP_STT ?? "0.5");
  const value = deposit + topup;

  console.log("=".repeat(70));
  console.log(`ComplianceMonitor : ${dep.ComplianceMonitor}`);
  console.log(`List type         : ${listType}`);
  console.log(`Inference agent ID: ${dep.llmInferenceAgentId}`);
  console.log(`Platform deposit  : ${deposit} wei`);
  console.log(`Top-up            : ${topup} wei`);
  console.log(`Value sent        : ${value} wei`);
  console.log(`inferString sel.  : ${toFunctionSelector("inferString(string,string,bool,string[])")}`);
  console.log("=".repeat(70));

  const hash = await contract.write.checkSanctions([listType], { value });
  console.log(`checkSanctions tx : ${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log(`Confirmed in block: ${receipt.blockNumber}`);

  const [requested] = parseEventLogs({
    abi: contract.abi,
    logs: receipt.logs,
    eventName: "SanctionCheckRequested",
  });
  const caseId = (requested.args as any).requestId as `0x${string}`;
  console.log(`\nCase / request ID : ${caseId}`);

  // Decode the payload the contract sent to the LLM agent (audit trail).
  const created = parseEventLogs({
    abi: [
      parseAbiItem(
        "event RequestCreated(uint256 indexed requestId, uint256 indexed agentId, uint256 perAgentBudget, bytes payload, address[] subcommittee)"
      ),
    ],
    logs: receipt.logs,
  });
  if (created.length > 0) {
    const payload = created[0].args.payload as `0x${string}`;
    console.log(`Platform requestId: ${created[0].args.requestId}`);
    console.log(`Subcommittee      : ${created[0].args.subcommittee!.length} validators`);
    try {
      const decoded = decodeFunctionData({ abi: LLM_ABI, data: payload });
      console.log(`Prompt            : "${decoded.args[0]}"`);
      console.log(`AllowedValues     : ${JSON.stringify(decoded.args[3])}`);
    } catch {
      console.log("Payload           : (could not decode as inferString)");
    }
  }

  writeFileSync(
    join(ROOT, "deployments", "last-check.json"),
    JSON.stringify(
      { contract: dep.ComplianceMonitor, caseId, listType, resolveTx: hash, block: receipt.blockNumber.toString() },
      null,
      2
    )
  );
  console.log("Saved -> deployments/last-check.json");

  await pollResolution(publicClient, dep.ComplianceMonitor, caseId, receipt.blockNumber);

  const status = (await contract.read.getComplianceStatus()) as number;
  const c = (await contract.read.getCase([caseId])) as any;
  console.log(`\nFinal contract status: ${STATUS[status] ?? status}`);
  console.log(`Case outcome         : ${OUTCOME[Number(c.outcome)] ?? c.outcome}`);
  console.log(`Case result          : "${c.lastResult}"`);
}

/**
 * Polls SanctionCheckPerformed for `caseId` until it lands or times out.
 */
async function pollResolution(
  publicClient: PublicClient,
  address: `0x${string}`,
  caseId: `0x${string}`,
  startBlock: bigint
) {
  const event = parseAbiItem("event SanctionCheckPerformed(bytes32 indexed requestId, string result)");
  const BLOCK_WINDOW = 1000n;
  const deadline = Date.now() + 180_000;
  let from = startBlock;

  console.log("\nPolling for SanctionCheckPerformed (max 3 min)...");
  while (Date.now() < deadline) {
    const latest = await publicClient.getBlockNumber();
    for (let f = from; f <= latest; f += BLOCK_WINDOW) {
      const to = f + BLOCK_WINDOW - 1n > latest ? latest : f + BLOCK_WINDOW - 1n;
      const logs = await publicClient.getLogs({ address, event, args: { requestId: caseId }, fromBlock: f, toBlock: to });
      if (logs.length > 0) {
        console.log(`\nConsensus result -> "${logs[0].args.result}"`);
        return;
      }
    }
    from = latest + 1n;
    await new Promise((r) => setTimeout(r, 5_000));
  }
  console.log("\nTimeout: no callback yet. Inspect later with `npm run diagnose`.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
