import * as btc from "@scure/btc-signer";
import { hex } from "@scure/base";
import {
  clampUtxoRate, decodeUtxoAddress, formatUtxoAmount, isUtxoAddress, parseUtxoAmount, utxoBroadcastAll, utxoCoins, utxoKeys, utxoRawTx, utxoScriptHex, utxoTxStatus,
  UTXO_RBF_SEQUENCE, type BroadcastAnswer, type Utxo, type UtxoCoin,
} from "./utxobase";
export * from "./utxobase";

export const MAX_INPUTS = 60;

export const MAX_UNCONFIRMED = 10;

export interface UtxoQuote {
  coin: UtxoCoin["id"]; to: string; amount: bigint; fee: bigint; feeRate: number; change: bigint; vsize: number; inputs: number;

  inTotal: bigint;

  tx: btc.Transaction;

  from: string; script: string;

  waiting: bigint; skipped: bigint;

  memo?: string;
}

export function utxoMemoScript(memo: Uint8Array): Uint8Array {
  if (!(memo instanceof Uint8Array) || memo.length < 1 || memo.length > 80) throw new Error("ERR_UNSAFE");
  return btc.Script.encode(["RETURN", memo]);
}

const lower = (s: string) => s.toLowerCase();
const parseOpts = { allowUnknownOutputs: true, allowUnknownInputs: true, disableScriptCheck: true, allowUnknownVersion: true } as const;
const mweb = (why: string) => Object.assign(new Error("ERR_MWEB"), { mweb: true, why });

export function stripMweb(raw: Uint8Array): Uint8Array {
  if (raw.length < 10 || raw[4] !== 0x00 || (raw[5] & 0x08) === 0) return raw;
  const flag = raw[5];
  if ((flag & ~0x09) !== 0) throw mweb("flag");
  let p = 6;
  const need = (n: number) => { if (n < 0 || p + n > raw.length) throw mweb("short"); };
  const vi = (): number => {
    need(1);
    const f = raw[p++];
    if (f < 0xfd) return f;
    if (f === 0xfd) { need(2); const v = raw[p] | (raw[p + 1] << 8); p += 2; return v; }
    if (f === 0xfe) { need(4); const v = (raw[p] | (raw[p + 1] << 8) | (raw[p + 2] << 16)) + raw[p + 3] * 0x1000000; p += 4; return v; }
    throw mweb("size");
  };
  const skip = (n: number) => { need(n); p += n; };
  const insStart = p;
  const nIn = vi();
  for (let i = 0; i < nIn; i++) { skip(36); skip(vi()); skip(4); }
  const nOut = vi();
  for (let i = 0; i < nOut; i++) { skip(8); skip(vi()); }
  const body = raw.slice(insStart, p);
  if (flag & 0x01) for (let i = 0; i < nIn; i++) { const items = vi(); for (let j = 0; j < items; j++) skip(vi()); }
  need(1);
  if (raw[p] !== 0x00) throw mweb("mweb body");
  p++;
  need(4);
  const lock = raw.slice(p, p + 4);
  p += 4;
  if (p !== raw.length) throw mweb("trailing");
  return Uint8Array.from([...raw.slice(0, 4), ...body, ...lock]);
}

const same = (a: Uint8Array | undefined, b: Uint8Array) => !!a && a.length === b.length && a.every((x, i) => x === b[i]);

function spentOnlyBy(prev: btc.Transaction, pubkey: Uint8Array): boolean {
  if (!prev.inputsLength) return false;
  for (let i = 0; i < prev.inputsLength; i++) {
    const inp = prev.getInput(i);
    const w = inp.finalScriptWitness;
    if (w && w.length === 2 && same(w[1], pubkey)) continue;
    let ops: unknown[] = [];
    try { ops = inp.finalScriptSig && inp.finalScriptSig.length ? (btc.Script.decode(inp.finalScriptSig) as unknown[]) : []; } catch { ops = []; }
    if (ops.length === 2 && ops[1] instanceof Uint8Array && same(ops[1], pubkey)) continue;
    return false;
  }
  return true;
}

export function verifyPrevOut(rawHex: string, txid: string, vout: number, scriptHex: string, pubkey?: Uint8Array): { amount: bigint; raw: Uint8Array; ownChange: boolean } {
  let raw: Uint8Array, prev: btc.Transaction;
  try { raw = hex.decode(lower(rawHex)); } catch { throw new Error("ERR_PROVIDER"); }
  raw = stripMweb(raw);
  try { prev = btc.Transaction.fromRaw(raw, parseOpts); } catch { throw new Error("ERR_PROVIDER"); }
  if (prev.id !== lower(txid)) throw new Error("ERR_PROVIDER");
  if (!Number.isInteger(vout) || vout < 0 || vout >= prev.outputsLength) throw new Error("ERR_PROVIDER");
  const o = prev.getOutput(vout);
  if (!o.script || o.amount == null || hex.encode(o.script) !== lower(scriptHex)) throw new Error("ERR_PROVIDER");
  return { amount: o.amount, raw, ownChange: !!pubkey && spentOnlyBy(prev, pubkey) };
}

function account(c: UtxoCoin, phrase: string, index: number) {
  const k = utxoKeys(c, phrase, index);
  const pay = c.kind === "wpkh" ? btc.p2wpkh(k.publicKey, c.net) : btc.p2pkh(k.publicKey, c.net);
  return { address: pay.address!, script: pay.script, privateKey: k.privateKey, publicKey: k.publicKey };
}

export function recipientScript(c: UtxoCoin, to: string): Uint8Array {
  const d = decodeUtxoAddress(c, to);
  const s = d.type === "tr" ? btc.OutScript.encode({ type: "tr", pubkey: d.pubkey }) : btc.OutScript.encode({ type: d.type, hash: d.hash });
  if (hex.encode(s) !== utxoScriptHex(c, to)) throw new Error("ERR_ADDRESS");
  return s;
}

const selectOpts = (c: UtxoCoin, change: string, rate: number, memo = false) => ({

  changeAddress: change, feePerByte: BigInt(rate), bip69: !memo, createTx: false, network: c.net, ...(memo ? { allowUnknownOutputs: true } : {}),

  dust: 1n, dustRelayFeeRate: c.dust, allowLegacyWitnessUtxo: true,
});
type Acc = { address: string; script: Uint8Array; publicKey: Uint8Array };
const desc = (a: Utxo, b: Utxo) => (b.value > a.value ? 1 : b.value < a.value ? -1 : 0);

export async function spendableCoins(c: UtxoCoin, acc: Acc, coins: Utxo[], rawOf: (txid: string) => Promise<string>, own: ReadonlySet<string> = new Set()): Promise<{ coins: Utxo[]; waiting: bigint }> {
  const ok = coins.filter((u) => u.confirmed);
  let waiting = 0n;
  const pending = coins.filter((u) => !u.confirmed).sort(desc);
  const script = hex.encode(acc.script);
  for (const [i, u] of pending.entries()) {
    let mine = false;
    if (i < MAX_UNCONFIRMED && own.has(u.txid.toLowerCase())) {
      try { const v = verifyPrevOut(await rawOf(u.txid), u.txid, u.vout, script, acc.publicKey); mine = v.ownChange && v.amount === u.value; } catch { mine = false; }
    }
    if (mine) ok.push(u); else waiting += u.value;
  }
  return { coins: ok, waiting };
}

export async function buildUtxoPayment(c: UtxoCoin, acc: Acc, coins: Utxo[], to: string, amount: bigint, feeRate: number,
  rawOf: (txid: string) => Promise<string>, own: ReadonlySet<string> = new Set(), memo?: Uint8Array): Promise<UtxoQuote> {
  const memoScr = memo ? utxoMemoScript(memo) : null, memoHex = memoScr ? hex.encode(memoScr) : null;
  if (!isUtxoAddress(c, to)) throw new Error("ERR_ADDRESS");
  if (amount <= 0n) throw new Error("ERR_ZERO");
  if (amount < c.dust) throw new Error("ERR_DUST");
  const toScript = recipientScript(c, to);
  if (hex.encode(toScript) === hex.encode(acc.script)) throw new Error("ERR_SELF");
  const rate = clampUtxoRate(c, feeRate);
  const ownHex = hex.encode(acc.script);
  const raws = new Map<string, string>();
  const read = async (txid: string) => { let r = raws.get(txid); if (r == null) { r = await rawOf(txid); raws.set(txid, r); } return r; };
  const elig = await spendableCoins(c, acc, coins, read, own);
  let pool = elig.coins.sort(desc).slice(0, MAX_INPUTS), skipped = 0n;
  for (let round = 0; ; round++) {
    const inputs = pool.map((u) => ({ txid: u.txid, index: u.vout, sequence: UTXO_RBF_SEQUENCE, witnessUtxo: { script: acc.script, amount: u.value } }));
    let sel: ReturnType<typeof btc.selectUTXO> | undefined;
    const outs = memoScr ? [{ script: toScript, amount }, { script: memoScr, amount: 0n }] : [{ script: toScript, amount }];
    try { sel = inputs.length ? btc.selectUTXO(inputs, outs, "default", selectOpts(c, acc.address, rate, !!memoScr)) : undefined; } catch { sel = undefined; }
    if (!sel || !sel.inputs.length) throw Object.assign(new Error("ERR_FUNDS"), { waiting: elig.waiting, skipped });

    const tx = new btc.Transaction({ strictPrevoutValidation: true, allowLegacyWitnessUtxo: false, ...(memoScr ? { allowUnknownOutputs: true } : {}) });
    let inSum = 0n, unreadable: Utxo | null = null;
    for (const i of sel.inputs) {
      const txid = hex.encode(i.txid!), claimed = pool.find((u) => u.txid === txid && u.vout === i.index);
      if (!claimed) throw new Error("ERR_PROVIDER");
      let v: ReturnType<typeof verifyPrevOut>;
      try { v = verifyPrevOut(await read(txid), txid, i.index!, ownHex); } catch (e) { if ((e as { mweb?: boolean }).mweb) { unreadable = claimed; break; } throw e; }
      if (v.amount !== claimed.value) throw new Error("ERR_PROVIDER");
      inSum += v.amount;
      tx.addInput({ txid, index: i.index!, sequence: UTXO_RBF_SEQUENCE, nonWitnessUtxo: v.raw, ...(c.kind === "wpkh" ? { witnessUtxo: { script: acc.script, amount: v.amount } } : {}) });
    }
    if (unreadable) {
      if (round >= 5) throw Object.assign(new Error("ERR_FUNDS"), { waiting: elig.waiting, skipped: skipped + unreadable.value });
      const u = unreadable;
      pool = pool.filter((x) => !(x.txid === u.txid && x.vout === u.vout));
      skipped += u.value;
      continue;
    }
    let outSum = 0n, change = 0n, paid = 0, memos = 0;
    for (const [i, o] of sel.outputs.entries()) {
      const script = "script" in o && o.script ? o.script : btc.OutScript.encode(btc.Address(c.net).decode((o as { address: string }).address));
      const s = hex.encode(script);
      if (memoHex && i === 1) { if (s !== memoHex || o.amount !== 0n || memos) throw new Error("ERR_UNSAFE"); memos++; }
      else if (memoHex && i === 0) { if (s !== hex.encode(toScript) || o.amount !== amount) throw new Error("ERR_UNSAFE"); paid++; }
      else if (s === hex.encode(toScript) && o.amount === amount && !paid) paid++;
      else if (s === ownHex) { if (change) throw new Error("ERR_UNSAFE"); change = o.amount; if (change < c.dust) throw new Error("ERR_UNSAFE"); }
      else throw new Error("ERR_UNSAFE");
      outSum += o.amount;
      tx.addOutput({ script, amount: o.amount });
    }
    if (paid !== 1 || (memoHex && memos !== 1)) throw new Error("ERR_UNSAFE");
    const fee = inSum - outSum;

    const vsize = memoScr ? estimateVsize(c, sel.inputs.length, sel.outputs.length - 1) + 9 + memoScr.length : estimateVsize(c, sel.inputs.length, sel.outputs.length);
    checkFee(c, fee, vsize);
    return { coin: c.id, to: to.trim(), amount, fee, feeRate: rate, change, vsize, inputs: sel.inputs.length, inTotal: inSum, tx, from: acc.address, script: ownHex, waiting: elig.waiting, skipped, ...(memoHex ? { memo: memoHex } : {}) };
  }
}

export function estimateVsize(c: UtxoCoin, inputs: number, outputs: number): number {
  return c.kind === "pkh" ? 10 + 148 * inputs + 34 * outputs : Math.ceil(10.5 + 68 * inputs + 43 * outputs);
}

function checkFee(c: UtxoCoin, fee: bigint, vsize: number) {
  if (fee <= 0n) throw new Error("ERR_UNSAFE");
  if (fee < BigInt(c.minFeeRate) * BigInt(vsize - 4)) throw new Error("ERR_UNSAFE");
  if (fee > BigInt(c.maxFeeRate) * BigInt(vsize + 4) + c.dust) throw new Error("ERR_FEE_HIGH");
}

const ownSet = (own: readonly string[]) => new Set(own.map((h) => h.toLowerCase()));

export async function quoteUtxoSend(c: UtxoCoin, phrase: string, index: number, to: string, amountText: string, feeRate: number, own: readonly string[] = [], memo?: Uint8Array): Promise<UtxoQuote> {
  if (!isUtxoAddress(c, to)) throw new Error("ERR_ADDRESS");
  const amount = parseUtxoAmount(amountText);
  const acc = account(c, phrase, index);
  const coins = await utxoCoins(c, acc.address);
  return buildUtxoPayment(c, acc, coins, to.trim(), amount, feeRate, (txid) => utxoRawTx(c, txid), ownSet(own), memo);
}

export function signUtxoPayment(c: UtxoCoin, phrase: string, index: number, q: UtxoQuote): { hex: string; txid: string } {
  if (q.coin !== c.id) throw new Error("ERR_UNSAFE");
  const acc = account(c, phrase, index);
  if (acc.address !== q.from || hex.encode(acc.script) !== q.script) throw new Error("ERR_UNSAFE");
  return signUtxoTx(c, q, acc.privateKey);
}

export function broadcastVerdict(answers: BroadcastAnswer[], seen: boolean): "sent" | "refused" | "unknown" {
  if (answers.some((a) => "ok" in a) || seen) return "sent";
  if (answers.length > 0 && answers.every((a) => "refused" in a)) return "refused";
  return "unknown";
}

export async function broadcastUtxo(c: UtxoCoin, hexTx: string, txid: string, o: { send?: typeof utxoBroadcastAll; status?: typeof utxoTxStatus } = {}): Promise<"sent" | "unknown"> {
  const answers = await (o.send ?? utxoBroadcastAll)(c, hexTx);
  const seen = answers.some((a) => "ok" in a) ? true : !!(await (o.status ?? utxoTxStatus)(c, txid).catch(() => null));
  const v = broadcastVerdict(answers, seen);
  if (v === "refused") throw Object.assign(new Error("ERR_BROADCAST"), { reasons: answers.map((a) => ("refused" in a ? a.refused : "")) });
  return v;
}

export function signUtxoTx(c: UtxoCoin, q: UtxoQuote, privateKey: Uint8Array): { hex: string; txid: string } {
  const tx = q.tx.clone();
  tx.sign(privateKey);
  tx.finalize();
  const raw = tx.extract();
  const back = btc.Transaction.fromRaw(raw, parseOpts);
  let out = 0n, toPaid = 0n, memos = 0;
  const toHex = hex.encode(recipientScript(c, q.to));
  for (let i = 0; i < back.outputsLength; i++) {
    const o = back.getOutput(i), s = hex.encode(o.script!);
    out += o.amount!;
    if (q.memo && s === q.memo) { if (i !== 1 || o.amount !== 0n) throw new Error("ERR_UNSAFE"); memos++; }
    else if (s === toHex) toPaid += o.amount!;
    else if (s !== q.script) throw new Error("ERR_UNSAFE");
  }
  if (toPaid !== q.amount || back.inputsLength !== q.inputs || (q.memo ? memos !== 1 || hex.encode(back.getOutput(0).script!) !== toHex : memos !== 0)) throw new Error("ERR_UNSAFE");
  if (q.inTotal - out !== q.fee || tx.fee !== q.fee) throw new Error("ERR_UNSAFE");
  checkFee(c, q.fee, back.vsize);
  return { hex: hex.encode(raw), txid: back.id };
}

export async function utxoSpendable(c: UtxoCoin, phrase: string, index: number, feeRate: number, own: readonly string[] = []): Promise<bigint> {
  const acc = account(c, phrase, index);
  const all = await utxoCoins(c, acc.address);
  const { coins } = await spendableCoins(c, acc, all, (txid) => utxoRawTx(c, txid), ownSet(own));
  return spendableOf(c, coins.sort(desc).slice(0, MAX_INPUTS), feeRate);
}
export function spendableOf(c: UtxoCoin, coins: Utxo[], feeRate: number): bigint {
  const total = coins.reduce((s, u) => s + u.value, 0n);
  const fee = BigInt(clampUtxoRate(c, feeRate)) * BigInt(estimateVsize(c, coins.length, 2));
  const left = total - fee;
  return left >= c.dust ? left : 0n;
}

export const utxoPendingOf = (c: UtxoCoin, q: UtxoQuote, signed: { hex: string; txid: string }) => ({
  networkId: c.id, from: q.from, hash: signed.txid, at: Date.now(), data: { hex: signed.hex, to: q.to, amount: q.amount.toString(), ...(q.memo ? { memo: 1 } : {}) },
});

export function utxoSignedOf(p: { hash: string; at?: number; data: Record<string, string | number | null> } | null): { hex: string; txid: string; to: string; amount: bigint; memo: boolean; at: number } | null {
  if (!p) return null;
  try {
    const h = String(p.data.hex ?? "").toLowerCase();
    if (!/^[0-9a-f]+$/.test(h)) return null;
    const tx = btc.Transaction.fromRaw(hex.decode(h), parseOpts);
    if (tx.id !== p.hash) return null;
    return { hex: h, txid: p.hash, to: String(p.data.to ?? ""), amount: BigInt(String(p.data.amount ?? "0")), memo: Number(p.data.memo ?? 0) === 1, at: Number(p.at) || 0 };
  } catch { return null; }
}

export { formatUtxoAmount as formatUtxo };
