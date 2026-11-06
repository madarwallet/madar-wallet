import { notImported } from "./imported";
import { ed25519 } from "@noble/curves/ed25519.js";
import { DEMO_SOL_LAMPORTS, demoOn, demoSolToken } from "./demo";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256, sha512 } from "@noble/hashes/sha2.js";
import { mnemonicToSeedSync } from "@scure/bip39";
import { base58 } from "@scure/base";
import { memoAddress, normalizePhrase } from "./account";
import type { Token } from "./chains";

const sv = (symbol: string, name: string, mint: string, decimals: number, coingecko: string): Token =>
  ({ symbol, name, address: mint as `0x${string}`, decimals, coingecko, verified: true });

export const SOL = {
  id: "solana", name: "Solana", symbol: "SOL", coingecko: "solana", explorer: "https://solscan.io", decimals: 9, cgPlatform: "solana",

  rpcs: ["https://solana-rpc.publicnode.com", "https://swap.madarwallet.app/solrpc"],
  tokens: [
    sv("USDC", "USD Coin", "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", 6, "usd-coin"),
    sv("USDT", "Tether USD", "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", 6, "tether"),
    sv("cbBTC", "Coinbase Wrapped BTC", "cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij", 8, "coinbase-wrapped-btc"),
    sv("WBTC", "Wrapped BTC (Portal)", "3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh", 8, "wrapped-bitcoin"),
    sv("WETH", "Wrapped Ether (Portal)", "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs", 8, "weth"),
    sv("JUP", "Jupiter", "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN", 6, "jupiter-exchange-solana"),
    sv("RAY", "Raydium", "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R", 6, "raydium"),
    sv("PYTH", "Pyth Network", "HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3", 6, "pyth-network"),
    sv("JTO", "Jito", "jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL", 9, "jito-governance-token"),
    sv("TRUMP", "OFFICIAL TRUMP", "6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN", 6, "official-trump"),
    sv("PENGU", "Pudgy Penguins", "2zMMhcVQEXDtdE6vsFS7S7D5oUodfJHE8vd1gnBouauv", 6, "pudgy-penguins"),
    sv("GRASS", "Grass", "Grass7B4RdKfBCjTKgSqnXkqjwiGvQyFbuSCUJr3XXjs", 9, "grass"),
    sv("USELESS", "USELESS COIN", "Dz9mQ9NzkBcCsuGPFJ3r1bS4wgqKMHBPiVuniW8Mbonk", 6, ""),
    sv("RENDER", "Render Token", "rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof", 8, "render-token"),
    sv("PUMP", "Pump.fun", "pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn", 6, "pump-fun"),
    sv("FARTCOIN", "Fartcoin", "9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump", 6, "fartcoin"),

    sv("BONK", "Bonk", "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", 5, "bonk"),
  ],
  defaultTokens: ["USDC", "USDT"],
} as const;

export const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const SIGNATURE_FEE = 5000n;
export const ATA_RENT = 2039280n;
export const MIN_ACCOUNT = 890880n;

function slip10(seed: Uint8Array, path: number[]): Uint8Array {
  let I = hmac(sha512, new TextEncoder().encode("ed25519 seed"), seed);
  let k = I.slice(0, 32), c = I.slice(32);
  for (const idx of path) {
    const data = new Uint8Array(37);
    data.set(k, 1);
    new DataView(data.buffer).setUint32(33, (idx | 0x80000000) >>> 0);
    I = hmac(sha512, c, data);
    k = I.slice(0, 32); c = I.slice(32);
  }
  return k;
}
const secretFor = (phrase: string, index: number) => { notImported(index); return slip10(mnemonicToSeedSync(normalizePhrase(phrase)), [44, 501, index, 0]); };
export const solAddress = (phrase: string, index = 0): string => memoAddress("sol", phrase, index, () => base58.encode(ed25519.getPublicKey(secretFor(phrase, index))));

export const isSolAddress = (a: string) => { const v = a.trim(); if (v.length < 32 || v.length > 44) return false; try { return base58.decode(v).length === 32; } catch { return false; } };

export const MULTI_MAX = 10;

export const SOL_HISTORY_RPC = "https://swap.madarwallet.app/solhist";
const NULL_RETRY = new Set(["getTransaction", "getSignatureStatuses"]);
export const solHosts = (method: string): readonly string[] =>
  method === "getSignaturesForAddress" ? [SOL_HISTORY_RPC, ...SOL.rpcs]
    : NULL_RETRY.has(method) ? [SOL.rpcs[0], SOL_HISTORY_RPC, ...SOL.rpcs.slice(1)]
    : method === "sendTransaction" ? SOL.rpcs
    : [...SOL.rpcs, SOL_HISTORY_RPC];

const emptyAnswer = (method: string, result: unknown) =>
  NULL_RETRY.has(method) && (result == null || (method === "getSignatureStatuses" && Array.isArray((result as { value?: unknown[] }).value) && (result as { value: unknown[] }).value.every((v) => v == null)));
export async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const list = params[0];
  if (method === "getMultipleAccounts" && Array.isArray(list) && list.length > MULTI_MAX) {
    const parts: unknown[][] = [];
    for (let i = 0; i < list.length; i += MULTI_MAX) parts.push(list.slice(i, i + MULTI_MAX));
    const answers = await Promise.all(parts.map((part) => rpc<{ context?: unknown; value: unknown[] }>(method, [part, ...params.slice(1)])));
    return { context: answers[0]?.context, value: answers.flatMap((x) => x.value) } as T;
  }
  let last: unknown;
  let empty: { result: unknown } | null = null;
  for (const url of solHosts(method)) {
    try {

      const wait = url === SOL_HISTORY_RPC && method === "getSignaturesForAddress" ? 20_000 : 8_000;
      const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: method === "sendTransaction" ? undefined : AbortSignal.timeout(wait) });
      if (!r.ok) { last = new Error(`HTTP ${r.status}`); continue; }
      const j = await r.json();
      if (j.error) { last = new Error(j.error.message ?? "rpc error"); if (method === "sendTransaction") throw last; continue; }
      if (emptyAnswer(method, j.result)) { empty ??= { result: j.result }; continue; }
      return j.result as T;
    } catch (e) { last = e; if (method === "sendTransaction" && e instanceof Error && !/fetch|HTTP/.test(e.message)) throw e; }
  }
  if (empty) return empty.result as T;
  throw last instanceof Error ? last : new Error("network");
}

export const solRent = { ata: ATA_RENT, min: MIN_ACCOUNT };
const rentAsked = new Map<number, Promise<bigint>>();
function rentFor(bytes: number, fallback: bigint): Promise<bigint> {
  if (import.meta.env.DEV && demoOn()) return Promise.resolve(fallback);
  let p = rentAsked.get(bytes);
  if (!p) {
    p = rpc<number>("getMinimumBalanceForRentExemption", [bytes, { commitment: "confirmed" }])
      .then((v) => (Number.isSafeInteger(v) && v > 0 && BigInt(v) <= fallback * 2n ? BigInt(v) : fallback))
      .catch(() => { rentAsked.delete(bytes); return fallback; });
    rentAsked.set(bytes, p);
  }
  return p;
}

export async function ataRent(): Promise<bigint> { return (solRent.ata = await rentFor(165, ATA_RENT)); }

export async function minAccount(): Promise<bigint> { return (solRent.min = await rentFor(0, MIN_ACCOUNT)); }

export async function solBalances(owner: string, mints: string[] = []): Promise<{ lamports: bigint; tokens: Map<string, bigint> }> {
  if (import.meta.env.DEV && demoOn()) return { lamports: DEMO_SOL_LAMPORTS, tokens: new Map(mints.map((m) => [m, demoSolToken(m)])) };
  type Acc = { data: { parsed?: { info?: { tokenAmount?: { amount: string } } } } } | null;
  const atas = mints.map((m) => ataAddress(owner, m));
  const [bal, accs] = await Promise.all([
    rpc<{ value: number }>("getBalance", [owner, { commitment: "confirmed" }]),
    atas.length ? rpc<{ value: Acc[] }>("getMultipleAccounts", [atas, { encoding: "jsonParsed", commitment: "confirmed" }]) : Promise.resolve({ value: [] as Acc[] }),
  ]);
  const tokens = new Map<string, bigint>();
  mints.forEach((m, i) => tokens.set(m, BigInt(accs.value[i]?.data.parsed?.info?.tokenAmount?.amount ?? "0")));
  return { lamports: BigInt(bal.value), tokens };
}

type AccountInfo = { owner: string; lamports: number; executable?: boolean; data: { parsed?: { type?: string; info?: { decimals?: number } } } } | null;
export const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

export const isOnCurve = (a: string) => { try { ed25519.Point.fromBytes(base58.decode(a)); return true; } catch { return false; } };

export function destProblem(info: { owner: string; executable?: boolean } | null): "ERR_TOKEN_ACCOUNT" | "ERR_PROGRAM" | null {
  if (!info) return null;
  if (info.owner === TOKEN_PROGRAM || info.owner === TOKEN_2022_PROGRAM) return "ERR_TOKEN_ACCOUNT";
  if (info.executable) return "ERR_PROGRAM";
  return null;
}
export const accountInfo = async (a: string) => (await rpc<{ value: AccountInfo }>("getAccountInfo", [a, { encoding: "jsonParsed", commitment: "confirmed" }])).value;

export async function readSolMint(mint: string): Promise<{ address: string; symbol: string; name: string; decimals: number }> {
  if (!isSolAddress(mint)) throw new Error("bad address");
  const info = await accountInfo(mint.trim());
  if (!info || info.owner !== TOKEN_PROGRAM || info.data.parsed?.type !== "mint") throw new Error("not a mint");
  const decimals = info.data.parsed.info?.decimals ?? 0;
  let symbol = "", name = "";
  try {
    const r = await fetch(`https://lite-api.jup.ag/tokens/v2/search?query=${mint.trim()}`, { cache: "no-store" });
    const hit = r.ok ? ((await r.json()) as { id: string; symbol: string; name: string }[]).find((x) => x.id === mint.trim()) : undefined;
    if (hit) { symbol = hit.symbol; name = hit.name; }
  } catch {  }
  const clean = cleanTokenText;
  return { address: mint.trim(), symbol: clean(symbol, 12) || mint.trim().slice(0, 4).toUpperCase(), name: clean(name, 40), decimals };
}

export const cleanTokenText = (s: string, max: number) =>
  String(s).replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g, "").trim().slice(0, max);
export function parseUnitsStr(s: string, decimals: number): bigint {
  const v = s.trim();
  const re = new RegExp(`^\\d+(\\.\\d{1,${decimals}})?$`);
  if (decimals === 0 ? !/^\d+$/.test(v) : !re.test(v)) throw new Error("ERR_AMOUNT");
  const [i, f = ""] = v.split(".");
  return BigInt(i) * 10n ** BigInt(decimals) + BigInt((f + "0".repeat(decimals)).slice(0, decimals) || "0");
}
export const formatUnitsStr = (raw: bigint, decimals: number) => {
  const d = 10n ** BigInt(decimals), f = (raw % d).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${raw / d}${f ? "." + f : ""}`;
};

export const solSecret = (phrase: string, index = 0) => secretFor(phrase, index);
export const solRpc = <T,>(method: string, params: unknown[]) => rpc<T>(method, params);
export const WSOL_MINT = "So11111111111111111111111111111111111111112";

const ATA_PROGRAM_ID = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const PDA_MARKER = new TextEncoder().encode("ProgramDerivedAddress");
const onCurveBytes = (b: Uint8Array) => { try { ed25519.Point.fromBytes(b); return true; } catch { return false; } };

export function programAddress(seeds: Uint8Array[], program: string): string {
  const pid = base58.decode(program);
  for (let bump = 255; bump >= 0; bump--) {
    const parts = [...seeds, Uint8Array.of(bump), pid, PDA_MARKER];
    const buf = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0; for (const p of parts) { buf.set(p, o); o += p.length; }
    const h = sha256(buf);
    if (!onCurveBytes(h)) return base58.encode(h);
  }
  throw new Error("no program address");
}

export const ataAddress = (owner: string, mint: string, tokenProgram: string = TOKEN_PROGRAM) =>
  programAddress([base58.decode(owner), base58.decode(tokenProgram), base58.decode(mint)], ATA_PROGRAM_ID);
