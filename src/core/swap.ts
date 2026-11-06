import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { base58 } from "@scure/base";
import { createWalletClient, decodeFunctionData, erc20Abi, fallback, http, type Address, type Hash, type Hex } from "viem";
import { evmAccount, evmAddress } from "./account";
import type { Network } from "./chains";
import { checkFeeRise, feeFields, gasFees, publicClient, type GasFees } from "./chainops";
import { solAddress, solSecret, solRpc } from "./sol";
import { accountKeys, ATA_PROGRAM, COMPUTE_BUDGET_PROGRAM, parseSolTransaction, SYSTEM_PROGRAM, TOKEN_2022_PROGRAM, TOKEN_PROGRAM, type RawIx } from "../dapp/soldecode";

import { KYBER_ABI, KYBER_EXECUTORS, KYBER_ROUTER } from "../dapp/evmdecode";
import { guardEvm, simKey } from "./simulate";
import { DROP_CHAINS } from "./gasdrop";

export { KYBER_ROUTER };
const KYBER_API = "https://aggregator-api.kyberswap.com";
const CLIENT_ID = "madar-swap";
export const FEE_BPS = 50;

export const FEE_BPS_INVITE = 40;
let feeDiscount = false;

export const feeBps = () => (feeDiscount ? FEE_BPS_INVITE : FEE_BPS);

export const feeBpsFor = (s: { invited?: boolean; inviter?: boolean } | null | undefined) => (s && (s.invited === true || s.inviter === true) ? FEE_BPS_INVITE : FEE_BPS);
export function setFeeDiscount(on: boolean) { feeDiscount = on; }
const FEE_RECEIVER = "0xb95c91Bb8C58b929d501BD8D0aCcB420F8A7045d";

export const FEE_VAULT = "0xd735985e0d0c0ed4d6de8671df6b19e8e54283e0";

export const VAULT_DOLLARS: Readonly<Record<string, readonly string[]>> = {
  ethereum: ["0xdac17f958d2ee523a2206206994597c13d831ec7", "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"],
  bsc: ["0x55d398326f99059ff775485246999027b3197955", "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d"],
  arbitrum: ["0xaf88d065e77c8cc2239327c5edb3a432268e5831", "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9", "0xff970a61a04b1ca14834a43f5de4533ebddb5cc8"],
  base: ["0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", "0xfde4c96c8593536e31f229ea8f37b2ada2699bb2"],
  polygon: ["0x3c499c542cef5e3811e1192ce70d8cc03d5c3359", "0xc2132d05d31c914a87c6611c10748aeb04b58e8f", "0x2791bca1f2de4661ed88a30c99a7a9449aa84174"],
};

export function feeReceiverFor(netId: string, tokenIn: string): string {
  const t = tokenIn.toLowerCase();
  const usable = netId in DROP_CHAINS && (t === EVM_NATIVE.toLowerCase() || (VAULT_DOLLARS[netId] ?? []).includes(t));
  return usable ? FEE_VAULT : FEE_RECEIVER;
}

const JUP_HOSTS = ["https://lite-api.jup.ag", "https://api.jup.ag"];
export const SOL_FEE_BPS = 50;
const SOL_FEE_ACCOUNTS: Record<string, string> = {
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: "C8xmfz6voEYL85fuP5RqqBV7dLNXnW1QsUsawD6ofwG9",
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: "BLfTQuBxrVxBXfmFQVzt4BPVBQ8M8x1R9i6C7ipUX1CD",
  So11111111111111111111111111111111111111112: "2Fy3QzcNCFBQK8PaLZD6ejWPpMbHpy6WGDNhaSF3dh7H",
};

export const FEE_EXEMPT = ["0xb95c91bb8c58b929d501bd8d0accb420f8a7045d", "0x1c6644003f1d3f81440edbbfe2384b33d4d294e3", "0xe231c06dd277b30fb91b775d735c54a49674be2f", "0xa14126af929e7c686959bb0d4d36ff0c133c0960"];
export const SOL_FEE_EXEMPT = ["BxMsjB6DM2cZV2vhzPQBETJnBh257ewnvkT61CoZpEMt", "9ymBLo3qf3WSLXUE7NUEBsTNGTGB92bQb53YhJBNiUEK", "J87juJc1TW5kTwMaTJF6KdJv1SNaUJMoYWnGhiyFUdG2"];

export const evmFeeOn = (owner: string) => feeBps() > 0 && !FEE_EXEMPT.includes(owner.toLowerCase());
export const solFeeOn = (owner: string) => feeBps() > 0 && !SOL_FEE_EXEMPT.includes(owner);
export const EVM_NATIVE = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
export const SOL_MINT = "So11111111111111111111111111111111111111112";
export const SLIPPAGE_BPS = 50;
const KYBER_CHAIN: Record<string, string> = { ethereum: "ethereum", bsc: "bsc", polygon: "polygon", base: "base", arbitrum: "arbitrum", optimism: "optimism", avalanche: "avalanche" };

const TIMEOUT = 15_000;
const retryable = (e: any) => !e?.status || e.status === 429 || e.status >= 500;
export async function jupJson(path: string, init?: RequestInit, hosts = JUP_HOSTS, get: typeof getJson = getJson): Promise<any> {
  let last: unknown;
  for (const h of hosts) {
    try { return await get(`${h}${path}`, init); } catch (e) { last = e; if (!retryable(e)) throw e; }
  }
  throw last;
}
async function getJson(url: string, init?: RequestInit): Promise<any> {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT), referrerPolicy: "no-referrer" });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j?.message || j?.error || `HTTP ${r.status}`), { status: r.status, api: true });
  return j;
}

export interface SwapQuote {
  amountIn: bigint;
  amountOut: bigint;
  minOut: bigint;
  fee: { amount: bigint; onOutput: boolean } | null;
  raw: unknown;

  fees?: GasFees;

  via?: "kyber" | "lifi";
}

export function sameCostPct(q: SwapQuote, sol: boolean): number | null {
  const r = q.raw as any;
  if (sol) { const imp = parseFloat(r?.priceImpactPct ?? ""); return Number.isFinite(imp) ? imp * 100 + (q.fee ? feeBps() / 100 : 0) : null; }
  const i = parseFloat(r?.routeSummary?.amountInUsd ?? ""), o = parseFloat(r?.routeSummary?.amountOutUsd ?? "");
  return i > 0 && o >= 0 ? ((i - o) / i) * 100 : null;
}

export const bigCostNote = (pct: number | null | undefined): number | null => (pct != null && Number.isFinite(pct) && pct > 5 ? Math.round(pct) : null);

const kyber = async (n: Network, path: string, init?: RequestInit) => {
  const key = n.swap ? n.swap.kyber : KYBER_CHAIN[n.id];
  if (!key) throw new Error("ERR_UNSUPPORTED");
  const j = await getJson(`${KYBER_API}/${key}/api/v1/${path}`, { ...init, headers: { "X-Client-Id": CLIENT_ID, ...(init?.headers || {}) } });
  if (j.code !== 0 || !j.data) throw Object.assign(new Error(j.message || "api"), { api: true });
  return j.data;
};

export const routeQuery = (tokenIn: string, tokenOut: string, amountIn: bigint, fee: boolean, receiver: string = FEE_RECEIVER) =>
  new URLSearchParams({ tokenIn, tokenOut, amountIn: amountIn.toString(), ...(fee ? { feeAmount: String(feeBps()), isInBps: "true", chargeFeeBy: "currency_in", feeReceiver: receiver } : {}) });

export async function evmQuote(n: Network, tokenIn: string, tokenOut: string, amountIn: bigint, owner: string): Promise<SwapQuote> {
  const fee = evmFeeOn(owner);
  const [d, fees] = await Promise.all([kyber(n, "routes?" + routeQuery(tokenIn, tokenOut, amountIn, fee, feeReceiverFor(n.id, tokenIn))), gasFees(n).catch(() => undefined)]);
  const out = BigInt(d.routeSummary.amountOut);
  return { amountIn, amountOut: out, minOut: (out * BigInt(10000 - SLIPPAGE_BPS)) / 10000n, fee: fee ? { amount: (amountIn * BigInt(feeBps())) / 10000n, onOutput: false } : null, raw: d, fees };
}

export async function evmAllowance(n: Network, phrase: string, index: number, token: string, spender: string = KYBER_ROUTER): Promise<bigint> {
  if (token.toLowerCase() === EVM_NATIVE.toLowerCase()) return 2n ** 255n;
  const owner = evmAddress(phrase, index);
  return (await publicClient(n).readContract({ address: token as Address, abi: erc20Abi, functionName: "allowance", args: [owner, spender as Address] })) as bigint;
}

export const wallet = (n: Network, phrase: string, index: number) =>
  createWalletClient({ account: evmAccount(phrase, index), chain: n.chain, transport: fallback(n.rpcs.map((u) => http(u, { timeout: 12_000 }))) });

export async function waitOk(n: Network, hash: Hash) {
  const r = await publicClient(n).waitForTransactionReceipt({ hash, timeout: 150_000 }).catch(() => null);
  if (!r) throw Object.assign(new Error("ERR_PENDING"), { hash });
  if (r.status !== "success") throw Object.assign(new Error("ERR_CHAIN"), { hash });
}

export async function sendFees(n: Network, reviewed?: GasFees, deadline = false): Promise<GasFees> {
  const fresh = await gasFees(n, deadline);
  if (reviewed) checkFeeRise(reviewed, fresh);
  return fresh;
}

export async function evmApprove(n: Network, phrase: string, index: number, token: string, amount: bigint, current: bigint, spender: string = KYBER_ROUTER, reviewed?: GasFees) {
  const w = wallet(n, phrase, index);
  const needsReset = n.id === "ethereum" && token.toLowerCase() === "0xdac17f958d2ee523a2206206994597c13d831ec7" && current > 0n;
  for (const v of needsReset ? [0n, amount] : [amount]) {
    const fees = await sendFees(n, reviewed);
    const hash = await w.writeContract({ address: token as Address, abi: erc20Abi, functionName: "approve", args: [spender as Address, v], ...feeFields(fees) } as never);
    await waitOk(n, hash);
  }
}

export { KYBER_EXECUTORS };
type KyberDesc = { flags: bigint; srcToken: string; dstToken: string; srcReceivers: readonly string[]; srcAmounts: readonly bigint[]; feeReceivers: readonly string[]; feeAmounts: readonly bigint[]; dstReceiver: string; amount: bigint; minReturnAmount: bigint; permit: Hex };

export function checkKyberBuild(b: any, e: { tokenIn: string; tokenOut: string; amountIn: bigint; me: string; shownOut: bigint; fee: boolean; receiver?: string }): { data: Hex; value: bigint } {
  const unsafe = (why: string) => Object.assign(new Error("ERR_UNSAFE"), { why });
  const same = (x: unknown, y: string) => String(x ?? "").toLowerCase() === y.toLowerCase();
  const value = same(e.tokenIn, EVM_NATIVE) ? e.amountIn : 0n;
  if (!same(b?.routerAddress, KYBER_ROUTER) || !/^0x[0-9a-fA-F]{8,}$/.test(b?.data || "") || BigInt(b.transactionValue || "0") !== value || b.amountIn !== e.amountIn.toString()) throw unsafe("build");
  let d;
  try { d = decodeFunctionData({ abi: KYBER_ABI, data: b.data }); } catch { throw unsafe("decode"); }
  const args = (d.args ?? []) as readonly unknown[];
  const desc = (d.functionName === "swap" ? (args[0] as { desc: KyberDesc }).desc : args[1]) as KyberDesc;

  const target = d.functionName === "swap" ? (args[0] as { callTarget: string }).callTarget : (args[0] as string);
  if (!KYBER_EXECUTORS.some((x) => same(target, x))) throw unsafe("executor");

  if (desc.srcReceivers.length !== desc.srcAmounts.length || desc.srcAmounts.reduce((a, b) => a + b, 0n) > desc.amount) throw unsafe("source amounts");
  if (!same(desc.srcToken, e.tokenIn) || !same(desc.dstToken, e.tokenOut)) throw unsafe("tokens");
  if (!same(desc.dstReceiver, e.me)) throw unsafe("receiver");
  if (desc.amount !== e.amountIn) throw unsafe("amount");
  if (desc.permit !== "0x") throw unsafe("permit");

  if (d.functionName === "swap" && !same((args[0] as { approveTarget: string }).approveTarget, "0x0000000000000000000000000000000000000000")) throw unsafe("approve target");
  if (desc.flags !== (e.fee ? 0x280n : 0x200n)) throw unsafe("flags");
  const fees = desc.feeReceivers.map((x) => x.toLowerCase());
  if (e.fee ? !(fees.length === 1 && fees[0] === (e.receiver ?? FEE_RECEIVER).toLowerCase() && desc.feeAmounts[0] === BigInt(feeBps())) : fees.length !== 0) throw unsafe("fee");
  const shownMin = (e.shownOut * BigInt(10000 - SLIPPAGE_BPS)) / 10000n;
  if (desc.minReturnAmount * 10000n < shownMin * 9990n) throw Object.assign(new Error("ERR_MOVED"), { why: "min return" });
  return { data: b.data as Hex, value };
}

export async function evmSwap(n: Network, phrase: string, index: number, tokenIn: string, tokenOut: string, amountIn: bigint, shownOut: bigint, reviewed?: GasFees): Promise<Hash> {
  const me = evmAddress(phrase, index);
  const fee = evmFeeOn(me);
  const receiver = feeReceiverFor(n.id, tokenIn);
  const route = await kyber(n, "routes?" + routeQuery(tokenIn, tokenOut, amountIn, fee, receiver));
  const rs = route.routeSummary;
  const unsafe = () => { throw new Error("ERR_UNSAFE"); };
  if ((route.routerAddress || "").toLowerCase() !== KYBER_ROUTER) unsafe();
  if (rs.tokenIn.toLowerCase() !== tokenIn.toLowerCase() || rs.tokenOut.toLowerCase() !== tokenOut.toLowerCase() || rs.amountIn !== amountIn.toString()) unsafe();
  if ((rs.extraFee?.feeReceiver || "").toLowerCase() !== (fee ? receiver.toLowerCase() : "")) unsafe();
  if (BigInt(rs.amountOut) * 10000n < shownOut * BigInt(10000 - SLIPPAGE_BPS)) throw new Error("ERR_MOVED");
  const b = await kyber(n, "route/build", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ routeSummary: rs, sender: me, recipient: me, slippageTolerance: SLIPPAGE_BPS, deadline: Math.floor(Date.now() / 1000) + 1200, source: CLIENT_ID }),
  });
  const { data, value } = checkKyberBuild(b, { tokenIn, tokenOut, amountIn, me, shownOut, fee, receiver });

  const shownMin = (shownOut * BigInt(10000 - SLIPPAGE_BPS)) / 10000n;
  await guardEvm(n, [{ from: me as Address, to: KYBER_ROUTER as Address, data, value }], { token: simKey(tokenOut), min: (shownMin * 9990n) / 10000n });
  const fees = await sendFees(n, reviewed);
  const hash = await wallet(n, phrase, index).sendTransaction({ to: KYBER_ROUTER as Address, data, value, ...feeFields(fees) } as never);
  await waitOk(n, hash);
  return hash;
}

const feeAccountOf = (outMint: string): string | null => { try { return SOL_FEE_ACCOUNTS[outMint] ?? ataOf(SOL_FEE_OWNER, outMint); } catch { return null; } };
const solFeeAccount = (outMint: string, owner: string) => (solFeeOn(owner) && feeAccountOf(outMint)) || null;

const feeLive = new Map<string, { ok: boolean; at: number }>();
export async function liveFeeAccount(outMint: string, owner: string): Promise<string | null> {
  const acct = solFeeAccount(outMint, owner);
  if (!acct) return null;
  const c = feeLive.get(acct);
  if (c && Date.now() - c.at < 120_000) return c.ok ? acct : null;
  let ok = false;
  try {

    const r = await solRpc<{ value: { data?: { parsed?: { info?: { mint?: string; owner?: string } } } } | null } | null>("getAccountInfo", [acct, { encoding: "jsonParsed", commitment: "confirmed" }]);
    const info = r?.value?.data?.parsed?.info;
    ok = !!info && info.mint === outMint && info.owner === SOL_FEE_OWNER;
  } catch { ok = false; }
  feeLive.set(acct, { ok, at: Date.now() });
  return ok ? acct : null;
}
export const clearFeeCache = () => feeLive.clear();

export async function solFeeFor(inMint: string, outMint: string, owner: string): Promise<{ acct: string; onOutput: boolean } | null> {
  const out = await liveFeeAccount(outMint, owner);
  if (out) return { acct: out, onOutput: true };
  const inp = await liveFeeAccount(inMint, owner);
  return inp ? { acct: inp, onOutput: false } : null;
}

export async function solQuote(inMint: string, outMint: string, amountIn: bigint, owner: string, opts: { noFee?: boolean } = {}): Promise<SwapQuote> {

  if (owner === SOL_FEE_OWNER && (inMint === SOL_MINT || outMint === SOL_MINT)) throw new Error("ERR_FEE_SOL");
  const p = new URLSearchParams({ inputMint: inMint, outputMint: outMint, amount: amountIn.toString(), slippageBps: String(SLIPPAGE_BPS) });
  const feeAt = opts.noFee ? null : await solFeeFor(inMint, outMint, owner);
  if (feeAt) p.set("platformFeeBps", String(feeBps()));
  const q = await jupJson(`/swap/v1/quote?${p}`);
  if (q.error || !q.outAmount) throw Object.assign(new Error(q.error || "no route"), { api: true });

  const fee = !feeAt || !q.platformFee || BigInt(q.platformFee.amount || "0") <= 0n ? null
    : feeAt.onOutput ? { amount: BigInt(q.platformFee.amount), onOutput: true } : { amount: (amountIn * BigInt(feeBps())) / 10000n, onOutput: false };
  return { amountIn, amountOut: BigInt(q.outAmount), minOut: BigInt(q.otherAmountThreshold ?? q.outAmount), fee, raw: q };
}

const ALLOWED_PROGRAMS = new Set([
  "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4", "ComputeBudget111111111111111111111111111111", "11111111111111111111111111111111",
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
]);

export function parseSolTx(raw: Uint8Array) {
  let o = 0;
  const cu16 = () => { let v = 0, s = 0; for (;;) { const b = raw[o++]; v |= (b & 0x7f) << s; if (!(b & 0x80)) return v; s += 7; } };
  const nSig = cu16(); const sigStart = o; o += 64 * nSig;
  const msgStart = o;
  if (raw[o] & 0x80) o++;
  const header = { sigs: raw[o], roSigned: raw[o + 1], roUnsigned: raw[o + 2] }; o += 3;
  const nKeys = cu16(), keys: string[] = [];
  for (let i = 0; i < nKeys; i++) { keys.push(base58.encode(raw.slice(o, o + 32))); o += 32; }
  o += 32;
  const nIx = cu16(), programs: (string | null)[] = [];
  for (let i = 0; i < nIx; i++) { const p = raw[o++]; programs.push(p < keys.length ? keys[p] : null); const na = cu16(); o += na; const nd = cu16(); o += nd; }
  return { nSig, sigStart, msgStart, header, keys, programs };
}
const JUPITER = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";

export const SOL_FEE_OWNER = "BxMsjB6DM2cZV2vhzPQBETJnBh257ewnvkT61CoZpEMt";

export const MAX_SOL_PRIORITY_LAMPORTS = 10_000_000n;
const MAX_CU_LIMIT = 1_400_000;

export function checkSolTx(raw: Uint8Array, user: string, feeAccount: string | null, exp: SolSwapExpect, maxSlippage = SLIPPAGE_BPS): boolean {
  let t: ReturnType<typeof parseSolTransaction>;
  try { t = parseSolTransaction(raw); } catch { return false; }
  if (t.sigCount !== 1 || t.header.required !== 1 || t.staticKeys[0] !== user) return false;
  const keys = accountKeys(t);
  const prog = (ix: RawIx) => keys[ix.programIndex];
  if (t.instructions.some((ix) => !ALLOWED_PROGRAMS.has(prog(ix) ?? ""))) return false;
  if (t.instructions.filter((ix) => prog(ix) === JUPITER).length !== 1) return false;
  if (feeAccount && !t.staticKeys.includes(feeAccount)) return false;
  const isUser = (i: number | undefined) => i === 0;
  const keyAt = (ix: RawIx, i: number) => (ix.accounts[i] != null ? keys[ix.accounts[i]] ?? null : null);
  const le = (d: Uint8Array, at: number, n: number) => { let v = 0n; for (let i = n - 1; i >= 0; i--) v = (v << 8n) | BigInt(d[at + i]); return v; };
  const wsolAta = ataOf(user, SOL_MINT);

  const atas = (mint: string) => { const s = new Set<string>(); for (const tp of [TOKEN_PROGRAM, TOKEN_2022_PROGRAM]) { try { s.add(ataOf(user, mint, tp)); } catch {  } } return s; };
  const srcAtas = atas(exp.inMint), dstAtas = atas(exp.outMint);

  const feeBpsNow = feeBps();
  let limit: number | null = null, price: bigint | null = null, others = 0;
  for (const ix of t.instructions) {
    const p = prog(ix), d = ix.data;
    if (p === JUPITER) {
      others++;
      if (d.length < 8 + 19) return false;
      const lay = JUP_LAYOUT[hexOf(d.slice(0, 8))];
      if (!lay || ix.accounts.length < lay.min) return false;
      const n = d.length;
      const inAmount = le(d, n - 19, 8), quotedOut = le(d, n - 11, 8), slippage = Number(le(d, n - 3, 2)), feeBps = d[n - 1];
      if (inAmount !== exp.amountIn) return false;
      if (slippage > maxSlippage) return false;
      if (((quotedOut * BigInt(10000 - slippage)) / 10000n) * 10000n < exp.shownMin * 9990n) return false;
      if (feeBps !== (feeAccount ? feeBpsNow : 0)) return false;
      if (!isUser(ix.accounts[lay.authority])) return false;
      if (!srcAtas.has(keyAt(ix, lay.source) ?? "")) return false;
      if (lay.dests.some((i) => !dstAtas.has(keyAt(ix, i) ?? ""))) return false;
      if (lay.optionalDests.some((i) => keyAt(ix, i) !== JUPITER && !dstAtas.has(keyAt(ix, i) ?? ""))) return false;

      const mintOk = (i: number | undefined, m: string) => i == null || keyAt(ix, i) == null || keyAt(ix, i) === m;
      if (!mintOk(lay.inMint, exp.inMint) || !mintOk(lay.outMint, exp.outMint)) return false;
      if (keyAt(ix, lay.feeAccount) !== (feeAccount ?? JUPITER)) return false;
      continue;
    }
    if (p === COMPUTE_BUDGET_PROGRAM) {
      if (d[0] === 2 && d.length === 5 && limit == null) { limit = Number(le(d, 1, 4)); if (limit > MAX_CU_LIMIT) return false; continue; }
      if (d[0] === 3 && d.length === 9 && price == null) { price = le(d, 1, 8); continue; }
      return false;
    }
    others++;
    if (p === SYSTEM_PROGRAM) {

      if (d.length === 12 && Number(le(d, 0, 4)) === 2 && ix.accounts.length === 2 && isUser(ix.accounts[0]) && keyAt(ix, 1) === wsolAta) continue;
      return false;
    }
    if (p === TOKEN_PROGRAM || p === TOKEN_2022_PROGRAM) {
      if (d.length < 1) return false;
      if (d[0] === 17 && d.length === 1) continue;
      if (d[0] === 1 && d.length === 1 && ix.accounts.length >= 3 && isUser(ix.accounts[2])) continue;
      if ((d[0] === 16 || d[0] === 18) && d.length === 33 && base58.encode(d.slice(1)) === user) continue;
      if (d[0] === 9 && d.length === 1 && ix.accounts.length === 3 && isUser(ix.accounts[1]) && isUser(ix.accounts[2])) continue;
      return false;
    }
    if (p === ATA_PROGRAM) {
      if (!(d.length === 0 || (d.length === 1 && (d[0] === 0 || d[0] === 1))) || ix.accounts.length < 6 || !isUser(ix.accounts[0])) return false;
      if (isUser(ix.accounts[2]) || keyAt(ix, 2) === SOL_FEE_OWNER) continue;
      return false;
    }
    return false;
  }

  const units = BigInt(limit ?? Math.min(MAX_CU_LIMIT, 200_000 * Math.max(1, others)));
  if (price != null && (price * units + 999_999n) / 1_000_000n > MAX_SOL_PRIORITY_LAMPORTS) return false;
  return true;
}

export const solFeeAccountFor = (outMint: string): string | null => feeAccountOf(outMint);

export function jupRoute(raw: Uint8Array): { source: string | null; dest: string | null; inMint: string | null; outMint: string | null; feeAccount: string | null; inAmount: bigint; quotedOut: bigint; slippage: number; feeBps: number } | null {
  let t: ReturnType<typeof parseSolTransaction>;
  try { t = parseSolTransaction(raw); } catch { return null; }
  const keys = accountKeys(t);
  const jup = t.instructions.filter((ix) => keys[ix.programIndex] === JUPITER);
  if (jup.length !== 1) return null;
  const ix = jup[0], d = ix.data, lay = JUP_LAYOUT[hexOf(d.slice(0, 8))];
  if (!lay || d.length < 8 + 19 || ix.accounts.length < lay.min) return null;
  const at = (i: number | undefined) => (i == null || ix.accounts[i] == null ? null : keys[ix.accounts[i]] ?? null);
  const le = (o: number, n: number) => { let v = 0n; for (let i = n - 1; i >= 0; i--) v = (v << 8n) | BigInt(d[o + i]); return v; };
  const n = d.length, fee = at(lay.feeAccount);
  return { source: at(lay.source), dest: at(lay.dests[0]), inMint: at(lay.inMint), outMint: at(lay.outMint), feeAccount: fee === JUPITER ? null : fee,
    inAmount: le(n - 19, 8), quotedOut: le(n - 11, 8), slippage: Number(le(n - 3, 2)), feeBps: d[n - 1] };
}
const hexOf = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

const PDA_MARKER = new TextEncoder().encode("ProgramDerivedAddress");
const onCurve = (b: Uint8Array) => { try { ed25519.Point.fromBytes(b); return true; } catch { return false; } };
export function findPda(seeds: Uint8Array[], program: string): string {
  const prog = base58.decode(program);
  for (let bump = 255; bump >= 0; bump--) {
    const parts = [...seeds, Uint8Array.of(bump), prog, PDA_MARKER];
    const buf = new Uint8Array(parts.reduce((n, x) => n + x.length, 0));
    let o = 0;
    for (const x of parts) { buf.set(x, o); o += x.length; }
    const h = sha256(buf);
    if (!onCurve(h)) return base58.encode(h);
  }
  throw new Error("no PDA");
}

export const ataOf = (owner: string, mint: string, tokenProgram = TOKEN_PROGRAM) => findPda([base58.decode(owner), base58.decode(tokenProgram), base58.decode(mint)], ATA_PROGRAM);

export interface SolSwapExpect { inMint: string; outMint: string; amountIn: bigint; shownMin: bigint }
const ROUTE = "e517cb977ae3ad2a", SHARED_ROUTE = "c1209b3341d69c81";

const JUP_LAYOUT: Record<string, { authority: number; source: number; dests: number[]; optionalDests: number[]; inMint?: number; outMint: number; feeAccount: number; min: number }> = {

  [ROUTE]: { authority: 1, source: 2, dests: [3], optionalDests: [4], outMint: 5, feeAccount: 6, min: 9 },

  [SHARED_ROUTE]: { authority: 2, source: 3, dests: [6], optionalDests: [], inMint: 7, outMint: 8, feeAccount: 9, min: 13 },
};

export async function solSwap(phrase: string, index: number, inMint: string, outMint: string, amountIn: bigint, shownOut: bigint, shownMin?: bigint, opts: { noFee?: boolean } = {}): Promise<string> {
  const me = solAddress(phrase, index);
  const q = (await solQuote(inMint, outMint, amountIn, me, opts)).raw as any;
  if (q.inputMint !== inMint || q.outputMint !== outMint || q.inAmount !== amountIn.toString()) throw new Error("ERR_UNSAFE");
  if (BigInt(q.outAmount) * 10000n < shownOut * BigInt(10000 - SLIPPAGE_BPS)) throw new Error("ERR_MOVED");
  const min = shownMin ?? (shownOut * BigInt(10000 - SLIPPAGE_BPS)) / 10000n;
  if (BigInt(q.otherAmountThreshold ?? q.outAmount) * 10000n < min * 9990n) throw new Error("ERR_MOVED");
  const fee = opts.noFee ? null : (await solFeeFor(inMint, outMint, me))?.acct ?? null;
  const body: Record<string, unknown> = { quoteResponse: q, userPublicKey: me, wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true, prioritizationFeeLamports: "auto" };
  if (fee) body.feeAccount = fee;
  const j = await jupJson(`/swap/v1/swap`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!j.swapTransaction) throw Object.assign(new Error("api"), { api: true });
  const raw = Uint8Array.from(atob(j.swapTransaction), (c) => c.charCodeAt(0));
  if (!checkSolTx(raw, me, fee, { inMint, outMint, amountIn, shownMin: min })) throw new Error("ERR_UNSAFE");
  const t = parseSolTx(raw);
  const sig = ed25519.sign(raw.slice(t.msgStart), solSecret(phrase, index));
  raw.set(sig, t.sigStart);
  const wire = btoa(String.fromCharCode(...raw));
  await solRpc<string>("sendTransaction", [wire, { encoding: "base64", preflightCommitment: "confirmed", maxRetries: 3 }]);
  return base58.encode(sig);
}

export async function waitSol(sig: string, opts: { maxMs?: number; everyMs?: number; rpc?: typeof solRpc; now?: () => number; sleep?: (ms: number) => Promise<void> } = {}): Promise<void> {
  const rpc = opts.rpc ?? solRpc, now = opts.now ?? Date.now, sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const start = now(), maxMs = opts.maxMs ?? 120_000, every = opts.everyMs ?? 2_000;
  let seen = false, answered = false;
  for (;;) {
    const st = await rpc<{ value: ({ err: unknown; confirmationStatus?: string } | null)[] }>("getSignatureStatuses", [[sig], { searchTransactionHistory: true }]).catch(() => null);
    if (Array.isArray(st?.value)) answered = true;
    const v = st?.value?.[0];
    if (v) {
      seen = true;
      if (v.err) throw Object.assign(new Error("ERR_CHAIN"), { hash: sig });
      if (v.confirmationStatus === "confirmed" || v.confirmationStatus === "finalized") return;
    }
    if (now() - start >= maxMs) throw Object.assign(new Error(seen || !answered ? "ERR_PENDING" : "ERR_DROPPED"), { hash: sig });
    await sleep(every);
  }
}
