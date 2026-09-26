// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {PythErrors} from "@pythnetwork/pyth-sdk-solidity/PythErrors.sol";
import {DecisionRegistry} from "../../src/DecisionRegistry.sol";
import {DecisionEngine} from "../../src/DecisionEngine.sol";
import {ExecutionVault} from "../../src/ExecutionVault.sol";
import {OutcomeRegistry} from "../../src/OutcomeRegistry.sol";
import {Answer, Choice, DecisionConfig, Outcome, Status} from "../../src/lib/DecTypes.sol";

/// @notice Fork test against the deployed contracts and the real Pyth on Monad Testnet, with real
///         signed Hermes updates supplied by scripts/fork-pyth.sh:
///           PYTH_T      publish time of U_START
///           U_START     update published at PYTH_T            (start price)
///           U_END       first update at/after PYTH_T + 60     (the only valid end price)
///           U_LATER     an update published later in the window (must be rejected)
///         Run with --fork-url (Foundry instantiates Monad's EVM). Skipped when the variables are absent.
contract RealPythForkTest is Test {
    DecisionRegistry internal registry;
    DecisionEngine internal engine;
    ExecutionVault internal vault;
    OutcomeRegistry internal outcome;

    function _load() internal {
        string memory json = vm.readFile(string.concat(vm.projectRoot(), "/../web/lib/chain/deployments.10143.json"));
        registry = DecisionRegistry(vm.parseJsonAddress(json, ".contracts.DecisionRegistry"));
        engine = DecisionEngine(vm.parseJsonAddress(json, ".contracts.DecisionEngine"));
        vault = ExecutionVault(payable(vm.parseJsonAddress(json, ".contracts.ExecutionVault")));
        outcome = OutcomeRegistry(vm.parseJsonAddress(json, ".contracts.OutcomeRegistry"));
    }

    function _approvedDecision(uint256 t) internal returns (uint256 id) {
        DecisionConfig memory c = DecisionConfig({
            submissionWindow: 90, horizon: 60, bandBps: 10, thresholdBps: 6000, minActionScore: 5500,
            quorum: 4, allowedForks: 0x0F, questionCount: 6, lockPerAgent: 0.05 ether
        });
        vm.warp(t - 5);
        vm.startPrank(vm.envAddress("PROPOSER_ADDRESS"));
        id = registry.createDecision(keccak256(abi.encode("fork", t)), keccak256("q"), c);
        registry.openDecision(id);
        vm.stopPrank();
        for (uint16 a = 0; a < 5; a++) {
            vm.prank(registry.getAgent(a).operator);
            registry.submit(id, a, Answer({questionId: 0, choice: uint8(Choice.NO_ACTION), score: 7000, probability: 6000, reasonHash: keccak256("r")}));
        }
        engine.aggregate(id);
        assertEq(uint8(registry.statusOf(id)), uint8(Status.APPROVED));
    }

    function _one(string memory name) internal view returns (bytes[] memory u) {
        u = new bytes[](1);
        u[0] = vm.envBytes(name);
    }

    function test_RealPythLifecycleAndNoCherryPicking() public {
        if (!vm.envExists("U_START")) return;
        _load();
        uint256 t = vm.envUint("PYTH_T");
        uint256 id = _approvedDecision(t);

        vm.warp(t); // the start update is fresh
        vault.execute{value: 1}(id, _one("U_START")); // the real Pyth verifies the signature

        vm.warp(t + 61);
        vm.expectRevert(PythErrors.PriceFeedNotFoundWithinRange.selector);
        outcome.resolve{value: 1}(id, _one("U_LATER")); // inside the window, but not the first update

        outcome.resolve{value: 1}(id, _one("U_END"));
        Outcome memory o = outcome.getOutcome(id);
        assertEq(uint8(registry.statusOf(id)), uint8(Status.RESOLVED));
        assertFalse(o.isVoid);
        assertGe(o.endPublishTime, t + 60);
        emit log_named_int("start price", o.startPrice);
        emit log_named_int("end price", o.endPrice);
        emit log_named_int("move bps", o.outcomeValue);
    }
}
