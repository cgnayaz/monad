// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Agent, Aggregation, Choice, Decision, Execution, SettlementLine, Status, Submission} from "../lib/DecTypes.sol";

interface IDecisionRegistry {
    function getDecision(uint256 id) external view returns (Decision memory);
    function getAgent(uint16 agentId) external view returns (Agent memory);
    function getFinalSubmission(uint256 id, uint16 agentId) external view returns (bool submitted, Submission memory);
    function finalSubmissionCount(uint256 id) external view returns (uint8);
    function statusOf(uint256 id) external view returns (Status);

    function markAggregated(uint256 id) external;
    function markApproved(uint256 id) external;
    function markCancelledNoQuorum(uint256 id) external;
    function markExecuted(uint256 id) external;
    function settleAndResolve(uint256 id, SettlementLine[] calldata lines, uint256 toRewardPool) external;
}

interface IDecisionEngine {
    function approvedAction(uint256 id) external view returns (Choice);
    function getAggregation(uint256 id) external view returns (Aggregation memory);
}

interface IExecutionVault {
    function getExecution(uint256 id) external view returns (Execution memory);
}
