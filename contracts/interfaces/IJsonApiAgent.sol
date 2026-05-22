// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice JSON API base agent on Somnia Agentic L1.
/// @dev Fetches a remote JSON document (e.g. an OFAC SDN sanctions feed) and
/// returns the value at `jsonPath`. Used as the first stage of the
/// JSON API -> Parse Website -> LLM Inference composition. The exact platform
/// signature may differ; the orchestration scripts encode this payload and the
/// adapter in `scripts/` documents how to swap in the real ABI.
interface IJsonApiAgent {
    /// @notice Performs an HTTP request and extracts a JSON path.
    /// @param endpoint Fully qualified URL of the JSON source.
    /// @param method HTTP method, e.g. "GET".
    /// @param headers Serialized request headers (JSON string, may be empty).
    /// @param jsonPath JSONPath expression selecting the value to return.
    /// @return result Extracted value serialized as a string.
    function fetchJson(
        string calldata endpoint,
        string calldata method,
        string calldata headers,
        string calldata jsonPath
    ) external returns (string memory result);
}
