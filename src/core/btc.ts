import { notImported } from "./imported";
import { HDKey } from "@scure/bip32";
import { mnemonicToSeedSync } from "@scure/bip39";
import * as btc from "@scure/btc-signer";
import { normalizePhrase } from "./account";
import { api, clampFeeRate, DUST_SATS, isBtcAddress, parseBtc, RBF_SEQUENCE } from "./btcbase";
export * from "./btcbase";

export function btcAccount(phrase: string, index = 0) {
  notImported(index);
  const root = HDKey.fromMasterSeed(mnemonicToSeedSync(normalizePhrase(phrase)));
  const key = root.derive(`m/84'/0'/0'/0/${index}`);
  if (!key.privateKey || !key.publicKey) throw new Error("derivation failed");
  const pay = btc.p2wpkh(key.publicKey, btc.NETWORK);
  return { address: pay.address!, script: pay.script, privateKey: key.privateKey, publicKey: key.publicKey };
}

export interface BtcQuote { tx: btc.Transaction; fee: bigint; amount: bigint; to: string; feeRate: number;  memo?: Uint8Array }

export function memoScript(memo: Uint8Array): Uint8Array {
  if (!(memo instanceof Uint8Array) || memo.length < 1 || memo.length > 80) throw new Error("ERR_UNSAFE");
  return btc.Script.encode(["RETURN", memo]);
}
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

export function checkMemoOutputs(tx: btc.Transaction, toScript: Uint8Array, amount: bigint, memo: Uint8Array, own: Uint8Array): void {
  const n = tx.outputsLength;
  if (n < 2 || n > 3) throw new Error("ERR_UNSAFE");
  const o0 = tx.getOutput(0), o1 = tx.getOutput(1);
  if (!o0.script || !same(o0.script, toScript) || o0.amount !== amount) throw new Error("ERR_UNSAFE");
  if (!o1.script || !same(o1.script, memoScript(memo)) || o1.amount !== 0n) throw new Error("ERR_UNSAFE");
  if (n === 3) { const o2 = tx.getOutput(2); if (!o2.script || !same(o2.script, own) || o2.amount == null || o2.amount < DUST_SATS) throw new Error("ERR_UNSAFE"); }
}

export async function quoteBtcSend(phrase: string, index: number, to: string, amountBtc: string, feeRate: number, memo?: Uint8Array): Promise<BtcQuote> {
  if (!isBtcAddress(to)) throw new Error("ERR_ADDRESS");
  const amount = parseBtc(amountBtc);
  if (amount <= 0n) throw new Error("ERR_ZERO");
  if (amount < DUST_SATS) throw new Error("ERR_DUST");
  const acc = btcAccount(phrase, index);
  const utxos = await api<{ txid: string; vout: number; value: number }[]>(`/address/${acc.address}/utxo`);
  return buildBtcPayment(acc, utxos, to.trim(), amount, feeRate, memo);
}

export function buildBtcPayment(acc: { address: string; script: Uint8Array }, utxos: { txid: string; vout: number; value: number }[], to: string, amount: bigint, feeRate: number, memo?: Uint8Array): BtcQuote {
  const rate = clampFeeRate(feeRate);
  const inputs = utxos.map((u) => ({ txid: u.txid, index: u.vout, sequence: RBF_SEQUENCE, witnessUtxo: { script: acc.script, amount: BigInt(u.value) } }));

  const outs = memo ? [{ address: to, amount }, { script: memoScript(memo), amount: 0n }] : [{ address: to, amount }];
  const sel = btc.selectUTXO(inputs, outs, "default", {
    changeAddress: acc.address, feePerByte: BigInt(rate), bip69: !memo, createTx: true, network: btc.NETWORK, ...(memo ? { allowUnknownOutputs: true } : {}),
  });
  if (!sel || !sel.tx) throw new Error("ERR_FUNDS");
  if (memo) checkMemoOutputs(sel.tx, btc.OutScript.encode(btc.Address(btc.NETWORK).decode(to)), amount, memo, acc.script);
  return { tx: sel.tx, fee: sel.fee ?? 0n, amount, to, feeRate: rate, ...(memo ? { memo } : {}) };
}

export async function sendBtc(phrase: string, index: number, q: BtcQuote): Promise<string> {
  const acc = btcAccount(phrase, index);
  q.tx.sign(acc.privateKey);
  q.tx.finalize();
  if (q.memo) checkMemoOutputs(btc.Transaction.fromRaw(q.tx.extract(), { allowUnknownOutputs: true }), btc.OutScript.encode(btc.Address(btc.NETWORK).decode(q.to)), q.amount, q.memo, acc.script);
  const txid = await api<string>(`/tx`, { method: "POST", body: q.tx.hex, headers: { "Content-Type": "text/plain" } }, "text");
  return txid.trim();
}

export function signBtcPayment(phrase: string, index: number, q: BtcQuote): { hex: string; txid: string } {
  const acc = btcAccount(phrase, index);
  const tx = q.tx.clone();
  tx.sign(acc.privateKey);
  tx.finalize();
  if (q.memo) checkMemoOutputs(btc.Transaction.fromRaw(tx.extract(), { allowUnknownOutputs: true }), btc.OutScript.encode(btc.Address(btc.NETWORK).decode(q.to)), q.amount, q.memo, acc.script);
  return { hex: tx.hex, txid: tx.id };
}

export async function btcTxKnown(txid: string): Promise<boolean | null> {
  try { await api<unknown>(`/tx/${txid}/status`); return true; } catch (e) { return /^404\b/.test((e as Error).message) ? false : null; }
}

export async function broadcastBtc(hexTx: string, txid: string, o: { post?: (hex: string) => Promise<string>; known?: typeof btcTxKnown } = {}): Promise<"sent" | "unknown"> {
  const post = o.post ?? ((h: string) => api<string>(`/tx`, { method: "POST", body: h, headers: { "Content-Type": "text/plain" } }, "text"));
  try { if ((await post(hexTx)).trim() === txid) return "sent"; } catch (e) {
    const known = await (o.known ?? btcTxKnown)(txid).catch(() => null);
    if (known) return "sent";
    if (/^400\b/.test((e as Error).message) && known === false) throw Object.assign(new Error("ERR_BROADCAST"), { reasons: [(e as Error).message.slice(0, 200)] });
    return "unknown";
  }
  return (await (o.known ?? btcTxKnown)(txid).catch(() => null)) ? "sent" : "unknown";
}

export const btcPendingOf = (from: string, q: BtcQuote, signed: { hex: string; txid: string }) => ({ networkId: "bitcoin", from, hash: signed.txid,
  data: { hex: signed.hex, to: q.to, amount: q.amount.toString() } });

export async function btcSalePending(from: string, s: { get: (n: string, f: string) => Promise<{ hash: string; data: Record<string, string | number | null> } | null>; clear: (n: string, f: string, h: string) => Promise<void> },
  known: typeof btcTxKnown = btcTxKnown): Promise<{ txid: string; amount: bigint } | null> {
  const p = await s.get("bitcoin", from).catch(() => null);
  if (!p || !/^[0-9a-f]{64}$/.test(p.hash)) return null;
  if ((await known(p.hash).catch(() => null)) !== true) return { txid: p.hash, amount: BigInt(String(p.data.amount ?? "0")) };
  await s.clear("bitcoin", from, p.hash);
  return null;
}

export async function btcSpendable(phrase: string, index: number, feeRate: number): Promise<bigint> {
  const acc = btcAccount(phrase, index);
  const utxos = await api<{ value: number }[]>(`/address/${acc.address}/utxo`);
  const total = utxos.reduce((s, u) => s + BigInt(u.value), 0n);
  const vbytes = 11n + 68n * BigInt(utxos.length) + 31n + 31n;
  const left = total - vbytes * BigInt(clampFeeRate(feeRate));
  return left >= DUST_SATS ? left : 0n;
}
