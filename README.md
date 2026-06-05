# Neo X CCIP USDC Bridge

One-way test bridge from Ethereum Sepolia USDC to wrapped `xUSDC` on Neo X T4 using Chainlink CCIP arbitrary messaging.

## What This Builds

- `SourceBridge`: locks Circle testnet USDC on Ethereum Sepolia and sends a CCIP message.
- `DestinationBridge`: receives the CCIP message on Neo X T4 and mints `xUSDC`.
- `XUSDC`: 6-decimal wrapped ERC-20 minted only by `DestinationBridge`.
- Vite/React frontend: wallet connect, approval, bridge transaction, balances, and CCIP Explorer tracking.

## Assumptions

- This is a testnet lock-and-mint wrapper, not a native CCIP token pool.
- The initial direction is Ethereum Sepolia -> Neo X T4 only.
- CCIP fees are paid in native Sepolia ETH supplied by the caller.
- Neo X T4 CCIP router and chain selector are deployment-time config because Chainlink's dynamic testnet directory can change.
- Recipient addresses are EVM addresses. Neo X is EVM-compatible, so the same wallet address works if users do not override the recipient.

## Known Addresses

- Ethereum Sepolia CCIP router: `0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59`
- Ethereum Sepolia CCIP chain selector: `16015286601757825753`
- Circle Sepolia USDC: `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`
- Neo X T4 CCIP router: `0x609747816B6C237d5C4960065BC11d2F0DE752A6`
- Neo X T4 CCIP chain selector: `2217764097022649312`

## Local Setup

```bash
npm install
cp .env.example .env
npm run compile
npm run build:web
```

Fill `.env` with RPC URLs, deployer private key, Neo X T4 CCIP config, and deployed contract addresses.

## Deploy

Deploy the destination side first. The direct deploy scripts use compiled artifacts and explicit gas limits, which proved more reliable on Neo X T4 RPCs than Hardhat's network runner:

```bash
npm run deploy:destination:direct
```

Copy `destinationBridge` and `xusdc` from `deployments/neoXT4.json` into `.env`.

Deploy the source side:

```bash
npm run deploy:source:direct
```

Copy `sourceBridge` from `deployments/sepolia.json` into `.env`, then configure both endpoints:

```bash
npm run configure:source:direct
npm run configure:destination:direct
```

## Frontend Env

Set these for Railway:

```bash
VITE_SOURCE_BRIDGE_ADDRESS=
VITE_DESTINATION_BRIDGE_ADDRESS=
VITE_XUSDC_ADDRESS=
VITE_SEPOLIA_USDC=0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238
VITE_NEO_X_T4_CHAIN_SELECTOR=2217764097022649312
VITE_NEO_X_T4_CHAIN_ID=12227332
VITE_NEO_X_T4_RPC_URL=https://neoxt4seed1.ngd.network
VITE_NEO_X_T4_EXPLORER_URL=https://xt4scan.ngd.network
```

Railway commands:

- Build: `npm run build:web`
- Start: `npm start`

## Current Test Deployment

- Source bridge on Sepolia: `0xf5db348D2Ac393dCD4251D53b4ac4281d6Eb3beb`
- Destination bridge on Neo X T4: `0x3561F2fA2c57850b98472261E843D3720fC1B059`
- xUSDC on Neo X T4: `0xEa3E03b024b4F3267F1ad19335e82e3f6C9e8Be8`
- Smoke bridge tx: `0xdfae840ba92618e4e79d25470fee032955c60cef98729d973fc9471a29586f95`
- CCIP message ID: `0xb04f776db32eef58ecb53e726d24404dcca17c06e42d396541b94f6d3ad4e308`

At the time of testing, Chainlink reported the smoke message as `SENT`, not failed and not ready for manual execution. The test locked 1 USDC in the Sepolia source bridge while waiting for CCIP delivery.

## Bidirectional V2 Test Deployment

- v2 source/unlock bridge on Sepolia: `0x47a1086387be1ABFC8fFbC5C6AF6F7ccd6923479`
- v2 destination/mint-burn bridge on Neo X T4: `0xFa4f8B0A7d568C10436ca062313c8c21847bD49a`
- v2 xUSDC on Neo X T4: `0x699ae5149920772Da0aA99d4AE19C6b5F488825b`
- v2 forward message, 0.5 USDC -> xUSDC: `0x2ec8f8e5c44ba9998e5c7b42f9f7c8ea2091c8495f91eb0ac9c296400b2d03df`
- v2 return message, 0.5 xUSDC -> USDC: `0x3f94cc066f18f22bea1c90d837ab534eb1de0797456a2ec029934265676046a8`

The v2 return test completed successfully. The wallet's Sepolia USDC balance moved from `15.5` to `16.0` after burning 0.5 v2 xUSDC on Neo X T4.

## Safety Notes

This is suitable for testnet iteration. Before mainnet or public-value use, add rate limits, message replay accounting, emergency withdrawal rules, audits, and a redemption path from `xUSDC` back to Sepolia USDC.
