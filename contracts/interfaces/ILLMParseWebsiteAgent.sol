// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice LLM Parse Website base agent on Somnia Agentic L1.
/// @dev Extracts and normalizes entities from HTML / PDF / legal text. Second
/// stage of the JSON API -> Parse Website -> LLM Inference composition. Returns
/// a normalized, machine-readable entity list the inference agent can reason
/// over.
interface ILLMParseWebsiteAgent {
    /// @notice Parses a web/document source and returns normalized entities.
    /// @param url Source URL (HTML page, PDF, or legal publication).
    /// @param selector CSS/XPath/section selector narrowing the extraction.
    /// @return entities Normalized entities serialized as a string (e.g. JSON).
    function parse(
        string calldata url,
        string calldata selector
    ) external returns (string memory entities);
}
