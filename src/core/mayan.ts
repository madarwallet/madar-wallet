import { keccak_256 } from "@noble/hashes/sha3.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { base58 } from "@scure/base";
import { ataAddress, programAddress, TOKEN_PROGRAM } from "./solbase";
import { parseSolTransaction, type RawIx } from "../dapp/soldecode";

export const MAYAN_API = "https://swap.madarwallet.app/mayan";
export const SWIFT_V2 = "mayan34VedncxdK2XobtvWFDXQASUTBXhUVzt2kKgny";
export const FEE_MANAGER = "5VtQHnhs2pfVEr68qQsbTRwKh4JV5GTu9mBHgHFxpHeQ";
export const SYSTEM_PROGRAM = "11111111111111111111111111111111";
export const ATA_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
export const COMPUTE_BUDGET = "ComputeBudget111111111111111111111111111111";
const SYSVAR_RENT = "SysvarRent111111111111111111111111111111111";
const MAYAN_SOLANA_PROGRAM = "FC4eXxkyrMPTjiYUpp4EAnkmwMbQyZ6NDCh1kfLn6vsf";
const MAYAN_FORWARDER = "0x337685fdaB40D39bd02028545a4FfA7D287cC3E2";
const SDK_VERSION = "15_2_2";

export const MAYAN_REFERRER = "BxMsjB6DM2cZV2vhzPQBETJnBh257ewnvkT61CoZpEMt";

export const MAYAN_CHAINS: Record<number, { name: string; wormhole: number }> = {
  1: { name: "ethereum", wormhole: 2 }, 56: { name: "bsc", wormhole: 4 }, 137: { name: "polygon", wormhole: 5 }, 43114: { name: "avalanche", wormhole: 6 },
  42161: { name: "arbitrum", wormhole: 23 }, 10: { name: "optimism", wormhole: 24 }, 8453: { name: "base", wormhole: 30 },
};

export const MAYAN_SOL_TOKENS: Record<string, number> = {
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: 6,
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: 6,
};
const EVM_ZERO = "0x0000000000000000000000000000000000000000";

export const MAX_PRIORITY_PRICE = 200_000n;
export const COMPUTE_LIMIT = 250_000;
export const MAX_PROTOCOL_BPS = 10;
export const MAX_DEADLINE_S = 3 * 3600;

export interface MayanRequest {
  mint: string;
  amount: bigint;
  chainId: number;
  toToken: string;
  toDecimals: number;
  trader: string;
  dest: string;
  feeBps: number;
  slippageBps: number;
}

export interface MayanQuote {
  type: string; swiftVersion: string; swiftMayanContract: string; gasless: boolean; relayer: string | null;
  fromChain: string; toChain: string; quoteId: string; memoHex?: string;
  fromToken: { contract: string; decimals: number };
  toToken: { contract: string; decimals: number; wChainId: number; symbol?: string };
  swiftInputContract: string; swiftInputContractStandard: string; swiftInputDecimals: number;
  effectiveAmountIn64: string; minAmountOut: number; expectedAmountOut: number; gasDrop: number;
  cancelRelayerFee64: string; refundRelayerFee64: string; submitRelayerFee64: string; deadline64: string;
  referrerBps: number; protocolBps: number; swiftAuctionMode: number; suggestedPriorityFee: number; etaSeconds?: number; toTokenPrice?: number;
}
const unsafe = (why: string) => Object.assign(new Error("ERR_UNSAFE"), { why });
const sameAddr = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const isNativeEvm = (a: string) => sameAddr(a, EVM_ZERO) || sameAddr(a, "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE");

export function mayanQuoteParams(r: MayanRequest): URLSearchParams {
  const c = MAYAN_CHAINS[r.chainId];
  if (!c || !(r.mint in MAYAN_SOL_TOKENS)) throw unsafe("route");
  const p = new URLSearchParams({
    amountIn64: r.amount.toString(), fromToken: r.mint, fromChain: "solana", toToken: isNativeEvm(r.toToken) ? EVM_ZERO : r.toToken, toChain: c.name,
    slippageBps: String(r.slippageBps), swift: "true", mctp: "false", wormhole: "false", fastMctp: "false", shuttle: "false", gasless: "false",
    onlyDirect: "true", monoChain: "false", solanaProgram: MAYAN_SOLANA_PROGRAM, forwarderAddress: MAYAN_FORWARDER, sdkVersion: SDK_VERSION,
  });
  if (r.feeBps > 0) { p.set("referrer", MAYAN_REFERRER); p.set("referrerBps", String(r.feeBps)); }
  return p;
}
export async function mayanQuote(r: MayanRequest): Promise<MayanQuote> {
  const res = await fetch(`${MAYAN_API}/quote?${mayanQuoteParams(r)}`, { signal: AbortSignal.timeout(20_000), referrerPolicy: "no-referrer", cache: "no-store" });
  const j = await res.json().catch(() => ({}));
  const q = Array.isArray(j?.quotes) ? j.quotes[0] : null;
  if (!res.ok || !q) throw Object.assign(new Error(j?.msg || "no route"), { noRoute: true });
  checkMayanQuote(q, r);
  return q;
}

export function fractional(amount: number, decimals: number): bigint {
  if (!Number.isFinite(amount) || amount < 0) throw unsafe("amount");
  const cut = Math.min(8, decimals);
  const m = /^\d+(?:\.\d{0,8})?/.exec(amount.toFixed(cut + 1));
  if (!m) throw unsafe("amount");
  const [i, f = ""] = m[0].split(".");
  const fr = f.slice(0, cut).padEnd(decimals, "0");
  return BigInt(i + fr);
}
const u64 = (s: string | number | bigint) => { const v = BigInt(s); if (v < 0n || v >= 1n << 64n) throw unsafe("u64"); return v; };

export function checkMayanQuote(q: MayanQuote, r: MayanRequest, nowS = Math.floor(Date.now() / 1000)): void {
  const c = MAYAN_CHAINS[r.chainId];
  if (!c) throw unsafe("chain");
  if (q.type !== "SWIFT" || q.swiftVersion !== "V2" || q.swiftMayanContract !== SWIFT_V2) throw unsafe("type");
  if (q.gasless !== false || q.relayer) throw unsafe("gasless");
  if (q.fromChain !== "solana" || q.toChain !== c.name || q.toToken?.wChainId !== c.wormhole) throw unsafe("chains");
  if (!(r.mint in MAYAN_SOL_TOKENS) || q.fromToken?.contract !== r.mint || q.swiftInputContract !== r.mint) throw unsafe("input");
  if (q.swiftInputContractStandard !== "spl" || q.swiftInputDecimals !== MAYAN_SOL_TOKENS[r.mint]) throw unsafe("input standard");
  if (u64(q.effectiveAmountIn64) !== r.amount) throw unsafe("amount in");
  const want = isNativeEvm(r.toToken) ? EVM_ZERO : r.toToken;
  if (!/^0x[0-9a-fA-F]{40}$/.test(q.toToken?.contract ?? "") || !sameAddr(q.toToken.contract, want) || q.toToken.decimals !== r.toDecimals) throw unsafe("output");
  if (q.referrerBps !== r.feeBps || !Number.isInteger(q.protocolBps) || q.protocolBps < 0 || q.protocolBps > MAX_PROTOCOL_BPS) throw unsafe("fees");
  if (q.gasDrop !== 0 || u64(q.submitRelayerFee64) !== 0n) throw unsafe("extras");

  if (u64(q.cancelRelayerFee64) * 10n > r.amount || u64(q.refundRelayerFee64) * 10n > r.amount) throw unsafe("refund fees");
  if (!(q.minAmountOut > 0) || !(q.expectedAmountOut >= q.minAmountOut)) throw unsafe("min out");
  if (fractional(q.minAmountOut, r.toDecimals) <= 0n) throw unsafe("min out");
  const dl = Number(u64(q.deadline64));
  if (dl <= nowS || dl > nowS + MAX_DEADLINE_S) throw unsafe("deadline");
  if (!Number.isInteger(q.swiftAuctionMode) || q.swiftAuctionMode < 1 || q.swiftAuctionMode > 3) throw unsafe("auction");
  if (!Number.isInteger(q.suggestedPriorityFee) || q.suggestedPriorityFee < 0 || BigInt(q.suggestedPriorityFee) > MAX_PRIORITY_PRICE) throw unsafe("priority");
  if (!/^(0x)?[0-9a-fA-F]{1,32}$/.test(q.quoteId ?? "")) throw unsafe("quote id");
}

export interface Ix { program: string; keys: [string, boolean, boolean][]; data: Uint8Array }
const hexBytes = (h: string) => { const s = h.replace(/^0x/, ""); if (s.length % 2) throw unsafe("hex"); return Uint8Array.from(s.match(/../g) ?? [], (b) => parseInt(b, 16)); };
const pad32 = (b: Uint8Array) => { if (b.length > 32) throw unsafe("pad"); const o = new Uint8Array(32); o.set(b, 32 - b.length); return o; };
const evm32 = (a: string) => { if (!/^0x[0-9a-fA-F]{40}$/.test(a)) throw unsafe("evm address"); return pad32(hexBytes(a)); };
const sol32 = (a: string) => { const b = base58.decode(a); if (b.length !== 32) throw unsafe("sol address"); return b; };
class W {
  buf: number[] = [];
  u8(v: number) { this.buf.push(v & 255); return this; }
  u16le(v: number) { return this.u8(v).u8(v >> 8); }
  u16be(v: number) { return this.u8(v >> 8).u8(v); }
  u64le(v: bigint) { for (let i = 0n; i < 8n; i++) this.u8(Number((v >> (8n * i)) & 255n)); return this; }
  u64be(v: bigint) { for (let i = 7n; i >= 0n; i--) this.u8(Number((v >> (8n * i)) & 255n)); return this; }
  bytes(b: Uint8Array) { this.buf.push(...b); return this; }
  out() { return Uint8Array.from(this.buf); }
}
const INIT_ORDER = sha256(new TextEncoder().encode("global:init_order")).slice(0, 8);

export function swiftRandomKey(q: MayanQuote, random16: Uint8Array = crypto.getRandomValues(new Uint8Array(16))): Uint8Array {
  const id = pad32(hexBytes(q.quoteId)).slice(16);
  const tail = q.memoHex ? pad32(hexBytes(q.memoHex)).slice(16) : random16;
  if (tail.length !== 16) throw unsafe("random key");
  const k = new Uint8Array(32); k.set(id, 0); k.set(tail, 16); return k;
}

export function buildSwiftIxs(q: MayanQuote, r: MayanRequest, randomKey: Uint8Array, opts: { computeLimit?: boolean } = {}): { ixs: Ix[]; state: string } {
  const c = MAYAN_CHAINS[r.chainId];
  const amountIn = u64(q.effectiveAmountIn64);
  const minOut = fractional(q.minAmountOut, Math.min(q.toToken.decimals, 8));
  const tokenOut = isNativeEvm(q.toToken.contract) ? new Uint8Array(32) : evm32(q.toToken.contract);
  const ref = r.feeBps > 0 ? sol32(MAYAN_REFERRER) : new Uint8Array(32);
  const cancel = u64(q.cancelRelayerFee64), refund = u64(q.refundRelayerFee64), deadline = u64(q.deadline64);
  if (randomKey.length !== 32) throw unsafe("random key");

  const order = new W().u8(1).bytes(sol32(r.trader)).u16be(1).bytes(sol32(r.mint)).bytes(evm32(r.dest)).u16be(c.wormhole).bytes(tokenOut)
    .u64be(minOut).u64be(0n).u64be(cancel).u64be(refund).u64be(deadline).bytes(ref).u8(q.referrerBps).u8(q.protocolBps).u8(q.swiftAuctionMode)
    .bytes(randomKey).bytes(new Uint8Array(32)).out();
  if (order.length !== 272) throw unsafe("order size");
  const hash = keccak_256(order);
  const state = programAddress([new TextEncoder().encode("STATE_SOURCE"), hash, new W().u16le(c.wormhole).out()], SWIFT_V2);
  const stateAccount = ataAddress(state, r.mint, TOKEN_PROGRAM);
  const userAccount = ataAddress(r.trader, r.mint, TOKEN_PROGRAM);
  const ixs: Ix[] = [];
  if (opts.computeLimit !== false) ixs.push({ program: COMPUTE_BUDGET, keys: [], data: new W().u8(2).u8(COMPUTE_LIMIT).u8(COMPUTE_LIMIT >> 8).u8(COMPUTE_LIMIT >> 16).u8(COMPUTE_LIMIT >> 24).out() });
  if (q.suggestedPriorityFee > 0) ixs.push({ program: COMPUTE_BUDGET, keys: [], data: new W().u8(3).u64le(BigInt(q.suggestedPriorityFee)).out() });
  ixs.push({ program: ATA_PROGRAM, data: Uint8Array.of(1), keys: [
    [r.trader, true, true], [stateAccount, false, true], [state, false, false], [r.mint, false, false],
    [SYSTEM_PROGRAM, false, false], [TOKEN_PROGRAM, false, false], [SYSVAR_RENT, false, false]] });
  ixs.push({ program: TOKEN_PROGRAM, data: new W().u8(3).u64le(amountIn).out(), keys: [[userAccount, false, true], [stateAccount, false, true], [r.trader, true, false]] });
  const data = new W().bytes(INIT_ORDER).u64le(amountIn).u8(0).u64le(0n).bytes(evm32(r.dest)).u16le(c.wormhole).bytes(tokenOut)
    .u64le(minOut).u64le(0n).u64le(cancel).u64le(refund).u64le(deadline).bytes(ref).u8(q.referrerBps).u8(q.protocolBps).u8(q.swiftAuctionMode).bytes(randomKey).out();
  ixs.push({ program: SWIFT_V2, data, keys: [
    [r.trader, false, false], [r.trader, true, true], [state, false, true], [stateAccount, false, true], [userAccount, false, true],
    [SWIFT_V2, false, false], [r.mint, false, false], [FEE_MANAGER, false, false], [TOKEN_PROGRAM, false, false], [SYSTEM_PROGRAM, false, false]] });
  return { ixs, state };
}

export const mayanSummary = (q: MayanQuote) => ({
  amountOut: fractional(q.expectedAmountOut, q.toToken.decimals), minOut: fractional(q.minAmountOut, q.toToken.decimals),
  etaSeconds: Number(q.etaSeconds) || 0,
});

export function mayanCostPct(q: MayanQuote, r: MayanRequest): number | null {
  const px = Number(q.toTokenPrice), usdIn = Number(r.amount) / 10 ** MAYAN_SOL_TOKENS[r.mint];
  if (!(px > 0) || !(usdIn > 0)) return null;
  return (1 - (q.expectedAmountOut * px) / usdIn) * 100;
}

export interface MayanStatus { status?: string; clientStatus?: string; fulfillTxHash?: string | null; refundTxHash?: string | null }
export async function mayanStatus(sig: string): Promise<MayanStatus> {
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(sig)) return {};
  const r = await fetch(`${MAYAN_API}/status/${sig}`, { signal: AbortSignal.timeout(20_000), referrerPolicy: "no-referrer", cache: "no-store" });
  return r.ok ? r.json().catch(() => ({})) : {};
}

export function mayanStage(st: MayanStatus): { step: 2 | 3 | 4; end: "" | "ok" | "refunded" | "failed" } {

  const c = String(st.clientStatus ?? ""), s = String(st.status ?? "");
  if (c === "COMPLETED") return { step: 4, end: "ok" };
  if (c === "REFUNDED" || c === "CANCELED") return { step: 4, end: "refunded" };
  if (c === "FAILED") return { step: 3, end: "failed" };
  if (s.startsWith("ORDER_") && s !== "ORDER_SUBMITTED" && s !== "ORDER_CREATED") return { step: 3, end: "" };
  return { step: 2, end: "" };
}

export interface SwiftOrderView {
  mint: string; amount: bigint; dest: string; chainId: number; tokenOut: string ;
  minOut8: bigint ; feeBps: number; deadline: number;
}

export function readSwiftOrderTx(raw: Uint8Array, me: string, nowS = Math.floor(Date.now() / 1000)): SwiftOrderView {
  let t: ReturnType<typeof parseSolTransaction>;
  try { t = parseSolTransaction(raw); } catch { throw unsafe("parse"); }
  if (t.lookups.length || t.sigCount !== 1 || t.header.required !== 1 || t.staticKeys[0] !== me) throw unsafe("signers");
  const k = t.staticKeys, prog = (ix: RawIx) => k[ix.programIndex];
  const key = (ix: RawIx, i: number) => { const v = ix.accounts[i]; if (v == null || v >= k.length) throw unsafe("account"); return k[v]; };
  const le = (d: Uint8Array, o: number, n: number) => { let v = 0n; for (let i = n - 1; i >= 0; i--) v = (v << 8n) | BigInt(d[o + i]); return v; };
  const budget = t.instructions.filter((ix) => prog(ix) === COMPUTE_BUDGET), rest = t.instructions.filter((ix) => prog(ix) !== COMPUTE_BUDGET);
  for (const ix of budget) {
    const d = ix.data;
    if (d[0] === 2 && d.length === 5 && Number(le(d, 1, 4)) <= 1_400_000) continue;
    if (d[0] === 3 && d.length === 9 && le(d, 1, 8) <= MAX_PRIORITY_PRICE) continue;
    throw unsafe("compute budget");
  }
  if (budget.length > 2 || rest.length !== 3) throw unsafe("steps");
  const [ata, move, init] = rest;
  if (prog(ata) !== ATA_PROGRAM || prog(move) !== TOKEN_PROGRAM || prog(init) !== SWIFT_V2) throw unsafe("programs");
  const d = init.data;
  if (d.length !== 8 + 8 + 1 + 8 + 32 + 2 + 32 + 8 * 5 + 32 + 3 + 32 || init.accounts.length !== 10) throw unsafe("init size");
  if (d.slice(0, 8).some((b, i) => b !== INIT_ORDER[i])) throw unsafe("init");
  let o = 8;
  const amount = le(d, o, 8); o += 8;
  const native = d[o]; o += 1;
  const feeSubmit = le(d, o, 8); o += 8;
  const destB = d.slice(o, o + 32); o += 32;
  const wormhole = Number(le(d, o, 2)); o += 2;
  const outB = d.slice(o, o + 32); o += 32;
  const minOut8 = le(d, o, 8); o += 8;
  const gasDrop = le(d, o, 8); o += 8;
  const cancel = le(d, o, 8); o += 8;
  const refund = le(d, o, 8); o += 8;
  const deadline = Number(le(d, o, 8)); o += 8;
  const ref = d.slice(o, o + 32); o += 32;
  const feeRef = d[o], feeMayan = d[o + 1], auction = d[o + 2]; o += 3;
  const randomKey = d.slice(o, o + 32);
  const chainId = Number(Object.keys(MAYAN_CHAINS).find((c) => MAYAN_CHAINS[Number(c)].wormhole === wormhole));
  if (!chainId) throw unsafe("network");
  if (native !== 0 || feeSubmit !== 0n || gasDrop !== 0n || amount <= 0n || minOut8 <= 0n) throw unsafe("fields");
  if (destB.slice(0, 12).some((b) => b !== 0) || outB.slice(0, 12).some((b) => b !== 0)) throw unsafe("evm addresses");
  if (cancel * 10n > amount || refund * 10n > amount) throw unsafe("refund fees");
  if (deadline <= nowS || deadline > nowS + MAX_DEADLINE_S) throw unsafe("deadline");
  if (feeMayan > MAX_PROTOCOL_BPS || auction < 1 || auction > 3) throw unsafe("fees");
  const refIsOurs = base58.encode(ref) === MAYAN_REFERRER, refNone = ref.every((b) => b === 0);
  if (!((feeRef === 50 && refIsOurs) || (feeRef === 0 && (refNone || refIsOurs)))) throw unsafe("referrer");

  const mint = key(init, 6);
  if (!(mint in MAYAN_SOL_TOKENS)) throw unsafe("coin");
  if (key(init, 0) !== me || key(init, 1) !== me || key(init, 5) !== SWIFT_V2 || key(init, 7) !== FEE_MANAGER || key(init, 8) !== TOKEN_PROGRAM || key(init, 9) !== SYSTEM_PROGRAM) throw unsafe("init accounts");
  const userAccount = ataAddress(me, mint, TOKEN_PROGRAM);
  if (key(init, 4) !== userAccount) throw unsafe("payer account");

  const order = new W().u8(1).bytes(sol32(me)).u16be(1).bytes(sol32(mint)).bytes(destB).u16be(wormhole).bytes(outB).u64be(minOut8).u64be(0n)
    .u64be(cancel).u64be(refund).u64be(BigInt(deadline)).bytes(ref).u8(feeRef).u8(feeMayan).u8(auction).bytes(randomKey).bytes(new Uint8Array(32)).out();
  const state = programAddress([new TextEncoder().encode("STATE_SOURCE"), keccak_256(order), new W().u16le(wormhole).out()], SWIFT_V2);
  const stateAccount = ataAddress(state, mint, TOKEN_PROGRAM);
  if (key(init, 2) !== state || key(init, 3) !== stateAccount) throw unsafe("state");

  if (!(ata.data.length === 1 && ata.data[0] === 1) || ata.accounts.length !== 7 || key(ata, 0) !== me || key(ata, 1) !== stateAccount || key(ata, 2) !== state
    || key(ata, 3) !== mint || key(ata, 4) !== SYSTEM_PROGRAM || key(ata, 5) !== TOKEN_PROGRAM) throw unsafe("open account");

  if (move.data.length !== 9 || move.data[0] !== 3 || le(move.data, 1, 8) !== amount || move.accounts.length !== 3
    || key(move, 0) !== userAccount || key(move, 1) !== stateAccount || key(move, 2) !== me) throw unsafe("transfer");
  const hex = (b: Uint8Array) => "0x" + Array.from(b.slice(12), (x) => x.toString(16).padStart(2, "0")).join("");
  return { mint, amount, dest: hex(destB), chainId, tokenOut: hex(outB), minOut8, feeBps: feeRef, deadline };
}
