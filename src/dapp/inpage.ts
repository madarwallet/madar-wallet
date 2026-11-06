import { base58 } from "@scure/base";
import { WALLET_ICON } from "./icon";
import { CS_TARGET, fromB64, PAGE_TARGET, solAllowedOrigin, toB64, type DappError, type DappReply, type DappRequest, type DappState } from "./protocol";

export const WALLET_NAME = "Madar Wallet";
export const WALLET_RDNS = "com.madar-network.wallet";
export const SOLANA_MAINNET = "solana:mainnet";

export interface PageWindow {
  location: { origin: string };
  addEventListener(type: string, f: (e: any) => void): void;
  postMessage(m: unknown, targetOrigin: string): void;
  dispatchEvent(e: Event): boolean;
}
export interface Bridge { request(req: DappRequest): Promise<unknown>; onState(f: (s: DappState) => void): void;  refresh(): Promise<void> }

const randomHex = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, "0")).join("");

export class ProviderRpcError extends Error {
  code: number;
  data?: unknown;
  constructor(e: DappError) { super(e.message); this.code = e.code; }
}

export function postMessageBridge(win: PageWindow): Bridge {
  const channel = randomHex(16);
  const origin = win.location.origin;
  let next = 1;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  const stateFns: ((s: DappState) => void)[] = [];

  let acked = false;
  const queued: unknown[] = [];
  const hello = () => win.postMessage({ target: CS_TARGET, hello: channel }, origin);
  const send = (m: unknown) => { if (acked) win.postMessage(m, origin); else queued.push(m); };
  win.addEventListener("message", (e: MessageEvent) => {
    if (e.source !== (win as unknown) || e.origin !== origin) return;
    const d = e.data;
    if (!d || typeof d !== "object" || d.target !== PAGE_TARGET) return;
    if (d.ready === true && !acked) { hello(); return; }
    if (d.channel !== channel) return;
    if (d.ack === true) { if (!acked) { acked = true; for (const m of queued.splice(0)) win.postMessage(m, origin); } return; }
    if ("reply" in d && typeof d.id === "number") {
      const p = pending.get(d.id);
      if (!p) return;
      pending.delete(d.id);
      const r = d.reply as DappReply;
      if (r && r.ok) p.resolve(r.result); else p.reject(new ProviderRpcError(r?.error ?? { code: -32603, message: "Internal error" }));
    } else if ("state" in d) for (const f of stateFns) f(d.state as DappState);
  });
  hello();
  return {
    request(req) {
      const id = next++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        send({ target: CS_TARGET, channel, id, req });
      });
    },
    onState(f) { stateFns.push(f); },
    async refresh() {
      try { const st = (await this.request({ chain: "evm", method: "madar_state" })) as DappState; for (const f of stateFns) f(st); } catch {  }
    },
  };
}

type Listener = (...a: any[]) => void;

export function createEvmProvider(bridge: Bridge) {
  const listeners = new Map<string, Set<Listener>>();
  const emit = (ev: string, ...a: unknown[]) => { for (const f of [...(listeners.get(ev) ?? [])]) { try { f(...a); } catch (err) { console.error(err); } } };
  let accounts: string[] | null = null;
  let chainId: string | null = null;
  let connectedOnce = false;

  function setState(s: DappState["evm"]) {
    if (chainId !== s.chainId) {
      const first = chainId == null;
      chainId = s.chainId;
      if (!connectedOnce) { connectedOnce = true; emit("connect", { chainId }); } else if (!first) emit("chainChanged", chainId);
    }
    const a = s.accounts.map((x) => x.toLowerCase());
    if (accounts == null) { accounts = a; return; }
    if (a.join() !== accounts.join()) { accounts = a; emit("accountsChanged", a); }
  }
  bridge.onState((s) => setState(s.evm));

  const provider = {
    isMadar: true,
    async request(args: { method: string; params?: unknown[] | Record<string, unknown> }): Promise<unknown> {
      if (!args || typeof args !== "object" || typeof args.method !== "string") throw new ProviderRpcError({ code: -32602, message: "request({ method, params }) expected" });
      const params = args.params === undefined ? undefined : JSON.parse(JSON.stringify(args.params, (_k, v) => (typeof v === "bigint" ? "0x" + v.toString(16) : v)));
      const result = await bridge.request({ chain: "evm", method: args.method, params });
      if (args.method === "eth_requestAccounts" && Array.isArray(result) && chainId) setState({ accounts: result as string[], chainId });
      if (args.method === "wallet_switchEthereumChain" && accounts) {
        const id = await bridge.request({ chain: "evm", method: "eth_chainId" });
        if (typeof id === "string") setState({ accounts, chainId: id });
      }
      return result;
    },
    on(ev: string, f: Listener) { if (!listeners.has(ev)) listeners.set(ev, new Set()); listeners.get(ev)!.add(f); return provider; },
    removeListener(ev: string, f: Listener) { listeners.get(ev)?.delete(f); return provider; },
    off(ev: string, f: Listener) { return provider.removeListener(ev, f); },
  };
  return Object.freeze(provider);
}

export function announceEip6963(win: PageWindow, provider: object, uuid = crypto.randomUUID()) {
  const info = Object.freeze({ uuid, name: WALLET_NAME, icon: WALLET_ICON, rdns: WALLET_RDNS });
  const detail = Object.freeze({ info, provider });
  const announce = () => win.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail }));
  win.addEventListener("eip6963:requestProvider", announce);
  announce();
  return info;
}

const SOL_FEATURES = ["solana:signAndSendTransaction", "solana:signTransaction", "solana:signMessage"] as const;

class SolAccount {
  readonly address: string;
  readonly publicKey: Uint8Array;
  readonly chains = [SOLANA_MAINNET] as const;
  readonly features = SOL_FEATURES;
  readonly label = WALLET_NAME;
  constructor(address: string) {
    this.address = address;
    this.publicKey = base58.decode(address);
    Object.freeze(this);
  }
}

export function createSolanaWallet(bridge: Bridge) {
  let accounts: SolAccount[] = [];
  const listeners = new Set<(p: { accounts: SolAccount[] }) => void>();
  function setAccounts(list: string[]) {
    if (list.join() === accounts.map((a) => a.address).join()) return;
    accounts = list.map((a) => accounts.find((x) => x.address === a) ?? new SolAccount(a));
    for (const f of [...listeners]) { try { f({ accounts }); } catch (err) { console.error(err); } }
  }
  bridge.onState((s) => setAccounts(s.sol.accounts));
  const call = (method: string, params?: unknown) => bridge.request({ chain: "sol", method, params });
  const mine = (account: { address?: string } | undefined) => {
    if (!account || !accounts.some((a) => a.address === account.address)) throw new ProviderRpcError({ code: 4100, message: "Unknown account: connect first" });
    return account.address as string;
  };

  const wallet = {
    version: "1.0.0" as const,
    name: WALLET_NAME,
    icon: WALLET_ICON,
    chains: [SOLANA_MAINNET] as const,
    get accounts() { return accounts.slice(); },
    features: {
      "standard:connect": {
        version: "1.0.0",
        async connect(input?: { silent?: boolean }) {
          const r = (await call("connect", { silent: input?.silent === true })) as { accounts: string[] };
          setAccounts(r.accounts);
          return { accounts: accounts.slice() };
        },
      },
      "standard:disconnect": { version: "1.0.0", async disconnect() { await call("disconnect"); setAccounts([]); } },
      "standard:events": {
        version: "1.0.0",
        on(event: string, f: (p: { accounts: SolAccount[] }) => void) {
          if (event !== "change") return () => {};
          listeners.add(f);
          return () => { listeners.delete(f); };
        },
      },
      "solana:signMessage": {
        version: "1.0.0",
        async signMessage(...inputs: { account: { address: string }; message: Uint8Array }[]) {
          const out = [];
          for (const i of inputs) {
            const r = (await call("signMessage", { account: mine(i.account), message: toB64(i.message) })) as { signature: string };
            out.push({ signedMessage: i.message, signature: fromB64(r.signature), signatureType: "ed25519" as const });
          }
          return out;
        },
      },
      "solana:signTransaction": {
        version: "1.0.0",
        supportedTransactionVersions: ["legacy", 0] as const,
        async signTransaction(...inputs: { account: { address: string }; transaction: Uint8Array; chain?: string }[]) {
          const out = [];
          for (const i of inputs) {
            const r = (await call("signTransaction", { account: mine(i.account), transaction: toB64(i.transaction), chain: i.chain })) as { signedTransaction: string };
            out.push({ signedTransaction: fromB64(r.signedTransaction) });
          }
          return out;
        },
      },
      "solana:signAndSendTransaction": {
        version: "1.0.0",
        supportedTransactionVersions: ["legacy", 0] as const,
        async signAndSendTransaction(...inputs: { account: { address: string }; transaction: Uint8Array; chain: string; options?: { skipPreflight?: boolean } }[]) {
          const out = [];
          for (const i of inputs) {
            const r = (await call("signAndSendTransaction", { account: mine(i.account), transaction: toB64(i.transaction), chain: i.chain, options: { skipPreflight: i.options?.skipPreflight === true } })) as { signature: string };
            out.push({ signature: fromB64(r.signature) });
          }
          return out;
        },
      },
    },
  };
  return Object.freeze(wallet);
}

export function registerWallet(win: PageWindow, wallet: object) {
  const callback = ({ register }: { register: (w: object) => unknown }) => register(wallet);
  try { win.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: callback })); } catch (e) { console.error("wallet-standard:register-wallet event could not be dispatched", e); }
  try { win.addEventListener("wallet-standard:app-ready", (e: CustomEvent) => callback(e.detail)); } catch (e) { console.error("wallet-standard:app-ready listener could not be added", e); }
}

export function install(win: PageWindow) {
  const bridge = postMessageBridge(win);
  const evm = createEvmProvider(bridge);
  const info = announceEip6963(win, evm);
  const sol = createSolanaWallet(bridge);
  if (solAllowedOrigin(win.location.origin)) registerWallet(win, sol);
  void bridge.refresh();
  return { evm, sol, info };
}
