import { BTC } from "./btcbase";
import { NETWORKS } from "./chains";
import { SOL } from "./solbase";
import { EXTRA_COINS } from "./natives";

const INFO = "https://api.hyperliquid.xyz/info";
const TIMEOUT = 12_000;
const COIN_RE = /^[A-Za-z0-9]{1,15}$/;

async function info(body: unknown): Promise<unknown> {
  const r = await fetch(INFO, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT), referrerPolicy: "no-referrer", credentials: "omit", cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
const num = (v: unknown): number | null => { const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN; return Number.isFinite(n) ? n : null; };

export interface HlMarket { coin: string; price: number | null; change: number | null; vol: number | null }

export function parseMarkets(json: unknown): HlMarket[] {
  if (!Array.isArray(json) || json.length < 2) return [];
  const uni = (json[0] as { universe?: unknown })?.universe, ctx = json[1];
  if (!Array.isArray(uni) || !Array.isArray(ctx)) return [];
  const out: HlMarket[] = [];
  uni.forEach((u: { name?: unknown; isDelisted?: unknown }, i: number) => {
    const coin = typeof u?.name === "string" ? u.name : "";
    if (!COIN_RE.test(coin) || u.isDelisted) return;
    const c = (ctx[i] ?? {}) as Record<string, unknown>;
    const price = num(c.midPx) ?? num(c.markPx), prev = num(c.prevDayPx);
    out.push({ coin, price, change: price != null && prev ? ((price - prev) / prev) * 100 : null, vol: num(c.dayNtlVlm) });
  });
  return out;
}
export const hlMarkets = async (): Promise<HlMarket[]> => parseMarkets(await info({ type: "metaAndAssetCtxs" }));

export interface Candle { t: number; o: number; h: number; l: number; c: number; v: number }
export interface Tf { id: string; ms: number }
export const TFS: Tf[] = [{ id: "15m", ms: 15 * 60_000 }, { id: "1h", ms: 3_600_000 }, { id: "4h", ms: 4 * 3_600_000 }, { id: "1d", ms: 86_400_000 }, { id: "1w", ms: 7 * 86_400_000 }];

export function parseCandles(json: unknown): Candle[] {
  if (!Array.isArray(json)) return [];
  const seen = new Map<number, Candle>();
  for (const x of json as Record<string, unknown>[]) {
    const t = num(x?.t), o = num(x?.o), h = num(x?.h), l = num(x?.l), c = num(x?.c), v = num(x?.v);
    if (t == null || o == null || h == null || l == null || c == null || h < l || o <= 0 || c <= 0) continue;
    seen.set(t, { t, o, h, l, c, v: v ?? 0 });
  }
  return [...seen.values()].sort((a, b) => a.t - b.t);
}
export async function hlCandles(coin: string, tf: Tf, count = 300, now = Date.now()): Promise<Candle[]> {
  if (!COIN_RE.test(coin)) return [];
  return parseCandles(await info({ type: "candleSnapshot", req: { coin, interval: tf.id, startTime: now - count * tf.ms, endTime: now } }));
}

export function range24(hourly: Candle[], now = Date.now()): { high: number; low: number } | null {
  const last = hourly.filter((c) => c.t >= now - 86_400_000);
  if (!last.length) return null;
  return { high: Math.max(...last.map((c) => c.h)), low: Math.min(...last.map((c) => c.l)) };
}

const SKIP = new Set(["USDC", "USDT", "DAI", "USDe", "FDUSD", "PYUSD", "WETH", "WBTC", "cbBTC", "WBNB", "WPOL", "WAVAX", "BTCB"]);

export const TRADE_SYMBOLS: ReadonlySet<string> = new Set(
  [BTC.symbol, SOL.symbol, ...SOL.tokens.map((t) => t.symbol), ...NETWORKS.flatMap((n) => [n.native.symbol, ...n.tokens.filter((t) => t.verified).map((t) => t.symbol)]), ...EXTRA_COINS.filter((c) => !c.noSwap && !c.noTrade).map((c) => c.symbol)]
    .filter((s) => !SKIP.has(s)),
);

export const HL_COIN: Readonly<Record<string, string>> = { kPEPE: "PEPE", kBONK: "BONK", kSHIB: "SHIB", kFLOKI: "FLOKI" };
export const tradeCoin = (market: string): string => HL_COIN[market] ?? market;

export const tradeable = (market: string): boolean => TRADE_SYMBOLS.has(tradeCoin(market));
