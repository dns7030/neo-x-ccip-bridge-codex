import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const contracts = ["SourceBridge", "DestinationBridge", "XUSDC"];
mkdirSync("src/abi", { recursive: true });

for (const contract of contracts) {
  const artifact = JSON.parse(readFileSync(`artifacts/contracts/${contract}.sol/${contract}.json`, "utf8"));
  writeFileSync(`src/abi/${contract}.json`, `${JSON.stringify(artifact.abi, null, 2)}\n`);
}
