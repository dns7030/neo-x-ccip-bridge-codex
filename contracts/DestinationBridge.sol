// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Client} from "@chainlink/contracts-ccip/contracts/libraries/Client.sol";
import {IAny2EVMMessageReceiver} from "@chainlink/contracts-ccip/contracts/interfaces/IAny2EVMMessageReceiver.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {XUSDC} from "./XUSDC.sol";

contract DestinationBridge is IAny2EVMMessageReceiver, IERC165, Ownable, Pausable {
    error SourceNotAllowed(uint64 sourceChainSelector, address sender);
    error AmountIsZero();
    error InvalidRouter(address router);

    event Minted(
        bytes32 indexed messageId,
        uint64 indexed sourceChainSelector,
        address indexed sourceSender,
        address recipient,
        uint256 amount
    );
    event SourceUpdated(uint64 sourceChainSelector, address sourceBridge);

    XUSDC public immutable xusdc;
    address public immutable router;

    uint64 public sourceChainSelector;
    address public sourceBridge;

    constructor(address router_, address xusdc_, address owner_) Ownable(owner_) {
        if (router_ == address(0)) revert InvalidRouter(address(0));
        router = router_;
        xusdc = XUSDC(xusdc_);
    }

    function setSource(uint64 selector, address bridge) external onlyOwner {
        sourceChainSelector = selector;
        sourceBridge = bridge;
        emit SourceUpdated(selector, bridge);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == type(IAny2EVMMessageReceiver).interfaceId || interfaceId == type(IERC165).interfaceId;
    }

    function ccipReceive(Client.Any2EVMMessage calldata message) external whenNotPaused {
        if (msg.sender != router) revert InvalidRouter(msg.sender);

        address sender = abi.decode(message.sender, (address));
        if (message.sourceChainSelector != sourceChainSelector || sender != sourceBridge) {
            revert SourceNotAllowed(message.sourceChainSelector, sender);
        }

        (address sourceSender, address recipient, uint256 amount) = abi.decode(
            message.data,
            (address, address, uint256)
        );
        if (amount == 0) revert AmountIsZero();

        xusdc.mint(recipient, amount);
        emit Minted(message.messageId, message.sourceChainSelector, sourceSender, recipient, amount);
    }
}
