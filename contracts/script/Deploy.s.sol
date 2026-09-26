// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {IPyth} from "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import {DecisionRegistry} from "../src/DecisionRegistry.sol";
import {DecisionEngine} from "../src/DecisionEngine.sol";
import {ExecutionVault} from "../src/ExecutionVault.sol";
import {OutcomeRegistry} from "../src/OutcomeRegistry.sol";

/// @notice Deploys the four DecMarkt contracts to Monad Testnet, wires roles, registers the
///         five agents and writes web/lib/chain/deployments.10143.json.
///
/// Required env (contracts/.env, never committed):
///   DEPLOYER_PRIVATE_KEY, PROPOSER_ADDRESS, GUARDIAN_ADDRESS,
///   AGENT_RISK_ADDRESS, AGENT_YIELD_ADDRESS, AGENT_SECURITY_ADDRESS, AGENT_MARKET_ADDRESS, AGENT_HISTORY_ADDRESS
///
///   forge script script/Deploy.s.sol --rpc-url monad_testnet --broadcast
contract Deploy is Script {
    // Verified on Monad Testnet 2026-09-26 (ARCHITECTURE.md §6).
    IPyth internal constant PYTH = IPyth(0x2880aB155794e7179c9eE2e38200202908C17B43);
    bytes32 internal constant MON_USD = 0x31491744e2dbf6df7fcf4ac0820d18a609b49076d45066d3568424e62f686cd1;

    // CONTRACT_SPEC.md §8 defaults.
    uint16 internal constant ACTION_BPS = 1_000;
    uint256 internal constant MAX_MOVE = 0.5 ether;
    uint64 internal constant COOLDOWN = 0;
    uint16 internal constant SLASH_BPS = 3_000;
    uint16 internal constant MISS_PENALTY_BPS = 1_000;
    uint256 internal constant ROUND_REWARD = 0.02 ether;

    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address admin = vm.addr(pk);
        address proposer = vm.envAddress("PROPOSER_ADDRESS");
        address guardian = vm.envAddress("GUARDIAN_ADDRESS");
        string[5] memory keys = ["RISK", "YIELD", "SECURITY", "MARKET", "HISTORY"];
        string[5] memory names = ["Risk Analyst", "Yield Analyst", "Security Analyst", "Market Analyst", "Historical Analyst"];

        vm.startBroadcast(pk);
        DecisionRegistry registry = new DecisionRegistry(admin);
        DecisionEngine engine = new DecisionEngine(admin, registry);
        ExecutionVault vault = new ExecutionVault(admin, registry, engine, PYTH, MON_USD, ACTION_BPS, MAX_MOVE, COOLDOWN);
        OutcomeRegistry outcome = new OutcomeRegistry(admin, registry, vault, PYTH, MON_USD, SLASH_BPS, MISS_PENALTY_BPS);

        registry.grantRole(registry.ENGINE_ROLE(), address(engine));
        registry.grantRole(registry.VAULT_ROLE(), address(vault));
        registry.grantRole(registry.OUTCOME_ROLE(), address(outcome));
        registry.grantRole(registry.PROPOSER_ROLE(), proposer);
        engine.grantRole(engine.GUARDIAN_ROLE(), guardian);
        registry.setRoundReward(ROUND_REWARD);

        for (uint256 i = 0; i < 5; i++) {
            address operator = vm.envAddress(string.concat("AGENT_", keys[i], "_ADDRESS"));
            registry.registerAgent(operator, keccak256(bytes(names[i])), "");
        }
        vm.stopBroadcast();

        string memory c = "contracts";
        vm.serializeAddress(c, "DecisionRegistry", address(registry));
        vm.serializeAddress(c, "DecisionEngine", address(engine));
        vm.serializeAddress(c, "ExecutionVault", address(vault));
        string memory contractsJson = vm.serializeAddress(c, "OutcomeRegistry", address(outcome));

        string memory root = "root";
        vm.serializeUint(root, "chainId", block.chainid);
        vm.serializeUint(root, "deployBlock", block.number);
        string memory json = vm.serializeString(root, "contracts", contractsJson);
        vm.writeJson(json, string.concat(vm.projectRoot(), "/../web/lib/chain/deployments.", vm.toString(block.chainid), ".json"));

        console2.log("DecisionRegistry", address(registry));
        console2.log("DecisionEngine  ", address(engine));
        console2.log("ExecutionVault  ", address(vault));
        console2.log("OutcomeRegistry ", address(outcome));
    }
}
