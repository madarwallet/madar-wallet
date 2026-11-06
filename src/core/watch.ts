export interface WatchCoin { id: string; kind: "evm" | "btc" | "sol"; urls: string[]; address: string; token?: string; symbol: string; decimals: number; net: string; last: string | null }

export interface WatchTx { hash: string; kind: "evm" | "btc" | "sol"; urls: string[]; net: string; label: string; link?: string; at: number }
export interface WatchTexts { inTitle: string; inBody: string; okTitle: string; failTitle: string }
export interface WatchPlan { v: 1; on: boolean; coins: WatchCoin[]; txs: WatchTx[]; done: string[]; texts: WatchTexts; at: number }
export type WatchEvent = { title: string; body: string; link?: string; key: string };

export const WATCH_KEY = "watchPlan";
export const WATCH_ALARM = "madar-watch";
export const WATCH_MINUTES = 4;
const TX_MAX_AGE = 24 * 3600_000;
const DONE_MAX = 200;

export interface WatchIO { post(url: string, body: unknown): Promise<any>; get(url: string): Promise<any> }
export const fetchIO: WatchIO = {
  async post(url, body) {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store", credentials: "omit", signal: AbortSignal.timeout(8_000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  },
  async get(url) {
    const r = await fetch(url, { cache: "no-store", credentials: "omit", signal: AbortSignal.timeout(8_000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  },
};
async function rpc(io: WatchIO, urls: string[], method: string, params: unknown[]): Promise<any> {
  let last: unknown = new Error("no node");
  for (const u of urls) {
    try {
      const j = await io.post(u, { jsonrpc: "2.0", id: 1, method, params });
      if (j?.error) { last = new Error(String(j.error.message ?? "rpc")); continue; }
      return j?.result;
    } catch (e) { last = e; }
  }
  throw last;
}
async function rest(io: WatchIO, bases: string[], path: string): Promise<any> {
  let last: unknown = new Error("no api");
  for (const b of bases) { try { return await io.get(b + path); } catch (e) { last = e; } }
  throw last;
}

const hexBig = (h: unknown) => { const s = String(h ?? ""); if (!/^0x[0-9a-fA-F]*$/.test(s)) throw new Error("bad"); return BigInt(s === "0x" ? "0x0" : s); };

export async function readCoin(io: WatchIO, c: WatchCoin): Promise<bigint> {
  if (c.kind === "evm") {
    if (!c.token) return hexBig(await rpc(io, c.urls, "eth_getBalance", [c.address, "latest"]));
    const data = "0x70a08231" + c.address.toLowerCase().replace(/^0x/, "").padStart(64, "0");
    return hexBig(await rpc(io, c.urls, "eth_call", [{ to: c.token, data }, "latest"]));
  }
  if (c.kind === "sol") {
    const r = await rpc(io, c.urls, "getBalance", [c.address, { commitment: "confirmed" }]);
    return BigInt(Number(r?.value ?? NaN));
  }
  const r = await rest(io, c.urls, `/address/${c.address}`);
  const v = (s: { funded_txo_sum?: number; spent_txo_sum?: number } | undefined) => BigInt(Math.round(Number(s?.funded_txo_sum ?? 0) - Number(s?.spent_txo_sum ?? 0)));
  return v(r?.chain_stats) + v(r?.mempool_stats);
}

export async function readTx(io: WatchIO, x: WatchTx): Promise<"ok" | "failed" | null> {
  if (x.kind === "evm") {
    const r = await rpc(io, x.urls, "eth_getTransactionReceipt", [x.hash]);
    return !r ? null : r.status === "0x1" ? "ok" : r.status === "0x0" ? "failed" : null;
  }
  if (x.kind === "sol") {
    const r = await rpc(io, x.urls, "getSignatureStatuses", [[x.hash], { searchTransactionHistory: true }]);
    const s = r?.value?.[0];
    return !s ? null : s.err ? "failed" : s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized" ? "ok" : null;
  }
  const r = await rest(io, x.urls, `/tx/${x.hash}/status`);
  return r?.confirmed ? "ok" : null;
}

export function unitsText(v: bigint, decimals: number): string {
  const neg = v < 0n; let x = neg ? -v : v;
  const base = 10n ** BigInt(decimals);
  const whole = x / base; x %= base;
  let frac = x.toString().padStart(decimals, "0").slice(0, 6).replace(/0+$/, "");
  if (!frac && whole === 0n && x > 0n) frac = x.toString().padStart(decimals, "0").replace(/0+$/, "");
  return (neg ? "-" : "") + whole.toString() + (frac ? "." + frac : "");
}
const fillT = (s: string, v: Record<string, string>) => s.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? "");

export async function runWatch(plan: WatchPlan, io: WatchIO, now = Date.now()): Promise<{ events: WatchEvent[]; plan: WatchPlan }> {
  const events: WatchEvent[] = [];
  if (!plan.on) return { events, plan };
  const coins = await Promise.all(plan.coins.map(async (c) => {
    let v: bigint;
    try { v = await readCoin(io, c); } catch { return c; }
    if (c.last != null) {
      let before: bigint;
      try { before = BigInt(c.last); } catch { before = v; }
      if (v > before) events.push({ key: `in:${c.id}:${v}`, title: plan.texts.inTitle, body: fillT(plan.texts.inBody, { a: unitsText(v - before, c.decimals), s: c.symbol, n: c.net }) });
    }
    return { ...c, last: v.toString() };
  }));
  const done = [...plan.done];
  const txs: WatchTx[] = [];
  await Promise.all(plan.txs.map(async (x) => {
    if (done.includes(x.hash)) return;
    let st: "ok" | "failed" | null = null;
    try { st = await readTx(io, x); } catch {  }
    if (st) {
      events.push({ key: `tx:${x.hash}`, title: st === "ok" ? plan.texts.okTitle : plan.texts.failTitle, body: x.label, link: x.link });
      done.push(x.hash);
    } else if (now - x.at < TX_MAX_AGE) txs.push(x);
  }));
  return { events, plan: { ...plan, coins, txs, done: done.slice(-DONE_MAX), at: now } };
}

export function mergePlan(fresh: WatchPlan, old: WatchPlan | null | undefined): WatchPlan {
  if (!old) return fresh;
  const seen = new Set(fresh.txs.map((x) => x.hash));
  return { ...fresh, txs: [...fresh.txs, ...old.txs.filter((x) => !seen.has(x.hash) && !old.done.includes(x.hash))], done: [...new Set([...old.done, ...fresh.done])].slice(-DONE_MAX) };
}

export function withTx(plan: WatchPlan, x: WatchTx): WatchPlan {
  if (!plan.on || plan.txs.some((y) => y.hash === x.hash) || plan.done.includes(x.hash)) return plan;
  return { ...plan, txs: [...plan.txs, x] };
}
