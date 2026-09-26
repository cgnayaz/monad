// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title DecMarkt shared types
/// @notice Enums and structs shared by the four DecMarkt contracts. Numeric order of the
///         enums is part of the encoding used by the off-chain Jev layer and must not change.

/// @dev Decision lifecycle. NONE marks an unused id.
enum Status {
    NONE,
    CREATED,
    OPEN,
    AGGREGATED,
    APPROVED,
    EXECUTED,
    RESOLVED,
    CANCELLED
}

/// @dev Bounded choices (Jev bounded forks). ACTION_A = de-risk (ACTIVE → RESERVE),
///      ACTION_B = deploy (RESERVE → ACTIVE). Agents submit a uint8 that is validated
///      against this set before it is ever cast to the enum.
enum Choice {
    NO_ACTION,
    ACTION_A,
    ACTION_B,
    ESCALATE
}

/// @dev Settlement result per participant.
enum SettlementResult {
    CORRECT,
    WRONG,
    NEUTRAL,
    MISSED
}

struct DecisionConfig {
    uint64 submissionWindow; // seconds after OPEN during which agents may submit
    uint64 horizon; // seconds after EXECUTED at which the outcome is measured
    uint16 bandBps; // |move| <= band ⇒ NO_ACTION was correct
    uint16 thresholdBps; // winning share of weighted support required
    uint16 minActionScore; // minimum average score of backers for ACTION_A / ACTION_B
    uint8 quorum; // minimum number of final submissions
    uint8 allowedForks; // bitmask over Choice; must include NO_ACTION
    uint8 questionCount; // number of questions in the committed question set
    uint256 lockPerAgent; // bond locked per participant (wei)
}

struct Decision {
    uint256 id;
    bytes32 stateHash;
    bytes32 questionSetHash;
    address proposer;
    Status status;
    DecisionConfig config;
    uint64 createdAt;
    uint64 openedAt;
    uint64 deadline;
    uint16[] participants;
    uint256 roundReward;
    uint64[8] statusBlock; // block number at which each Status was reached
}

struct Agent {
    address operator;
    bytes32 nameHash;
    string metadataURI;
    bool active;
    uint256 bond; // free bond
    uint256 locked; // bond locked in open decisions
    uint32 submitted; // resolved CORRECT + WRONG
    uint32 correct;
    uint32 missed;
}

/// @dev One agent's answer to one question, as submitted.
struct Answer {
    uint8 questionId; // index in the committed question set; 0 = ACTION question
    uint8 choice; // validated against Choice and the decision's allowedForks
    uint16 score; // 0..10000
    uint16 probability; // 100..9900 bps
    bytes32 reasonHash; // keccak256 of the reason text published off-chain
}

/// @dev A stored submission: the answer plus who submitted it and what bond backs it.
struct Submission {
    uint16 agentId;
    uint8 questionId;
    Choice choice;
    uint16 score;
    uint16 probability;
    bytes32 reasonHash;
    uint256 bond;
    uint64 submittedAt;
}

struct Aggregation {
    uint256[4] support; // weighted support per Choice
    uint256 totalSupport;
    Choice leading;
    bool thresholdPassed;
    Choice approved; // meaningful once APPROVED
    bool guardianRequired;
    uint64 guardianDeadline;
    uint8 submissions; // final (ACTION-question) submissions counted
}

struct Execution {
    Choice action;
    uint256 amountMoved;
    uint256 activeAfter;
    uint256 reserveAfter;
    int64 startPrice;
    int32 expo;
    uint64 startPublishTime;
    uint64 executedAt;
}

struct Outcome {
    Choice expectedAction; // the executed action
    Choice observedResult; // the action the observed move made correct
    bool success; // expectedAction == observedResult
    int256 outcomeValue; // observed move in bps (end − start) × 10000 / start
    int64 startPrice;
    int64 endPrice;
    int32 expo;
    uint64 endPublishTime;
    bool isVoid; // no valid oracle update inside the window
    uint64 resolvedAt;
}

struct SettlementLine {
    uint16 agentId;
    SettlementResult result;
    uint256 lockReleased;
    uint256 penalty;
    uint256 reward;
}

library DecConstants {
    uint256 internal constant BPS = 10_000;
    uint16 internal constant SCORE_MAX = 10_000;
    uint16 internal constant PROBABILITY_MIN = 100;
    uint16 internal constant PROBABILITY_MAX = 9_900;
    uint8 internal constant ACTION_QUESTION = 0;
    uint8 internal constant CHOICE_COUNT = 4;
    uint8 internal constant ALL_CHOICES_MASK = 0x0F;
    uint256 internal constant MAX_AGENTS = 16;
    uint8 internal constant MAX_QUESTIONS = 16;
}
