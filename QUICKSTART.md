# Quickstart

Fast path from clone to a working frontend demo.

## 1) Clone and install

```bash
git clone <your-repo-url> defi-compliance-monitor
cd defi-compliance-monitor
npm install
```

Use Node 20+ (Linux toolchain recommended when using WSL).

## 2) Configure environment

```bash
cp .env.demo.example .env
```

If you prefer, you can still use `.env.example`; both files are valid.

Fill these required values in `.env`:

- `PRIVATE_KEY` -> funded Somnia testnet wallet (deployer/operator)
- `AGENT_REQUESTER_ADDRESS` -> Somnia agent platform contract
- `JSON_API_AGENT_ID`
- `LLM_PARSE_WEBSITE_AGENT_ID`
- `LLM_INFERENCE_AGENT_ID`
- `GUARDIAN_MULTISIG`
- `PROTOCOL_TREASURY`

Demo setup (recommended): use the same wallet address for both guardian and treasury.

```env
GUARDIAN_MULTISIG=<your-wallet-address>
PROTOCOL_TREASURY=<your-wallet-address>
```

## 3) Compile and test

```bash
npm run compile
npm run test
```

Expected: tests pass (20 cases).

## 4) Deploy

```bash
npm run deploy:somnia
```

Then copy the deployed contract address into `.env`:

```env
COMPLIANCE_MONITOR_ADDRESS=<deployed-address>
```

## 5) Run first compliance check

```bash
npm run demo
```

`demo` is an alias for `npm run check:sanctions`.

## 6) Start frontend

```bash
npx serve frontend
```

Open the served URL, then:

1. Connect wallet.
2. Accept switch/add network to Somnia Testnet (`50312`).
3. Paste `COMPLIANCE_MONITOR_ADDRESS`.
4. Click `Save Address`.

## Useful commands

| Command | Purpose |
| --- | --- |
| `npm run compile` | Compile contracts |
| `npm run test` | Run unit + e2e tests |
| `npm run deploy:somnia` | Deploy to Somnia testnet |
| `npm run check:sanctions` | One full sanction-check flow |
| `npm run reactivity` | Simulate list update -> reactive check |
| `npm run monitor` | Autonomous monitor loop |
| `npm run escalate` | Guardian actions (`confirm`, `dismiss`, `resume`) |
| `npm run diagnose` | Inspect case state + decoded payload |
