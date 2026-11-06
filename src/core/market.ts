import { cgGet, CgLimited } from "./coingecko";
import { readSnap, writeSnap } from "./snap";

export type Range = "1D" | "1W" | "1M" | "3M" | "1Y" | "ALL";
export const RANGES: Range[] = ["1D", "1W", "1M", "3M", "1Y", "ALL"];
const DAYS: Record<Range, string> = { "1D": "1", "1W": "7", "1M": "30", "3M": "90", "1Y": "365", ALL: "max" };
export const MARKET_TTL = 3 * 60_000;
export const chartTtl = (r: Range) => (r === "1D" ? 3 * 60_000 : r === "1W" ? 10 * 60_000 : 30 * 60_000);
const MAX_POINTS = 160;

export type CoinRef = { id: string } | { platform: string; address: string };
const ID_RE = /^[a-z0-9][a-z0-9-]{0,99}$/;
const ADDR_RE = /^(0x[0-9a-fA-F]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$/;

export function coinRef(cg: string | undefined): CoinRef | null {
  if (!cg) return null;
  const i = cg.indexOf(":");
  if (i < 0) return ID_RE.test(cg) ? { id: cg } : null;
  const platform = cg.slice(0, i), address = cg.slice(i + 1);
  return ID_RE.test(platform) && ADDR_RE.test(address) ? { platform, address } : null;
}
const refKey = (r: CoinRef) => ("id" in r ? r.id : `${r.platform}:${r.address.startsWith("0x") ? r.address.toLowerCase() : r.address}`);

export interface Market {
  price: number | null; change24h: number | null; marketCap: number | null; volume24h: number | null;
  circulating: number | null; ath: number | null; athDate: number | null; atl: number | null; atlDate: number | null;
}
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const date = (v: unknown): number | null => { if (typeof v !== "string") return null; const t = Date.parse(v); return Number.isFinite(t) ? t : null; };
const pick = (o: unknown, k: string): unknown => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined);

export function parseMarket(json: unknown, cur: string): Market | null {
  const row = Array.isArray(json) ? json[0] : json;
  if (!row || typeof row !== "object") return null;
  const md = pick(row, "market_data");
  if (md && typeof md === "object") {
    const c = (k: string) => num(pick(pick(md, k), cur));
    const d = (k: string) => date(pick(pick(md, k), cur));
    return { price: c("current_price"), change24h: num(pick(md, "price_change_percentage_24h")), marketCap: c("market_cap"), volume24h: c("total_volume"),
      circulating: num(pick(md, "circulating_supply")), ath: c("ath"), athDate: d("ath_date"), atl: c("atl"), atlDate: d("atl_date") };
  }
  return { price: num(pick(row, "current_price")), change24h: num(pick(row, "price_change_percentage_24h")), marketCap: num(pick(row, "market_cap")), volume24h: num(pick(row, "total_volume")),
    circulating: num(pick(row, "circulating_supply")), ath: num(pick(row, "ath")), athDate: date(pick(row, "ath_date")), atl: num(pick(row, "atl")), atlDate: date(pick(row, "atl_date")) };
}

export type Point = [number, number];

export function downsample(points: Point[], max = MAX_POINTS): Point[] {
  if (points.length <= max) return points;
  const step = (points.length - 1) / (max - 1);
  const out: Point[] = [];
  for (let i = 0; i < max; i++) out.push(points[Math.round(i * step)]);
  return out;
}

export function parseChart(json: unknown): Point[] {
  const raw = pick(json, "prices");
  if (!Array.isArray(raw)) return [];
  const pts: Point[] = [];
  for (const p of raw.slice(0, 20_000)) if (Array.isArray(p) && num(p[0]) != null && num(p[1]) != null && p[1] > 0) pts.push([p[0], p[1]]);
  pts.sort((a, b) => a[0] - b[0]);
  return downsample(pts);
}

export interface Loaded<T> { data: T | null; at: number; stale: boolean; limited: boolean }

export async function cached<T>(key: string, ttl: number, load: () => Promise<T | null>, force = false): Promise<Loaded<T>> {
  const saved = await readSnap<T>(key);
  if (saved && !force && Date.now() - saved.at < ttl) return { data: saved.v, at: saved.at, stale: false, limited: false };
  try {
    const v = await load();
    if (v == null) throw new Error("empty");
    const at = Date.now();
    await writeSnap(key, v, at);
    return { data: v, at, stale: false, limited: false };
  } catch (e) {
    return { data: saved?.v ?? null, at: saved?.at ?? 0, stale: !!saved, limited: e instanceof CgLimited };
  }
}

export async function savedMarket(ref: CoinRef, cur: string) { return (await readSnap<Market>(`mkt:${refKey(ref)}:${cur}`))?.v ?? null; }
export async function savedChart(ref: CoinRef, cur: string, range: Range) { return (await readSnap<ChartData>(`chart:${refKey(ref)}:${cur}:${range}`))?.v ?? null; }

export function coinMarket(ref: CoinRef, cur: string, force = false): Promise<Loaded<Market>> {
  const c = encodeURIComponent(cur);
  return cached(`mkt:${refKey(ref)}:${cur}`, MARKET_TTL, async () => parseMarket(await cgGet("id" in ref
    ? `coins/markets?vs_currency=${c}&ids=${encodeURIComponent(ref.id)}&price_change_percentage=24h`
    : `coins/${encodeURIComponent(ref.platform)}/contract/${encodeURIComponent(ref.address)}?localization=false&tickers=false&community_data=false&developer_data=false&sparkline=false`), cur), force);
}

export interface ChartData { pts: Point[]; capped: boolean }
let maxRefused = false;
export function coinChart(ref: CoinRef, cur: string, range: Range, force = false): Promise<Loaded<ChartData>> {
  const c = encodeURIComponent(cur);
  const path = (days: string) => "id" in ref
    ? `coins/${encodeURIComponent(ref.id)}/market_chart?vs_currency=${c}&days=${days}`
    : `coins/${encodeURIComponent(ref.platform)}/contract/${encodeURIComponent(ref.address)}/market_chart?vs_currency=${c}&days=${days}`;
  return cached(`chart:${refKey(ref)}:${cur}:${range}`, chartTtl(range), async () => {
    let capped = false, json: unknown;
    if (range === "ALL" && !maxRefused) {
      try { json = await cgGet(path("max")); }
      catch (e) { if (!(e instanceof Error) || !/^HTTP 40[13]$/.test(e.message)) throw e; maxRefused = true; }
    }
    if (json === undefined) { capped = range === "ALL"; json = await cgGet(path(DAYS[range === "ALL" ? "1Y" : range])); }
    const pts = parseChart(json);
    return pts.length >= 2 ? { pts, capped } : null;
  }, force);
}
