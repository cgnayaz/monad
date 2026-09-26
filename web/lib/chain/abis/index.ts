import { parseAbi } from "viem";

/**
 * Contract interfaces as specified in CONTRACT_SPEC.md. Enum values are encoded as uint8:
 * Status and Fork follow the order in lib/types/protocol.ts.
 *
 * When contracts/ is built, these are regenerated from forge artifacts
 * (web/scripts/sync-abis.mjs) and must stay signature-compatible.
 */

const STRUCTS = [
  "struct DecisionConfig { uint64 submissionWindow; uint64 horizon; uint16 bandBps; uint16 thresholdBps; uint16 minActionScore; uint8 quorum; uint8 allowedForks; uint256 lockPerAgent; }",
  "struct Decision { uint256 id; bytes32 stateHash; bytes32 questionsHash; address proposer; uint8 status; DecisionConfig config; uint64 createdAt; uint64 openedAt; uint64 deadline; uint16[] participants; uint256 roundReward; uint64[8] statusBlock; }",
  "struct Submission { uint8 choice; uint16 score; uint16 probability; bytes32 reasonHash; bytes32 answersRoot; uint64 submittedAt; }",
  "struct Agent { address operator; bytes32 nameHash; string metadataURI; bool active; uint256 bond; uint256 locked; uint32 submitted; uint32 correct; uint32 missed; }",
  "struct Aggregation { uint256[4] support; uint256 totalSupport; uint8 leading; bool thresholdPassed; uint8 approved; bool guardianRequired; uint64 guardianDeadline; uint8 submissions; }",
  "struct Execution { uint8 action; uint256 amountMoved; uint256 activeAfter; uint256 reserveAfter; int64 startPrice; int32 expo; uint64 startPublishTime; uint64 executedAt; }",
  "struct Outcome { int64 endPrice; uint64 endPublishTime; int256 moveBps; uint8 correctFork; uint64 resolvedAt; }",
  "struct SettlementLine { uint8 result; uint256 lockReleased; uint256 penalty; uint256 reward; }",
] as const;

export const decisionRegistryAbi = parseAbi([
  ...STRUCTS,
  "function decisionCount() view returns (uint256)",
  "function agentCount() view returns (uint16)",
  "function getDecision(uint256 id) view returns (Decision)",
  "function getSubmission(uint256 id, uint16 agentId) view returns (Submission)",
  "function getAgent(uint16 agentId) view returns (Agent)",
  "function rewardPool() view returns (uint256)",
  "function verifyAnswer(uint256 id, uint16 agentId, bytes32[] proof, bytes32 leaf) view returns (bool)",
  "function createDecision(bytes32 stateHash, bytes32 questionsHash, DecisionConfig cfg) returns (uint256)",
  "function openDecision(uint256 id)",
  "function submit(uint256 id, uint16 agentId, uint8 choice, uint16 score, uint16 probability, bytes32 reasonHash, bytes32 answersRoot)",
  "function cancel(uint256 id)",
  "event DecisionCreated(uint256 indexed id, bytes32 stateHash, bytes32 questionsHash, address proposer)",
  "event StatusChanged(uint256 indexed id, uint8 from, uint8 to)",
  "event DecisionOpened(uint256 indexed id, uint16[] participants, uint64 deadline, uint256 roundReward)",
  "event Submitted(uint256 indexed id, uint16 indexed agentId, uint8 choice, uint16 score, uint16 probability, bytes32 reasonHash, bytes32 answersRoot)",
  "event AgentRegistered(uint16 indexed agentId, address indexed operator, bytes32 nameHash)",
  "event BondChanged(uint16 indexed agentId, int256 delta, uint256 bond, uint256 locked)",
]);

export const decisionEngineAbi = parseAbi([
  ...STRUCTS,
  "function getAggregation(uint256 id) view returns (Aggregation)",
  "function aggregate(uint256 id)",
  "function guardianDecide(uint256 id, uint8 fork)",
  "function finalizeEscalation(uint256 id)",
  "event Aggregated(uint256 indexed id, uint256[4] support, uint8 leading, bool passed, uint8 approved, bool guardianRequired)",
  "event GuardianDecided(uint256 indexed id, address guardian, uint8 fork)",
]);

export const executionVaultAbi = parseAbi([
  ...STRUCTS,
  "function balances() view returns (uint256 active, uint256 reserve)",
  "function getExecution(uint256 id) view returns (Execution)",
  "function execute(uint256 id, bytes[] pythUpdate) payable",
  "event Executed(uint256 indexed id, uint8 action, uint256 amountMoved, int64 startPrice, uint64 startPublishTime)",
]);

export const outcomeRegistryAbi = parseAbi([
  ...STRUCTS,
  "function getOutcome(uint256 id) view returns (Outcome)",
  "function getSettlement(uint256 id, uint16 agentId) view returns (SettlementLine)",
  "function resolve(uint256 id, bytes[] pythUpdate) payable",
  "event Resolved(uint256 indexed id, int64 endPrice, int256 moveBps, uint8 correctFork)",
  "event Settled(uint256 indexed id, uint16 indexed agentId, uint8 result, uint256 penalty, uint256 reward)",
]);

export const pythAbi = parseAbi([
  "function version() pure returns (string)",
  "function getValidTimePeriod() view returns (uint256)",
]);
