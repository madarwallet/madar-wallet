import "./bufferShim";
import { Buffer } from "buffer";
import { Address, beginCell, external, internal, SendMode, storeMessage, storeMessageRelaxed, type Cell } from "@ton/core";
import { ed25519 } from "@noble/curves/ed25519.js";
import { jettonWalletChecked, parseTonAddress, tcCall, tonBalances, tonSecret, tonSeqno, tonWallet, TON_USDT, WALLET_ID, walletInit } from "./tonbase";
import type { TcTx } from "./tonhistory";

export const TON_FEE_RESERVE = 10_000_000n;

export const JETTON_ATTACH = 50_000_000n;
export const JETTON_TRANSFER_OP = 0x0f8a7ea5;
const COMMENT_MAX = 120;

export function commentCell(text: string): Cell {
  return beginCell().storeUint(0, 32).storeStringTail(text).endCell();
}

export function jettonTransferBody(a: { amount: bigint; to: Address; responseTo: Address; comment?: string; queryId?: bigint }): Cell {
  const b = beginCell().storeUint(JETTON_TRANSFER_OP, 32).storeUint(a.queryId ?? 0n, 64).storeCoins(a.amount)
    .storeAddress(a.to).storeAddress(a.responseTo).storeBit(0).storeCoins(1n);
  if (a.comment) b.storeBit(1).storeRef(commentCell(a.comment)); else b.storeBit(0);
  return b.endCell();
}

export function signedTransfer(a: { secret: Uint8Array; seqno: number; to: Address; value: bigint; bounce: boolean; body?: Cell; timeout: number }): { boc: string; wallet: Address; hash: string } {
  const pub = ed25519.getPublicKey(a.secret);
  const wallet = tonWallet(pub);
  const msg = internal({ to: a.to, value: a.value, bounce: a.bounce, body: a.body });
  const signing = beginCell().storeUint(WALLET_ID, 32).storeUint(a.timeout, 32).storeUint(a.seqno, 32)
    .storeUint(0, 8).storeUint(SendMode.PAY_GAS_SEPARATELY + SendMode.IGNORE_ERRORS, 8).storeRef(beginCell().store(storeMessageRelaxed(msg)));
  const signature = ed25519.sign(signing.endCell().hash(), a.secret);
  const body = beginCell().storeBuffer(Buffer.from(signature)).storeBuilder(signing).endCell();
  const ext = external({ to: wallet, init: a.seqno === 0 ? walletInit(pub) : undefined, body });
  const cell = beginCell().store(storeMessage(ext)).endCell();

  return { boc: cell.toBoc().toString("base64"), wallet, hash: cell.hash().toString("hex") };
}

export interface TonSend { to: string; amount: bigint; asset: "TON" | "USDT"; comment?: string }
export interface TonQuote { to: Address; amount: bigint; asset: "TON" | "USDT"; comment: string; bounce: boolean; fee: bigint; balance: { nano: bigint; usdt: bigint } }

export async function quoteTonSend(phrase: string, index: number, r: TonSend): Promise<TonQuote> {
  const to = parseTonAddress(r.to);
  if (!to) throw new Error("ERR_ADDRESS");
  if (r.amount <= 0n) throw new Error("ERR_ZERO");
  const comment = (r.comment ?? "").trim();
  if ([...comment].length > COMMENT_MAX) throw new Error("ERR_TON_COMMENT");
  const me = tonWallet(ed25519.getPublicKey(tonSecret(phrase, index))).toString({ bounceable: false });
  if (r.asset === "USDT" && to.equals(Address.parse(TON_USDT))) throw new Error("ERR_ADDRESS");
  const [bal, dest] = await Promise.all([tonBalances(me), tcCall<{ state: string }>("getAddressInformation", { address: to.toString() })]);

  const friendly = (() => { try { return Address.parseFriendly(r.to.trim()); } catch { return null; } })();
  const bounce = dest.state === "active" ? (friendly ? friendly.isBounceable : true) : false;
  if (r.asset === "TON") {
    if (bal.nano < r.amount) throw new Error("ERR_FUNDS");
    if (bal.nano < r.amount + TON_FEE_RESERVE) throw Object.assign(new Error("ERR_GAS"), { need: r.amount + TON_FEE_RESERVE, have: bal.nano, fee: TON_FEE_RESERVE });
    return { to, amount: r.amount, asset: "TON", comment, bounce, fee: TON_FEE_RESERVE, balance: bal };
  }
  if (bal.usdt < r.amount) throw new Error("ERR_FUNDS");
  if (bal.nano < JETTON_ATTACH + TON_FEE_RESERVE) throw Object.assign(new Error("ERR_GAS"), { need: JETTON_ATTACH + TON_FEE_RESERVE, have: bal.nano, fee: JETTON_ATTACH });
  return { to, amount: r.amount, asset: "USDT", comment, bounce: true, fee: JETTON_ATTACH, balance: bal };
}

export async function sendTon(phrase: string, index: number, q: TonQuote, now = Date.now()): Promise<{ wallet: string; seqno: number; hash: string; timeout: number }> {
  const secret = tonSecret(phrase, index);
  const me = tonWallet(ed25519.getPublicKey(secret));
  const seqno = await tonSeqno(me.toString({ bounceable: false }));
  const timeout = Math.floor(now / 1000) + 60;
  const signed = q.asset === "TON"
    ? signedTransfer({ secret, seqno, to: q.to, value: q.amount, bounce: q.bounce, body: q.comment ? commentCell(q.comment) : undefined, timeout })
    : signedTransfer({ secret, seqno, to: await jettonWalletChecked(TON_USDT, me.toString()), value: JETTON_ATTACH, bounce: true, timeout,
        body: jettonTransferBody({ amount: q.amount, to: q.to, responseTo: me, comment: q.comment || undefined, queryId: BigInt(now) }) });
  const r = await tcCall<{ hash?: string }>("sendBocReturnHash", { boc: signed.boc }).catch(async (e) => {

    const res = await fetch("https://tonapi.io/v2/blockchain/message", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ boc: signed.boc }), signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw e;
    return {} as { hash?: string };
  });
  return { wallet: me.toString({ bounceable: false }), seqno, hash: r.hash ? Buffer.from(r.hash, "base64").toString("hex") : signed.hash, timeout };
}

export async function tonSentDone(wallet: string, seqno: number): Promise<boolean> {
  return (await tonSeqno(wallet)) > seqno;
}

export type TonSendState = "done" | "failed" | "expired" | "pending";

export function tonStateOf(txs: TcTx[], hash: string, timeoutSec: number, nowSec: number): TonSendState {
  for (const t of txs) {
    const m = t.in_msg;
    if (!m || m.source || !m.hash) continue;
    if (Buffer.from(m.hash, "base64").toString("hex") !== hash) continue;
    return (t.out_msgs ?? []).length > 0 ? "done" : "failed";
  }
  return nowSec > timeoutSec + 30 ? "expired" : "pending";
}
export async function tonSendState(wallet: string, hash: string, timeoutSec: number): Promise<TonSendState> {
  const txs = await tcCall<TcTx[]>("getTransactions", { address: wallet, limit: 16, archival: true });
  return tonStateOf(Array.isArray(txs) ? txs : [], hash, timeoutSec, Math.floor(Date.now() / 1000));
}
