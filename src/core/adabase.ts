import { ed25519 } from "@noble/curves/ed25519.js";
import { blake2b } from "@noble/hashes/blake2.js";
import { hmac } from "@noble/hashes/hmac.js";
import { pbkdf2 } from "@noble/hashes/pbkdf2.js";
import { sha512 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { bech32 } from "@scure/base";
import { mnemonicToEntropy } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { memoAddress, normalizePhrase } from "./account";
import { DEMO_ADA_LOVELACE, demoOn } from "./demo";
import { hostJson } from "./hostgate";
import { notImported } from "./imported";

export const ADA = { id: "cardano", name: "Cardano", symbol: "ADA", coingecko: "cardano", decimals: 6, explorer: "https://cardanoscan.io", family: "ada" } as const;
export const adaTxUrl = (hash: string) => `${ADA.explorer}/transaction/${hash}`;
export const KOIOS = "https://swap.madarwallet.app/adaapi";

export const LOVELACE_MAX = 45_000_000_000n * 1_000_000n;

const L = ed25519.Point.Fn.ORDER;
const leInt = (b: Uint8Array): bigint => { let n = 0n; for (let i = b.length - 1; i >= 0; i--) n = (n << 8n) | BigInt(b[i]); return n; };
const intLe = (n: bigint, len: number): Uint8Array => { const o = new Uint8Array(len); for (let i = 0; i < len; i++) { o[i] = Number(n & 0xffn); n >>= 8n; } return o; };
export const HARD = 0x80000000;

export interface AdaXprv { kL: Uint8Array; kR: Uint8Array; chain: Uint8Array }

export const adaPubOf = (kL: Uint8Array): Uint8Array => ed25519.Point.BASE.multiply(leInt(kL) % L).toBytes();

export function icarusMaster(entropy: Uint8Array): AdaXprv {
  const x = pbkdf2(sha512, new Uint8Array(0), entropy, { c: 4096, dkLen: 96 });
  x[0] &= 0b1111_1000; x[31] &= 0b0001_1111; x[31] |= 0b0100_0000;
  return { kL: x.slice(0, 32), kR: x.slice(32, 64), chain: x.slice(64, 96) };
}

export function adaChild(k: AdaXprv, index: number): AdaXprv {
  const hard = index >= HARD, idx = new Uint8Array(4);
  new DataView(idx.buffer).setUint32(0, index >>> 0, true);
  const data = (tag: number) => hard ? Uint8Array.from([tag, ...k.kL, ...k.kR, ...idx]) : Uint8Array.from([tag, ...adaPubOf(k.kL), ...idx]);
  const z = hmac(sha512, k.chain, data(hard ? 0x00 : 0x02));
  const c = hmac(sha512, k.chain, data(hard ? 0x01 : 0x03)).slice(32, 64);
  const kL = leInt(z.slice(0, 28)) * 8n + leInt(k.kL);
  if (kL % L === 0n) throw new Error("ERR_ADA_KEY");
  const kR = (leInt(z.slice(32, 64)) + leInt(k.kR)) % (1n << 256n);
  return { kL: intLe(kL, 32), kR: intLe(kR, 32), chain: c };
}
const derivePath = (k: AdaXprv, path: number[]) => path.reduce(adaChild, k);

export function adaKeys(phrase: string, index = 0): { pay: AdaXprv; payPub: Uint8Array; stakePub: Uint8Array } {
  notImported(index);
  if (!Number.isInteger(index) || index < 0 || index >= HARD) throw new Error("ERR_ADA_KEY");
  const root = icarusMaster(mnemonicToEntropy(normalizePhrase(phrase), wordlist));
  const acct = derivePath(root, [1852 + HARD, 1815 + HARD, index + HARD]);
  const pay = derivePath(acct, [0, 0]), stake = derivePath(acct, [2, 0]);
  return { pay, payPub: adaPubOf(pay.kL), stakePub: adaPubOf(stake.kL) };
}
export const keyHash = (pub: Uint8Array): Uint8Array => blake2b(pub, { dkLen: 28 });

export function baseAddress(payPub: Uint8Array, stakePub: Uint8Array): string {
  return bech32.encode("addr", bech32.toWords(Uint8Array.from([0x01, ...keyHash(payPub), ...keyHash(stakePub)])), 1023);
}

export const adaAddress = (phrase: string, index = 0): string => memoAddress("ada", phrase, index, () => {
  const k = adaKeys(phrase, index);
  return baseAddress(k.payPub, k.stakePub);
});

export interface AdaAddr { bytes: Uint8Array; kind: number; script: boolean; payment: Uint8Array }

export function parseAdaAddress(s: string): AdaAddr | null {
  const v = String(s ?? "").trim();
  if (!/^addr1[02-9ac-hj-np-z]{50,120}$/.test(v)) return null;
  let bytes: Uint8Array;
  try {
    const d = bech32.decode(v as `${string}1${string}`, 1023);
    if (d.prefix !== "addr") return null;
    bytes = bech32.fromWords(d.words);
  } catch { return null; }
  const kind = bytes[0] >> 4, net = bytes[0] & 0x0f;
  if (net !== 1) return null;
  if (kind <= 3 && bytes.length !== 57) return null;
  if ((kind === 6 || kind === 7) && bytes.length !== 29) return null;
  if (kind > 3 && kind !== 6 && kind !== 7) return null;
  return { bytes, kind, script: kind % 2 === 1, payment: bytes.slice(1, 29) };
}
export const isAdaAddress = (s: string) => parseAdaAddress(s) != null;

export const sameAdaAddress = (a: string, b: string) => { const x = parseAdaAddress(a), y = parseAdaAddress(b); return !!x && !!y && bytesToHex(x.bytes) === bytesToHex(y.bytes); };

export function formatAda(v: bigint): string {
  const neg = v < 0n, a = neg ? -v : v, w = a / 1_000_000n, f = (a % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return (neg ? "-" : "") + w.toString() + (f ? "." + f : "");
}

export function parseAda(s: string): bigint | null {
  const v = String(s ?? "").trim().replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)).replace(/[٫,]/g, ".");
  const m = /^(\d{1,11})(?:\.(\d{0,6}))?$/.exec(v);
  if (!m) return null;
  const n = BigInt(m[1]) * 1_000_000n + BigInt((m[2] ?? "").padEnd(6, "0") || "0");
  return n <= LOVELACE_MAX ? n : null;
}

const num = (v: unknown, max = LOVELACE_MAX): bigint => {
  const s = String(v ?? "");
  if (!/^\d{1,20}$/.test(s)) throw new Error("ERR_PROVIDER");
  const n = BigInt(s);
  if (n > max) throw new Error("ERR_PROVIDER");
  return n;
};
export const koiosGet = <T>(path: string) => hostJson<T>(KOIOS + path, { headers: { accept: "application/json" } });
export const koiosPost = <T>(path: string, body: unknown) => hostJson<T>(KOIOS + path, { method: "POST", headers: { accept: "application/json", "content-type": "application/json" }, body: JSON.stringify(body) });

export interface AdaAsset { policy: string; name: string; qty: bigint }

export interface AdaUtxo { txHash: string; index: number; lovelace: bigint; assets: AdaAsset[]; refScript?: boolean }

export function utxosOf(set: unknown): AdaUtxo[] {
  if (!Array.isArray(set)) throw new Error("ERR_PROVIDER");
  const seen = new Set<string>();
  return set.map((u: { tx_hash?: unknown; tx_index?: unknown; value?: unknown; asset_list?: unknown; reference_script?: unknown }) => {
    const txHash = String(u?.tx_hash ?? ""), index = Number(u?.tx_index);
    if (!/^[0-9a-f]{64}$/.test(txHash) || !Number.isInteger(index) || index < 0 || index > 65535) throw new Error("ERR_PROVIDER");
    const key = `${txHash}#${index}`;
    if (seen.has(key)) throw new Error("ERR_PROVIDER");
    seen.add(key);
    const list = u?.asset_list ?? [];
    if (!Array.isArray(list)) throw new Error("ERR_PROVIDER");
    const assets = list.map((a: { policy_id?: unknown; asset_name?: unknown; quantity?: unknown }) => {
      const policy = String(a?.policy_id ?? ""), name = String(a?.asset_name ?? "");
      if (!/^[0-9a-f]{56}$/.test(policy) || !/^(?:[0-9a-f]{2}){0,32}$/.test(name)) throw new Error("ERR_PROVIDER");
      return { policy, name, qty: num(a?.quantity, (1n << 64n) - 1n) };
    });
    return { txHash, index, lovelace: num(u?.value), assets, ...(u?.reference_script != null ? { refScript: true } : {}) };
  });
}

export async function adaAccount(address: string): Promise<{ lovelace: bigint; utxos: AdaUtxo[] }> {
  if (!isAdaAddress(address)) throw new Error("ERR_ADDRESS");
  const r = await koiosPost<{ address?: string; balance?: string; utxo_set?: unknown }[]>("/address_info", { _addresses: [address] });
  if (!Array.isArray(r)) throw new Error("ERR_PROVIDER");
  const row = r.find((x) => x?.address === address);
  if (!row) return { lovelace: 0n, utxos: [] };
  const utxos = utxosOf(row.utxo_set ?? []);
  const lovelace = num(row.balance);
  if (utxos.reduce((s, u) => s + u.lovelace, 0n) !== lovelace) throw new Error("ERR_PROVIDER");
  return { lovelace, utxos };
}

export async function adaBalance(address: string): Promise<{ lovelace: bigint; tokens: number }> {
  if (demoOn()) return { lovelace: DEMO_ADA_LOVELACE, tokens: 0 };
  const a = await adaAccount(address);
  return { lovelace: a.lovelace, tokens: new Set(a.utxos.flatMap((u) => u.assets.map((x) => x.policy + x.name))).size };
}

export const SHELLEY_OFFSET = 1_591_566_291;
export const localSlot = (nowMs = Date.now()) => Math.floor(nowMs / 1000) - SHELLEY_OFFSET;

export const SLOT_SKEW = 900;

export function tipOf(row: { abs_slot?: unknown; block_time?: unknown } | undefined, nowMs = Date.now()): { slot: number; time: number } {
  const slot = Number(row?.abs_slot), time = Number(row?.block_time);
  if (!Number.isSafeInteger(slot) || slot < 100_000_000 || !Number.isSafeInteger(time)) throw new Error("ERR_PROVIDER");
  if (Math.abs(slot - localSlot(nowMs)) > SLOT_SKEW) throw new Error("ERR_ADA_TIME");
  return { slot, time };
}

export async function adaTip(): Promise<{ slot: number; time: number }> {
  return tipOf((await koiosGet<{ abs_slot?: unknown; block_time?: unknown }[]>("/tip"))?.[0]);
}

export interface AdaParams { feeA: bigint; feeB: bigint; coinsPerByte: bigint; maxTxSize: number }
export function paramsOf(p: { min_fee_a?: unknown; min_fee_b?: unknown; coins_per_utxo_size?: unknown; max_tx_size?: unknown } | undefined): AdaParams {
  const feeA = num(p?.min_fee_a), feeB = num(p?.min_fee_b), coinsPerByte = num(p?.coins_per_utxo_size), maxTxSize = Number(p?.max_tx_size);
  if (feeA < 1n || feeA > 100n || feeB < 100_000n || feeB > 500_000n || coinsPerByte < 1000n || coinsPerByte > 20_000n || !Number.isInteger(maxTxSize) || maxTxSize < 8192 || maxTxSize > 32768) throw new Error("ERR_PROVIDER");
  return { feeA, feeB, coinsPerByte, maxTxSize };
}
export async function adaParams(): Promise<AdaParams> {
  return paramsOf((await koiosGet<unknown[]>("/epoch_params?limit=1&select=min_fee_a,min_fee_b,coins_per_utxo_size,max_tx_size"))?.[0] as never);
}
export { bytesToHex, hexToBytes };
