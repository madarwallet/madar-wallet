import { evmAddress } from "./account";
import { BTC, btcAddress } from "./btcbase";
import { activeNetworks, networkById, visibleTokens } from "./chains";
import { SOL, solAddress } from "./solbase";
import type { ActivityItem, Settings } from "./store";
import { fetchIO, mergePlan, readCoin, WATCH_KEY, withTx, type WatchCoin, type WatchPlan, type WatchTexts, type WatchTx } from "./watch";
import { ANDROID, androidPost } from "../platform";

const BTC_APIS = ["https://mempool.space/api", "https://blockstream.info/api"];

const TOKENS_PER_NET = 4;

export interface PlanTexts extends WatchTexts { send: string; swap: string }

export async function loadPlan(): Promise<(WatchPlan & { texts: PlanTexts }) | null> {
  try { return ((await chrome.storage.local.get(WATCH_KEY))[WATCH_KEY] as (WatchPlan & { texts: PlanTexts }) | undefined) ?? null; } catch { return null; }
}
export async function savePlan(p: WatchPlan | null): Promise<void> {
  if (p) await chrome.storage.local.set({ [WATCH_KEY]: p }); else await chrome.storage.local.remove(WATCH_KEY);
  if (ANDROID) androidPost({ t: "watch", plan: p ? JSON.stringify(p) : "" });
}

export async function buildPlan(phrase: string, s: Settings, texts: PlanTexts): Promise<WatchPlan> {
  const idx = s.accountIndex, evm = evmAddress(phrase, idx);
  const coins: WatchCoin[] = [];
  for (const n of activeNetworks(s)) {
    coins.push({ id: `${n.id}:native`, kind: "evm", urls: [...n.rpcs], address: evm, symbol: n.native.symbol, decimals: n.chain.nativeCurrency.decimals, net: n.name, last: null });

    const toks = visibleTokens(n, s.enabledTokens, []).filter((t) => t.verified !== false)
      .sort((a, b) => Number(/^USD[CT₮]/.test(b.symbol)) - Number(/^USD[CT₮]/.test(a.symbol))).slice(0, TOKENS_PER_NET);
    for (const tk of toks) coins.push({ id: `${n.id}:${tk.address.toLowerCase()}`, kind: "evm", urls: [...n.rpcs], address: evm, token: tk.address, symbol: tk.symbol, decimals: tk.decimals, net: n.name, last: null });
  }
  const btcA = btcAddress(phrase, idx), solA = solAddress(phrase, idx);
  if (btcA) coins.push({ id: "bitcoin:native", kind: "btc", urls: BTC_APIS, address: btcA, symbol: "BTC", decimals: BTC.decimals, net: BTC.name, last: null });
  if (solA) coins.push({ id: "solana:native", kind: "sol", urls: [...SOL.rpcs], address: solA, symbol: "SOL", decimals: 9, net: SOL.name, last: null });
  await Promise.all(coins.map(async (c) => { try { c.last = (await readCoin(fetchIO, c)).toString(); } catch {  } }));
  return { v: 1, on: true, coins, txs: [], done: [], texts, at: Date.now() };
}

export async function refreshPlan(phrase: string, s: Settings, texts: PlanTexts): Promise<void> {
  await savePlan(mergePlan(await buildPlan(phrase, s, texts), await loadPlan()));
}

export function txOf(a: ActivityItem, texts: PlanTexts, now = Date.now()): WatchTx | null {
  const n = networkById(a.networkId);
  const what = `${a.kind === "swap" ? texts.swap : texts.send} ${a.amount} ${a.asset}`.replace(/\s+/g, " ").trim();
  if (n) return { hash: a.hash, kind: "evm", urls: [...n.rpcs], net: n.name, label: `${what} · ${n.name}`, link: `${n.explorer}/tx/${a.hash}`, at: now };
  if (a.networkId === SOL.id) return { hash: a.hash, kind: "sol", urls: [...SOL.rpcs], net: SOL.name, label: `${what} · ${SOL.name}`, link: `${SOL.explorer}/tx/${a.hash}`, at: now };
  if (a.networkId === BTC.id) return { hash: a.hash, kind: "btc", urls: BTC_APIS, net: BTC.name, label: `${what} · ${BTC.name}`, link: `${BTC.explorer}/tx/${a.hash}`, at: now };
  return null;
}

export async function watchSent(a: ActivityItem): Promise<void> {
  const p = await loadPlan();
  if (!p?.on) return;
  const x = txOf(a, p.texts);
  if (x) await savePlan(withTx(p, x));
}
