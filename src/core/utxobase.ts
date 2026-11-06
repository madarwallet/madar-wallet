import { notImported } from "./imported";
import { HDKey } from "@scure/bip32";
import { mnemonicToSeedSync } from "@scure/bip39";
import { base58check, bech32, bech32m } from "@scure/base";
import { ripemd160 } from "@noble/hashes/legacy.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { memoAddress, normalizePhrase } from "./account";
import { DEMO_DOGE_KOINU, DEMO_LTC_LITOSHI, demoOn } from "./demo";
import { firstOk, hostFetch, hostJson } from "./hostgate";
import type { BtcTx } from "./history";

export type UtxoId = "dogecoin" | "litecoin";
export type UtxoFamily = "doge" | "ltc";
export interface UtxoCoin {
  id: UtxoId; name: string; symbol: "DOGE" | "LTC"; coingecko: string; decimals: 8; explorer: string; family: UtxoFamily;

  path: (index: number) => string;

  kind: "pkh" | "wpkh";

  net: { bech32: string; pubKeyHash: number; scriptHash: number; wif: number };

  shVersions: number[];

  dust: bigint;

  minFeeRate: number; maxFeeRate: number;

  rateUnit: string;
  bitcore: string; blockcypher: string; blockchair: string; esplora?: string;
}

export const DOGE: UtxoCoin = {
  id: "dogecoin", name: "Dogecoin", symbol: "DOGE", coingecko: "dogecoin", decimals: 8, explorer: "https://blockchair.com/dogecoin", family: "doge",
  path: (i) => `m/44'/3'/0'/0/${i}`, kind: "pkh",
  net: { bech32: "", pubKeyHash: 0x1e, scriptHash: 0x16, wif: 0x9e }, shVersions: [0x16],
  dust: 1_000_000n, minFeeRate: 1_000, maxFeeRate: 200_000, rateUnit: "koinu/B",
  bitcore: "https://api.bitcore.io/api/DOGE/mainnet", blockcypher: "https://api.blockcypher.com/v1/doge/main", blockchair: "https://api.blockchair.com/dogecoin",
};

export const LTC: UtxoCoin = {
  id: "litecoin", name: "Litecoin", symbol: "LTC", coingecko: "litecoin", decimals: 8, explorer: "https://litecoinspace.org", family: "ltc",
  path: (i) => `m/84'/2'/0'/0/${i}`, kind: "wpkh",
  net: { bech32: "ltc", pubKeyHash: 0x30, scriptHash: 0x32, wif: 0xb0 }, shVersions: [0x32, 0x05],
  dust: 5_460n, minFeeRate: 1, maxFeeRate: 500, rateUnit: "lit/vB",
  bitcore: "https://api.bitcore.io/api/LTC/mainnet", blockcypher: "https://api.blockcypher.com/v1/ltc/main", blockchair: "https://api.blockchair.com/litecoin", esplora: "https://litecoinspace.org/api",
};
export const UTXO_COINS: readonly UtxoCoin[] = [DOGE, LTC];
export const utxoById = (id: string): UtxoCoin | undefined => UTXO_COINS.find((c) => c.id === id);
export const utxoTxUrl = (c: UtxoCoin, txid: string) => (c.id === "dogecoin" ? `${c.explorer}/transaction/${txid}` : `${c.explorer}/tx/${txid}`);

export const UTXO_RBF_SEQUENCE = 0xfffffffd;

export const rateLabel = (c: UtxoCoin, rate: number) => (c.id === "dogecoin" ? `${Number((rate / 100_000).toFixed(4))} DOGE/kB` : `${rate} lit/vB`);
export const clampUtxoRate =(c: UtxoCoin, r: number) => Math.min(c.maxFeeRate, Math.max(c.minFeeRate, Math.ceil(Number.isFinite(r) && r > 0 ? r : c.minFeeRate)));

const b58 = base58check(sha256);
const hash160 = (b: Uint8Array) => ripemd160(sha256(b));

export function utxoKeysFromSeed(c: UtxoCoin, seed: Uint8Array, index = 0): { privateKey: Uint8Array; publicKey: Uint8Array } {
  notImported(index);
  const key = HDKey.fromMasterSeed(seed).derive(c.path(index));
  if (!key.privateKey || !key.publicKey) throw new Error("derivation failed");
  return { privateKey: key.privateKey, publicKey: key.publicKey };
}
export const utxoKeys = (c: UtxoCoin, phrase: string, index = 0) => utxoKeysFromSeed(c, mnemonicToSeedSync(normalizePhrase(phrase)), index);

export function utxoAddressOfKey(c: UtxoCoin, pub: Uint8Array): string {
  const h = hash160(pub);
  return c.kind === "wpkh" ? bech32.encode(c.net.bech32, [0, ...bech32.toWords(h)]) : b58.encode(Uint8Array.from([c.net.pubKeyHash, ...h]));
}
export const utxoAddress = (c: UtxoCoin, phrase: string, index = 0): string => memoAddress(c.id, phrase, index, () => utxoAddressOfKey(c, utxoKeys(c, phrase, index).publicKey));

export type UtxoDest = { type: "pkh" | "sh"; hash: Uint8Array } | { type: "wpkh" | "wsh"; hash: Uint8Array } | { type: "tr"; pubkey: Uint8Array };

export function decodeUtxoAddress(c: UtxoCoin, addr: string): UtxoDest {
  const v = String(addr ?? "").trim();
  if (!v || v.length > 90) throw new Error("ERR_ADDRESS");
  if (c.net.bech32 && v.toLowerCase().startsWith(c.net.bech32 + "1")) {
    if (v !== v.toLowerCase() && v !== v.toUpperCase()) throw new Error("ERR_ADDRESS");
    const low = v.toLowerCase() as `${string}1${string}`;
    let d: { prefix: string; words: number[] };
    let m = false;
    try { d = bech32.decode(low); } catch { try { d = bech32m.decode(low); m = true; } catch { throw new Error("ERR_ADDRESS"); } }
    if (d.prefix !== c.net.bech32 || !d.words.length) throw new Error("ERR_ADDRESS");
    const ver = d.words[0];
    let prog: Uint8Array;
    try { prog = (m ? bech32m : bech32).fromWords(d.words.slice(1)); } catch { throw new Error("ERR_ADDRESS"); }
    if (ver === 0 && !m && prog.length === 20) return { type: "wpkh", hash: prog };
    if (ver === 0 && !m && prog.length === 32) return { type: "wsh", hash: prog };
    if (ver === 1 && m && prog.length === 32) return { type: "tr", pubkey: prog };
    throw new Error("ERR_ADDRESS");
  }
  if (!/^[1-9A-HJ-NP-Za-km-z]{25,40}$/.test(v)) throw new Error("ERR_ADDRESS");
  let raw: Uint8Array;
  try { raw = b58.decode(v); } catch { throw new Error("ERR_ADDRESS"); }
  if (raw.length !== 21) throw new Error("ERR_ADDRESS");
  if (raw[0] === c.net.pubKeyHash) return { type: "pkh", hash: raw.slice(1) };
  if (c.shVersions.includes(raw[0])) return { type: "sh", hash: raw.slice(1) };
  throw new Error("ERR_ADDRESS");
}
export const isUtxoAddress = (c: UtxoCoin, a: string) => { try { decodeUtxoAddress(c, a); return true; } catch { return false; } };

export const isLegacyLtcP2sh = (c: UtxoCoin, a: string) => c.id === "litecoin" && /^3/.test(String(a ?? "").trim()) && isUtxoAddress(c, a);

export function utxoScriptHex(c: UtxoCoin, addr: string): string {
  const d = decodeUtxoAddress(c, addr);
  const h = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  if (d.type === "pkh") return "76a914" + h(d.hash) + "88ac";
  if (d.type === "sh") return "a914" + h(d.hash) + "87";
  if (d.type === "wpkh") return "0014" + h(d.hash);
  if (d.type === "wsh") return "0020" + h(d.hash);
  if (d.type === "tr") return "5120" + h(d.pubkey);
  throw new Error("ERR_ADDRESS");
}

export function parseUtxoAmount(s: string): bigint {
  const v = String(s ?? "").trim();
  if (!/^\d{1,12}(\.\d{1,8})?$/.test(v)) throw new Error("ERR_AMOUNT");
  const [i, f = ""] = v.split(".");
  return BigInt(i) * 100_000_000n + BigInt((f + "00000000").slice(0, 8));
}
export const formatUtxoAmount = (n: bigint) => {
  const neg = n < 0n, a = neg ? -n : n;
  const f = (a % 100_000_000n).toString().padStart(8, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${a / 100_000_000n}${f ? "." + f : ""}`;
};

export const units = (v: unknown): bigint | null => {
  if (typeof v === "number" && Number.isInteger(v) && v >= 0) return BigInt(v);
  if (typeof v === "string" && /^\d{1,20}$/.test(v)) return BigInt(v);
  return null;
};

const TXID = /^[0-9a-f]{64}$/;
const HEX = /^(?:[0-9a-f]{2})+$/;
const READ_MS = 9_000;
export interface UtxoBalance { confirmed: bigint; pending: bigint }
export interface Utxo { txid: string; vout: number; value: bigint; confirmed: boolean }
export interface UtxoFees { slow: number; normal: number; fast: number }

type BitcoreCoin = { mintTxid?: string; mintIndex?: number; value?: number; address?: string; spentTxid?: string; mintHeight?: number; script?: string };
type BcRef = { tx_hash?: string; tx_output_n?: number; tx_input_n?: number; value?: number; spent?: boolean; script?: string; block_height?: number; confirmations?: number };
type EsploraUtxo = { txid?: string; vout?: number; value?: number; status?: { confirmed?: boolean } };

export function readBitcoreCoins(c: UtxoCoin, me: string, list: unknown): Utxo[] {
  if (!Array.isArray(list)) throw new Error("ERR_PROVIDER");
  const script = utxoScriptHex(c, me), out = new Map<string, Utxo>();
  for (const x of list as BitcoreCoin[]) {
    const v = units(x?.value), txid = String(x?.mintTxid ?? "").toLowerCase();
    if (!TXID.test(txid) || !Number.isInteger(x?.mintIndex) || (x.mintIndex as number) < 0 || v == null || (x.spentTxid ?? "") !== "") continue;
    if (x.address !== me || (x.script != null && String(x.script).toLowerCase() !== script)) throw new Error("ERR_PROVIDER");
    out.set(`${txid}:${x.mintIndex}`, { txid, vout: x.mintIndex as number, value: v, confirmed: Number(x.mintHeight) > 0 });
  }
  return [...out.values()];
}
export function readBlockcypherCoins(c: UtxoCoin, me: string, j: unknown): Utxo[] {
  const o = j as { address?: string; txrefs?: BcRef[]; unconfirmed_txrefs?: BcRef[] };
  if (!o || typeof o !== "object" || (o.address != null && o.address !== me)) throw new Error("ERR_PROVIDER");
  const script = utxoScriptHex(c, me), out = new Map<string, Utxo>();
  for (const [refs, confirmed] of [[o.txrefs ?? [], true], [o.unconfirmed_txrefs ?? [], false]] as const) {
    if (!Array.isArray(refs)) throw new Error("ERR_PROVIDER");
    for (const r of refs) {
      const v = units(r?.value), txid = String(r?.tx_hash ?? "").toLowerCase();
      if (!TXID.test(txid) || !Number.isInteger(r?.tx_output_n) || (r.tx_output_n as number) < 0 || (r.tx_input_n ?? -1) !== -1 || r.spent === true || v == null) continue;
      if (r.script != null && String(r.script).toLowerCase() !== script) throw new Error("ERR_PROVIDER");
      out.set(`${txid}:${r.tx_output_n}`, { txid, vout: r.tx_output_n as number, value: v, confirmed });
    }
  }
  return [...out.values()];
}
export function readEsploraCoins(list: unknown): Utxo[] {
  if (!Array.isArray(list)) throw new Error("ERR_PROVIDER");
  const out = new Map<string, Utxo>();
  for (const x of list as EsploraUtxo[]) {
    const v = units(x?.value), txid = String(x?.txid ?? "").toLowerCase();
    if (!TXID.test(txid) || !Number.isInteger(x?.vout) || (x.vout as number) < 0 || v == null) continue;
    out.set(`${txid}:${x.vout}`, { txid, vout: x.vout as number, value: v, confirmed: !!x.status?.confirmed });
  }
  return [...out.values()];
}

const enc = encodeURIComponent;

export async function utxoBalance(c: UtxoCoin, address: string): Promise<UtxoBalance> {
  if (import.meta.env.DEV && demoOn()) return { confirmed: c.id === "dogecoin" ? DEMO_DOGE_KOINU : DEMO_LTC_LITOSHI, pending: 0n };
  if (!isUtxoAddress(c, address)) throw new Error("ERR_ADDRESS");
  const bal = (a: unknown, b: unknown): UtxoBalance => {
    const x = units(a), y = typeof b === "number" && Number.isInteger(b) ? BigInt(b) : 0n;
    if (x == null) throw new Error("ERR_PROVIDER");
    return { confirmed: x, pending: y };
  };
  const tries: (() => Promise<UtxoBalance>)[] = [
    async () => { const j = await hostJson<{ confirmed?: number; unconfirmed?: number }>(`${c.bitcore}/address/${enc(address)}/balance`, {}, READ_MS); return bal(j?.confirmed, j?.unconfirmed); },
  ];
  if (c.esplora) tries.push(async () => {
    type S = { funded_txo_sum?: number; spent_txo_sum?: number };
    const j = await hostJson<{ chain_stats?: S; mempool_stats?: S }>(`${c.esplora}/address/${enc(address)}`, {}, READ_MS);
    const v = (s?: S) => { const f = units(s?.funded_txo_sum), sp = units(s?.spent_txo_sum); if (f == null || sp == null) throw new Error("ERR_PROVIDER"); return f - sp; };
    return { confirmed: v(j?.chain_stats), pending: v(j?.mempool_stats) };
  });
  tries.push(async () => { const j = await hostJson<{ address?: string; balance?: number; unconfirmed_balance?: number }>(`${c.blockcypher}/addrs/${enc(address)}/balance`, {}, READ_MS); if (j?.address && j.address !== address) throw new Error("ERR_PROVIDER"); return bal(j?.balance, j?.unconfirmed_balance); });
  return firstOk(tries);
}

export async function utxoCoins(c: UtxoCoin, address: string): Promise<Utxo[]> {
  if (!isUtxoAddress(c, address)) throw new Error("ERR_ADDRESS");
  const tries: (() => Promise<Utxo[]>)[] = [
    async () => readBitcoreCoins(c, address, await hostJson(`${c.bitcore}/address/${enc(address)}/?unspent=true&limit=500`, {}, READ_MS)),
  ];
  if (c.esplora) tries.push(async () => readEsploraCoins(await hostJson(`${c.esplora}/address/${enc(address)}/utxo`, {}, READ_MS)));
  tries.push(async () => readBlockcypherCoins(c, address, await hostJson(`${c.blockcypher}/addrs/${enc(address)}?unspentOnly=true&includeScript=true&limit=500`, {}, READ_MS)));
  return firstOk(tries);
}

export async function utxoRawTx(c: UtxoCoin, txid: string): Promise<string> {
  if (!TXID.test(txid)) throw new Error("ERR_PROVIDER");
  const ok = (h: unknown) => { const s = String(h ?? "").trim().toLowerCase(); if (!HEX.test(s) || s.length > 2_000_000) throw new Error("ERR_PROVIDER"); return s; };
  const tries: (() => Promise<string>)[] = [];
  if (c.esplora) tries.push(async () => { const r = await hostFetch(`${c.esplora}/tx/${txid}/hex`, {}, READ_MS); if (!r.ok) throw new Error(`HTTP ${r.status}`); return ok(await r.text()); });
  tries.push(async () => ok((await hostJson<{ hex?: string }>(`${c.blockcypher}/txs/${txid}?includeHex=true&limit=1`, {}, READ_MS))?.hex));
  tries.push(async () => ok((await hostJson<{ data?: Record<string, { raw_transaction?: string }> }>(`${c.blockchair}/raw/transaction/${txid}`, {}, READ_MS))?.data?.[txid]?.raw_transaction));
  return firstOk(tries);
}

export async function utxoFees(c: UtxoCoin): Promise<UtxoFees> {
  const clamp = (f: UtxoFees): UtxoFees => {
    const s = clampUtxoRate(c, f.slow), n = Math.max(s, clampUtxoRate(c, f.normal));
    return { slow: s, normal: n, fast: Math.max(n, clampUtxoRate(c, f.fast)) };
  };
  const perKb = (coinsPerKb: unknown) => { const v = Number(coinsPerKb); if (!Number.isFinite(v) || v <= 0) throw new Error("ERR_PROVIDER"); return (v * 1e8) / 1000; };
  const tries: (() => Promise<UtxoFees>)[] = [];
  if (c.esplora) tries.push(async () => { const f = await hostJson<{ fastestFee?: number; halfHourFee?: number; hourFee?: number }>(`${c.esplora}/v1/fees/recommended`, {}, READ_MS); return clamp({ slow: Number(f?.hourFee), normal: Number(f?.halfHourFee), fast: Number(f?.fastestFee) }); });
  tries.push(async () => {
    const one = async (blocks: number) => perKb((await hostJson<{ feerate?: number }>(`${c.bitcore}/fee/${blocks}`, {}, READ_MS))?.feerate);
    const fast = await one(2), normal = await one(6).catch(() => fast), slow = await one(20).catch(() => normal);
    return clamp({ slow, normal, fast });
  });
  tries.push(async () => {
    const j = await hostJson<{ high_fee_per_kb?: number; medium_fee_per_kb?: number; low_fee_per_kb?: number }>(`${c.blockcypher}`, {}, READ_MS);
    const r = (v: unknown) => { const n = Number(v); if (!Number.isFinite(n) || n <= 0) throw new Error("ERR_PROVIDER"); return n / 1000; };
    return clamp({ slow: r(j?.low_fee_per_kb), normal: r(j?.medium_fee_per_kb), fast: r(j?.high_fee_per_kb) });
  });
  return firstOk(tries);
}

export const ALREADY_KNOWN = /already (in|known|exists|have)|txn-already|transaction already|exists in (the )?mempool/i;

export type BroadcastAnswer = { host: string; ok: true } | { host: string; already: true } | { host: string; refused: string } | { host: string; error: string };

export async function utxoBroadcastAll(c: UtxoCoin, hex: string): Promise<BroadcastAnswer[]> {
  if (!HEX.test(hex)) return [{ host: "-", refused: "not a transaction" }];
  const hosts: [string, () => Promise<Response>, (r: Response) => Promise<unknown>][] = [];
  if (c.esplora) hosts.push([c.esplora, () => hostFetch(`${c.esplora}/tx`, { method: "POST", body: hex, headers: { "Content-Type": "text/plain" } }, 30_000), (r) => r.text()]);
  hosts.push([c.bitcore, () => hostFetch(`${c.bitcore}/tx/send`, { method: "POST", body: JSON.stringify({ rawTx: hex }), headers: { "Content-Type": "application/json" } }, 30_000), async (r) => ((await r.json()) as { txid?: string })?.txid]);
  hosts.push([c.blockcypher, () => hostFetch(`${c.blockcypher}/txs/push`, { method: "POST", body: JSON.stringify({ tx: hex }), headers: { "Content-Type": "application/json" } }, 30_000), async (r) => ((await r.json()) as { tx?: { hash?: string } })?.tx?.hash]);
  const out: BroadcastAnswer[] = [];
  for (const [host, send, idOf] of hosts) {
    try {
      const r = await send();
      if (r.ok) {
        const id = String((await idOf(r).catch(() => "")) ?? "").trim().toLowerCase();
        if (TXID.test(id)) { out.push({ host, ok: true }); return out; }
        out.push({ host, error: "answer" });
        continue;
      }
      const body = (await r.text().catch(() => "")).slice(0, 300);
      out.push(ALREADY_KNOWN.test(body) ? { host, already: true } : r.status >= 400 && r.status < 500 && r.status !== 429 ? { host, refused: body || `HTTP ${r.status}` } : { host, error: `HTTP ${r.status}` });
    } catch (e) { out.push({ host, error: String((e as Error)?.message ?? e) }); }
  }
  return out;
}

export async function utxoTxStatus(c: UtxoCoin, txid: string): Promise<{ conf: number } | null> {
  if (!TXID.test(txid)) return null;
  const tries: (() => Promise<{ conf: number } | null>)[] = [];
  if (c.esplora) tries.push(async () => {
    const r = await hostFetch(`${c.esplora}/tx/${txid}/status`, {}, READ_MS);
    if (r.status === 404 || r.status === 400) return null;
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = (await r.json()) as { confirmed?: boolean };
    return { conf: j?.confirmed ? 1 : 0 };
  });
  tries.push(async () => {
    const r = await hostFetch(`${c.bitcore}/tx/${txid}`, {}, READ_MS);
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = (await r.json()) as { txid?: string; confirmations?: number; blockHeight?: number };
    if (j?.txid !== txid) throw new Error("ERR_PROVIDER");
    return { conf: Number(j.blockHeight) > 0 ? Math.max(1, Number(j.confirmations) || 1) : 0 };
  });
  tries.push(async () => {
    const r = await hostFetch(`${c.blockcypher}/txs/${txid}?limit=1`, {}, READ_MS);
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = (await r.json()) as { hash?: string; confirmations?: number; block_height?: number };
    if (j?.hash !== txid) throw new Error("ERR_PROVIDER");
    return { conf: Number(j.block_height) > 0 ? Math.max(1, Number(j.confirmations) || 1) : 0 };
  });
  let answered = false, last: unknown = new Error("network");
  for (const f of tries) {
    try { const s = await f(); answered = true; if (s) return s; } catch (e) { last = e; }
  }
  if (answered) return null;
  throw last;
}

type BcTx = { hash?: string; confirmed?: string; received?: string; block_height?: number; inputs?: { addresses?: string[] | null; output_value?: number }[]; outputs?: { addresses?: string[] | null; value?: number }[] };

export function blockcypherToEsplora(txs: unknown): BtcTx[] {
  if (!Array.isArray(txs)) return [];
  return (txs as BcTx[]).flatMap((t) => {
    const txid = String(t?.hash ?? "").toLowerCase();
    if (!TXID.test(txid) || !Array.isArray(t.inputs) || !Array.isArray(t.outputs)) return [];
    const at = Date.parse(String(t.confirmed ?? ""));
    const one = (a?: string[] | null) => (Array.isArray(a) && a.length === 1 ? String(a[0]) : undefined);
    return [{
      txid, status: { confirmed: Number(t.block_height) > 0, block_time: Number.isFinite(at) ? Math.floor(at / 1000) : undefined },
      vin: t.inputs.map((i) => ({ prevout: { scriptpubkey_address: one(i?.addresses), value: Number(i?.output_value) || 0 } })),
      vout: t.outputs.map((o) => ({ scriptpubkey_address: one(o?.addresses), value: Number(o?.value) || 0 })),
    }];
  });
}

export async function utxoHistoryRows(c: UtxoCoin, address: string): Promise<BtcTx[]> {
  if (!isUtxoAddress(c, address)) throw new Error("ERR_ADDRESS");
  const tries: (() => Promise<BtcTx[]>)[] = [];
  if (c.esplora) tries.push(async () => { const j = await hostJson<BtcTx[]>(`${c.esplora}/address/${enc(address)}/txs`, {}, 15_000); if (!Array.isArray(j)) throw new Error("ERR_PROVIDER"); return j; });
  tries.push(async () => blockcypherToEsplora((await hostJson<{ txs?: unknown }>(`${c.blockcypher}/addrs/${enc(address)}/full?limit=25`, {}, 15_000))?.txs));
  return firstOk(tries);
}
