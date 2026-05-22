import { network } from "hardhat";
import { type PublicClient } from "viem";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const STATUS = ["Monitoring", "Paused", "UnderReview"];
const OUTCOME = ["Pending", "Clear", "Violation", "Ambiguous"];

function loadDeployment() {
  return JSON.parse(
    readFileSync(join(ROOT, "deployments", "somnia-testnet.json"), "utf-8")
  ) as { ComplianceMonitor: `0x${string}`; guardianMultisig: `0x${string}`; explorer: string };
}

/**
 * Guardian review tool for escalated / ambiguous cases.
 *
 * Drive it with env vars:
 *   ACTION  = confirm | dismiss | resume   (default: confirm)
 *   CASE_ID = 0x...  (defaults to the latest case on-chain)
 *
 *   confirm -> guardianResolveCase(caseId, true)  : confirm violation, keep Paused
 *   dismiss -> guardianResolveCase(caseId, false) : clear case, resume Monitoring
 *   resume  -> resumeProtocol()                   : lift pause without a case verdict
 *
 * Requires the signer to be GUARDIAN_MULTISIG. If a single key signs in place of
 * a real multisig, treat this as a multisig simulation (documented limitation):
 * in production route the same call through the Safe / multisig contract.
 */
async function main() {
  const { viem } = await network.create();
  const publicClient = (await viem.getPublicClient()) as unknown as PublicClient;
  const [wallet] = await viem.getWalletClients();
  const dep = loadDeployment();
  const contract = await viem.getContractAt("ComplianceMonitor", dep.ComplianceMonitor);

  const action = (process.env.ACTION ?? "confirm").toLowerCase();

  const signer = wallet.account.address.toLowerCase();
  const guardian = dep.guardianMultisig.toLowerCase();
  console.log("Guardian escalation tool");
  console.log(`  contract : ${dep.ComplianceMonitor}`);
  console.log(`  signer   : ${wallet.account.address}`);
  console.log(`  guardian : ${dep.guardianMultisig}`);
  if (signer !== guardian) {
    console.log("  NOTE: signer != guardian multisig. On-chain call will revert with Unauthorized.");
    console.log("        Run with the guardian key, or route via the multisig contract.");
  }

  const before = (await contract.read.getComplianceStatus()) as number;
  console.log(`  status   : ${STATUS[before] ?? before}\n`);

  if (action === "resume") {
    const hash = await contract.write.resumeProtocol();
    await publicClient.waitForTransactionReceipt({ hash });
    console.log(`resumeProtocol tx: ${hash}`);
  } else {
    const caseId = (process.env.CASE_ID ?? (await latestCaseId(contract))) as `0x${string}`;
    if (!caseId) throw new Error("No case found. Pass CASE_ID=0x...");
    const c = (await contract.read.getCase([caseId])) as any;
    console.log(`Reviewing case ${caseId}`);
    console.log(`  listType : ${c.listType}`);
    console.log(`  outcome  : ${OUTCOME[Number(c.outcome)] ?? c.outcome}`);
    console.log(`  escalated: ${c.escalated}`);
    console.log(`  result   : "${c.lastResult}"`);
    console.log(`  resolved : ${c.resolved}\n`);

    const confirmed = action === "confirm";
    console.log(`Action: ${confirmed ? "CONFIRM violation (keep Paused)" : "DISMISS case (resume Monitoring)"}`);
    const hash = await contract.write.guardianResolveCase([caseId, confirmed]);
    await publicClient.waitForTransactionReceipt({ hash });
    console.log(`guardianResolveCase tx: ${hash}`);
  }

  const after = (await contract.read.getComplianceStatus()) as number;
  console.log(`\nStatus now: ${STATUS[after] ?? after}`);
  console.log(`Audit: ${dep.explorer}`);
}

/**
 * Returns the most recently created case ID, or undefined if none exist.
 */
async function latestCaseId(contract: any): Promise<`0x${string}` | undefined> {
  const count = (await contract.read.getCaseCount()) as bigint;
  if (count === 0n) return undefined;
  return (await contract.read.getCaseIdAt([count - 1n])) as `0x${string}`;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
