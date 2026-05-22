import { network } from "hardhat";
import { parseEther, parseEventLogs, type PublicClient } from "viem";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const PLATFORM_ABI = [
  {
    name: "getAdvancedRequestDeposit",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "subcommitteeSize", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

/**
 * Loads the deployment record written by deploy.ts.
 */
function loadDeployment() {
  return JSON.parse(
    readFileSync(join(ROOT, "deployments", "somnia-testnet.json"), "utf-8")
  ) as { ComplianceMonitor: `0x${string}`; agentRequester: `0x${string}` };
}

/**
 * Demonstrates Somnia on-chain reactivity for sanction-list updates.
 *
 * On production Somnia you register a Reactivity handler in the Reactivity
 * Registry that fires when `SanctionListUpdate` is emitted and executes
 * `checkSanctions` in the SAME block. That same-block guarantee cannot be
 * reproduced on a generic RPC, so this script SIMULATES the handler: it emits
 * the update, then immediately dispatches the check, and logs both block
 * numbers and tx hashes so the timing is auditable.
 *
 * To wire the real handler, register:
 *   trigger : event SanctionListUpdate(string,uint256) on ComplianceMonitor
 *   action  : call ComplianceMonitor.checkSanctions(listType) with deposit
 */
async function main() {
  const { viem } = await network.create();
  const publicClient = (await viem.getPublicClient()) as unknown as PublicClient;
  const dep = loadDeployment();
  const contract = await viem.getContractAt("ComplianceMonitor", dep.ComplianceMonitor);

  const listType = process.env.LIST_TYPE ?? "OFAC_SDN";
  console.log("Somnia Reactivity handler — SIMULATION mode");
  console.log(`  contract : ${dep.ComplianceMonitor}`);
  console.log(`  listType : ${listType}\n`);

  // 1) Emit the reactivity trigger (authority-gated).
  const updateTx = await contract.write.simulateSanctionListUpdate([listType]);
  const updateRcpt = await publicClient.waitForTransactionReceipt({ hash: updateTx });
  const [updateEvent] = parseEventLogs({
    abi: contract.abi,
    logs: updateRcpt.logs,
    eventName: "SanctionListUpdate",
  });
  console.log("[1] SanctionListUpdate emitted");
  console.log(`    block : ${updateRcpt.blockNumber}`);
  console.log(`    tx    : ${updateTx}`);
  console.log(`    list  : ${(updateEvent.args as any).listType}\n`);

  // 2) Handler reacts: dispatch the sanction check.
  const deposit = (await publicClient.readContract({
    address: dep.agentRequester,
    abi: PLATFORM_ABI,
    functionName: "getAdvancedRequestDeposit",
    args: [3n],
  })) as bigint;
  const value = deposit + parseEther(process.env.RESOLVE_TOPUP_STT ?? "0.5");

  const checkTx = await contract.write.checkSanctions([listType], { value });
  const checkRcpt = await publicClient.waitForTransactionReceipt({ hash: checkTx });
  const [requested] = parseEventLogs({
    abi: contract.abi,
    logs: checkRcpt.logs,
    eventName: "SanctionCheckRequested",
  });
  console.log("[2] Reactivity handler executed checkSanctions");
  console.log(`    block  : ${checkRcpt.blockNumber}`);
  console.log(`    tx     : ${checkTx}`);
  console.log(`    caseId : ${(requested.args as any).requestId}\n`);

  const sameBlock = updateRcpt.blockNumber === checkRcpt.blockNumber;
  const gap = checkRcpt.blockNumber - updateRcpt.blockNumber;
  console.log("[3] Timing");
  console.log(`    update block : ${updateRcpt.blockNumber}`);
  console.log(`    handler block: ${checkRcpt.blockNumber}`);
  console.log(`    same-block   : ${sameBlock} (gap ${gap} block(s))`);
  console.log("    status       : reactivity simulation completed");
  if (!sameBlock) {
    console.log(
      "\n    NOTE: Off-chain simulation runs the action in a later block. A registered\n" +
        "    Somnia Reactivity handler executes it in the SAME block as the trigger."
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
