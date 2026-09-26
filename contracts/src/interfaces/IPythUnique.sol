// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {PythStructs} from "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";

/// @notice Pyth's `parsePriceFeedUpdatesUnique` (present on the deployed Pyth contract, v1.4.x;
///         not in the v2.2 SDK interface). Returns a feed only if its publishTime is in
///         [minPublishTime, maxPublishTime] AND its previous publishTime is < minPublishTime —
///         i.e. the first update at or after minPublishTime. This makes the observed price
///         unique, so a caller cannot choose a favourable update inside the window.
interface IPythUnique {
    function parsePriceFeedUpdatesUnique(
        bytes[] calldata updateData,
        bytes32[] calldata priceIds,
        uint64 minPublishTime,
        uint64 maxPublishTime
    ) external payable returns (PythStructs.PriceFeed[] memory priceFeeds);
}
