import { NETWORKS, networkById, type Network } from "./chains";
import { ataAddress, formatUnitsStr, SOL, solRpc, WSOL_MINT as WSOL } from "./solbase";
import { hexToTron, TRON, TRON_USDT, tronGet, tronToHex } from "./tronbase";
import { extraById, EXTRA_COINS } from "./natives";
import { DOGE, LTC, utxoHistoryRows, type UtxoCoin } from "./utxobase";
import { xrpRpc } from "./xrpbase";
import type { ActivityItem, CustomToken } from "./store";

export type HistKind = "in" | "out" | "swap" | "self";

export interface Leg { symbol: string; amount: string; price?: string }
export interface HistItem {
  id: string;
  hash: string;
  at: number;
  networkId: string;
  kind: HistKind;
  sent: Leg[];
  got: Leg[];
  party?: string;
  local?: boolean;
  toNetworkId?: string;

  alias?: string;

  pair?: SwapPair;
}
export interface SwapPair { inHash?: string; inAt?: number; inNetworkId?: string; refund?: Leg; refundHash?: string }

export interface KnownToken { symbol: string; decimals: number; price?: string }
export type KnownMap = Map<string, KnownToken>;

export const HISTORY_MAX = 100;
const lc = (s: string | undefined | null) => String(s ?? "").toLowerCase();
const big = (s: unknown): bigint => { try { return BigInt(String(s ?? "0")); } catch { return 0n; } };

export function knownEvm(n: Network, custom: CustomToken[]): KnownMap {
  const m: KnownMap = new Map();
  m.set("native", { symbol: n.native.symbol, decimals: n.chain.nativeCurrency.decimals, price: n.native.coingecko });
  for (const t of n.tokens) m.set(lc(t.address), { symbol: t.symbol, decimals: t.decimals, price: t.coingecko });
  for (const c of custom) if (c.networkId === n.id && !m.has(lc(c.address))) m.set(lc(c.address), { symbol: c.symbol, decimals: c.decimals, price: `${n.cgPlatform}:${lc(c.address)}` });
  return m;
}

export function knownSol(custom: CustomToken[]): KnownMap {
  const m: KnownMap = new Map();
  m.set("native", { symbol: "SOL", decimals: 9, price: SOL.coingecko });
  for (const t of SOL.tokens) m.set(t.address, { symbol: t.symbol, decimals: t.decimals, price: t.coingecko });
  m.set(WSOL, { symbol: "wSOL", decimals: 9, price: SOL.coingecko });
  for (const c of custom) if (c.networkId === SOL.id && !m.has(c.address)) m.set(c.address, { symbol: c.symbol, decimals: c.decimals, price: `${SOL.cgPlatform}:${c.address.toLowerCase()}` });
  return m;
}

export function knownTron(): KnownMap {
  const m: KnownMap = new Map();
  m.set("native", { symbol: "TRX", decimals: 6, price: TRON.coingecko });
  for (const t of TRON.tokens) m.set(t.address, { symbol: t.symbol, decimals: t.decimals, price: t.coingecko });
  return m;
}

type Delta = Map<string, bigint>;

export function classify(delta: Delta, known: KnownMap): { kind: HistKind; sent: Leg[]; got: Leg[] } | null {
  const sent: Leg[] = [], got: Leg[] = [];
  let touched = false;
  for (const [key, v] of delta) {
    const k = known.get(key);
    if (!k) continue;
    touched = true;
    if (v === 0n) continue;
    const leg = { symbol: k.symbol, amount: formatUnitsStr(v < 0n ? -v : v, k.decimals), price: k.price };
    (v < 0n ? sent : got).push(leg);
  }
  if (!touched) return null;
  const kind: HistKind = sent.length && got.length ? "swap" : sent.length ? "out" : got.length ? "in" : "self";
  return { kind, sent, got };
}

export interface EsTx { hash: string; from: string; to: string; value: string; timeStamp: string; isError?: string }
export interface EsTokenTx extends EsTx { contractAddress: string; tokenSymbol?: string; tokenName?: string; tokenDecimal?: string }

export function esResult<T>(j: unknown): T[] {
  const o = (j ?? {}) as { status?: string; message?: string; result?: unknown };
  if (Array.isArray(o.result)) return o.result as T[];
  if (o.status === "0" && /no (transactions|records) found/i.test(String(o.message ?? ""))) return [];
  throw new Error(typeof o.result === "string" ? o.result : o.message || "history");
}

export function parseEvmRows(networkId: string, me: string, known: KnownMap, txs: EsTx[], internal: EsTx[], tokens: EsTokenTx[]): HistItem[] {
  const my = lc(me);
  type G = { at: number; delta: Delta; outTo?: string; inFrom?: string; failed: boolean };
  const groups = new Map<string, G>();
  const g = (hash: string, ts: string) => {
    const h = lc(hash);
    let x = groups.get(h);
    if (!x) { x = { at: Number(ts) * 1000 || 0, delta: new Map(), failed: false }; groups.set(h, x); }
    return x;
  };
  const move = (x: G, key: string, from: string, to: string, raw: bigint) => {
    if (raw <= 0n) return;
    const f = lc(from), t = lc(to);
    if (f !== my && t !== my) return;
    if (!known.has(key)) return;
    let v = x.delta.get(key) ?? 0n;
    if (f === my) { v -= raw; if (t !== my) x.outTo ??= to; }
    if (t === my) { v += raw; if (f !== my) x.inFrom ??= from; }
    x.delta.set(key, v);
  };
  for (const r of txs) {
    const x = g(r.hash, r.timeStamp);
    if (r.isError === "1") { x.failed = true; continue; }
    move(x, "native", r.from, r.to, big(r.value));
  }
  for (const r of internal) { if (r.isError === "1") continue; move(g(r.hash, r.timeStamp), "native", r.from, r.to, big(r.value)); }
  for (const r of tokens) move(g(r.hash, r.timeStamp), lc(r.contractAddress), r.from, r.to, big(r.value));
  const out: HistItem[] = [];
  for (const [hash, x] of groups) {
    if (x.failed && ![...x.delta.values()].some((v) => v !== 0n)) continue;
    const c = classify(x.delta, known);
    if (!c) continue;
    const party = c.kind === "out" ? x.outTo : c.kind === "in" ? x.inFrom : undefined;
    out.push({ id: `${networkId}:${hash}`, hash, at: x.at, networkId, ...c, party: party ? lc(party) : undefined });
  }
  return out;
}

type BsAddr = { hash?: string } | null | undefined;
export function bsTxRows(items: unknown[]): EsTx[] {
  return (items as Record<string, any>[]).map((r) => ({
    hash: r.hash, from: (r.from as BsAddr)?.hash ?? "", to: (r.to as BsAddr)?.hash ?? "", value: String(r.value ?? "0"),
    timeStamp: String(Math.floor(Date.parse(r.timestamp) / 1000) || 0), isError: r.status === "error" || (r.result && r.result !== "success") ? "1" : "0",
  }));
}
export function bsTokenRows(items: unknown[]): EsTokenTx[] {
  return (items as Record<string, any>[])
    .filter((r) => !r.token?.type || r.token.type === "ERC-20")
    .map((r) => ({
      hash: r.transaction_hash ?? r.tx_hash ?? "", from: (r.from as BsAddr)?.hash ?? "", to: (r.to as BsAddr)?.hash ?? "", value: String(r.total?.value ?? "0"),
      timeStamp: String(Math.floor(Date.parse(r.timestamp) / 1000) || 0), contractAddress: r.token?.address_hash ?? r.token?.address ?? "",
      tokenSymbol: typeof r.token?.symbol === "string" ? r.token.symbol : undefined, tokenName: typeof r.token?.name === "string" ? r.token.name : undefined,
    }))
    .filter((r) => r.hash);
}

export const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
export const topicOf = (addr: string) => "0x" + lc(addr).replace(/^0x/, "").padStart(64, "0");
export interface RpcLog { address: string; topics: string[]; data: string; blockNumber: string; transactionHash: string; blockTimestamp?: string }

export function parseLogs(networkId: string, me: string, known: KnownMap, logs: RpcLog[], times: Map<string, number>): HistItem[] {
  const rows: EsTokenTx[] = [];
  for (const l of logs) {
    if (lc(l.topics?.[0]) !== TRANSFER_TOPIC || l.topics.length !== 3 || lc(l.topics[2]) !== topicOf(me)) continue;
    const at = l.blockTimestamp ? Number(big(l.blockTimestamp)) * 1000 : times.get(lc(l.blockNumber)) ?? 0;
    rows.push({ hash: l.transactionHash, from: "0x" + l.topics[1].slice(-40), to: me, value: String(big(l.data === "0x" ? "0" : l.data)), timeStamp: String(Math.floor(at / 1000)), contractAddress: l.address });
  }
  return parseEvmRows(networkId, me, known, [], [], rows);
}

type SolKey = string | { pubkey: string };
type TokBal = { accountIndex: number; mint: string; owner?: string; uiTokenAmount: { amount: string; decimals: number } };
export interface SolTx {
  blockTime?: number | null;
  meta: { err: unknown; fee: number; preBalances: number[]; postBalances: number[]; preTokenBalances?: TokBal[]; postTokenBalances?: TokBal[] } | null;
  transaction: { signatures: string[]; message: { accountKeys: SolKey[]; instructions?: { program?: string; parsed?: { type?: string; info?: Record<string, unknown> } }[] } };
}
const RENT_DUST = 2_100_000n;

export function parseSolTx(me: string, known: KnownMap, tx: SolTx): HistItem | null {
  if (!tx?.meta || tx.meta.err) return null;
  const keys = tx.transaction.message.accountKeys.map((k) => (typeof k === "string" ? k : k.pubkey));
  const delta: Delta = new Map();
  const i = keys.indexOf(me);
  let lamports = 0n;
  if (i >= 0) {
    lamports = BigInt(tx.meta.postBalances[i] ?? 0) - BigInt(tx.meta.preBalances[i] ?? 0);
    if (i === 0) lamports += BigInt(tx.meta.fee);
  }

  const per = new Map<string, bigint>();
  const add = (list: TokBal[] | undefined, sign: 1n | -1n) => {
    for (const b of list ?? []) {
      const owner = b.owner ?? keys[b.accountIndex];
      const k = `${owner}|${b.mint}`;
      per.set(k, (per.get(k) ?? 0n) + sign * big(b.uiTokenAmount.amount));
    }
  };
  add(tx.meta.postTokenBalances, 1n);
  add(tx.meta.preTokenBalances, -1n);
  let party: string | undefined;
  for (const [k, v] of per) {
    const [owner, mint] = k.split("|");
    if (owner !== me || v === 0n || !known.has(mint)) continue;
    delta.set(mint, (delta.get(mint) ?? 0n) + v);
    for (const [k2, v2] of per) { const [o2, m2] = k2.split("|"); if (m2 === mint && o2 !== me && (v2 > 0n) !== (v > 0n) && v2 !== 0n) { party ??= o2; break; } }
  }
  const tokenMoved = delta.size > 0;
  if (lamports !== 0n && !(tokenMoved && (lamports < 0n ? -lamports : lamports) <= RENT_DUST)) delta.set("native", lamports);
  if (!party && !tokenMoved) {
    for (const ix of tx.transaction.message.instructions ?? []) {
      const info = ix.parsed?.info;
      if (ix.program !== "system" || ix.parsed?.type !== "transfer" || !info) continue;
      if (info.source === me && info.destination !== me) { party = String(info.destination); break; }
      if (info.destination === me && info.source !== me) { party = String(info.source); break; }
    }
  }
  const c = classify(delta, known);
  if (!c || (c.kind === "self" && delta.size === 0)) return null;
  const hash = tx.transaction.signatures[0];
  return { id: `${SOL.id}:${hash}`, hash, at: (tx.blockTime ?? 0) * 1000, networkId: SOL.id, ...c, party: c.kind === "in" || c.kind === "out" ? party : undefined };
}

export interface BtcTx { txid: string; status?: { confirmed?: boolean; block_time?: number }; fee?: number; vin: { prevout?: { scriptpubkey_address?: string; value: number } | null }[]; vout: { scriptpubkey_address?: string; value: number }[] }

export function parseBtcTx(me: string, tx: BtcTx, now = Date.now()): HistItem | null {
  return parseUtxoTx(me, tx, { networkId: "bitcoin", symbol: "BTC", price: "bitcoin" }, now);
}

export function parseUtxoTx(me: string, tx: BtcTx, coin: { networkId: string; symbol: string; price: string }, now = Date.now()): HistItem | null {
  if (!tx || typeof tx.txid !== "string" || !Array.isArray(tx.vin) || !Array.isArray(tx.vout)) return null;
  let inMine = 0n, outMine = 0n, outOthers = 0n, party: string | undefined;
  for (const v of tx.vin) if (v.prevout?.scriptpubkey_address === me) inMine += BigInt(v.prevout.value);
  for (const o of tx.vout) {
    if (o.scriptpubkey_address === me) outMine += BigInt(o.value);
    else { outOthers += BigInt(o.value); if (inMine > 0n) party ??= o.scriptpubkey_address; }
  }
  if (inMine === 0n && outMine === 0n) return null;
  let kind: HistKind, amount: bigint;
  if (inMine > 0n) {
    amount = outOthers;
    kind = amount > 0n ? "out" : "self";
  } else {
    amount = outMine;
    kind = "in";
    party = tx.vin.find((v) => v.prevout?.scriptpubkey_address)?.prevout?.scriptpubkey_address;
  }
  const leg = { symbol: coin.symbol, amount: formatUnitsStr(amount, 8), price: coin.price };
  const at = tx.status?.confirmed && tx.status.block_time ? tx.status.block_time * 1000 : now;
  return { id: `${coin.networkId}:${tx.txid}`, hash: tx.txid, at, networkId: coin.networkId, kind, sent: kind === "out" ? [leg] : [], got: kind === "in" ? [leg] : [], party };
}

export const XRP_DUST = 10_000n;
const RIPPLE_EPOCH = 946_684_800;
type XrpTxRow = { tx?: Record<string, unknown>; tx_json?: Record<string, unknown>; meta?: { TransactionResult?: string; delivered_amount?: unknown }; validated?: boolean; hash?: string; date?: number };

export function parseXrpRows(me: string, rows: unknown): HistItem[] {
  if (!Array.isArray(rows)) return [];
  const out: HistItem[] = [];
  for (const r of rows as XrpTxRow[]) {
    const t = (r?.tx_json ?? r?.tx) as Record<string, unknown> | undefined;
    if (!t || r.validated !== true || t.TransactionType !== "Payment" || r.meta?.TransactionResult !== "tesSUCCESS") continue;
    const d = r.meta.delivered_amount;
    if (typeof d !== "string" || !/^\d{1,18}$/.test(d)) continue;
    const amount = BigInt(d), hash = String(r.hash ?? t.hash ?? "");
    if (!/^[0-9A-F]{64}$/i.test(hash) || amount <= 0n) continue;
    const from = String(t.Account ?? ""), to = String(t.Destination ?? "");
    if (from !== me && to !== me) continue;
    const kind: HistKind = from === me && to === me ? "self" : from === me ? "out" : "in";
    if (kind === "in" && amount < XRP_DUST) continue;
    const leg = { symbol: "XRP", amount: formatUnitsStr(amount, 6), price: "ripple" };
    const date = Number(t.date ?? r.date);
    out.push({ id: `xrp:${hash.toUpperCase()}`, hash: hash.toUpperCase(), at: Number.isFinite(date) && date > 0 ? (date + RIPPLE_EPOCH) * 1000 : 0, networkId: "xrp", kind,
      sent: kind === "out" ? [leg] : [], got: kind === "in" ? [leg] : [], party: kind === "out" ? to : kind === "in" ? from : undefined });
  }
  return out;
}

export interface TronTxRow { txID: string; block_timestamp?: number; ret?: { contractRet?: string }[]; raw_data?: { contract?: { type?: string; parameter?: { value?: { amount?: number | string; owner_address?: string; to_address?: string } } }[] } }
export interface TronTrc20Row { transaction_id: string; block_timestamp?: number; from?: string; to?: string; type?: string; value?: string; token_info?: { address?: string } }

export const TRON_DUST = 100_000n;
const tronHexOr = (a: unknown) => { const s = String(a ?? ""); try { return /^T/.test(s) ? tronToHex(s) : s.toLowerCase(); } catch { return ""; } };

export function parseTronRows(me: string, trx: TronTxRow[], trc20: TronTrc20Row[]): HistItem[] {
  const my = tronToHex(me), known = knownTron();
  type G = { at: number; delta: Delta; outTo?: string; inFrom?: string };
  const groups = new Map<string, G>();
  const g = (id: string, at?: number) => { const k = lc(id); let x = groups.get(k); if (!x) { x = { at: Number(at) || 0, delta: new Map() }; groups.set(k, x); } return x; };
  const move = (x: G, key: string, from: string, to: string, raw: bigint) => {
    if (raw <= 0n || !known.has(key)) return;
    const f = tronHexOr(from), t = tronHexOr(to);
    if (f !== my && t !== my) return;
    if (t === my && f !== my && raw < TRON_DUST) return;
    let v = x.delta.get(key) ?? 0n;
    if (f === my) { v -= raw; if (t !== my) x.outTo ??= to; }
    if (t === my) { v += raw; if (f !== my) x.inFrom ??= from; }
    x.delta.set(key, v);
  };
  for (const r of trx) {
    const c = r.raw_data?.contract?.[0];
    if (!r.txID || c?.type !== "TransferContract" || (r.ret?.[0]?.contractRet && r.ret[0].contractRet !== "SUCCESS")) continue;
    const v = c.parameter?.value ?? {};
    move(g(r.txID, r.block_timestamp), "native", String(v.owner_address ?? ""), String(v.to_address ?? ""), big(v.amount));
  }
  for (const r of trc20) {
    if (!r.transaction_id || r.type !== "Transfer" || r.token_info?.address !== TRON_USDT) continue;
    move(g(r.transaction_id, r.block_timestamp), TRON_USDT, String(r.from ?? ""), String(r.to ?? ""), big(r.value));
  }
  const toT = (a?: string) => { if (!a) return undefined; try { return /^T/.test(a) ? a : hexToTron(a); } catch { return undefined; } };
  const out: HistItem[] = [];
  for (const [hash, x] of groups) {
    const c = classify(x.delta, known);
    if (!c || (c.kind === "self" && x.delta.size === 0)) continue;
    const party = c.kind === "out" ? toT(x.outTo) : c.kind === "in" ? toT(x.inFrom) : undefined;
    out.push({ id: `${TRON.id}:${hash}`, hash, at: x.at, networkId: TRON.id, ...c, party });
  }
  return out;
}

export function fromLocal(a: ActivityItem, custom: CustomToken[] = []): HistItem {
  const swap = a.kind === "swap" || a.asset.includes("→");
  const [fromSym, toSym] = swap ? a.asset.split("→").map((s) => s.trim()) : [a.asset, ""];
  const hash = a.hash.startsWith("0x") ? lc(a.hash) : a.hash;
  const n = networkById(a.networkId);
  const x = extraById(a.networkId);
  const known = n ? knownEvm(n, custom) : a.networkId === SOL.id ? knownSol(custom) : a.networkId === TRON.id ? knownTron()
    : a.networkId === "ton" ? new Map<string, KnownToken>([["native", { symbol: "TON", decimals: 9, price: "the-open-network" }], ["usdt", { symbol: "USDT", decimals: 6, price: "tether" }]])
    : new Map<string, KnownToken>([["native", x ? { symbol: x.symbol, decimals: x.decimals, price: x.coingecko } : { symbol: "BTC", decimals: 8, price: "bitcoin" }]]);
  const price = (sym: string) => [...known.values()].find((k) => k.symbol === sym)?.price;
  return {
    id: `${a.networkId}:${hash}`, hash: a.hash, at: a.at, networkId: a.networkId, kind: swap ? "swap" : "out",
    sent: [{ symbol: fromSym, amount: a.amount, price: price(fromSym) }], got: swap && toSym ? [{ symbol: toSym, amount: "", price: price(toSym) }] : [],
    party: swap ? undefined : a.to, local: true, toNetworkId: a.toNetworkId,
  };
}

export function ownLocal(records: ActivityItem[], mine: Addresses, chain: HistItem[], custom: CustomToken[] = []): HistItem[] {
  const me = new Set([lc(mine.evm), mine.sol, mine.btc, ...[mine.tron, mine.doge, mine.ltc, mine.xrp, mine.ada, mine.ton, ...(mine.extra ?? [])].filter((v): v is string => !!v)]);
  const ids = new Set(chain.map((x) => x.id));
  return records.map((a) => ({ a, x: fromLocal(a, custom) }))
    .filter(({ a, x }) => (a.from ? me.has(a.from.startsWith("0x") ? lc(a.from) : a.from) : ids.has(x.id)))
    .map(({ x }) => x);
}

export function mergeHistory(chain: HistItem[], local: HistItem[], max = HISTORY_MAX): HistItem[] {
  const byId = new Map<string, HistItem>();
  for (const x of chain) if (!byId.has(x.id)) byId.set(x.id, x);
  const aliased = new Set(chain.filter((x) => x.alias).map((x) => `${x.networkId}:${x.alias}`));
  for (const x of local) {
    if (aliased.has(x.id)) continue;
    const c = byId.get(x.id);
    if (!c) byId.set(x.id, x);
    else if (x.toNetworkId && !c.toNetworkId) byId.set(x.id, { ...c, toNetworkId: x.toNetworkId });
  }
  return [...byId.values()].sort((a, b) => b.at - a.at).slice(0, max);
}

export function pairSwaps(list: HistItem[], records: ActivityItem[], custom: CustomToken[] = []): HistItem[] {
  const out = new Map(list.map((x) => [x.id, x] as const));
  const used = new Set<string>();
  const recs = records.filter((r) => r.kind === "swap" && !!r.toNetworkId && r.toNetworkId !== r.networkId && r.asset.includes("→")).sort((p, q) => p.at - q.at);
  for (const r of recs) {
    const id = `${r.networkId}:${r.hash.startsWith("0x") ? lc(r.hash) : r.hash}`;
    const pay = out.get(id);
    if (!pay || pay.kind === "in" || pay.pair) continue;
    const [a, b] = r.asset.split("→").map((s) => s.trim());
    const start = Math.min(pay.at, r.at) - 60_000, end = start + 6 * 3_600_000;
    const within = (x: HistItem) => !used.has(x.id) && x.kind === "in" && x.at >= start && x.at <= end;

    const inBand = (x: HistItem) => {
      if (!r.outMin && !r.outEst) return true;
      const v = Number(x.got[0]?.amount), lo = Number(r.outMin ?? 0) * 0.97, hi = r.outEst ? Number(r.outEst) * 1.05 : Infinity;
      return Number.isFinite(v) && v >= lo && v <= hi;
    };
    const sameParty = (x: HistItem) => !!x.party && !!r.to && (r.to.startsWith("0x") ? lc(x.party) === lc(r.to) : x.party === r.to);
    const refund = list.find((x) => within(x) && x.networkId === r.networkId && x.got[0]?.symbol === a && sameParty(x));

    const paid = Number(pay.sent[0]?.amount ?? r.amount), back = Number(refund?.got[0]?.amount);
    const refundedWhole = !!refund && Number.isFinite(paid) && paid > 0 && Number.isFinite(back) && back >= paid * 0.5;
    const arrive = refundedWhole ? undefined : list.filter((x) => within(x) && x.networkId === r.toNetworkId && x.got[0]?.symbol === b && inBand(x)).sort((p, q) => p.at - q.at)[0];
    for (const x of [arrive, refund]) if (x) { used.add(x.id); out.delete(x.id); }
    const local = fromLocal(r, custom);
    out.set(id, {
      ...pay, kind: "swap", toNetworkId: r.toNetworkId,
      sent: pay.sent.length ? pay.sent : local.sent,
      got: arrive ? arrive.got : local.got,
      pair: { inHash: arrive?.hash, inAt: arrive?.at, inNetworkId: arrive?.networkId, refund: refund?.got[0], refundHash: refund?.hash },
    });
  }
  return [...out.values()].sort((p, q) => q.at - p.at);
}

export type HistFilter = "all" | "in" | "out" | "swap";
export const filterHistory = (list: HistItem[], f: HistFilter) => (f === "all" ? list : list.filter((x) => (f === "out" ? x.kind === "out" || x.kind === "self" : x.kind === f)));

export function groupByDay(list: HistItem[], now = Date.now()): { day: string; items: HistItem[] }[] {
  const key = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  const today = key(now), yesterday = key(y.getTime());
  const out: { day: string; items: HistItem[] }[] = [];
  for (const x of list) {
    const k = key(x.at), day = k === today ? "today" : k === yesterday ? "yesterday" : k;
    const last = out[out.length - 1];
    if (last && last.day === day) last.items.push(x); else out.push({ day, items: [x] });
  }
  return out;
}

const TIMEOUT = 15_000;
async function getJson(url: string): Promise<unknown> {
  const r = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(TIMEOUT), referrerPolicy: "no-referrer" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

export const PROXY = "https://madarwallet.app/wallet-api/history";
const PROXY_NETS: Record<string, number> = { ethereum: 1, arbitrum: 42161, polygon: 137 };
const BLOCKSCOUT: Record<string, string> = {
  optimism: "https://explorer.optimism.io/api/v2",

  celo: "https://celo.blockscout.com/api/v2", zksync: "https://zksync.blockscout.com/api/v2", unichain: "https://unichain.blockscout.com/api/v2",
};

const LOG_NETS = ["base", "bsc", "avalanche", "scroll", "mantle", "sonic", "gnosis", "berachain", "opbnb", "blast"];
const LOG_WINDOW = 20_000n, LOG_CHUNK = 5_000n;

let proxyChain: Promise<unknown> = Promise.resolve();
const PROXY_GAP_MS = 400;
function proxyCall(url: string): Promise<unknown> {
  const run = async () => {
    for (let attempt = 0; ; attempt++) {
      const j = (await getJson(url)) as { status?: string; result?: unknown };
      const limited = j?.status === "0" && /rate limit/i.test(String(j.result ?? ""));
      if (!limited || attempt >= 4) return j;
      await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
    }
  };
  const p = proxyChain.then(run, run);
  proxyChain = p.then(() => new Promise((r) => setTimeout(r, PROXY_GAP_MS)), () => new Promise((r) => setTimeout(r, PROXY_GAP_MS)));
  return p;
}

async function proxyHistory(n: Network, me: string, known: KnownMap): Promise<HistItem[]> {
  const q = (action: string) => proxyCall(`${PROXY}?${new URLSearchParams({ chainid: String(PROXY_NETS[n.id]), action, address: me, page: "1", offset: "50", sort: "desc" })}`);
  const tokens = esResult<EsTokenTx>(await q("tokentx"));
  const txs = esResult<EsTx>(await q("txlist"));
  const internal = esResult<EsTx>(await q("txlistinternal"));
  return parseEvmRows(n.id, me, known, txs, internal, tokens);
}

async function blockscoutHistory(n: Network, me: string, known: KnownMap): Promise<HistItem[]> {
  const api = BLOCKSCOUT[n.id];
  const [tr, tx] = await Promise.all([getJson(`${api}/addresses/${me}/token-transfers`), getJson(`${api}/addresses/${me}/transactions`)]);
  const items = (j: unknown) => ((j as { items?: unknown[] })?.items ?? []);
  return parseEvmRows(n.id, me, known, bsTxRows(items(tx)), [], bsTokenRows(items(tr)));
}

export const ROUTESCAN: Record<string, number> = { avalanche: 43114 };
const ROUTESCAN_API = "https://api.routescan.io/v2/network/mainnet/evm";

export async function tokenTransferRows(n: Network, me: string): Promise<EsTokenTx[] | null> {
  const q = { module: "account", action: "tokentx", address: me, page: "1", offset: "50", sort: "desc" };
  if (PROXY_NETS[n.id]) return esResult<EsTokenTx>(await proxyCall(`${PROXY}?${new URLSearchParams({ chainid: String(PROXY_NETS[n.id]), action: q.action, address: me, page: q.page, offset: q.offset, sort: q.sort })}`));
  if (BLOCKSCOUT[n.id]) return bsTokenRows(((await getJson(`${BLOCKSCOUT[n.id]}/addresses/${me}/token-transfers?type=ERC-20`)) as { items?: unknown[] })?.items ?? []);
  if (ROUTESCAN[n.id]) return esResult<EsTokenTx>(await getJson(`${ROUTESCAN_API}/${ROUTESCAN[n.id]}/etherscan/api?${new URLSearchParams(q)}`));
  return null;
}

async function rpc<T>(n: Network, method: string, params: unknown[]): Promise<T> {
  let last: unknown;
  for (const url of n.rpcs) {
    try {
      const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(TIMEOUT) });
      if (!r.ok) { last = new Error(`HTTP ${r.status}`); continue; }
      const j = await r.json();
      if (j.error) { last = new Error(j.error.message ?? "rpc"); continue; }
      return j.result as T;
    } catch (e) { last = e; }
  }
  throw last instanceof Error ? last : new Error("rpc");
}

type LogCache = { block: string; items: HistItem[]; toks?: string[] };
const cacheKey = (me: string) => `histLogs:${lc(me)}`;

async function logHistory(n: Network, me: string, known: KnownMap): Promise<HistItem[]> {
  const store = chrome.storage.local;
  const all = ((await store.get(cacheKey(me)))[cacheKey(me)] as Record<string, LogCache> | undefined) ?? {};
  const prev = all[n.id];
  const kept = prev?.items ?? [];
  const tokens = [...known.keys()].filter((k) => k !== "native");
  if (!tokens.length) return kept;
  const latest = big(await rpc<string>(n, "eth_blockNumber", []));
  let from = latest > LOG_WINDOW ? latest - LOG_WINDOW : 0n;
  const covered = !prev?.toks || tokens.every((t) => prev.toks!.includes(t));
  if (prev && covered && big(prev.block) + 1n > from) from = big(prev.block) + 1n;
  const logs: RpcLog[] = [];
  let done = from - 1n;
  let stuck: unknown = null;
  for (let a = from; a <= latest; a += LOG_CHUNK) {
    const b = a + LOG_CHUNK - 1n < latest ? a + LOG_CHUNK - 1n : latest;
    try {
      logs.push(...await rpc<RpcLog[]>(n, "eth_getLogs", [{ fromBlock: "0x" + a.toString(16), toBlock: "0x" + b.toString(16), address: tokens, topics: [TRANSFER_TOPIC, null, topicOf(me)] }]));
      done = b;
    } catch (e) { if (done < from) stuck = e; break; }
  }
  const times = new Map<string, number>();
  const need = [...new Set(logs.filter((l) => !l.blockTimestamp).map((l) => lc(l.blockNumber)))].slice(0, 25);
  await Promise.all(need.map(async (bn) => {
    try { const blk = await rpc<{ timestamp: string } | null>(n, "eth_getBlockByNumber", [bn, false]); if (blk) times.set(bn, Number(big(blk.timestamp)) * 1000); } catch {  }
  }));
  const found = parseLogs(n.id, me, known, logs, times).filter((x) => x.at > 0);
  const items = mergeHistory(found, kept, 50);
  if (done >= from) await store.set({ [cacheKey(me)]: { ...all, [n.id]: { block: done.toString(), items, toks: tokens } } });

  if (stuck) throw Object.assign(new Error("history not refreshed"), { items });
  return items;
}

export async function solTokenAccounts(owner: string, custom: CustomToken[]): Promise<string[]> {
  const mints = [...new Set([...SOL_SIG_MINTS, ...custom.filter((c) => c.networkId === SOL.id).map((c) => c.address as string)])];
  return mints.map((m) => ataAddress(owner, m));
}
const SOL_SIG_MINTS = ["EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", WSOL];

type SigInfo = { signature: string; err: unknown; blockTime?: number | null };

export function mergeSignatures(lists: SigInfo[][], limit = SOL_SIG_LIMIT): string[] {
  const seen = new Map<string, SigInfo>();
  for (const l of lists) for (const s of l) if (!s.err && !seen.has(s.signature)) seen.set(s.signature, s);
  return [...seen.values()].sort((a, b) => (b.blockTime ?? 0) - (a.blockTime ?? 0)).slice(0, limit).map((s) => s.signature);
}
const SOL_SIG_LIMIT = 30;

async function solHistory(me: string, known: KnownMap, custom: CustomToken[]): Promise<HistItem[]> {

  const accounts = [me, ...await solTokenAccounts(me, custom)];
  const lists: SigInfo[][] = [];
  for (const a of accounts) lists.push(await solRpc<SigInfo[]>("getSignaturesForAddress", [a, { limit: 25 }]).catch((e) => { if (a === me) throw e; return []; }));
  const out: HistItem[] = [];
  const list = mergeSignatures(lists);
  for (let i = 0; i < list.length; i += 5) {
    const txs = await Promise.all(list.slice(i, i + 5).map((s) => solRpc<SolTx | null>("getTransaction", [s, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "confirmed" }]).catch(() => null)));
    for (const tx of txs) { const x = tx && parseSolTx(me, known, tx); if (x) out.push(x); }
  }
  return out;
}

async function btcHistory(me: string): Promise<HistItem[]> {
  let last: unknown;
  for (const base of ["https://mempool.space/api", "https://blockstream.info/api"]) {
    try { return ((await getJson(`${base}/address/${me}/txs`)) as BtcTx[]).map((t) => parseBtcTx(me, t)).filter((x): x is HistItem => !!x); }
    catch (e) { last = e; }
  }
  throw last;
}

async function tronHistory(me: string): Promise<HistItem[]> {

  const tokens = await tronGet<{ data?: TronTrc20Row[]; success?: boolean }>(`/v1/accounts/${me}/transactions/trc20?limit=30&contract_address=${TRON_USDT}&only_confirmed=true`);
  const txs = await tronGet<{ data?: TronTxRow[]; success?: boolean }>(`/v1/accounts/${me}/transactions?limit=30&only_confirmed=true`);
  if (tokens?.success === false || txs?.success === false) throw new Error("history");
  return parseTronRows(me, txs?.data ?? [], tokens?.data ?? []);
}

async function utxoHistory(c: UtxoCoin, me: string): Promise<HistItem[]> {
  const coin = { networkId: c.id, symbol: c.symbol, price: c.coingecko };
  return (await utxoHistoryRows(c, me)).map((t) => parseUtxoTx(me, t, coin)).filter((x): x is HistItem => !!x);
}
async function xrpHistory(me: string): Promise<HistItem[]> {
  try {
    const r = await xrpRpc<{ account?: string; transactions?: unknown[] }>("account_tx", { account: me, limit: 30, ledger_index_min: -1, ledger_index_max: -1, forward: false, api_version: 1 }, { timeoutMs: 15_000 });
    if (r.account !== me) throw new Error("history");
    return parseXrpRows(me, r.transactions);
  } catch (e) {
    if ((e as { code?: string })?.code === "actNotFound") return [];
    throw e;
  }
}

export interface Addresses { evm: string; sol: string; btc: string; tron?: string; doge?: string; ltc?: string; xrp?: string; ton?: string; ada?: string;  extra?: string[] }
export interface HistoryResult { items: HistItem[]; failed: string[] }

export async function loadChainHistory(a: Addresses, custom: CustomToken[], nets: readonly Network[] = NETWORKS): Promise<HistoryResult> {
  const failed: string[] = [];
  const jobs: Promise<HistItem[]>[] = [];

  const run = (name: string, p: () => Promise<HistItem[]>) => jobs.push(p().catch((e: unknown) => { failed.push(name); const kept = (e as { items?: unknown })?.items; return Array.isArray(kept) ? (kept as HistItem[]) : []; }));
  for (const n of nets) {
    const known = knownEvm(n, custom);
    if (PROXY_NETS[n.id]) run(n.name, () => proxyHistory(n, a.evm, known));
    else if (BLOCKSCOUT[n.id]) run(n.name, () => blockscoutHistory(n, a.evm, known));
    else if (LOG_NETS.includes(n.id)) run(n.name, () => logHistory(n, a.evm, known));
  }

  if (a.sol) run(SOL.name, () => solHistory(a.sol, knownSol(custom), custom));
  if (a.btc) run("Bitcoin", () => btcHistory(a.btc));
  if (a.tron) run(TRON.name, () => tronHistory(a.tron!));
  if (a.doge) run(DOGE.name, () => utxoHistory(DOGE, a.doge!));
  if (a.ltc) run(LTC.name, () => utxoHistory(LTC, a.ltc!));
  if (a.xrp) run(EXTRA_COINS.find((c) => c.id === "xrp")!.name, () => xrpHistory(a.xrp!));
  if (a.ton) run("TON", () => import("./tonhistory").then((m) => m.tonHistory(a.ton!)));
  if (a.ada) run("Cardano", () => import("./adahistory").then((m) => m.adaHistory(a.ada!)));
  const items = (await Promise.all(jobs)).flat();
  return { items: mergeHistory(items, [], HISTORY_MAX * 2), failed };
}

const resultKey = (evm: string) => `history:${lc(evm)}`;
export async function cachedHistory(evm: string): Promise<{ at: number; items: HistItem[] } | null> {
  return ((await chrome.storage.local.get(resultKey(evm)))[resultKey(evm)] as { at: number; items: HistItem[] } | undefined) ?? null;
}
export async function saveHistory(evm: string, items: HistItem[]): Promise<void> {
  await chrome.storage.local.set({ [resultKey(evm)]: { at: Date.now(), items: items.slice(0, HISTORY_MAX * 2) } });
}

export function filterByCoin(items: HistItem[], coin: { price?: string; symbol: string; netIds: string[] }): HistItem[] {
  const onNet = (x: HistItem) => coin.netIds.includes(x.networkId) || (x.toNetworkId != null && coin.netIds.includes(x.toNetworkId));
  return items.filter((x) => [...x.sent, ...x.got].some((l) => (coin.price && l.price ? l.price === coin.price : l.symbol === coin.symbol && onNet(x))));
}
