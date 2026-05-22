import { network } from "hardhat";
import { formatEther, parseAbiItem, parseEther, type PublicClient } from "viem";
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

const STATUS = ["Monitoring", "Paused", "UnderReview"];

// Tuning (env-overridable).
const SCAN_MS = Number(process.env.MONITOR_SCAN_MS ?? 15_000);
const TOPUP_STT = process.env.RESOLVE_TOPUP_STT ?? "0.5";
const LIST_TYPES = (process.env.MONITOR_LIST_TYPES ?? "OFAC_SDN,EU_CONSOLIDATED").split(",").map((s) => s.trim());
const CB_THRESHOLD = Number(process.env.CB_THRESHOLD ?? 3); // failures before opening
const CB_COOLDOWN_MS = Number(process.env.CB_COOLDOWN_MS ?? 60_000);
const MIN_BALANCE = parseEther(process.env.MONITOR_MIN_BALANCE_STT ?? "0.05");

/**
 * Per-agent circuit breaker: opens after consecutive failures and stays open
 * for a cooldown window before allowing a half-open retry.
 */
class CircuitBreaker {
  private failures = 0;
  private openedAt = 0;
  constructor(public readonly name: string) {}

  canRequest(): boolean {
    if (this.failures < CB_THRESHOLD) return true;
    if (Date.now() - this.openedAt >= CB_COOLDOWN_MS) {
      console.log(`  [cb:${this.name}] half-open, allowing trial request`);
      return true;
    }
    return false;
  }

  recordSuccess() {
    if (this.failures > 0) console.log(`  [cb:${this.name}] reset after success`);
    this.failures = 0;
  }

  recordFailure() {
    this.failures += 1;
    if (this.failures >= CB_THRESHOLD) {
      this.openedAt = Date.now();
      console.log(`  [cb:${this.name}] OPEN after ${this.failures} failures`);
    }
  }
}

function loadDeployment() {
  return JSON.parse(
    readFileSync(join(ROOT, "deployments", "somnia-testnet.json"), "utf-8")
  ) as { ComplianceMonitor: `0x${string}`; agentRequester: `0x${string}` };
}

/**
 * Autonomous compliance monitor.
 *
 * Reactivity is the PRIMARY path: it watches `SanctionListUpdate` and dispatches
 * a check as soon as a list changes. Polling is a FALLBACK heartbeat that
 * periodically re-checks each configured list. Both paths respect: a balance
 * floor, per-listType in-flight dedupe, exponential backoff, and per-agent
 * circuit breakers (JSON API, Parse Website, LLM Inference).
 */
async function main() {
  const { viem } = await network.create();
  const publicClient = (await viem.getPublicClient()) as unknown as PublicClient;
  const [wallet] = await viem.getWalletClients();
  const dep = loadDeployment();
  const contract = await viem.getContractAt("ComplianceMonitor", dep.ComplianceMonitor);

  const breakers = {
    jsonApi: new CircuitBreaker("JSON_API"),
    parseWebsite: new CircuitBreaker("PARSE_WEBSITE"),
    inference: new CircuitBreaker("LLM_INFERENCE"),
  };

  const inFlight = new Set<string>();
  let backoffMs = SCAN_MS;

  console.log("Autonomous compliance monitor started");
  console.log(`  contract : ${dep.ComplianceMonitor}`);
  console.log(`  operator : ${wallet.account.address}`);
  console.log(`  lists    : ${LIST_TYPES.join(", ")}`);
  console.log(`  scan     : every ${SCAN_MS / 1000}s (polling fallback)\n`);

  /**
   * Dispatches a single sanction check for a list, guarded by all safety rails.
   */
  async function dispatchCheck(listType: string, trigger: string) {
    if (inFlight.has(listType)) return;

    // All three composed agents must have a closed breaker.
    for (const b of Object.values(breakers)) {
      if (!b.canRequest()) {
        console.log(`  skip ${listType}: circuit breaker ${b.name} is open`);
        return;
      }
    }

    const balance = await publicClient.getBalance({ address: wallet.account.address });
    if (balance < MIN_BALANCE) {
      console.log(`  skip ${listType}: balance ${formatEther(balance)} STT below floor ${formatEther(MIN_BALANCE)}`);
      return;
    }

    inFlight.add(listType);
    try {
      const deposit = (await publicClient.readContract({
        address: dep.agentRequester,
        abi: PLATFORM_ABI,
        functionName: "getAdvancedRequestDeposit",
        args: [3n],
      })) as bigint;
      const value = deposit + parseEther(TOPUP_STT);

      console.log(`-> [${trigger}] checkSanctions(${listType}) value=${formatEther(value)} STT`);
      const hash = await contract.write.checkSanctions([listType], { value });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      console.log(`   tx ${hash} in block ${receipt.blockNumber}`);

      Object.values(breakers).forEach((b) => b.recordSuccess());
      backoffMs = SCAN_MS; // reset backoff on success
    } catch (err: any) {
      Object.values(breakers).forEach((b) => b.recordFailure());
      backoffMs = Math.min(backoffMs * 2, 5 * 60_000); // exponential backoff, cap 5 min
      console.error(`   x ${listType} failed: ${err?.shortMessage ?? err?.message ?? err}`);
      console.error(`   backoff now ${backoffMs / 1000}s`);
    } finally {
      inFlight.delete(listType);
    }
  }

  // PRIMARY: reactivity — react to on-chain SanctionListUpdate events.
  publicClient.watchEvent({
    address: dep.ComplianceMonitor,
    event: parseAbiItem("event SanctionListUpdate(string listType, uint256 timestamp)"),
    onLogs: (logs) => {
      for (const log of logs) {
        const listType = (log.args as any).listType as string;
        console.log(`\n[reactivity] SanctionListUpdate(${listType})`);
        void dispatchCheck(listType, "reactivity");
      }
    },
    onError: (e) => console.error("watchEvent error:", e?.message ?? e),
  });

  // FALLBACK: polling heartbeat.
  const tick = async () => {
    try {
      const status = (await contract.read.getComplianceStatus()) as number;
      console.log(`[poll] status=${STATUS[status] ?? status}`);
      for (const listType of LIST_TYPES) {
        await dispatchCheck(listType, "poll");
      }
    } catch (e: any) {
      console.error("poll error:", e?.shortMessage ?? e?.message ?? e);
    } finally {
      setTimeout(tick, backoffMs);
    }
  };
  void tick();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
