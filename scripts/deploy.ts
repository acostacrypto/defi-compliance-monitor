import { network } from "hardhat";
import { isAddress } from "viem";
import { mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

/**
 * Reads a required environment variable or throws with a clear message.
 */
function reqEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`Missing required env var: ${name}. Copy .env.example to .env and fill it in.`);
  }
  return value.trim();
}

/**
 * Reads a required address env var and validates checksum/shape.
 */
function reqAddress(name: string): `0x${string}` {
  const value = reqEnv(name);
  if (!isAddress(value)) throw new Error(`${name} is not a valid address: ${value}`);
  return value as `0x${string}`;
}

/**
 * Deploys ComplianceMonitor with constructor args sourced entirely from .env
 * and persists deployment metadata for the other scripts and the frontend.
 */
async function main() {
  const { viem } = await network.create();
  const [deployer] = await viem.getWalletClients();
  const publicClient = await viem.getPublicClient();

  const agentRequester = reqAddress("AGENT_REQUESTER_ADDRESS");
  const jsonApiAgentId = BigInt(reqEnv("JSON_API_AGENT_ID"));
  const llmParseWebsiteAgentId = BigInt(reqEnv("LLM_PARSE_WEBSITE_AGENT_ID"));
  const llmInferenceAgentId = BigInt(reqEnv("LLM_INFERENCE_AGENT_ID"));
  const guardianMultisig = reqAddress("GUARDIAN_MULTISIG");
  const protocolTreasury = reqAddress("PROTOCOL_TREASURY");
  const explorer = (process.env.EXPLORER_BASE_URL ?? "https://shannon-explorer.somnia.network").replace(/\/$/, "");

  const chainId = await publicClient.getChainId();

  console.log(`Deploying ComplianceMonitor from: ${deployer.account.address}`);
  console.log(`Chain ID: ${chainId}`);

  const contract = await viem.deployContract("ComplianceMonitor", [
    agentRequester,
    jsonApiAgentId,
    llmParseWebsiteAgentId,
    llmInferenceAgentId,
    guardianMultisig,
    protocolTreasury,
  ]);

  const deployment = {
    ComplianceMonitor: contract.address,
    network: "somniaTestnet",
    chainId,
    agentRequester,
    jsonApiAgentId: jsonApiAgentId.toString(),
    llmParseWebsiteAgentId: llmParseWebsiteAgentId.toString(),
    llmInferenceAgentId: llmInferenceAgentId.toString(),
    guardianMultisig,
    protocolTreasury,
    explorer: `${explorer}/address/${contract.address}`,
    deployedAt: new Date().toISOString(),
  };

  mkdirSync(join(ROOT, "deployments"), { recursive: true });
  writeFileSync(
    join(ROOT, "deployments", "somnia-testnet.json"),
    JSON.stringify(deployment, null, 2)
  );

  console.log("\n=== ComplianceMonitor deployed ===");
  console.log(`  address        : ${contract.address}`);
  console.log(`  chainId        : ${chainId}`);
  console.log(`  agentRequester : ${agentRequester}`);
  console.log(`  jsonApiAgentId : ${jsonApiAgentId}`);
  console.log(`  parseAgentId   : ${llmParseWebsiteAgentId}`);
  console.log(`  inferAgentId   : ${llmInferenceAgentId}`);
  console.log(`  guardian       : ${guardianMultisig}`);
  console.log(`  treasury       : ${protocolTreasury}`);
  console.log(`  explorer       : ${deployment.explorer}`);
  console.log("\nSaved -> deployments/somnia-testnet.json");
  console.log("Add COMPLIANCE_MONITOR_ADDRESS to your .env for the scripts/frontend.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
