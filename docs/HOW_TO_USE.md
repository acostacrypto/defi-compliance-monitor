# How To Use

Practical step-by-step guide to run and validate the project (CLI + frontend).

## 1) Setup from scratch

```bash
git clone <your-repo-url> defi-compliance-monitor
cd defi-compliance-monitor
npm install
cp .env.demo.example .env
```

## 2) Fill required `.env` values

Required:

- `PRIVATE_KEY`
- `AGENT_REQUESTER_ADDRESS`
- `JSON_API_AGENT_ID`
- `LLM_PARSE_WEBSITE_AGENT_ID`
- `LLM_INFERENCE_AGENT_ID`
- `GUARDIAN_MULTISIG`
- `PROTOCOL_TREASURY`

Demo rule for this repository:

- Use the same deployer wallet address for both:
  - `GUARDIAN_MULTISIG=<deployer-wallet-address>`
  - `PROTOCOL_TREASURY=<deployer-wallet-address>`

## 3) Compile and test locally

```bash
npm run compile
npm run test
```

Expected: tests pass.

## 4) Deploy to Somnia testnet

```bash
npm run deploy:somnia
```

After deploy, set:

```env
COMPLIANCE_MONITOR_ADDRESS=<deployed-address>
```

## 5) Execute a compliance check

```bash
npm run check:sanctions
```

What happens:

1. Reads required platform deposit.
2. Sends `deposit + top-up`.
3. Calls `checkSanctions(listType)`.
4. Waits for async consensus callback.
5. Prints case ID and final result.

## 6) Run reactivity simulation

```bash
npm run reactivity
```

This emits `SanctionListUpdate` and runs a follow-up check.

## 7) Diagnose current state

```bash
npm run diagnose
```

Use this to inspect:

- case outcome
- escalation/resolution flags
- final protocol status

## 8) Guardian actions

```bash
ACTION=confirm CASE_ID=0x... npm run escalate
ACTION=dismiss CASE_ID=0x... npm run escalate
ACTION=resume npm run escalate
```

- `confirm` keeps/forces `Paused`
- `dismiss` moves back to `Monitoring`
- `resume` lifts pause without case verdict

## 9) Frontend walkthrough (`frontend/index.html`)

Start frontend:

```bash
npx serve frontend
```

In the UI:

1. **Wallet + Contract**
   - Connect wallet.
   - Approve network switch to Somnia Testnet (`50312`).
   - Paste contract address.
   - Click `Save Address`.

2. **Protocol Status**
   - Click `Refresh`.
   - Confirm status badge and accrued fees.

3. **Run Sanction Check**
   - Select list type.
   - Keep top-up default (`0.5`) unless you need higher budget.
   - Click `Trigger Sanction Check`.

4. **Reactivity**
   - Click `Simulate Sanction List Update`.

5. **Guardian Panel**
   - `Emergency Pause` / `Resume Protocol`.
   - For cases, use `Confirm Violation` or `Dismiss Case`.

6. **High-risk Action**
   - Succeeds only when status is `Monitoring`.
   - If `Paused` or `UnderReview`, it is blocked by design.

7. **Cases & Violations**
   - Click `Load Cases` to inspect outcomes.

## 10) Recommended end-to-end test script

```bash
npm run test
npm run deploy:somnia
npm run check:sanctions
LIST_TYPE=FORCED_VIOLATION npm run check:sanctions
LIST_TYPE=FORCED_AMBIGUOUS npm run check:sanctions
npm run diagnose
```

Then resolve in UI or with `npm run escalate`.
