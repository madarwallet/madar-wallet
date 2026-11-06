import { ed25519 } from "@noble/curves/ed25519.js";
import { sha3_256 } from "@noble/hashes/sha3.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { mnemonicToSeedSync } from "@scure/bip39";
import { memoAddress, normalizePhrase } from "./account";
import { hostFetch } from "./hostgate";
import { notImported } from "./imported";
import { slip10Ed25519 } from "./nearbase";
import { bigOf, formatUnits, kitErr, parseUnits } from "./sendkit";

export const APT = { id: "aptos", name: "Aptos", symbol: "APT", coingecko: "aptos", decimals: 8, explorer: "https://explorer.aptoslabs.com", family: "aptos" } as const;
export const aptTxUrl = (hash: string) => `${APT.explorer}/txn/${hash}?network=mainnet`;
export const APT_NODES = ["https://api.mainnet.aptoslabs.com/v1", "https://aptos-rest.publicnode.com/v1", "https://fullnode.mainnet.aptoslabs.com/v1"];

export const OCTA_MAX = 10n ** 10n * 10n ** 8n;

export function aptSecret(phrase: string, index = 0): Uint8Array {
  notImported(index);
  if (!Number.isInteger(index) || index < 0 || index > 0x7fffffff) throw new Error("bad index");
  return slip10Ed25519(mnemonicToSeedSync(normalizePhrase(phrase)), [44, 637, index, 0, 0]);
}
export const aptPublicKey = (secret: Uint8Array) => ed25519.getPublicKey(secret);

export function aptAddressOf(pub: Uint8Array): string {
  if (pub.length !== 32) throw new Error("bad key");
  return "0x" + bytesToHex(sha3_256(Uint8Array.from([...pub, 0])));
}
export const aptAddress = (phrase: string, index = 0) => memoAddress("aptos", phrase, index, () => aptAddressOf(aptPublicKey(aptSecret(phrase, index))));

export const isAptAddress = (a: string) => /^0x[0-9a-f]{64}$/.test(String(a ?? "").trim());

export const parseApt = (s: string) => parseUnits(s, 8, OCTA_MAX);
export const formatApt = (octas: bigint) => formatUnits(octas, 8);

export class AptError extends Error { constructor(readonly status: number, readonly code: string, readonly detail: string) { super(code || `HTTP ${status}`); } }

export async function aptFetch<T = unknown>(path: string, init: RequestInit = {}, o: { hosts?: string[]; timeoutMs?: number } = {}): Promise<T> {
  if (!/^\/[A-Za-z0-9_/:?=&.%-]*$/.test(path)) throw new Error("bad Aptos path");
  let last: unknown = new Error("network");
  for (const host of o.hosts ?? APT_NODES) {
    if (!APT_NODES.includes(host)) throw new Error("bad Aptos host");
    try {
      const r = await hostFetch(host + path, init, o.timeoutMs ?? 10_000);
      const j = (await r.json().catch(() => null)) as Record<string, unknown> | null;
      if (r.status >= 400 && r.status < 500 && r.status !== 429 && j && typeof j === "object" && ("error_code" in j || "message" in j))
        throw new AptError(r.status, String(j.error_code ?? ""), String(j.message ?? "").slice(0, 300));
      if (!r.ok || j == null) throw new Error(`HTTP ${r.status}`);
      return j as T;
    } catch (e) {
      if (e instanceof AptError) throw e;
      last = e;
    }
  }
  throw last;
}
const view = (fn: string, typeArgs: string[], args: string[]) => aptFetch<unknown[]>("/view", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ function: fn, type_arguments: typeArgs, arguments: args }) });

export function readAptBalance(res: unknown): bigint {
  const v = Array.isArray(res) && res.length === 1 ? bigOf(res[0], OCTA_MAX) : null;
  if (v == null) throw kitErr("ERR_PROVIDER");
  return v;
}
export async function aptBalance(address: string): Promise<bigint> {
  if (!isAptAddress(address)) throw kitErr("ERR_ADDRESS");
  try { return readAptBalance(await view("0x1::coin::balance", ["0x1::aptos_coin::AptosCoin"], [address])); }
  catch (e) { if (e instanceof AptError && /not.?found|does not exist/i.test(e.code + e.detail)) return 0n; throw e; }
}
export interface AptAccount { exists: boolean; sequence: bigint; authKey: string }

export async function aptAccount(address: string, hosts?: string[]): Promise<AptAccount> {
  if (!isAptAddress(address)) throw kitErr("ERR_ADDRESS");
  try {
    const a = await aptFetch<{ sequence_number?: unknown; authentication_key?: unknown }>(`/accounts/${address}`, {}, { hosts });
    const seq = bigOf(a?.sequence_number, (1n << 64n) - 1n), k = String(a?.authentication_key ?? "");
    if (seq == null || !/^0x[0-9a-f]{64}$/.test(k)) throw kitErr("ERR_PROVIDER");
    return { exists: true, sequence: seq, authKey: k };
  } catch (e) {
    if (e instanceof AptError && e.status === 404) return { exists: false, sequence: 0n, authKey: address };
    throw e;
  }
}
