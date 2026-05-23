# Gas Report

Measured with Hardhat 3 local test network, `solc 0.8.20`, optimizer enabled (`runs=200`, `viaIR=true`).

Absolute values on Somnia testnet may vary, but relative cost profile is consistent.

## Measured functions

| Function | Gas used (approx.) | Notes |
| --- | --- | --- |
| `checkSanctions` | `~257,946` | Builds payload, creates request, stores case, accrues fee |
| `handleResolution` (`VIOLATION`) | `~97,165` | Decodes result, updates case, pauses protocol |
| `guardianResolveCase` | `~37,642` | Resolves case, updates status |
| `withdrawNativeFees` | `~37,203` | Transfers accrued STT fees to treasury |
| `emergencyPause` | `~27,876` | Status update + event |
| `simulateSanctionListUpdate` | `~26,378` | Event emission |

## How to reproduce

1. Install and test:

```bash
npm install
npm run test
```

2. Capture receipts from relevant test cases or script flows.
3. Read `receipt.gasUsed` values.

## Cost model notes

- A compliance cycle usually includes:
  1. user/operator transaction: `checkSanctions`
  2. asynchronous platform callback: `handleResolution`
- Agent request budget (`deposit + top-up`) is not EVM gas; it is platform execution funding.
- Protocol fee is `0.1%` of `msg.value` in `checkSanctions`.

## Implemented optimizations

- `immutable` configuration values
- custom errors instead of string reverts
- constants for committee and fee params
- optimizer + `viaIR`

## Possible future optimizations

- Remove on-chain case enumeration array if event indexing is enough.
- Batch list checks where agent APIs allow multi-item requests.
