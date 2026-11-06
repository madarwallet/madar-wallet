import type { HistItem } from "./history";
import { ADA, koiosPost } from "./adabase";
import { unitsText } from "./watch";

interface KoiosIo { payment_addr?: { bech32?: string }; value?: string }
export interface KoiosTx { tx_hash: string; tx_timestamp?: number; block_time?: number; inputs?: KoiosIo[]; outputs?: KoiosIo[] }

const ada = (v: bigint) => ({ symbol: "ADA", amount: unitsText(v, 6), price: ADA.coingecko });
const val = (x: KoiosIo) => { try { const n = BigInt(String(x.value ?? "0")); return n > 0n ? n : 0n; } catch { return 0n; } };

export function parseAdaTxs(me: string, txs: KoiosTx[]): HistItem[] {
  const out: HistItem[] = [];
  for (const t of txs) {
    if (!/^[0-9a-f]{64}$/.test(String(t?.tx_hash))) continue;
    const ins = t.inputs ?? [], outs = t.outputs ?? [];
    const mine = (x: KoiosIo) => x.payment_addr?.bech32 === me;
    const at = Number(t.tx_timestamp ?? t.block_time ?? 0) * 1000, hash = t.tx_hash, id = `${ADA.id}:${hash}`;
    const paid = ins.some(mine);
    if (paid) {
      const others = outs.filter((x) => !mine(x));
      const sent = others.reduce((s, x) => s + val(x), 0n);
      if (sent > 0n) out.push({ id, hash, at, networkId: ADA.id, kind: "out", sent: [ada(sent)], got: [], party: others[0]?.payment_addr?.bech32 });
      else out.push({ id, hash, at, networkId: ADA.id, kind: "self", sent: [ada(outs.reduce((s, x) => s + val(x), 0n))], got: [], party: me });
      continue;
    }
    const got = outs.filter(mine).reduce((s, x) => s + val(x), 0n);
    if (got > 0n) out.push({ id, hash, at, networkId: ADA.id, kind: "in", sent: [], got: [ada(got)], party: ins.find((x) => x.payment_addr?.bech32)?.payment_addr?.bech32 });
  }
  return out;
}

export async function adaHistory(me: string): Promise<HistItem[]> {
  const rows = await koiosPost<{ tx_hash?: string }[]>("/address_txs?order=block_height.desc&limit=25", { _addresses: [me] });
  const hashes = (Array.isArray(rows) ? rows : []).map((r) => String(r?.tx_hash ?? "")).filter((h) => /^[0-9a-f]{64}$/.test(h));
  if (!hashes.length) return [];
  const txs = await koiosPost<KoiosTx[]>("/tx_info", { _tx_hashes: hashes, _inputs: true, _metadata: false, _assets: false, _withdrawals: false, _certs: false, _scripts: false, _bytecode: false });
  return parseAdaTxs(me, Array.isArray(txs) ? txs : []);
}
