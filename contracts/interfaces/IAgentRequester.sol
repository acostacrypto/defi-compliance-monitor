// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Consensus mode used by a platform request.
enum ConsensusType {
    Majority,
    Threshold
}

/// @notice High-level execution status for platform requests and responses.
enum ResponseStatus {
    None,
    Pending,
    Success,
    Failed,
    TimedOut
}

/// @notice Individual validator response returned by the platform.
struct Response {
    address validator;
    bytes result;
    ResponseStatus status;
    uint256 receipt;
    uint256 timestamp;
    uint256 executionCost;
}

/// @notice Full platform request state.
struct Request {
    uint256 id;
    address requester;
    address callbackAddress;
    bytes4 callbackSelector;
    address[] subcommittee;
    Response[] responses;
    uint256 responseCount;
    uint256 failureCount;
    uint256 threshold;
    uint256 createdAt;
    uint256 deadline;
    ResponseStatus status;
    ConsensusType consensusType;
    uint256 remainingBudget;
    uint256 perAgentBudget;
}

/// @notice Minimal interface for the Somnia Agentic L1 request platform.
/// @dev Mirrors the platform contract used by the reference TruthMarket project.
/// The live testnet platform address is set via `AGENT_REQUESTER_ADDRESS`.
interface IAgentRequester {
    event RequestCreated(
        uint256 indexed requestId,
        uint256 indexed agentId,
        uint256 perAgentBudget,
        bytes payload,
        address[] subcommittee
    );
    event RequestFinalized(uint256 indexed requestId, ResponseStatus status);

    /// @notice Creates a basic single-agent request.
    function createRequest(
        uint256 agentId,
        address callbackAddress,
        bytes4 callbackSelector,
        bytes calldata payload
    ) external payable returns (uint256 requestId);

    /// @notice Creates an advanced request with explicit committee parameters.
    /// @param subcommitteeSize Number of validators assigned to the request.
    /// @param threshold Minimum agreeing responses required for consensus.
    /// @param consensusType Majority or Threshold consensus.
    /// @param timeout Seconds before the request times out (0 = platform default).
    function createAdvancedRequest(
        uint256 agentId,
        address callbackAddress,
        bytes4 callbackSelector,
        bytes calldata payload,
        uint256 subcommitteeSize,
        uint256 threshold,
        ConsensusType consensusType,
        uint256 timeout
    ) external payable returns (uint256 requestId);

    /// @notice Returns the full request state.
    function getRequest(uint256 requestId) external view returns (Request memory);
    /// @notice Returns true if the request exists and is retrievable.
    function hasRequest(uint256 requestId) external view returns (bool);
    /// @notice Minimum value required by `createRequest`.
    function getRequestDeposit() external view returns (uint256);
    /// @notice Minimum value required by `createAdvancedRequest`.
    function getAdvancedRequestDeposit(uint256 subcommitteeSize) external view returns (uint256);
}
