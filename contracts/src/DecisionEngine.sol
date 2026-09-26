// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Agent, Aggregation, Choice, DecConstants, Decision, Status, Submission} from "./lib/DecTypes.sol";
import {IDecisionEngine, IDecisionRegistry} from "./interfaces/IDecMarkt.sol";

/// @title DecisionEngine
/// @notice Deterministic aggregation of Jev decisions (Choice, Score, Probability) into an
///         approved bounded action. Holds no funds.
///
/// @dev Formula (CONTRACT_SPEC.md §5). All integer arithmetic, truncating division:
///
///   For each participant i with a final (question 0) submission, using the agent's
///   on-chain record at the aggregation block:
///       rep_i   = (correct_i + 1) × 10000 / (submitted_i + 2)          // 0..10000
///       w_i     = probability_i × rep_i / 10000
///       support[choice_i] += w_i
///   total   = Σ support
///   leading = argmax support, ties broken NO_ACTION > ESCALATE > ACTION_A > ACTION_B
///   passed  = submissions ≥ quorum
///           ∧ total > 0 ∧ support[leading] × 10000 ≥ thresholdBps × total
///           ∧ (leading ∈ {ACTION_A, ACTION_B} ⇒ Σscore_backers / n_backers ≥ minActionScore)
///   approved = !passed ? NO_ACTION : leading == ESCALATE ? guardian decides : leading
///
///   Every input is emitted (AgentWeighted) so the result can be recomputed off-chain.
contract DecisionEngine is IDecisionEngine, AccessControl, Pausable {
    bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");
    uint64 public constant GUARDIAN_WINDOW = 120;

    IDecisionRegistry public immutable registry;

    error InvalidTransition(Status from, Status to);
    error DeadlineNotReached(uint256 id, uint64 deadline);
    error GuardianNotRequired(uint256 id);
    error GuardianWindowClosed(uint256 id, uint64 deadline);
    error GuardianWindowOpen(uint256 id, uint64 deadline);
    error InvalidChoice(uint8 choice);
    error ChoiceNotAllowed(Choice choice);
    error NotApproved(uint256 id);
    error ZeroAddress();

    event AgentWeighted(
        uint256 indexed id, uint16 indexed agentId, Choice choice, uint16 score, uint16 probability, uint256 reputationBps, uint256 weight
    );
    event Aggregated(
        uint256 indexed id, uint256[4] support, uint256 totalSupport, Choice leading, bool passed, Choice approved, bool guardianRequired
    );
    event QuorumFailed(uint256 indexed id, uint8 submissions, uint8 quorum);
    event GuardianDecided(uint256 indexed id, address indexed guardian, Choice choice);
    event EscalationTimedOut(uint256 indexed id);

    mapping(uint256 => Aggregation) private _aggregations;

    constructor(address admin, IDecisionRegistry registry_) {
        if (admin == address(0) || address(registry_) == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        registry = registry_;
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    /// @notice Aggregate once the submission window has closed, or earlier if every
    ///         participant has submitted its final decision. Callable by anyone.
    function aggregate(uint256 id) external whenNotPaused {
        Decision memory d = registry.getDecision(id);
        if (d.status != Status.OPEN) revert InvalidTransition(d.status, Status.AGGREGATED);
        uint8 finals = registry.finalSubmissionCount(id);
        if (block.timestamp <= d.deadline && finals < d.participants.length) revert DeadlineNotReached(id, d.deadline);

        if (finals < d.config.quorum) {
            emit QuorumFailed(id, finals, d.config.quorum);
            registry.markCancelledNoQuorum(id);
            return;
        }

        Aggregation storage g = _aggregations[id];
        uint256[4] memory scoreSum;
        uint256[4] memory backers;
        for (uint256 i = 0; i < d.participants.length; i++) {
            uint16 agentId = d.participants[i];
            (bool submitted, Submission memory s) = registry.getFinalSubmission(id, agentId);
            if (!submitted) continue;
            Agent memory a = registry.getAgent(agentId);
            // Two-step truncation is part of the published formula (reproducible off-chain).
            uint256 rep = (uint256(a.correct) + 1) * DecConstants.BPS / (uint256(a.submitted) + 2);
            // forge-lint: disable-next-line(divide-before-multiply)
            uint256 w = uint256(s.probability) * rep / DecConstants.BPS;
            uint8 c = uint8(s.choice);
            g.support[c] += w;
            scoreSum[c] += s.score;
            backers[c] += 1;
            emit AgentWeighted(id, agentId, s.choice, s.score, s.probability, rep, w);
        }
        g.submissions = finals;
        g.totalSupport = g.support[0] + g.support[1] + g.support[2] + g.support[3];

        // Tie-break: the first choice in this order keeps the lead on equal support.
        Choice[4] memory order = [Choice.NO_ACTION, Choice.ESCALATE, Choice.ACTION_A, Choice.ACTION_B];
        Choice leading = order[0];
        for (uint256 k = 1; k < 4; k++) {
            if (g.support[uint8(order[k])] > g.support[uint8(leading)]) leading = order[k];
        }
        g.leading = leading;

        bool share = g.totalSupport > 0
            && g.support[uint8(leading)] * DecConstants.BPS >= uint256(d.config.thresholdBps) * g.totalSupport;
        bool scoreGate = true;
        if (leading == Choice.ACTION_A || leading == Choice.ACTION_B) {
            uint8 c = uint8(leading);
            scoreGate = scoreSum[c] / backers[c] >= d.config.minActionScore;
        }
        g.thresholdPassed = share && scoreGate; // quorum already satisfied above

        if (!g.thresholdPassed) {
            g.approved = Choice.NO_ACTION;
        } else if (leading == Choice.ESCALATE) {
            g.guardianRequired = true;
            g.guardianDeadline = uint64(block.timestamp) + GUARDIAN_WINDOW;
        } else {
            g.approved = leading;
        }

        emit Aggregated(id, g.support, g.totalSupport, leading, g.thresholdPassed, g.approved, g.guardianRequired);
        registry.markAggregated(id);
        if (!g.guardianRequired) registry.markApproved(id);
    }

    /// @notice On escalation, a guardian picks an executable choice within the allowed set.
    function guardianDecide(uint256 id, uint8 choice) external onlyRole(GUARDIAN_ROLE) {
        Aggregation storage g = _escalated(id);
        if (block.timestamp > g.guardianDeadline) revert GuardianWindowClosed(id, g.guardianDeadline);
        if (choice >= uint8(Choice.ESCALATE)) revert InvalidChoice(choice);
        Decision memory d = registry.getDecision(id);
        if (d.config.allowedForks & (uint8(1) << choice) == 0) revert ChoiceNotAllowed(Choice(choice));
        g.approved = Choice(choice);
        emit GuardianDecided(id, msg.sender, Choice(choice));
        registry.markApproved(id);
    }

    /// @notice If the guardian does not act in time, anyone finalises the escalation as NO_ACTION.
    function finalizeEscalation(uint256 id) external {
        Aggregation storage g = _escalated(id);
        if (block.timestamp <= g.guardianDeadline) revert GuardianWindowOpen(id, g.guardianDeadline);
        g.approved = Choice.NO_ACTION;
        emit EscalationTimedOut(id);
        registry.markApproved(id);
    }

    function getAggregation(uint256 id) external view returns (Aggregation memory) {
        return _aggregations[id];
    }

    /// @notice The approved action. Reverts unless the decision is APPROVED or later.
    function approvedAction(uint256 id) external view returns (Choice) {
        Status s = registry.statusOf(id);
        if (s != Status.APPROVED && s != Status.EXECUTED && s != Status.RESOLVED) revert NotApproved(id);
        return _aggregations[id].approved;
    }

    function _escalated(uint256 id) private view returns (Aggregation storage g) {
        Status s = registry.statusOf(id);
        if (s != Status.AGGREGATED) revert InvalidTransition(s, Status.APPROVED);
        g = _aggregations[id];
        if (!g.guardianRequired) revert GuardianNotRequired(id);
    }
}
