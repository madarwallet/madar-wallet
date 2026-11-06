import { ed25519 } from "@noble/curves/ed25519.js";
import { base58 } from "@scure/base";
import { formatUnits, getAddress, type Address } from "viem";
import { evmAccount } from "../core/account";
import { NETWORKS, type Network } from "../core/chains";
import { SOL, solSecret } from "../core/sol";
import type { ActivityItem, Settings, SitePerm } from "../core/store";
import type { GasFees } from "../core/chainops";
import {
  chainHex, decodeErc20, decodeKyber, decodeSplit, isKyberRouter, isMadarSplit, messageView, nameClaimHash, namesNeedsConfirm, networkByChainId, parseChainId, parseNameClaim, parsePersonalSign, parseTx, parseTypedDataParams, permit2View, permitView, typedReview,
  typedForSigning, type Erc20Fn, type Field, type KyberCall, type MessageView, type Permit2Token, type Permit2View, type PermitView, type SplitCall,
} from "./evmdecode";
import { decodeLifiSite, LIFI_DIAMOND, type LifiCall } from "./lifidecode";
import { decodeThorSite, THOR_AFFILIATES, THOR_MAX_EXPIRY_S, THOR_PAY_TOKENS, THOR_ROUTERS, ThorCheckError, type ThorCall, type ThorCoin } from "./thordecode";
import { BTC_SEND_ORIGINS, btcFeeTooHigh, parseBtcSendParams } from "./btcsend";
import { formatBtc } from "../core/btcbase";
import { ERR, fromB64, isAllowedOrigin, rpcError, SITE_ORIGINS, solAllowedOrigin, SWAP_ORIGINS, toB64, type DappChain, type DappRequest, type DappState } from "./protocol";
import { accountKeys, describeInstruction, estimateSolFee, parseSolTransaction, signerIndex, solMessageAllowed, SolDecodeError, withSignature, type SolIx } from "./soldecode";
import { MAYAN_CHAINS, MAYAN_SOL_TOKENS, readSwiftOrderTx } from "../core/mayan";
import { checkSolTx, jupRoute, solFeeAccountFor } from "../core/swap";

export interface Ctx { origin: string; tabId?: number; windowId?: number; signal?: AbortSignal }

const SITE_MAX_SLIPPAGE = 100;
export interface TokenLite { address: string; symbol: string; name: string; decimals: number; verified: boolean }

export interface SimView {
  status: "ok" | "fail" | "unknown";
  reason?: string;
  changes: { token: string; delta: string; nft?: boolean; symbol: string | null; decimals: number | null; verified: boolean }[] | null;
}
export interface EvmTxReview {
  to: string; value: string; nativeSymbol: string; nativeDecimals: number; gas: string; fee: string;
  sim?: SimView | null;

  risk?: { bad: boolean; why: string[]; address: string } | null;
  call:
    | { kind: "none" }

    | { kind: "erc20"; fn: Erc20Fn; fields: Field[]; token: TokenLite | null; unlimited: boolean; spenderIsSplit: boolean; spenderIsKyber: boolean; spenderKnown: boolean; spenderName: string | null }

    | ({ kind: "kyber"; payInfo: TokenLite | null; getInfo: TokenLite | null } & KyberCall)

    | ({ kind: "split"; tokenInfo: TokenLite | null; nameVerified: boolean | null } & SplitCall)

    | ({ kind: "lifi"; payInfo: TokenLite | null; getInfo: TokenLite | null; receiverIsMe: boolean; refundIsMe: boolean } & LifiCall)

    | ({ kind: "thor"; payInfo: TokenLite | null; vaultChecked: boolean; affiliateKnown: boolean;  destIsMine: boolean } & ThorCall)
    | { kind: "unknown"; selector: string; data: string };
}
export type SolItem = SolIx & { symbol?: string | null; decimals?: number | null; destOwner?: string | null; incomplete?: boolean };

export type SiteSolSwap =
  | { kind: "jupiter"; inMint: string; outMint: string; inSymbol: string | null; outSymbol: string | null; inDecimals: number | null; outDecimals: number | null; amountIn: string; minOut: string; fee: boolean }
  | { kind: "mayan"; mint: string; symbol: string; decimals: number; amount: string; dest: string; ownDest: boolean; networkId: string | null; network: string; tokenOut: string; outSymbol: string | null; outDecimals: number | null; minOut8: string; fee: boolean };
export interface SolTxReview { version: "legacy" | 0; feePayer: string; payerIsYou: boolean; fee: string; otherSigners: number; items: SolItem[]; site?: SiteSolSwap }

export type ApprovalBody =
  | { kind: "unlock"; method: string }
  | { kind: "connect"; chain: DappChain; accountIndex: number; address: string; networkId: string; network: string }
  | { kind: "evm-message"; accountIndex: number; address: string; network: string; message: MessageView; needsConfirm: boolean }

  | { kind: "name-claim"; accountIndex: number; address: string; name: string; until: string }
  | { kind: "evm-typed"; accountIndex: number; address: string; network: string; permit: (PermitView & { symbol: string | null; decimals: number | null; verified: boolean; spenderIsSplit: boolean; spenderKnown: boolean }) | null; permit2: (Omit<Permit2View, "tokens"> & { spenderKnown: boolean; tokens: (Permit2Token & { symbol: string | null; decimals: number | null; verified: boolean })[] }) | null; primaryType: string; domain: [string, string][]; fields: [string, string][]; needsConfirm: boolean }
  | { kind: "evm-tx"; accountIndex: number; address: string; networkId: string; network: string; review: EvmTxReview; needsConfirm: boolean }
  | { kind: "sol-message"; accountIndex: number; address: string; message: MessageView; needsConfirm: boolean }
  | { kind: "sol-tx"; accountIndex: number; address: string; send: boolean; review: SolTxReview; needsConfirm: boolean }

  | { kind: "btc-send"; accountIndex: number; address: string; to: string; sats: string; fee: string; feeRate: number; price: number | null; currency: string; needsConfirm: true };
export type ApprovalView = ApprovalBody & { id: string; origin: string; at: number };

export interface Answer { confirmUnknown?: boolean }

export function partyOf(data: string): string | null {
  const m = /^0x([0-9a-fA-F]{8})/.exec(data);
  if (!m) return null;
  const arg = ({ "095ea7b3": 1, a9059cbb: 1, "39509351": 1, a22cb465: 1, "23b872dd": 2, d505accf: 2 } as Record<string, number>)[m[1].toLowerCase()];
  if (!arg || data.length < 10 + 64 * arg) return null;
  return "0x" + data.slice(10 + 64 * (arg - 1) + 24, 10 + 64 * arg);
}

export interface RouterDeps {
  hasVault(): Promise<boolean>;
  getSettings(): Promise<Settings>;
  getPerms(): Promise<Record<string, SitePerm>>;
  setPerm(origin: string, p: SitePerm | null): Promise<void>;
  phrase(): Promise<string | null>;
  addresses(phrase: string, index: number): { evm: Address; sol: string; btc: string; doge: string; ltc: string; xrp: string };

  ask(ctx: Ctx, body: ApprovalBody): Promise<Answer>;

  askUnlock(ctx: Ctx, method: string): Promise<void>;
  evmRpc(n: Network, method: string, params: unknown[]): Promise<unknown>;

  evmQuote(n: Network, from: Address, tx: { to: Address; value: bigint; data: `0x${string}`; gas?: bigint }): Promise<{ gas: bigint; feeNative: bigint; fees?: GasFees }>;
  evmSend(n: Network, phrase: string, index: number, tx: { to: Address; value: bigint; data: `0x${string}`; gas: bigint; fees?: GasFees }): Promise<string>;

  tokenInfo(n: Network, address: string, s: Settings): Promise<TokenLite | null>;

  nameOwner?(name: string): Promise<string | null>;

  simulate?(n: Network, from: Address, tx: { to: Address; value: bigint; data: `0x${string}` }, s: Settings): Promise<SimView>;

  addrRisk?(chainId: number, address: string): Promise<{ bad: boolean; why: string[] } | null>;

  siteRisk?(origin: string): Promise<{ fraud: boolean; like?: string }>;

  solTables(tables: string[]): Promise<Record<string, string[]>>;

  solTokenAccounts(addrs: string[]): Promise<Record<string, { owner: string; mint: string; decimals: number } | null>>;

  solSend(wireB64: string, opts: { skipPreflight?: boolean }): Promise<string>;
  addActivity(a: ActivityItem): Promise<void>;

  thorInbound?(chainId: number, coin: ThorCoin): Promise<{ vault: string; router: string }>;

  btcPrepare?(phrase: string, index: number, to: string, sats: bigint): Promise<BtcPrepared>;

  btcBroadcast?(phrase: string, index: number, p: BtcPrepared): Promise<string>;

  btcPrice?(currency: string): Promise<number | null>;
}
export interface BtcPrepared { to: string; amount: bigint; fee: bigint; feeRate: number; quote: unknown }

export const EVM_READ_METHODS = new Set([
  "eth_getBalance", "eth_call", "eth_estimateGas", "eth_gasPrice", "eth_blockNumber", "eth_getTransactionReceipt", "eth_getTransactionByHash",
  "eth_getTransactionCount", "eth_getCode", "eth_getBlockByNumber", "eth_feeHistory", "eth_maxPriorityFeePerGas",
]);
export const SOL_CHAIN = "solana:mainnet";

const NO_WALLET_EVM = new Set(["eth_chainId", "net_version", "eth_accounts", "wallet_switchEthereumChain", "wallet_addEthereumChain"]);
const DEFAULT_CHAIN = 8453;

export const READ_LIMIT = 100, READ_WINDOW_MS = 10_000;

export const REJECT_LIMIT = 3, REJECT_COOLDOWN_MS = 30_000;

const sameAddr = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function knownSpender(chainId: number, spender: string): string | null {
  const s = spender.toLowerCase();
  if (isMadarSplit(chainId, s)) return "MadarSplit";
  if (isKyberRouter(chainId, s)) return "KyberSwap";
  if (s === LIFI_DIAMOND && NETWORKS.some((n) => n.chain.id === chainId)) return "LI.FI";
  if (THOR_ROUTERS[chainId] === s) return "THORChain";
  return null;
}

export function createRouter(deps: RouterDeps) {
  const busy = new Set<string>();
  const reads = new Map<string, { start: number; n: number }>();
  const refusals = new Map<string, { n: number; until: number }>();

  function readAllowed(origin: string) {
    const now = Date.now(), r = reads.get(origin);
    if (!r || now - r.start >= READ_WINDOW_MS) { reads.set(origin, { start: now, n: 1 }); return; }
    if (++r.n > READ_LIMIT) throw rpcError(ERR.limit, "Too many requests from this site; try again in a few seconds");
  }

  function coolingDown(origin: string) {
    const r = refusals.get(origin);
    if (r && r.until > Date.now()) throw rpcError(ERR.rejected, "Several requests from this site were rejected; wait a moment before asking again");
  }
  async function counted<T>(origin: string, ask: () => Promise<T>): Promise<T> {
    coolingDown(origin);
    try {
      const a = await ask();
      refusals.delete(origin);
      return a;
    } catch (e) {
      if ((e as { code?: number })?.code === ERR.rejected) {
        const n = (refusals.get(origin)?.n ?? 0) + 1;
        refusals.set(origin, n >= REJECT_LIMIT ? { n: 0, until: Date.now() + REJECT_COOLDOWN_MS } : { n, until: 0 });
      }
      throw e;
    }
  }
  const ask = (ctx: Ctx, body: ApprovalBody) => counted(ctx.origin, () => deps.ask(ctx, body));
  const askUnlock = (ctx: Ctx, method: string) => counted(ctx.origin, () => deps.askUnlock(ctx, method));

  async function exclusive<T>(origin: string, fn: () => Promise<T>): Promise<T> {
    coolingDown(origin);
    if (busy.has(origin)) throw rpcError(ERR.pending, "A request from this site is already waiting for the user in Madar Wallet");
    busy.add(origin);
    try { return await fn(); } finally { busy.delete(origin); }
  }

  async function unlocked(ctx: Ctx, method: string): Promise<string> {
    let p = await deps.phrase();
    if (!p) { await askUnlock(ctx, method); p = await deps.phrase(); }
    if (!p) throw rpcError(ERR.rejected, "The wallet is locked");
    return p;
  }

  async function checkThor(chainId: number, c: ThorCall): Promise<void> {
    if (!c.destOk) throw rpcError(ERR.invalidParams, `The ${c.coin} receiving address in this THORChain order is not a valid ${c.coin} address`);
    if (c.tokenIn && !(THOR_PAY_TOKENS[chainId] ?? []).includes(c.tokenIn.toLowerCase())) throw rpcError(ERR.invalidParams, "THORChain does not accept this token on this network");
    if (c.affiliateBps != null && c.affiliateBps > 1000) throw rpcError(ERR.invalidParams, "The affiliate fee in this THORChain order is above 10%");
    const now = Math.floor(Date.now() / 1000);
    if (c.expiry <= now) throw rpcError(ERR.invalidParams, "This THORChain order has expired; ask for a new price");
    if (c.expiry > now + THOR_MAX_EXPIRY_S) throw rpcError(ERR.invalidParams, "This THORChain order stays valid for more than an hour; Madar Wallet signs only orders that expire within an hour");
    let v: { vault: string; router: string };
    try {
      if (!deps.thorInbound) throw new ThorCheckError("nodes");
      v = await deps.thorInbound(chainId, c.coin);
    } catch (e) {
      throw rpcError(ERR.internal, e instanceof ThorCheckError && e.why === "paused" ? "THORChain trading is paused right now; try again later"
        : "Madar Wallet could not confirm THORChain's current vault (two THORChain nodes must agree); try again in a minute");
    }
    if (!sameAddr(v.vault, c.vault) || v.router !== THOR_ROUTERS[chainId]) throw rpcError(ERR.invalidParams, "The vault in this transaction is not THORChain's current vault; ask for a new price");
  }

  function chainOf(perm: SitePerm | undefined, s: Settings): Network {

    return (perm?.chainId != null && networkByChainId(perm.chainId)) || NETWORKS.find((n) => n.id === s.networkId) || networkByChainId(DEFAULT_CHAIN) || NETWORKS[0];
  }

  async function state(origin: string): Promise<DappState> {
    const [perms, s, p] = await Promise.all([deps.getPerms(), deps.getSettings(), deps.phrase()]);
    const perm = perms[origin];
    const a = p && (perm?.evm || perm?.sol) ? deps.addresses(p, s.accountIndex) : null;
    return { evm: { accounts: a && perm?.evm ? [a.evm.toLowerCase()] : [], chainId: chainHex(chainOf(perm, s).chain.id) }, sol: { accounts: a && perm?.sol && a.sol ? [a.sol] : [] } };
  }

  async function handle(ctx: Ctx, req: DappRequest): Promise<unknown> {
    if (!isAllowedOrigin(ctx.origin)) throw rpcError(ERR.unauthorized, "Madar Wallet does not connect to this site");

    if (deps.siteRisk && !SITE_ORIGINS.includes(ctx.origin) && !SWAP_ORIGINS.includes(ctx.origin) && (await deps.siteRisk(ctx.origin).catch(() => null))?.fraud) throw rpcError(ERR.unauthorized, "This site is on the phishing list: Madar Wallet does not connect to it");
    if (!req || typeof req.method !== "string" || (req.chain !== "evm" && req.chain !== "sol")) throw rpcError(ERR.invalidParams, "Invalid request");
    if (req.method === "madar_state") return state(ctx.origin);

    if (req.chain === "sol" && !solAllowedOrigin(ctx.origin)) throw rpcError(ERR.unsupported, "Madar Wallet supports only EVM networks on this site");
    const free = req.chain === "evm" ? NO_WALLET_EVM.has(req.method) || EVM_READ_METHODS.has(req.method) : req.method === "disconnect" || (req.method === "connect" && (req.params as { silent?: unknown } | undefined)?.silent === true);
    if (!free && !(await deps.hasVault())) throw rpcError(ERR.unauthorized, "Madar Wallet has not been set up yet");
    return req.chain === "evm" ? evm(ctx, req.method, req.params) : sol(ctx, req.method, req.params);
  }

  async function evm(ctx: Ctx, method: string, params: unknown): Promise<unknown> {
    const { origin } = ctx;
    const [perms, s] = await Promise.all([deps.getPerms(), deps.getSettings()]);
    const perm = perms[origin];
    const net = chainOf(perm, s);
    const connected = !!perm?.evm;
    const needConnected = () => { if (!connected) throw rpcError(ERR.unauthorized, "Connect Madar Wallet to this site first (eth_requestAccounts)"); };

    switch (method) {
      case "eth_chainId": return chainHex(net.chain.id);
      case "net_version": return String(net.chain.id);
      case "eth_accounts": return (await state(origin)).evm.accounts;
      case "eth_requestAccounts": {
        if (connected) { const p = await deps.phrase(); if (p) return [deps.addresses(p, s.accountIndex).evm.toLowerCase()]; }
        return exclusive(origin, async () => {
          const p = await unlocked(ctx, method);
          const st = await deps.getSettings();
          const fresh = (await deps.getPerms())[origin];
          const address = deps.addresses(p, st.accountIndex).evm;
          if (!fresh?.evm) {
            const n = chainOf(fresh, st);
            await ask(ctx, { kind: "connect", chain: "evm", accountIndex: st.accountIndex, address, networkId: n.id, network: n.name });
            await deps.setPerm(origin, { evm: true, sol: !!fresh?.sol, chainId: n.chain.id, at: Date.now() });
          }
          return [address.toLowerCase()];
        });
      }
      case "wallet_switchEthereumChain":
      case "wallet_addEthereumChain": {
        needConnected();
        const id = parseChainId(Array.isArray(params) ? (params[0] as { chainId?: unknown } | undefined)?.chainId : undefined);
        if (id == null) throw rpcError(ERR.invalidParams, "Expected [{ chainId }]");
        const n = networkByChainId(id);
        if (!n) throw rpcError(method === "wallet_switchEthereumChain" ? ERR.unknownChain : ERR.unsupported, `Madar Wallet does not support chain ${chainHex(id)}. Supported: ${NETWORKS.map((x) => `${x.name} (${chainHex(x.chain.id)})`).join(", ")}`);
        if (n.chain.id !== net.chain.id) await deps.setPerm(origin, { evm: !!perm?.evm, sol: !!perm?.sol, chainId: n.chain.id, at: perm?.at ?? Date.now() });
        return null;
      }

      case "madar_bitcoinAddress": {
        needConnected();
        const p = (await deps.phrase()) ?? (await exclusive(origin, () => unlocked(ctx, method)));
        return deps.addresses(p, (await deps.getSettings()).accountIndex).btc;
      }

      case "madar_coinAddress": {
        const coin: unknown = Array.isArray(params) ? params[0] : undefined;
        if (coin !== "doge" && coin !== "ltc" && coin !== "xrp") throw rpcError(ERR.invalidParams, "coin must be doge, ltc or xrp");
        needConnected();
        const p = (await deps.phrase()) ?? (await exclusive(origin, () => unlocked(ctx, method)));
        return deps.addresses(p, (await deps.getSettings()).accountIndex)[coin];
      }

      case "madar_sendBitcoin": {
        if (!BTC_SEND_ORIGINS.includes(origin)) throw rpcError(ERR.unauthorized, "Only Madar's own sites can ask for a Bitcoin payment");
        needConnected();
        const req = parseBtcSendParams(params);
        if (!deps.btcPrepare || !deps.btcBroadcast) throw rpcError(ERR.unsupported, "Bitcoin payments are not available here");
        return exclusive(origin, async () => {
          const p = await unlocked(ctx, method);
          const st = await deps.getSettings();
          const idx = st.accountIndex;
          const me = deps.addresses(p, idx).btc;
          let prep: BtcPrepared;
          try { prep = await deps.btcPrepare!(p, idx, req.to, req.sats); } catch (e) {
            const m = (e as Error)?.message;
            throw rpcError(ERR.invalidParams, m === "ERR_FUNDS" ? "Not enough BTC for this amount plus the network fee" : m === "ERR_DUST" ? "The amount is below Bitcoin's smallest allowed payment"
              : m === "ERR_ADDRESS" ? "Invalid Bitcoin address" : "Madar Wallet could not build this Bitcoin payment; try again");
          }
          if (prep.to !== req.to || prep.amount !== req.sats) throw rpcError(ERR.internal, "The Bitcoin payment does not match the request");
          if (btcFeeTooHigh(prep.amount, prep.fee)) throw rpcError(ERR.invalidParams, `The Bitcoin network fee (${formatBtc(prep.fee)} BTC) is more than 10% of the amount; send a larger amount or wait for lower fees`);
          const price = deps.btcPrice ? await deps.btcPrice(st.currency).catch(() => null) : null;
          const ans = await ask(ctx, { kind: "btc-send", accountIndex: idx, address: me, to: req.to, sats: req.sats.toString(), fee: prep.fee.toString(), feeRate: prep.feeRate, price, currency: st.currency, needsConfirm: true });
          if (!ans.confirmUnknown) throw rpcError(ERR.rejected, "Not confirmed");
          const phrase = await deps.phrase();
          if (!phrase) throw rpcError(ERR.unauthorized, "The wallet was locked");
          const txid = await deps.btcBroadcast!(phrase, idx, prep);
          await deps.addActivity({ at: Date.now(), networkId: "bitcoin", kind: "send", asset: "BTC", amount: formatBtc(req.sats), to: req.to, hash: txid, from: me }).catch(() => {});
          return txid;
        });
      }
      case "personal_sign": {
        needConnected();
        const { bytes, address } = parsePersonalSign(params);
        return exclusive(origin, async () => {
          const p = await unlocked(ctx, method);
          const idx = (await deps.getSettings()).accountIndex;
          const me = deps.addresses(p, idx).evm;
          if (!sameAddr(address, me)) throw rpcError(ERR.unauthorized, "The requested address is not the current Madar Wallet account");
          const message = messageView(bytes), confirm = namesNeedsConfirm(message.names) || message.text == null;
          const ans = await ask(ctx, { kind: "evm-message", accountIndex: idx, address: me, network: net.name, message, needsConfirm: confirm });
          if (confirm && !ans.confirmUnknown) throw rpcError(ERR.rejected, "Not confirmed");
          const phrase = await deps.phrase();
          if (!phrase) throw rpcError(ERR.unauthorized, "The wallet was locked");
          return evmAccount(phrase, idx).signMessage({ message: { raw: bytes } });
        });
      }

      case "madar_signNameClaim": {
        if (!SITE_ORIGINS.includes(origin)) throw rpcError(ERR.unauthorized, "Only Madar Wallet's own site can claim a free name");
        needConnected();
        const claim = parseNameClaim(params);
        return exclusive(origin, async () => {
          const p = await unlocked(ctx, method);
          const idx = (await deps.getSettings()).accountIndex;
          const me = deps.addresses(p, idx).evm;
          await ask(ctx, { kind: "name-claim", accountIndex: idx, address: me, name: `${claim.name}.madar`, until: claim.until });
          const phrase = await deps.phrase();
          if (!phrase) throw rpcError(ERR.unauthorized, "The wallet was locked");
          const signature = await evmAccount(phrase, idx).sign({ hash: nameClaimHash(claim.text) });
          return { address: me.toLowerCase(), signature };
        });
      }
      case "eth_signTypedData_v4": {
        needConnected();
        const { address, data } = parseTypedDataParams(params);
        const lines = typedReview(data);
        const dc = data.domain.chainId;
        if (dc != null && parseChainId(typeof dc === "bigint" ? Number(dc) : dc) !== net.chain.id) throw rpcError(ERR.invalidParams, `The signature is for chain ${String(dc)} but the site is on ${net.name} (${chainHex(net.chain.id)})`);
        return exclusive(origin, async () => {
          const p = await unlocked(ctx, method);
          const st = await deps.getSettings();
          const idx = st.accountIndex;
          const me = deps.addresses(p, idx).evm;
          if (!sameAddr(address, me)) throw rpcError(ERR.unauthorized, "The requested address is not the current Madar Wallet account");
          const pv = permitView(data);
          if (pv && !sameAddr(pv.owner, me)) throw rpcError(ERR.unauthorized, "The permit owner is not the current Madar Wallet account");
          const tok = pv ? await deps.tokenInfo(net, pv.token, st).catch(() => null) : null;
          const permit = pv ? { ...pv, symbol: tok?.symbol ?? null, decimals: tok?.decimals ?? null, verified: !!tok?.verified, spenderIsSplit: isMadarSplit(net.chain.id, pv.spender), spenderKnown: !!knownSpender(net.chain.id, pv.spender) } : null;
          const p2 = pv ? null : permit2View(data);
          const permit2 = p2 ? { ...p2, spenderKnown: !!knownSpender(net.chain.id, p2.spender), tokens: await Promise.all(p2.tokens.map(async (x) => { const i = await deps.tokenInfo(net, x.token, st).catch(() => null); return { ...x, symbol: i?.symbol ?? null, decimals: i?.decimals ?? null, verified: !!i?.verified }; })) } : null;

          const spender = permit?.spender ?? permit2?.spender;
          if (spender && deps.addrRisk && (await deps.addrRisk(net.chain.id, spender).catch(() => null))?.bad) throw rpcError(ERR.rejected, "The spender of this permit is reported for fraud");

          const needsConfirm = permit ? permit.decimals == null || permit.unlimited || !permit.spenderKnown
            : permit2 ? permit2.tokens.some((x) => x.decimals == null || x.unlimited) || !permit2.spenderKnown : true;
          const ans = await ask(ctx, {
            kind: "evm-typed", accountIndex: idx, address: me, network: net.name, permit, permit2, primaryType: data.primaryType.slice(0, 80),
            domain: lines.domain, fields: lines.fields, needsConfirm,
          });
          if (needsConfirm && !ans.confirmUnknown) throw rpcError(ERR.rejected, "Not confirmed");
          const phrase = await deps.phrase();
          if (!phrase) throw rpcError(ERR.unauthorized, "The wallet was locked");
          const td = typedForSigning(data);
          if (td.domain.chainId != null) (td.domain as Record<string, unknown>).chainId = net.chain.id;
          return evmAccount(phrase, idx).signTypedData(td as never);
        });
      }
      case "eth_sendTransaction": {
        needConnected();
        const tx = parseTx(params);
        if (tx.chainId != null && tx.chainId !== net.chain.id) throw rpcError(ERR.invalidParams, `The transaction is for chain ${chainHex(tx.chainId)} but the site is on ${net.name} (${chainHex(net.chain.id)})`);
        return exclusive(origin, async () => {
          const p = await unlocked(ctx, method);
          const st = await deps.getSettings();
          const idx = st.accountIndex;
          const me = deps.addresses(p, idx).evm;
          if (tx.from && !sameAddr(tx.from, me)) throw rpcError(ERR.unauthorized, "The 'from' address is not the current Madar Wallet account");
          const q = await deps.evmQuote(net, me, { to: tx.to, value: tx.value, data: tx.data, gas: tx.gas });
          const split = decodeSplit(net.chain.id, tx.to, tx.data);
          const kyber = split ? null : decodeKyber(net.chain.id, tx.to, tx.value, tx.data, me);
          const lifi = split || kyber ? null : decodeLifiSite(net.chain.id, tx.to, tx.value, tx.data);
          const thor = split || kyber || lifi ? null : decodeThorSite(net.chain.id, tx.to, tx.value, tx.data);
          const erc = split || kyber || lifi || thor ? null : decodeErc20(tx.data);
          const token = erc ? await deps.tokenInfo(net, tx.to, st).catch(() => null) : null;
          let call: EvmTxReview["call"];
          if (split) {
            const refName = (split.ref.kind === "gift" && !split.ref.cut) || split.ref.kind === "name" ? split.ref.name : null;
            const [tokenInfo, owner] = await Promise.all([
              deps.tokenInfo(net, split.token, st).catch(() => null),
              refName && deps.nameOwner ? deps.nameOwner(refName).catch(() => undefined) : Promise.resolve(undefined),
            ]);
            call = { kind: "split", ...split, tokenInfo, nameVerified: owner === undefined ? null : !!owner && sameAddr(owner, split.recipient) };
          } else if (kyber) {
            const info = (a: string | null) => (a ? deps.tokenInfo(net, a, st).catch(() => null) : Promise.resolve(null));
            const [payInfo, getInfo] = await Promise.all([info(kyber.tokenIn), info(kyber.tokenOut)]);
            call = { kind: "kyber", ...kyber, payInfo, getInfo };
          } else if (lifi) {
            const own = deps.addresses(p, idx);
            const mine = lifi.dest.kind === "sol" ? own.sol : lifi.dest.kind === "btc" ? own.btc : own.evm;
            const destNet = lifi.dest.kind === "evm" ? networkByChainId(lifi.dest.chainId) : undefined;
            const [payInfo, getInfo] = await Promise.all([
              lifi.tokenIn ? deps.tokenInfo(net, lifi.tokenIn, st).catch(() => null) : Promise.resolve(null),
              destNet && lifi.tokenOut ? deps.tokenInfo(destNet, lifi.tokenOut, st).catch(() => null) : Promise.resolve(destNet ? { address: "", symbol: destNet.native.symbol, name: destNet.native.symbol, decimals: destNet.chain.nativeCurrency.decimals, verified: true } : null),
            ]);
            call = { kind: "lifi", ...lifi, payInfo, getInfo, receiverIsMe: lifi.dest.kind === "evm" ? sameAddr(lifi.receiver, mine) : lifi.receiver === mine, refundIsMe: lifi.refund == null || sameAddr(lifi.refund, me) };
          } else if (thor) {
            await checkThor(net.chain.id, thor);

            const ownA = deps.addresses(p, idx), mine = thor.coin === "DOGE" ? ownA.doge : thor.coin === "LTC" ? ownA.ltc : thor.coin === "XRP" ? ownA.xrp : null;
            call = { kind: "thor", ...thor, payInfo: thor.tokenIn ? await deps.tokenInfo(net, thor.tokenIn, st).catch(() => null) : null, vaultChecked: true,
              affiliateKnown: thor.affiliate == null || THOR_AFFILIATES.includes(thor.affiliate.toLowerCase()), destIsMine: mine != null && thor.dest === mine };
          } else if (tx.data === "0x") call = { kind: "none" };
          else if (erc) {
            const spender = erc.fields.find((f) => f.k === "spender")?.v;
            const known = spender ? knownSpender(net.chain.id, spender) : null;
            call = { kind: "erc20", fn: erc.fn, fields: erc.fields, token, unlimited: erc.unlimited, spenderIsSplit: known === "MadarSplit", spenderIsKyber: known === "KyberSwap", spenderKnown: !!known,
              spenderName: known === "LI.FI" || known === "THORChain" ? known : null };
          } else call = { kind: "unknown", selector: tx.data.slice(0, 10), data: tx.data };
          const needsConfirm = call.kind === "unknown" || (call.kind === "erc20" && !token)
            || (call.kind === "erc20" && call.fn !== "transfer" && call.fn !== "transferFrom" && (call.unlimited || !call.spenderKnown))
            || (call.kind === "split" && (!call.tokenInfo || !call.validRate))
            || (call.kind === "kyber" && ((call.tokenIn != null && !call.payInfo) || (call.tokenOut != null && !call.getInfo)))
            || (call.kind === "lifi" && (!call.receiverIsMe || !call.refundIsMe || call.otherFees || (call.tokenIn != null && !call.payInfo)))
            || (call.kind === "thor" && (call.minOut == null || !call.affiliateKnown || !call.destIsMine || (call.tokenIn != null && !call.payInfo)));
          const sim = deps.simulate ? await deps.simulate(net, me, { to: tx.to, value: tx.value, data: tx.data }, st).catch(() => null) : null;

          const party = partyOf(tx.data);
          let risk: EvmTxReview["risk"] = null;
          if (deps.addrRisk) {
            for (const a of [tx.to, party].filter((x): x is string => !!x)) {
              const r = await deps.addrRisk(net.chain.id, a).catch(() => null);
              if (r?.bad) { risk = { ...r, address: a }; break; }
            }
          }
          const review: EvmTxReview = {
            to: tx.to, value: tx.value.toString(), nativeSymbol: net.native.symbol, nativeDecimals: net.chain.nativeCurrency.decimals, gas: q.gas.toString(), fee: q.feeNative.toString(), call, sim, risk,
          };
          const ans = await ask(ctx, { kind: "evm-tx", accountIndex: idx, address: me, networkId: net.id, network: net.name, review, needsConfirm });
          if (needsConfirm && !ans.confirmUnknown) throw rpcError(ERR.rejected, "Not confirmed");

          if (risk?.bad) throw rpcError(ERR.rejected, "This address is reported for fraud");
          const phrase = await deps.phrase();
          if (!phrase) throw rpcError(ERR.unauthorized, "The wallet was locked");
          const hash = await deps.evmSend(net, phrase, idx, { to: tx.to, value: tx.value, data: tx.data, gas: q.gas, fees: q.fees });
          const act = activityFor(net, review);
          await deps.addActivity({ at: Date.now(), networkId: net.id, kind: "send", hash, ...act }).catch(() => {});
          return hash;
        });
      }
      case "eth_sign":
      case "eth_signTypedData":
      case "eth_signTypedData_v3":
      case "eth_signTransaction":
        throw rpcError(ERR.unsupported, `${method} is not supported by Madar Wallet (use personal_sign / eth_signTypedData_v4 / eth_sendTransaction)`);
    }
    if (EVM_READ_METHODS.has(method)) {
      const list = params == null ? [] : params;
      if (!Array.isArray(list) || JSON.stringify(list).length > 128 * 1024) throw rpcError(ERR.invalidParams, "Invalid params");
      readAllowed(origin);
      return deps.evmRpc(net, method, list);
    }
    throw rpcError(ERR.unsupported, `Method not supported: ${method.slice(0, 60)}`);
  }

  async function sol(ctx: Ctx, method: string, params: unknown): Promise<unknown> {
    const { origin } = ctx;
    const perm = (await deps.getPerms())[origin];
    const pr = (params && typeof params === "object" ? params : {}) as Record<string, unknown>;
    const needConnected = () => { if (!perm?.sol) throw rpcError(ERR.unauthorized, "Connect Madar Wallet to this site first (standard:connect)"); };
    const checkChain = () => { if (pr.chain != null && pr.chain !== SOL_CHAIN) throw rpcError(ERR.invalidParams, `Madar Wallet supports ${SOL_CHAIN} only`); };

    switch (method) {
      case "connect": {
        const p = await deps.phrase();
        const s = await deps.getSettings();
        if (perm?.sol && p) return { accounts: [deps.addresses(p, s.accountIndex).sol].filter(Boolean) };
        if (pr.silent === true) return { accounts: [] };
        return exclusive(origin, async () => {
          const ph = await unlocked(ctx, "standard:connect");
          const st = await deps.getSettings();
          const fresh = (await deps.getPerms())[origin];
          const address = deps.addresses(ph, st.accountIndex).sol;

          if (!address) throw rpcError(ERR.unsupported, "The selected Madar Wallet account has no Solana address (imported EVM account)");
          if (!fresh?.sol) {
            await ask(ctx, { kind: "connect", chain: "sol", accountIndex: st.accountIndex, address, networkId: SOL.id, network: SOL.name });
            await deps.setPerm(origin, { evm: !!fresh?.evm, sol: true, chainId: fresh?.chainId, at: Date.now() });
          }
          return { accounts: [address] };
        });
      }
      case "disconnect": {
        if (perm?.sol) await deps.setPerm(origin, perm.evm ? { ...perm, sol: false } : null);
        return null;
      }
      case "signMessage": {
        needConnected();
        if (typeof pr.message !== "string" || typeof pr.account !== "string") throw rpcError(ERR.invalidParams, "Expected { account, message }");
        const bytes = fromB64(pr.message);
        if (bytes.length > 64 * 1024) throw rpcError(ERR.invalidParams, "Message too long");

        if (!solMessageAllowed(bytes)) throw rpcError(ERR.invalidParams, "Madar Wallet signs only readable text messages (or the Solana off-chain message format), never transaction bytes");
        return exclusive(origin, async () => {
          const p = await unlocked(ctx, "solana:signMessage");
          const idx = (await deps.getSettings()).accountIndex;
          const me = deps.addresses(p, idx).sol;
          if (pr.account !== me) throw rpcError(ERR.unauthorized, "The requested account is not the current Madar Wallet account");
          const message = messageView(bytes), confirm = namesNeedsConfirm(message.names) || message.text == null;
          const ans = await ask(ctx, { kind: "sol-message", accountIndex: idx, address: me, message, needsConfirm: confirm });
          if (confirm && !ans.confirmUnknown) throw rpcError(ERR.rejected, "Not confirmed");
          const phrase = await deps.phrase();
          if (!phrase) throw rpcError(ERR.unauthorized, "The wallet was locked");
          return { signature: toB64(ed25519.sign(bytes, solSecret(phrase, idx))) };
        });
      }
      case "signTransaction":
      case "signAndSendTransaction": {
        needConnected();
        checkChain();
        if (typeof pr.transaction !== "string" || typeof pr.account !== "string") throw rpcError(ERR.invalidParams, "Expected { account, transaction }");
        const raw = fromB64(pr.transaction);
        if (raw.length > 1232) throw rpcError(ERR.invalidParams, "Transaction too large");
        let tx;
        try { tx = parseSolTransaction(raw); } catch (e) { throw rpcError(ERR.invalidParams, `Invalid transaction${e instanceof SolDecodeError ? `: ${e.message}` : ""}`); }
        const send = method === "signAndSendTransaction";
        return exclusive(origin, async () => {
          const p = await unlocked(ctx, send ? "solana:signAndSendTransaction" : "solana:signTransaction");
          const st = await deps.getSettings();
          const idx = st.accountIndex;
          const me = deps.addresses(p, idx).sol;
          if (pr.account !== me) throw rpcError(ERR.unauthorized, "The requested account is not the current Madar Wallet account");
          const slot = signerIndex(tx, me);
          if (slot < 0) throw rpcError(ERR.invalidParams, "This transaction does not ask the current account to sign");
          const review = await solReview(tx, me, st);
          if (SWAP_ORIGINS.includes(origin)) review.site = await swapSiteReview(raw, me, deps.addresses(p, idx).evm, st);
          const needsConfirm = !review.site && review.items.some((x) => x.kind === "unknown" || x.incomplete);
          const ans = await ask(ctx, { kind: "sol-tx", accountIndex: idx, address: me, send, review, needsConfirm });
          if (needsConfirm && !ans.confirmUnknown) throw rpcError(ERR.rejected, "Not confirmed");
          const phrase = await deps.phrase();
          if (!phrase) throw rpcError(ERR.unauthorized, "The wallet was locked");
          const signed = withSignature(raw, tx, slot, ed25519.sign(tx.message, solSecret(phrase, idx)));
          if (!send) return { signedTransaction: toB64(signed) };
          const opts = (pr.options && typeof pr.options === "object" ? pr.options : {}) as { skipPreflight?: unknown };
          const sig = await deps.solSend(toB64(signed), { skipPreflight: opts.skipPreflight === true });
          const act = solActivity(review);
          await deps.addActivity({ at: Date.now(), networkId: SOL.id, kind: "send", hash: sig, ...act }).catch(() => {});
          return { signature: toB64(base58.decode(sig)) };
        });
      }
    }
    throw rpcError(ERR.unsupported, `Method not supported: ${method.slice(0, 60)}`);
  }

  async function swapSiteReview(raw: Uint8Array, me: string, myEvm: string, s: Settings): Promise<SiteSolSwap> {
    const sym = (mint: string | null) => { if (!mint) return null; const v = SOL.tokens.find((t) => t.address === mint) ?? s.customTokens.find((t) => t.networkId === SOL.id && t.address === mint);
      return v ? { symbol: v.symbol, decimals: v.decimals } : mint === "So11111111111111111111111111111111111111112" ? { symbol: "SOL", decimals: 9 } : null; };
    let order: ReturnType<typeof readSwiftOrderTx> | null = null;
    try { order = readSwiftOrderTx(raw, me); } catch { order = null; }
    if (order) {
      const n = NETWORKS.find((x) => x.chain.id === order!.chainId) ?? null;
      const native = order.tokenOut === "0x0000000000000000000000000000000000000000";
      const tk = native ? null : n?.tokens.find((t) => t.address.toLowerCase() === order!.tokenOut) ?? null;
      return { kind: "mayan", mint: order.mint, symbol: sym(order.mint)?.symbol ?? "USDC", decimals: MAYAN_SOL_TOKENS[order.mint], amount: order.amount.toString(), dest: getAddress(order.dest),
        ownDest: order.dest === myEvm.toLowerCase(), networkId: n?.id ?? null, network: n?.name ?? MAYAN_CHAINS[order.chainId]?.name ?? String(order.chainId),
        tokenOut: order.tokenOut, outSymbol: native ? n?.native.symbol ?? null : tk?.symbol ?? null, outDecimals: native ? 18 : tk?.decimals ?? null, minOut8: order.minOut8.toString(), fee: order.feeBps > 0 };
    }
    const r = jupRoute(raw);
    if (r) {
      let inMint = r.inMint, outMint = r.outMint;
      if ((!inMint || !outMint) && r.source && r.dest) {
        const info = await deps.solTokenAccounts([r.source, r.dest]).catch(() => ({} as Record<string, null>));
        inMint = inMint ?? info[r.source]?.mint ?? null; outMint = outMint ?? info[r.dest]?.mint ?? null;
      }

      if (inMint && outMint && (!r.feeAccount || r.feeAccount === solFeeAccountFor(outMint) || r.feeAccount === solFeeAccountFor(inMint))) {
        const shownMin = (r.quotedOut * BigInt(10000 - r.slippage)) / 10000n;
        if (checkSolTx(raw, me, r.feeAccount, { inMint, outMint, amountIn: r.inAmount, shownMin }, SITE_MAX_SLIPPAGE)) {
          const a = sym(inMint), b = sym(outMint);
          return { kind: "jupiter", inMint, outMint, inSymbol: a?.symbol ?? null, outSymbol: b?.symbol ?? null, inDecimals: a?.decimals ?? null, outDecimals: b?.decimals ?? null,
            amountIn: r.inAmount.toString(), minOut: shownMin.toString(), fee: !!r.feeAccount };
        }
      }
    }
    throw rpcError(ERR.rejected, "Madar Wallet signs only checked swaps and transfers from its own Swap page on Solana");
  }

  async function solReview(tx: ReturnType<typeof parseSolTransaction>, me: string, s: Settings): Promise<SolTxReview> {
    const tables = tx.lookups.length ? await deps.solTables(tx.lookups.map((l) => l.table)).catch(() => ({})) : {};
    const keys = accountKeys(tx, tables);
    const items: SolItem[] = tx.instructions.map((ix) => describeInstruction(ix, keys));

    const look = new Set<string>();
    for (const x of items) {
      if (x.kind === "token-transfer") { if (x.dest) look.add(x.dest); if (!x.mint && x.source) look.add(x.source); }
      if (x.kind === "token-approve" && !x.mint && x.source) look.add(x.source);
    }
    const info = look.size ? await deps.solTokenAccounts([...look]).catch(() => ({} as Record<string, null>)) : {};
    const created = new Map<string, { owner: string | null; mint: string | null }>();
    for (const x of items) if (x.kind === "create-ata" && x.ata) created.set(x.ata, { owner: x.owner, mint: x.mint });
    const known = (mint: string | null) => {
      if (!mint) return null;
      const v = SOL.tokens.find((t) => t.address === mint) ?? s.customTokens.find((t) => t.networkId === SOL.id && t.address === mint);
      return v ? { symbol: v.symbol, decimals: v.decimals } : mint === "So11111111111111111111111111111111111111112" ? { symbol: "wSOL", decimals: 9 } : null;
    };
    for (const x of items) {
      if (x.kind === "token-transfer" || x.kind === "token-approve") {
        const src = x.source ? info[x.source] : null;
        const mint = x.mint ?? src?.mint ?? null;
        const k = known(mint);
        x.mint = mint;
        x.symbol = k?.symbol ?? null;
        x.decimals = x.decimals ?? src?.decimals ?? k?.decimals ?? null;
        if (x.kind === "token-transfer") x.destOwner = (x.dest && (info[x.dest]?.owner ?? created.get(x.dest)?.owner)) || null;
        x.incomplete = !x.source || (x.kind === "token-transfer" ? !x.dest : !x.delegate) || x.decimals == null;
      }
      if (x.kind === "create-ata") { x.symbol = known(x.mint)?.symbol ?? null; x.incomplete = !x.owner || !x.mint; }
      if (x.kind === "sol-transfer") x.incomplete = !x.from || !x.to;
      if (x.kind === "create-account") x.incomplete = !x.from || !x.account;
      if (x.kind === "token-close") x.incomplete = !x.account || !x.dest;
    }
    return { version: tx.version, feePayer: tx.staticKeys[0], payerIsYou: tx.staticKeys[0] === me, fee: estimateSolFee(tx, items).toString(), otherSigners: tx.header.required - 1, items };
  }

  return { handle, state };
}

function activityFor(n: Network, r: EvmTxReview): { asset: string; amount: string; to: string } {
  if (r.call.kind === "kyber") {
    const c = r.call, sym = c.tokenIn ? c.payInfo?.symbol : n.native.symbol, dec = c.tokenIn ? c.payInfo?.decimals : r.nativeDecimals;
    if (sym && dec != null) return { asset: sym, amount: formatUnits(BigInt(c.amountIn), dec), to: getAddress(r.to) };
  }
  if (r.call.kind === "split" && r.call.tokenInfo) return { asset: r.call.tokenInfo.symbol, amount: formatUnits(BigInt(r.call.amount), r.call.tokenInfo.decimals), to: r.call.recipient };
  if (r.call.kind === "erc20" && r.call.token && (r.call.fn === "transfer" || r.call.fn === "transferFrom")) {
    const amt = r.call.fields.find((f) => f.k === "amount")?.v ?? "0";
    return { asset: r.call.token.symbol, amount: formatUnits(BigInt(amt), r.call.token.decimals), to: r.call.fields.find((f) => f.k === "recipient")?.v ?? r.to };
  }
  return { asset: n.native.symbol, amount: formatUnits(BigInt(r.value), r.nativeDecimals), to: getAddress(r.to) };
}

function solActivity(r: SolTxReview): { asset: string; amount: string; to: string } {
  const tr = r.items.find((x) => x.kind === "token-transfer" || x.kind === "sol-transfer");
  if (tr?.kind === "sol-transfer") return { asset: "SOL", amount: formatUnits(BigInt(tr.lamports), 9), to: tr.to ?? "" };
  if (tr?.kind === "token-transfer") return { asset: tr.symbol ?? "?", amount: tr.decimals != null ? formatUnits(BigInt(tr.amount), tr.decimals) : tr.amount, to: tr.destOwner ?? tr.dest ?? "" };
  return { asset: "", amount: "—", to: "" };
}
