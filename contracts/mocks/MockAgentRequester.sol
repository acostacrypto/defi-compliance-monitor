// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {
    ConsensusType,
    ResponseStatus,
    Response,
    Request
} from "../interfaces/IAgentRequester.sol";

/// @dev Minimal callback surface implemented by ComplianceMonitor.
interface IComplianceCallback {
    function handleResolution(
        uint256 requestId,
        Response[] memory responses,
        ResponseStatus status,
        Request memory details
    ) external;
}

/// @title MockAgentRequester
/// @notice Test-only stand-in for the Somnia Agentic L1 platform. Records the
/// callback target for each request and lets tests deliver a consensus result
/// as if the platform finalized the request. NOT for production use.
contract MockAgentRequester {
    uint256 public nextId = 1;
    uint256 public deposit;
    mapping(uint256 => address) public callbackAddressOf;

    constructor(uint256 _deposit) {
        deposit = _deposit;
    }

    function getRequestDeposit() external view returns (uint256) {
        return deposit;
    }

    function getAdvancedRequestDeposit(uint256) external view returns (uint256) {
        return deposit;
    }

    function hasRequest(uint256 id) external view returns (bool) {
        return callbackAddressOf[id] != address(0);
    }

    function createRequest(
        uint256,
        address callbackAddress,
        bytes4,
        bytes calldata
    ) external payable returns (uint256 id) {
        id = nextId++;
        callbackAddressOf[id] = callbackAddress;
    }

    function createAdvancedRequest(
        uint256,
        address callbackAddress,
        bytes4,
        bytes calldata,
        uint256,
        uint256,
        ConsensusType,
        uint256
    ) external payable returns (uint256 id) {
        id = nextId++;
        callbackAddressOf[id] = callbackAddress;
    }

    /// @notice Delivers a single successful response carrying `result`.
    function deliver(uint256 requestId, string calldata result) external {
        Response[] memory responses = new Response[](1);
        responses[0] = Response({
            validator: address(this),
            result: abi.encode(result),
            status: ResponseStatus.Success,
            receipt: 0,
            timestamp: block.timestamp,
            executionCost: 0
        });
        Request memory req;
        IComplianceCallback(callbackAddressOf[requestId]).handleResolution(
            requestId,
            responses,
            ResponseStatus.Success,
            req
        );
    }

    /// @notice Delivers a failed/empty response set (no validator output).
    function deliverFailure(uint256 requestId) external {
        Response[] memory responses = new Response[](0);
        Request memory req;
        IComplianceCallback(callbackAddressOf[requestId]).handleResolution(
            requestId,
            responses,
            ResponseStatus.Failed,
            req
        );
    }
}
