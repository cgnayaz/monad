// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {DecisionRegistry} from "../src/DecisionRegistry.sol";
import {ExecutionVault} from "../src/ExecutionVault.sol";

/// @notice Tops up a deployment from the deployer key to target levels: the vault treasury
///         (RESERVE and ACTIVE), the reward pool, each agent's free bond, and gas for the
///         proposer, keeper and agent operators. Idempotent: only the shortfall is sent, so it
///         can be re-run safely. Reads addresses from web/lib/chain/deployments.<chainId>.json.
///
/// Monad prices cold storage higher than the local simulation, so let the RPC estimate gas:
///   forge script script/Setup.s.sol --rpc-url monad_testnet --broadcast --slow --skip-simulation
contract Setup is Script {
    uint256 internal constant VAULT_RESERVE = 0.5 ether;
    uint256 internal constant VAULT_ACTIVE = 0.5 ether;
    uint256 internal constant REWARD_POOL = 0.3 ether;
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

        (uint256 active, uint256 reserve) = vault.balances();
        uint256 pool = registry.rewardPool();

        vm.startBroadcast(pk);
        if (reserve < VAULT_RESERVE) vault.deposit{value: VAULT_RESERVE - reserve}();
        if (active < VAULT_ACTIVE) vault.depositActive{value: VAULT_ACTIVE - active}();
        if (pool < REWARD_POOL) registry.fundRewardPool{value: REWARD_POOL - pool}();
        for (uint16 i = 0; i < 5; i++) {
            uint256 bond = registry.getAgent(i).bond;
            if (bond < AGENT_BOND) registry.depositBond{value: AGENT_BOND - bond}(i);
            _topUp(vm.envAddress(string.concat("AGENT_", keys[i], "_ADDRESS")), AGENT_GAS);
        }
        _topUp(vm.envAddress("PROPOSER_ADDRESS"), PROPOSER_GAS);
        _topUp(vm.envAddress("KEEPER_ADDRESS"), KEEPER_GAS);
        vm.stopBroadcast();

        (active, reserve) = vault.balances();
        console2.log("vault active", active);
        console2.log("vault reserve", reserve);
        console2.log("reward pool", registry.rewardPool());
    }

    function _topUp(address to, uint256 target) private {
        if (to.balance < target) payable(to).transfer(target - to.balance);
    }
}
