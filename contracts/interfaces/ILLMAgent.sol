// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice LLM Inference base agent on Somnia Agentic L1.
/// @dev `createRequest`/`createAdvancedRequest` payloads must be function
/// calldata (selector + ABI-encoded args), not plain `abi.encode` bytes.
/// Determinism is enforced off-chain by the agent config (temperature 0, fixed
/// seed) together with the on-chain fixed `allowedValues` set.
interface ILLMAgent {
    /// @notice Runs inference constrained to the provided allowed values.
    /// @param prompt User prompt describing the compliance question.
    /// @param system System prompt fixing the oracle behaviour.
    /// @param chainOfThought Whether the agent may emit reasoning (kept false
    /// for deterministic single-label output).
    /// @param allowedValues Closed set the response must belong to.
    /// @return response One of `allowedValues`.
    function inferString(
        string calldata prompt,
        string calldata system,
        bool chainOfThought,
        string[] calldata allowedValues
    ) external returns (string memory response);
}
