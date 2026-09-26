// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {MockPyth} from "@pythnetwork/pyth-sdk-solidity/MockPyth.sol";
import {DecisionRegistry} from "../src/DecisionRegistry.sol";
import {DecisionEngine} from "../src/DecisionEngine.sol";
import {ExecutionVault} from "../src/ExecutionVault.sol";
import {OutcomeRegistry} from "../src/OutcomeRegistry.sol";
import {Answer, Choice, DecisionConfig, Execution, Status} from "../src/lib/DecTypes.sol";

/// @dev Shared deployment and helpers. Mirrors the demo configuration in CONTRACT_SPEC.md §8.
abstract contract Base is Test {
    bytes32 internal constant PRICE_ID = 0x31491744e2dbf6df7fcf4ac0820d18a609b49076d45066d3568424e62f686cd1;
    uint256 internal constant FEE = 1;
    uint256 internal constant LOCK = 0.05 ether;
    uint256 internal constant BOND = 1 ether;
    uint256 internal constant ROUND_REWARD = 0.02 ether;
    uint256 internal constant POOL = 1 ether;
    int64 internal constant START_PRICE = 100_000_000; // 1.00000000 with expo −8
    uint256 internal constant T0 = 1_790_000_000;

    MockPyth internal pyth;
    DecisionRegistry internal registry;
    DecisionEngine internal engine;
    ExecutionVault internal vault;
    OutcomeRegistry internal outcome;

    address internal admin = makeAddr("admin");
    address internal proposer = makeAddr("proposer");
    address internal guardian = makeAddr("guardian");
    address internal keeper = makeAddr("keeper");
    address internal stranger = makeAddr("stranger");
    address[5] internal operators;

    uint256 private _nonce;

    function setUp() public virtual {
        vm.warp(T0);
        pyth = new MockPyth(60, FEE);

        vm.startPrank(admin);
        registry = new DecisionRegistry(admin);
        engine = new DecisionEngine(admin, registry);
        vault = new ExecutionVault(admin, registry, engine, pyth, PRICE_ID, 1_000, 0.5 ether, 0);
        outcome = new OutcomeRegistry(admin, registry, vault, pyth, PRICE_ID, 3_000, 1_000);

        registry.grantRole(registry.PROPOSER_ROLE(), proposer);
        registry.grantRole(registry.ENGINE_ROLE(), address(engine));
        registry.grantRole(registry.VAULT_ROLE(), address(vault));
        registry.grantRole(registry.OUTCOME_ROLE(), address(outcome));
        engine.grantRole(engine.GUARDIAN_ROLE(), guardian);

        string[5] memory names = ["Risk Analyst", "Yield Analyst", "Security Analyst", "Market Analyst", "Historical Analyst"];
        for (uint16 i = 0; i < 5; i++) {
            operators[i] = makeAddr(names[i]);
            registry.registerAgent(operators[i], keccak256(bytes(names[i])), "");
        }
        registry.setRoundReward(ROUND_REWARD);
        vm.stopPrank();

        vm.deal(address(this), 100 ether);
        vm.deal(keeper, 1 ether);
        for (uint16 i = 0; i < 5; i++) registry.depositBond{value: BOND}(i);
        registry.fundRewardPool{value: POOL}();
        vault.deposit{value: 2 ether}();
        vault.depositActive{value: 2 ether}();
    }

    // ─── Config and lifecycle helpers ──────────────────────────────────────

    function _cfg() internal pure returns (DecisionConfig memory) {
        return DecisionConfig({
            submissionWindow: 180,
            horizon: 180,
            bandBps: 10,
            thresholdBps: 6_000,
            minActionScore: 5_500,
            quorum: 4,
            allowedForks: 0x0F,
            questionCount: 6,
            lockPerAgent: LOCK
        });
    }

    function _create(DecisionConfig memory c) internal returns (uint256 id) {
        vm.prank(proposer);
        id = registry.createDecision(keccak256(abi.encode("state", ++_nonce)), keccak256("questions"), c);
    }

    function _createOpen() internal returns (uint256 id) {
        id = _create(_cfg());
        vm.prank(proposer);
        registry.openDecision(id);
    }

    function _ans(uint8 q, uint8 choice, uint16 score, uint16 prob) internal pure returns (Answer memory) {
        return Answer({questionId: q, choice: choice, score: score, probability: prob, reasonHash: keccak256(abi.encode(q, choice))});
    }

    /// @dev Agent `a` submits its batch: primary question (a + 1) and the ACTION question (0).
    function _submit(uint256 id, uint16 a, Choice c, uint16 score, uint16 prob) internal {
        Answer[] memory batch = new Answer[](2);
        batch[0] = _ans(uint8(a + 1), uint8(c), score, prob);
        batch[1] = _ans(0, uint8(c), score, prob);
        vm.prank(operators[a]);
        registry.submitBatch(id, a, batch);
    }

    function _submitAll(uint256 id, Choice[5] memory c, uint16 score, uint16 prob) internal {
        for (uint16 a = 0; a < 5; a++) _submit(id, a, c[a], score, prob);
    }

    function _update(int64 price, uint256 publishTime) internal view returns (bytes[] memory u) {
        u = new bytes[](1);
        u[0] = pyth.createPriceFeedUpdateData(PRICE_ID, price, 10, -8, price, 10, uint64(publishTime));
    }

    function _execute(uint256 id) internal {
        vm.prank(keeper);
        vault.execute{value: FEE}(id, _update(START_PRICE, block.timestamp));
    }

    /// @dev Warp to the resolution window and resolve with `endPrice` published at t0 + 1.
    function _resolve(uint256 id, int64 endPrice) internal {
        Execution memory e = vault.getExecution(id);
        uint256 t0 = e.executedAt + _cfg().horizon;
        vm.warp(t0 + 1);
        vm.prank(keeper);
        outcome.resolve{value: FEE}(id, _update(endPrice, t0 + 1));
    }

    function _status(uint256 id) internal view returns (Status) {
        return registry.statusOf(id);
    }

    function _all(Choice c) internal pure returns (Choice[5] memory r) {
        for (uint256 i = 0; i < 5; i++) r[i] = c;
    }

    /// @dev Everything the registry holds must equal Σ bonds + Σ locked + reward pool + reserved rewards.
    function _assertRegistrySolvent() internal view {
        uint256 total = registry.rewardPool() + registry.reservedRewards();
        for (uint16 i = 0; i < registry.agentCount(); i++) {
            total += registry.getAgent(i).bond + registry.getAgent(i).locked;
        }
        assertEq(address(registry).balance, total, "registry solvency");
    }
}
