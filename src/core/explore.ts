import { BTC } from "./btcbase";
import { NETWORKS } from "./chains";
import { cgGet } from "./coingecko";
import { cached, parseMarket, type Loaded, type Market } from "./market";
import { SOL } from "./solbase";
import { EXTRA_COINS } from "./natives";

export interface ExploreCoin { id: string; symbol: string; name: string; price: number | null; change24h: number | null; rank: number | null; img?: string | null; m?: Market | null }

const CG_IMG = /^https:\/\/(coin-images|assets)\.coingecko\.com\/coins\/images\/\d{1,9}\/(thumb|small|large|standard)\/[A-Za-z0-9._%-]{1,120}(\?\d{1,13})?$/;
export function cgImage(u: unknown): string | null {
  if (typeof u !== "string" || u.length > 300 || !CG_IMG.test(u)) return null;
  return u.replace(/\/(thumb|large|standard)\//, "/small/");
}

export const KNOWN_IDS: ReadonlySet<string> = new Set([
  BTC.coingecko, SOL.coingecko, ...SOL.tokens.map((t) => t.coingecko).filter(Boolean),

  ...EXTRA_COINS.map((c) => c.coingecko),
  ...NETWORKS.flatMap((n) => [n.native.coingecko, ...n.tokens.map((t) => t.coingecko)]).filter(Boolean),
] as string[]);

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown, max = 64): string => (typeof v === "string" ? v.slice(0, max) : "");
const ID_RE = /^[a-z0-9][a-z0-9-]{0,80}$/;

export function parseMarkets(json: unknown): ExploreCoin[] {
  if (!Array.isArray(json)) return [];
  return json.flatMap((r: Record<string, unknown>) => {
    const id = str(r?.id, 90);
    if (!ID_RE.test(id)) return [];
    return [{ id, symbol: str(r.symbol, 20).toUpperCase(), name: str(r.name), price: num(r.current_price), change24h: num(r.price_change_percentage_24h), rank: num(r.market_cap_rank), img: cgImage(r.image), m: parseMarket([r], "usd") }];
  });
}

export function parseTrending(json: unknown): ExploreCoin[] {
  const coins = (json as { coins?: unknown })?.coins;
  if (!Array.isArray(coins)) return [];
  return coins.flatMap((c: { item?: Record<string, unknown> }) => {
    const it = c?.item, id = str(it?.id, 90);
    if (!it || !ID_RE.test(id)) return [];
    const d = (it.data ?? {}) as Record<string, unknown>;
    const ch = (d.price_change_percentage_24h ?? {}) as Record<string, unknown>;
    return [{ id, symbol: str(it.symbol, 20).toUpperCase(), name: str(it.name), price: num(d.price), change24h: num(ch.usd), rank: num(it.market_cap_rank), img: cgImage(it.small ?? it.thumb ?? it.large) }];
  });
}

export function parseSearch(json: unknown): ExploreCoin[] {
  const coins = (json as { coins?: unknown })?.coins;
  if (!Array.isArray(coins)) return [];
  return coins.slice(0, 25).flatMap((r: Record<string, unknown>) => {
    const id = str(r?.id, 90);
    if (!ID_RE.test(id)) return [];
    return [{ id, symbol: str(r.symbol, 20).toUpperCase(), name: str(r.name), price: null, change24h: null, rank: num(r.market_cap_rank), img: cgImage(r.large ?? r.thumb) }];
  });
}

const TTL = 5 * 60_000;
export const topCoins = (cur: string, force = false): Promise<Loaded<ExploreCoin[]>> =>
  cached(`explore:top:${cur}`, TTL, async () => parseMarkets(await cgGet(`coins/markets?vs_currency=${encodeURIComponent(cur)}&order=market_cap_desc&per_page=25&page=1&price_change_percentage=24h`)), force);
export const trendingCoins = (force = false): Promise<Loaded<ExploreCoin[]>> =>
  cached("explore:trending", TTL, async () => parseTrending(await cgGet("search/trending")), force);
export async function searchCoins(q: string): Promise<ExploreCoin[]> {
  const s = q.trim().slice(0, 40);
  if (s.length < 2) return [];

  const q2 = encodeURIComponent(s).replace(/[!'()*~]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
  return parseSearch(await cgGet(`search?query=${q2}`));
}

export const LESS_KNOWN_RANK = 1000;
export function splitResults(list: readonly ExploreCoin[]): { main: ExploreCoin[]; less: ExploreCoin[] } {
  const known = (c: ExploreCoin) => KNOWN_IDS.has(c.id);
  const sorted = [...list].sort((a, b) => Number(known(b)) - Number(known(a)) || (a.rank ?? Infinity) - (b.rank ?? Infinity));
  const main: ExploreCoin[] = [], less: ExploreCoin[] = [], taken = new Set<string>();
  for (const c of sorted) {
    const sym = c.symbol.toUpperCase();
    const ok = known(c) || (c.rank != null && c.rank <= LESS_KNOWN_RANK && !taken.has(sym));
    if (ok) { main.push(c); taken.add(sym); } else less.push(c);
  }
  if (!main.length) { const best = less.findIndex((c) => c.rank != null); if (best >= 0) main.push(...less.splice(best, 1)); }
  return { main, less };
}

export interface CoinHome { platform: string; address: string; decimals: number }
const ADDR = /^(0x[0-9a-fA-F]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$/;
export function parseHome(json: unknown): CoinHome | null {
  const j = json as { asset_platform_id?: unknown; detail_platforms?: Record<string, { decimal_place?: unknown; contract_address?: unknown }> } | null;
  const platform = typeof j?.asset_platform_id === "string" ? j.asset_platform_id : "";
  if (!ID_RE.test(platform)) return null;
  const d = j?.detail_platforms?.[platform];
  const address = typeof d?.contract_address === "string" ? d.contract_address.trim() : "";
  const decimals = typeof d?.decimal_place === "number" ? d.decimal_place : NaN;
  if (!ADDR.test(address) || !Number.isInteger(decimals) || decimals < 0 || decimals > 36) return null;

  if ((platform === SOL.cgPlatform) !== !address.startsWith("0x")) return null;
  return { platform, address, decimals };
}
export const coinHome = (id: string): Promise<Loaded<CoinHome>> =>
  cached<CoinHome>(`explore:home:${id}`, 24 * 60 * 60_000, async () => (ID_RE.test(id) ? parseHome(await cgGet(`coins/${encodeURIComponent(id)}?localization=false&tickers=false&market_data=false&community_data=false&developer_data=false&sparkline=false`)) : null));
