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

async function main() {
  const amount = parseUnits(optionalEnv("BRIDGE_AMOUNT_USDC", "1"), 6);
  const sepolia = new JsonRpcProvider(requiredEnv("SEPOLIA_RPC_URL"), 11155111);
  const neo = new JsonRpcProvider(requiredEnv("NEO_X_T4_RPC_URL"), Number(optionalEnv("NEO_X_T4_CHAIN_ID", "12227332")));
  const wallet = new Wallet(requiredEnv("PRIVATE_KEY"), sepolia);
  const recipient = optionalEnv("RECIPIENT_ADDRESS", wallet.address);

  const usdc = new Contract(requiredEnv("SEPOLIA_USDC"), erc20Abi, wallet);
  const sourceBridge = new Contract(requiredEnv("SOURCE_BRIDGE_ADDRESS"), abi("SourceBridge"), wallet);
  const xusdc = new Contract(requiredEnv("XUSDC_ADDRESS"), erc20Abi, neo);

  const before = await xusdc.balanceOf(recipient);
  console.log(`Recipient: ${recipient}`);
  console.log(`xUSDC before: ${formatUnits(before, 6)}`);

  const allowance = await usdc.allowance(wallet.address, requiredEnv("SOURCE_BRIDGE_ADDRESS"));
  if (allowance < amount) {
    const approveTx = await usdc.approve(requiredEnv("SOURCE_BRIDGE_ADDRESS"), amount);
    console.log(`approve tx: ${approveTx.hash}`);
    await approveTx.wait();
  }

  const fee = await sourceBridge.getBridgeFee(amount, wallet.address, recipient);
  console.log(`CCIP native fee: ${fee.toString()} wei`);
  const bridgeTx = await sourceBridge.bridge(amount, recipient, { value: fee });
  console.log(`bridge tx: ${bridgeTx.hash}`);
  const receipt = await bridgeTx.wait();

  const parsed = receipt.logs
    .map((log: any) => {
      try {
        return sourceBridge.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find((event: any) => event?.name === "BridgeRequested");
  const messageId = parsed?.args?.messageId;
  console.log(`message id: ${messageId || "not found"}`);

  for (let i = 0; i < 40; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 15_000));
    const current = await xusdc.balanceOf(recipient);
    console.log(`xUSDC poll ${i + 1}: ${formatUnits(current, 6)}`);
    if (current >= before + amount) return;
  }

  throw new Error("Timed out waiting for xUSDC mint");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
