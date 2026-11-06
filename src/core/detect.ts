import { base58, base64 } from "@scure/base";
import { erc20Abi, getAddress, type Address } from "viem";
import { activeNetworks, ALL_NETWORKS, NETWORKS, networkById, visibleTokens, withTokenOn, type Network, type Token } from "./chains";
import { fetchPrices, publicClient } from "./chainops";
import { cgGet } from "./coingecko";
import { demoOn } from "./demo";
import { tokenTransferRows, type EsTokenTx } from "./history";
import { ataAddress, cleanTokenText, formatUnitsStr, isSolAddress, programAddress, SOL, solRpc, TOKEN_PROGRAM, WSOL_MINT } from "./solbase";
import { TRON } from "./tronbase";
import type { Settings } from "./store";

type Cur = "usd" | "sar";

export interface Found {
  networkId: string;
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  raw: string;
  verified: boolean;
  price: number | null;
}

const lc = (s: unknown) => String(s ?? "").toLowerCase();
const big = (s: unknown): bigint => { try { return BigInt(String(s ?? "0")); } catch { return 0n; } };

export const addrKey = (networkId: string, a: string) => (networkId === SOL.id ? String(a) : lc(a));

const LOOK: Record<string, string> = {

  "\u0430": "a", "\u0432": "b", "\u0435": "e", "\u0451": "e", "\u043a": "k", "\u043c": "m", "\u043d": "h", "\u043e": "o", "\u0440": "p", "\u0441": "c", "\u0442": "t", "\u0443": "y", "\u0445": "x", "\u0455": "s", "\u0456": "l", "\u0457": "l", "\u0458": "j", "\u0501": "d", "\u051b": "q", "\u051d": "w", "\u04af": "y", "\u04bb": "h", "\u0493": "f",

  "\u0397": "h", "\u039d": "n", "\u03a5": "y", "\u039c": "m", "\u03b1": "a", "\u03b2": "b", "\u03b3": "y", "\u03b5": "e", "\u03b7": "n", "\u03b9": "l", "\u03ba": "k", "\u03bd": "v", "\u03bf": "o", "\u03c1": "p", "\u03c4": "t", "\u03c5": "u", "\u03c7": "x", "\u03b6": "z", "\u03bc": "u", "\u03c9": "w", "\u03f2": "c", "\u03f3": "j",

  "\u0585": "o", "\u057d": "u", "\u0581": "g", "\u0570": "h", "\u0578": "n",

  "\u13aa": "a", "\u13f4": "b", "\u13df": "c", "\u13a0": "d", "\u13ac": "e", "\u13c0": "g", "\u13bb": "h", "\u13ab": "j", "\u13e6": "k", "\u13de": "l", "\u13b7": "m", "\u13e2": "p", "\u13da": "s", "\u13a2": "t", "\u13d9": "v", "\u13b3": "w", "\u13c3": "z", "\u13cc": "u", "\u13a9": "y", "\u13d2": "r", "\u13d4": "w", "\u13a5": "l",

  "0": "o", "1": "l", "\u0261": "g", "\u0131": "l", "\u2113": "l", "$": "s", "\u20ae": "t", "\u20ac": "e", "\u00a2": "c", "i": "l", "|": "l", "!": "l",
};

export function skeleton(s: string): string {
  let out = "";
  for (const ch of String(s ?? "").normalize("NFKC")) out += LOOK[ch] ?? LOOK[ch.toLowerCase()] ?? LOOK[ch.toUpperCase()] ?? ch.toLowerCase();
  return out.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
}

const VERIFIED: Token[] = [...ALL_NETWORKS.flatMap((n) => n.tokens), ...SOL.tokens, ...TRON.tokens];

const TAKEN = new Set([
  ...VERIFIED.flatMap((t) => [t.symbol, t.name]),
  ...NETWORKS.map((n) => n.name),
  ...ALL_NETWORKS.flatMap((n) => [n.native.symbol, n.native.name]),
  "BTC", "Bitcoin", "SOL", "Solana", "TRX", "Tron", "MATIC", "USD", "US Dollar", "Ethereum", "Binance", "WBNB", "WPOL", "WMATIC", "WAVAX", "WSOL",
  "DOGE", "Dogecoin", "LTC", "Litecoin", "XRP", "Ripple", "XRP Ledger",
].map(skeleton).filter((s) => s.length > 0));

const STABLE_ROOTS = ["usdc", "usdt", "tether"];
const LINKISH = /https?:|www\.|t\.me\/|\.(com|io|net|org|xyz|app|site|online|top|pro|gift|link|vip|cc|me|co|club|fun|live|info|us|finance|website|space|tech|ai|network|cash|bet|win|shop|store|lol|bond|today|world|digital)\b/i;
const LURE = /claim|visit|reward|airdrop|bonus|voucher|redeem|giveaway|eligible|gift|prize|winner|\bfree\b/i;
const HIDDEN = /[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/;
const OTHER_LETTERS = /[\u0370-\u03ff\u0400-\u052f\u0530-\u058f\u13a0-\u13ff\uab70-\uabbf\ua4d0-\ua4ff]/;

export type Refusal = "lookalike" | "text";

export function refuseText(symbol: string, name: string): Refusal | null {
  const sym = String(symbol ?? ""), nm = String(name ?? "");
  if (!cleanTokenText(sym, 64) || HIDDEN.test(sym) || HIDDEN.test(nm) || sym.trim().length > 16 || nm.trim().length > 64) return "text";
  if (LINKISH.test(sym) || LINKISH.test(nm) || LURE.test(sym) || LURE.test(nm)) return "text";
  if (/[a-z]/i.test(sym) && OTHER_LETTERS.test(sym)) return "lookalike";
  const ss = skeleton(sym), sn = skeleton(nm);
  if (TAKEN.has(ss) || (sn && TAKEN.has(sn))) return "lookalike";
  if (STABLE_ROOTS.some((r) => ss.includes(r) || sn.includes(r))) return "lookalike";
  return null;
}

export const DUST: Record<Cur, number> = { usd: 0.1, sar: 0.4 };
export type Skip = "zero" | "noprice" | "dust";

export function judgeAmount(raw: bigint, decimals: number, price: number | null | undefined, cur: Cur, verified = false): Skip | null {
  if (raw <= 0n) return "zero";
  if (price == null || !(price > 0)) return verified ? null : "noprice";
  return Number(formatUnitsStr(raw, decimals)) * price < DUST[cur] ? "dust" : null;
}

export interface Hint { address: string; symbol: string; name: string; at: number }

export function incomingContracts(me: string, rows: EsTokenTx[], known: ReadonlySet<string>): Hint[] {
  const my = lc(me), seen = new Map<string, Hint>();
  for (const r of rows) {
    const a = lc(r.contractAddress);
    if (!/^0x[0-9a-f]{40}$/.test(a) || known.has(a) || lc(r.to) !== my || lc(r.from) === my || big(r.value) <= 0n) continue;
    const at = Number(r.timeStamp) * 1000 || 0, h = seen.get(a);
    if (!h || at > h.at) seen.set(a, { address: a, symbol: String(r.tokenSymbol ?? ""), name: String(r.tokenName ?? ""), at });
  }
  return [...seen.values()].sort((x, y) => y.at - x.at);
}

export interface Held { mint: string; account: string; raw: bigint }

export function solHeld(owner: string, j: unknown, want: (mint: string) => boolean): Held[] {
  const tokens = (j as { tokens?: unknown })?.tokens;
  if (!tokens || typeof tokens !== "object") return [];
  const out: Held[] = [];
  for (const [mint, list] of Object.entries(tokens as Record<string, unknown>)) {
    if (!Array.isArray(list) || !want(mint) || !isSolAddress(mint)) continue;
    for (const x of list as Record<string, unknown>[]) {
      const raw = big(x?.amount);
      if (x?.programId !== TOKEN_PROGRAM || typeof x.account !== "string" || raw <= 0n) continue;
      if (x.account !== ataAddress(owner, mint)) continue;
      out.push({ mint, account: x.account, raw });
      break;
    }
  }
  return out;
}

export const METADATA_PROGRAM = "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s";

export const metadataAddress = (mint: string) => programAddress([new TextEncoder().encode("metadata"), base58.decode(METADATA_PROGRAM), base58.decode(mint)], METADATA_PROGRAM);

export function parseMetaplex(data: Uint8Array, mint: string): { name: string; symbol: string } | null {
  if (data.length < 73 || data[0] !== 4 || base58.encode(data.subarray(33, 65)) !== mint) return null;
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let o = 65;
  const str = (max: number): string | null => {
    if (o + 4 > data.length) return null;
    const n = dv.getUint32(o, true);
    o += 4;
    if (n > max || o + n > data.length) return null;
    const s = new TextDecoder().decode(data.subarray(o, o + n));
    o += n;
    return s.replace(/\0+$/, "");
  };
  const name = str(64), symbol = str(32);
  return name == null || symbol == null ? null : { name, symbol };
}

export interface OnChain { symbol: string; name: string; decimals: number; raw: bigint }
export interface Readers {

  chain: (address: string) => Promise<OnChain | null>;

  price: (address: string) => Promise<number | null | undefined>;
}
const DAY = 24 * 3600_000, RECHECK = 6 * 3600_000;

export type Refused = Record<string, number>;
export const isRefused = (refused: Refused, key: string, now: number) => key in refused && (refused[key] === 0 || refused[key] > now);

export async function screen(networkId: string, hints: Hint[], read: Readers, refused: Refused, now: number, cur: Cur): Promise<{ found: Found[]; pending: boolean }> {
  const found: Found[] = [];
  let pending = false;
  for (const h of hints) {
    const k = addrKey(networkId, h.address);
    if (isRefused(refused, k, now)) continue;
    if (h.symbol && refuseText(h.symbol, h.name)) { refused[k] = 0; continue; }
    const c = await read.chain(h.address).catch(() => null);
    if (!c) { refused[k] = now + DAY; continue; }
    if (refuseText(c.symbol, c.name)) { refused[k] = 0; continue; }
    if (c.raw <= 0n) { refused[k] = now + RECHECK; continue; }
    const price = await read.price(h.address).catch(() => undefined);
    if (price === undefined) { pending = true; continue; }
    const skip = judgeAmount(c.raw, c.decimals, price, cur);
    if (skip) { refused[k] = now + (skip === "noprice" ? DAY : RECHECK); continue; }
    found.push({ networkId, address: h.address, symbol: cleanTokenText(c.symbol, 12), name: cleanTokenText(c.name, 40), decimals: c.decimals, raw: c.raw.toString(), verified: false, price });
  }
  return { found, pending };
}

export const ignoreKey = (networkId: string, owner: string, address: string) => `${networkId}|${addrKey(networkId, owner)}|${addrKey(networkId, address)}`;
const netOf = (id: string) => (id === SOL.id ? SOL : networkById(id));

export function isShown(s: Pick<Settings, "enabledTokens" | "customTokens">, networkId: string, address: string): boolean {
  const n = netOf(networkId);
  if (!n) return true;
  const a = addrKey(networkId, address);
  return visibleTokens(n, s.enabledTokens, s.customTokens).some((t) => addrKey(networkId, t.address) === a);
}

export function offers(found: Found[], s: Pick<Settings, "enabledTokens" | "customTokens">, ignored: ReadonlySet<string>, owners: Record<string, string>): Found[] {
  const value = (f: Found) => (f.price == null ? 0 : Number(formatUnitsStr(big(f.raw), f.decimals)) * f.price);
  return found
    .filter((f) => owners[f.networkId] && !ignored.has(ignoreKey(f.networkId, owners[f.networkId], f.address)) && !isShown(s, f.networkId, f.address) && (f.verified || !refuseText(f.symbol, f.name)))
    .sort((a, b) => value(b) - value(a));
}

export function addPatch(s: Pick<Settings, "enabledTokens" | "customTokens">, f: Found): Partial<Settings> | null {
  const n = netOf(f.networkId);
  if (!n) return null;
  const a = addrKey(f.networkId, f.address);
  const verified = n.tokens.some((t) => addrKey(f.networkId, t.address) === a);
  if (verified) { const e = withTokenOn(n, s.enabledTokens, f.address); return e ? { enabledTokens: e } : null; }
  if (f.verified || refuseText(f.symbol, f.name) || s.customTokens.some((c) => c.networkId === f.networkId && addrKey(f.networkId, c.address) === a)) return null;
  if (f.networkId === SOL.id ? !isSolAddress(f.address) : !/^0x[0-9a-fA-F]{40}$/.test(f.address)) return null;
  if (!Number.isInteger(f.decimals) || f.decimals < 0 || f.decimals > 36) return null;
  const address = (f.networkId === SOL.id ? f.address : getAddress(f.address)) as `0x${string}`;
  return { customTokens: [...s.customTokens, { networkId: f.networkId, address, symbol: cleanTokenText(f.symbol, 12), name: cleanTokenText(f.name, 40), decimals: f.decimals }] };
}

const IGNORE_KEY = "tokenIgnore";
export async function loadIgnored(): Promise<Set<string>> {
  try { const v = (await chrome.storage.local.get(IGNORE_KEY))?.[IGNORE_KEY]; return new Set(Array.isArray(v) ? v.map(String) : []); } catch { return new Set(); }
}
export async function ignoreToken(key: string): Promise<void> {
  const all = [...(await loadIgnored())].filter((k) => k !== key);
  await chrome.storage.local.set({ [IGNORE_KEY]: [...all, key].slice(-500) });
}

const PRICE_KEY = "tokenPrices";
export const CG_PER_WINDOW = 3, CG_WINDOW = 5 * 60_000;
const CG_GAP = 3_000, PRICE_OK_MS = 30 * 60_000;
type PriceState = { used: number[]; p: Record<string, { at: number; v: number | null }> };
let cgLine: Promise<unknown> = Promise.resolve();
function inLine<T>(f: () => Promise<T>): Promise<T> {
  const p = cgLine.then(f, f);
  cgLine = p.catch(() => {});
  return p;
}

export function tokenPrice(platform: string, address: string, cur: Cur): Promise<number | null | undefined> {
  const a = platform === SOL.cgPlatform ? address : lc(address);
  if (!/^[a-z0-9-]+$/.test(platform) || !(platform === SOL.cgPlatform ? isSolAddress(a) : /^0x[0-9a-f]{40}$/.test(a))) return Promise.resolve(null);
  const k = `${cur}|${platform}:${a}`;
  return inLine(async () => {
    const st = ((await chrome.storage.local.get(PRICE_KEY))?.[PRICE_KEY] as PriceState | undefined) ?? { used: [], p: {} };
    const hit = st.p?.[k], now = Date.now();
    if (hit && now - hit.at < (hit.v == null ? DAY : PRICE_OK_MS)) return hit.v;
    st.used = (st.used ?? []).filter((x) => now - x < CG_WINDOW && x <= now);
    if (st.used.length >= CG_PER_WINDOW) return undefined;
    const last = st.used[st.used.length - 1];
    if (last && now - last < CG_GAP) await new Promise((r) => setTimeout(r, CG_GAP - (now - last)));
    st.used.push(Date.now());
    const save = () => chrome.storage.local.set({ [PRICE_KEY]: st }).catch?.(() => {});
    let v: number | null;
    try {
      const j = (await cgGet(`simple/token_price/${platform}?contract_addresses=${a}&vs_currencies=${cur}`)) as Record<string, Record<string, number>>;
      const row = Object.entries(j ?? {}).find(([x]) => (platform === SOL.cgPlatform ? x === a : lc(x) === a))?.[1];
      const p = row?.[cur];
      v = typeof p === "number" && Number.isFinite(p) && p > 0 ? p : null;
    } catch { await save(); return undefined; }
    st.p = { ...st.p, [k]: { at: Date.now(), v } };
    const keys = Object.keys(st.p);
    for (const x of keys.slice(0, Math.max(0, keys.length - 300))) delete st.p[x];
    await save();
    return v;
  });
}

const UNKNOWN_PER_RUN = 6;

async function detectEvm(n: Network, me: Address, s: Settings, cur: Cur, refused: Refused, now: number): Promise<{ found: Found[]; pending: boolean }> {
  const c = publicClient(n);
  const found: Found[] = [];

  const shown = new Set(visibleTokens(n, s.enabledTokens, s.customTokens).map((t) => lc(t.address)));
  const off = n.tokens.filter((t) => !shown.has(lc(t.address)));
  if (off.length) {
    const r = await c.multicall({ allowFailure: true, contracts: off.map((t) => ({ address: t.address, abi: erc20Abi, functionName: "balanceOf" as const, args: [me] as const })) });
    const held = off.map((t, i) => ({ t, raw: r[i]?.status === "success" ? (r[i].result as bigint) : 0n })).filter((x) => x.raw > 0n);
    if (held.length) {
      const p = await fetchPrices(held.map((x) => x.t.coingecko ?? "").filter(Boolean), cur).catch(() => ({}) as Record<string, { price: number }>);
      for (const { t, raw } of held) {
        const price = (t.coingecko && p[t.coingecko]?.price) || null;
        if (!judgeAmount(raw, t.decimals, price, cur, true)) found.push({ networkId: n.id, address: t.address, symbol: t.symbol, name: t.name, decimals: t.decimals, raw: raw.toString(), verified: true, price });
      }
    }
  }

  const rows = await tokenTransferRows(n, me).catch(() => null);
  if (!rows) return { found, pending: false };
  const known = new Set([...n.tokens.map((t) => lc(t.address)), ...s.customTokens.filter((x) => x.networkId === n.id).map((x) => lc(x.address))]);
  const hints = incomingContracts(me, rows, known).filter((h) => !isRefused(refused, h.address, now));
  const r = await screen(n.id, hints.slice(0, UNKNOWN_PER_RUN).map((h) => ({ ...h, address: getAddress(h.address) })), {
    chain: async (address) => {
      const a = address as Address;
      const x = await c.multicall({ allowFailure: true, contracts: [
        { address: a, abi: erc20Abi, functionName: "symbol" }, { address: a, abi: erc20Abi, functionName: "name" },
        { address: a, abi: erc20Abi, functionName: "decimals" }, { address: a, abi: erc20Abi, functionName: "balanceOf", args: [me] },
      ] });
      if (x[0].status !== "success" || x[2].status !== "success" || x[3].status !== "success") return null;
      const decimals = Number(x[2].result);
      if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) return null;
      return { symbol: String(x[0].result), name: x[1].status === "success" ? String(x[1].result) : "", decimals, raw: x[3].result as bigint };
    },
    price: (address) => tokenPrice(n.cgPlatform, address, cur),
  }, refused, now, cur);
  return { found: [...found, ...r.found], pending: r.pending || hints.length > UNKNOWN_PER_RUN };
}

const JUP_HOLDINGS = "https://lite-api.jup.ag/ultra/v1/holdings/";

async function solHoldings(owner: string): Promise<unknown> {
  try {
    const r = await fetch(JUP_HOLDINGS + owner, { cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer", signal: AbortSignal.timeout(10_000) });
    if (r.ok) return await r.json();
  } catch {  }
  type Row = { pubkey: string; account: { owner: string; data: { parsed?: { info?: { mint?: string; tokenAmount?: { amount?: string } } } } } };
  const v = (await solRpc<{ value: Row[] }>("getTokenAccountsByOwner", [owner, { programId: TOKEN_PROGRAM }, { encoding: "jsonParsed", commitment: "confirmed" }])).value ?? [];
  const tokens: Record<string, unknown[]> = {};
  for (const x of v) { const m = x.account?.data?.parsed?.info?.mint; if (m) (tokens[m] ??= []).push({ account: x.pubkey, amount: x.account.data.parsed?.info?.tokenAmount?.amount, programId: x.account.owner }); }
  return { tokens };
}

type ParsedAcc = { owner: string; data: { parsed?: { type?: string; info?: { decimals?: number; mint?: string; owner?: string; tokenAmount?: { amount?: string } } } } | [string, string] } | null;
async function detectSol(owner: string, s: Settings, cur: Cur, refused: Refused, now: number): Promise<{ found: Found[]; pending: boolean }> {
  const shown = new Set(visibleTokens(SOL, s.enabledTokens, s.customTokens).map((t) => t.address as string));
  const off = new Map<string, Token>(SOL.tokens.filter((t) => !shown.has(t.address)).map((t) => [t.address as string, t]));
  const known = new Set<string>([...SOL.tokens.map((t) => t.address as string), WSOL_MINT, ...s.customTokens.filter((c) => c.networkId === SOL.id).map((c) => c.address as string)]);
  const held = solHeld(owner, await solHoldings(owner), (m) => off.has(m) || (!known.has(m) && !isRefused(refused, m, now)));
  const offs = held.filter((h) => off.has(h.mint)), unknown = held.filter((h) => !off.has(h.mint));
  const list = [...offs, ...unknown.slice(0, UNKNOWN_PER_RUN)];
  if (!list.length) return { found: [], pending: false };

  const accs = (await solRpc<{ value: ParsedAcc[] }>("getMultipleAccounts", [[...list.map((h) => h.mint), ...list.map((h) => h.account)], { encoding: "jsonParsed", commitment: "confirmed" }])).value ?? [];
  const chain = new Map<string, { decimals: number; raw: bigint }>();
  list.forEach((h, i) => {
    const m = accs[i], a = accs[list.length + i];
    const mi = m && !Array.isArray(m.data) ? m.data.parsed : undefined, ai = a && !Array.isArray(a.data) ? a.data.parsed : undefined;
    if (m?.owner !== TOKEN_PROGRAM || mi?.type !== "mint" || a?.owner !== TOKEN_PROGRAM || ai?.type !== "account") return;
    if (ai.info?.mint !== h.mint || ai.info?.owner !== owner) return;
    const decimals = Number(mi.info?.decimals);
    if (Number.isInteger(decimals) && decimals >= 0 && decimals <= 36) chain.set(h.mint, { decimals, raw: big(ai.info?.tokenAmount?.amount) });
  });
  const found: Found[] = [];

  const vo = offs.filter((h) => { const c = chain.get(h.mint), t = off.get(h.mint)!; return c && c.raw > 0n && c.decimals === t.decimals; });
  if (vo.length) {
    const p = await fetchPrices(vo.map((h) => off.get(h.mint)!.coingecko ?? "").filter(Boolean), cur).catch(() => ({}) as Record<string, { price: number }>);
    for (const h of vo) {
      const t = off.get(h.mint)!, raw = chain.get(h.mint)!.raw, price = (t.coingecko && p[t.coingecko]?.price) || null;
      if (!judgeAmount(raw, t.decimals, price, cur, true)) found.push({ networkId: SOL.id, address: t.address, symbol: t.symbol, name: t.name, decimals: t.decimals, raw: raw.toString(), verified: true, price });
    }
  }

  const unk = list.filter((h) => !off.has(h.mint));
  const meta = new Map<string, { name: string; symbol: string }>();
  if (unk.length) {
    const ms = (await solRpc<{ value: ({ owner: string; data: [string, string] } | null)[] }>("getMultipleAccounts", [unk.map((h) => metadataAddress(h.mint)), { encoding: "base64", dataSlice: { offset: 0, length: 200 }, commitment: "confirmed" }])).value ?? [];
    unk.forEach((h, i) => {
      const x = ms[i];
      if (x?.owner !== METADATA_PROGRAM || !Array.isArray(x.data)) return;
      try { const md = parseMetaplex(base64.decode(x.data[0]), h.mint); if (md) meta.set(h.mint, md); } catch {  }
    });
  }
  const r = await screen(SOL.id, unk.map((h) => ({ address: h.mint, symbol: "", name: "", at: 0 })), {
    chain: async (mint) => { const c = chain.get(mint), md = meta.get(mint); return c && md ? { ...md, ...c } : null; },
    price: (mint) => tokenPrice(SOL.cgPlatform, mint, cur),
  }, refused, now, cur);
  return { found: [...found, ...r.found], pending: r.pending || unknown.length > UNKNOWN_PER_RUN };
}

type State = { at: number; next: number; cur: string; found: Found[]; refused: Refused };
export const DETECT_TTL = 15 * 60_000;
const RETRY = 3 * 60_000, FORCE_MIN = 60_000;
const stateKey = (networkId: string, owner: string) => `tokenDetect:${networkId}:${addrKey(networkId, owner)}`;
const inflight = new Map<string, Promise<Found[]>>();

export const detectNets = (s: { networksOn?: readonly string[] } | null | undefined): string[] => [...activeNetworks(s).map((n) => n.id), SOL.id];
export const DETECT_NETS: readonly string[] = detectNets(null);

export function detect(networkId: string, owner: string, s: Settings, force = false): Promise<Found[]> {
  if (import.meta.env.DEV) {
    const d = (globalThis as { __DEMO_DETECT__?: Found[] }).__DEMO_DETECT__;
    if (d || demoOn()) return Promise.resolve((d ?? []).filter((f) => f.networkId === networkId));
  }
  const key = stateKey(networkId, owner);
  const run = inflight.get(key);
  if (run) return run;
  const p = (async () => {
    const cur = s.currency.toLowerCase() as Cur;
    const st = ((await chrome.storage.local.get(key))?.[key] as State | undefined) ?? null;
    const now = Date.now();
    if (st && st.cur === cur && (force ? now - st.at < FORCE_MIN : now < st.next && st.at <= now)) return st.found;
    const refused: Refused = { ...(st?.refused ?? {}) };
    let r: { found: Found[]; pending: boolean };
    try {
      const n = networkById(networkId);
      if (networkId === SOL.id) r = await detectSol(owner, s, cur, refused, now);
      else if (n) r = await detectEvm(n, owner as Address, s, cur, refused, now);
      else return [];
    } catch {
      const keep = st && st.cur === cur ? st.found : [];
      await chrome.storage.local.set({ [key]: { at: now, next: now + RETRY, cur, found: keep, refused } }).catch?.(() => {});
      return keep;
    }
    for (const [k, until] of Object.entries(refused)) if (until !== 0 && until <= now) delete refused[k];
    const ks = Object.keys(refused);
    for (const k of ks.slice(0, Math.max(0, ks.length - 400))) delete refused[k];
    await chrome.storage.local.set({ [key]: { at: now, next: now + (r.pending ? RETRY : DETECT_TTL), cur, found: r.found, refused } });
    return r.found;
  })().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}
