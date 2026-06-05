export const SEPOLIA = {
  chainId: 11155111,
  chainIdHex: "0xaa36a7",
  name: "Ethereum Sepolia",
  explorer: "https://sepolia.etherscan.io",
  rpcUrl: import.meta.env.VITE_SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com"
};

export const NEO_X_T4 = {
  chainId: Number(import.meta.env.VITE_NEO_X_T4_CHAIN_ID || 12227332),
  chainIdHex: `0x${Number(import.meta.env.VITE_NEO_X_T4_CHAIN_ID || 12227332).toString(16)}`,
  name: "Neo X T4",
  explorer: import.meta.env.VITE_NEO_X_T4_EXPLORER_URL || "https://xt4scan.ngd.network",
  rpcUrl: import.meta.env.VITE_NEO_X_T4_RPC_URL || "https://neoxt4seed1.ngd.network"
};

export const config = {
  sourceBridge: import.meta.env.VITE_SOURCE_BRIDGE_ADDRESS || "",
  destinationBridge: import.meta.env.VITE_DESTINATION_BRIDGE_ADDRESS || "",
  xusdc: import.meta.env.VITE_XUSDC_ADDRESS || "",
  sepoliaUsdc: import.meta.env.VITE_SEPOLIA_USDC || "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238"
};

export const erc20Abi = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner,address spender) view returns (uint256)",
  "function approve(address spender,uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)"
];

export const sourceBridgeAbi = [
  "function bridge(uint256 amount,address recipient) returns (bytes32)",
  "function getBridgeFee(uint256 amount,address sender,address recipient) view returns (uint256)",
  "function destinationChainSelector() view returns (uint64)",
  "function destinationReceiver() view returns (address)",
  "event BridgeRequested(bytes32 indexed messageId,address indexed sender,address indexed recipient,uint256 amount,uint256 fee)"
];

export const destinationBridgeAbi = [
  "function bridgeBack(uint256 amount,address recipient) returns (bytes32)",
  "function getReturnFee(uint256 amount,address sender,address recipient) view returns (uint256)",
  "event ReturnRequested(bytes32 indexed messageId,address indexed sender,address indexed recipient,uint256 amount,uint256 fee)"
];
