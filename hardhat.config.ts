import "dotenv/config";
import hardhatViem from "@nomicfoundation/hardhat-viem";
import hardhatNodeTestRunner from "@nomicfoundation/hardhat-node-test-runner";
import { defineConfig } from "hardhat/config";

/**
 * Normalizes PRIVATE_KEY so both `abcd...` and `0xabcd...` formats work.
 * When unset, local compile and test still work; only Somnia deploy fails.
 */
const privateKey = process.env.PRIVATE_KEY ?? "";
const normalizedPrivateKey =
  privateKey === "" ? "" : privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;

const chainId = Number(process.env.SOMNIA_CHAIN_ID ?? "50312");

export default defineConfig({
  plugins: [hardhatViem, hardhatNodeTestRunner],
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
    },
  },
  networks: {
    // Default in-process network used by `hardhat test` and unit/e2e suites.
    hardhatMainnet: {
      type: "edr-simulated",
      chainType: "l1",
    },
    somniaTestnet: {
      type: "http",
      chainType: "l1",
      chainId,
      url: process.env.SOMNIA_RPC_URL ?? "https://api.infra.testnet.somnia.network",
      accounts: normalizedPrivateKey === "" ? [] : [normalizedPrivateKey],
    },
  },
});
