import { ethers } from "hardhat";
import { mkdirSync, writeFileSync } from "node:fs";
import { optionalEnv, requiredEnv } from "./env";

async function main() {
  const [deployer] = await ethers.getSigners();

  const router = optionalEnv("SEPOLIA_CCIP_ROUTER", "0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59");
  const usdc = optionalEnv("SEPOLIA_USDC", "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238");

  console.log(`Deploying Sepolia source as ${deployer.address}`);

  const SourceBridge = await ethers.getContractFactory("SourceBridge");
  const bridge = await SourceBridge.deploy(router, usdc, deployer.address);
  await bridge.waitForDeployment();

  const neoSelector = process.env.NEO_X_T4_CHAIN_SELECTOR;
  const destinationBridge = process.env.DESTINATION_BRIDGE_ADDRESS;
  if (neoSelector && destinationBridge) {
    const tx = await bridge.setDestination(neoSelector, destinationBridge);
    await tx.wait();
  } else {
    console.warn("Destination not configured. Set NEO_X_T4_CHAIN_SELECTOR and DESTINATION_BRIDGE_ADDRESS, then call setDestination.");
  }

  const deployment = {
    network: "sepolia",
    sourceBridge: await bridge.getAddress(),
    usdc,
    router
  };

  mkdirSync("deployments", { recursive: true });
  writeFileSync("deployments/sepolia.json", JSON.stringify(deployment, null, 2));
  console.log(JSON.stringify(deployment, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
