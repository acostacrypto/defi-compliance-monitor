// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {
    IAgentRequester,
    ConsensusType,
    ResponseStatus,
    Response,
    Request
} from "./interfaces/IAgentRequester.sol";
import {ILLMAgent} from "./interfaces/ILLMAgent.sol";

/// @title ComplianceMonitor
/// @notice Autonomous DeFi compliance monitor settled through Somnia Agentic L1.
/// @dev Sanction checks are dispatched as async LLM-inference requests with a
/// validator subcommittee (majority consensus). The platform callback
/// (`handleResolution`) maps the consensus result to one of VIOLATION / CLEAR /
/// AMBIGUOUS and drives the protocol state machine:
///   - VIOLATION  -> Paused (high-risk functions blocked automatically)
///   - AMBIGUOUS  -> UnderReview (escalated to the guardian multisig)
///   - CLEAR      -> Monitoring (no change)
/// A guardian multisig provides human review and emergency controls.
contract ComplianceMonitor is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // --------------------------------------------------------------------- //
    // Immutable configuration (validated non-zero in the constructor).
    // All agent IDs / addresses come from the deployer's environment; nothing
    // is hardcoded. See .env.example and scripts/deploy.ts.
    // --------------------------------------------------------------------- //

    /// @notice Somnia platform contract authorized to invoke `handleResolution`.
    address public immutable agentRequester;
    /// @notice JSON API agent ID (sanction-feed fetch stage). Recorded on-chain
    /// for auditability; consumed by the off-chain orchestration scripts.
    uint256 public immutable jsonApiAgentId;
    /// @notice LLM Parse Website agent ID (entity-extraction stage). Recorded
    /// on-chain for auditability; consumed by the orchestration scripts.
    uint256 public immutable llmParseWebsiteAgentId;
    /// @notice LLM Inference agent ID used for the on-chain consensus decision.
    uint256 public immutable llmInferenceAgentId;
    /// @notice Multisig with guardian powers (resolve cases, emergency pause).
    address public immutable guardianMultisig;
    /// @notice Destination for withdrawn compliance fees.
    address public immutable protocolTreasury;

    // --------------------------------------------------------------------- //
    // Constants
    // --------------------------------------------------------------------- //

    /// @notice Validator subcommittee size for each sanction check.
    uint256 public constant SUBCOMMITTEE_SIZE = 3;
    /// @notice Minimum agreeing responses required for consensus.
    uint256 public constant CONSENSUS_THRESHOLD = 2;
    /// @notice Request timeout passed to the platform (seconds; 0 = default).
    uint256 public constant REQUEST_TIMEOUT = 300;
    /// @notice Compliance fee in basis points (10 bps = 0.1%).
    uint256 public constant FEE_BPS = 10;
    /// @notice Basis-point denominator.
    uint256 public constant BPS_DENOMINATOR = 10_000;
    /// @notice Sentinel token address used to tag native-STT fees in events.
    address public constant NATIVE_TOKEN = address(0);

    // --------------------------------------------------------------------- //
    // State
    // --------------------------------------------------------------------- //

    /// @notice Top-level protocol compliance state.
    enum ComplianceStatus {
        Monitoring,
        Paused,
        UnderReview
    }

    /// @notice Per-case classification produced by the agent consensus.
    enum CaseOutcome {
        Pending,
        Clear,
        Violation,
        Ambiguous
    }

    /// @notice Compliance case opened by a sanction check.
    struct Case {
        string listType; // sanction list scanned (e.g. "OFAC_SDN")
        uint256 platformRequestId; // Somnia platform request ID
        CaseOutcome outcome; // consensus classification
        bool escalated; // moved to guardian review
        bool resolved; // closed by a guardian
        uint256 createdAt; // block timestamp at request time
        string lastResult; // raw consensus string returned by the agent
    }

    ComplianceStatus private _status;

    /// @notice All compliance cases keyed by internal case ID.
    mapping(bytes32 => Case) public cases;
    /// @notice Maps a platform request ID to its internal case ID.
    mapping(uint256 => bytes32) public requestToCase;
    /// @notice Enumerable list of every case ID created.
    bytes32[] public caseIds;
    /// @notice Monotonic counter ensuring unique case IDs.
    uint256 public caseCount;
    /// @notice Accrued native-STT fees pending withdrawal to the treasury.
    uint256 public accruedNativeFees;

    // --------------------------------------------------------------------- //
    // Events
    // --------------------------------------------------------------------- //

    event SanctionCheckRequested(bytes32 indexed requestId, string listType, uint256 timestamp);
    event SanctionCheckPerformed(bytes32 indexed requestId, string result);
    event ViolationDetected(bytes32 indexed caseId, address indexed account, string reason);
    event ProtocolPaused(bytes32 indexed caseId, uint256 timestamp);
    event CaseEscalated(bytes32 indexed caseId, string reason);
    event CaseResolved(bytes32 indexed caseId, bool violationConfirmed);
    event ProtocolResumed(uint256 timestamp);
    event SanctionListUpdate(string listType, uint256 timestamp);
    event AgentCallbackReceived(bytes32 indexed requestId, string result);
    event FeeAccumulated(address indexed token, uint256 amount);
    event FeesWithdrawn(address indexed token, address indexed to, uint256 amount);
    event HighRiskActionExecuted(address indexed caller);

    // --------------------------------------------------------------------- //
    // Errors
    // --------------------------------------------------------------------- //

    error ZeroAddress();
    error ZeroAgentId();
    error Unauthorized();
    error InsufficientDeposit(uint256 sent, uint256 required);
    error UnknownRequest();
    error CaseAlreadyResolved();
    error UnknownCase();
    error ProtocolNotPaused();
    error NotMonitoring();
    error NothingToWithdraw();
    error EmptyListType();

    // --------------------------------------------------------------------- //
    // Modifiers
    // --------------------------------------------------------------------- //

    /// @dev Restricts to the guardian multisig. Never uses tx.origin.
    modifier onlyGuardian() {
        if (msg.sender != guardianMultisig) revert Unauthorized();
        _;
    }

    /// @dev Restricts to the contract owner or the guardian multisig.
    modifier onlyAuthority() {
        if (msg.sender != owner() && msg.sender != guardianMultisig) revert Unauthorized();
        _;
    }

    /// @dev Blocks high-risk operations unless the protocol is actively Monitoring.
    modifier onlyWhenMonitoring() {
        if (_status != ComplianceStatus.Monitoring) revert NotMonitoring();
        _;
    }

    // --------------------------------------------------------------------- //
    // Constructor
    // --------------------------------------------------------------------- //

    /// @param _agentRequester Somnia platform contract (AGENT_REQUESTER_ADDRESS).
    /// @param _jsonApiAgentId JSON API agent ID.
    /// @param _llmParseWebsiteAgentId LLM Parse Website agent ID.
    /// @param _llmInferenceAgentId LLM Inference agent ID.
    /// @param _guardianMultisig Guardian multisig address.
    /// @param _protocolTreasury Treasury receiving withdrawn fees.
    constructor(
        address _agentRequester,
        uint256 _jsonApiAgentId,
        uint256 _llmParseWebsiteAgentId,
        uint256 _llmInferenceAgentId,
        address _guardianMultisig,
        address _protocolTreasury
    ) Ownable(msg.sender) {
        if (
            _agentRequester == address(0) ||
            _guardianMultisig == address(0) ||
            _protocolTreasury == address(0)
        ) revert ZeroAddress();
        if (
            _jsonApiAgentId == 0 ||
            _llmParseWebsiteAgentId == 0 ||
            _llmInferenceAgentId == 0
        ) revert ZeroAgentId();

        agentRequester = _agentRequester;
        jsonApiAgentId = _jsonApiAgentId;
        llmParseWebsiteAgentId = _llmParseWebsiteAgentId;
        llmInferenceAgentId = _llmInferenceAgentId;
        guardianMultisig = _guardianMultisig;
        protocolTreasury = _protocolTreasury;

        _status = ComplianceStatus.Monitoring;
    }

    // --------------------------------------------------------------------- //
    // Core compliance flow
    // --------------------------------------------------------------------- //

    /// @notice Dispatches an autonomous sanction check for `listType`.
    /// @dev Builds an `inferString` payload constrained to the closed set
    /// {VIOLATION, CLEAR, AMBIGUOUS} and submits it as an advanced request with
    /// a `SUBCOMMITTEE_SIZE` validator committee under majority consensus. A
    /// `FEE_BPS` fee is skimmed from `msg.value` and retained for the treasury;
    /// the remainder funds the agent request. Rounding: the fee uses integer
    /// division and truncates down (favoring the caller); the truncated
    /// remainder is forwarded to the platform, so no native value is lost.
    /// @param listType Sanction list identifier to scan (e.g. "OFAC_SDN").
    /// @return caseId Internal case ID correlating this check to its callback.
    function checkSanctions(string calldata listType)
        external
        payable
        nonReentrant
        returns (bytes32 caseId)
    {
        if (bytes(listType).length == 0) revert EmptyListType();

        IAgentRequester platform = IAgentRequester(agentRequester);
        uint256 deposit = platform.getAdvancedRequestDeposit(SUBCOMMITTEE_SIZE);

        uint256 fee = (msg.value * FEE_BPS) / BPS_DENOMINATOR;
        uint256 forwardValue = msg.value - fee;
        if (forwardValue < deposit) revert InsufficientDeposit(forwardValue, deposit);

        if (fee > 0) {
            accruedNativeFees += fee;
            emit FeeAccumulated(NATIVE_TOKEN, fee);
        }

        bytes memory payload = _buildInferencePayload(listType);

        uint256 platformRequestId = platform.createAdvancedRequest{value: forwardValue}(
            llmInferenceAgentId,
            address(this),
            this.handleResolution.selector,
            payload,
            SUBCOMMITTEE_SIZE,
            CONSENSUS_THRESHOLD,
            ConsensusType.Majority,
            REQUEST_TIMEOUT
        );

        caseId = keccak256(abi.encode(platformRequestId, listType, ++caseCount, block.chainid));
        requestToCase[platformRequestId] = caseId;
        caseIds.push(caseId);
        cases[caseId] = Case({
            listType: listType,
            platformRequestId: platformRequestId,
            outcome: CaseOutcome.Pending,
            escalated: false,
            resolved: false,
            createdAt: block.timestamp,
            lastResult: ""
        });

        emit SanctionCheckRequested(caseId, listType, block.timestamp);
    }

    /// @notice Emits the on-chain reactivity trigger for a sanction-list update.
    /// @dev Authority-gated so a spoofed event cannot drive the reactive handler
    /// to spend agent budget. A Somnia Reactivity handler listens for this event
    /// and calls `checkSanctions` same-block (see scripts/reactivityHandler.ts).
    /// @param listType Sanction list that changed.
    function simulateSanctionListUpdate(string calldata listType) external onlyAuthority {
        if (bytes(listType).length == 0) revert EmptyListType();
        emit SanctionListUpdate(listType, block.timestamp);
    }

    /// @notice Platform callback delivering the validator consensus result.
    /// @dev Only `agentRequester` may call. Decodes the first response as an
    /// ABI string and routes the protocol state machine. A failed/empty request
    /// is treated as AMBIGUOUS and escalated rather than silently cleared.
    /// @param requestId Platform request ID created in `checkSanctions`.
    /// @param responses Validator responses returned by the platform.
    /// @param status Global request status.
    function handleResolution(
        uint256 requestId,
        Response[] memory responses,
        ResponseStatus status,
        Request memory /* details */
    ) external nonReentrant {
        if (msg.sender != agentRequester) revert Unauthorized();
        bytes32 caseId = requestToCase[requestId];
        if (caseId == bytes32(0)) revert UnknownRequest();

        Case storage c = cases[caseId];

        string memory result;
        if (status == ResponseStatus.Success && responses.length > 0 && responses[0].result.length > 0) {
            result = abi.decode(responses[0].result, (string));
        } else {
            result = "AMBIGUOUS";
        }

        c.lastResult = result;
        emit AgentCallbackReceived(caseId, result);
        emit SanctionCheckPerformed(caseId, result);

        bytes32 resultHash = keccak256(bytes(result));
        if (resultHash == keccak256("VIOLATION")) {
            c.outcome = CaseOutcome.Violation;
            emit ViolationDetected(caseId, address(this), result);
            _pauseProtocol(caseId);
        } else if (resultHash == keccak256("CLEAR")) {
            c.outcome = CaseOutcome.Clear;
            // No state change: protocol keeps Monitoring.
        } else {
            c.outcome = CaseOutcome.Ambiguous;
            _escalateCase(caseId, result);
        }
    }

    // --------------------------------------------------------------------- //
    // Guardian / emergency controls
    // --------------------------------------------------------------------- //

    /// @notice Guardian resolution of a case (typically after escalation).
    /// @dev Confirming a violation keeps/forces the protocol Paused; dismissing
    /// resumes Monitoring. Idempotent guard prevents double resolution.
    /// @param caseId Case to resolve.
    /// @param violationConfirmed True to confirm a violation, false to dismiss.
    function guardianResolveCase(bytes32 caseId, bool violationConfirmed) external onlyGuardian {
        Case storage c = cases[caseId];
        if (c.createdAt == 0) revert UnknownCase();
        if (c.resolved) revert CaseAlreadyResolved();

        c.resolved = true;
        c.outcome = violationConfirmed ? CaseOutcome.Violation : CaseOutcome.Clear;
        emit CaseResolved(caseId, violationConfirmed);

        if (violationConfirmed) {
            if (_status != ComplianceStatus.Paused) {
                _status = ComplianceStatus.Paused;
                emit ProtocolPaused(caseId, block.timestamp);
            }
        } else {
            _status = ComplianceStatus.Monitoring;
            emit ProtocolResumed(block.timestamp);
        }
    }

    /// @notice Guardian emergency pause, independent of any case.
    function emergencyPause() external onlyGuardian {
        _status = ComplianceStatus.Paused;
        emit ProtocolPaused(bytes32(0), block.timestamp);
    }

    /// @notice Guardian resumes the protocol back to Monitoring.
    function resumeProtocol() external onlyGuardian {
        if (_status == ComplianceStatus.Monitoring) revert ProtocolNotPaused();
        _status = ComplianceStatus.Monitoring;
        emit ProtocolResumed(block.timestamp);
    }

    // --------------------------------------------------------------------- //
    // Fees
    // --------------------------------------------------------------------- //

    /// @notice Withdraws accrued native-STT fees to the treasury.
    /// @dev Callable by owner or guardian; funds always go to `protocolTreasury`.
    function withdrawNativeFees() external onlyAuthority nonReentrant {
        uint256 amount = accruedNativeFees;
        if (amount == 0) revert NothingToWithdraw();
        accruedNativeFees = 0;
        emit FeesWithdrawn(NATIVE_TOKEN, protocolTreasury, amount);
        (bool ok, ) = protocolTreasury.call{value: amount}("");
        if (!ok) revert();
    }

    /// @notice Sweeps any ERC20 balance to the treasury using SafeERC20.
    /// @dev Provided for ERC20-denominated fees or accidental token transfers.
    /// @param token ERC20 token to sweep.
    function sweepERC20Fees(IERC20 token) external onlyAuthority nonReentrant {
        uint256 amount = token.balanceOf(address(this));
        if (amount == 0) revert NothingToWithdraw();
        emit FeesWithdrawn(address(token), protocolTreasury, amount);
        token.safeTransfer(protocolTreasury, amount);
    }

    // --------------------------------------------------------------------- //
    // Protected protocol surface (demonstrates auto-pause of high-risk funcs)
    // --------------------------------------------------------------------- //

    /// @notice Example high-risk protocol action gated by compliance state.
    /// @dev Reverts whenever the protocol is Paused or UnderReview, while view
    /// functions and guardian controls stay accessible.
    function highRiskAction() external onlyWhenMonitoring {
        emit HighRiskActionExecuted(msg.sender);
    }

    // --------------------------------------------------------------------- //
    // Views
    // --------------------------------------------------------------------- //

    /// @notice Returns the current protocol compliance status.
    function getComplianceStatus() external view returns (ComplianceStatus) {
        return _status;
    }

    /// @notice Returns a full case record.
    function getCase(bytes32 caseId) external view returns (Case memory) {
        return cases[caseId];
    }

    /// @notice Number of cases ever created.
    function getCaseCount() external view returns (uint256) {
        return caseIds.length;
    }

    /// @notice Case ID at an enumeration index.
    function getCaseIdAt(uint256 index) external view returns (bytes32) {
        return caseIds[index];
    }

    // --------------------------------------------------------------------- //
    // Internal helpers
    // --------------------------------------------------------------------- //

    /// @dev Builds the deterministic `inferString` calldata payload.
    function _buildInferencePayload(string calldata listType) internal pure returns (bytes memory) {
        string[] memory allowed = new string[](3);
        allowed[0] = "VIOLATION";
        allowed[1] = "CLEAR";
        allowed[2] = "AMBIGUOUS";

        return abi.encodeWithSelector(
            ILLMAgent.inferString.selector,
            string.concat(
                "Given the sanction list '",
                listType,
                "', determine whether the monitored DeFi protocol or its tracked ",
                "counterparties match any sanctioned entity. Answer VIOLATION, CLEAR, or AMBIGUOUS."
            ),
            "You are a precise compliance oracle. Respond with exactly one of the allowed values.",
            false,
            allowed
        );
    }

    /// @dev Moves the protocol to Paused for a confirmed violation.
    function _pauseProtocol(bytes32 caseId) internal {
        _status = ComplianceStatus.Paused;
        emit ProtocolPaused(caseId, block.timestamp);
    }

    /// @dev Flags a case for guardian review and moves to UnderReview.
    function _escalateCase(bytes32 caseId, string memory reason) internal {
        cases[caseId].escalated = true;
        _status = ComplianceStatus.UnderReview;
        emit CaseEscalated(caseId, reason);
    }

    /// @notice Accepts native STT (e.g. fee top-ups or refunds from the platform).
    receive() external payable {}
}
