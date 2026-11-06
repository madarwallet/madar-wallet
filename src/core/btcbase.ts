import { notImported } from "./imported";
import { HDKey } from "@scure/bip32";
import { mnemonicToSeedSync } from "@scure/bip39";
import { base58check, bech32, bech32m } from "@scure/base";
import { ripemd160 } from "@noble/hashes/legacy.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { DEMO_BTC_SATS, demoOn } from "./demo";
import { memoAddress, normalizePhrase } from "./account";

export const BTC = { id: "bitcoin", name: "Bitcoin", symbol: "BTC", coingecko: "bitcoin", explorer: "https://mempool.space", decimals: 8 } as const;
const APIS = ["https://mempool.space/api", "https://blockstream.info/api"];
export const DUST_SATS = 546n;

export const MAX_FEE_RATE = 500;

export const RBF_SEQUENCE = 0xfffffffd;
export const clampFeeRate = (r: number) => Math.min(MAX_FEE_RATE, Math.max(1, Math.round(Number.isFinite(r) ? r : 1)));

export const btcAddress = (phrase: string, index = 0): string => memoAddress("btc", phrase, index, () => deriveBtcAddress(phrase, index));
function deriveBtcAddress(phrase: string, index: number): string {
  notImported(index);
  const key = HDKey.fromMasterSeed(mnemonicToSeedSync(normalizePhrase(phrase))).derive(`m/84'/0'/0'/0/${index}`);
  if (!key.publicKey) throw new Error("derivation failed");
  return bech32.encode("bc", [0, ...bech32.toWords(ripemd160(sha256(key.publicKey)))]);
}

const b58 = base58check(sha256);

export function isBtcAddress(a: string): boolean {
  const v = a.trim();
  try {
    if (/^bc1/i.test(v)) {
      if (v !== v.toLowerCase() && v !== v.toUpperCase()) return false;
      const low = v.toLowerCase();
      if (low.startsWith("bc1q")) { const d = bech32.decode(low as `${string}1${string}`); const prog = bech32.fromWords(d.words.slice(1)); return d.prefix === "bc" && d.words[0] === 0 && (prog.length === 20 || prog.length === 32); }
      if (low.startsWith("bc1p")) { const d = bech32m.decode(low as `${string}1${string}`); const prog = bech32m.fromWords(d.words.slice(1)); return d.prefix === "bc" && d.words[0] === 1 && prog.length === 32; }
      return false;
    }
    const raw = b58.decode(v);
    return raw.length === 21 && (raw[0] === 0x00 || raw[0] === 0x05);
  } catch {
    return false;
  }
}

export function parseBtc(s: string): bigint {
  const v = s.trim();
  if (!/^\d+(\.\d{1,8})?$/.test(v)) throw new Error("ERR_AMOUNT");
  const [i, f = ""] = v.split(".");
  return BigInt(i) * 100_000_000n + BigInt((f + "00000000").slice(0, 8));
}
export const formatBtc = (sats: bigint) => {
  const neg = sats < 0n, a = neg ? -sats : sats;
  const f = (a % 100_000_000n).toString().padStart(8, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${a / 100_000_000n}${f ? "." + f : ""}`;
};

export async function api<T>(path: string, init?: RequestInit, as: "json" | "text" = "json"): Promise<T> {
  let last: unknown;
  for (const base of APIS) {
    try {
      const r = await fetch(base + path, { cache: "no-store", signal: init?.method === "POST" ? undefined : AbortSignal.timeout(8_000), ...init });
      if (!r.ok) { last = new Error(`${r.status} ${await r.text().catch(() => "")}`); if (r.status === 400) break; continue; }
      return (as === "json" ? await r.json() : await r.text()) as T;
    } catch (e) { last = e; }
  }
  throw last instanceof Error ? last : new Error("network");
}

export interface BtcBalance { confirmed: bigint; pending: bigint }
export async function btcBalance(address: string): Promise<BtcBalance> {
  if (import.meta.env.DEV && demoOn()) return { confirmed: DEMO_BTC_SATS, pending: 0n };
  type S = { funded_txo_sum: number; spent_txo_sum: number };
  const r = await api<{ chain_stats: S; mempool_stats: S }>(`/address/${address}`);
  const v = (s: S) => BigInt(s.funded_txo_sum) - BigInt(s.spent_txo_sum);
  return { confirmed: v(r.chain_stats), pending: v(r.mempool_stats) };
}

export interface BtcFees { fast: number; normal: number; slow: number }
export async function btcFees(): Promise<BtcFees> {
  try {
    const f = await api<{ fastestFee: number; halfHourFee: number; hourFee: number; economyFee: number }>(`/v1/fees/recommended`);
    return { fast: clampFeeRate(f.fastestFee), normal: clampFeeRate(f.halfHourFee), slow: clampFeeRate(f.hourFee) };
  } catch {
    const e = await api<Record<string, number>>(`/fee-estimates`);
    const r = (k: string) => clampFeeRate(Math.ceil(e[k] ?? 2));
    return { fast: r("1"), normal: r("3"), slow: r("6") };
  }
}

export async function btcWaitInfo(txid: string, nowMs = Date.now()): Promise<{ conf: number; lastBlockMin: number } | null> {
  if (!/^[0-9a-f]{64}$/.test(txid)) return null;
  const [st, blocks] = await Promise.all([api<{ confirmed?: boolean; block_height?: number }>(`/tx/${txid}/status`), api<{ height?: number; timestamp?: number }[]>("/blocks")]);
  const tip = blocks?.[0];
  if (!tip || typeof tip.height !== "number" || typeof tip.timestamp !== "number") return null;
  return btcWaitFrom(st, { height: tip.height, timestamp: tip.timestamp }, nowMs);
}

export function btcWaitFrom(st: { confirmed?: boolean; block_height?: number } | null, tip: { height: number; timestamp: number }, nowMs: number): { conf: number; lastBlockMin: number } {
  const conf = st?.confirmed && typeof st.block_height === "number" ? Math.max(1, tip.height - st.block_height + 1) : 0;
  return { conf, lastBlockMin: Math.max(0, Math.floor((nowMs - tip.timestamp * 1000) / 60_000)) };
}
