import { notImported } from "./imported";
import { HDKey } from "@scure/bip32";
import { mnemonicToSeedSync } from "@scure/bip39";
import { base58check } from "@scure/base";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { memoAddress, normalizePhrase } from "./account";
import { DEMO_TRON_USDT, DEMO_TRX_SUN, demoOn } from "./demo";
import type { Token } from "./chains";

export const TRON_USDT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

export const TRX_TOKEN = "trx";

export function tronUserAddrOk(a: unknown): a is string {
  if (typeof a !== "string" || !a || a !== a.trim() || a === TRON_USDT) return false;
  let h: string;
  try { h = tronToHex(a); } catch { return false; }
  return !/^410{40}$/.test(h);
}
const tv =(symbol: string, name: string, address: string, decimals: number, coingecko: string): Token =>
  ({ symbol, name, address: address as `0x${string}`, decimals, coingecko, verified: true });
export const TRON = {
  id: "tron", name: "Tron", symbol: "TRX", coingecko: "tron", explorer: "https://tronscan.org", decimals: 6, cgPlatform: "tron",
  tokens: [tv("USDT", "Tether USD", TRON_USDT, 6, "tether")],
  defaultTokens: ["USDT"],
} as const;
export const tronTxUrl = (txid: string) => `${TRON.explorer}/#/transaction/${txid}`;
export const TRON_APIS = ["https://api.trongrid.io", "https://tron-rpc.publicnode.com"];

const b58 = base58check(sha256);
const hex = (b: Uint8Array) => bytesToHex(b);

export function tronKeys(phrase: string, index = 0): { privateKey: Uint8Array; publicKey: Uint8Array } {
  notImported(index);
  const key = HDKey.fromMasterSeed(mnemonicToSeedSync(normalizePhrase(phrase))).derive(`m/44'/195'/0'/0/${index}`);
  if (!key.privateKey || !key.publicKey) throw new Error("derivation failed");
  return { privateKey: key.privateKey, publicKey: key.publicKey };
}

export function tronHexFromPublicKey(pub: Uint8Array): string {
  const full = secp256k1.Point.fromBytes(pub).toBytes(false);
  return "41" + hex(keccak_256(full.slice(1)).slice(-20));
}

export function hexToTron(h41: string): string {
  const s = String(h41).replace(/^0x/, "").toLowerCase();
  if (!/^41[0-9a-f]{40}$/.test(s)) throw new Error("ERR_ADDRESS");
  return b58.encode(Uint8Array.from(s.match(/../g)!, (x) => parseInt(x, 16)));
}

export function tronToHex(addr: string): string {
  const v = String(addr ?? "");
  if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(v)) throw new Error("ERR_ADDRESS");
  let raw: Uint8Array;
  try { raw = b58.decode(v); } catch { throw new Error("ERR_ADDRESS"); }
  if (raw.length !== 21 || raw[0] !== 0x41) throw new Error("ERR_ADDRESS");
  return hex(raw);
}

export const isTronAddress = (a: string) => { try { tronToHex(String(a ?? "").trim()); return true; } catch { return false; } };

export const tronWord = (addr: string) => tronToHex(addr).slice(2).padStart(64, "0");
export const uintWord = (v: bigint) => { if (v < 0n || v >= 2n ** 256n) throw new Error("ERR_AMOUNT"); return v.toString(16).padStart(64, "0"); };

export const tronAddress = (phrase: string, index = 0): string => memoAddress("tron", phrase, index, () => hexToTron(tronHexFromPublicKey(tronKeys(phrase, index).publicKey)));

type Gate = { until: number; backoff: number };
const gates = new Map<string, Gate>();
const lanes = new Map<string, Promise<unknown>>();
const GAP_MS: Record<string, number> = { "https://api.trongrid.io": 360 };
const MAX_BACKOFF = 60_000;

export function tronBackoff(prev: number, body: string): number {
  const m = /suspended for (\d{1,3}) s/i.exec(body);
  const named = m ? (Number(m[1]) + 1) * 1000 : 5_000;
  return Math.min(MAX_BACKOFF, Math.max(named, prev > 0 ? prev * 2 : 0));
}
export class TronLimited extends Error { constructor() { super("ERR_BUSY"); } }

let gapOverride: number | null = null;
function inLane<T>(host: string, run: () => Promise<T>): Promise<T> {
  const gap = gapOverride ?? GAP_MS[host] ?? 120;
  const prev = lanes.get(host) ?? Promise.resolve();
  const p = prev.then(run, run);
  lanes.set(host, p.then(() => new Promise((r) => setTimeout(r, gap)), () => new Promise((r) => setTimeout(r, gap))));
  return p;
}

export async function tronPost<T = any>(path: string, body: unknown, o: { timeoutMs?: number; hosts?: string[] } = {}): Promise<T> {
  if (!/^\/wallet\/[a-z]+$/.test(path)) throw new Error("bad Tron path");
  return tronCall<T>(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, o);
}

export async function tronGet<T = any>(path: string, timeoutMs = 12_000): Promise<T> {
  if (!/^\/v1\/[A-Za-z0-9/_?=&.-]+$/.test(path)) throw new Error("bad Tron path");
  return tronCall<T>(path, { method: "GET" }, { timeoutMs, hosts: [TRON_APIS[0]] });
}
async function tronCall<T>(path: string, init: RequestInit, o: { timeoutMs?: number; hosts?: string[] }): Promise<T> {
  const hosts = o.hosts ?? TRON_APIS, timeout = o.timeoutMs ?? 8_000;
  let last: unknown = null;
  for (const host of hosts) {
    const g = gates.get(host);
    if (g && g.until > Date.now()) { last = new TronLimited(); continue; }
    try {
      return await inLane(host, async () => {
        const r = await fetch(host + path, { ...init, cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer", signal: timeout ? AbortSignal.timeout(timeout) : undefined });
        if (r.status === 429) {
          const prevG = gates.get(host)?.backoff ?? 0, b = tronBackoff(prevG, await r.text().catch(() => ""));
          gates.set(host, { until: Date.now() + b, backoff: b });
          throw new TronLimited();
        }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json();
        if (gates.get(host)?.backoff) gates.delete(host);
        return j as T;
      });
    } catch (e) { last = e; }
  }
  throw last instanceof Error ? last : new Error("network");
}

export function _resetTronGates(gapMs: number | null = null) { gates.clear(); lanes.clear(); gapOverride = gapMs; }

export async function tronConstant(owner: string, contract: string, selector: string, parameter: string): Promise<string[]> {
  const j = await tronPost<{ result?: { result?: boolean; message?: string }; constant_result?: string[]; transaction?: { ret?: { ret?: string }[] } }>("/wallet/triggerconstantcontract",
    { owner_address: owner, contract_address: contract, function_selector: selector, parameter, visible: true });
  if (!j?.result?.result || j.result.message || j.transaction?.ret?.[0]?.ret === "FAILED" || !Array.isArray(j.constant_result)) throw new Error("ERR_TRON_CALL");
  return j.constant_result;
}

export async function trc20Balance(owner: string, token: string): Promise<bigint> {
  const [w] = await tronConstant(owner, token, "balanceOf(address)", tronWord(owner));
  if (!/^[0-9a-fA-F]{64}$/.test(w ?? "")) throw new Error("ERR_TRON_CALL");
  return BigInt("0x" + w);
}
export interface TronAccount { sun: bigint; active: boolean }

export async function tronAccount(address: string): Promise<TronAccount> {
  const a = await tronPost<{ address?: string; balance?: number; create_time?: number }>("/wallet/getaccount", { address, visible: true });
  return { sun: BigInt(a?.balance ?? 0), active: !!(a?.address || a?.create_time) };
}
export interface TronBalances { sun: bigint; usdt: bigint; active: boolean }
export async function tronBalances(address: string): Promise<TronBalances> {
  if (import.meta.env.DEV && demoOn()) return { sun: DEMO_TRX_SUN, usdt: DEMO_TRON_USDT, active: true };
  if (!isTronAddress(address)) throw new Error("ERR_ADDRESS");
  const [a, usdt] = await Promise.all([tronAccount(address), trc20Balance(address, TRON_USDT)]);
  return { ...a, usdt };
}
