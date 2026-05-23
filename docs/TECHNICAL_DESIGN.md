# Technical Design

## 1) System goal

`ComplianceMonitor` is an on-chain compliance circuit breaker for a DeFi protocol:

- request AI consensus on sanctions checks
- auto-pause on `VIOLATION`
- escalate `AMBIGUOUS` to guardian
- keep protocol active on `CLEAR`

## 2) Contract design

Main contract: `contracts/ComplianceMonitor.sol`

### Immutable configuration

Constructor requires non-zero values for:

- `agentRequester`
- `jsonApiAgentId`
- `llmParseWebsiteAgentId`
- `llmInferenceAgentId`
- `guardianMultisig`
- `protocolTreasury`

All values come from environment variables through deployment scripts.

### State machine

```solidity
enum ComplianceStatus { Monitoring, Paused, UnderReview }
```

- `Monitoring`: high-risk actions allowed
- `Paused`: high-risk actions blocked
- `UnderReview`: high-risk actions blocked until guardian decision

### Core flow

1. `checkSanctions(listType)`
2. Contract sends advanced agent request (subcommittee size 3, threshold 2, majority)
3. Platform callback `handleResolution(...)`
4. Result routing:
   - `VIOLATION` -> pause protocol
   - `CLEAR` -> keep monitoring
   - `AMBIGUOUS` -> escalate case, move to under review

### Case model

Each check creates a case with:

- list type
- platform request ID
- outcome (`Pending`, `Clear`, `Violation`, `Ambiguous`)
- escalation/resolution flags
- timestamp
- raw last result string

Cases are enumerable with `getCaseCount()` and `getCaseIdAt(index)`.

## 3) Agent composition

Target pipeline:

`JSON API Agent -> LLM Parse Website Agent -> LLM Inference Agent -> Contract action`

In this MVP:

- Inference consensus request is on-chain and active.
- JSON API and Parse Website stages are orchestrated by scripts (off-chain wiring).

## 4) Security controls

- `ReentrancyGuard` on value/callback paths
- `Ownable` + guardian role checks
- callback sender authentication (`msg.sender == agentRequester`)
- constructor zero checks for critical config
- no `tx.origin`

## 5) Fee model

`checkSanctions` takes `msg.value` and applies:

- 0.1% protocol fee (`FEE_BPS = 10`)
- remainder forwarded to agent request funding

Native fees accumulate in `accruedNativeFees` and can be withdrawn to `protocolTreasury`.

## 6) Reactivity model

- Contract emits `SanctionListUpdate(listType, timestamp)`.
- A reactivity handler can trigger `checkSanctions` from that event.
- Local script simulates this behavior (`npm run reactivity`).

## 7) Guardian operations

Guardian-only controls:

- `guardianResolveCase(caseId, violationConfirmed)`
- `emergencyPause()`
- `resumeProtocol()`

Demo configuration can use one wallet for deployer/guardian/treasury.
Production should use a proper multisig and separate treasury.

## 8) Testing strategy

- Unit tests: `test/ComplianceMonitor.test.ts`
- E2E tests: `test/ComplianceFlow.e2e.test.ts`
- Mock platform: `contracts/mocks/MockAgentRequester.sol`

Run:

```bash
npm run test
```

## 9) Operational limitations (MVP)

- JSON API + Parse Website composition is script-orchestrated.
- Same-block reactivity is simulated in local/dev flows.
- Demo guardian can be a single key.
