import { ethers } from "hardhat";
import { requiredEnv } from "./env";

async function main() {
  const sourceBridge = await ethers.getContractAt("SourceBridge", requiredEnv("SOURCE_BRIDGE_ADDRESS"));
  const tx = await sourceBridge.setDestination(
    requiredEnv("NEO_X_T4_CHAIN_SELECTOR"),
    requiredEnv("DESTINATION_BRIDGE_ADDRESS")
  );
  await tx.wait();
  console.log("Source bridge destination configured.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
