import { ethers } from "hardhat";
import { mkdirSync, writeFileSync } from "node:fs";
import { requiredEnv } from "./env";

async function main() {
  const [deployer] = await ethers.getSigners();
  const router = requiredEnv("NEO_X_T4_CCIP_ROUTER");

  console.log(`Deploying Neo X destination as ${deployer.address}`);

  const XUSDC = await ethers.getContractFactory("XUSDC");
  const xusdc = await XUSDC.deploy(deployer.address);
  await xusdc.waitForDeployment();

  const DestinationBridge = await ethers.getContractFactory("DestinationBridge");
  const bridge = await DestinationBridge.deploy(router, await xusdc.getAddress(), deployer.address);
  await bridge.waitForDeployment();

  const minterRole = await xusdc.MINTER_ROLE();
  const grantTx = await xusdc.grantRole(minterRole, await bridge.getAddress());
  await grantTx.wait();

  const deployment = {
    network: "neoXT4",
    xusdc: await xusdc.getAddress(),
    destinationBridge: await bridge.getAddress()
  };

  mkdirSync("deployments", { recursive: true });
  writeFileSync("deployments/neoXT4.json", JSON.stringify(deployment, null, 2));
  console.log(JSON.stringify(deployment, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
