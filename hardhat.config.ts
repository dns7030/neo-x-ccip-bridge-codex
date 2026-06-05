import "@nomicfoundation/hardhat-toolbox";
import { HardhatUserConfig } from "hardhat/config";

const privateKey = process.env.PRIVATE_KEY;

const accounts = privateKey ? [privateKey] : [];

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      }
    }
  },
  networks: {
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL || "",
      accounts,
      chainId: 11155111
    },
    neoXT4: {
      url: process.env.NEO_X_T4_RPC_URL || "",
      accounts,
      chainId: Number(process.env.NEO_X_T4_CHAIN_ID || 12227332)
    }
  }
};

export default config;
