import "./bufferShim";
import { Buffer } from "buffer";
import { Address, Cell } from "@ton/core";
import type { HistItem } from "./history";
import { jettonWalletOf, tcCall, TON, TON_USDT } from "./tonbase";
import { JETTON_TRANSFER_OP } from "./ton";
import { unitsText } from "./watch";

const NOTIFY_OP = 0x7362d09c;
const DUST = 1_000_000n;
interface TcMsg { source?: string; destination?: string; value?: string; hash?: string; msg_data?: { body?: string } }
export interface TcTx { utime: number; transaction_id: { hash: string }; in_msg?: TcMsg; out_msgs?: TcMsg[] }

const b64hex = (s: string) => Buffer.from(s, "base64").toString("hex");
const same = (a: string | undefined, b: Address) => { if (!a) return false; try { return Address.parse(a).equals(b); } catch { return false; } };
function bodyOf(m: TcMsg | undefined): { op: number; cell: Cell } | null {
  const b = m?.msg_data?.body;
  if (!b) return null;
  try { const cell = Cell.fromBoc(Buffer.from(b, "base64"))[0]; const s = cell.beginParse(); return s.remainingBits >= 32 ? { op: s.loadUint(32), cell } : null; } catch { return null; }
}
const ton = (v: bigint) => ({ symbol: "TON", amount: unitsText(v, 9), price: TON.coingecko });
const usdt = (v: bigint) => ({ symbol: "USDT", amount: unitsText(v, 6), price: "tether" });

export function parseTonTxs(me: Address, myJetton: Address | null, txs: TcTx[]): HistItem[] {
  const out: HistItem[] = [];
  for (const t of txs) {
    const hash = b64hex(t.transaction_id.hash), at = t.utime * 1000, id = `${TON.id}:${hash}`;
    const inm = t.in_msg, outs = t.out_msgs ?? [];
    if (inm?.source) {

      const b = bodyOf(inm);
      if (b?.op === NOTIFY_OP) {
        if (!myJetton || !same(inm.source, myJetton)) continue;
        try {
          const s = b.cell.beginParse(); s.loadUint(32); s.loadUintBig(64);
          const amount = s.loadCoins(), from = s.loadAddressAny();
          if (amount > 0n) out.push({ id, hash, at, networkId: TON.id, kind: "in", sent: [], got: [usdt(amount)], party: from?.toString() });
        } catch {  }
        continue;
      }
      if (myJetton && same(inm.source, myJetton)) continue;
      const v = BigInt(inm.value ?? "0");

      if (v >= DUST && !outs.length) out.push({ id, hash, at, networkId: TON.id, kind: "in", sent: [], got: [ton(v)], party: inm.source });
      continue;
    }

    for (const m of outs) {
      const b = bodyOf(m);
      const alias = inm?.hash ? b64hex(inm.hash) : undefined;
      if (b?.op === JETTON_TRANSFER_OP && myJetton && same(m.destination, myJetton)) {
        try {
          const s = b.cell.beginParse(); s.loadUint(32); s.loadUintBig(64);
          const amount = s.loadCoins(), to = s.loadAddress();
          out.push({ id, hash, at, networkId: TON.id, kind: "out", sent: [usdt(amount)], got: [], party: to.toString({ bounceable: false }), alias });
        } catch {  }
        break;
      }
      const v = BigInt(m.value ?? "0");
      if (v > 0n) {
        const self = same(m.destination, me);
        out.push({ id, hash, at, networkId: TON.id, kind: self ? "self" : "out", sent: [ton(v)], got: [], party: m.destination, alias });
        break;
      }
    }
  }
  return out;
}

export async function tonHistory(meText: string): Promise<HistItem[]> {
  const me = Address.parse(meText);
  const txs = await tcCall<TcTx[]>("getTransactions", { address: me.toString(), limit: 30, archival: true });
  const myJetton = await jettonWalletOf(TON_USDT, me.toString()).catch(() => null);
  return parseTonTxs(me, myJetton, txs);
}
