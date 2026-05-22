import { network } from "hardhat";
import {
  decodeAbiParameters,
  decodeFunctionData,
  formatEther,
  parseAbiItem,
  parseEventLogs,
  toFunctionSelector,
  type PublicClient,
} from "viem";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const RESPONSE_STATUS = ["None", "Pending", "Success", "Failed", "TimedOut"];
const STATUS = ["Monitoring", "Paused", "UnderReview"];
const OUTCOME = ["Pending", "Clear", "Violation", "Ambiguous"];

const RESPONSE_TUPLE = {
  type: "tuple[]",
  name: "responses",
  components: [
    { name: "validator", type: "address" },
    { name: "result", type: "bytes" },
    { name: "status", type: "uint8" },
    { name: "receipt", type: "uint256" },
    { name: "timestamp", type: "uint256" },
    { name: "executionCost", type: "uint256" },
  ],
} as const;

const PLATFORM_ABI = [
  {
    name: "getRequest",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "requestId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "id", type: "uint256" },
          { name: "requester", type: "address" },
          { name: "callbackAddress", type: "address" },
          { name: "callbackSelector", type: "bytes4" },
          { name: "subcommittee", type: "address[]" },
          RESPONSE_TUPLE,
          { name: "responseCount", type: "uint256" },
          { name: "failureCount", type: "uint256" },
          { name: "threshold", type: "uint256" },
          { name: "createdAt", type: "uint256" },
          { name: "deadline", type: "uint256" },
          { name: "status", type: "uint8" },
          { name: "consensusType", type: "uint8" },
          { name: "remainingBudget", type: "uint256" },
          { name: "perAgentBudget", type: "uint256" },
        ],
      },
    ],
  },
  {
    name: "hasRequest",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "requestId", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

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
 * Best-effort decode of a validator result payload.
 */
function tryDecodeString(result: `0x${string}`): string {
  try {
    const [decoded] = decodeAbiParameters([{ type: "string" }], result);
    return `abi-string: "${decoded}"`;
  } catch {
    /* fall through */
  }
  try {
    const text = Buffer.from(result.slice(2), "hex").toString("utf8").replace(/\0/g, "");
    if (text.trim().length > 0) return `raw-utf8: "${text}"`;
  } catch {
    /* fall through */
  }
  return "(not decodable)";
}

function loadJson(path: string) {
  return JSON.parse(readFileSync(join(ROOT, path), "utf-8"));
}

/**
 * Diagnoses a compliance case end to end: decodes the prompt/allowed values the
 * contract sent, inspects the platform request and per-validator responses, and
 * prints the final on-chain case state.
 */
async function main() {
  const { viem } = await network.create();
  const publicClient = (await viem.getPublicClient()) as unknown as PublicClient;
  const dep = loadJson("deployments/somnia-testnet.json");
  const contract = await viem.getContractAt("ComplianceMonitor", dep.ComplianceMonitor);

  let caseId = process.env.CASE_ID as `0x${string}` | undefined;
  let resolveTx = process.env.RESOLVE_TX as `0x${string}` | undefined;
  if (!caseId || !resolveTx) {
    try {
      const last = loadJson("deployments/last-check.json");
      caseId = caseId ?? last.caseId;
      resolveTx = resolveTx ?? last.resolveTx;
    } catch {
      /* no last-check.json */
    }
  }
  if (!caseId) {
    const count = (await contract.read.getCaseCount()) as bigint;
    if (count === 0n) throw new Error("No cases on-chain. Run `npm run check:sanctions` first.");
    caseId = (await contract.read.getCaseIdAt([count - 1n])) as `0x${string}`;
  }

  console.log("=".repeat(70));
  console.log(`ComplianceMonitor : ${dep.ComplianceMonitor}`);
  console.log(`Case analyzed     : ${caseId}`);
  console.log("=".repeat(70));

  const c = (await contract.read.getCase([caseId])) as any;
  const platformRequestId = c.platformRequestId as bigint;
  console.log("\n[CASE STATE]");
  console.log(`  listType        : ${c.listType}`);
  console.log(`  outcome         : ${OUTCOME[Number(c.outcome)] ?? c.outcome}`);
  console.log(`  escalated       : ${c.escalated}`);
  console.log(`  resolved        : ${c.resolved}`);
  console.log(`  result          : "${c.lastResult}"`);
  console.log(`  platformRequest : ${platformRequestId}`);

  const expectedSelector = toFunctionSelector("inferString(string,string,bool,string[])");
  console.log(`\n[EXPECTED inferString selector]: ${expectedSelector}`);

  if (resolveTx) {
    const receipt = await publicClient.getTransactionReceipt({ hash: resolveTx });
    const created = parseEventLogs({
      abi: [
        parseAbiItem(
          "event RequestCreated(uint256 indexed requestId, uint256 indexed agentId, uint256 perAgentBudget, bytes payload, address[] subcommittee)"
        ),
      ],
      logs: receipt.logs,
    });
    if (created.length > 0) {
      const ev = created[0].args;
      const payload = ev.payload as `0x${string}`;
      console.log(`\n[RequestCreated @ block ${receipt.blockNumber}]`);
      console.log(`  agentId         : ${ev.agentId}`);
      console.log(`  perAgentBudget  : ${formatEther(ev.perAgentBudget!)} STT`);
      console.log(`  subcommittee    : ${ev.subcommittee!.length} validators`);
      console.log(`  payload selector: ${payload.slice(0, 10)} (matches: ${payload.slice(0, 10) === expectedSelector})`);
      try {
        const decoded = decodeFunctionData({ abi: LLM_ABI, data: payload });
        console.log(`  prompt          : "${decoded.args[0]}"`);
        console.log(`  system          : "${decoded.args[1]}"`);
        console.log(`  chainOfThought  : ${decoded.args[2]}`);
        console.log(`  allowedValues   : ${JSON.stringify(decoded.args[3])}`);
      } catch (e) {
        console.log(`  Warning: could not decode payload: ${(e as Error).message.split("\n")[0]}`);
      }
    }
  } else {
    console.log("\nTip: pass RESOLVE_TX=0x... to decode the inferString payload.");
  }

  if (platformRequestId > 0n) {
    console.log(`\n[Platform request ${platformRequestId} @ ${dep.agentRequester}]`);
    const exists = await publicClient.readContract({
      address: dep.agentRequester,
      abi: PLATFORM_ABI,
      functionName: "hasRequest",
      args: [platformRequestId],
    });
    if (!exists) {
      console.log("  (platform no longer has this requestId)");
    } else {
      const req = (await publicClient.readContract({
        address: dep.agentRequester,
        abi: PLATFORM_ABI,
        functionName: "getRequest",
        args: [platformRequestId],
      })) as any;
      console.log(`  status         : ${RESPONSE_STATUS[Number(req.status)]}`);
      console.log(`  responseCount  : ${req.responseCount}`);
      console.log(`  failureCount   : ${req.failureCount}`);
      console.log(`  threshold      : ${req.threshold}`);
      console.log(`\n  Responses (${req.responses.length}):`);
      req.responses.forEach((r: any, i: number) => {
        console.log(`   [${i}] validator=${r.validator} status=${RESPONSE_STATUS[Number(r.status)]}`);
        if (r.result !== "0x") console.log(`       decode -> ${tryDecodeString(r.result)}`);
      });
    }
  }

  const status = (await contract.read.getComplianceStatus()) as number;
  console.log("\n" + "=".repeat(70));
  console.log(`FINAL CONTRACT STATUS: ${STATUS[status] ?? status}`);
  console.log("INTERPRETATION:");
  console.log("  - VIOLATION -> protocol Paused automatically.");
  console.log("  - AMBIGUOUS -> UnderReview, awaiting guardian (npm run escalate).");
  console.log("  - CLEAR     -> stays Monitoring.");
  console.log("=".repeat(70));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
