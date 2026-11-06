import { evmAddress } from "./account";
import { TON, tonAddress, tonBalances } from "./tonbase";
import { isImportedIndex } from "./imported";
import { BTC, btcAddress, btcBalance, formatBtc } from "./btcbase";
import { activeNetworks, visibleTokens } from "./chains";
import { balances, fetchPrices } from "./chainops";
import { formatUnitsStr, SOL, solAddress, solBalances } from "./solbase";
import { TRON, tronAddress, tronBalances } from "./tronbase";
import { EXTRA_COINS, extraAmount } from "./natives";
import type { Settings } from "./store";

type Cur = "usd" | "sar";
const KEY = "acctTotals";
type Cache = Record<string, { at: number; value: number }>;
const cacheKey = (evm: string, cur: string) => `${evm.toLowerCase()}|${cur}`;

export async function accountTotal(phrase: string, index: number, s: Pick<Settings, "enabledTokens" | "customTokens" | "currency" | "networksOn">): Promise<number> {
  const cur = s.currency.toLowerCase() as Cur;
  const evm = evmAddress(phrase, index);
  const solTokens = visibleTokens(SOL, s.enabledTokens, s.customTokens);
  const nets = activeNetworks(s).map((n) => ({ n, tokens: visibleTokens(n, s.enabledTokens, s.customTokens) }));
  const ids = [BTC.coingecko, SOL.coingecko, TRON.coingecko, TON.coingecko, ...EXTRA_COINS.map((c) => c.coingecko), ...TRON.tokens.map((x) => x.coingecko ?? ""), ...solTokens.map((x) => x.coingecko ?? ""), ...nets.flatMap(({ n, tokens }) => [n.native.coingecko, ...tokens.map((x) => x.coingecko ?? "")])];
  const custom = [...solTokens.filter((x) => !x.coingecko).map((x) => ({ platform: SOL.cgPlatform, address: x.address })), ...nets.flatMap(({ n, tokens }) => tokens.filter((x) => !x.coingecko).map((x) => ({ platform: n.cgPlatform, address: x.address })))];
  const prices = await fetchPrices(ids, cur, custom);
  const val = (amount: number, key?: string) => (amount > 0 && key && prices[key] ? amount * prices[key].price : 0);
  const parts = await Promise.all([

    ...(isImportedIndex(index) ? [] : [
    btcBalance(btcAddress(phrase, index)).then((b) => val(Number(formatBtc(b.confirmed + b.pending)), BTC.coingecko)).catch(() => 0),
    solBalances(solAddress(phrase, index), solTokens.map((x) => x.address)).then((b) =>
      val(Number(formatUnitsStr(b.lamports, 9)), SOL.coingecko) +
      solTokens.reduce((t, x) => t + val(Number(formatUnitsStr(b.tokens.get(x.address) ?? 0n, x.decimals)), x.coingecko ?? `${SOL.cgPlatform}:${x.address.toLowerCase()}`), 0)).catch(() => 0),
    tronBalances(tronAddress(phrase, index)).then((b) => val(Number(formatUnitsStr(b.sun, 6)), TRON.coingecko) + val(Number(formatUnitsStr(b.usdt, 6)), TRON.tokens[0].coingecko)).catch(() => 0),
    tonBalances(tonAddress(phrase, index)).then((b) => val(Number(formatUnitsStr(b.nano, 9)), TON.coingecko) + val(Number(formatUnitsStr(b.usdt, 6)), "tether")).catch(() => 0),
    ...EXTRA_COINS.map((c) => c.balance(c.address(phrase, index)).then((b) => val(Number(extraAmount(c, b.total)), c.coingecko)).catch(() => 0)),
    ]),
    ...nets.map(({ n, tokens }) => balances(n, evm, tokens, prices).then((list) => list.reduce((t, a) => t + (a.value ?? 0), 0)).catch(() => 0)),
  ]);
  return parts.reduce((a, b) => a + b, 0);
}

export async function cachedTotal(evm: string, cur: string): Promise<{ at: number; value: number } | null> {
  const all = ((await chrome.storage.local.get(KEY))[KEY] as Cache | undefined) ?? {};
  return all[cacheKey(evm, cur)] ?? null;
}
export async function saveTotal(evm: string, cur: string, value: number): Promise<void> {
  const all = ((await chrome.storage.local.get(KEY))[KEY] as Cache | undefined) ?? {};
  await chrome.storage.local.set({ [KEY]: { ...all, [cacheKey(evm, cur)]: { at: Date.now(), value } } });
}

export function dayChange(parts: { value: number | null; change: number | null }[]): { abs: number; pct: number } | null {
  let now = 0, before = 0, any = false;
  for (const p of parts) {
    if (p.value == null || !(p.value > 0) || !Number.isFinite(p.value)) continue;
    const c = p.change != null && Number.isFinite(p.change) && p.change > -100 ? p.change : 0;
    now += p.value; before += p.value / (1 + c / 100); any = true;
  }
  if (!any || !(before > 0)) return null;
  return { abs: now - before, pct: ((now - before) / before) * 100 };
}
