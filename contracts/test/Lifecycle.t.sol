// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "./Base.t.sol";
import {DecisionRegistry} from "../src/DecisionRegistry.sol";
import {DecisionEngine} from "../src/DecisionEngine.sol";
import {ExecutionVault} from "../src/ExecutionVault.sol";
import {OutcomeRegistry} from "../src/OutcomeRegistry.sol";
import {
    Agent,
    Aggregation,
    Choice,
    Decision,
    DecisionConfig,
    Execution,
    Outcome,
    SettlementLine,
    SettlementResult,
    Status,
    Submission
} from "../src/lib/DecTypes.sol";

contract LifecycleTest is Base {
    function test_ValidLifecycle_ActionA_Correct() public {
        uint256 id = _create(_cfg());
        assertEq(uint8(_status(id)), uint8(Status.CREATED));
        Decision memory d = registry.getDecision(id);
        assertEq(d.createdAt, T0);
        assertEq(d.config.thresholdBps, 6_000);
        assertGt(d.statusBlock[uint8(Status.CREATED)], 0);

        vm.prank(proposer);
        registry.openDecision(id);
        d = registry.getDecision(id);
        assertEq(uint8(d.status), uint8(Status.OPEN));
        assertEq(d.participants.length, 5);
        assertEq(d.deadline, T0 + 180);
        assertEq(d.roundReward, ROUND_REWARD);
        assertEq(registry.getAgent(0).locked, LOCK);
        assertEq(registry.getAgent(0).bond, BOND - LOCK);

        // Four agents choose ACTION_A, one chooses NO_ACTION. Everyone submitted → aggregate early.
        _submitAll(id, [Choice.ACTION_A, Choice.ACTION_A, Choice.ACTION_A, Choice.ACTION_A, Choice.NO_ACTION], 8_000, 7_000);
        Submission memory s = registry.getSubmission(id, 2, 3);
        assertEq(s.agentId, 2);
        assertEq(s.questionId, 3);
        assertEq(uint8(s.choice), uint8(Choice.ACTION_A));
        assertEq(s.bond, LOCK);
        assertEq(registry.answerCount(id, 2), 2);
        assertEq(registry.finalSubmissionCount(id), 5);

        vm.prank(keeper);
        engine.aggregate(id);
        assertEq(uint8(_status(id)), uint8(Status.APPROVED));
        Aggregation memory g = engine.getAggregation(id);
        // rep = (0+1)·1e4/(0+2) = 5000; w = 7000·5000/1e4 = 3500
        assertEq(g.support[uint8(Choice.ACTION_A)], 14_000);
        assertEq(g.support[uint8(Choice.NO_ACTION)], 3_500);
        assertEq(g.totalSupport, 17_500);
        assertTrue(g.thresholdPassed);
        assertEq(uint8(g.approved), uint8(Choice.ACTION_A));

        _execute(id);
        assertEq(uint8(_status(id)), uint8(Status.EXECUTED));
        Execution memory e = vault.getExecution(id);
        assertEq(e.amountMoved, 0.2 ether); // min(2 ether × 10 %, 0.5 ether)
        (uint256 active, uint256 reserve) = vault.balances();
        assertEq(active, 1.8 ether);
        assertEq(reserve, 2.2 ether);

        _resolve(id, 99_000_000); // −1 %
        assertEq(uint8(_status(id)), uint8(Status.RESOLVED));
        Outcome memory o = outcome.getOutcome(id);
        assertEq(uint8(o.expectedAction), uint8(Choice.ACTION_A));
        assertEq(uint8(o.observedResult), uint8(Choice.ACTION_A));
        assertTrue(o.success);
        assertEq(o.outcomeValue, -100);
        assertFalse(o.isVoid);

        // WRONG: 0.05 × 3000 × 7000 / 1e8 = 0.0105 ; pool = 0.0105 + 0.02 = 0.0305 ; 4 × 0.007625
        SettlementLine memory wrong = outcome.getSettlement(id, 4);
        assertEq(uint8(wrong.result), uint8(SettlementResult.WRONG));
        assertEq(wrong.penalty, 0.0105 ether);
        SettlementLine memory right = outcome.getSettlement(id, 0);
        assertEq(uint8(right.result), uint8(SettlementResult.CORRECT));
        assertEq(right.reward, 0.007625 ether);

        Agent memory a0 = registry.getAgent(0);
        assertEq(a0.bond, BOND + 0.007625 ether);
        assertEq(a0.locked, 0);
        assertEq(a0.submitted, 1);
        assertEq(a0.correct, 1);
        Agent memory a4 = registry.getAgent(4);
        assertEq(a4.bond, BOND - 0.0105 ether);
        assertEq(a4.correct, 0);
        assertEq(a4.submitted, 1);
        assertEq(registry.rewardPool(), POOL - ROUND_REWARD);
        assertEq(registry.reservedRewards(), 0);
        _assertRegistrySolvent();

        d = registry.getDecision(id);
        for (uint8 st = uint8(Status.CREATED); st <= uint8(Status.RESOLVED); st++) assertGt(d.statusBlock[st], 0);
    }

    function test_ValidLifecycle_NoActionWithinBand() public {
        uint256 id = _createOpen();
        _submitAll(id, _all(Choice.NO_ACTION), 7_000, 6_000);
        engine.aggregate(id);
        _execute(id);
        (uint256 activeBefore,) = vault.balances();
        assertEq(activeBefore, 2 ether);
        _resolve(id, 100_050_000); // +5 bps, inside ±10
        Outcome memory o = outcome.getOutcome(id);
        assertEq(uint8(o.observedResult), uint8(Choice.NO_ACTION));
        assertTrue(o.success);
        _assertRegistrySolvent();
    }

    function test_SuccessFalse_WhenFailSafeMeetsMove() public {
        uint256 id = _createOpen();
        _submitAll(id, [Choice.ACTION_A, Choice.ACTION_A, Choice.ACTION_B, Choice.ACTION_B, Choice.NO_ACTION], 8_000, 7_000);
        engine.aggregate(id);
        assertEq(uint8(engine.approvedAction(id)), uint8(Choice.NO_ACTION));
        _execute(id);
        _resolve(id, 98_000_000); // −2 %
        Outcome memory o = outcome.getOutcome(id);
        assertEq(uint8(o.expectedAction), uint8(Choice.NO_ACTION));
        assertEq(uint8(o.observedResult), uint8(Choice.ACTION_A));
        assertFalse(o.success);
    }

    function test_Cancel_ReleasesLocksAndReward() public {
        uint256 id = _createOpen();
        vm.prank(proposer);
        registry.cancel(id);
        assertEq(uint8(_status(id)), uint8(Status.CANCELLED));
        assertEq(registry.getAgent(0).bond, BOND);
        assertEq(registry.getAgent(0).locked, 0);
        assertEq(registry.rewardPool(), POOL);
        assertEq(registry.reservedRewards(), 0);
        _assertRegistrySolvent();
    }
}

contract InvalidTransitionTest is Base {
    function test_OpenTwice() public {
        uint256 id = _createOpen();
        vm.prank(proposer);
        vm.expectRevert(abi.encodeWithSelector(DecisionRegistry.InvalidTransition.selector, Status.OPEN, Status.OPEN));
        registry.openDecision(id);
    }

    function test_SubmitBeforeOpen() public {
        uint256 id = _create(_cfg());
        vm.prank(operators[0]);
        vm.expectRevert(abi.encodeWithSelector(DecisionRegistry.InvalidTransition.selector, Status.CREATED, Status.OPEN));
        registry.submit(id, 0, _ans(0, 0, 5_000, 5_000));
    }

    function test_AggregateBeforeOpen() public {
        uint256 id = _create(_cfg());
        vm.expectRevert(abi.encodeWithSelector(DecisionEngine.InvalidTransition.selector, Status.CREATED, Status.AGGREGATED));
        engine.aggregate(id);
    }

    function test_AggregateTwice() public {
        uint256 id = _createOpen();
        _submitAll(id, _all(Choice.NO_ACTION), 7_000, 6_000);
        engine.aggregate(id);
        vm.expectRevert(abi.encodeWithSelector(DecisionEngine.InvalidTransition.selector, Status.APPROVED, Status.AGGREGATED));
        engine.aggregate(id);
    }

    function test_ExecuteBeforeApproval() public {
        uint256 id = _createOpen();
        bytes[] memory u = _update(START_PRICE, block.timestamp);
        vm.expectRevert(abi.encodeWithSelector(ExecutionVault.InvalidTransition.selector, Status.OPEN, Status.EXECUTED));
        vault.execute{value: FEE}(id, u);
    }

    function test_ExecuteTwice() public {
        uint256 id = _createOpen();
        _submitAll(id, _all(Choice.NO_ACTION), 7_000, 6_000);
        engine.aggregate(id);
        _execute(id);
        bytes[] memory u = _update(START_PRICE, block.timestamp);
        vm.expectRevert(abi.encodeWithSelector(ExecutionVault.InvalidTransition.selector, Status.EXECUTED, Status.EXECUTED));
        vault.execute{value: FEE}(id, u);
    }

    function test_ResolveBeforeExecution() public {
        uint256 id = _createOpen();
        bytes[] memory u = _update(START_PRICE, block.timestamp);
        vm.expectRevert(abi.encodeWithSelector(OutcomeRegistry.InvalidTransition.selector, Status.OPEN, Status.RESOLVED));
        outcome.resolve{value: FEE}(id, u);
    }

    function test_CancelAfterApproval() public {
        uint256 id = _createOpen();
        _submitAll(id, _all(Choice.NO_ACTION), 7_000, 6_000);
        engine.aggregate(id);
        vm.prank(proposer);
        vm.expectRevert(abi.encodeWithSelector(DecisionRegistry.InvalidTransition.selector, Status.APPROVED, Status.CANCELLED));
        registry.cancel(id);
    }

    function test_SubmitAfterCancel() public {
        uint256 id = _createOpen();
        vm.prank(proposer);
        registry.cancel(id);
        vm.prank(operators[0]);
        vm.expectRevert(abi.encodeWithSelector(DecisionRegistry.InvalidTransition.selector, Status.CANCELLED, Status.OPEN));
        registry.submit(id, 0, _ans(0, 0, 5_000, 5_000));
    }

    function test_UnknownDecision() public {
        vm.prank(proposer);
        vm.expectRevert(abi.encodeWithSelector(DecisionRegistry.UnknownDecision.selector, 99));
        registry.openDecision(99);
    }

    function test_DuplicateStateHash() public {
        vm.startPrank(proposer);
        registry.createDecision(keccak256("s"), keccak256("q"), _cfg());
        vm.expectRevert(abi.encodeWithSelector(DecisionRegistry.DuplicateState.selector, keccak256("s")));
        registry.createDecision(keccak256("s"), keccak256("q"), _cfg());
        vm.stopPrank();
    }

    function test_InvalidConfig() public {
        vm.startPrank(proposer);
        bytes32 q = keccak256("q");
        _expectConfig("thresholdBps");
        registry.createDecision(keccak256("a"), q, _withThreshold(5_000));
        _expectConfig("allowedForks");
        registry.createDecision(keccak256("b"), q, _withForks(0x06)); // NO_ACTION missing
        _expectConfig("allowedForks");
        registry.createDecision(keccak256("c"), q, _withForks(0x1F)); // unknown bit
        _expectConfig("quorum");
        registry.createDecision(keccak256("d"), q, _withQuorum(2));
        vm.stopPrank();
    }

    function _expectConfig(string memory field) private {
        vm.expectRevert(abi.encodeWithSelector(DecisionRegistry.InvalidConfig.selector, field));
    }

    function _withThreshold(uint16 v) private pure returns (DecisionConfig memory c) {
        c = _cfg();
        c.thresholdBps = v;
    }

    function _withForks(uint8 v) private pure returns (DecisionConfig memory c) {
        c = _cfg();
        c.allowedForks = v;
    }

    function _withQuorum(uint8 v) private pure returns (DecisionConfig memory c) {
        c = _cfg();
        c.quorum = v;
    }
}
