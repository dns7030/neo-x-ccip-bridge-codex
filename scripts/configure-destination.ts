import { ethers } from "hardhat";
import { requiredEnv } from "./env";

async function main() {
  const destinationBridge = await ethers.getContractAt("DestinationBridge", requiredEnv("DESTINATION_BRIDGE_ADDRESS"));
  const tx = await destinationBridge.setSource(
    requiredEnv("SEPOLIA_CHAIN_SELECTOR"),
    requiredEnv("SOURCE_BRIDGE_ADDRESS")
  );
  await tx.wait();
  console.log("Destination bridge source configured.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
