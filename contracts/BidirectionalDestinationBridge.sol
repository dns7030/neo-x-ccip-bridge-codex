// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Client} from "@chainlink/contracts-ccip/contracts/libraries/Client.sol";
import {IAny2EVMMessageReceiver} from "@chainlink/contracts-ccip/contracts/interfaces/IAny2EVMMessageReceiver.sol";
import {IRouterClient} from "@chainlink/contracts-ccip/contracts/interfaces/IRouterClient.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {XUSDC} from "./XUSDC.sol";

contract BidirectionalDestinationBridge is IAny2EVMMessageReceiver, IERC165, Ownable, Pausable, ReentrancyGuard {
    error AmountIsZero();
    error RemoteNotConfigured();
    error InvalidRouter(address router);
    error SourceNotAllowed(uint64 sourceChainSelector, address sender);
    error InsufficientFee(uint256 requiredFee, uint256 suppliedFee);
    error RefundFailed();

    event Minted(bytes32 indexed messageId, address indexed recipient, uint256 amount);
    event ReturnRequested(bytes32 indexed messageId, address indexed sender, address indexed recipient, uint256 amount, uint256 fee);
    event RemoteBridgeUpdated(uint64 remoteChainSelector, address remoteBridge);

    XUSDC public immutable xusdc;
    IRouterClient public immutable router;

    uint64 public remoteChainSelector;
    address public remoteBridge;

    constructor(address router_, address xusdc_, address owner_) Ownable(owner_) {
        if (router_ == address(0)) revert InvalidRouter(address(0));
        router = IRouterClient(router_);
        xusdc = XUSDC(xusdc_);
    }

    function setRemoteBridge(uint64 selector, address bridge) external onlyOwner {
        if (selector == 0 || bridge == address(0)) revert RemoteNotConfigured();
        remoteChainSelector = selector;
        remoteBridge = bridge;
        emit RemoteBridgeUpdated(selector, bridge);
    }

    function getReturnFee(uint256 amount, address sender, address recipient) external view returns (uint256) {
        if (remoteChainSelector == 0 || remoteBridge == address(0)) revert RemoteNotConfigured();
        if (recipient == address(0)) recipient = sender;
        return router.getFee(remoteChainSelector, _buildMessage(sender, recipient, amount));
    }

    function bridgeBack(uint256 amount, address recipient) external payable whenNotPaused nonReentrant returns (bytes32 messageId) {
        if (amount == 0) revert AmountIsZero();
        if (remoteChainSelector == 0 || remoteBridge == address(0)) revert RemoteNotConfigured();
        if (recipient == address(0)) recipient = msg.sender;

        Client.EVM2AnyMessage memory message = _buildMessage(msg.sender, recipient, amount);
        uint256 fee = router.getFee(remoteChainSelector, message);
        if (msg.value < fee) revert InsufficientFee(fee, msg.value);

        xusdc.burnFrom(msg.sender, amount);
        messageId = router.ccipSend{value: fee}(remoteChainSelector, message);

        if (msg.value > fee) {
            (bool success,) = msg.sender.call{value: msg.value - fee}("");
            if (!success) revert RefundFailed();
        }

        emit ReturnRequested(messageId, msg.sender, recipient, amount, fee);
    }

    function ccipReceive(Client.Any2EVMMessage calldata message) external whenNotPaused nonReentrant {
        if (msg.sender != address(router)) revert InvalidRouter(msg.sender);
        address sender = abi.decode(message.sender, (address));
        if (message.sourceChainSelector != remoteChainSelector || sender != remoteBridge) {
            revert SourceNotAllowed(message.sourceChainSelector, sender);
        }

        (, address recipient, uint256 amount) = abi.decode(message.data, (address, address, uint256));
        if (amount == 0) revert AmountIsZero();
        xusdc.mint(recipient, amount);
        emit Minted(message.messageId, recipient, amount);
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == type(IAny2EVMMessageReceiver).interfaceId || interfaceId == type(IERC165).interfaceId;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function _buildMessage(address sender, address recipient, uint256 amount) internal view returns (Client.EVM2AnyMessage memory) {
        return Client.EVM2AnyMessage({
            receiver: abi.encode(remoteBridge),
            data: abi.encode(sender, recipient, amount),
            tokenAmounts: new Client.EVMTokenAmount[](0),
            extraArgs: Client._argsToBytes(Client.EVMExtraArgsV1({gasLimit: 250_000})),
            feeToken: address(0)
        });
    }
}
