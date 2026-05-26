# DeFi Compliance Monitor

Autonomous compliance monitoring system for DeFi protocols built on Somnia Agentic L1. Monitor sanctions, escalate ambiguous cases to guardians, and maintain full on-chain auditability.

## Overview

This MVP demonstrates an autonomous compliance monitor that uses on-chain agents to:
- **VIOLATION** → Protocol auto-pauses
- **AMBIGUOUS** → Escalates to guardian review
- **CLEAR** → Protocol remains in monitoring

Every decision is recorded on-chain through events and immutable case state, ensuring complete auditability.

## Key Features

- **Autonomous Monitoring** - Smart contracts with state machine controls
- **Guardian Escalation** - Multi-sig controlled case resolution
- **On-Chain Callbacks** - Real-time inference requests and responses
- **Full Auditability** - All compliance decisions stored on-chain
- **Web Dashboard** - Interactive UI for monitoring and guardian actions
- **Comprehensive Testing** - Unit and E2E test coverage (20+ tests)

## What's Included

```
contracts/              Smart contracts and interfaces
  ├── ComplianceMonitor.sol
  └── interfaces/       Agent request/callback interfaces

scripts/               Automation and testing scripts
  ├── deploy.ts        Contract deployment
  ├── sanctionCheck.ts Compliance verification
  ├── monitor.ts       Autonomous monitoring loop
  ├── escalate.ts      Guardian case resolution
  └── diagnose.ts      State inspection

frontend/              Web dashboard
  └── index.html       Connect wallet → manage compliance

test/                  Unit and E2E tests
```

## Prerequisites

- **Node.js 20+** (Use Linux toolchain if on WSL)
- **npm**
- **Funded Somnia testnet wallet** (STT tokens)
- **Agent IDs** from [Somnia Agent Explorer](https://agents.testnet.somnia.network)

## Getting Started

### 1. Clone and Install

```bash
git clone <your-repo-url> defi-compliance-monitor
cd defi-compliance-monitor
npm install
```

### 2. Configure Environment

```bash
cp .env.demo.example .env
```

Fill required values:

| Variable | Description |
| --- | --- |
| `SOMNIA_RPC_URL` | Somnia testnet RPC endpoint |
| `PRIVATE_KEY` | Deployer wallet private key |
| `AGENT_REQUESTER_ADDRESS` | Somnia agent platform contract |
| `JSON_API_AGENT_ID` | JSON API agent ID |
| `LLM_PARSE_WEBSITE_AGENT_ID` | Parse website agent ID |
| `LLM_INFERENCE_AGENT_ID` | Inference agent ID |
| `GUARDIAN_MULTISIG` | Guardian address for escalations |
| `PROTOCOL_TREASURY` | Fee recipient address |

**Demo Setup (Recommended)** - Use the same address for both guardian and treasury:
```env
GUARDIAN_MULTISIG=<your-wallet-address>
PROTOCOL_TREASURY=<your-wallet-address>
```

### 3. Compile and Test

```bash
npm run compile
npm run test
```

Expected: 20 tests passing.

### 4. Deploy Contract

```bash
npm run deploy:somnia
```

Copy the deployed address to `.env`:
```env
COMPLIANCE_MONITOR_ADDRESS=<deployed-address>
```

### 5. Run Scripts

Validate the deployment with CLI scripts:

```bash
npm run check:sanctions   # One full sanction-check flow
npm run reactivity        # Simulate list update → reactive check
npm run diagnose          # Inspect case state + decoded payload
```

Optional guardian actions:
```bash
npm run monitor                      # Autonomous monitor loop
ACTION=confirm CASE_ID=0x... npm run escalate  # Confirm case
ACTION=dismiss CASE_ID=0x... npm run escalate  # Dismiss case
ACTION=resume npm run escalate                 # Resume monitoring
```

### 6. Frontend Dashboard

Start the web server:
```bash
npx serve frontend
```

Then in your browser:
1. Click **Connect Wallet** → approve Somnia Testnet (50312)
2. Paste `COMPLIANCE_MONITOR_ADDRESS`
3. Click **Save Address**
4. Click **Refresh** to view status (Monitoring / Paused / UnderReview)

#### Testing the UI

| Scenario | Steps | Expected |
| --- | --- | --- |
| **Monitoring** | Click `Execute High-risk Action` | Succeeds only when status is `Monitoring` |
| **Violation** | Run `LIST_TYPE=FORCED_VIOLATION npm run check:sanctions` | Status shows `Paused`; actions blocked |
| **Ambiguous** | Run `LIST_TYPE=FORCED_AMBIGUOUS npm run check:sanctions` | Status shows `UnderReview`; case escalated |
| **Resolution** | In Guardian Panel, confirm or dismiss case | Confirm → stays Paused; Dismiss → returns Monitoring |

## Real vs. Simulated

| Component | Status |
| --- | --- |
| Smart contracts | ✓ Real |
| State machine | ✓ Real |
| Guardian controls | ✓ Real |
| On-chain inference | ✓ Real |
| Tests | ✓ Real |
| Frontend interactions | ✓ Real |
| JSON API + Parse Website pipeline | 🔄 Simulated/off-chain |
| Same-block reactivity (local demo) | 🔄 Simulated |

## Troubleshooting

| Issue | Solution |
| --- | --- |
| Wallet on wrong chain | Switch to Somnia Testnet (50312) |
| Missing env var | Complete all required fields in `.env` |
| Deploy fails | Verify agent IDs are registered in Agent Explorer |
| High-risk action blocked | Protocol not in `Monitoring` state; resolve case or resume |
| npm warnings | Typically dev-dependency tooling; project still compiles/tests/deploys |

> [!TIP]
> For more details, see [QUICKSTART.md](QUICKSTART.md).

## npm Scripts

| Command | Purpose |
| --- | --- |
| `npm run compile` | Compile contracts |
| `npm run test` | Run unit + E2E tests |
| `npm run coverage` | Test coverage report |
| `npm run deploy:somnia` | Deploy to Somnia testnet |
| `npm run check:sanctions` | Full sanction-check flow |
| `npm run reactivity` | Simulate list update → reactive check |
| `npm run monitor` | Autonomous monitor loop |
| `npm run escalate` | Guardian case resolution |
| `npm run diagnose` | Inspect case state + payload |

## Architecture

The system consists of:

- **Smart Contract** - Immutable on-chain state machine with guardian controls
- **Inference Agents** - Somnia agentic network for JSON API calls and LLM inference
- **Frontend Dashboard** - Real-time monitoring and guardian actions
- **CLI Scripts** - Automation, testing, and case inspection

All compliance decisions are recorded on-chain via events and case logs, ensuring full auditability and transparency.

## License

MIT — see [LICENSE](LICENSE)
