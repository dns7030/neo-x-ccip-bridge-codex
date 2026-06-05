import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { ArrowRightLeft, CheckCircle2, CircleAlert, Clock, ExternalLink, Loader2, Wallet } from "lucide-react";
import { BrowserProvider, Contract, JsonRpcProvider, formatUnits, parseUnits } from "ethers";
import { NEO_X_T4, SEPOLIA, config, destinationBridgeAbi, erc20Abi, sourceBridgeAbi } from "./contracts";
import "./styles.css";

declare global {
  interface Window {
    ethereum?: any;
  }
}

type TxState = "idle" | "approving" | "bridging" | "done";
type Direction = "forward" | "reverse";

type Tracker = {
  id: string;
  direction: Direction;
  amount: string;
  submittedAt: number;
  originTxHash: string;
  messageId: string;
};

const HISTORY_KEY = "neo-x-ccip-bridge-history";

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

function originExplorer(direction: Direction) {
  return direction === "forward" ? SEPOLIA.explorer : NEO_X_T4.explorer;
}

function originLabel(direction: Direction) {
  return direction === "forward" ? "Sepolia tx" : "Neo X tx";
}

function routeLabel(direction: Direction) {
  return direction === "forward" ? "Sepolia -> Neo X" : "Neo X -> Sepolia";
}

function readHistory(): Tracker[] {
  try {
    return JSON.parse(window.localStorage.getItem(HISTORY_KEY) || "[]");
  } catch {
    return [];
  }
}

function writeHistory(items: Tracker[]) {
  window.localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, 12)));
}

function mergeHistory(...lists: Tracker[][]) {
  const byId = new Map<string, Tracker>();
  for (const list of lists) {
    for (const item of list) {
      const existing = byId.get(item.id);
      byId.set(item.id, {
        ...existing,
        ...item,
        messageId: item.messageId || existing?.messageId || ""
      });
    }
  }
  return [...byId.values()].sort((a, b) => b.submittedAt - a.submittedAt).slice(0, 12);
}

function App() {
  const [account, setAccount] = useState("");
  const [direction, setDirection] = useState<Direction>("forward");
  const [amount, setAmount] = useState("");
  const [recipient, setRecipient] = useState("");
  const [sourceBalance, setSourceBalance] = useState("0");
  const [destinationBalance, setDestinationBalance] = useState("0");
  const [messageId, setMessageId] = useState("");
  const [tracker, setTracker] = useState<Tracker | null>(null);
  const [history, setHistory] = useState<Tracker[]>([]);
  const [now, setNow] = useState(Date.now());
  const [status, setStatus] = useState<TxState>("idle");
  const [error, setError] = useState("");

  const ready = config.sourceBridge && config.destinationBridge && config.xusdc && config.sepoliaUsdc;
  const targetRecipient = recipient || account;
  const route = {
    from: direction === "forward" ? "Ethereum Sepolia" : "Neo X T4",
    to: direction === "forward" ? "Neo X T4" : "Ethereum Sepolia",
    token: direction === "forward" ? "USDC" : "xUSDC",
    button: direction === "forward" ? "Bridge to Neo X" : "Bridge back to Sepolia"
  };

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

  const switchToNeoX = useCallback(async () => {
    if (!window.ethereum) return;
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: NEO_X_T4.chainIdHex }]
      });
    } catch (caught: any) {
      if (caught?.code !== 4902) throw caught;
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: NEO_X_T4.chainIdHex,
            chainName: NEO_X_T4.name,
            nativeCurrency: { name: "GAS", symbol: "GAS", decimals: 18 },
            rpcUrls: [NEO_X_T4.rpcUrl],
            blockExplorerUrls: [NEO_X_T4.explorer]
          }
        ]
      });
    }
  }, []);

  const saveTracker = useCallback((next: Tracker) => {
    setTracker(next);
    setHistory((current) => {
      const updated = mergeHistory([next], current);
      writeHistory(updated);
      return updated;
    });
  }, []);

  const updateTracker = useCallback((id: string, updates: Partial<Tracker>) => {
    setTracker((current) => (current?.id === id ? { ...current, ...updates } : current));
    setHistory((current) => {
      const updated = current.map((item) => (item.id === id ? { ...item, ...updates } : item));
      writeHistory(updated);
      return updated;
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

  const loadBridgeHistory = useCallback(async () => {
    if (!account || !ready || !neoProvider) return;

    const sourceBridge = new Contract(config.sourceBridge, sourceBridgeAbi, sepoliaProvider);
    const destinationBridge = new Contract(config.destinationBridge, destinationBridgeAbi, neoProvider);

    const [forwardEvents, reverseEvents] = await Promise.all([
      sourceBridge.queryFilter(
        sourceBridge.filters.BridgeRequested(null, account, null),
        config.sourceBridgeDeployBlock
      ),
      destinationBridge.queryFilter(
        destinationBridge.filters.ReturnRequested(null, account, null),
        config.destinationBridgeDeployBlock
      )
    ]);

    const blockTimes = new Map<string, number>();
    async function blockTime(provider: JsonRpcProvider, blockNumber: number) {
      const key = `${provider === sepoliaProvider ? "sepolia" : "neo"}:${blockNumber}`;
      const cached = blockTimes.get(key);
      if (cached) return cached;
      const block = await provider.getBlock(blockNumber);
      const timestamp = (block?.timestamp || Math.floor(Date.now() / 1000)) * 1000;
      blockTimes.set(key, timestamp);
      return timestamp;
    }

    const forwardHistory = await Promise.all(
      forwardEvents.map(async (event: any) => ({
        id: event.transactionHash,
        direction: "forward" as Direction,
        amount: formatUnits(event.args.amount, 6),
        submittedAt: await blockTime(sepoliaProvider, event.blockNumber),
        originTxHash: event.transactionHash,
        messageId: event.args.messageId
      }))
    );

    const reverseHistory = await Promise.all(
      reverseEvents.map(async (event: any) => ({
        id: event.transactionHash,
        direction: "reverse" as Direction,
        amount: formatUnits(event.args.amount, 6),
        submittedAt: await blockTime(neoProvider, event.blockNumber),
        originTxHash: event.transactionHash,
        messageId: event.args.messageId
      }))
    );

    setHistory((current) => {
      const updated = mergeHistory(forwardHistory, reverseHistory, current, readHistory());
      writeHistory(updated);
      return updated;
    });
  }, [account, neoProvider, ready, sepoliaProvider]);

  useEffect(() => {
    refreshBalances().catch(() => undefined);
  }, [refreshBalances]);

  useEffect(() => {
    setHistory(readHistory());
  }, []);

  useEffect(() => {
    loadBridgeHistory().catch(() => undefined);
  }, [loadBridgeHistory]);

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
      if (direction === "forward") {
        await switchToSepolia();
      } else {
        await switchToNeoX();
      }

      const provider = new BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const owner = await signer.getAddress();
      const parsed = parseUnits(amount, 6);

      const token = new Contract(direction === "forward" ? config.sepoliaUsdc : config.xusdc, erc20Abi, signer);
      const spender = direction === "forward" ? config.sourceBridge : config.destinationBridge;
      const allowance = await token.allowance(owner, spender);
      if (allowance < parsed) {
        setStatus("approving");
        const approveTx = await token.approve(spender, parsed);
        await approveTx.wait();
      }

      setStatus("bridging");
      const bridgeContract = new Contract(
        direction === "forward" ? config.sourceBridge : config.destinationBridge,
        direction === "forward" ? sourceBridgeAbi : destinationBridgeAbi,
        signer
      );
      const fee =
        direction === "forward"
          ? await bridgeContract.getBridgeFee(parsed, owner, targetRecipient)
          : await bridgeContract.getReturnFee(parsed, owner, targetRecipient);
      const tx =
        direction === "forward"
          ? await bridgeContract.bridge(parsed, targetRecipient, { value: fee })
          : await bridgeContract.bridgeBack(parsed, targetRecipient, { value: fee });
      const submittedAt = Date.now();
      const pendingTracker = {
        id: tx.hash,
        direction,
        amount,
        submittedAt,
        originTxHash: tx.hash,
        messageId: ""
      };
      setNow(submittedAt);
      saveTracker(pendingTracker);

      const receipt = await tx.wait();
      const event = receipt.logs
        .map((log: any) => {
          try {
            return bridgeContract.interface.parseLog(log);
          } catch {
            return null;
          }
        })
        .find((parsedLog: any) => parsedLog?.name === (direction === "forward" ? "BridgeRequested" : "ReturnRequested"));

      if (event) {
        const nextMessageId = event.args.messageId;
        setMessageId(nextMessageId);
        updateTracker(tx.hash, { messageId: nextMessageId });
      }
      setStatus("done");
      await refreshBalances();
    } catch (caught) {
      const reason = caught instanceof Error ? caught.message : "Transaction failed.";
      setError(reason);
      setStatus("idle");
    }
  }, [amount, direction, ready, refreshBalances, saveTracker, switchToNeoX, switchToSepolia, targetRecipient, updateTracker]);

  const ccipUrl = messageId ? `https://ccip.chain.link/msg/${messageId}` : "";
  const sourceTxUrl = tracker?.originTxHash ? `${originExplorer(tracker.direction)}/tx/${tracker.originTxHash}` : "";

  return (
    <main>
      <section className="shell">
        <header className="topbar">
          <div>
            <p className="eyebrow">CCIP test bridge</p>
            <h1>USDC <span>{"<->"}</span> xUSDC</h1>
          </div>
          <button className="wallet" onClick={connect}>
            <Wallet size={18} />
            {account ? shortAddress(account) : "Connect"}
          </button>
        </header>

        <div className="grid">
          <section className="panel bridge-panel">
            <div className="direction-tabs" aria-label="Bridge direction">
              <button className={direction === "forward" ? "active" : ""} onClick={() => setDirection("forward")}>
                To Neo X
              </button>
              <button className={direction === "reverse" ? "active" : ""} onClick={() => setDirection("reverse")}>
                To Sepolia
              </button>
            </div>

            <div className="route">
              <div>
                <span>From</span>
                <strong>{route.from}</strong>
              </div>
              <ArrowRightLeft aria-hidden size={22} />
              <div>
                <span>To</span>
                <strong>{route.to}</strong>
              </div>
            </div>

            <label>
              Amount
              <div className="input-row">
                <input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" />
                <span>{route.token}</span>
              </div>
            </label>

            <label>
              Recipient
              <input value={recipient} onChange={(event) => setRecipient(event.target.value)} placeholder={account || "0x..."} />
            </label>

            <button className="primary" onClick={bridge} disabled={!account || status === "approving" || status === "bridging"}>
              {(status === "approving" || status === "bridging") && <Loader2 className="spin" size={18} />}
              {status === "approving" ? `Approving ${route.token}` : status === "bridging" ? "Sending CCIP message" : route.button}
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
                    {originLabel(tracker.direction)}
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
            <button className="secondary" onClick={() => {
              refreshBalances().catch(() => undefined);
              loadBridgeHistory().catch(() => undefined);
            }} disabled={!account}>
              Refresh
            </button>

            <h2>Deployment</h2>
            <ul className="status-list">
              <li className={config.sourceBridge ? "ok" : ""}>Source bridge</li>
              <li className={config.destinationBridge ? "ok" : ""}>Destination bridge</li>
              <li className={config.xusdc ? "ok" : ""}>xUSDC token</li>
              <li className={NEO_X_T4.rpcUrl ? "ok" : ""}>Neo X RPC</li>
            </ul>

            <h2 className="activity-title">Activity</h2>
            <div className="history-list">
              {history.length === 0 ? (
                <p className="empty-state">No transactions yet</p>
              ) : (
                history.map((item) => (
                  <div className="history-item" key={item.id}>
                    <div>
                      <strong>{item.amount} {item.direction === "forward" ? "USDC" : "xUSDC"}</strong>
                      <span>{routeLabel(item.direction)} - {formatSubmittedAt(item.submittedAt)}</span>
                    </div>
                    <div className="history-links">
                      <a href={`${originExplorer(item.direction)}/tx/${item.originTxHash}`} target="_blank" rel="noreferrer">
                        Origin
                      </a>
                      {item.messageId && (
                        <a href={`https://ccip.chain.link/msg/${item.messageId}`} target="_blank" rel="noreferrer">
                          CCIP
                        </a>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </aside>
        </div>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
