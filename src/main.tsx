import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { ArrowRightLeft, CheckCircle2, CircleAlert, ExternalLink, Loader2, Wallet } from "lucide-react";
import { BrowserProvider, Contract, JsonRpcProvider, formatUnits, parseUnits } from "ethers";
import { NEO_X_T4, SEPOLIA, config, erc20Abi, sourceBridgeAbi } from "./contracts";
import "./styles.css";

declare global {
  interface Window {
    ethereum?: any;
  }
}

type TxState = "idle" | "approving" | "bridging" | "done";

function shortAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function isAddressLike(value: string) {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

function App() {
  const [account, setAccount] = useState("");
  const [amount, setAmount] = useState("");
  const [recipient, setRecipient] = useState("");
  const [sourceBalance, setSourceBalance] = useState("0");
  const [destinationBalance, setDestinationBalance] = useState("0");
  const [messageId, setMessageId] = useState("");
  const [status, setStatus] = useState<TxState>("idle");
  const [error, setError] = useState("");

  const ready = config.sourceBridge && config.destinationBridge && config.xusdc && config.sepoliaUsdc;
  const targetRecipient = recipient || account;

  const neoProvider = useMemo(() => {
    if (!NEO_X_T4.rpcUrl) return null;
    return new JsonRpcProvider(NEO_X_T4.rpcUrl);
  }, []);

  const connect = useCallback(async () => {
    setError("");
    if (!window.ethereum) {
      setError("Install MetaMask or another EIP-1193 wallet.");
      return;
    }
    const [selected] = await window.ethereum.request({ method: "eth_requestAccounts" });
    setAccount(selected);
    setRecipient(selected);
  }, []);

  const switchToSepolia = useCallback(async () => {
    if (!window.ethereum) return;
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: SEPOLIA.chainIdHex }]
    });
  }, []);

  const refreshBalances = useCallback(async () => {
    if (!account || !window.ethereum || !ready) return;

    const browserProvider = new BrowserProvider(window.ethereum);
    const usdc = new Contract(config.sepoliaUsdc, erc20Abi, browserProvider);
    const sourceRaw = await usdc.balanceOf(account);
    setSourceBalance(formatUnits(sourceRaw, 6));

    if (neoProvider && config.xusdc) {
      const xusdc = new Contract(config.xusdc, erc20Abi, neoProvider);
      const destinationRaw = await xusdc.balanceOf(account);
      setDestinationBalance(formatUnits(destinationRaw, 6));
    }
  }, [account, neoProvider, ready]);

  useEffect(() => {
    refreshBalances().catch(() => undefined);
  }, [refreshBalances]);

  const bridge = useCallback(async () => {
    setError("");
    setMessageId("");
    if (!ready) {
      setError("Bridge addresses are missing. Set the VITE_* env vars before deploying the frontend.");
      return;
    }
    if (!amount || Number(amount) <= 0) {
      setError("Enter a USDC amount.");
      return;
    }
    if (!isAddressLike(targetRecipient)) {
      setError("Recipient must be an EVM address.");
      return;
    }

    await switchToSepolia();

    const provider = new BrowserProvider(window.ethereum);
    const signer = await provider.getSigner();
    const owner = await signer.getAddress();
    const parsed = parseUnits(amount, 6);

    const usdc = new Contract(config.sepoliaUsdc, erc20Abi, signer);
    const allowance = await usdc.allowance(owner, config.sourceBridge);
    if (allowance < parsed) {
      setStatus("approving");
      const approveTx = await usdc.approve(config.sourceBridge, parsed);
      await approveTx.wait();
    }

    setStatus("bridging");
    const sourceBridge = new Contract(config.sourceBridge, sourceBridgeAbi, signer);
    const fee = await sourceBridge.getBridgeFee(parsed, owner, targetRecipient);
    const tx = await sourceBridge.bridge(parsed, targetRecipient, { value: fee });
    const receipt = await tx.wait();
    const event = receipt.logs
      .map((log: any) => {
        try {
          return sourceBridge.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((parsedLog: any) => parsedLog?.name === "BridgeRequested");

    if (event) setMessageId(event.args.messageId);
    setStatus("done");
    await refreshBalances();
  }, [amount, ready, refreshBalances, switchToSepolia, targetRecipient]);

  const ccipUrl = messageId ? `https://ccip.chain.link/msg/${messageId}` : "";

  return (
    <main>
      <section className="shell">
        <header className="topbar">
          <div>
            <p className="eyebrow">CCIP test bridge</p>
            <h1>USDC to xUSDC</h1>
          </div>
          <button className="wallet" onClick={connect}>
            <Wallet size={18} />
            {account ? shortAddress(account) : "Connect"}
          </button>
        </header>

        <div className="grid">
          <section className="panel bridge-panel">
            <div className="route">
              <div>
                <span>From</span>
                <strong>Ethereum Sepolia</strong>
              </div>
              <ArrowRightLeft aria-hidden size={22} />
              <div>
                <span>To</span>
                <strong>Neo X T4</strong>
              </div>
            </div>

            <label>
              Amount
              <div className="input-row">
                <input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" />
                <span>USDC</span>
              </div>
            </label>

            <label>
              Recipient
              <input value={recipient} onChange={(event) => setRecipient(event.target.value)} placeholder={account || "0x..."} />
            </label>

            <button className="primary" onClick={bridge} disabled={!account || status === "approving" || status === "bridging"}>
              {(status === "approving" || status === "bridging") && <Loader2 className="spin" size={18} />}
              {status === "approving" ? "Approving USDC" : status === "bridging" ? "Sending CCIP message" : "Bridge to Neo X"}
            </button>

            {messageId && (
              <a className="message" href={ccipUrl} target="_blank" rel="noreferrer">
                <CheckCircle2 size={18} />
                Track CCIP message
                <ExternalLink size={16} />
              </a>
            )}
            {error && (
              <p className="error">
                <CircleAlert size={18} />
                {error}
              </p>
            )}
          </section>

          <aside className="panel">
            <h2>Balances</h2>
            <div className="balance-row">
              <span>Sepolia USDC</span>
              <strong>{sourceBalance}</strong>
            </div>
            <div className="balance-row">
              <span>Neo X xUSDC</span>
              <strong>{destinationBalance}</strong>
            </div>
            <button className="secondary" onClick={refreshBalances} disabled={!account}>
              Refresh
            </button>

            <h2>Deployment</h2>
            <ul className="status-list">
              <li className={config.sourceBridge ? "ok" : ""}>Source bridge</li>
              <li className={config.destinationBridge ? "ok" : ""}>Destination bridge</li>
              <li className={config.xusdc ? "ok" : ""}>xUSDC token</li>
              <li className={NEO_X_T4.rpcUrl ? "ok" : ""}>Neo X RPC</li>
            </ul>
          </aside>
        </div>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
