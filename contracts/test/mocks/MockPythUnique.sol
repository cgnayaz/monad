// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {MockPyth} from "@pythnetwork/pyth-sdk-solidity/MockPyth.sol";
import {PythErrors} from "@pythnetwork/pyth-sdk-solidity/PythErrors.sol";
import {PythStructs} from "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";

/// @dev TEST ONLY. MockPyth plus `parsePriceFeedUpdatesUnique` with Pyth's semantics.
///      Unique updates are encoded as abi.encode(PriceFeed, uint64 prevPublishTime).
contract MockPythUnique is MockPyth {
    constructor(uint256 validTimePeriod, uint256 fee) MockPyth(validTimePeriod, fee) {}

    function createUniqueUpdateData(bytes32 id, int64 price, int32 expo, uint64 publishTime, uint64 prevPublishTime)
        external
        pure
        returns (bytes memory)
    {
        PythStructs.PriceFeed memory f;
        f.id = id;
        f.price = PythStructs.Price({price: price, conf: 10, expo: expo, publishTime: publishTime});
        f.emaPrice = f.price;
        return abi.encode(f, prevPublishTime);
    }

    function parsePriceFeedUpdatesUnique(bytes[] calldata updateData, bytes32[] calldata priceIds, uint64 minPublishTime, uint64 maxPublishTime)
        external
        payable
        returns (PythStructs.PriceFeed[] memory feeds)
    {
        if (msg.value < getUpdateFee(updateData)) revert PythErrors.InsufficientFee();
        feeds = new PythStructs.PriceFeed[](priceIds.length);
        for (uint256 i = 0; i < priceIds.length; i++) {
            bool found;
            for (uint256 j = 0; j < updateData.length; j++) {
                (PythStructs.PriceFeed memory f, uint64 prev) = abi.decode(updateData[j], (PythStructs.PriceFeed, uint64));
                if (f.id == priceIds[i] && minPublishTime <= f.price.publishTime && f.price.publishTime <= maxPublishTime && prev < minPublishTime) {
                    feeds[i] = f;
                    found = true;
                    break;
                }
            }
            if (!found) revert PythErrors.PriceFeedNotFoundWithinRange();
        }
    }
}
