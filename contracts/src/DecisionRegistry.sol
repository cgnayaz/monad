// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {
    Agent,
    Answer,
    Choice,
    DecConstants,
    Decision,
    DecisionConfig,
    SettlementLine,
    SettlementResult,
    Status,
    Submission
} from "./lib/DecTypes.sol";
import {IDecisionRegistry} from "./interfaces/IDecMarkt.sol";

/// @title DecisionRegistry
/// @notice Agent identities, bonds, the reward pool, decision records, the lifecycle state
///         machine and agent submissions. It does not aggregate, execute or read prices.
/// @dev Every status transition is made by the one contract (role) that owns it:
///      PROPOSER creates/opens/cancels, ENGINE aggregates/approves, VAULT executes,
///      OUTCOME resolves and settles. See CONTRACT_SPEC.md §3.
contract DecisionRegistry is IDecisionRegistry, AccessControl, Pausable, ReentrancyGuard {
    bytes32 public constant PROPOSER_ROLE = keccak256("PROPOSER_ROLE");
    bytes32 public constant ENGINE_ROLE = keccak256("ENGINE_ROLE");
    bytes32 public constant VAULT_ROLE = keccak256("VAULT_ROLE");
    bytes32 public constant OUTCOME_ROLE = keccak256("OUTCOME_ROLE");

    uint64 public constant MAX_SUBMISSION_WINDOW = 1 hours;
    uint64 public constant MAX_HORIZON = 7 days;
    uint16 public constant MAX_BAND_BPS = 1_000;
    uint16 public constant MIN_THRESHOLD_BPS = 5_001;
    uint8 public constant MIN_QUORUM = 3;
    /// @dev Bounds how much of an agent's bond a single decision can put at risk.
    uint256 public constant MAX_LOCK_PER_AGENT = 1 ether;

    // ─── Errors ────────────────────────────────────────────────────────────
    error InvalidTransition(Status from, Status to);
    error UnknownDecision(uint256 id);
    error UnknownAgent(uint16 agentId);
    error NotAgentOperator(uint16 agentId, address caller);
    error NotParticipant(uint256 id, uint16 agentId);
    error DeadlinePassed(uint256 id, uint64 deadline);
    error AlreadySubmitted(uint256 id, uint16 agentId, uint8 questionId);
    error InvalidQuestion(uint8 questionId, uint8 questionCount);
    error InvalidChoice(uint8 choice);
    error ChoiceNotAllowed(Choice choice);
    error InvalidScore(uint16 score);
    error InvalidProbability(uint16 probability);
    error InvalidHash();
    error InvalidConfig(string field);
    error DuplicateState(bytes32 stateHash);
    error QuorumUnavailable(uint256 eligible, uint8 quorum);
    error InsufficientBond(uint16 agentId, uint256 available, uint256 required);
    error ZeroAmount();
    error ZeroAddress();
    error OperatorInUse(address operator);
    error TooManyAgents();
    error InvalidSettlement(string reason);
    error TransferFailed();
    error Unauthorized();

    // ─── Events ────────────────────────────────────────────────────────────
    event AgentRegistered(uint16 indexed agentId, address indexed operator, bytes32 nameHash, string metadataURI);
    event AgentActiveSet(uint16 indexed agentId, bool active);
    event BondChanged(uint16 indexed agentId, int256 delta, uint256 bond, uint256 locked);
    event RewardPoolChanged(int256 delta, uint256 balance);
    event RoundRewardSet(uint256 amount);
    event DecisionCreated(uint256 indexed id, bytes32 stateHash, bytes32 questionSetHash, address indexed proposer, DecisionConfig config);
    event DecisionOpened(uint256 indexed id, uint16[] participants, uint64 deadline, uint256 roundReward);
    event StatusChanged(uint256 indexed id, Status from, Status to);
    event Submitted(
        uint256 indexed id,
        uint16 indexed agentId,
        uint8 indexed questionId,
        Choice choice,
        uint16 score,
        uint16 probability,
        uint256 bond,
        bytes32 reasonHash
    );
    event Settled(uint256 indexed id, uint16 indexed agentId, SettlementResult result, uint256 penalty, uint256 reward);

    // ─── Storage ───────────────────────────────────────────────────────────
    uint16 public agentCount;
    mapping(uint16 => Agent) private _agents;
    mapping(address => uint16) private _agentIdPlusOne; // operator → agentId + 1

    uint256 public decisionCount;
    mapping(uint256 => Decision) private _decisions;
    mapping(bytes32 => bool) public stateHashUsed;
    mapping(uint256 => mapping(uint16 => bool)) public isParticipant;
    mapping(uint256 => mapping(uint16 => mapping(uint8 => Submission))) private _submissions;
    mapping(uint256 => mapping(uint16 => uint8)) public answerCount;
    mapping(uint256 => uint8) public finalSubmissionCount;

    uint256 public rewardPool;
    uint256 public roundReward;
    /// @notice Round rewards reserved for decisions that are open but not yet settled.
    uint256 public reservedRewards;

    constructor(address admin) {
        if (admin == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    // ═══ Agents and bonds ═════════════════════════════════════════════════

    function registerAgent(address operator, bytes32 nameHash, string calldata metadataURI)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
        returns (uint16 agentId)
    {
        if (operator == address(0)) revert ZeroAddress();
        if (_agentIdPlusOne[operator] != 0) revert OperatorInUse(operator);
        if (agentCount >= DecConstants.MAX_AGENTS) revert TooManyAgents();
        agentId = agentCount++;
        Agent storage a = _agents[agentId];
        a.operator = operator;
        a.nameHash = nameHash;
        a.metadataURI = metadataURI;
        a.active = true;
        _agentIdPlusOne[operator] = agentId + 1;
        emit AgentRegistered(agentId, operator, nameHash, metadataURI);
    }

    function setAgentActive(uint16 agentId, bool active) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _agent(agentId).active = active;
        emit AgentActiveSet(agentId, active);
    }

    /// @notice Anyone may add bond to an existing agent.
    function depositBond(uint16 agentId) external payable {
        if (msg.value == 0) revert ZeroAmount();
        Agent storage a = _agent(agentId);
        a.bond += msg.value;
        emit BondChanged(agentId, int256(msg.value), a.bond, a.locked);
    }

    /// @notice The agent's operator withdraws free (unlocked) bond.
    function withdrawBond(uint16 agentId, uint256 amount) external nonReentrant {
        Agent storage a = _agent(agentId);
        if (msg.sender != a.operator) revert NotAgentOperator(agentId, msg.sender);
        if (amount == 0) revert ZeroAmount();
        if (amount > a.bond) revert InsufficientBond(agentId, a.bond, amount);
        a.bond -= amount; // effects before the interaction
        emit BondChanged(agentId, -int256(amount), a.bond, a.locked);
        (bool ok,) = payable(a.operator).call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    function fundRewardPool() external payable {
        if (msg.value == 0) revert ZeroAmount();
        rewardPool += msg.value;
        emit RewardPoolChanged(int256(msg.value), rewardPool);
    }

    /// @notice Recover unreserved reward-pool funds, only while paused (e.g. to migrate a
    ///         deployment). Reserved round rewards and agent bonds are never touched.
    function withdrawRewardPool(address payable to, uint256 amount) external nonReentrant onlyRole(DEFAULT_ADMIN_ROLE) whenPaused {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (amount > rewardPool) revert InvalidSettlement("reward pool");
        rewardPool -= amount;
        emit RewardPoolChanged(-int256(amount), rewardPool);
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    function setRoundReward(uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        roundReward = amount;
        emit RoundRewardSet(amount);
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    // ═══ Decisions ════════════════════════════════════════════════════════

    /// @notice Commit a Jev state and question set. Nothing about agents is decided yet.
    function createDecision(bytes32 stateHash, bytes32 questionSetHash, DecisionConfig calldata cfg)
        external
        onlyRole(PROPOSER_ROLE)
        whenNotPaused
        returns (uint256 id)
    {
        if (stateHash == bytes32(0) || questionSetHash == bytes32(0)) revert InvalidHash();
        if (stateHashUsed[stateHash]) revert DuplicateState(stateHash);
        _validateConfig(cfg);

        stateHashUsed[stateHash] = true;
        id = ++decisionCount;
        Decision storage d = _decisions[id];
        d.id = id;
        d.stateHash = stateHash;
        d.questionSetHash = questionSetHash;
        d.proposer = msg.sender;
        d.config = cfg;
        d.createdAt = uint64(block.timestamp);
        emit DecisionCreated(id, stateHash, questionSetHash, msg.sender, cfg);
        _transition(d, Status.CREATED);
    }

    /// @notice Snapshot participants, lock their bonds, reserve the round reward, open submissions.
    function openDecision(uint256 id) external onlyRole(PROPOSER_ROLE) whenNotPaused {
        Decision storage d = _decision(id);
        _requireStatus(d, Status.CREATED, Status.OPEN);
        uint256 lock = d.config.lockPerAgent;

        uint16[] memory eligible = new uint16[](agentCount);
        uint256 n;
        for (uint16 i = 0; i < agentCount; i++) {
            Agent storage a = _agents[i];
            if (a.active && a.bond >= lock) eligible[n++] = i;
        }
        if (n < d.config.quorum) revert QuorumUnavailable(n, d.config.quorum);

        for (uint256 k = 0; k < n; k++) {
            uint16 agentId = eligible[k];
            Agent storage a = _agents[agentId];
            a.bond -= lock;
            a.locked += lock;
            isParticipant[id][agentId] = true;
            d.participants.push(agentId);
            emit BondChanged(agentId, 0, a.bond, a.locked);
        }

        uint256 reserved = roundReward < rewardPool ? roundReward : rewardPool;
        rewardPool -= reserved;
        reservedRewards += reserved;
        d.roundReward = reserved;
        if (reserved > 0) emit RewardPoolChanged(-int256(reserved), rewardPool);

        d.openedAt = uint64(block.timestamp);
        d.deadline = uint64(block.timestamp) + d.config.submissionWindow;
        emit DecisionOpened(id, d.participants, d.deadline, reserved);
        _transition(d, Status.OPEN);
    }

    /// @notice Submit one answer. The answer to question 0 (ACTION) is the agent's final decision.
    function submit(uint256 id, uint16 agentId, Answer calldata answer) external whenNotPaused {
        (Decision storage d, uint256 bond) = _preSubmit(id, agentId);
        _store(d, agentId, answer, bond);
    }

    /// @notice Submit a Jev batch: several answers of one agent in one transaction.
    function submitBatch(uint256 id, uint16 agentId, Answer[] calldata answers) external whenNotPaused {
        if (answers.length == 0) revert InvalidConfig("answers");
        (Decision storage d, uint256 bond) = _preSubmit(id, agentId);
        for (uint256 i = 0; i < answers.length; i++) {
            _store(d, agentId, answers[i], bond);
        }
    }

    /// @notice Cancel before aggregation. Locks and the reserved reward are returned in full.
    function cancel(uint256 id) external {
        if (!hasRole(PROPOSER_ROLE, msg.sender) && !hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) revert Unauthorized();
        Decision storage d = _decision(id);
        if (d.status != Status.CREATED && d.status != Status.OPEN) revert InvalidTransition(d.status, Status.CANCELLED);
        _releaseAll(d);
        _transition(d, Status.CANCELLED);
    }

    // ═══ Restricted transitions ═══════════════════════════════════════════

    function markAggregated(uint256 id) external onlyRole(ENGINE_ROLE) {
        Decision storage d = _decision(id);
        _requireStatus(d, Status.OPEN, Status.AGGREGATED);
        _transition(d, Status.AGGREGATED);
    }

    function markApproved(uint256 id) external onlyRole(ENGINE_ROLE) {
        Decision storage d = _decision(id);
        _requireStatus(d, Status.AGGREGATED, Status.APPROVED);
        _transition(d, Status.APPROVED);
    }

    function markCancelledNoQuorum(uint256 id) external onlyRole(ENGINE_ROLE) {
        Decision storage d = _decision(id);
        _requireStatus(d, Status.OPEN, Status.CANCELLED);
        _releaseAll(d);
        _transition(d, Status.CANCELLED);
    }

    function markExecuted(uint256 id) external onlyRole(VAULT_ROLE) {
        Decision storage d = _decision(id);
        _requireStatus(d, Status.APPROVED, Status.EXECUTED);
        _transition(d, Status.EXECUTED);
    }

    /// @notice Apply a settlement computed by OutcomeRegistry and resolve the decision.
    /// @dev Verifies coverage and conservation: Σ locks + roundReward is exactly
    ///      redistributed as (lock − penalty + reward) per agent plus `toRewardPool`.
    function settleAndResolve(uint256 id, SettlementLine[] calldata lines, uint256 toRewardPool)
        external
        onlyRole(OUTCOME_ROLE)
    {
        Decision storage d = _decision(id);
        _requireStatus(d, Status.EXECUTED, Status.RESOLVED);
        uint256 n = d.participants.length;
        if (lines.length != n) revert InvalidSettlement("coverage");
        uint256 lock = d.config.lockPerAgent;

        uint256 inflow = d.roundReward;
        uint256 outflow = toRewardPool;
        for (uint256 i = 0; i < n; i++) {
            SettlementLine calldata l = lines[i];
            if (l.agentId != d.participants[i]) revert InvalidSettlement("order");
            if (l.lockReleased != lock || l.penalty > lock) revert InvalidSettlement("lock");
            inflow += l.penalty;
            outflow += l.reward;
        }
        if (inflow != outflow) revert InvalidSettlement("conservation");

        for (uint256 i = 0; i < n; i++) {
            SettlementLine calldata l = lines[i];
            Agent storage a = _agents[l.agentId];
            a.locked -= lock;
            a.bond += lock - l.penalty + l.reward;
            if (l.result == SettlementResult.CORRECT) {
                a.submitted++;
                a.correct++;
            } else if (l.result == SettlementResult.WRONG) {
                a.submitted++;
            } else if (l.result == SettlementResult.MISSED) {
                a.missed++;
            }
            emit BondChanged(l.agentId, int256(l.reward) - int256(l.penalty), a.bond, a.locked);
            emit Settled(id, l.agentId, l.result, l.penalty, l.reward);
        }
        reservedRewards -= d.roundReward;
        if (toRewardPool > 0) {
            rewardPool += toRewardPool;
            emit RewardPoolChanged(int256(toRewardPool), rewardPool);
        }
        _transition(d, Status.RESOLVED);
    }

    // ═══ Views ════════════════════════════════════════════════════════════

    function getDecision(uint256 id) external view returns (Decision memory) {
        return _decisions[id];
    }

    function statusOf(uint256 id) external view returns (Status) {
        return _decisions[id].status;
    }

    function getAgent(uint16 agentId) external view returns (Agent memory) {
        return _agents[agentId];
    }

    function agentIdOf(address operator) external view returns (bool registered, uint16 agentId) {
        uint16 v = _agentIdPlusOne[operator];
        registered = v != 0;
        if (registered) agentId = v - 1;
    }

    function getSubmission(uint256 id, uint16 agentId, uint8 questionId) external view returns (Submission memory) {
        return _submissions[id][agentId][questionId];
    }

    function getFinalSubmission(uint256 id, uint16 agentId) external view returns (bool submitted, Submission memory s) {
        s = _submissions[id][agentId][DecConstants.ACTION_QUESTION];
        submitted = s.submittedAt != 0;
    }

    // ═══ Internals ════════════════════════════════════════════════════════

    function _preSubmit(uint256 id, uint16 agentId) private view returns (Decision storage d, uint256 bond) {
        d = _decision(id);
        if (d.status != Status.OPEN) revert InvalidTransition(d.status, Status.OPEN);
        if (block.timestamp > d.deadline) revert DeadlinePassed(id, d.deadline);
        Agent storage a = _agent(agentId);
        if (msg.sender != a.operator) revert NotAgentOperator(agentId, msg.sender);
        if (!isParticipant[id][agentId]) revert NotParticipant(id, agentId);
        bond = d.config.lockPerAgent;
    }

    function _store(Decision storage d, uint16 agentId, Answer calldata ans, uint256 bond) private {
        uint256 id = d.id;
        if (ans.questionId >= d.config.questionCount) revert InvalidQuestion(ans.questionId, d.config.questionCount);
        if (_submissions[id][agentId][ans.questionId].submittedAt != 0) {
            revert AlreadySubmitted(id, agentId, ans.questionId);
        }
        if (ans.choice >= DecConstants.CHOICE_COUNT) revert InvalidChoice(ans.choice);
        Choice choice = Choice(ans.choice);
        if (d.config.allowedForks & (uint8(1) << ans.choice) == 0) revert ChoiceNotAllowed(choice);
        if (ans.score > DecConstants.SCORE_MAX) revert InvalidScore(ans.score);
        if (ans.probability < DecConstants.PROBABILITY_MIN || ans.probability > DecConstants.PROBABILITY_MAX) {
            revert InvalidProbability(ans.probability);
        }
        if (ans.reasonHash == bytes32(0)) revert InvalidHash();

        _submissions[id][agentId][ans.questionId] = Submission({
            agentId: agentId,
            questionId: ans.questionId,
            choice: choice,
            score: ans.score,
            probability: ans.probability,
            reasonHash: ans.reasonHash,
            bond: bond,
            submittedAt: uint64(block.timestamp)
        });
        answerCount[id][agentId]++;
        if (ans.questionId == DecConstants.ACTION_QUESTION) finalSubmissionCount[id]++;
        emit Submitted(id, agentId, ans.questionId, choice, ans.score, ans.probability, bond, ans.reasonHash);
    }

    function _validateConfig(DecisionConfig calldata c) private pure {
        if (c.submissionWindow == 0 || c.submissionWindow > MAX_SUBMISSION_WINDOW) revert InvalidConfig("submissionWindow");
        if (c.horizon == 0 || c.horizon > MAX_HORIZON) revert InvalidConfig("horizon");
        if (c.bandBps > MAX_BAND_BPS) revert InvalidConfig("bandBps");
        if (c.thresholdBps < MIN_THRESHOLD_BPS || c.thresholdBps > DecConstants.BPS) revert InvalidConfig("thresholdBps");
        if (c.minActionScore > DecConstants.SCORE_MAX) revert InvalidConfig("minActionScore");
        if (c.quorum < MIN_QUORUM || c.quorum > DecConstants.MAX_AGENTS) revert InvalidConfig("quorum");
        if (c.allowedForks == 0 || c.allowedForks & ~DecConstants.ALL_CHOICES_MASK != 0 || c.allowedForks & 1 == 0) {
            revert InvalidConfig("allowedForks");
        }
        if (c.questionCount == 0 || c.questionCount > DecConstants.MAX_QUESTIONS) revert InvalidConfig("questionCount");
        if (c.lockPerAgent == 0 || c.lockPerAgent > MAX_LOCK_PER_AGENT) revert InvalidConfig("lockPerAgent");
    }

    function _releaseAll(Decision storage d) private {
        uint256 lock = d.config.lockPerAgent;
        for (uint256 i = 0; i < d.participants.length; i++) {
            Agent storage a = _agents[d.participants[i]];
            a.locked -= lock;
            a.bond += lock;
            emit BondChanged(d.participants[i], 0, a.bond, a.locked);
        }
        if (d.roundReward > 0) {
            reservedRewards -= d.roundReward;
            rewardPool += d.roundReward;
            emit RewardPoolChanged(int256(d.roundReward), rewardPool);
        }
    }

    function _transition(Decision storage d, Status to) private {
        Status from = d.status;
        d.status = to;
        d.statusBlock[uint8(to)] = uint64(block.number);
        emit StatusChanged(d.id, from, to);
    }

    function _requireStatus(Decision storage d, Status expected, Status to) private view {
        if (d.status != expected) revert InvalidTransition(d.status, to);
    }

    function _decision(uint256 id) private view returns (Decision storage d) {
        d = _decisions[id];
        if (d.status == Status.NONE) revert UnknownDecision(id);
    }

    function _agent(uint16 agentId) private view returns (Agent storage) {
        if (agentId >= agentCount) revert UnknownAgent(agentId);
        return _agents[agentId];
    }
}
