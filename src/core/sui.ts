import { ed25519 } from "@noble/curves/ed25519.js";
import { blake2b } from "@noble/hashes/blake2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { base58, base64 } from "@scure/base";
import type { PendingPayment } from "./store";
import { bigOf, concat, kitErr, leU, sameBytes, uleb, type KitEnd, type KitSubmit, type SendKit } from "./sendkit";
import { formatSui, isSuiAddress, MIST_MAX, parseSui, SUI, SUI_COIN, suiAddress, suiAddressOf, suiBalances, SuiGqlError, suiGql, suiPublicKey, suiSecret, suiTxUrl } from "./suibase";
export * from "./suibase";

export const MAX_SUI_FEE = 50_000_000n;

export const GAS_SAFE_OVERHEAD = 1000n;

export const MAX_GAS_COINS = 255;
const U64_MAX = (1n << 64n) - 1n;

export interface SuiCoinRef { id: string; version: bigint; digest: string; balance: bigint }
export interface SuiTransfer { sender: string; to: string; amount: bigint; payment: SuiCoinRef[]; price: bigint; budget: bigint }

const addr32 = (a: string) => { if (!isSuiAddress(a)) throw kitErr("ERR_UNSAFE"); return hexToBytes(a.slice(2)); };
const u16 = (n: number) => [n & 0xff, (n >> 8) & 0xff];

export function serializeSuiTransfer(t: SuiTransfer): Uint8Array {
  if (t.amount <= 0n || t.amount > MIST_MAX || t.price <= 0n || t.budget <= 0n || t.budget > U64_MAX || t.price > U64_MAX) throw kitErr("ERR_UNSAFE");
  if (!t.payment.length || t.payment.length > MAX_GAS_COINS + 1) throw kitErr("ERR_UNSAFE");
  const refs = t.payment.flatMap((p) => {
    const d = base58.decode(p.digest);
    if (d.length !== 32 || p.version <= 0n || p.version > U64_MAX) throw kitErr("ERR_UNSAFE");
    return [...addr32(p.id), ...leU(p.version, 8), ...uleb(32), ...d];
  });
  return concat(
    [0, 0],
    uleb(2), [0, ...uleb(8), ...leU(t.amount, 8)], [0, ...uleb(32), ...addr32(t.to)],
    uleb(2),
    [2, 0, ...uleb(1), 1, ...u16(0)],
    [1, ...uleb(1), 3, ...u16(0), ...u16(0), 1, ...u16(1)],
    addr32(t.sender),
    uleb(t.payment.length), refs, addr32(t.sender), leU(t.price, 8), leU(t.budget, 8),
    [0],
  );
}
const enc = (s: string) => new TextEncoder().encode(s);
export const suiDigest = (tx: Uint8Array) => base58.encode(blake2b(concat(enc("TransactionData::"), tx), { dkLen: 32 }));

export function signSuiTx(tx: Uint8Array, sender: string, secret: Uint8Array): { signature: string; digest: string } {
  const pub = suiPublicKey(secret);
  if (suiAddressOf(pub) !== sender) throw kitErr("ERR_UNSAFE");
  const msg = blake2b(concat([0, 0, 0], tx), { dkLen: 32 });
  const sig = ed25519.sign(msg, secret);
  if (sig.length !== 64 || !ed25519.verify(sig, msg, pub)) throw kitErr("ERR_UNSAFE");
  return { signature: base64.encode(concat([0], sig, pub)), digest: suiDigest(tx) };
}

export function readSuiCoins(res: unknown): { coins: SuiCoinRef[]; next: string | null } {
  const o = (res as { address?: { objects?: { pageInfo?: { hasNextPage?: unknown; endCursor?: unknown }; nodes?: unknown } } | null })?.address?.objects;
  if (o == null) return { coins: [], next: null };
  if (!Array.isArray(o.nodes)) throw kitErr("ERR_PROVIDER");
  const coins = o.nodes.map((n: { address?: unknown; version?: unknown; digest?: unknown; contents?: { bcs?: unknown } }) => {
    const id = String(n?.address ?? ""), v = bigOf(n?.version, U64_MAX), d = String(n?.digest ?? "");
    let raw: Uint8Array;
    try { raw = base64.decode(String(n?.contents?.bcs ?? "")); } catch { throw kitErr("ERR_PROVIDER"); }
    if (!isSuiAddress(id) || v == null || v <= 0n || raw.length !== 40 || bytesToHex(raw.slice(0, 32)) !== id.slice(2)) throw kitErr("ERR_PROVIDER");
    try { if (base58.decode(d).length !== 32) throw 0; } catch { throw kitErr("ERR_PROVIDER"); }
    let bal = 0n;
    for (let i = 7; i >= 0; i--) bal = (bal << 8n) | BigInt(raw[32 + i]);
    return { id, version: v, digest: d, balance: bal };
  });
  const next = o.pageInfo?.hasNextPage === true && typeof o.pageInfo.endCursor === "string" ? o.pageInfo.endCursor : null;
  return { coins, next };
}
const COINS_Q = `query($a:SuiAddress!,$c:String){ address(address:$a){ objects(first:50, after:$c, filter:{type:"0x2::coin::Coin<${SUI_COIN}>"}){ pageInfo{ hasNextPage endCursor } nodes{ address version digest contents{ bcs } } } } }`;

export async function suiCoins(owner: string): Promise<SuiCoinRef[]> {
  const all: SuiCoinRef[] = [];
  let c: string | null = null;
  for (let i = 0; i < 6; i++) {
    const p = readSuiCoins(await suiGql(COINS_Q, { a: owner, c }));
    all.push(...p.coins);
    if (!p.next) break;
    c = p.next;
  }
  return all.sort((a, b) => (a.balance === b.balance ? 0 : a.balance > b.balance ? -1 : 1)).slice(0, MAX_GAS_COINS);
}
export async function suiGasPrice(): Promise<bigint> {
  const p = bigOf((await suiGql<{ epoch?: { referenceGasPrice?: unknown } }>("{ epoch { referenceGasPrice } }")).epoch?.referenceGasPrice, 100_000n);
  if (p == null || p <= 0n) throw kitErr("ERR_PROVIDER");
  return p;
}
type Effects = { status?: unknown; gasEffects?: { gasSummary?: { computationCost?: unknown; storageCost?: unknown; storageRebate?: unknown } } } | null | undefined;

export function suiBudgetOf(eff: Effects, price: bigint): bigint {
  const g = eff?.gasEffects?.gasSummary;
  const comp = bigOf(g?.computationCost, U64_MAX), st = bigOf(g?.storageCost, U64_MAX), reb = bigOf(g?.storageRebate, U64_MAX);
  if (eff?.status !== "SUCCESS" || comp == null || st == null || reb == null) throw kitErr("ERR_PROVIDER");
  const base = comp + GAS_SAFE_OVERHEAD * price;
  const b = base + st - reb > base ? base + st - reb : base;
  const budget = b + b / 10n;
  if (budget > MAX_SUI_FEE) throw kitErr("ERR_FEE_HIGH", { fee: budget });
  return budget;
}
export async function suiDryRun(tx: Uint8Array): Promise<Effects> {
  const r = await suiGql<{ simulateTransaction?: { effects?: Effects } }>(
    `query($t:JSON!){ simulateTransaction(transaction:$t){ effects{ status gasEffects{ gasSummary{ computationCost storageCost storageRebate } } } } }`,
    { t: { bcs: { value: base64.encode(tx) } } });
  return r.simulateTransaction?.effects;
}

export interface SuiQuote { from: string; to: string; amount: bigint; fee: bigint; price: bigint; coins: bigint }

export function suiRecipient(input: string): string {
  const v = String(input ?? "").trim().toLowerCase();
  if (!isSuiAddress(v)) throw kitErr("ERR_ADDRESS");
  return v;
}

export function checkSuiFunds(amount: bigint, fee: bigint, coins: bigint): void {
  if (amount <= 0n) throw kitErr("ERR_ZERO");
  if (amount + fee > coins) { const max = coins - fee; throw kitErr("ERR_FUNDS", { max: max > 0n ? max : 0n }); }
}
async function budgetFor(from: string, to: string, amount: bigint, coins: SuiCoinRef[], price: bigint): Promise<bigint> {
  const have = coins.reduce((s, c) => s + c.balance, 0n);
  const room = have - amount;
  if (room <= 0n) throw kitErr("ERR_FUNDS", { max: 0n });
  const trial = room < MAX_SUI_FEE ? room : MAX_SUI_FEE;
  return suiBudgetOf(await suiDryRun(serializeSuiTransfer({ sender: from, to, amount, payment: coins, price, budget: trial })), price);
}
export async function quoteSuiSend(phrase: string, index: number, toInput: string, amountText: string): Promise<SuiQuote> {
  const from = suiAddress(phrase, index), to = suiRecipient(toInput), amount = parseSui(amountText);
  if (amount <= 0n) throw kitErr("ERR_ZERO");
  if (to === from) throw kitErr("ERR_SELF");
  const [coins, price] = await Promise.all([suiCoins(from), suiGasPrice()]);
  const have = coins.reduce((s, c) => s + c.balance, 0n);
  if (!coins.length) { const b = await suiBalances(from); throw kitErr(b.addressBalance > 0n ? "ERR_KIT_COINS" : "ERR_KIT_INACTIVE"); }
  if (amount >= have) throw kitErr("ERR_FUNDS", { max: have > MAX_SUI_FEE / 10n ? have - MAX_SUI_FEE / 10n : 0n });
  const fee = await budgetFor(from, to, amount, coins, price);
  checkSuiFunds(amount, fee, have);
  return { from, to, amount, fee, price, coins: have };
}

export async function suiSpendable(phrase: string, index: number): Promise<bigint> {
  const from = suiAddress(phrase, index);
  const [coins, price] = await Promise.all([suiCoins(from), suiGasPrice()]);
  if (!coins.length) return 0n;
  const have = coins.reduce((s, c) => s + c.balance, 0n);
  const fee = await budgetFor(from, "0x" + "5".repeat(64), 1n, coins, price);
  return have > fee ? have - fee : 0n;
}

export interface SuiSigned { from: string; to: string; amount: bigint; fee: bigint; hash: string; tx: string; signature: string; payment: { id: string; version: string }[] }

export async function signSuiSend(phrase: string, index: number, q: SuiQuote, o: { coins?: (a: string) => Promise<SuiCoinRef[]> } = {}): Promise<SuiSigned> {
  const secret = suiSecret(phrase, index), from = suiAddressOf(suiPublicKey(secret));
  if (from !== q.from || q.fee > MAX_SUI_FEE || q.amount <= 0n || q.to === q.from || !isSuiAddress(q.to)) throw kitErr("ERR_UNSAFE");
  const coins = await (o.coins ?? suiCoins)(from);
  checkSuiFunds(q.amount, q.fee, coins.reduce((s, c) => s + c.balance, 0n));
  const tx = serializeSuiTransfer({ sender: from, to: q.to, amount: q.amount, payment: coins, price: q.price, budget: q.fee });
  const s = signSuiTx(tx, from, secret);
  return { from, to: q.to, amount: q.amount, fee: q.fee, hash: s.digest, tx: base64.encode(tx), signature: s.signature, payment: coins.map((c) => ({ id: c.id, version: c.version.toString() })) };
}

const statusOf = (eff: Effects): KitEnd => (eff?.status === "SUCCESS" ? { state: "ok" } : eff?.status === "FAILURE" ? { state: "failed", code: "FAILURE" } : { state: "pending" });

export const suiRefusal = (msgs: string[]) => msgs.find((m) => /insufficient|GasBalanceTooLow|budget|not available for consumption|ObjectVersionUnavailable|ObjectNotFound|deserializ|invalid|signature|does not exist/i.test(m) && !/timeout|timed out|unavailable|overload|internal/i.test(m)) ?? null;

export async function lookupSui(s: Pick<SuiSigned, "hash" | "from">): Promise<KitEnd | null> {
  const r = await suiGql<{ transaction?: { digest?: unknown; sender?: { address?: unknown } | null; effects?: Effects } | null }>(`query($d:String!){ transaction(digest:$d){ digest sender{ address } effects{ status } } }`, { d: s.hash });
  const t = r.transaction;
  if (!t) return null;
  if (t.digest !== s.hash || (t.sender && t.sender.address !== s.from)) throw kitErr("ERR_UNSAFE");
  return statusOf(t.effects);
}
export async function submitSui(s: SuiSigned): Promise<KitSubmit> {
  try {
    const r = await suiGql<{ executeTransaction?: { effects?: (Effects & { digest?: unknown }) | null } }>(
      `mutation($tx:Base64!,$sig:[Base64!]!){ executeTransaction(transactionDataBcs:$tx, signatures:$sig){ effects{ digest status } } }`,
      { tx: s.tx, sig: [s.signature] }, { timeoutMs: 45_000, retry: false });
    const eff = r.executeTransaction?.effects;
    if (eff && eff.digest !== s.hash) throw kitErr("ERR_UNSAFE");
    const end = statusOf(eff);
    if (end.state === "ok" || end.state === "failed") return end;
  } catch (e) {
    const why = e instanceof SuiGqlError ? suiRefusal(e.messages) : null;
    if (why) {
      const seen = await lookupSui(s).catch(() => undefined);
      if (seen === null) return { state: "refused", code: why.slice(0, 120) };
    }
  }
  const end = await lookupSui(s).catch(() => null);
  return end?.state === "ok" ? { state: "ok" } : end?.state === "failed" ? end : { state: "unknown" };
}

export function suiCoinsMoved(res: unknown, payment: { id: string; version: string }[]): boolean | null {
  const r = res as Record<string, { address?: unknown; version?: unknown } | null> | null;
  if (!r || typeof r !== "object") return null;
  return payment.some((p, i) => { const o = r[`o${i}`]; return !o || String(o.version) !== p.version; });
}
async function coinsMoved(s: SuiSigned): Promise<boolean | null> {
  const parts = s.payment.slice(0, 50).map((p, i) => `o${i}: object(address:"${p.id}"){ address version }`);
  if (s.payment.some((p) => !isSuiAddress(p.id))) return null;
  return suiCoinsMoved(await suiGql(`{ ${parts.join(" ")} }`), s.payment.slice(0, 50));
}

export async function waitSui(s: SuiSigned, signedAt: number, o: { maxMs?: number; everyMs?: number } = {}): Promise<KitEnd> {
  const until = Date.now() + (o.maxMs ?? 30_000), every = o.everyMs ?? 3_000;
  for (;;) {
    const end = await lookupSui(s).catch(() => undefined);
    if (end && end.state !== "pending") return end;
    if (end === null && Date.now() - signedAt > 60_000 && (await coinsMoved(s).catch(() => null)) === true && (await lookupSui(s).catch(() => undefined)) === null) return { state: "dropped" };
    if (Date.now() + every > until) return { state: "pending" };
    await new Promise((r) => setTimeout(r, every));
  }
}

export const suiPendingOf = (s: SuiSigned): Omit<PendingPayment, "at"> => ({
  networkId: SUI.id, from: s.from, hash: s.hash,
  data: { to: s.to, amount: s.amount.toString(), fee: s.fee.toString(), tx: s.tx, signature: s.signature, payment: JSON.stringify(s.payment) },
});

export function suiSignedOf(p: PendingPayment | null): SuiSigned | null {
  if (!p || p.networkId !== SUI.id) return null;
  const d = p.data;
  try {
    const tx = base64.decode(String(d.tx)), sig = base64.decode(String(d.signature));
    const payment = JSON.parse(String(d.payment)) as { id: string; version: string }[];
    const s: SuiSigned = { from: String(p.from), to: String(d.to), amount: BigInt(String(d.amount)), fee: BigInt(String(d.fee)), hash: String(p.hash), tx: String(d.tx), signature: String(d.signature), payment };
    if (!Array.isArray(payment) || !payment.length || sig.length !== 97 || sig[0] !== 0) return null;
    const pub = sig.slice(65);
    if (suiAddressOf(pub) !== s.from || suiDigest(tx) !== s.hash) return null;
    if (!ed25519.verify(sig.slice(1, 65), blake2b(concat([0, 0, 0], tx), { dkLen: 32 }), pub)) return null;

    const head = serializeSuiTransfer({ sender: s.from, to: s.to, amount: s.amount, payment: payment.map((c) => ({ id: c.id, version: BigInt(c.version), digest: "11111111111111111111111111111111", balance: 0n })), price: 1n, budget: s.fee });
    const cut = 2 + 1 + 10 + 34 + 1 + 6 + 10 + 32;
    if (!sameBytes(tx.slice(0, cut), head.slice(0, cut))) return null;
    return s;
  } catch { return null; }
}

export const SUI_KIT: SendKit<SuiQuote, SuiSigned> = {
  id: SUI.id, name: SUI.name, symbol: SUI.symbol, decimals: SUI.decimals, family: "sui", placeholder: "0x…",
  address: suiAddress, format: formatSui, quote: quoteSuiSend, spendable: suiSpendable, sign: signSuiSend, submit: submitSui,
  wait: waitSui, pendingOf: suiPendingOf, signedOf: suiSignedOf, txUrl: suiTxUrl,
};
