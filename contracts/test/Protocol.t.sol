// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {PythErrors} from "@pythnetwork/pyth-sdk-solidity/PythErrors.sol";
import {Base} from "./Base.t.sol";
import {DecisionEngine} from "../src/DecisionEngine.sol";
import {ExecutionVault} from "../src/ExecutionVault.sol";
import {OutcomeRegistry} from "../src/OutcomeRegistry.sol";
import {
    Aggregation, Choice, Decision, Execution, Outcome, SettlementLine, SettlementResult, Status
} from "../src/lib/DecTypes.sol";

contract AggregationTest is Base {
    function test_ThresholdSuccess_ExactlyAtThreshold() public {
        uint256 id = _createOpen();
        // 3 × A, 1 × NO_ACTION, 1 × B, equal weights → A has exactly 60 % of support.
        _submitAll(id, [Choice.ACTION_A, Choice.ACTION_A, Choice.ACTION_A, Choice.NO_ACTION, Choice.ACTION_B], 8_000, 7_000);
        engine.aggregate(id);
        Aggregation memory g = engine.getAggregation(id);
        assertEq(g.support[uint8(Choice.ACTION_A)] * 10_000, 6_000 * g.totalSupport);
        assertTrue(g.thresholdPassed);
        assertEq(uint8(g.approved), uint8(Choice.ACTION_A));
    }

    function test_ThresholdFailure_FallsBackToNoAction() public {
        uint256 id = _createOpen();
        _submitAll(id, [Choice.ACTION_A, Choice.ACTION_A, Choice.ACTION_B, Choice.ACTION_B, Choice.NO_ACTION], 8_000, 7_000);
        engine.aggregate(id);
        Aggregation memory g = engine.getAggregation(id);
        assertEq(uint8(g.leading), uint8(Choice.ACTION_A)); // tie A = B: A precedes B in tie-break order
        assertFalse(g.thresholdPassed);
        assertEq(uint8(g.approved), uint8(Choice.NO_ACTION));
        assertEq(uint8(_status(id)), uint8(Status.APPROVED));
    }

    function test_ThresholdFailure_ScoreGate() public {
        uint256 id = _createOpen();
        _submitAll(id, _all(Choice.ACTION_B), 5_499, 9_000);
        engine.aggregate(id);
        Aggregation memory g = engine.getAggregation(id);
        assertEq(uint8(g.leading), uint8(Choice.ACTION_B));
        assertFalse(g.thresholdPassed);
        assertEq(uint8(g.approved), uint8(Choice.NO_ACTION));
    }

    function test_TieBreakPrefersNoAction() public {
        uint256 id = _createOpen();
        _submit(id, 0, Choice.NO_ACTION, 8_000, 7_000);
        _submit(id, 1, Choice.NO_ACTION, 8_000, 7_000);
        _submit(id, 2, Choice.ACTION_B, 8_000, 7_000);
        _submit(id, 3, Choice.ACTION_B, 8_000, 7_000);
        vm.warp(T0 + 181);
        engine.aggregate(id);
        assertEq(uint8(engine.getAggregation(id).leading), uint8(Choice.NO_ACTION));
    }

    function test_ReputationWeightsVotes() public {
        // Round 1: agents 0–3 right (ACTION_A), agent 4 wrong.
        uint256 r1 = _createOpen();
        _submitAll(r1, [Choice.ACTION_A, Choice.ACTION_A, Choice.ACTION_A, Choice.ACTION_A, Choice.NO_ACTION], 8_000, 7_000);
        engine.aggregate(r1);
        _execute(r1);
        _resolve(r1, 99_000_000);

        uint256 r2 = _createOpen();
        _submitAll(r2, _all(Choice.NO_ACTION), 8_000, 7_000);
        engine.aggregate(r2);
        Aggregation memory g = engine.getAggregation(r2);
        // correct agents: rep = 2·1e4/3 = 6666 → w = 4666 ; wrong agent: rep = 1e4/3 = 3333 → w = 2333
        assertEq(g.support[0], 4 * 4_666 + 2_333);
    }

    function test_AggregateBeforeDeadlineWithMissingSubmissions() public {
        uint256 id = _createOpen();
        _submit(id, 0, Choice.NO_ACTION, 8_000, 7_000);
        vm.expectRevert(abi.encodeWithSelector(DecisionEngine.DeadlineNotReached.selector, id, uint64(T0 + 180)));
        engine.aggregate(id);
    }

    function test_QuorumFailureCancels() public {
        uint256 id = _createOpen();
        for (uint16 a = 0; a < 3; a++) _submit(id, a, Choice.ACTION_A, 8_000, 7_000);
        vm.warp(T0 + 181);
        engine.aggregate(id);
        assertEq(uint8(_status(id)), uint8(Status.CANCELLED));
        assertEq(registry.getAgent(0).locked, 0);
        assertEq(registry.rewardPool(), POOL);
        _assertRegistrySolvent();
    }

    function test_EscalationGuardianDecides() public {
        uint256 id = _createOpen();
        _submitAll(id, _all(Choice.ESCALATE), 7_000, 7_000);
        engine.aggregate(id);
        assertEq(uint8(_status(id)), uint8(Status.AGGREGATED));
        Aggregation memory g = engine.getAggregation(id);
        assertTrue(g.guardianRequired);

        vm.startPrank(guardian);
        vm.expectRevert(abi.encodeWithSelector(DecisionEngine.InvalidChoice.selector, 3));
        engine.guardianDecide(id, uint8(Choice.ESCALATE));
        engine.guardianDecide(id, uint8(Choice.ACTION_B));
        vm.stopPrank();
        assertEq(uint8(_status(id)), uint8(Status.APPROVED));
        assertEq(uint8(engine.approvedAction(id)), uint8(Choice.ACTION_B));

        _execute(id);
        _resolve(id, 101_000_000);
        // All agents chose ESCALATE → NEUTRAL; nothing slashed, reward returns to the pool.
        SettlementLine memory l = outcome.getSettlement(id, 0);
        assertEq(uint8(l.result), uint8(SettlementResult.NEUTRAL));
        assertEq(registry.getAgent(0).bond, BOND);
        assertEq(registry.rewardPool(), POOL);
    }

    function test_EscalationTimeout() public {
        uint256 id = _createOpen();
        _submitAll(id, _all(Choice.ESCALATE), 7_000, 7_000);
        engine.aggregate(id);
        uint64 deadline = engine.getAggregation(id).guardianDeadline;
        vm.expectRevert(abi.encodeWithSelector(DecisionEngine.GuardianWindowOpen.selector, id, deadline));
        engine.finalizeEscalation(id);

        vm.warp(deadline + 1);
        vm.prank(guardian);
        vm.expectRevert(abi.encodeWithSelector(DecisionEngine.GuardianWindowClosed.selector, id, deadline));
        engine.guardianDecide(id, uint8(Choice.ACTION_A));

        engine.finalizeEscalation(id);
        assertEq(uint8(engine.approvedAction(id)), uint8(Choice.NO_ACTION));
    }
}

contract ExecutionTest is Base {
    function _approved(Choice c) internal returns (uint256 id) {
        id = _createOpen();
        _submitAll(id, _all(c), 8_000, 7_000);
        engine.aggregate(id);
    }

    function test_ActionB_MovesReserveToActive() public {
        uint256 id = _approved(Choice.ACTION_B);
        _execute(id);
        Execution memory e = vault.getExecution(id);
        assertEq(uint8(e.action), uint8(Choice.ACTION_B));
        assertEq(e.amountMoved, 0.2 ether);
        assertEq(e.activeAfter, 2.2 ether);
        assertEq(e.reserveAfter, 1.8 ether);
        assertEq(e.startPrice, START_PRICE);
        assertEq(e.expo, -8);
        assertEq(address(vault).balance, 4 ether); // funds never leave the vault
    }

    function test_NoAction_MovesNothing() public {
        uint256 id = _approved(Choice.NO_ACTION);
        _execute(id);
        assertEq(vault.getExecution(id).amountMoved, 0);
        (uint256 a, uint256 r) = vault.balances();
        assertEq(a + r, 4 ether);
    }

    function test_MaxMoveCapsTheAction() public {
        vm.prank(admin);
        vault.setActionParams(2_500, 0.1 ether, 0);
        uint256 id = _approved(Choice.ACTION_A);
        _execute(id);
        assertEq(vault.getExecution(id).amountMoved, 0.1 ether);
    }

    function test_ActionParamsCapped() public {
        vm.prank(admin);
        vm.expectRevert(ExecutionVault.ParamAboveCap.selector);
        vault.setActionParams(2_501, 1 ether, 0);
    }

    function test_IncorrectFee() public {
        uint256 id = _approved(Choice.ACTION_A);
        bytes[] memory u = _update(START_PRICE, block.timestamp);
        vm.expectRevert(abi.encodeWithSelector(ExecutionVault.IncorrectFee.selector, FEE, 0));
        vault.execute(id, u);
    }

    function test_StalePriceRejected() public {
        uint256 id = _approved(Choice.ACTION_A);
        bytes[] memory u = _update(START_PRICE, block.timestamp - 61);
        vm.expectRevert(PythErrors.PriceFeedNotFoundWithinRange.selector);
        vault.execute{value: FEE}(id, u);
    }

    function test_NonPositivePriceRejected() public {
        uint256 id = _approved(Choice.ACTION_A);
        bytes[] memory u = _update(0, block.timestamp);
        vm.expectRevert(ExecutionVault.InvalidPrice.selector);
        vault.execute{value: FEE}(id, u);
    }

    function test_Cooldown() public {
        vm.prank(admin);
        vault.setActionParams(1_000, 0.5 ether, 1 hours);
        uint256 a = _approved(Choice.ACTION_A);
        _execute(a);
        uint256 b = _approved(Choice.ACTION_A);
        bytes[] memory u = _update(START_PRICE, block.timestamp);
        vm.expectRevert(abi.encodeWithSelector(ExecutionVault.CooldownActive.selector, uint64(block.timestamp + 1 hours)));
        vault.execute{value: FEE}(b, u);
    }

    function test_EmergencyWithdrawOnlyWhenPaused() public {
        vm.startPrank(admin);
        vm.expectRevert();
        vault.emergencyWithdraw(payable(admin), 1 ether);
        vault.pause();
        vault.emergencyWithdraw(payable(admin), 3 ether);
        vm.stopPrank();
        (uint256 act, uint256 res) = vault.balances();
        assertEq(res, 0);
        assertEq(act, 1 ether);
        assertEq(admin.balance, 3 ether);
    }
}

contract OutcomeTest is Base {
    uint256 internal id;
    uint256 internal t0;

    function setUp() public override {
        super.setUp();
        id = _createOpen();
        _submitAll(id, _all(Choice.ACTION_A), 8_000, 7_000);
        engine.aggregate(id);
        _execute(id);
        t0 = vault.getExecution(id).executedAt + 180;
    }

    function test_RecordsOutcome() public {
        _resolve(id, 100_200_000); // +20 bps
        Outcome memory o = outcome.getOutcome(id);
        assertEq(uint8(o.expectedAction), uint8(Choice.ACTION_A));
        assertEq(uint8(o.observedResult), uint8(Choice.ACTION_B));
        assertFalse(o.success);
        assertEq(o.outcomeValue, 20);
        assertEq(o.startPrice, START_PRICE);
        assertEq(o.endPrice, 100_200_000);
        assertEq(o.endPublishTime, t0 + 1);
        assertEq(o.resolvedAt, t0 + 1);
    }

    function test_BeforeHorizon() public {
        vm.warp(t0 - 1);
        bytes[] memory u = _update(START_PRICE, t0 - 1);
        vm.expectRevert(abi.encodeWithSelector(OutcomeRegistry.HorizonNotReached.selector, uint64(t0)));
        outcome.resolve{value: FEE}(id, u);
    }

    function test_PriceOutsideWindow() public {
        vm.warp(t0 + 100);
        bytes[] memory late = _update(START_PRICE, t0 + 61);
        vm.expectRevert(PythErrors.PriceFeedNotFoundWithinRange.selector);
        outcome.resolve{value: FEE}(id, late);
        bytes[] memory early = _update(START_PRICE, t0 - 1);
        vm.expectRevert(PythErrors.PriceFeedNotFoundWithinRange.selector);
        outcome.resolve{value: FEE}(id, early);
    }

    function test_ResolveTwice() public {
        _resolve(id, START_PRICE);
        bytes[] memory u = _update(START_PRICE, t0 + 1);
        vm.expectRevert(abi.encodeWithSelector(OutcomeRegistry.InvalidTransition.selector, Status.RESOLVED, Status.RESOLVED));
        outcome.resolve{value: FEE}(id, u);
    }

    function test_ExpoMismatch() public {
        vm.warp(t0 + 1);
        bytes[] memory u = new bytes[](1);
        u[0] = pyth.createPriceFeedUpdateData(PRICE_ID, 1_000_000, 10, -6, 1_000_000, 10, uint64(t0 + 1));
        vm.expectRevert(abi.encodeWithSelector(OutcomeRegistry.ExpoMismatch.selector, int32(-8), int32(-6)));
        outcome.resolve{value: FEE}(id, u);
    }

    function test_VoidAfterGrace() public {
        uint64 voidableAt = uint64(t0 + 60 + 300);
        vm.warp(voidableAt);
        vm.expectRevert(abi.encodeWithSelector(OutcomeRegistry.GraceNotElapsed.selector, voidableAt));
        outcome.voidOutcome(id);

        vm.warp(voidableAt + 1);
        outcome.voidOutcome(id);
        assertEq(uint8(_status(id)), uint8(Status.RESOLVED));
        assertTrue(outcome.getOutcome(id).isVoid);
        assertEq(registry.getAgent(0).bond, BOND);
        assertEq(registry.getAgent(0).locked, 0);
        assertEq(registry.rewardPool(), POOL);
        _assertRegistrySolvent();
    }
}

contract SettlementTest is Base {
    function test_MissedFinalSubmissionIsPenalised() public {
        uint256 id = _createOpen();
        for (uint16 a = 0; a < 4; a++) _submit(id, a, Choice.ACTION_A, 8_000, 7_000);
        vm.prank(operators[4]); // answers only its primary question, not the ACTION question
        registry.submit(id, 4, _ans(5, uint8(Choice.ACTION_A), 8_000, 7_000));
        vm.warp(T0 + 181);
        engine.aggregate(id);
        _execute(id);
        _resolve(id, 99_000_000);

        SettlementLine memory missed = outcome.getSettlement(id, 4);
        assertEq(uint8(missed.result), uint8(SettlementResult.MISSED));
        assertEq(missed.penalty, 0.005 ether); // 0.05 × 10 %
        assertEq(registry.getAgent(4).missed, 1);
        // pool = 0.005 + 0.02 = 0.025 split over 4 equal-probability correct agents
        assertEq(outcome.getSettlement(id, 0).reward, 0.00625 ether);
        _assertRegistrySolvent();
    }

    function test_NoCorrectAgent_PoolReturnsToRewardPool() public {
        uint256 id = _createOpen();
        _submitAll(id, _all(Choice.ACTION_B), 8_000, 5_000);
        engine.aggregate(id);
        _execute(id);
        _resolve(id, 98_000_000); // observed ACTION_A, everyone wrong
        uint256 penalty = LOCK * 3_000 * 5_000 / 1e8; // 0.0075
        assertEq(outcome.getSettlement(id, 0).penalty, penalty);
        assertEq(registry.rewardPool(), POOL + 5 * penalty);
        _assertRegistrySolvent();
    }

    function test_PreviewMatchesSettlement() public {
        uint256 id = _createOpen();
        _submitAll(id, [Choice.ACTION_A, Choice.NO_ACTION, Choice.ACTION_A, Choice.ESCALATE, Choice.ACTION_B], 8_000, 6_500);
        engine.aggregate(id);
        _execute(id);
        (SettlementLine[] memory preview, uint256 toPool) = outcome.previewSettlement(id, Choice.ACTION_A);
        uint256 poolBefore = registry.rewardPool();
        _resolve(id, 99_000_000);
        for (uint256 i = 0; i < preview.length; i++) {
            SettlementLine memory actual = outcome.getSettlement(id, preview[i].agentId);
            assertEq(uint8(actual.result), uint8(preview[i].result));
            assertEq(actual.penalty, preview[i].penalty);
            assertEq(actual.reward, preview[i].reward);
        }
        assertEq(registry.rewardPool(), poolBefore + toPool);
    }

    /// @dev Conservation and solvency for arbitrary choices, probabilities and outcomes.
    function testFuzz_SettlementConservesValue(uint256 seed, int64 endPrice) public {
        endPrice = int64(bound(int256(endPrice), 90_000_000, 110_000_000));
        uint256 id = _createOpen();
        Choice[5] memory c;
        for (uint16 a = 0; a < 5; a++) {
            c[a] = Choice(uint8(uint256(keccak256(abi.encode(seed, a))) % 4));
            uint16 p = uint16(100 + uint256(keccak256(abi.encode(seed, a, "p"))) % 9_801);
            // Some agents skip their final answer.
            if (uint256(keccak256(abi.encode(seed, a, "skip"))) % 5 == 0) continue;
            _submit(id, a, c[a], 6_000, p);
        }
        vm.warp(T0 + 181);
        uint256 totalBefore = address(registry).balance;
        engine.aggregate(id);
        if (_status(id) == Status.CANCELLED) {
            _assertRegistrySolvent();
            return;
        }
        if (_status(id) == Status.AGGREGATED) {
            vm.warp(engine.getAggregation(id).guardianDeadline + 1);
            engine.finalizeEscalation(id);
        }
        _execute(id);
        _resolve(id, endPrice);
        assertEq(address(registry).balance, totalBefore, "no value created or destroyed");
        _assertRegistrySolvent();
        Decision memory d = registry.getDecision(id);
        for (uint256 i = 0; i < d.participants.length; i++) {
            SettlementLine memory l = outcome.getSettlement(id, d.participants[i]);
            assertLe(l.penalty, LOCK * 5_000 / 10_000);
            if (l.result != SettlementResult.CORRECT) assertEq(l.reward, 0);
        }
    }
}
