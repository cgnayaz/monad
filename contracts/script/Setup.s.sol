// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {DecisionRegistry} from "../src/DecisionRegistry.sol";
import {ExecutionVault} from "../src/ExecutionVault.sol";

/// @notice Funds a fresh deployment from the deployer key: the vault treasury (RESERVE and
///         ACTIVE), the reward pool, a bond for each agent, and gas for the proposer, keeper
///         and agent operators. Reads addresses from web/lib/chain/deployments.<chainId>.json.
///
///   forge script script/Setup.s.sol --rpc-url monad_testnet --broadcast
contract Setup is Script {
    uint256 internal constant VAULT_RESERVE = 1 ether;
    uint256 internal constant VAULT_ACTIVE = 1 ether;
    uint256 internal constant REWARD_POOL = 0.5 ether;
    uint256 internal constant AGENT_BOND = 0.5 ether;
    uint256 internal constant AGENT_GAS = 0.2 ether;
    uint256 internal constant PROPOSER_GAS = 0.3 ether;
    uint256 internal constant KEEPER_GAS = 0.5 ether;

    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        string memory json = vm.readFile(string.concat(vm.projectRoot(), "/../web/lib/chain/deployments.", vm.toString(block.chainid), ".json"));
        DecisionRegistry registry = DecisionRegistry(vm.parseJsonAddress(json, ".contracts.DecisionRegistry"));
        ExecutionVault vault = ExecutionVault(payable(vm.parseJsonAddress(json, ".contracts.ExecutionVault")));
        string[5] memory keys = ["RISK", "YIELD", "SECURITY", "MARKET", "HISTORY"];

        vm.startBroadcast(pk);
        vault.deposit{value: VAULT_RESERVE}();
        vault.depositActive{value: VAULT_ACTIVE}();
        registry.fundRewardPool{value: REWARD_POOL}();
        for (uint16 i = 0; i < 5; i++) {
            registry.depositBond{value: AGENT_BOND}(i);
            address operator = vm.envAddress(string.concat("AGENT_", keys[i], "_ADDRESS"));
            payable(operator).transfer(AGENT_GAS);
        }
        payable(vm.envAddress("PROPOSER_ADDRESS")).transfer(PROPOSER_GAS);
        payable(vm.envAddress("KEEPER_ADDRESS")).transfer(KEEPER_GAS);
        vm.stopBroadcast();

        (uint256 active, uint256 reserve) = vault.balances();
        console2.log("vault active / reserve", active, reserve);
        console2.log("reward pool", registry.rewardPool());
    }
}
