// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Client} from "@chainlink/contracts-ccip/contracts/libraries/Client.sol";
import {IRouterClient} from "@chainlink/contracts-ccip/contracts/interfaces/IRouterClient.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract SourceBridge is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    error AmountIsZero();
    error DestinationNotConfigured();
    error ReceiverNotConfigured();
    error NothingToWithdraw();
    error InsufficientFee(uint256 requiredFee, uint256 suppliedFee);
    error RefundFailed();

    event BridgeRequested(
        bytes32 indexed messageId,
        address indexed sender,
        address indexed recipient,
        uint256 amount,
        uint256 fee
    );
    event DestinationUpdated(uint64 destinationChainSelector, address destinationReceiver);

    IERC20 public immutable usdc;
    IRouterClient public immutable router;

    uint64 public destinationChainSelector;
    address public destinationReceiver;

    constructor(address router_, address usdc_, address owner_) Ownable(owner_) {
        router = IRouterClient(router_);
        usdc = IERC20(usdc_);
    }

    function setDestination(uint64 selector, address receiver) external onlyOwner {
        if (selector == 0) revert DestinationNotConfigured();
        if (receiver == address(0)) revert ReceiverNotConfigured();

        destinationChainSelector = selector;
        destinationReceiver = receiver;
        emit DestinationUpdated(selector, receiver);
    }

    function getBridgeFee(uint256 amount, address sender, address recipient) external view returns (uint256) {
        if (destinationChainSelector == 0) revert DestinationNotConfigured();
        if (destinationReceiver == address(0)) revert ReceiverNotConfigured();
        if (recipient == address(0)) recipient = sender;

        Client.EVM2AnyMessage memory message = _buildMessage(sender, recipient, amount);
        return router.getFee(destinationChainSelector, message);
    }

    function bridge(uint256 amount, address recipient) external payable whenNotPaused nonReentrant returns (bytes32 messageId) {
        if (amount == 0) revert AmountIsZero();
        if (destinationChainSelector == 0) revert DestinationNotConfigured();
        if (destinationReceiver == address(0)) revert ReceiverNotConfigured();
        if (recipient == address(0)) recipient = msg.sender;

        Client.EVM2AnyMessage memory message = _buildMessage(msg.sender, recipient, amount);

        uint256 fee = router.getFee(destinationChainSelector, message);
        if (msg.value < fee) revert InsufficientFee(fee, msg.value);

        usdc.safeTransferFrom(msg.sender, address(this), amount);

        messageId = router.ccipSend{value: fee}(destinationChainSelector, message);

        if (msg.value > fee) {
            (bool success,) = msg.sender.call{value: msg.value - fee}("");
            if (!success) revert RefundFailed();
        }

        emit BridgeRequested(messageId, msg.sender, recipient, amount, fee);
    }

    function _buildMessage(address sender, address recipient, uint256 amount) internal view returns (Client.EVM2AnyMessage memory) {
        return Client.EVM2AnyMessage({
            receiver: abi.encode(destinationReceiver),
            data: abi.encode(sender, recipient, amount),
            tokenAmounts: new Client.EVMTokenAmount[](0),
            extraArgs: Client._argsToBytes(Client.EVMExtraArgsV1({gasLimit: 200_000})),
            feeToken: address(0)
        });
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function withdrawFees(address payable to) external onlyOwner {
        uint256 balance = address(this).balance;
        if (balance == 0) revert NothingToWithdraw();
        (bool success,) = to.call{value: balance}("");
        if (!success) revert RefundFailed();
    }
}
