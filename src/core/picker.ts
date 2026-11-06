import { activeNetworks, crossFrom, crossTo, networkById, swapsOn, type Network } from "./chains";
import { EXTRA_COINS, extraById } from "./natives";
import { coinSwapTo, sellAsset, sellCoinOf } from "./nearsell";
import { SOL } from "./solbase";
import { TRON, TRON_USDT, TRX_TOKEN } from "./tronbase";
import { DROP_CHAINS, DROP_MIN_USD } from "./gasdrop";

export const swapNetworks = (s: { networksOn?: readonly string[] } | null | undefined): Network[] => activeNetworks(s).filter(swapsOn);

export const NEAR_POPULAR: ReadonlySet<string> = new Set(["gnosis", "scroll", "berachain"]);
const NEAR_CORE = ["base", "ethereum", "arbitrum", "optimism", "polygon", "bsc", "avalanche", "solana"];
const NEAR_PAYS: ReadonlySet<string> = new Set([...NEAR_CORE, "tron", ...NEAR_POPULAR]);
const NEAR_GETS: ReadonlySet<string> = new Set([...NEAR_CORE, "bitcoin", "dogecoin", "litecoin", "xrp", "cardano", "tron", "near", ...NEAR_POPULAR]);

export function routeOk(payNet: string, getNet: string): boolean {
  if (routeOkBase(payNet, getNet)) return true;
  return (NEAR_POPULAR.has(payNet) || NEAR_POPULAR.has(getNet)) && NEAR_PAYS.has(payNet) && NEAR_GETS.has(getNet);
}

export function routeOkBase(payNet: string, getNet: string): boolean {
  if (payNet === getNet) return true;
  const p = networkById(payNet), g = networkById(getNet);
  if (p && !crossFrom(p)) return false;
  if (g && !crossTo(g)) return false;
  return !(!p && g?.swap);
}

export interface PickEntry {
  netId: string;
  netName: string;
  token: string;
  symbol: string;
  name: string;
  decimals: number;
  verified: boolean;
  native?: boolean;
  balance: bigint | null;
  price?: string;
}
export type PriceOf = (e: PickEntry) => number | null;

export const human = (e: PickEntry) => (e.balance && e.balance > 0n ? Number(e.balance) / 10 ** e.decimals : 0);
const worth = (e: PickEntry, priceOf: PriceOf) => { const p = priceOf(e); return p == null ? 0 : human(e) * p; };

const FOREIGN = new Set(["WETH", "WETH.E", "WBTC", "CBBTC", "TBTC", "BTCB", "BTC.B", "WBNB", "WPOL", "WMATIC", "WAVAX", "SOL", "XRP", "DOGE", "ADA", "TRX", "DOT", "TON", "LTC", "BCH", "ATOM", "NEAR", "AVAX", "ETH", "BNB", "POL", "MATIC"]);
const FOREIGN_HOME: Record<string, string[]> = { POL: ["ethereum", "polygon"], MATIC: ["ethereum"], SOL: ["solana"], DOGE: ["dogecoin"], LTC: ["litecoin"], XRP: ["xrp"], ADA: ["cardano"], TRX: ["tron"], AVAX: ["avalanche"], BNB: ["bsc"] };
export const isForeignCopy = (e: Pick<PickEntry, "netId" | "symbol" | "native">) => !e.native && FOREIGN.has(e.symbol.toUpperCase()) && !(FOREIGN_HOME[e.symbol.toUpperCase()] ?? []).includes(e.netId);

export function networkTokens(entries: PickEntry[], netId: string, query = "", priceOf: PriceOf = () => null): PickEntry[] {
  const q = query.trim().toLowerCase();
  const list = entries.filter((e) => e.netId === netId && !isForeignCopy(e) && (!q || e.symbol.toLowerCase().includes(q) || e.name.toLowerCase().includes(q)));
  const idx = new Map(list.map((e, i) => [e, i]));
  return list.sort((a, b) => {
    const ha = human(a) > 0, hb = human(b) > 0;
    if (ha !== hb) return Number(hb) - Number(ha);
    if (ha) { const d = worth(b, priceOf) - worth(a, priceOf); if (d) return d; const d2 = human(b) - human(a); if (d2) return d2; }
    return idx.get(a)! - idx.get(b)!;
  });
}

export const receivable = (e: Pick<PickEntry, "netId" | "token">) => e.netId !== TRON.id || e.token === TRX_TOKEN || e.token === TRON_USDT;

export function receiveSearch(entries: PickEntry[], netId: string, payNetId: string, query = "", priceOf: PriceOf = () => null, pay?: Pick<PickEntry, "netId" | "token">): PickEntry[] {
  const here = networkTokens(entries, netId, query, priceOf).filter(receivable);
  const q = query.trim().toLowerCase();
  const coins = pay && sellCoinOf(pay.netId, pay.token) ? entries.filter((e) => e.native && e.netId !== netId && !!coinSwapTo(pay, e) &&
    (!q || e.symbol.toLowerCase().includes(q) || e.name.toLowerCase().includes(q) || e.netName.toLowerCase().startsWith(q))) : [];
  if (!q) return [...coins, ...here];
  const real = entries.filter((e) => e.native && e.netId !== netId && !coins.includes(e) && routeOk(payNetId, e.netId) &&
    (e.symbol.toLowerCase() === q || e.name.toLowerCase().startsWith(q) || e.netName.toLowerCase().startsWith(q)));
  return [...coins, ...real, ...here];
}

export function mainPair(entries: PickEntry[], netId: string): { stable?: PickEntry; native?: PickEntry } {
  const on = entries.filter((e) => e.netId === netId && e.verified);
  const usdc = on.find((e) => e.symbol === "USDC"), usdt = on.find((e) => e.symbol === "USDT");
  const stable = [usdc, usdt].find((e) => e && human(e) > 0) ?? usdc ?? usdt;
  return { stable, native: on.find((e) => e.native) };
}

export function holdings(entries: PickEntry[], query = "", priceOf: PriceOf = () => null): PickEntry[] {
  const q = query.trim().toLowerCase();
  return entries
    .filter((e) => human(e) > 0 && (!q || e.symbol.toLowerCase().includes(q) || e.name.toLowerCase().includes(q) || e.netName.toLowerCase().includes(q)))
    .sort((a, b) => worth(b, priceOf) - worth(a, priceOf) || human(b) - human(a));
}

export function receiveDefault(entries: PickEntry[], netId: string, pay: PickEntry): PickEntry | undefined {
  const { stable, native } = mainPair(entries, netId);
  const payingNative = pay.netId === netId && pay.native;
  return (payingNative ? stable : native) ?? native ?? stable;
}

export function defaultSides(entries: PickEntry[], priceOf: PriceOf): { pay: PickEntry; get: PickEntry } | null {
  const pay = holdings(entries, "", priceOf)[0];
  const get = pay && receiveDefault(entries, pay.netId, pay);
  return pay && get ? { pay, get } : null;
}

export function sidesOn(entries: PickEntry[], netId: string, priceOf: PriceOf = () => null): { pay: PickEntry; get: PickEntry } | null {
  const pay = holdings(entries.filter((e) => e.netId === netId), "", priceOf)[0] ?? entries.find((e) => e.netId === netId && e.native);
  const get = pay && receiveDefault(entries, netId, pay);
  return pay && get && !(get.netId === pay.netId && get.token === pay.token) ? { pay, get } : null;
}

const STABLE = (e: PickEntry) => e.verified && (e.symbol === "USDC" || e.symbol === "USDT");

export type Dollar = "USDT" | "USDC";

function feeReady(entries: PickEntry[], e: PickEntry): boolean {
  if (e.netId === "bitcoin" || e.native) return true;
  if (entries.some((x) => x.netId === e.netId && x.native && x.balance != null && x.balance > 0n)) return true;
  return e.netId in DROP_CHAINS && human(e) >= DROP_MIN_USD;
}

const NET_ORDER = ["arbitrum", "base", "ethereum", "bsc", "polygon", "optimism", "avalanche", "solana"];
const netRank = (id: string, home?: string | null) => (id === home ? -1 : NET_ORDER.indexOf(id) < 0 ? 99 : NET_ORDER.indexOf(id));

export function marketEntries(entries: PickEntry[], symbol: string): PickEntry[] {
  return entries.filter((e) => e.verified && e.symbol === symbol && (symbol !== "BTC" || e.netId === "bitcoin"));
}

export function pairSides(entries: PickEntry[], symbol: string, side: "buy" | "sell", priceOf: PriceOf = () => null, home?: string | null, dollar?: Dollar): { pay: PickEntry; get: PickEntry } | null {
  const coins = marketEntries(entries, symbol);
  if (!coins.length) return null;

  const pick = (list: PickEntry[]) => { const d = dollar ? list.filter((e) => e.symbol === dollar) : list; return d.length ? d : list; };
  const stableOn = (netId: string) => {
    const s = entries.filter((e) => e.netId === netId && STABLE(e));
    const d = dollar ? s.find((e) => e.symbol === dollar) : undefined;
    return d ?? s.find((e) => human(e) > 0 && e.symbol === "USDC") ?? s.find((e) => human(e) > 0) ?? s.find((e) => e.symbol === "USDC") ?? s[0];
  };
  const byHeld = (list: PickEntry[]) => [...list].sort((a, b) => worth(b, priceOf) - worth(a, priceOf) || human(b) - human(a) || netRank(a.netId, home) - netRank(b.netId, home));

  const payFirst = (list: PickEntry[]) => { const s = byHeld(list); const ok = s.filter((e) => human(e) > 0 && feeReady(entries, e)); return [...ok, ...s.filter((e) => !ok.includes(e))]; };
  if (symbol === "BTC") {
    const btc = coins[0];
    const evmStables = pick(entries.filter((e) => STABLE(e) && e.netId !== "solana" && e.netId !== "bitcoin"));
    const st = (side === "buy" ? payFirst(evmStables) : byHeld(evmStables))[0];
    return st ? (side === "buy" ? { pay: st, get: btc } : { pay: btc, get: stableOn(st.netId) ?? st }) : null;
  }
  if (side === "sell") {
    const pay = byHeld(coins)[0];
    const get = stableOn(pay.netId);
    return get ? { pay, get } : null;
  }

  const real = coins.filter((c) => !isForeignCopy(c));
  if (!real.length) return null;
  const nets = real.map((c) => c.netId);
  const st = payFirst(pick(entries.filter((e) => STABLE(e) && nets.includes(e.netId))))[0];
  if (!st) return null;
  const get = real.find((c) => c.netId === st.netId)!;
  return { pay: st, get };
}

const NARROW: readonly string[] = ["bitcoin", "tron", "dogecoin", "litecoin", "xrp", "cardano", "near"];
export function gasSides(entries: PickEntry[], netId: string, priceOf: PriceOf = () => null): { pay: PickEntry; get: PickEntry } | null {
  const get = entries.find((e) => e.netId === netId && e.native);
  if (!get) return null;
  const hasGas = (n: string) => entries.some((e) => e.netId === n && e.native && human(e) > 0);
  const pay = holdings(entries.filter((e) => e.netId !== netId && !NARROW.includes(e.netId) && (e.native || hasGas(e.netId))), "", priceOf)[0];
  return pay ? { pay, get } : null;
}

const sameKey = (a: Pick<PickEntry, "netId" | "token">, b: Pick<PickEntry, "netId" | "token">) =>
  a.netId === b.netId && (a.netId === SOL.id || a.netId === TRON.id ? a.token === b.token : a.token.toLowerCase() === b.token.toLowerCase());

export function wantSides(entries: PickEntry[], cg: string | undefined, homeNet: string | null, priceOf: (e: PickEntry) => number | null,
  payOk: (pay: PickEntry, get: PickEntry) => boolean = () => true): { pay: PickEntry; get: PickEntry } | null {
  if (!cg) return null;

  const gets = entries.filter((e) => e.price === cg && receivable(e) && !isForeignCopy(e));
  if (!gets.length) return null;
  const payers = entries.filter((e) => e.netId !== TRON.id && !sellCoinOf(e.netId, e.token));
  const same = (g: PickEntry) => holdings(payers.filter((e) => e.netId === g.netId && !sameKey(e, g) && payOk(e, g)), "", priceOf);
  const cross = (g: PickEntry) => holdings(payers.filter((e) => e.netId !== g.netId && routeOk(e.netId, g.netId) && payOk(e, g)), "", priceOf);
  const worth = (e: PickEntry | undefined) => (e ? human(e) * (priceOf(e) ?? 0) : 0);
  const get = gets.find((g) => g.netId === homeNet) ?? [...gets].sort((a, b) => worth(same(b)[0]) - worth(same(a)[0]))[0];

  const coin = (g: PickEntry) => holdings(entries.filter((e) => !!coinSwapTo(e, g) && payOk(e, g)), "", priceOf);
  const pay = same(get)[0] ?? cross(get)[0] ?? coin(get)[0] ?? entries.find((e) => e.netId === get.netId && e.native && !sameKey(e, get));
  return pay ? { pay, get } : null;
}

export const tronGetDefault = (entries: PickEntry[]) => entries.find((x) => x.netId === "arbitrum" && x.symbol === "USDT") ?? entries.find((x) => x.netId === "arbitrum" && x.symbol === "USDC");

export const sellGetDefault = (entries: PickEntry[], symbol?: string) =>
  entries.find((x) => x.netId === "arbitrum" && x.verified && x.symbol === symbol && !!sellAsset(x.netId, x.symbol)) ?? entries.find((x) => x.netId === "arbitrum" && x.verified && x.symbol === "USDC");

export interface CoinSwapStart { prefer?: { netId: string; key: string }; buy?: string; getCg?: string; none?: boolean }
export function coinSwapStart(parts: readonly { networkId: string; key: string; amount: number }[], cg: string | undefined,
  pays: (q: { networkId: string; key: string }) => boolean): CoinSwapStart {
  const held = parts.filter((q) => q.amount > 0 && pays(q)).sort((a, b) => b.amount - a.amount)[0];
  if (held) return { prefer: { netId: held.networkId, key: held.key } };

  if (parts.some((q) => q.amount > 0)) return { none: true };
  const top = [...parts].sort((a, b) => b.amount - a.amount)[0];
  const extra = (top ? extraById(top.networkId) : undefined) ?? EXTRA_COINS.find((e) => e.coingecko === cg);
  if (extra) return extra.noSwap ? { none: true } : { buy: extra.id };
  return cg && !cg.includes(":") ? { getCg: cg } : {};
}

const tokKey = (netId: string, token: string) => `${netId}|${netId === SOL.id || netId === TRON.id ? token : token.toLowerCase()}`;
const preferEntry = (entries: PickEntry[], prefer: { netId: string; key: string } | undefined) =>
  prefer ? entries.find((e) => e.netId === prefer.netId && (prefer.key === "native" ? !!e.native : tokKey(e.netId, e.token) === tokKey(prefer.netId, prefer.key))) : undefined;

export const startWaitsFor = (entries: PickEntry[], prefer: { netId: string; key: string } | undefined, buy: string | undefined) =>
  prefer ? preferEntry(entries, prefer) : buy ? entries.find((e) => e.netId === buy && e.native) : undefined;

export function heldSides(entries: PickEntry[], prefer: { netId: string; key: string } | undefined, buy: string | undefined): {
  want: PickEntry | undefined; preferred: { pay: PickEntry; get: PickEntry } | null; buyE: PickEntry | undefined } {
  const want = preferEntry(entries, prefer);
  const wantHeld = !!want && !!want.balance && want.balance > 0n;
  const buy0 = buy ? entries.find((e) => e.netId === buy) : want && !wantHeld && extraById(want.netId) ? want : undefined;
  const sellHome = !want && buy0 && buy0.balance && buy0.balance > 0n ? buy0 : undefined;
  const payWith = wantHeld ? want : sellHome;

  const get = payWith ? (sellCoinOf(payWith.netId, payWith.token) ? sellGetDefault(entries) : payWith.netId === TRON.id ? tronGetDefault(entries) : receiveDefault(entries, payWith.netId, payWith)) : undefined;
  return { want, preferred: payWith && get ? { pay: payWith, get } : null, buyE: sellHome ? undefined : buy0 };
}

export function nativeTradeSides(entries: PickEntry[], netId: string, side: "buy" | "sell", routePay: PickEntry | undefined): { pay: PickEntry; get: PickEntry } | null {
  const coin = entries.find((e) => e.netId === netId && e.native);
  if (!coin) return null;
  if (side === "sell") { const g = sellGetDefault(entries); return g ? { pay: coin, get: g } : null; }
  const pay = routePay ?? sellGetDefault(entries);
  return pay ? { pay, get: coin } : null;
}
