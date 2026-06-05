import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { ArrowRightLeft, CheckCircle2, CircleAlert, Clock, ExternalLink, Loader2, Wallet } from "lucide-react";
import { BrowserProvider, Contract, JsonRpcProvider, formatUnits, parseUnits } from "ethers";
import { NEO_X_T4, SEPOLIA, config, erc20Abi, sourceBridgeAbi } from "./contracts";
import "./styles.css";

declare global {
  interface Window {
    ethereum?: any;
  }
}

type TxState = "idle" | "approving" | "bridging" | "done";

type Tracker = {
  submittedAt: number;
  sourceTxHash: string;
  messageId: string;
};

function shortAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function isAddressLike(value: string) {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

function formatElapsed(startedAt: number, now: number) {
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${remainder.toString().padStart(2, "0")}`;
}

function formatSubmittedAt(value: number) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(value);
}

function App() {
  const [account, setAccount] = useState("");
  const [amount, setAmount] = useState("");
  const [recipient, setRecipient] = useState("");
  const [sourceBalance, setSourceBalance] = useState("0");
  const [destinationBalance, setDestinationBalance] = useState("0");
  const [messageId, setMessageId] = useState("");
  const [tracker, setTracker] = useState<Tracker | null>(null);
  const [now, setNow] = useState(Date.now());
  const [status, setStatus] = useState<TxState>("idle");
  const [error, setError] = useState("");

  const ready = config.sourceBridge && config.destinationBridge && config.xusdc && config.sepoliaUsdc;
  const targetRecipient = recipient || account;

  const sepoliaProvider = useMemo(() => new JsonRpcProvider(SEPOLIA.rpcUrl), []);
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

    const usdc = new Contract(config.sepoliaUsdc, erc20Abi, sepoliaProvider);
    const sourceRaw = await usdc.balanceOf(account);
    setSourceBalance(formatUnits(sourceRaw, 6));

    if (neoProvider && config.xusdc) {
      const xusdc = new Contract(config.xusdc, erc20Abi, neoProvider);
      const destinationRaw = await xusdc.balanceOf(account);
      setDestinationBalance(formatUnits(destinationRaw, 6));
    }
  }, [account, neoProvider, ready, sepoliaProvider]);

  useEffect(() => {
    refreshBalances().catch(() => undefined);
  }, [refreshBalances]);

  useEffect(() => {
    if (!tracker || status === "done") return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [status, tracker]);

  const bridge = useCallback(async () => {
    setError("");
    setMessageId("");
    setTracker(null);
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

    try {
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
      setNow(Date.now());
      setTracker({ submittedAt: Date.now(), sourceTxHash: tx.hash, messageId: "" });

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

      if (event) {
        const nextMessageId = event.args.messageId;
        setMessageId(nextMessageId);
        setTracker((current) => current && { ...current, messageId: nextMessageId });
      }
      setStatus("done");
      await refreshBalances();
    } catch (caught) {
      const reason = caught instanceof Error ? caught.message : "Transaction failed.";
      setError(reason);
      setStatus("idle");
    }
  }, [amount, ready, refreshBalances, switchToSepolia, targetRecipient]);

  const ccipUrl = messageId ? `https://ccip.chain.link/msg/${messageId}` : "";
  const sourceTxUrl = tracker?.sourceTxHash ? `${SEPOLIA.explorer}/tx/${tracker.sourceTxHash}` : "";

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
            {tracker && (
              <div className="tracker">
                <div className="tracker-head">
                  <span>
                    <Clock size={16} />
                    Submitted {formatSubmittedAt(tracker.submittedAt)}
                  </span>
                  <strong>{formatElapsed(tracker.submittedAt, now)}</strong>
                </div>
                <div className="tracker-links">
                  <a href={sourceTxUrl} target="_blank" rel="noreferrer">
                    Sepolia tx
                    <ExternalLink size={15} />
                  </a>
                  {tracker.messageId ? (
                    <a href={`https://ccip.chain.link/msg/${tracker.messageId}`} target="_blank" rel="noreferrer">
                      CCIP message
                      <ExternalLink size={15} />
                    </a>
                  ) : (
                    <span>Waiting for message ID</span>
                  )}
                </div>
              </div>
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
