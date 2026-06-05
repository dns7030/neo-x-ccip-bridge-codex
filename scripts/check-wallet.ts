import { ethers } from "ethers";
import { optionalEnv, requiredEnv } from "./env";

const erc20Abi = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)"
];

async function tokenBalance(provider: ethers.Provider, token: string, account: string) {
  const contract = new ethers.Contract(token, erc20Abi, provider);
  const [balance, decimals, symbol] = await Promise.all([
    contract.balanceOf(account),
    contract.decimals(),
    contract.symbol()
  ]);
  return `${ethers.formatUnits(balance, decimals)} ${symbol}`;
}

async function main() {
  const wallet = new ethers.Wallet(requiredEnv("PRIVATE_KEY"));
  const sepolia = new ethers.JsonRpcProvider(requiredEnv("SEPOLIA_RPC_URL"));
  const neo = new ethers.JsonRpcProvider(requiredEnv("NEO_X_T4_RPC_URL"));

  const sepoliaUsdc = optionalEnv("SEPOLIA_USDC", "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238");
  const sepoliaLink = optionalEnv("SEPOLIA_LINK_TOKEN", "0x779877A7B0D9E8603169DdbD7836e478b4624789");

  const [sepoliaEth, neoGas, usdc, link] = await Promise.all([
    sepolia.getBalance(wallet.address),
    neo.getBalance(wallet.address),
    tokenBalance(sepolia, sepoliaUsdc, wallet.address),
    tokenBalance(sepolia, sepoliaLink, wallet.address)
  ]);

  console.log(`Wallet: ${wallet.address}`);
  console.log(`Sepolia ETH: ${ethers.formatEther(sepoliaEth)}`);
  console.log(`Neo X GAS: ${ethers.formatEther(neoGas)}`);
  console.log(`Sepolia USDC: ${usdc}`);
  console.log(`Sepolia LINK: ${link}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
