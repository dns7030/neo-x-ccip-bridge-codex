import { Contract, ContractFactory, JsonRpcProvider, Wallet } from "ethers";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { optionalEnv, requiredEnv } from "./env";

type Artifact = {
  abi: unknown[];
  bytecode: string;
};

function artifact(name: string): Artifact {
  return JSON.parse(readFileSync(`artifacts/contracts/${name}.sol/${name}.json`, "utf8"));
}

async function deploy(name: string, wallet: Wallet, args: unknown[], gasLimit: bigint) {
  const contractArtifact = artifact(name);
  const factory = new ContractFactory(contractArtifact.abi, contractArtifact.bytecode, wallet);
  const contract = await factory.deploy(...args, { gasLimit });
  const tx = contract.deploymentTransaction();
  console.log(`${name} tx: ${tx?.hash}`);
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  console.log(`${name}: ${address}`);
  return new Contract(address, contractArtifact.abi, wallet);
}

async function deployDestination() {
  const provider = new JsonRpcProvider(requiredEnv("NEO_X_T4_RPC_URL"), Number(optionalEnv("NEO_X_T4_CHAIN_ID", "12227332")));
  const wallet = new Wallet(requiredEnv("PRIVATE_KEY"), provider);
  const router = requiredEnv("NEO_X_T4_CCIP_ROUTER");

  const xusdc = await deploy("XUSDC", wallet, [wallet.address], 2_000_000n);
  const bridge = await deploy("DestinationBridge", wallet, [router, await xusdc.getAddress(), wallet.address], 2_500_000n);

  const role = await xusdc.MINTER_ROLE();
  const tx = await xusdc.grantRole(role, await bridge.getAddress(), { gasLimit: 100_000n });
  console.log(`grantRole tx: ${tx.hash}`);
  await tx.wait();

  const deployment = {
    network: "neoXT4",
    xusdc: await xusdc.getAddress(),
    destinationBridge: await bridge.getAddress()
  };
  mkdirSync("deployments", { recursive: true });
  writeFileSync("deployments/neoXT4.json", JSON.stringify(deployment, null, 2));
  console.log(JSON.stringify(deployment, null, 2));
}

async function deployDestinationV2() {
  const provider = new JsonRpcProvider(requiredEnv("NEO_X_T4_RPC_URL"), Number(optionalEnv("NEO_X_T4_CHAIN_ID", "12227332")));
  const wallet = new Wallet(requiredEnv("PRIVATE_KEY"), provider);
  const router = requiredEnv("NEO_X_T4_CCIP_ROUTER");

  const xusdc = await deploy("XUSDC", wallet, [wallet.address], 2_000_000n);
  const bridge = await deploy("BidirectionalDestinationBridge", wallet, [router, await xusdc.getAddress(), wallet.address], 3_000_000n);

  const role = await xusdc.MINTER_ROLE();
  const tx = await xusdc.grantRole(role, await bridge.getAddress(), { gasLimit: 100_000n });
  console.log(`grantRole tx: ${tx.hash}`);
  await tx.wait();

  const deployment = {
    network: "neoXT4",
    xusdc: await xusdc.getAddress(),
    destinationBridge: await bridge.getAddress()
  };
  mkdirSync("deployments", { recursive: true });
  writeFileSync("deployments/neoXT4-v2.json", JSON.stringify(deployment, null, 2));
  console.log(JSON.stringify(deployment, null, 2));
}

async function deploySource() {
  const provider = new JsonRpcProvider(requiredEnv("SEPOLIA_RPC_URL"), 11155111);
  const wallet = new Wallet(requiredEnv("PRIVATE_KEY"), provider);
  const router = optionalEnv("SEPOLIA_CCIP_ROUTER", "0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59");
  const usdc = optionalEnv("SEPOLIA_USDC", "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238");

  const bridge = await deploy("SourceBridge", wallet, [router, usdc, wallet.address], 2_500_000n);

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

async function deploySourceV2() {
  const provider = new JsonRpcProvider(requiredEnv("SEPOLIA_RPC_URL"), 11155111);
  const wallet = new Wallet(requiredEnv("PRIVATE_KEY"), provider);
  const router = optionalEnv("SEPOLIA_CCIP_ROUTER", "0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59");
  const usdc = optionalEnv("SEPOLIA_USDC", "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238");

  const bridge = await deploy("BidirectionalSourceBridge", wallet, [router, usdc, wallet.address], 3_000_000n);

  const deployment = {
    network: "sepolia",
    sourceBridge: await bridge.getAddress(),
    usdc,
    router
  };
  mkdirSync("deployments", { recursive: true });
  writeFileSync("deployments/sepolia-v2.json", JSON.stringify(deployment, null, 2));
  console.log(JSON.stringify(deployment, null, 2));
}

async function configureSource() {
  const provider = new JsonRpcProvider(requiredEnv("SEPOLIA_RPC_URL"), 11155111);
  const wallet = new Wallet(requiredEnv("PRIVATE_KEY"), provider);
  const bridge = new Contract(requiredEnv("SOURCE_BRIDGE_ADDRESS"), artifact("SourceBridge").abi, wallet);
  const tx = await bridge.setDestination(requiredEnv("NEO_X_T4_CHAIN_SELECTOR"), requiredEnv("DESTINATION_BRIDGE_ADDRESS"), {
    gasLimit: 120_000n
  });
  console.log(`configure source tx: ${tx.hash}`);
  await tx.wait();
}

async function configureSourceV2() {
  const provider = new JsonRpcProvider(requiredEnv("SEPOLIA_RPC_URL"), 11155111);
  const wallet = new Wallet(requiredEnv("PRIVATE_KEY"), provider);
  const bridge = new Contract(requiredEnv("SOURCE_BRIDGE_ADDRESS"), artifact("BidirectionalSourceBridge").abi, wallet);
  const tx = await bridge.setRemoteBridge(requiredEnv("NEO_X_T4_CHAIN_SELECTOR"), requiredEnv("DESTINATION_BRIDGE_ADDRESS"), {
    gasLimit: 120_000n
  });
  console.log(`configure source v2 tx: ${tx.hash}`);
  await tx.wait();
}

async function configureDestination() {
  const provider = new JsonRpcProvider(requiredEnv("NEO_X_T4_RPC_URL"), Number(optionalEnv("NEO_X_T4_CHAIN_ID", "12227332")));
  const wallet = new Wallet(requiredEnv("PRIVATE_KEY"), provider);
  const bridge = new Contract(requiredEnv("DESTINATION_BRIDGE_ADDRESS"), artifact("DestinationBridge").abi, wallet);
  const tx = await bridge.setSource(requiredEnv("SEPOLIA_CHAIN_SELECTOR"), requiredEnv("SOURCE_BRIDGE_ADDRESS"), {
    gasLimit: 120_000n
  });
  console.log(`configure destination tx: ${tx.hash}`);
  await tx.wait();
}

async function configureDestinationV2() {
  const provider = new JsonRpcProvider(requiredEnv("NEO_X_T4_RPC_URL"), Number(optionalEnv("NEO_X_T4_CHAIN_ID", "12227332")));
  const wallet = new Wallet(requiredEnv("PRIVATE_KEY"), provider);
  const bridge = new Contract(requiredEnv("DESTINATION_BRIDGE_ADDRESS"), artifact("BidirectionalDestinationBridge").abi, wallet);
  const tx = await bridge.setRemoteBridge(requiredEnv("SEPOLIA_CHAIN_SELECTOR"), requiredEnv("SOURCE_BRIDGE_ADDRESS"), {
    gasLimit: 120_000n
  });
  console.log(`configure destination v2 tx: ${tx.hash}`);
  await tx.wait();
}

async function main() {
  const action = process.argv[2];
  if (action === "destination") return deployDestination();
  if (action === "destination-v2") return deployDestinationV2();
  if (action === "source") return deploySource();
  if (action === "source-v2") return deploySourceV2();
  if (action === "configure-source") return configureSource();
  if (action === "configure-source-v2") return configureSourceV2();
  if (action === "configure-destination") return configureDestination();
  if (action === "configure-destination-v2") return configureDestinationV2();
  throw new Error("Usage: tsx scripts/deploy-direct.ts destination|destination-v2|source|source-v2|configure-source|configure-source-v2|configure-destination|configure-destination-v2");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
