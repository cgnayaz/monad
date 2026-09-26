// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IPyth} from "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import {PythStructs} from "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";
import {
    Choice,
    DecConstants,
    Decision,
    Execution,
    Outcome,
    SettlementLine,
    SettlementResult,
    Status,
    Submission
} from "./lib/DecTypes.sol";
import {IDecisionRegistry, IExecutionVault} from "./interfaces/IDecMarkt.sol";

/// @title OutcomeRegistry
/// @notice Verifies the real outcome of an executed decision from a signed Pyth price,
///         records it, and computes the deterministic settlement of every agent's bond.
///
/// Outcome (JEV_INTEGRATION.md §11):
///   t0           = executedAt + horizon
///   end price    = Pyth update with publishTime ∈ [t0, t0 + RESOLUTION_TOLERANCE]
///   outcomeValue = (end − start) × 10000 / start                         (bps, int)
///   observed     = outcomeValue < −band ? ACTION_A : outcomeValue > band ? ACTION_B : NO_ACTION
///   success      = expectedAction == observed
///
/// Settlement (CONTRACT_SPEC.md §10), lock L, probability p:
///   CORRECT  final choice == observed                   penalty 0,                    reward pool × p / Σp_correct
///   WRONG    final choice ∈ {NO_ACTION, A, B} ≠ observed penalty L × slashBps × p / 1e8, reward 0
///   NEUTRAL  final choice == ESCALATE                   penalty 0,                    reward 0
///   MISSED   no final submission                        penalty L × missPenaltyBps / 1e4
///   pool = Σ penalties + roundReward; undistributed remainder → reward pool.
///   Every lock is released; penalties are deducted from it.
contract OutcomeRegistry is AccessControl, ReentrancyGuard {
    uint64 public constant RESOLUTION_TOLERANCE = 60;
    uint64 public constant VOID_GRACE = 300;
    uint16 public constant MAX_SLASH_BPS = 5_000;
    uint16 public constant MAX_MISS_PENALTY_BPS = 2_000;

    IDecisionRegistry public immutable registry;
    IExecutionVault public immutable vault;
    IPyth public immutable pyth;
    bytes32 public immutable priceId;

    uint16 public slashBps;
    uint16 public missPenaltyBps;

    mapping(uint256 => Outcome) private _outcomes;
    mapping(uint256 => mapping(uint16 => SettlementLine)) private _lines;

    error InvalidTransition(Status from, Status to);
    error HorizonNotReached(uint64 t0);
    error GraceNotElapsed(uint64 voidableAt);
    error IncorrectFee(uint256 required, uint256 sent);
    error InvalidPrice();
    error ExpoMismatch(int32 start, int32 end);
    error ParamAboveCap();
    error ZeroAddress();

    event PenaltyParamsSet(uint16 slashBps, uint16 missPenaltyBps);
    event OutcomeRecorded(
        uint256 indexed id, Choice expectedAction, Choice observedResult, bool success, int256 outcomeValue, int64 endPrice, uint64 endPublishTime
    );
    event OutcomeVoided(uint256 indexed id);

    constructor(
        address admin,
        IDecisionRegistry registry_,
        IExecutionVault vault_,
        IPyth pyth_,
        bytes32 priceId_,
        uint16 slashBps_,
        uint16 missPenaltyBps_
    ) {
        if (admin == address(0) || address(registry_) == address(0) || address(vault_) == address(0) || address(pyth_) == address(0)) {
            revert ZeroAddress();
        }
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        registry = registry_;
        vault = vault_;
        pyth = pyth_;
        priceId = priceId_;
        _setPenaltyParams(slashBps_, missPenaltyBps_);
    }

    function setPenaltyParams(uint16 slashBps_, uint16 missPenaltyBps_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _setPenaltyParams(slashBps_, missPenaltyBps_);
    }

    /// @notice Verify the outcome with a Pyth update published inside the resolution window,
    ///         then settle every participant. Callable by anyone; msg.value must equal the fee.
    function resolve(uint256 id, bytes[] calldata pythUpdate) external payable nonReentrant {
        Decision memory d = registry.getDecision(id);
        if (d.status != Status.EXECUTED) revert InvalidTransition(d.status, Status.RESOLVED);
        Execution memory e = vault.getExecution(id);
        uint64 t0 = e.executedAt + d.config.horizon;
        if (block.timestamp < t0) revert HorizonNotReached(t0);
        uint256 fee = pyth.getUpdateFee(pythUpdate);
        if (msg.value != fee) revert IncorrectFee(fee, msg.value);

        bytes32[] memory ids = new bytes32[](1);
        ids[0] = priceId;
        PythStructs.PriceFeed[] memory feeds = pyth.parsePriceFeedUpdates{value: fee}(pythUpdate, ids, t0, t0 + RESOLUTION_TOLERANCE);
        PythStructs.Price memory p = feeds[0].price;
        if (p.price <= 0) revert InvalidPrice();
        if (p.expo != e.expo) revert ExpoMismatch(e.expo, p.expo);

        int256 value = (int256(p.price) - int256(e.startPrice)) * int256(DecConstants.BPS) / int256(e.startPrice);
        Choice observed = observedChoice(value, d.config.bandBps);

        _outcomes[id] = Outcome({
            expectedAction: e.action,
            observedResult: observed,
            success: e.action == observed,
            outcomeValue: value,
            startPrice: e.startPrice,
            endPrice: p.price,
            expo: p.expo,
            endPublishTime: uint64(p.publishTime),
            isVoid: false,
            resolvedAt: uint64(block.timestamp)
        });
        emit OutcomeRecorded(id, e.action, observed, e.action == observed, value, p.price, uint64(p.publishTime));

        (SettlementLine[] memory lines, uint256 toPool) = _computeSettlement(d, observed);
        _store(id, lines);
        registry.settleAndResolve(id, lines, toPool);
    }

    /// @notice If no valid update was submitted in time, anyone voids the outcome:
    ///         every lock is returned, no rewards or penalties.
    function voidOutcome(uint256 id) external nonReentrant {
        Decision memory d = registry.getDecision(id);
        if (d.status != Status.EXECUTED) revert InvalidTransition(d.status, Status.RESOLVED);
        Execution memory e = vault.getExecution(id);
        uint64 voidableAt = e.executedAt + d.config.horizon + RESOLUTION_TOLERANCE + VOID_GRACE;
        if (block.timestamp <= voidableAt) revert GraceNotElapsed(voidableAt);

        Outcome storage o = _outcomes[id];
        o.expectedAction = e.action;
        o.startPrice = e.startPrice;
        o.expo = e.expo;
        o.isVoid = true;
        o.resolvedAt = uint64(block.timestamp);
        emit OutcomeVoided(id);

        uint256 n = d.participants.length;
        SettlementLine[] memory lines = new SettlementLine[](n);
        for (uint256 i = 0; i < n; i++) {
            lines[i] = SettlementLine({
                agentId: d.participants[i],
                result: SettlementResult.NEUTRAL,
                lockReleased: d.config.lockPerAgent,
                penalty: 0,
                reward: 0
            });
        }
        _store(id, lines);
        registry.settleAndResolve(id, lines, d.roundReward);
    }

    // ─── Views ─────────────────────────────────────────────────────────────

    function getOutcome(uint256 id) external view returns (Outcome memory) {
        return _outcomes[id];
    }

    function getSettlement(uint256 id, uint16 agentId) external view returns (SettlementLine memory) {
        return _lines[id][agentId];
    }

    /// @notice The settlement that `observed` would produce for decision `id`, computed with
    ///         exactly the same code path as `resolve`.
    function previewSettlement(uint256 id, Choice observed)
        external
        view
        returns (SettlementLine[] memory lines, uint256 toRewardPool)
    {
        return _computeSettlement(registry.getDecision(id), observed);
    }

    function observedChoice(int256 outcomeValue, uint16 bandBps) public pure returns (Choice) {
        int256 band = int256(uint256(bandBps));
        if (outcomeValue < -band) return Choice.ACTION_A;
        if (outcomeValue > band) return Choice.ACTION_B;
        return Choice.NO_ACTION;
    }

    // ─── Internals ─────────────────────────────────────────────────────────

    function _computeSettlement(Decision memory d, Choice observed)
        private
        view
        returns (SettlementLine[] memory lines, uint256 toRewardPool)
    {
        uint256 n = d.participants.length;
        uint256 lock = d.config.lockPerAgent;
        lines = new SettlementLine[](n);
        uint256[] memory prob = new uint256[](n);
        uint256 pool = d.roundReward;
        uint256 sumCorrectP;

        for (uint256 i = 0; i < n; i++) {
            uint16 agentId = d.participants[i];
            (bool submitted, Submission memory s) = registry.getFinalSubmission(d.id, agentId);
            SettlementLine memory l = lines[i];
            l.agentId = agentId;
            l.lockReleased = lock;
            if (!submitted) {
                l.result = SettlementResult.MISSED;
                l.penalty = lock * missPenaltyBps / DecConstants.BPS;
            } else if (s.choice == Choice.ESCALATE) {
                l.result = SettlementResult.NEUTRAL;
            } else if (s.choice == observed) {
                l.result = SettlementResult.CORRECT;
                prob[i] = s.probability;
                sumCorrectP += s.probability;
            } else {
                l.result = SettlementResult.WRONG;
                l.penalty = lock * slashBps * s.probability / (DecConstants.BPS * DecConstants.BPS);
            }
            pool += l.penalty;
        }

        uint256 distributed;
        if (sumCorrectP > 0) {
            for (uint256 i = 0; i < n; i++) {
                if (prob[i] == 0) continue;
                lines[i].reward = pool * prob[i] / sumCorrectP;
                distributed += lines[i].reward;
            }
        }
        toRewardPool = pool - distributed;
    }

    function _store(uint256 id, SettlementLine[] memory lines) private {
        for (uint256 i = 0; i < lines.length; i++) {
            _lines[id][lines[i].agentId] = lines[i];
        }
    }

    function _setPenaltyParams(uint16 slashBps_, uint16 missPenaltyBps_) private {
        if (slashBps_ > MAX_SLASH_BPS || missPenaltyBps_ > MAX_MISS_PENALTY_BPS) revert ParamAboveCap();
        slashBps = slashBps_;
        missPenaltyBps = missPenaltyBps_;
        emit PenaltyParamsSet(slashBps_, missPenaltyBps_);
    }
}
