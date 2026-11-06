import { blake2b } from "@noble/hashes/blake2.js";
import { pbkdf2 } from "@noble/hashes/pbkdf2.js";
import { sha512 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { base58 } from "@scure/base";
import { mnemonicToEntropy } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import * as sr25519 from "@scure/sr25519";
import { memoAddress, normalizePhrase } from "./account";
import { hostFetch } from "./hostgate";
import { notImported } from "./imported";
import { bigOf, concat, formatUnits, kitErr, leU, parseUnits } from "./sendkit";

export const DOT = { id: "polkadot", name: "Polkadot", symbol: "DOT", coingecko: "polkadot", decimals: 10, explorer: "https://assethub-polkadot.subscan.io", family: "dot" } as const;
export const dotTxUrl = (hash: string) => `${DOT.explorer}/extrinsic/${hash}`;
export const DOT_RPCS = ["https://polkadot-asset-hub-rpc.polkadot.io", "https://asset-hub-polkadot-rpc.n.dwellir.com"];

export const DOT_GENESIS = "0x68d56f15f85d3136970ec16946040bc1752654e906147f7e43e9d539d7c3de2f";

export const PLANCK_MAX = 10n ** 10n * 10n ** 10n;

const enc = (s: string) => new TextEncoder().encode(s);

export function dotMiniSecret(phrase: string): Uint8Array {
  const entropy = mnemonicToEntropy(normalizePhrase(phrase), wordlist);
  return pbkdf2(sha512, entropy, enc("mnemonic"), { c: 2048, dkLen: 64 }).slice(0, 32);
}

export function junctionCode(j: string): Uint8Array {
  const raw = /^\d+$/.test(j) ? Uint8Array.from(leU(BigInt(j), 8)) : concat(compact(enc(j).length), enc(j));
  const code = raw.length > 32 ? blake2b(raw, { dkLen: 32 }) : raw;
  const out = new Uint8Array(32); out.set(code); return out;
}

export function dotSecret(phrase: string, index = 0): Uint8Array {
  notImported(index);
  if (!Number.isInteger(index) || index < 0 || index > 0x7fffffff) throw new Error("bad index");
  const root = sr25519.secretFromSeed(dotMiniSecret(phrase));
  return index === 0 ? root : sr25519.HDKD.secretHard(root, junctionCode(String(index)));
}
export const dotPublicKey = (secret: Uint8Array) => sr25519.getPublicKey(secret);
export const dotSign = (secret: Uint8Array, msg: Uint8Array) => sr25519.sign(secret, msg);
export const dotVerify = (msg: Uint8Array, sig: Uint8Array, pub: Uint8Array) => sr25519.verify(msg, sig, pub);

const SS58PRE = enc("SS58PRE");

export function ss58Of(pub: Uint8Array, prefix = 0): string {
  if (pub.length !== 32 || prefix < 0 || prefix > 63) throw new Error("bad key");
  const body = concat([prefix], pub);
  return base58.encode(concat(body, blake2b(concat(SS58PRE, body), { dkLen: 64 }).slice(0, 2)));
}

export function ss58Decode(a: string): Uint8Array | null {
  try {
    const b = base58.decode(String(a ?? "").trim());
    if (b.length !== 35 || b[0] !== 0) return null;
    const sum = blake2b(concat(SS58PRE, b.slice(0, 33)), { dkLen: 64 });
    return sum[0] === b[33] && sum[1] === b[34] ? b.slice(1, 33) : null;
  } catch { return null; }
}
export const isDotAddress = (a: string) => ss58Decode(a) != null && String(a).trim() === String(a);
export const dotAddress = (phrase: string, index = 0) => memoAddress("dot", phrase, index, () => ss58Of(dotPublicKey(dotSecret(phrase, index))));

export const parseDot = (s: string) => parseUnits(s, 10, PLANCK_MAX);
export const formatDot = (p: bigint) => formatUnits(p, 10);

export function compact(n: number | bigint): number[] {
  const v = BigInt(n);
  if (v < 0n) throw kitErr("ERR_UNSAFE");
  if (v < 1n << 6n) return [Number(v << 2n)];
  if (v < 1n << 14n) return leU((v << 2n) | 1n, 2);
  if (v < 1n << 30n) return leU((v << 2n) | 2n, 4);
  const bytes = leU(v, 32).slice(0, Math.max(4, Math.ceil(v.toString(16).length / 2)));
  return [((bytes.length - 4) << 2) | 3, ...bytes];
}

export class Scale {
  i = 0;
  constructor(readonly b: Uint8Array) {}
  u8() { if (this.i >= this.b.length) throw kitErr("ERR_PROVIDER"); return this.b[this.i++]; }
  bytes(n: number) { if (n < 0 || this.i + n > this.b.length) throw kitErr("ERR_PROVIDER"); const r = this.b.slice(this.i, this.i + n); this.i += n; return r; }
  uint(n: number) { const r = this.bytes(n); let v = 0n; for (let k = n - 1; k >= 0; k--) v = (v << 8n) | BigInt(r[k]); return v; }
  compact(): bigint {
    const b = this.u8(), m = b & 3;
    if (m === 0) return BigInt(b >> 2);
    if (m === 1) { this.i--; return this.uint(2) >> 2n; }
    if (m === 2) { this.i--; return this.uint(4) >> 2n; }
    return this.uint((b >> 2) + 4);
  }
  num() { const v = this.compact(); if (v > 100_000_000n) throw kitErr("ERR_PROVIDER"); return Number(v); }
  str() { return new TextDecoder().decode(this.bytes(this.num())); }
  vec<T>(f: () => T): T[] { const n = this.num(); const out: T[] = []; for (let k = 0; k < n; k++) out.push(f()); return out; }
  opt<T>(f: () => T): T | null { return this.u8() ? f() : null; }
  get done() { return this.i === this.b.length; }
}

const P1 = 11400714785074694791n, P2 = 14029467366897019727n, P3 = 1609587929392839161n, P4 = 9650029242287828579n, P5 = 2870177450012600261n, M = (1n << 64n) - 1n;
const rotl = (x: bigint, r: bigint) => ((x << r) | (x >> (64n - r))) & M;
const rd64 = (b: Uint8Array, i: number) => { let v = 0n; for (let k = 7; k >= 0; k--) v = (v << 8n) | BigInt(b[i + k]); return v; };
const rd32 = (b: Uint8Array, i: number) => BigInt(b[i] | (b[i + 1] << 8) | (b[i + 2] << 16)) + (BigInt(b[i + 3]) << 24n);

export function xxh64(b: Uint8Array, seed: bigint): bigint {
  let i = 0, h: bigint;
  const round = (acc: bigint, lane: bigint) => (rotl((acc + lane * P2) & M, 31n) * P1) & M;
  if (b.length >= 32) {
    let v1 = (seed + P1 + P2) & M, v2 = (seed + P2) & M, v3 = seed, v4 = (seed - P1 + (1n << 64n)) & M;
    for (; i + 32 <= b.length; i += 32) { v1 = round(v1, rd64(b, i)); v2 = round(v2, rd64(b, i + 8)); v3 = round(v3, rd64(b, i + 16)); v4 = round(v4, rd64(b, i + 24)); }
    h = (rotl(v1, 1n) + rotl(v2, 7n) + rotl(v3, 12n) + rotl(v4, 18n)) & M;
    for (const v of [v1, v2, v3, v4]) h = (((h ^ round(0n, v)) * P1) + P4) & M;
  } else h = (seed + P5) & M;
  h = (h + BigInt(b.length)) & M;
  for (; i + 8 <= b.length; i += 8) h = ((rotl(h ^ round(0n, rd64(b, i)), 27n) * P1) + P4) & M;
  if (i + 4 <= b.length) { h = ((rotl(h ^ ((rd32(b, i) * P1) & M), 23n) * P2) + P3) & M; i += 4; }
  for (; i < b.length; i++) h = (rotl(h ^ ((BigInt(b[i]) * P5) & M), 11n) * P1) & M;
  h ^= h >> 33n; h = (h * P2) & M; h ^= h >> 29n; h = (h * P3) & M; h ^= h >> 32n;
  return h;
}
export const twox128 = (s: string) => concat(leU(xxh64(enc(s), 0n), 8), leU(xxh64(enc(s), 1n), 8));

export const accountKey = (id: Uint8Array) => "0x" + bytesToHex(concat(twox128("System"), twox128("Account"), blake2b(id, { dkLen: 16 }), id));

export class DotError extends Error { constructor(readonly code: number, readonly detail: string) { super(`DOT_${code}`); } }
export async function dotRpc<T = unknown>(method: string, params: unknown[] = [], o: { hosts?: string[]; timeoutMs?: number } = {}): Promise<T> {
  if (!/^[A-Za-z_]{3,60}$/.test(method)) throw new Error("bad Polkadot method");
  let last: unknown = new Error("network");
  for (const host of o.hosts ?? DOT_RPCS) {
    if (!DOT_RPCS.includes(host)) throw new Error("bad Polkadot host");
    try {
      const r = await hostFetch(host, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }, o.timeoutMs ?? 12_000);
      const j = (await r.json().catch(() => null)) as { result?: unknown; error?: { code?: unknown; message?: unknown; data?: unknown } } | null;
      if (!j || typeof j !== "object") throw new Error(`HTTP ${r.status}`);
      if (j.error && typeof j.error === "object") {
        const code = Number(j.error.code);

        if ((code >= 1010 && code <= 1014) || code === -32602 || code === -32601) throw new DotError(code, `${String(j.error.message ?? "")} ${String(j.error.data ?? "")}`.trim().slice(0, 200));
        throw new Error(`RPC ${code}`);
      }
      if (!r.ok || !("result" in j)) throw new Error(`HTTP ${r.status}`);
      return j.result as T;
    } catch (e) {
      if (e instanceof DotError) throw e;
      last = e;
    }
  }
  throw last;
}

export interface DotAccount { exists: boolean; nonce: number; free: bigint; reserved: bigint; frozen: bigint }

export function readDotAccount(hex: unknown): DotAccount {
  if (hex == null) return { exists: false, nonce: 0, free: 0n, reserved: 0n, frozen: 0n };
  if (typeof hex !== "string" || !/^0x[0-9a-f]{160}$/.test(hex)) throw kitErr("ERR_PROVIDER");
  const s = new Scale(hexToBytes(hex.slice(2)));
  const nonce = Number(s.uint(4)); s.uint(4); const providers = s.uint(4); s.uint(4);
  const free = s.uint(16), reserved = s.uint(16), frozen = s.uint(16);
  if (free > PLANCK_MAX || reserved > PLANCK_MAX) throw kitErr("ERR_PROVIDER");
  return { exists: providers > 0n || free > 0n, nonce, free, reserved, frozen };
}
export async function dotAccount(address: string): Promise<DotAccount> {
  const id = ss58Decode(address);
  if (!id) throw kitErr("ERR_ADDRESS");
  return readDotAccount(await dotRpc("state_getStorage", [accountKey(id)]));
}

export const DOT_ED = 100_000_000n;

export function dotTransferable(a: Pick<DotAccount, "free" | "reserved" | "frozen">, ed: bigint): bigint {
  const locked = a.frozen > a.reserved ? a.frozen - a.reserved : 0n;
  const keep = locked > ed ? locked : ed;
  return a.free > keep ? a.free - keep : 0n;
}
export const bigOrNull = bigOf;
