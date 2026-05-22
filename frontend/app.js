import {
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  formatEther,
  getContract,
  http,
  parseEther,
  parseEventLogs,
} from "https://esm.sh/viem@2.50.4";

const SOMNIA_RPC = "https://api.infra.testnet.somnia.network";
const EXPLORER = "https://shannon-explorer.somnia.network";
const SOMNIA_CHAIN_HEX = "0xc488"; // 50312

const somniaTestnet = defineChain({
  id: 50312,
  name: "Somnia Testnet",
  nativeCurrency: { name: "STT", symbol: "STT", decimals: 18 },
  rpcUrls: { default: { http: [SOMNIA_RPC] }, public: { http: [SOMNIA_RPC] } },
});

const STATUS = ["Monitoring", "Paused", "UnderReview"];
const OUTCOME = ["Pending", "Clear", "Violation", "Ambiguous"];
const STATUS_CLASS = ["status-monitoring", "status-paused", "status-review"];
const OUTCOME_BADGE = ["b-pending", "b-clear", "b-violation", "b-ambiguous"];

// ComplianceMonitor ABI subset used by the dashboard.
const monitorAbi = [
  { type: "function", name: "checkSanctions", stateMutability: "payable", inputs: [{ name: "listType", type: "string" }], outputs: [{ name: "caseId", type: "bytes32" }] },
  { type: "function", name: "simulateSanctionListUpdate", stateMutability: "nonpayable", inputs: [{ name: "listType", type: "string" }], outputs: [] },
  { type: "function", name: "emergencyPause", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "resumeProtocol", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "guardianResolveCase", stateMutability: "nonpayable", inputs: [{ name: "caseId", type: "bytes32" }, { name: "violationConfirmed", type: "bool" }], outputs: [] },
  { type: "function", name: "highRiskAction", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "getComplianceStatus", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "accruedNativeFees", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "agentRequester", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "llmInferenceAgentId", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "getCaseCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "getCaseIdAt", stateMutability: "view", inputs: [{ name: "index", type: "uint256" }], outputs: [{ type: "bytes32" }] },
  {
    type: "function", name: "getCase", stateMutability: "view", inputs: [{ name: "caseId", type: "bytes32" }],
    outputs: [{
      type: "tuple", components: [
        { name: "listType", type: "string" },
        { name: "platformRequestId", type: "uint256" },
        { name: "outcome", type: "uint8" },
        { name: "escalated", type: "bool" },
        { name: "resolved", type: "bool" },
        { name: "createdAt", type: "uint256" },
        { name: "lastResult", type: "string" },
      ],
    }],
  },
  { type: "event", name: "SanctionCheckRequested", inputs: [{ name: "requestId", type: "bytes32", indexed: true }, { name: "listType", type: "string", indexed: false }, { name: "timestamp", type: "uint256", indexed: false }] },
];

const platformAbi = [
  { type: "function", name: "getAdvancedRequestDeposit", stateMutability: "view", inputs: [{ name: "subcommitteeSize", type: "uint256" }], outputs: [{ type: "uint256" }] },
];

const publicClient = createPublicClient({ chain: somniaTestnet, transport: http(SOMNIA_RPC) });

let walletClient;
let account;
let contractAddress = localStorage.getItem("complianceMonitorAddress") || "";

const $ = (id) => document.getElementById(id);
const els = {
  account: $("account"), address: $("contractAddress"), statusBadge: $("statusBadge"), statusText: $("statusText"),
  fees: $("fees"), agentId: $("agentId"), listType: $("listType"), topup: $("topup"), gasInfo: $("gasInfo"),
  updateListType: $("updateListType"), caseId: $("caseId"), casesBody: $("casesBody"), autoRefreshBtn: $("autoRefreshBtn"), log: $("log"),
};
els.address.value = contractAddress;

function log(msg) {
  els.log.textContent = `[${new Date().toLocaleTimeString()}] ${msg}\n${els.log.textContent}`.trim();
}

function formatError(error) {
  if (!error) return "Unknown error";
  if (typeof error === "string") return error;
  const parts = [
    error.shortMessage,
    error.details,
    error.message,
  ].filter((p, i, arr) => typeof p === "string" && p.trim() !== "" && arr.indexOf(p) === i);
  return parts.length > 0 ? parts.join(" | ") : "Unknown error";
}

function requireAddress() {
  const v = els.address.value.trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(v)) throw new Error("Set a valid contract address first.");
  contractAddress = v;
  return v;
}

function requireWallet() {
  if (!walletClient || !account) throw new Error("Connect wallet first.");
}

async function ensureSomniaWalletNetwork() {
  if (!window.ethereum) throw new Error("No injected wallet detected (MetaMask/Rabby).");
  const chainId = await window.ethereum.request({ method: "eth_chainId" });
  if (chainId === SOMNIA_CHAIN_HEX) return;

  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: SOMNIA_CHAIN_HEX }],
    });
    log("Wallet switched to Somnia Testnet (50312).");
  } catch (switchErr) {
    if (switchErr?.code !== 4902) throw switchErr;
    await window.ethereum.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId: SOMNIA_CHAIN_HEX,
        chainName: "Somnia Testnet",
        nativeCurrency: { name: "STT", symbol: "STT", decimals: 18 },
        rpcUrls: [SOMNIA_RPC],
        blockExplorerUrls: [EXPLORER],
      }],
    });
    log("Somnia Testnet added to wallet. Please retry the action.");
  }
}

function readContract() {
  return getContract({ address: requireAddress(), abi: monitorAbi, client: { public: publicClient } });
}

function writeContractClient() {
  return getContract({ address: requireAddress(), abi: monitorAbi, client: { public: publicClient, wallet: walletClient } });
}

async function waitTx(hash) {
  log(`Waiting tx: ${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status === "reverted") {
    throw new Error(`Transaction reverted on-chain. tx: ${explorerTx(hash)}`);
  }
  log(`Confirmed in block ${receipt.blockNumber} (gas ${receipt.gasUsed})`);
  return receipt;
}

function explorerTx(hash) { return `${EXPLORER}/tx/${hash}`; }

async function refreshStatus() {
  try {
    const c = readContract();
    const [status, fees, agentId] = await Promise.all([
      c.read.getComplianceStatus(),
      c.read.accruedNativeFees(),
      c.read.llmInferenceAgentId(),
    ]);
    const s = Number(status);
    els.statusBadge.className = `status-badge ${STATUS_CLASS[s] || "status-monitoring"}`;
    els.statusText.textContent = STATUS[s] || `Unknown(${s})`;
    els.fees.textContent = formatEther(fees);
    els.agentId.textContent = agentId.toString();
  } catch (e) {
    log(`Status refresh failed: ${formatError(e)}`);
  }
}

$("connectBtn").addEventListener("click", async () => {
  try {
    await ensureSomniaWalletNetwork();
    walletClient = createWalletClient({ chain: somniaTestnet, transport: custom(window.ethereum) });
    const [selected] = await walletClient.requestAddresses();
    account = selected;
    els.account.textContent = account;
    log(`Connected: ${account}`);
  } catch (e) { log(`Connect failed: ${formatError(e)}`); }
});

$("saveAddressBtn").addEventListener("click", () => {
  try {
    const a = requireAddress();
    localStorage.setItem("complianceMonitorAddress", a);
    log(`Saved contract address: ${a}`);
    refreshStatus();
  } catch (e) { log(`Save failed: ${formatError(e)}`); }
});

$("refreshBtn").addEventListener("click", refreshStatus);

$("checkBtn").addEventListener("click", async () => {
  try {
    requireWallet();
    await ensureSomniaWalletNetwork();
    const c = writeContractClient();
    const listType = els.listType.value;
    const agentRequester = await c.read.agentRequester();
    const deposit = await publicClient.readContract({ address: agentRequester, abi: platformAbi, functionName: "getAdvancedRequestDeposit", args: [3n] });
    const topup = parseEther(els.topup.value || "0.5");
    const value = deposit + topup;
    log(`Deposit ${formatEther(deposit)} + top-up ${formatEther(topup)} = ${formatEther(value)} STT`);
    const hash = await c.write.checkSanctions([listType], { account, value });
    const receipt = await waitTx(hash);
    const [evt] = parseEventLogs({ abi: monitorAbi, logs: receipt.logs, eventName: "SanctionCheckRequested" });
    els.gasInfo.innerHTML = `Check sent. Gas: <b>${receipt.gasUsed}</b> · <a href="${explorerTx(hash)}" target="_blank">tx</a>`;
    if (evt) log(`Case opened: ${evt.args.requestId}`);
    await refreshStatus();
  } catch (e) { log(`Check failed: ${formatError(e)}`); }
});

$("simUpdateBtn").addEventListener("click", async () => {
  try {
    requireWallet();
    await ensureSomniaWalletNetwork();
    const c = writeContractClient();
    const hash = await c.write.simulateSanctionListUpdate([els.updateListType.value], { account });
    await waitTx(hash);
    log(`SanctionListUpdate emitted for ${els.updateListType.value}.`);
  } catch (e) { log(`Update failed: ${formatError(e)}`); }
});

$("pauseBtn").addEventListener("click", () => guardianCall("emergencyPause", []));
$("resumeBtn").addEventListener("click", () => guardianCall("resumeProtocol", []));

async function resolveCaseId() {
  const raw = els.caseId.value.trim();
  if (/^0x[a-fA-F0-9]{64}$/.test(raw)) return raw;
  const c = readContract();
  const count = await c.read.getCaseCount();
  if (count === 0n) throw new Error("No cases on-chain yet.");
  return c.read.getCaseIdAt([count - 1n]);
}

$("confirmBtn").addEventListener("click", async () => {
  try {
    const id = await resolveCaseId();
    await guardianCall("guardianResolveCase", [id, true]);
    log(`Confirmed violation for case ${id}.`);
  } catch (e) { log(`Confirm failed: ${formatError(e)}`); }
});

$("dismissBtn").addEventListener("click", async () => {
  try {
    const id = await resolveCaseId();
    await guardianCall("guardianResolveCase", [id, false]);
    log(`Dismissed case ${id}.`);
  } catch (e) { log(`Dismiss failed: ${formatError(e)}`); }
});

async function guardianCall(fn, args) {
  try {
    requireWallet();
    await ensureSomniaWalletNetwork();
    const c = writeContractClient();
    const hash = await c.write[fn](args, { account });
    await waitTx(hash);
    await refreshStatus();
  } catch (e) { log(`${fn} failed: ${formatError(e)}`); }
}

$("highRiskBtn").addEventListener("click", async () => {
  try {
    requireWallet();
    await ensureSomniaWalletNetwork();
    const c = writeContractClient();
    const status = Number(await c.read.getComplianceStatus());
    if (status !== 0) {
      log(`High-risk blocked: protocol is ${STATUS[status] || `Unknown(${status})`}. Resume/dismiss from Guardian Panel first.`);
      await refreshStatus();
      return;
    }
    const hash = await c.write.highRiskAction([], { account });
    await waitTx(hash);
    log("High-risk action executed (protocol is Monitoring).");
    await refreshStatus();
  } catch (e) {
    log(`High-risk blocked: ${formatError(e)}`);
    await refreshStatus();
  }
});

$("loadCasesBtn").addEventListener("click", loadCases);

async function loadCases() {
  try {
    const c = readContract();
    const count = Number(await c.read.getCaseCount());
    if (count === 0) {
      els.casesBody.innerHTML = `<tr><td colspan="7" class="status">No cases yet.</td></tr>`;
      return;
    }
    const rows = [];
    for (let i = count - 1; i >= 0 && i >= count - 25; i--) {
      const id = await c.read.getCaseIdAt([BigInt(i)]);
      const k = await c.read.getCase([id]);
      const out = Number(k.outcome);
      rows.push(`<tr>
        <td>${i}</td>
        <td class="mono">${id.slice(0, 10)}…${id.slice(-6)}</td>
        <td>${k.listType}</td>
        <td><span class="badge ${OUTCOME_BADGE[out] || "b-pending"}">${OUTCOME[out] || out}</span></td>
        <td class="mono">${k.lastResult || "-"}</td>
        <td>${k.escalated ? "yes" : "no"}</td>
        <td>${k.resolved ? "yes" : "no"}</td>
      </tr>`);
    }
    els.casesBody.innerHTML = rows.join("");
    log(`Loaded ${count} case(s).`);
  } catch (e) { log(`Load cases failed: ${formatError(e)}`); }
}

let autoTimer = null;
els.autoRefreshBtn.addEventListener("click", () => {
  if (autoTimer) {
    clearInterval(autoTimer); autoTimer = null;
    els.autoRefreshBtn.textContent = "Auto-refresh: OFF";
    log("Auto-refresh OFF.");
  } else {
    els.autoRefreshBtn.textContent = "Auto-refresh: ON";
    log("Auto-refresh ON (5s).");
    const tick = () => { refreshStatus(); loadCases(); };
    tick();
    autoTimer = setInterval(tick, 5000);
  }
});

if (contractAddress) refreshStatus();
log("UI ready. Connect wallet, set the ComplianceMonitor address, then interact.");
