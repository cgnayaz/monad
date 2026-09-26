// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IPyth} from "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import {PythStructs} from "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";
import {Choice, DecConstants, Execution, Status} from "./lib/DecTypes.sol";
import {IDecisionEngine, IDecisionRegistry, IExecutionVault} from "./interfaces/IDecMarkt.sol";

/// @title ExecutionVault
/// @notice Holds treasury MON in two buckets and executes only the predefined action that
///         DecisionEngine approved. There is no generic call path: no target address, no
///         calldata and no amount can be supplied by a caller or an AI agent.
///
///   NO_ACTION → nothing moves
///   ACTION_A  → move min(active × actionBps / 10000, maxMove) ACTIVE → RESERVE
///   ACTION_B  → move min(reserve × actionBps / 10000, maxMove) RESERVE → ACTIVE
///
/// @dev The only external calls are (1) to the immutable Pyth contract to verify the start
///      price and (2) the admin-only emergency withdrawal while paused.
contract ExecutionVault is IExecutionVault, AccessControl, Pausable, ReentrancyGuard {
    uint16 public constant MAX_ACTION_BPS = 2_500;
    uint64 public constant MAX_PRICE_AGE = 60;

    IDecisionRegistry public immutable registry;
    IDecisionEngine public immutable engine;
    IPyth public immutable pyth;
    bytes32 public immutable priceId;

    uint256 public active;
    uint256 public reserve;
    uint16 public actionBps;
    uint256 public maxMove;
    uint64 public cooldown;
    uint64 public lastExecutedAt;

    mapping(uint256 => Execution) private _executions;

    error InvalidTransition(Status from, Status to);
    error CooldownActive(uint64 until);
    error IncorrectFee(uint256 required, uint256 sent);
    error InvalidPrice();
    error ParamAboveCap();
    error ZeroAmount();
    error ZeroAddress();
    error InsufficientBalance();
    error TransferFailed();
    error DirectTransferNotAllowed();

    event Deposited(address indexed from, uint256 amount, uint256 reserve);
    event ActionParamsSet(uint16 actionBps, uint256 maxMove, uint64 cooldown);
    event Executed(uint256 indexed id, Choice action, uint256 amountMoved, uint256 active, uint256 reserve, int64 startPrice, int32 expo, uint64 startPublishTime);
    event EmergencyWithdrawal(address indexed to, uint256 amount);

    constructor(
        address admin,
        IDecisionRegistry registry_,
        IDecisionEngine engine_,
        IPyth pyth_,
        bytes32 priceId_,
        uint16 actionBps_,
        uint256 maxMove_,
        uint64 cooldown_
    ) {
        if (admin == address(0) || address(registry_) == address(0) || address(engine_) == address(0) || address(pyth_) == address(0)) {
            revert ZeroAddress();
        }
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        registry = registry_;
        engine = engine_;
        pyth = pyth_;
        priceId = priceId_;
        _setActionParams(actionBps_, maxMove_, cooldown_);
    }

    /// @notice Fund the treasury. New funds enter the RESERVE bucket.
    function deposit() external payable {
        if (msg.value == 0) revert ZeroAmount();
        reserve += msg.value;
        emit Deposited(msg.sender, msg.value, reserve);
    }

    /// @notice Fund the ACTIVE bucket directly (initial allocation).
    function depositActive() external payable {
        if (msg.value == 0) revert ZeroAmount();
        active += msg.value;
        emit Deposited(msg.sender, msg.value, reserve);
    }

    receive() external payable {
        revert DirectTransferNotAllowed();
    }

    function setActionParams(uint16 actionBps_, uint256 maxMove_, uint64 cooldown_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _setActionParams(actionBps_, maxMove_, cooldown_);
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    /// @notice Execute the approved action of decision `id`. Callable by anyone; the action is
    ///         fully determined by contract state. `msg.value` must equal the Pyth update fee.
    function execute(uint256 id, bytes[] calldata pythUpdate) external payable nonReentrant whenNotPaused {
        // Checks
        Status s = registry.statusOf(id);
        if (s != Status.APPROVED) revert InvalidTransition(s, Status.EXECUTED);
        if (lastExecutedAt != 0 && block.timestamp < uint256(lastExecutedAt) + cooldown) {
            revert CooldownActive(lastExecutedAt + cooldown);
        }
        uint256 fee = pyth.getUpdateFee(pythUpdate);
        if (msg.value != fee) revert IncorrectFee(fee, msg.value);
        Choice action = engine.approvedAction(id);

        // Verification call to the immutable oracle (no state changed yet; guarded by nonReentrant).
        bytes32[] memory ids = new bytes32[](1);
        ids[0] = priceId;
        uint64 nowTs = uint64(block.timestamp);
        PythStructs.PriceFeed[] memory feeds =
            pyth.parsePriceFeedUpdates{value: fee}(pythUpdate, ids, nowTs - MAX_PRICE_AGE, nowTs);
        PythStructs.Price memory p = feeds[0].price;
        if (p.price <= 0) revert InvalidPrice();

        // Effects
        uint256 amount;
        if (action == Choice.ACTION_A) {
            amount = _min(active * actionBps / DecConstants.BPS, maxMove);
            active -= amount;
            reserve += amount;
        } else if (action == Choice.ACTION_B) {
            amount = _min(reserve * actionBps / DecConstants.BPS, maxMove);
            reserve -= amount;
            active += amount;
        }
        // NO_ACTION: nothing moves. ESCALATE is never approved (the engine resolves it first).

        lastExecutedAt = nowTs;
        _executions[id] = Execution({
            action: action,
            amountMoved: amount,
            activeAfter: active,
            reserveAfter: reserve,
            startPrice: p.price,
            expo: p.expo,
            startPublishTime: uint64(p.publishTime),
            executedAt: nowTs
        });
        emit Executed(id, action, amount, active, reserve, p.price, p.expo, uint64(p.publishTime));
        registry.markExecuted(id);
    }

    /// @notice Emergency exit, only while paused. Takes from RESERVE first, then ACTIVE.
    function emergencyWithdraw(address payable to, uint256 amount) external nonReentrant onlyRole(DEFAULT_ADMIN_ROLE) whenPaused {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (amount > active + reserve) revert InsufficientBalance();
        uint256 fromReserve = _min(amount, reserve);
        reserve -= fromReserve;
        active -= amount - fromReserve;
        emit EmergencyWithdrawal(to, amount);
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    function balances() external view returns (uint256, uint256) {
        return (active, reserve);
    }

    function getExecution(uint256 id) external view returns (Execution memory) {
        return _executions[id];
    }

    function _setActionParams(uint16 actionBps_, uint256 maxMove_, uint64 cooldown_) private {
        if (actionBps_ > MAX_ACTION_BPS) revert ParamAboveCap();
        actionBps = actionBps_;
        maxMove = maxMove_;
        cooldown = cooldown_;
        emit ActionParamsSet(actionBps_, maxMove_, cooldown_);
    }

    function _min(uint256 a, uint256 b) private pure returns (uint256) {
        return a < b ? a : b;
    }
}
