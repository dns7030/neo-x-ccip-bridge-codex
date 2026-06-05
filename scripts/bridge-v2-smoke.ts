import { Contract, JsonRpcProvider, Wallet, formatUnits, parseUnits } from "ethers";
import { readFileSync } from "node:fs";
import { optionalEnv, requiredEnv } from "./env";

const erc20Abi = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner,address spender) view returns (uint256)",
  "function approve(address spender,uint256 amount) returns (bool)"
];

function abi(name: string) {
  return JSON.parse(readFileSync(`artifacts/contracts/${name}.sol/${name}.json`, "utf8")).abi;
}

async function waitForBalance(
  token: Contract,
  account: string,
  target: bigint,
  label: string,
  polls = 80
) {
  for (let i = 0; i < polls; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 15_000));
    const current = await token.balanceOf(account);
    console.log(`${label} poll ${i + 1}: ${formatUnits(current, 6)}`);
    if (current >= target) return current;
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function sendForward() {
  const amount = parseUnits(optionalEnv("BRIDGE_AMOUNT_USDC", "0.5"), 6);
  const sepolia = new JsonRpcProvider(requiredEnv("SEPOLIA_RPC_URL"), 11155111);
  const neo = new JsonRpcProvider(requiredEnv("NEO_X_T4_RPC_URL"), Number(optionalEnv("NEO_X_T4_CHAIN_ID", "12227332")));
  const wallet = new Wallet(requiredEnv("PRIVATE_KEY"), sepolia);
  const recipient = optionalEnv("RECIPIENT_ADDRESS", wallet.address);

  const usdc = new Contract(requiredEnv("SEPOLIA_USDC"), erc20Abi, wallet);
  const sourceBridge = new Contract(requiredEnv("SOURCE_BRIDGE_ADDRESS"), abi("BidirectionalSourceBridge"), wallet);
  const xusdc = new Contract(requiredEnv("XUSDC_ADDRESS"), erc20Abi, neo);

  const before = await xusdc.balanceOf(recipient);
  console.log(`xUSDC before: ${formatUnits(before, 6)}`);

  const allowance = await usdc.allowance(wallet.address, requiredEnv("SOURCE_BRIDGE_ADDRESS"));
  if (allowance < amount) {
    const approveTx = await usdc.approve(requiredEnv("SOURCE_BRIDGE_ADDRESS"), amount);
    console.log(`approve USDC tx: ${approveTx.hash}`);
    await approveTx.wait();
  }

  const fee = await sourceBridge.getBridgeFee(amount, wallet.address, recipient);
  console.log(`forward fee: ${fee.toString()} wei`);
  const tx = await sourceBridge.bridge(amount, recipient, { value: fee });
  console.log(`forward bridge tx: ${tx.hash}`);
  const receipt = await tx.wait();
  const event = receipt.logs.map((log: any) => {
    try {
      return sourceBridge.interface.parseLog(log);
    } catch {
      return null;
    }
  }).find((parsed: any) => parsed?.name === "BridgeRequested");
  console.log(`forward message id: ${event?.args?.messageId || "not found"}`);

  await waitForBalance(xusdc, recipient, before + amount, "xUSDC");
}

async function sendBack() {
  const amount = parseUnits(optionalEnv("BRIDGE_AMOUNT_USDC", "0.5"), 6);
  const sepolia = new JsonRpcProvider(requiredEnv("SEPOLIA_RPC_URL"), 11155111);
  const neo = new JsonRpcProvider(requiredEnv("NEO_X_T4_RPC_URL"), Number(optionalEnv("NEO_X_T4_CHAIN_ID", "12227332")));
  const neoWallet = new Wallet(requiredEnv("PRIVATE_KEY"), neo);
  const recipient = optionalEnv("RECIPIENT_ADDRESS", neoWallet.address);

  const usdc = new Contract(requiredEnv("SEPOLIA_USDC"), erc20Abi, sepolia);
  const xusdc = new Contract(requiredEnv("XUSDC_ADDRESS"), erc20Abi, neoWallet);
  const destinationBridge = new Contract(
    requiredEnv("DESTINATION_BRIDGE_ADDRESS"),
    abi("BidirectionalDestinationBridge"),
    neoWallet
  );

  const beforeUsdc = await usdc.balanceOf(recipient);
  console.log(`USDC before: ${formatUnits(beforeUsdc, 6)}`);

  const allowance = await xusdc.allowance(neoWallet.address, requiredEnv("DESTINATION_BRIDGE_ADDRESS"));
  if (allowance < amount) {
    const approveTx = await xusdc.approve(requiredEnv("DESTINATION_BRIDGE_ADDRESS"), amount, { gasLimit: 80_000n });
    console.log(`approve xUSDC tx: ${approveTx.hash}`);
    await approveTx.wait();
  }

  const fee = await destinationBridge.getReturnFee(amount, neoWallet.address, recipient);
  console.log(`return fee: ${fee.toString()} wei`);
  const tx = await destinationBridge.bridgeBack(amount, recipient, { value: fee, gasLimit: 500_000n });
  console.log(`return bridge tx: ${tx.hash}`);
  const receipt = await tx.wait();
  const event = receipt.logs.map((log: any) => {
    try {
      return destinationBridge.interface.parseLog(log);
    } catch {
      return null;
    }
  }).find((parsed: any) => parsed?.name === "ReturnRequested");
  console.log(`return message id: ${event?.args?.messageId || "not found"}`);

  await waitForBalance(usdc, recipient, beforeUsdc + amount, "USDC", 80);
}

async function main() {
  const action = process.argv[2];
  if (action === "forward") return sendForward();
  if (action === "back") return sendBack();
  throw new Error("Usage: tsx scripts/bridge-v2-smoke.ts forward|back");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
