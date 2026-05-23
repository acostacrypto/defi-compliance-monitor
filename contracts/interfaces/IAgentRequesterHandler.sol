// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./IAgentRequester.sol";

/// @notice Callback interface implemented by platform-integrated contracts.
/// @dev The Somnia platform invokes the registered selector with the finalized
/// response set. `ComplianceMonitor.handleResolution` follows this shape.
interface IAgentRequesterHandler {
    /// @notice Called by the platform once a request reaches a terminal state.
    /// @param requestId Platform request ID.
    /// @param responses Per-validator responses collected by the subcommittee.
    /// @param status Global request status.
    /// @param details Full request state for auditing.
    function handleResolution(
        uint256 requestId,
        Response[] memory responses,
        ResponseStatus status,
        Request memory details
    ) external;
}
