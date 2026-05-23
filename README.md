# DeFi Compliance Monitor - Somnia Agentic L1

Autonomous sanctions/compliance monitor for a DeFi protocol.

- `VIOLATION` -> protocol auto-pauses
- `AMBIGUOUS` -> escalates to guardian review
- `CLEAR` -> protocol remains in monitoring

Everything is auditable on-chain through events and case state.

## What this project includes

- Smart contract: `contracts/ComplianceMonitor.sol`
- Interfaces: `contracts/interfaces/`
- Scripts: `scripts/` (`deploy`, `check`, `reactivity`, `monitor`, `escalate`, `diagnose`)
- Frontend dashboard: `frontend/index.html`
- Tests: `test/` (unit + e2e)

## 1) Prerequisites

- Node.js 20+
- npm
- A funded Somnia testnet wallet (STT)
- Agent IDs from the Somnia Agent Explorer: `https://agents.testnet.somnia.network`

If using WSL, use Linux Node/npm (not Windows npm over UNC paths).

## 2) Clone and install

```bash
git clone <your-repo-url> defi-compliance-monitor
cd defi-compliance-monitor
npm install
```

## 3) Configure `.env`

```bash
cp .env.demo.example .env
```

You can also start from `.env.example`, but `.env.demo.example` is optimized for
the demo flow with explicit placeholders.

Fill these required values:

| Variable | Required | Description |
| --- | --- | --- |
| `SOMNIA_RPC_URL` | Yes | Somnia testnet RPC |
| `SOMNIA_CHAIN_ID` | Yes | `50312` |
| `PRIVATE_KEY` | Yes (deploy/transact) | Deployer/operator wallet private key |
| `AGENT_REQUESTER_ADDRESS` | Yes | Somnia agent platform contract |
| `JSON_API_AGENT_ID` | Yes | JSON API agent ID |
| `LLM_PARSE_WEBSITE_AGENT_ID` | Yes | Parse Website agent ID |
| `LLM_INFERENCE_AGENT_ID` | Yes | Inference agent ID |
| `GUARDIAN_MULTISIG` | Yes | Guardian address for escalations |
| `PROTOCOL_TREASURY` | Yes | Fee recipient |
| `COMPLIANCE_MONITOR_ADDRESS` | After deploy | Deployed contract address |

### Demo configuration (simple and recommended)

For demo/testing, use the **same wallet address** for guardian and treasury:

```env
GUARDIAN_MULTISIG=<your-wallet-address>
PROTOCOL_TREASURY=<your-wallet-address>
```

Production recommendation: use separate addresses (multisig + treasury).

## 4) Compile and test

```bash
npm run compile
npm run test
```

Expected: 20 tests passing.

## 5) Deploy contract

```bash
npm run deploy:somnia
```

This creates `deployments/somnia-testnet.json` and prints explorer info.

Copy the deployed address to `.env`:

```env
COMPLIANCE_MONITOR_ADDRESS=<deployed-address>
```

## 6) Run scripts (CLI validation)

```bash
npm run check:sanctions
npm run reactivity
npm run diagnose
```

Optional:

```bash
npm run monitor
ACTION=confirm CASE_ID=0x... npm run escalate
ACTION=dismiss CASE_ID=0x... npm run escalate
ACTION=resume npm run escalate
```

## 7) Run and test the frontend

Start a static server:

```bash
npx serve frontend
```

Open the served URL and follow this exact flow:

1. Click `Connect Wallet`.
2. Approve switching/adding Somnia Testnet (`50312`).
3. Paste `COMPLIANCE_MONITOR_ADDRESS` in `ComplianceMonitor Address`.
4. Click `Save Address`.
5. Click `Refresh` and verify status shows `Monitoring`, `Paused`, or `UnderReview`.

### UI test checklist

1. **Monitoring path**
   - Click `Execute High-risk Action`.
   - Expected: success only when status is `Monitoring`.

2. **Violation path**
   - Run in terminal: `LIST_TYPE=FORCED_VIOLATION npm run check:sanctions`.
   - In UI, refresh status.
   - Expected: status `Paused`; high-risk action blocked.

3. **Ambiguous path**
   - Run in terminal: `LIST_TYPE=FORCED_AMBIGUOUS npm run check:sanctions`.
   - In UI, refresh/load cases.
   - Expected: status `UnderReview`; case escalated.

4. **Guardian resolution path**
   - In UI Guardian Panel (or CLI `npm run escalate`), confirm or dismiss case.
   - Confirm -> stays/returns `Paused`.
   - Dismiss -> returns `Monitoring`.

## Troubleshooting

- **Wallet on wrong chain**: switch to Somnia Testnet `50312`.
- **`Missing required env var`**: complete `.env` required fields.
- **Deploy fails**: verify agent IDs are valid and registered.
- **High-risk action blocked**: protocol is not `Monitoring`; resolve case or resume first.
- **npm audit warnings**: typically dev-dependency tooling warnings; project can still compile/test/deploy.

## Real vs mock in this MVP

- Real: contract, state machine, guardian controls, on-chain inference request/callback, tests, frontend actions.
- Simulated/off-chain orchestration: JSON API + Parse Website pipeline wiring and same-block reactivity in local demos.

## License

MIT (see `LICENSE`).
