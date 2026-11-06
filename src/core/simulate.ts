import type { Address, Hex } from "viem";
import type { Network, Token } from "./chains";

export interface SimCall { from: Address; to: Address; data?: Hex; value?: bigint }

export interface SimChange { token: string; delta: bigint; nft?: boolean }
export type SimResult =
  | { status: "ok"; changes: SimChange[] | null }
  | { status: "fail"; reason: string; call: number }
  | { status: "unknown" };

const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const NATIVE = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const hex = (v: bigint) => "0x" + v.toString(16);
const topicAddr = (t: string) => ("0x" + t.slice(-40)).toLowerCase();

interface RawLog { address: string; topics: string[]; data: string }
interface RawCall { status: string; logs?: RawLog[]; error?: { message?: string; code?: number } }

export function netChanges(calls: RawCall[], me: string): SimChange[] {
  const mine = me.toLowerCase();
  const sums = new Map<string, bigint>();
  const nfts = new Map<string, bigint>();
  for (const c of calls) {
    for (const l of c.logs ?? []) {
      if (!Array.isArray(l.topics) || (l.topics[0] || "").toLowerCase() !== TRANSFER) continue;
      const token = String(l.address || "").toLowerCase();
      if (!/^0x[0-9a-f]{40}$/.test(token)) continue;
      if (l.topics.length === 3) {
        let v: bigint;
        try { v = BigInt(l.data && l.data !== "0x" ? l.data : "0x0"); } catch { continue; }
        const from = topicAddr(l.topics[1]), to = topicAddr(l.topics[2]);
        const key = token === NATIVE ? "native" : token;
        if (from === mine) sums.set(key, (sums.get(key) ?? 0n) - v);
        if (to === mine) sums.set(key, (sums.get(key) ?? 0n) + v);
      } else if (l.topics.length === 4) {
        const from = topicAddr(l.topics[1]), to = topicAddr(l.topics[2]);
        if (from === mine) nfts.set(token, (nfts.get(token) ?? 0n) - 1n);
        if (to === mine) nfts.set(token, (nfts.get(token) ?? 0n) + 1n);
      }
    }
  }
  const out: SimChange[] = [];
  for (const [token, delta] of sums) if (delta !== 0n) out.push({ token, delta });
  for (const [token, delta] of nfts) if (delta !== 0n) out.push({ token, delta, nft: true });

  return out.sort((a, b) => (a.delta < 0n ? 0 : 1) - (b.delta < 0n ? 0 : 1));
}

export function failReason(msg: string | undefined): string {
  const m = (msg || "").toLowerCase();
  if (/insufficient funds|insufficient balance|exceeds balance|transfer amount exceeds/.test(m)) return "balance";
  if (/allowance|insufficient-allowance|transfer_from_failed|approve/.test(m)) return "allowance";
  if (/return amount is not enough|too little received|slippage|min.*return|insufficient_output|amountoutmin/.test(m)) return "price";
  if (/expired|deadline/.test(m)) return "expired";
  return "reverted";
}

type Rpc = (url: string, method: string, params: unknown[]) => Promise<{ result?: unknown; error?: { code?: number; message?: string } }>;
const defaultRpc: Rpc = async (url, method, params) => {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), cache: "no-store", credentials: "omit", signal: AbortSignal.timeout(8_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
};

const asCall = (c: SimCall) => ({ from: c.from, to: c.to, ...(c.data && c.data !== "0x" ? { data: c.data } : {}), ...(c.value ? { value: hex(c.value) } : {}) });

export async function simulateEvm(n: Network, calls: SimCall[], rpc: Rpc = defaultRpc): Promise<SimResult> {
  if (!calls.length) return { status: "ok", changes: [] };
  const me = calls[0].from;
  const params = [{ blockStateCalls: [{ calls: calls.map(asCall) }], traceTransfers: true, validation: false }, "latest"];
  let estimateOnly = false;
  for (const url of n.rpcs) {
    try {
      const j = await rpc(url, "eth_simulateV1", params);
      if (j.error) {

        if (j.error.code === -32601 || /not (exist|available|supported)|method not found|unsupported/i.test(j.error.message || "")) { estimateOnly = true; continue; }
        continue;
      }
      const block = Array.isArray(j.result) ? (j.result[0] as { calls?: RawCall[] }) : null;
      const res = block?.calls;
      if (!Array.isArray(res) || res.length !== calls.length) continue;
      const bad = res.findIndex((c) => c.status !== "0x1");
      if (bad >= 0) return { status: "fail", reason: failReason(res[bad].error?.message), call: bad };
      return { status: "ok", changes: netChanges(res, me) };
    } catch {  }
  }

  if (calls.length === 1) {
    for (const url of n.rpcs) {
      try {
        const j = await rpc(url, "eth_estimateGas", [asCall(calls[0])]);
        if (j.error) {
          const m = j.error.message || "";
          if (j.error.code === 3 || /revert|insufficient|exceeds/i.test(m)) return { status: "fail", reason: failReason(m), call: 0 };
          continue;
        }
        if (j.result) return { status: "ok", changes: null };
      } catch {  }
    }
  }
  void estimateOnly;
  return { status: "unknown" };
}

export const simKey = (token: string) => (/^0x(e{40}|0{40})$/i.test(token) ? "native" : token.toLowerCase());

export class SimFailed extends Error {
  constructor(public reason: string) { super("ERR_SIM_FAIL"); }
}

export async function guardEvm(n: Network, calls: SimCall[], expect?: { token: string; min: bigint }, rpc?: Rpc): Promise<SimResult> {
  const r = await simulateEvm(n, calls, rpc);
  if (r.status === "fail") throw new SimFailed(r.reason);
  if (r.status === "ok" && r.changes && expect) {
    const got = r.changes.find((c) => !c.nft && c.token === expect.token.toLowerCase())?.delta ?? 0n;
    if (got < expect.min) throw new SimFailed("price");
  }
  return r;
}

export function knownToken(n: Network, token: string, own: Token[] = []): { symbol: string; decimals: number; verified: boolean } | null {
  if (token === "native") return { symbol: n.native.symbol, decimals: n.chain.nativeCurrency.decimals, verified: true };
  const t = [...n.tokens, ...own].find((x) => x.address.toLowerCase() === token);
  return t ? { symbol: t.symbol, decimals: t.decimals, verified: t.verified } : null;
}
