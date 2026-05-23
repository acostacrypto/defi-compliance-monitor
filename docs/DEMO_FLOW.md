# Demo Flow

Live command + frontend flow to demonstrate the full compliance lifecycle.

## 0) Prepare environment

```bash
git clone <your-repo-url> defi-compliance-monitor
cd defi-compliance-monitor
npm install
cp .env.demo.example .env
```

Set required `.env` values. For demo simplicity:

- `GUARDIAN_MULTISIG=<deployer-wallet-address>`
- `PROTOCOL_TREASURY=<deployer-wallet-address>`

Compile, test, deploy:

```bash
npm run compile
npm run test
npm run deploy:somnia
```

Set:

```env
COMPLIANCE_MONITOR_ADDRESS=<deployed-address>
```

Start frontend:

```bash
npx serve frontend
```

Open `frontend/index.html` via the served URL.

## 1) Connect UI and verify baseline

1. Connect wallet.
2. Accept network switch to Somnia Testnet (`50312`).
3. Paste `COMPLIANCE_MONITOR_ADDRESS` and save.
4. Refresh status.

Expected baseline:

- status `Monitoring`
- `High-risk Action` succeeds

## 2) Demonstrate automatic pause (VIOLATION)

In terminal:

```bash
LIST_TYPE=FORCED_VIOLATION npm run check:sanctions
```

Expected:

- consensus result `VIOLATION`
- contract status becomes `Paused`
- in UI, high-risk action is blocked

## 3) Demonstrate ambiguous escalation

In terminal:

```bash
LIST_TYPE=FORCED_AMBIGUOUS npm run check:sanctions
```

Expected:

- consensus result `AMBIGUOUS`
- status moves to `UnderReview`
- case appears escalated in `Cases & Violations`

## 4) Guardian resolution paths

Resolve in UI Guardian Panel or CLI.

CLI examples:

```bash
# keep paused (confirm violation)
ACTION=confirm CASE_ID=0x... npm run escalate

# clear case and return to monitoring
ACTION=dismiss CASE_ID=0x... npm run escalate

# lift pause directly
ACTION=resume npm run escalate
```

Expected:

- `confirm` -> status `Paused`
- `dismiss` -> status `Monitoring`
- `resume` -> status `Monitoring`

## 5) Reactivity simulation

```bash
npm run reactivity
```

Expected:

- emits `SanctionListUpdate`
- runs follow-up compliance check
- logs trigger and handler block numbers

## 6) Diagnostic evidence

```bash
npm run diagnose
```

Use output for proof:

- case outcome
- escalated/resolved flags
- final contract status
- decoded payload details

## Suggested demo order (8-10 min)

1. `npm run test`
2. `npm run deploy:somnia`
3. Connect frontend and show `Monitoring`
4. `FORCED_VIOLATION` check -> show `Paused`
5. High-risk blocked in UI
6. `FORCED_AMBIGUOUS` check -> show `UnderReview`
7. Guardian `dismiss` -> back to `Monitoring`
8. `npm run diagnose` for final evidence
