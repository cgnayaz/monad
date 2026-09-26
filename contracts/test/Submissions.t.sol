// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {Base} from "./Base.t.sol";
import {DecisionRegistry} from "../src/DecisionRegistry.sol";
import {DecisionEngine} from "../src/DecisionEngine.sol";
import {Answer, Choice, DecisionConfig, SettlementLine, Status} from "../src/lib/DecTypes.sol";

contract SubmissionValidationTest is Base {
    uint256 internal id;

    function setUp() public override {
        super.setUp();
        id = _createOpen();
    }

    function _submitOne(uint16 agent, Answer memory a) internal {
        vm.prank(operators[agent]);
        registry.submit(id, agent, a);
    }

    function test_DuplicateSubmission() public {
        _submitOne(0, _ans(0, 1, 5_000, 5_000));
        vm.prank(operators[0]);
        vm.expectRevert(abi.encodeWithSelector(DecisionRegistry.AlreadySubmitted.selector, id, 0, 0));
        registry.submit(id, 0, _ans(0, 2, 5_000, 5_000));
    }

    function test_DuplicateWithinBatch() public {
        Answer[] memory batch = new Answer[](2);
        batch[0] = _ans(1, 1, 5_000, 5_000);
        batch[1] = _ans(1, 2, 5_000, 5_000);
        vm.prank(operators[0]);
        vm.expectRevert(abi.encodeWithSelector(DecisionRegistry.AlreadySubmitted.selector, id, 0, 1));
        registry.submitBatch(id, 0, batch);
    }

    function test_ExpiredSubmission() public {
        vm.warp(T0 + 180); // exactly at the deadline is still accepted
        _submitOne(0, _ans(0, 0, 5_000, 5_000));
        vm.warp(T0 + 181);
        vm.prank(operators[1]);
        vm.expectRevert(abi.encodeWithSelector(DecisionRegistry.DeadlinePassed.selector, id, uint64(T0 + 180)));
        registry.submit(id, 1, _ans(0, 0, 5_000, 5_000));
    }

    function test_InvalidChoice() public {
        vm.prank(operators[0]);
        vm.expectRevert(abi.encodeWithSelector(DecisionRegistry.InvalidChoice.selector, 4));
        registry.submit(id, 0, _ans(0, 4, 5_000, 5_000));
        vm.prank(operators[0]);
        vm.expectRevert(abi.encodeWithSelector(DecisionRegistry.InvalidChoice.selector, 255));
        registry.submit(id, 0, _ans(0, 255, 5_000, 5_000));
    }

    function test_ChoiceOutsideAllowedForks() public {
        DecisionConfig memory c = _cfg();
        c.allowedForks = 0x03; // NO_ACTION, ACTION_A
        uint256 restricted = _create(c);
        vm.prank(proposer);
        registry.openDecision(restricted);
        vm.prank(operators[0]);
        vm.expectRevert(abi.encodeWithSelector(DecisionRegistry.ChoiceNotAllowed.selector, Choice.ACTION_B));
        registry.submit(restricted, 0, _ans(0, uint8(Choice.ACTION_B), 5_000, 5_000));
    }

    function test_InvalidQuestion() public {
        vm.prank(operators[0]);
        vm.expectRevert(abi.encodeWithSelector(DecisionRegistry.InvalidQuestion.selector, 6, 6));
        registry.submit(id, 0, _ans(6, 0, 5_000, 5_000));
    }

    function test_InvalidScore() public {
        _submitOne(0, _ans(0, 0, 10_000, 5_000)); // upper bound accepted
        vm.prank(operators[1]);
        vm.expectRevert(abi.encodeWithSelector(DecisionRegistry.InvalidScore.selector, 10_001));
        registry.submit(id, 1, _ans(0, 0, 10_001, 5_000));
    }

    function test_InvalidProbability() public {
        _submitOne(0, _ans(0, 0, 5_000, 100));
        _submitOne(1, _ans(0, 0, 5_000, 9_900));
        vm.prank(operators[2]);
        vm.expectRevert(abi.encodeWithSelector(DecisionRegistry.InvalidProbability.selector, 99));
        registry.submit(id, 2, _ans(0, 0, 5_000, 99));
        vm.prank(operators[2]);
        vm.expectRevert(abi.encodeWithSelector(DecisionRegistry.InvalidProbability.selector, 9_901));
        registry.submit(id, 2, _ans(0, 0, 5_000, 9_901));
    }

    function test_ZeroReasonHash() public {
        Answer memory a = _ans(0, 0, 5_000, 5_000);
        a.reasonHash = bytes32(0);
        vm.prank(operators[0]);
        vm.expectRevert(DecisionRegistry.InvalidHash.selector);
        registry.submit(id, 0, a);
    }

    function test_NonParticipant() public {
        // Agent 4 drains its bond, so it is not snapshotted into the next decision.
        vm.prank(operators[4]);
        registry.withdrawBond(4, BOND - LOCK);
        uint256 next = _createOpen();
        vm.prank(operators[4]);
        vm.expectRevert(abi.encodeWithSelector(DecisionRegistry.NotParticipant.selector, next, 4));
        registry.submit(next, 4, _ans(0, 0, 5_000, 5_000));
    }
}

contract AccessControlTest is Base {
    function _unauthorized(address who, bytes32 role) internal {
        vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, who, role));
    }

    function test_OnlyProposerCreatesAndOpens() public {
        DecisionConfig memory c = _cfg();
        bytes32 role = registry.PROPOSER_ROLE();
        _unauthorized(stranger, role);
        vm.prank(stranger);
        registry.createDecision(keccak256("s"), keccak256("q"), c);

        uint256 id = _create(c);
        _unauthorized(stranger, role);
        vm.prank(stranger);
        registry.openDecision(id);
    }

    function test_OnlyOperatorSubmitsForItsAgent() public {
        uint256 id = _createOpen();
        vm.prank(operators[1]); // operator of agent 1 tries to submit for agent 0
        vm.expectRevert(abi.encodeWithSelector(DecisionRegistry.NotAgentOperator.selector, 0, operators[1]));
        registry.submit(id, 0, _ans(0, 0, 5_000, 5_000));
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(DecisionRegistry.NotAgentOperator.selector, 0, stranger));
        registry.submit(id, 0, _ans(0, 0, 5_000, 5_000));
    }

    function test_RestrictedTransitions() public {
        uint256 id = _createOpen();
        vm.startPrank(stranger);
        _unauthorized(stranger, registry.ENGINE_ROLE());
        registry.markAggregated(id);
        _unauthorized(stranger, registry.ENGINE_ROLE());
        registry.markApproved(id);
        _unauthorized(stranger, registry.ENGINE_ROLE());
        registry.markCancelledNoQuorum(id);
        _unauthorized(stranger, registry.VAULT_ROLE());
        registry.markExecuted(id);
        _unauthorized(stranger, registry.OUTCOME_ROLE());
        registry.settleAndResolve(id, new SettlementLine[](0), 0);
        vm.stopPrank();
    }

    function test_AdminOnly() public {
        vm.startPrank(stranger);
        _unauthorized(stranger, bytes32(0));
        registry.registerAgent(stranger, bytes32(0), "");
        _unauthorized(stranger, bytes32(0));
        registry.setRoundReward(1);
        _unauthorized(stranger, bytes32(0));
        vault.setActionParams(1, 1, 1);
        _unauthorized(stranger, bytes32(0));
        outcome.setPenaltyParams(1, 1);
        _unauthorized(stranger, bytes32(0));
        vault.emergencyWithdraw(payable(stranger), 1);
        _unauthorized(stranger, bytes32(0));
        registry.pause();
        vm.stopPrank();
    }

    function test_OnlyGuardianDecidesEscalation() public {
        uint256 id = _createOpen();
        _submitAll(id, _all(Choice.ESCALATE), 7_000, 7_000);
        engine.aggregate(id);
        bytes32 role = engine.GUARDIAN_ROLE();
        _unauthorized(stranger, role);
        vm.prank(stranger);
        engine.guardianDecide(id, uint8(Choice.ACTION_A));
    }

    function test_CancelAndWithdrawRestricted() public {
        uint256 id = _createOpen();
        vm.prank(stranger);
        vm.expectRevert(DecisionRegistry.Unauthorized.selector);
        registry.cancel(id);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(DecisionRegistry.NotAgentOperator.selector, 0, stranger));
        registry.withdrawBond(0, 1);
    }

    function test_CannotWithdrawLockedBond() public {
        _createOpen();
        vm.prank(operators[0]);
        vm.expectRevert(abi.encodeWithSelector(DecisionRegistry.InsufficientBond.selector, 0, BOND - LOCK, BOND));
        registry.withdrawBond(0, BOND);
    }

    function test_PausedBlocksNewWork() public {
        vm.prank(admin);
        registry.pause();
        DecisionConfig memory c = _cfg();
        vm.prank(proposer);
        vm.expectRevert();
        registry.createDecision(keccak256("p"), keccak256("q"), c);
    }

    function test_RewardPoolWithdrawalOnlyAdminWhilePaused() public {
        vm.prank(admin);
        vm.expectRevert();
        registry.withdrawRewardPool(payable(admin), 0.1 ether); // not paused
        vm.prank(stranger);
        vm.expectRevert();
        registry.withdrawRewardPool(payable(stranger), 0.1 ether); // not admin
        vm.startPrank(admin);
        registry.pause();
        registry.withdrawRewardPool(payable(admin), 0.4 ether);
        vm.stopPrank();
        assertEq(registry.rewardPool(), POOL - 0.4 ether);
        assertEq(admin.balance, 0.4 ether);
        _assertRegistrySolvent();
    }

    function test_VaultRejectsDirectTransfers() public {
        (bool ok,) = address(vault).call{value: 1}("");
        assertFalse(ok);
    }

    function test_NoApprovedActionBeforeApproval() public {
        uint256 id = _createOpen();
        vm.expectRevert(abi.encodeWithSelector(DecisionEngine.NotApproved.selector, id));
        engine.approvedAction(id);
        assertEq(uint8(_status(id)), uint8(Status.OPEN));
    }
}

/// @dev Operator contract that tries to re-enter withdrawBond from its receive hook.
contract ReentrantOperator {
    DecisionRegistry internal immutable registry;
    uint16 internal agentId;
    bool internal attacked;

    constructor(DecisionRegistry r) {
        registry = r;
    }

    function setAgent(uint16 a) external {
        agentId = a;
    }

    function withdraw(uint256 amount) external {
        registry.withdrawBond(agentId, amount);
    }

    receive() external payable {
        if (!attacked) {
            attacked = true;
            registry.withdrawBond(agentId, msg.value);
        }
    }
}

contract ReentrancyTest is Base {
    function test_WithdrawBondCannotBeReentered() public {
        ReentrantOperator attacker = new ReentrantOperator(registry);
        vm.prank(admin);
        uint16 agentId = registry.registerAgent(address(attacker), keccak256("attacker"), "");
        attacker.setAgent(agentId);
        registry.depositBond{value: 1 ether}(agentId);

        vm.expectRevert(DecisionRegistry.TransferFailed.selector); // inner call hits ReentrancyGuard
        attacker.withdraw(0.5 ether);
        assertEq(registry.getAgent(agentId).bond, 1 ether);
        _assertRegistrySolvent();
    }
}
