import { RefreshCw, ArrowDownLeft, ArrowLeftRight, Check, ChevronDown, Clock, CreditCard, ExternalLink, Globe, ShieldAlert, TriangleAlert, Wallet as WalletIcon, X, Info, Fuel } from "lucide-react";
import { isImportedIndex } from "../core/imported";
import { useEffect, useMemo, useRef, useState } from "react";
import { erc20Abi, type Address, type Hash } from "viem";
import { evmAddress } from "../core/account";
import { BTC, btcAddress, btcBalance, btcFees, clampFeeRate, formatBtc, btcWaitInfo } from "../core/btcbase";
import { btcPendingOf, btcSalePending, btcSpendable, broadcastBtc, quoteBtcSend, signBtcPayment } from "../core/btc";
import { netOff } from "../core/netstatus";
import { THOR_SELL_FROM, THOR_SELL_TO, thorSellCoinOf, thorSellFeeRate, thorSellSlippageBps, thorSellTarget, thorSellTo8, thorSellUnseenMs, ThorSellCheck, thorSellLimit, thorSellMemo, thorSellQuote, thorSellStatus, thorSellVault, type ThorSellCoin, type ThorSellQuote, type ThorSellTarget } from "../core/thorsell";
import { checkSellPayment, coinSwapTo, sellAsset, sellCoinByChain, sellCoinOf, SELL_COIN_NETS, SELL_COINS, sellFeeTooHigh, SELL_NETS, sellQuote, sellStage, sellStatus, type SellCoin } from "../core/nearsell";
import { adaSalePending, checkAdaSellPayment, checkNearSellPayment, checkTrxSellPayment, checkUtxoSellPayment, checkXrpSellPayment, nearSalePending, reviewAdaSale, reviewNearSale, reviewTrxSale, reviewUtxoSale, reviewXrpSale, trxSaleMax, utxoSalePending, xrpSalePending } from "../core/coinsell";
import { adaPendingOf, adaSignedOf, adaSpendable, quoteAdaSend, signAdaPayment, submitAda } from "../core/ada";
import { ADA, adaAddress, adaBalance, adaTxUrl, formatAda } from "../core/adabase";
import { formatNear, NEAR, nearAddress, nearBalances, nearPendingOf, nearSpendable, quoteNearSend, signNearSend, submitNear, waitNear, type NearEnd } from "../core/near";
import { broadcastUtxo, clampUtxoRate, formatUtxo, quoteUtxoSend, rateLabel, signUtxoPayment, utxoBalance, utxoFees, utxoPendingOf, utxoSpendable, utxoTxUrl, type UtxoCoin } from "../core/utxo";
import { quoteXrpSend, signXrpSend, submitXrp, waitXrp, XRP, xrpBalances, xrpPendingOf, xrpSpendable } from "../core/xrp";
import { btcBuyFailure, buyAsset, buyQuote, buyStatus, buySummary, nearBuySend, type BtcBuyWhy, type BuyReq } from "../core/nearbuy";
import { amountAmbiguous, normAmount } from "../core/amount";
import { planRoute } from "../core/routeplan";
import { networkById, withTokenOn, type Network, type Token } from "../core/chains";
import { cleanTokenText, formatUnitsStr, MAYAN_SOL_NEEDED, parseUnitsStr, sendMayanSwift, SOL, solAddress, solBalances, solRent, solRpc, solSpendable } from "../core/sol";
import { coinHome } from "../core/explore";
import { cgWait } from "../core/coingecko";
import { MAYAN_SOL_TOKENS, mayanCostPct, mayanQuote, mayanStage, mayanStatus, mayanSummary, type MayanQuote, type MayanRequest } from "../core/mayan";
import { bigCostNote, sameCostPct, evmAllowance, evmApprove, evmFeeOn, evmQuote, evmSwap, EVM_NATIVE, feeBps, SLIPPAGE_BPS, SOL_MINT, solFeeOn, solQuote, solSwap, waitOk, waitSol, type SwapQuote } from "../core/swap";
import { bestEvmQuote, lifiSameSend } from "../core/lifiswap";
import { chooseRoute, rankRoutes, type RouteOpt } from "../core/routes";
import { checkLifiTx, checkNearDeposit, crossSummary, LIFI_BRIDGE_NAMES, LIFI_BRIDGES, LIFI_DIAMOND, lifiQuote, lifiSend, lifiStatus, loadXfer, saveXfer, scanLink, stagePct, tokParam, xferStage, type CrossRequest, type LifiStatus, type Side, type Xfer } from "../core/lifi";
import { TRON, TRON_USDT, TRX_TOKEN, tronAccount, tronAddress, tronBalances, tronTxUrl } from "../core/tronbase";
import { quoteTronSend, signTronSend, tronBroadcast, tronSettle, tronTxResult } from "../core/tron";
import { checkTronLifiTx, TRON_TO, tronCrossSummary, tronLifiQuote, tronLifiSwap, tronSwapCost, type TronCross, type TronSwapCost } from "../core/tronlifi";
import { defaultSides, gasSides, heldSides, startWaitsFor, holdings, human, nativeTradeSides, pairSides, receiveDefault, receiveSearch, routeOk, routeOkBase, sellGetDefault, sidesOn, swapNetworks, tronGetDefault, wantSides, type Dollar, type PickEntry } from "../core/picker";
import { EXTRA_COINS, extraById } from "../core/natives";
import { isEvmNative, ONE_PAY, oneQuote, oneSendEvm, oneSendSol, oneSendTron, oneStatus, oneSummary, onePay, type OneDest, type OnePay, type OneTarget } from "../core/oneclick";
import { thorBuyQuote, thorBuySend, thorBuyStatus, thorPay, type ThorBuyQuote, type ThorPay } from "../core/thorbuy";
import { isThorEvmCoin, type ThorCoin } from "../dapp/thordecode";
import { activationCovered, BUY_COIN_OF, nativeBuyFailure, nativeRoutes, thorBuys, thorLeastDelivered, xrpActivationNeed, type BuyCoin, type NativeWhy } from "../core/nativebuy";
import { DOGE, LTC, utxoAddress } from "../core/utxobase";
import { formatXrp, xrpAddress } from "../core/xrpbase";
import { balances, evmSpendable, fetchPrices, gasFees, perGas, publicClient, cachedPrices, type GasFees, type Prices } from "../core/chainops";
import { addActivity, clearPending, getActivity, getPending, removeActivity, setPending, touch, type CustomToken, type Settings } from "../core/store";
import { coinName } from "../core/coins";
import { fill, minsText, useT } from "./i18n";
import { NetworkDot, TokenIcon } from "./icons";
import { amt, fillNodes, money, PctRow, short, whenVisible, type Tab } from "./common";
import { balancesChanged, onBalancesChanged } from "../core/balbus";
import { bigToStr, readSnap, strToBig, writeSnap } from "../core/snap";
import { askGasDrop, dropOffer, type DropWhy } from "../core/gasdrop";

export const netLabel = (id: string) => (id === SOL.id ? SOL.name : id === BTC.id ? BTC.name : id === TRON.id ? TRON.name : extraById(id)?.name ?? networkById(id)?.name ?? id);

export function oneSymbols(netId: string): string[] {
  const n = networkById(netId);
  const sym = (token: string): string | undefined => netId === SOL.id ? (token === SOL_MINT ? "SOL" : SOL.tokens.find((t) => t.address === token)?.symbol)
    : netId === TRON.id ? (token === TRON_USDT ? "USDT" : undefined)
    : token === EVM_NATIVE.toLowerCase() ? n?.native.symbol : n?.tokens.find((t) => t.address.toLowerCase() === token)?.symbol;
  return [...new Set(ONE_PAY.filter((p) => p.netId === netId).map((p) => sym(p.token)).filter((x): x is string => !!x))];
}
const balKey = (netId: string, token: string) => `${netId}|${netId === SOL.id || netId === TRON.id ? token : token.toLowerCase()}`;
type SwapSide = { netId: string; token: string };
const sameTok = (a: SwapSide, b: SwapSide) => balKey(a.netId, a.token) === balKey(b.netId, b.token);

export function swapEntries(custom: CustomToken[], nets: readonly Network[]): PickEntry[] {

  const listedOn = (id: string) => new Set((id === SOL.id ? SOL.tokens : nets.find((n) => n.id === id)?.tokens ?? []).map((x) => x.address.toLowerCase()));
  const mine = (id: string) => { const l = listedOn(id); return custom.filter((c) => c.networkId === id && !l.has(c.address.toLowerCase())).map((c) => ({ ...c, verified: false })); };
  const out: PickEntry[] = [];
  for (const n of nets) {
    out.push({ netId: n.id, netName: n.name, token: EVM_NATIVE, symbol: n.native.symbol, name: n.native.name, decimals: n.chain.nativeCurrency.decimals, verified: true, native: true, balance: null, price: n.native.coingecko });
    for (const x of [...n.tokens, ...mine(n.id)]) out.push({ netId: n.id, netName: n.name, token: x.address, symbol: x.symbol, name: x.name, decimals: x.decimals, verified: x.verified, balance: null, price: ("coingecko" in x && x.coingecko) || `${n.cgPlatform}:${x.address.toLowerCase()}` });
  }
  out.push({ netId: SOL.id, netName: SOL.name, token: SOL_MINT, symbol: "SOL", name: "Solana", decimals: 9, verified: true, native: true, balance: null, price: SOL.coingecko });
  for (const x of [...SOL.tokens, ...mine(SOL.id)]) out.push({ netId: SOL.id, netName: SOL.name, token: x.address, symbol: x.symbol, name: x.name, decimals: x.decimals, verified: x.verified, balance: null, price: ("coingecko" in x && x.coingecko) || `${SOL.cgPlatform}:${x.address}` });

  out.push({ netId: BTC.id, netName: BTC.name, token: "bitcoin", symbol: "BTC", name: "Bitcoin", decimals: 8, verified: true, native: true, balance: null, price: BTC.coingecko });

  out.push({ netId: TRON.id, netName: TRON.name, token: TRON_USDT, symbol: "USDT", name: "Tether USD", decimals: 6, verified: true, balance: null, price: TRON.tokens[0].coingecko });

  out.push({ netId: TRON.id, netName: TRON.name, token: TRX_TOKEN, symbol: "TRX", name: "Tron", decimals: 6, verified: true, native: true, balance: null, price: TRON.coingecko });

  for (const c of EXTRA_COINS) if (!c.noSwap) out.push({ netId: c.id, netName: c.name, token: c.id, symbol: c.symbol, name: c.coinName, decimals: c.decimals, verified: true, native: true, balance: null, price: c.coingecko });
  return out;
}

const swapNetIds = (nets: readonly Network[]) => [...nets.map((n) => n.id), SOL.id, BTC.id, TRON.id, ...EXTRA_COINS.map((c) => c.id)];
const payNetIds = (nets: readonly Network[]) => [...nets.map((n) => n.id), SOL.id, BTC.id, TRON.id, ...EXTRA_COINS.map((c) => c.id)];

const gasSidesOk = (entries: PickEntry[], netId: string, priceOf: (e: PickEntry) => number | null) =>
  gasSides(entries.filter((e) => e.netId === netId || (routeOk(e.netId, netId) && trxPayOk(e, { netId }))), netId, priceOf);

const trxPayOk = (e: PickEntry, g: { netId: string; token?: string }) => g.netId !== TRON.id || !!onePay(e.netId, e.token) || (g.token != null && !!coinSwapTo(e, { netId: g.netId, token: g.token }));

type HomeRow = { networkId: string; key: string; amount: number; decimals: number; native: boolean };

export function fromHome(rows: HomeRow[]): [string, bigint][] {
  const out: [string, bigint][] = [];
  for (const r of rows) {
    if (!r || typeof r.amount !== "number" || !Number.isFinite(r.amount) || r.amount < 0 || !Number.isInteger(r.decimals) || r.decimals < 0 || r.decimals > 36) continue;
    if (r.networkId === TRON.id ? !r.native && r.key !== TRON_USDT : r.networkId !== SOL.id && !networkById(r.networkId)) continue;
    const token = r.native ? (r.networkId === SOL.id ? SOL_MINT : r.networkId === TRON.id ? TRX_TOKEN : EVM_NATIVE) : r.key;
    const d = Math.min(r.decimals, 8);
    out.push([balKey(r.networkId, token), BigInt(Math.round(r.amount * 10 ** d)) * 10n ** BigInt(r.decimals - d)]);
  }
  return out;
}

export interface SwapWant { cg: string; symbol: string; name: string }
export function SwapView({ phrase, settings, update, go, prefer, getCoin, pair, embedded, gasFor, buy, onDollar }: { phrase: string; settings: Settings; update: (p: Partial<Settings>) => unknown; go: (t: Tab) => void; prefer?: { netId: string; key: string }; getCoin?: SwapWant; pair?: { symbol: string; side: "buy" | "sell"; dollar?: Dollar }; embedded?: boolean; gasFor?: string;
   onDollar?: (d: Dollar) => void;
   buy?: string }) {
  const { t } = useT();
  const idx = settings.accountIndex;
  const customKey = JSON.stringify(settings.customTokens), onKey = (settings.networksOn ?? []).join(",");

  const nets = useMemo(() => swapNetworks(settings), [onKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const SWAP_NET_IDS = useMemo(() => swapNetIds(nets), [nets]), PAY_NET_IDS = useMemo(() => payNetIds(nets), [nets]);

  const [wantTok, setWantTok] = useState<PickEntry | null>(null);
  const [wantDone, setWantDone] = useState(!getCoin);
  const [wantMiss, setWantMiss] = useState<"" | "miss" | "busy">("");
  const wantCg = getCoin?.cg;
  const base = useMemo(() => {
    const all0 = swapEntries(settings.customTokens, nets);
    const all = wantTok && !all0.some((e) => sameTok(e, wantTok)) ? [...all0, wantTok] : all0;
    return isImportedIndex(idx) ? all.filter((e) => nets.some((n) => n.id === e.netId)) : all;
  }, [customKey, nets, idx, wantTok]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const want = getCoin;
    if (!want) return;
    let live = true;
    if (swapEntries(settings.customTokens, nets).some((e) => e.price === want.cg)) { setWantDone(true); return; }

    const ask = async (left: number): Promise<Awaited<ReturnType<typeof coinHome>>> => {
      const h = await coinHome(want.cg);
      if (h.data || !h.limited || left <= 0 || !live) return h;
      const ms = Math.min((await cgWait()) + 800, 20_000);
      await new Promise((r) => setTimeout(r, ms));
      return ask(left - 1);
    };
    void ask(2).then((h) => {
      if (!live) return;
      const home = h.data;
      const net = home ? (home.platform === SOL.cgPlatform ? { id: SOL.id, name: SOL.name } : nets.find((n) => n.cgPlatform === home.platform)) : undefined;
      const symbol = cleanTokenText(want.symbol, 12), name = cleanTokenText(want.name, 40);
      if (home && net && symbol) setWantTok({ netId: net.id, netName: net.name, token: home.address, symbol, name: name || symbol, decimals: home.decimals, verified: false, balance: null, price: want.cg });
      else setWantMiss(h.limited ? "busy" : "miss");
      setWantDone(true);
    });
    return () => { live = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [bals, setBals] = useState<Map<string, bigint>>(new Map());
  const [prices, setPrices] = useState<Prices | null>(null);
  const [tick, setTick] = useState(0);

  const [drop, setDrop] = useState<{ asking: boolean; net: string | null; why: DropWhy | null }>({ asking: false, net: null, why: null });
  const dropTimer = useRef<number | null>(null);
  const [pending, setPending] = useState(0);
  const [cached, setCached] = useState(false);
  const snapKey = `swapbal:${evmAddress(phrase, idx)}`;
  const freshRef = useRef<Map<string, bigint>>(new Map());
  useEffect(() => {
    let live = true;
    const home = `all:${evmAddress(phrase, idx)}`;
    void Promise.all([readSnap<[string, string][]>(snapKey), readSnap<HomeRow[]>(home), cachedPrices(settings.currency.toLowerCase() as "usd" | "sar")]).then(([snap, homeSnap, p]) => {
      const pairs = snap && Array.isArray(snap.v) ? snap.v.map(([k, v]) => [k, strToBig(v)] as [string, bigint]) : homeSnap && Array.isArray(homeSnap.v) ? fromHome(homeSnap.v) : null;
      if (!live || !pairs || !Object.keys(p).length) return;
      setBals((m) => (m.size ? m : new Map(pairs)));
      setPrices((old) => old ?? p);
      setCached(true);
    });
    return () => { live = false; };
  }, [snapKey]);
  useEffect(() => {
    let live = true;
    const otherExtras = EXTRA_COINS.filter((c) => c.id !== DOGE.id && c.id !== LTC.id && c.id !== XRP.id && !c.noSwap);
    setPending(nets.length + 6 + otherExtras.length);
    const fresh = new Map<string, bigint>();
    freshRef.current = fresh;
    const doneOne = () => { if (!live) return; setPending((p) => { if (p === 1) void writeSnap(snapKey, [...fresh].map(([k, v]) => [k, bigToStr(v)])); return p - 1; }); };
    const me = evmAddress(phrase, idx), solMe = solAddress(phrase, idx);
    const put = (pairs: [string, bigint][]) => { for (const [k, v] of pairs) fresh.set(k, v); if (live) setBals((m) => { const x = new Map(m); for (const [k, v] of pairs) x.set(k, v); return x; }); };
    void btcBalance(btcAddress(phrase, idx)).then((b) => put([[balKey(BTC.id, "bitcoin"), b.confirmed]])).catch(() => {}).finally(doneOne);
    void tronBalances(tronAddress(phrase, idx)).then((b) => put([[balKey(TRON.id, TRON_USDT), b.usdt], [balKey(TRON.id, TRX_TOKEN), b.sun]])).catch(() => {}).finally(doneOne);

    for (const c of [DOGE, LTC]) void utxoBalance(c, utxoAddress(c, phrase, idx)).then((b) => put([[balKey(c.id, c.id), b.confirmed]])).catch(() => {}).finally(doneOne);
    void xrpBalances(xrpAddress(phrase, idx)).then((b) => put([[balKey(XRP.id, XRP.id), b.spendable]])).catch(() => {}).finally(doneOne);

    for (const c of otherExtras) void c.balance(c.address(phrase, idx)).then((b) => put([[balKey(c.id, c.id), b.total - b.reserve > 0n ? b.total - b.reserve : 0n]])).catch(() => {}).finally(doneOne);
    for (const n of nets) {
      const toks = base.filter((e) => e.netId === n.id && e.token !== EVM_NATIVE).map((e) => ({ address: e.token as Address, symbol: e.symbol, name: e.name, decimals: e.decimals, verified: e.verified }));
      void balances(n, me, toks, {}).then((list) => put(list.map((a) => [balKey(n.id, a.key === "native" ? EVM_NATIVE : a.key), a.raw]))).catch(() => {}).finally(doneOne);
    }
    const mints = base.filter((e) => e.netId === SOL.id && e.token !== SOL_MINT).map((e) => e.token);

    const solTry = (left: number): Promise<Awaited<ReturnType<typeof solBalances>>> => solBalances(solMe, mints).catch((e) =>
      left > 0 ? new Promise((ok) => setTimeout(ok, left === 2 ? 3000 : 8000)).then(() => solTry(left - 1)) : Promise.reject(e));
    void solTry(2).then((b) => put([[balKey(SOL.id, SOL_MINT), b.lamports], ...mints.map((m) => [balKey(SOL.id, m), b.tokens.get(m) ?? 0n] as [string, bigint])]))
      .catch(() => readSnap<HomeRow[]>(`all:${me}`).then((h) => { if (live && h && Array.isArray(h.v)) put(fromHome(h.v.filter((r) => r && r.networkId === SOL.id))); }).catch(() => {}))
      .finally(doneOne);
    return () => { live = false; };
  }, [phrase, idx, base, tick]);
  useEffect(() => onBalancesChanged(() => setTick((x) => x + 1)), []);
  useEffect(() => {
    const keys = [...new Set(base.map((e) => e.price ?? ""))].filter(Boolean);
    const custom = keys.filter((k) => k.includes(":")).map((k) => ({ platform: k.slice(0, k.indexOf(":")), address: k.slice(k.indexOf(":") + 1) }));
    void fetchPrices(keys.filter((k) => !k.includes(":")), settings.currency.toLowerCase() as "usd" | "sar", custom).then((p) => setPrices((o) => ({ ...(o ?? {}), ...p }))).catch(() => setPrices((o) => o ?? {}));
  }, [base, settings.currency]);
  const entries = useMemo(() => base.map((e) => ({ ...e, balance: bals.get(balKey(e.netId, e.token)) ?? null })), [base, bals]);

  const priceKey = (k: string) => (k.includes(":") ? k.toLowerCase() : k);
  const priceOf = (e: PickEntry) => (e.price && prices?.[priceKey(e.price)] ? prices[priceKey(e.price)].price : null);

  const homeNet = settings.networkId !== "all" && PAY_NET_IDS.includes(settings.networkId) ? settings.networkId : null;

  const [pay, setPay] = useState<SwapSide | null>(null);
  const [get, setGet] = useState<SwapSide | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (ready || (pending > 0 && !cached) || !prices || !wantDone) return;

    const waitE = startWaitsFor(entries, prefer, buy);
    if (waitE && pending > 0 && !freshRef.current.has(balKey(waitE.netId, waitE.token))) return;

    const { want, preferred, buyE } = heldSides(entries, prefer, buy);

    const tronHome = !want && homeNet === TRON.id ? holdings(entries.filter((e) => e.netId === TRON.id), "", priceOf)[0] ?? entries.find((e) => e.netId === TRON.id && e.token === TRON_USDT) : undefined;
    const tronGet = tronHome ? (tronHome.token === TRX_TOKEN ? sellGetDefault(entries) : tronGetDefault(entries)) : undefined;
    const onNet = !want && homeNet && !tronHome ? sidesOn(entries, homeNet, priceOf) : null;

    const usdcArb = entries.find((x) => x.netId === "arbitrum" && x.symbol === "USDC");
    const fromHome = tronHome && tronGet ? { pay: tronHome, get: tronGet } : onNet && onNet.pay.netId === BTC.id && usdcArb ? { pay: onNet.pay, get: usdcArb } : onNet;

    const routePay = () => holdings(entries.filter((e) => { const x = nativeRoutes(e.netId, e.token); return !!(x.thor || x.one); }), "", priceOf)[0];
    const extraT = pair ? EXTRA_COINS.find((c) => c.symbol === pair.symbol) : undefined;
    const traded = pair ? (extraT ? nativeTradeSides(entries, extraT.id, pair.side, pair.side === "buy" ? routePay() : undefined)
      : pairSides(entries.filter((e) => e.netId !== TRON.id && (pair.symbol !== "BTC" || routeOk(e.netId, BTC.id))), pair.symbol, pair.side, priceOf, homeNet, pair.dollar)) : null;
    const gas = gasFor ? gasSidesOk(entries, gasFor, priceOf) : null;

    const buyPay = buyE ? routePay() ?? holdings(entries.filter((e) => !!coinSwapTo(e, buyE)), "", priceOf)[0] : undefined;
    const bought = buyE && buyPay ? { pay: buyPay, get: buyE } : null;

    const wantE = wantSides(entries, wantCg, homeNet, priceOf, (e, g) => trxPayOk(e, g));
    const dd = preferred ?? bought ?? traded ?? gas ?? wantE ?? fromHome ?? defaultSides(entries, priceOf);

    const d0 = dd && dd.pay.netId === TRON.id && dd.get.netId === TRON.id ? ((g) => (g ? { pay: dd.pay, get: g } : null))(dd.pay.token === TRX_TOKEN ? sellGetDefault(entries) : tronGetDefault(entries)) : dd;

    const d1 = d0 && !routeOk(d0.pay.netId, d0.get.netId) ? ((g) => (g ? { pay: d0.pay, get: g } : null))(receiveDefault(entries, d0.pay.netId, d0.pay)) : d0;

    const d = d1 && sellCoinOf(d1.pay.netId, d1.pay.token) && !saleGets(d1.pay.netId, d1.get) ? ((g) => (g ? { pay: d1.pay, get: g } : null))(sellGetDefault(entries)) : d1;
    if (d) { setPay({ netId: d.pay.netId, token: d.pay.token }); setGet({ netId: d.get.netId, token: d.get.token }); }
    setReady(true);
  }, [pending, prices, cached, wantDone]);

  const [picking, setPicking] = useState<"" | "pay" | "get">("");
  const [gather, setGather] = useState<{ pay: SwapSide; get: SwapSide; amount: string } | null>(null);

  const [amount, setAmount] = useState(() => (import.meta.env.DEV ? new URLSearchParams(location.search).get("amt") ?? "" : ""));
  const payE = pay && entries.find((e) => sameTok(e, pay));
  const getE = get && entries.find((e) => sameTok(e, get));

  const [btcPrep, setBtcPrep] = useState<{ usdc: SwapSide; btc: SwapSide; before: bigint; swapped: boolean; step2?: boolean } | null>(null);

  useEffect(() => {
    if (!btcPrep?.swapped) return;
    const now = entries.find((e) => sameTok(e, btcPrep.usdc))?.balance ?? null;
    if (now == null || now <= btcPrep.before) return;
    const d = entries.find((e) => sameTok(e, btcPrep.usdc))!.decimals;
    setPay(btcPrep.usdc); setGet(btcPrep.btc); setAmount(formatUnitsStr(now - btcPrep.before, d));
    setBtcPrep((p) => (p ? { ...p, swapped: false, step2: true } : p));
  }, [entries, btcPrep?.swapped]);

  const noGasNat = payE && !payE.native && (payE.netId === SOL.id || !!networkById(payE.netId)) && human(payE) > 0
    ? entries.find((e) => e.netId === payE.netId && e.native && e.balance === 0n) : undefined;
  const noGasFix = noGasNat ? gasSidesOk(entries, noGasNat.netId, priceOf) : null;

  const dropDollars = noGasNat ? entries.filter((e) => e.netId === noGasNat.netId && e.verified && /^USD[CT]/.test(e.symbol)).reduce((s, e) => Math.max(s, human(e)), 0) : 0;
  const dropOk = !!noGasNat && dropOffer(noGasNat.netId, noGasNat.balance, dropDollars);

  useEffect(() => { if (drop.net && !noGasNat && dropTimer.current) { clearInterval(dropTimer.current); dropTimer.current = null; } }, [drop.net, noGasNat]);
  useEffect(() => () => { if (dropTimer.current) clearInterval(dropTimer.current); }, []);
  useEffect(() => { setDrop((d) => (d.why ? { ...d, why: null } : d)); }, [payE?.netId]);

  const autoDrop = useRef("");
  useEffect(() => {
    if (!pair || !noGasNat || !dropOk || !amount.trim() || drop.asking || drop.net === noGasNat.netId || drop.why || autoDrop.current === noGasNat.netId) return;
    autoDrop.current = noGasNat.netId;
    void askDrop(noGasNat.netId);
  }, [pair, noGasNat?.netId, dropOk, amount, drop.asking, drop.net, drop.why]); // eslint-disable-line react-hooks/exhaustive-deps
  async function askDrop(netId: string) {
    if (drop.asking) return;
    setDrop({ asking: true, net: null, why: null });
    const a = await askGasDrop(netId, evmAddress(phrase, idx));
    if (!a.ok) { setDrop({ asking: false, net: null, why: a.why }); return; }
    setDrop({ asking: false, net: netId, why: null });

    let n = 0;
    if (dropTimer.current) clearInterval(dropTimer.current);
    dropTimer.current = window.setInterval(() => { setTick((x) => x + 1); if (++n >= 30 && dropTimer.current) { clearInterval(dropTimer.current); dropTimer.current = null; } }, 6000);
  }
  const dropText = (why: DropWhy) => (why === "used" ? t.dropNoUsed : why === "no_coin" ? t.dropNoCoin : why === "not_needed" ? t.dropNoNeed : why === "busy" || why === "too_many" ? t.dropNoBusy : why === "gas_high" ? t.dropNoGasHigh : t.dropNoOther);
  if (!ready) return <div className="page">{!embedded && <h1><ArrowLeftRight size={18} />{t.swap}</h1>}<div className="faint" style={{ textAlign: "center", padding: 24 }}>{t.calculating}</div></div>;
  if (!payE || !getE)
    return (
      <div className="page stack">
        {!embedded && <h1><ArrowLeftRight size={18} />{t.swap}</h1>}
        <div className="list empty"><div className="ic"><WalletIcon size={26} /></div><b style={{ color: "var(--text)" }}>{t.swapNothing}</b><p style={{ margin: "6px 0 0" }}>{t.swapNothingHint}</p></div>
        <button className="btn primary block" onClick={() => go("receive")}><ArrowDownLeft size={16} />{t.receive}</button>
        <button className="btn ghost block" onClick={() => go("buy")}><CreditCard size={16} />{t.buy}</button>
      </div>
    );
  function pick(e: PickEntry) {
    const s = { netId: e.netId, token: e.token };
    if (picking === "pay" && pair?.side === "sell") { setPicking(""); return; }
    if (picking === "get" && pair?.side === "buy") { setPicking(""); return; }
    if (picking === "pay" && pair?.side === "buy") {

      if (!sameTok(s, pay!)) setAmount("");
      setPay(s);
      const same = entries.find((x) => x.netId === e.netId && x.verified && x.symbol === pair.symbol && (pair.symbol !== "BTC" || x.netId === BTC.id));
      if (same) setGet({ netId: same.netId, token: same.token });
      setPicking("");
      return;
    }
    if (picking === "pay") {
      if (!sameTok(s, pay!)) setAmount("");
      setPay(s);

      if (sellCoinOf(e.netId, e.token)) { if (!saleGets(e.netId, getE!)) { const u = sellGetDefault(entries); if (u) setGet({ netId: u.netId, token: u.token }); } }
      else if (e.netId === TRON.id) { if (!TRON_TO.includes(getE!.netId)) { const u = tronGetDefault(entries); if (u) setGet({ netId: u.netId, token: u.token }); } }

      else if (sameTok(s, get!) || (e.netId !== payE!.netId && getE!.netId === payE!.netId) || !routeOk(e.netId, getE!.netId)) { const r = receiveDefault(entries, e.netId, e); if (r) setGet({ netId: r.netId, token: r.token }); }
    } else { if (sameTok(s, pay!)) return; setGet(s); }
    setPicking("");
  }

  function setGetNet(netId: string) {

    if (netId === TRON.id) {
      const trx = entries.find((e) => e.netId === TRON.id && e.token === TRX_TOKEN), usdt = entries.find((e) => e.netId === TRON.id && e.token === TRON_USDT);

      const coinPay = !!sellCoinOf(payE!.netId, payE!.token) && payE!.netId !== TRON.id;
      const dollarFirst = (!coinPay && /^USD/.test(getE!.symbol)) || (payE!.netId === TRON.id && payE!.token === TRX_TOKEN);
      const x = (dollarFirst ? [usdt, trx] : [trx, usdt]).find((e) => e && !sameTok(e, pay!));
      if (x) setGet({ netId, token: x.token });
      return;
    }
    const same = entries.find((e) => e.netId === netId && e.verified && e.symbol === getE!.symbol);

    const dollar = payE!.netId === TRON.id ? entries.find((e) => e.netId === netId && e.verified && e.symbol === "USDT") ?? entries.find((e) => e.netId === netId && e.verified && e.symbol === "USDC") : undefined;

    const sold = sellCoinOf(payE!.netId, payE!.token) ? [getE!.symbol, "USDC", "USDT"].map((s) => entries.find((e) => e.netId === netId && e.verified && e.symbol === s && saleGets(payE!.netId, e))).find(Boolean) : undefined;
    if (sold) { setGet({ netId, token: sold.token }); return; }
    const next = same && !sameTok(same, pay!) ? same : dollar ?? receiveDefault(entries, netId, payE!);
    if (next) setGet({ netId, token: next.token });
  }

  const canFlip = routeOk(getE.netId, payE.netId);

  const kind = (s: string) => (/USDC/.test(s) ? "USDC" : /^USD(T|₮)/.test(s) ? "USDT" : null);
  const to18 = (v: bigint, d: number) => (d <= 18 ? v * 10n ** BigInt(18 - d) : v / 10n ** BigInt(d - 18));
  let want: bigint | null = null;
  try { want = amount.trim() ? parseUnitsStr(normAmount(amount), payE.decimals) : null; } catch { want = null; }
  const evmDollars = (k: string | null) => entries.filter((e) => k && networkById(e.netId) && kind(e.symbol) === k && e.verified && e.balance != null && e.balance > 0n);

  const gatherPlan = (() => {
    const k = kind(payE.symbol);
    if (!k || !networkById(payE.netId) || payE.balance == null || !want || want <= payE.balance || gather) return null;
    let left = to18(((want - payE.balance) * 10150n) / 10000n, payE.decimals);
    if (left < 2n * 10n ** 18n) left = 2n * 10n ** 18n;
    const plan: PickEntry[] = [];
    for (const e of evmDollars(k).filter((e) => e.netId !== payE.netId && routeOkBase(e.netId, payE.netId)).sort((a, b) => (to18(b.balance!, b.decimals) > to18(a.balance!, a.decimals) ? 1 : -1))) {
      if (left <= 0n) break;
      if (to18(e.balance!, e.decimals) < 10n ** 18n) continue;
      plan.push(e); left -= to18(e.balance!, e.decimals);
    }
    const need = ((want - payE.balance) * 10150n) / 10000n, min = 2n * 10n ** BigInt(payE.decimals);
    return left <= 0n && plan.length ? { first: plan[0], need: need < min ? min : need } : null;
  })();

  const CHEAP = ["arbitrum", "base", "polygon", "bsc"];
  const crumb = !amount.trim() && !gather ? entries.filter((e) => CHEAP.includes(e.netId) && kind(e.symbol) && e.verified && e.balance != null && e.balance > 0n)
    .map((e) => ({ e, usd: Number(e.balance!) / 10 ** e.decimals, nat: entries.find((x) => x.netId === e.netId && x.native) }))
    .filter((c) => c.usd >= 0.05 && c.usd < 1 && c.nat && c.nat.balance != null && c.nat.balance > 0n).sort((a, b) => b.usd - a.usd)[0] ?? null : null;
  function startGather() {
    if (!gatherPlan) return;
    const src = gatherPlan.first, send = gatherPlan.need * 10n ** BigInt(src.decimals) / 10n ** BigInt(payE!.decimals);
    const amt = send > src.balance! ? src.balance! : send;
    setGather({ pay: pay!, get: get!, amount });
    setPay({ netId: src.netId, token: src.token }); setGet({ netId: payE!.netId, token: payE!.token });
    setAmount(formatUnitsStr(amt, src.decimals));
  }
  function backToPurchase() { if (!gather) return; setPay(gather.pay); setGet(gather.get); setAmount(gather.amount); setGather(null); }

  const usdcHere = entries.find((e) => e.netId === payE.netId && e.verified && e.symbol === "USDC");
  const btcPrepOffer = !btcPrep && !gather && getE.netId === BTC.id && !!networkById(payE.netId) && payE.symbol !== "USDC" && !buyAsset(payE.netId, payE.token) && !(onePay(payE.netId, payE.token) && payE.netId !== "bsc") && !thorPay(payE.netId, payE.token) && !!usdcHere;
  function startBtcPrep() {
    if (!usdcHere) return;
    setBtcPrep({ usdc: { netId: usdcHere.netId, token: usdcHere.token }, btc: get!, before: usdcHere.balance ?? 0n, swapped: false });
    setGet({ netId: usdcHere.netId, token: usdcHere.token });
  }
  const gatherMove = !!gather && kind(payE.symbol) != null && kind(payE.symbol) === kind(getE.symbol) && payE.netId !== getE.netId;
  return (
    <>
      {picking === "pay" && <TokenPicker title={t.pickHolding} holdings payIds={PAY_NET_IDS} startNet={payE.netId === homeNet ? homeNet : null} entries={pair ? entries.filter((e) => e.netId !== TRON.id && !extraById(e.netId)) : entries} loading={pending > 0} priceOf={priceOf} cur={settings.currency} hide={settings.hideBalances} onPick={pick} onClose={() => setPicking("")} />}
      {picking === "get" && <TokenPicker title={`${t.pickToken} · ${getE.netName}`} netId={getE.netId} payNet={payE.netId} payTok={pair ? undefined : payE.token} entries={entries} loading={pending > 0} priceOf={priceOf} cur={settings.currency} hide={settings.hideBalances} onPick={pick} onClose={() => setPicking("")} />}
      <div style={picking ? { display: "none" } : undefined}>
        {pair && onDollar && !EXTRA_COINS.some((c) => c.symbol === pair.symbol) && (() => {

          const tot = (d: Dollar) => entries.filter((e) => e.verified && e.symbol === d && e.netId !== TRON.id && !extraById(e.netId)).reduce((s, e) => s + human(e), 0);
          const cur = pair.dollar ?? (kind(pair.side === "buy" ? payE.symbol : getE.symbol) as Dollar | null) ?? "USDT";
          return (
            <div className="trade-dollar">
              <span className="faint">{pair.side === "buy" ? t.trPayWith : t.trGetIn}</span>
              <div className="trade-dollar-opts" role="radiogroup">
                {(["USDT", "USDC"] as const).map((d) => (
                  <button key={d} role="radio" aria-checked={cur === d} className={cur === d ? "on" : ""} onClick={() => cur !== d && onDollar(d)}>
                    <TokenIcon symbol={d} size={18} /><b>{d}</b><span className="num faint">{settings.hideBalances ? "•••" : tot(d).toLocaleString("en-US", { maximumFractionDigits: 2 })}</span>
                  </button>
                ))}
              </div>
              <span className="faint" style={{ fontSize: 11.5 }}>{t.trAllNets}</span>
            </div>
          );
        })()}
        <XferCard />
        {wantMiss && <div className="note info"><Info size={16} />{wantMiss === "busy" ? t.swapWantBusy : t.swapWantMiss}</div>}
        {noGasNat && !(gasFor && getE.netId === gasFor) && (
          <div className="note warn" style={{ display: "grid", gap: 8 }}>
            <span className="row" style={{ gap: 6, alignItems: "flex-start" }}><Fuel size={16} style={{ flex: "none" }} />{fill(t.gasSwapShort, { sym: noGasNat.symbol, net: payE.netName })}</span>
            {dropOk && drop.net !== noGasNat.netId && <span className="faint">{pair ? t.dropAuto : fill(t.dropWhy, { sym: noGasNat.symbol })}</span>}
            {dropOk && drop.net !== noGasNat.netId && !pair && <button className="btn primary block" disabled={drop.asking} onClick={() => void askDrop(noGasNat.netId)}><Fuel size={16} />{t.dropBtn}</button>}
            {drop.net === noGasNat.netId && <span className="faint">{t.dropSending}</span>}
            {drop.why && <span className="faint">{dropText(drop.why)}</span>}
            {noGasFix
              ? <button className="btn ghost block" onClick={() => { setPay({ netId: noGasFix.pay.netId, token: noGasFix.pay.token }); setGet({ netId: noGasFix.get.netId, token: noGasFix.get.token }); setAmount(""); }}>{fill(t.gasFromOther, { sym: noGasNat.symbol })}</button>
              : <span className="faint">{t.gasSwapNone}</span>}
          </div>
        )}
        {drop.net && !noGasNat && drop.net === payE.netId && <div className="note info"><Check size={16} /><span>{t.dropArrived}</span></div>}
        {gasFor && getE.netId === gasFor && getE.native && <div className="note info"><Fuel size={16} /><span>{fill(t.gasSwapNote, { sym: getE.symbol, net: getE.netName })}</span></div>}
        {gasFor && !(getE.netId === gasFor && getE.native) && <div className="note warn"><Fuel size={16} /><span>{t.gasSwapNone}</span></div>}
        {gatherPlan && (
          <div className="note info" style={{ display: "grid", gap: 8 }}>
            <span>{fill(t.gatherText, { have: amt(formatUnitsStr(payE.balance!, payE.decimals), payE.decimals), s: payE.symbol, from: gatherPlan.first.netName, c: payE.netName })}</span>
            <button className="btn ghost block" onClick={startGather}>{fill(t.gatherBtn, { from: gatherPlan.first.netName })}</button>
          </div>
        )}
        {gather && (
          <div className="note info" style={{ display: "grid", gap: 8 }}>
            <span>{t.gatherStep1}</span>
            <button className="btn ghost block" onClick={backToPurchase}>{t.gatherBack}</button>
          </div>
        )}
        {btcPrepOffer && (
          <div className="note info" style={{ display: "grid", gap: 8 }}>
            <span>{fill(t.btcPrepNote, { sym: payE.symbol, net: payE.netName })}</span>
            <button className="btn ghost block" onClick={startBtcPrep}>{t.btcPrepBtn}</button>
          </div>
        )}
        {btcPrep && (
          <div className="note info" style={{ display: "grid", gap: 8 }}>
            <span>{btcPrep.step2 ? t.btcPrepStep2 : btcPrep.swapped ? t.btcPrepWait : fill(t.btcPrepStep1, { sym: payE.symbol })}</span>
            <button className="btn ghost block" onClick={() => setBtcPrep(null)}>{t.cancel}</button>
          </div>
        )}
        {crumb && (
          <div className="note info" style={{ display: "grid", gap: 8 }}>
            <span>{fill(t.crumbs, { a: amt(formatUnitsStr(crumb.e.balance!, crumb.e.decimals)), s: crumb.e.symbol, c: crumb.e.netName, coin: crumb.nat!.symbol })}</span>
            <button className="btn ghost block" onClick={() => { setPay({ netId: crumb.e.netId, token: crumb.e.token }); setGet({ netId: crumb.e.netId, token: crumb.nat!.token }); setAmount(formatUnitsStr(crumb.e.balance!, crumb.e.decimals)); }}>{fill(t.crumbsBtn, { coin: crumb.nat!.symbol })}</button>
          </div>
        )}
        <SwapForm key={idx} netIds={SWAP_NET_IDS} embedded={embedded} lock={pair ? (pair.side === "buy" ? "get" : "pay") : undefined} gatherMove={gatherMove} phrase={phrase} idx={idx} pay={payE} get={getE} cur={settings.currency} payPrice={priceOf(payE)} amount={amount} setAmount={setAmount} canFlip={canFlip}
          onPick={setPicking} onGetNet={setGetNet}
          onThorBase={() => { const e = entries.find((x) => x.netId === "base" && x.symbol === "USDC" && !!thorSellTarget(x.netId, x.token)); if (e) setGet({ netId: e.netId, token: e.token }); return !!e; }}
          onFlip={() => {
            if (!canFlip) return;

            const s = sellCoinOf(getE.netId, getE.token) && !saleGets(getE.netId, payE) ? sellGetDefault(entries, payE.symbol) : undefined;
            setPay(get); setGet(s ? { netId: s.netId, token: s.token } : pay); setAmount("");
          }} onSwapped={(got) => {
            setTick((x) => x + 1);

            if (btcPrep && !btcPrep.step2 && sameTok(got, btcPrep.usdc)) setBtcPrep({ ...btcPrep, swapped: true });
            else if (btcPrep?.step2 && sameTok(got, btcPrep.btc)) setBtcPrep(null);

            const n = got.netId === SOL.id ? SOL : networkById(got.netId);
            const next = n && withTokenOn(n, settings.enabledTokens, got.token);
            if (next) void update({ enabledTokens: next });
          }} />
      </div>
    </>
  );
}

function SwapNetSelect({ value, onChange, disabled, label, ids, only }: { value: string; onChange: (id: string) => void; disabled?: boolean; label: string; ids: string[]; only?: string[] }) {
  return (
    <label className="netpill" title={label}>
      <Globe size={13} /><NetworkDot id={value} size={14} />{netLabel(value)}<ChevronDown size={12} />
      <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} aria-label={label}>
        {ids.filter((id) => !only || only.includes(id)).map((id) => <option key={id} value={id}>{netLabel(id)}</option>)}
      </select>
    </label>
  );
}

function TokenPicker({ title, holdings: own, startNet, netId, payNet, payTok, payIds, entries, loading, priceOf, cur, hide, onPick, onClose }: {
  title: string; holdings?: boolean; startNet?: string | null; netId?: string; payNet?: string; payTok?: string; payIds?: string[]; entries: PickEntry[]; loading: boolean; priceOf: (e: PickEntry) => number | null; cur: string; hide: boolean; onPick: (e: PickEntry) => void; onClose: () => void;
}) {
  const { t } = useT();
  const [q, setQ] = useState("");

  const [only, setOnly] = useState<string | null>(startNet ?? null);

  const list = own ? holdings(only ? entries.filter((e) => e.netId === only) : entries, q, priceOf)
    : receiveSearch(entries, netId!, payNet ?? netId!, q, priceOf, payNet && payTok != null ? { netId: payNet, token: payTok } : undefined);
  const held = own ? new Set(holdings(entries).map((e) => e.netId)) : null;
  const mask = (s: string) => (hide ? "••••" : s);
  return (
    <div className="page stack">
      <div className="between"><h1 style={{ margin: 0 }}>{title}</h1><button className="iconbtn" title={t.closeBtn} aria-label={t.closeBtn} onClick={onClose}><X size={18} /></button></div>
      <input className="input" autoFocus placeholder={t.searchToken} value={q} onChange={(e) => setQ(e.target.value)} spellCheck={false} />
      {held && (
        <div className="chips" role="group" aria-label={t.network} style={{ margin: 0 }}>
          <button className={only ? "" : "on"} aria-pressed={!only} onClick={() => setOnly(null)}>{t.allNetworks}</button>
          {(payIds ?? []).filter((id) => held.has(id) || id === only).map((id) => <button key={id} className={only === id ? "on" : ""} aria-pressed={only === id} onClick={() => setOnly(id)}>{netLabel(id)}</button>)}
        </div>
      )}
      {list.length === 0 ? <div className="empty">{own && only && !q ? t.noHoldOnNet : t.noMatch}</div> : (
        <div className="list">
          {list.map((x) => {
            const p = priceOf(x), n = x.balance == null ? null : Number(formatUnitsStr(x.balance, x.decimals));
            return (
              <button key={x.netId + x.token} className="rowi" style={{ width: "100%", textAlign: "start" }} onClick={() => onPick(x)}>
                <TokenIcon symbol={x.symbol} size={32} />
                <span className="grow">
                  <span className="t1 row" style={{ gap: 6 }}>{x.symbol}{!x.verified && <span className="badge warn">{t.unverified}</span>}</span>
                  <span className="t2">{own || x.netId !== netId ? fill(t.onNet, { net: x.netName }) : coinName(x.symbol, x.name, x.verified)}</span>
                </span>
                <span className="end">
                  <span className="t1 num" style={{ display: "block" }}>{n == null ? (loading ? "…" : "—") : mask(amt(String(n), x.decimals))}</span>
                  {n != null && n > 0 && p != null && <span className="t2 num" style={{ display: "block" }}>{mask(money(n * p, cur))}</span>}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

const REFRESH_S = 15;

type FormQuote = BaseQuote & { alts?: RouteOpt<BaseQuote>[]; routeId?: string };

type BaseQuote = { kind: "same"; q: SwapQuote } | { kind: "cross"; s: ReturnType<typeof crossSummary>; fees?: GasFees; bridge?: string }

  | { kind: "sell"; s: { amountOut: bigint; minOut: bigint; secs: number | null; outFee?: bigint | null }; activate?: bigint | null }

  | { kind: "thorsell"; coin: ThorSellCoin; to: ThorSellTarget; q: ThorSellQuote; s: { amountOut: bigint; minOut: bigint; secs: number | null; outFee: bigint | null; costPct: number } }
  | { kind: "tron"; s: ReturnType<typeof crossSummary>; cost?: TronSwapCost | null; trxUsd?: number | null }
  | { kind: "nearbuy"; s: ReturnType<typeof buySummary>; asset: string; fees?: GasFees }

  | { kind: "onebuy"; dest: OneTarget; pay: OnePay; s: ReturnType<typeof oneSummary>; fees?: GasFees; activate: bigint | null }
  | { kind: "thorbuy"; coin: ThorCoin; pay: ThorPay; q: ThorBuyQuote; s: ReturnType<typeof oneSummary>; fees?: GasFees; activate: bigint | null }
  | { kind: "mayan"; q: MayanQuote; r: MayanRequest; s: ReturnType<typeof mayanSummary>; two?: SwapQuote };
const SOL_USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

export const saleGets = (payNet: string, e: { netId: string; symbol: string; token: string }) => !!sellAsset(e.netId, e.symbol) || (!!thorSellCoinOf(payNet) && !!thorSellTarget(e.netId, e.token))
  || !!coinSwapTo({ netId: payNet, token: TRX_TOKEN }, e);

export function saleTo(get: { netId: string; token: string; decimals: number }, coinTo: SellCoin | null): Side {
  const chainId: Side["chainId"] | undefined = coinTo ?? (get.netId === TRON.id ? "TRON" : networkById(get.netId)?.chain.id);
  if (chainId == null || (coinTo && sellCoinOf(get.netId, get.token) !== coinTo)) throw Object.assign(new Error("ERR_UNSAFE"), { why: "sale target" });
  return { netId: get.netId, chainId, token: get.token, decimals: get.decimals };
}

export const outBandOf = (s: { minOut: bigint; amountOut: bigint }, decimals: number) => ({ outMin: formatUnitsStr(s.minOut, decimals), outEst: formatUnitsStr(s.amountOut, decimals) });

export function xrpPayNeed(paid: bigint, need: bigint, minOut: bigint): bigint | null {
  if (paid <= 0n || need <= 0n || minOut <= 0n) return null;
  const n = paid * need * 102n;
  return (n + minOut * 100n - 1n) / (minOut * 100n);
}

const BUY_TRANSFER_GAS = 65_000n;

const THOR_DEPOSIT_GAS = 110_000n;

function SwapForm({ netIds, phrase, idx, pay, get, cur, payPrice, amount, setAmount, canFlip, onPick, onGetNet, onThorBase, onFlip, onSwapped, gatherMove, embedded, lock }: {
  netIds: string[];
  phrase: string; idx: number; pay: PickEntry; get: PickEntry; cur: string; payPrice: number | null; amount: string; setAmount: (v: string) => void; gatherMove?: boolean; embedded?: boolean; lock?: "pay" | "get";
  canFlip: boolean; onPick: (side: "pay" | "get") => void; onGetNet: (netId: string) => void; onFlip: () => void; onSwapped: (got: SwapSide) => void;
   onThorBase?: () => boolean;
}) {
  const { t } = useT();

  const { isSolNet, sellCoin, isBtcPay, sellTo, coinTo, cross, noRoute, mayanOk, twoStep, isTronPay, tronOk, buyCoin, toTronOther, toTronUsdt, oneP, thorP, nativeBuy, btcDirect, btcViaOne, viaBuy, soon, toBtc, thorBtc, thorCoin, thorSell, nearOnly, thorTo, thorCrossPay, oneFrom, oneTo, oneCross } = planRoute(pay, get);

  const saleQuote = (q: FormQuote | null): q is FormQuote & ({ kind: "sell" } | { kind: "thorsell" }) => !!q && (q.kind === "sell" || q.kind === "thorsell");
  const isSellPay = !!sellCoin;
  const utxoC: UtxoCoin | null = pay.netId === DOGE.id ? DOGE : pay.netId === LTC.id ? LTC : null, isXrpPay = pay.netId === XRP.id, isAdaPay = pay.netId === ADA.id;
  const isTrxPay = sellCoin === "TRX";
  const isNearPay = sellCoin === "NEAR";
  const payExtra = extraById(pay.netId);
  const toNative = extraById(get.netId);
  const net = isSolNet || isSellPay || isTronPay ? undefined : networkById(pay.netId);
  const explorer = isSolNet ? SOL.explorer : isBtcPay ? BTC.explorer : payExtra ? payExtra.explorer : isTronPay || isTrxPay ? TRON.explorer : net!.explorer;
  const from = pay.token, to = get.token, tIn = pay, tOut = get;
  const me = useMemo(() => evmAddress(phrase, idx), [phrase, idx]);
  const solMe = useMemo(() => solAddress(phrase, idx), [phrase, idx]);
  const btcMe = useMemo(() => btcAddress(phrase, idx), [phrase, idx]);
  const tronMe = useMemo(() => tronAddress(phrase, idx), [phrase, idx]);

  const tronReq = (amount: bigint): TronCross => {
    const toChain = get.netId === SOL.id ? ("SOL" as const) : networkById(get.netId)!.chain.id;
    return { toNetId: get.netId, toChain, toToken: tokParam({ netId: get.netId, chainId: toChain, token: to }), amount, from: tronMe, to: get.netId === SOL.id ? solMe : me };
  };
  const [bal, setBal] = useState<bigint | null>(null);
  const [quote, setQuote] = useState<FormQuote | null>(null), [qErr, setQErr] = useState(""), [loading, setLoading] = useState(false);

  const routePick = useRef<string | null>(null);

  const autoBase = useRef<string>("");

  const [routeGone, setRouteGone] = useState(false);
  const showRoutes = (list: RouteOpt<BaseQuote>[]): FormQuote => {
    const ranked = rankRoutes(list);
    if (routePick.current && !ranked.some((r) => r.id === routePick.current)) { routePick.current = null; setRouteGone(true); }
    const c = chooseRoute(ranked, routePick.current)!;
    return { ...c.q, alts: ranked.length > 1 ? ranked : undefined, routeId: c.id };
  };
  const [step, setStep] = useState<"idle" | "approving" | "swapping">("idle"), [err, setErr] = useState(""), [done, setDone] = useState<string | null>(null);
  const seq = useRef(0);

  const [sent, setSent] = useState(0), [tick, setTick] = useState(0);
  const swapped = (g: SwapSide) => { onSwapped(g); setSent((n) => n + 1); };
  useEffect(() => onBalancesChanged(() => setTick((x) => x + 1)), []);
  const [stage, setStage] = useState<0 | 1 | 2>(0);
  const [requote, setRequote] = useState(0), moved = useRef(false), silent = useRef(false), [left, setLeft] = useState(0);
  const fmt = (v: bigint, d: number) => amt(formatUnitsStr(v, d), d);

  const amountTxt = normAmount(amount), ambiguous = amountAmbiguous(amount);
  let amtIn: bigint | null = null;
  try { amtIn = amount.trim() ? parseUnitsStr(amountTxt, tIn.decimals) : null; } catch { amtIn = null; }
  const amountBad = amount.trim() !== "" && amtIn == null;

  const [sellReview, setSellReview] = useState<{ sats: bigint; fee: bigint; feeRate: number; reserve?: bigint; kind: string; routeId?: string } | null>(null);

  const [salePrev, setSalePrev] = useState<{ txid: string; amount: bigint } | null>(null), [prevOk, setPrevOk] = useState("");
  const [info, setInfo] = useState(""), [infoWait, setInfoWait] = useState(false);
  useEffect(() => { setSellReview(null); }, [amount, from, to, pay.netId, get.netId]);
  useEffect(() => { setSalePrev(null); setPrevOk(""); }, [pay.netId]);

  const coinTxt = (v: bigint) => (isBtcPay ? formatBtc(v) : formatUnitsStr(v, tIn.decimals));

  const sellText = (x: { message?: string; kind?: string; minSats?: bigint | null; minUsd?: number | null }) => x.message === "ERR_BUSY" ? t.busyWait
    : x.kind === "small" ? (x.minSats ? fill(coinTo ? t.swapMin : t.btcSellMin, { m: coinTxt(x.minSats), c: tIn.symbol }) : x.minUsd ? fill(coinTo ? t.swapMinUsd : t.sellMinUsd, { c: tIn.symbol, u: usdText(x.minUsd) }) : coinTo ? t.swapMinNoN : t.btcSellMinNoN)
    : x.kind === "big" ? (coinTo ? t.swapBig : t.btcSellBig) : coinTo ? t.swapNoPrice : t.btcSellNoRoute;
  const mayanReq = (amount: bigint, mint: string = from): MayanRequest => ({
    mint, amount, chainId: networkById(get.netId)!.chain.id, toToken: to, toDecimals: tOut.decimals, trader: solMe, dest: me,
    feeBps: solFeeOn(solMe) ? feeBps() : 0, slippageBps: SLIPPAGE_BPS,
  });
  const crossReq = (amount: bigint): CrossRequest => ({
    from: { netId: pay.netId, chainId: net!.chain.id, token: from, decimals: tIn.decimals },
    to: { netId: get.netId, chainId: get.netId === SOL.id ? "SOL" : toBtc ? "BTC" : networkById(get.netId)!.chain.id, token: to, decimals: tOut.decimals },
    amount, sender: me, receiver: get.netId === SOL.id ? solMe : toBtc ? btcMe : me,
    noFee: !!gatherMove, fromSymbol: tIn.symbol, toSymbol: tOut.symbol,
  });

  const directAsset = btcDirect;
  const buyReq = (amount: bigint): Omit<BuyReq, "dry"> => ({ amount, asset: directAsset!, recipient: btcMe, refundTo: me, fee: evmFeeOn(me) });

  const dogeMe = useMemo(() => utxoAddress(DOGE, phrase, idx), [phrase, idx]), ltcMe = useMemo(() => utxoAddress(LTC, phrase, idx), [phrase, idx]);
  const xrpMe = useMemo(() => xrpAddress(phrase, idx), [phrase, idx]);
  const adaMe = useMemo(() => adaAddress(phrase, idx), [phrase, idx]);
  const nearMe = useMemo(() => nearAddress(phrase, idx), [phrase, idx]);

  const adaBusy = async () => adaSignedOf(await getPending(ADA.id, adaMe).catch(() => null))?.ins ?? [];

  const oneList = oneSymbols(pay.netId).join(" / ");

  const ownDest = (d: OneTarget): string => {
    if (typeof d !== "string") return d.kind === "sol" ? solMe : d.kind === "tron" ? tronMe : me;
    switch (d) {
      case "BTC": return btcMe; case "DOGE": return dogeMe; case "LTC": return ltcMe; case "XRP": return xrpMe; case "ADA": return adaMe; case "TRX": return tronMe; case "NEAR": return nearMe;
      default: { const never: never = d; throw Object.assign(new Error("ERR_UNSAFE"), { why: `no own address for ${String(never)}` }); }
    }
  };

  const sellMe = sellCoin ? ownDest(sellCoin) : "";

  const sellDest = coinTo ? ownDest(coinTo) : get.netId === TRON.id ? tronMe : me;

  const ownTxids = async (c: UtxoCoin) => (await getActivity()).filter((a) => a.networkId === c.id && (a.kind === "send" || a.kind === "swap") && a.from === (c.id === DOGE.id ? dogeMe : ltcMe)).map((a) => a.hash);
  const payer = oneP?.kind === "sol" ? solMe : oneP?.kind === "tron" ? tronMe : me;
  const payerOf = (p: OnePay) => (p.kind === "sol" ? solMe : p.kind === "tron" ? tronMe : me);

  const thorPayTo = (to: ThorSellTarget) => (to.netId === TRON.id ? tronMe : me);

  const thorDest = (c: ThorCoin) => (isThorEvmCoin(c) ? me : ownDest(c));
  const oneReq = (a: bigint, d: OneTarget, p: OnePay) => ({ pay: p, dest: d, amount: a, recipient: ownDest(d), refundTo: payerOf(p), fee: p.kind === "sol" ? solFeeOn(solMe) : evmFeeOn(me) });

  const nearCross = async (a: bigint): Promise<RouteOpt<BaseQuote> | null> => {
    if (!oneCross) return null;
    const q = await oneQuote(oneReq(a, oneTo!, oneFrom!)), s = oneSummary(q);
    return { id: "near", name: "NEAR Intents", out: s.amountOut, min: s.minOut, secs: s.secs, q: { kind: "onebuy", dest: oneTo!, pay: oneFrom!, s, fees: net ? await gasFees(net).catch(() => undefined) : undefined, activate: null } };
  };

  async function sellRoutes(a: bigint): Promise<FormQuote> {
    const [n, th, act] = await Promise.allSettled([
      sellTo ? sellQuote({ sats: a, asset: sellTo, recipient: sellDest, refundTo: sellMe, dry: true, coin: sellCoin! }) : Promise.reject(new Error("ERR_UNSUPPORTED")),
      thorSell && thorCoin ? thorSellQuote(thorCoin, a, thorSell, thorPayTo(thorSell)) : Promise.reject(new Error("ERR_UNSUPPORTED")),

      coinTo === "XRP" ? xrpActivationNeed(sellDest) : Promise.resolve(null),
    ]);
    if (act.status === "rejected") throw new Error("ERR_NET");
    const need = act.value;
    const alts: RouteOpt<BaseQuote>[] = [];
    if (n.status === "fulfilled" && activationCovered(n.value.minOut, need)) alts.push({ id: "near", name: "NEAR Intents", out: n.value.amountOut, min: n.value.minOut, secs: n.value.secs, q: { kind: "sell", s: n.value, activate: need } });
    if (th.status === "fulfilled") {
      const q = th.value, least = (q.amountOut * (10000n - thorSellSlippageBps(thorCoin!))) / 10000n;
      alts.push({ id: "thor", name: "THORChain", out: q.amountOut, min: least, secs: q.secs,
        q: { kind: "thorsell", coin: thorCoin!, to: thorSell!, q, s: { amountOut: q.amountOut, minOut: least, secs: q.secs, outFee: q.outFee, costPct: q.feeBps != null ? q.feeBps / 100 : 0 } } });
    }
    if (alts.length) return showRoutes(alts);

    if (need != null && n.status === "fulfilled") throw Object.assign(new Error("ERR_XRP_ACTIVATE"), { need, payNeed: xrpPayNeed(a, need, n.value.minOut) });
    const ne = n.status === "rejected" ? (n.reason as { message?: string; kind?: string; minSats?: bigint | null }) : null;
    const te = th.status === "rejected" ? (th.reason as { message?: string; kind?: string; minSats?: bigint | null }) : null;
    const real = (e: typeof ne) => !!e && e.message !== "ERR_UNSUPPORTED";

    if (real(ne) && real(te) && ne!.kind === "small" && te!.kind === "small" && te!.minSats != null && (ne!.minSats == null || te!.minSats < ne!.minSats)) throw te;
    if (real(ne)) throw ne;
    if (real(te)) throw te;
    throw Object.assign(new Error("ERR_ROUTE"), { route: true });
  }

  const asBtcBuy = (e: unknown) => { const x = e as { onebuy?: boolean }; if (x?.onebuy) Object.assign(e as object, { btcbuy: true }); throw e; };
  async function btcBuyQuote(a: bigint): Promise<FormQuote> {
    const r = net && !nearOnly ? crossReq(a) : null;
    const [l, d, f, th] = await Promise.allSettled([
      r ? lifiQuote(r).then(async (lq) => { const c = checkLifiTx(lq, r); if (c.near) await checkNearDeposit(c.near, r); return crossSummary(lq); }) : Promise.reject(new Error("ERR_UNSUPPORTED")),
      directAsset ? buyQuote({ ...buyReq(a), dry: true }).then(buySummary) : btcViaOne ? oneQuote(oneReq(a, "BTC", oneP!)).then(oneSummary).catch(asBtcBuy) : Promise.reject(new Error("ERR_UNSUPPORTED")),
      net ? gasFees(net) : Promise.resolve(undefined),
      thorBtc ? thorBuyQuote(thorBtc, tIn.decimals, "BTC", a, btcMe) : Promise.reject(new Error("ERR_UNSUPPORTED")),
    ]);
    const fees = f.status === "fulfilled" ? f.value : undefined;
    const ls = l.status === "fulfilled" ? l.value : null, ds = d.status === "fulfilled" ? d.value : null;
    const ts = th.status === "fulfilled" ? th.value : null;

    const alts: RouteOpt<BaseQuote>[] = [];

    if (ls) alts.push({ id: "lifi", name: ls.tool ? `${LIFI_BRIDGE_NAMES[ls.tool]} · LI.FI` : "LI.FI", out: ls.amountOut, min: ls.minOut, secs: ls.secs, q: { kind: "cross", s: ls, fees, ...(ls.tool ? { bridge: ls.tool } : {}) } });
    if (ds) alts.push({ id: "near", name: "NEAR Intents", out: ds.amountOut, min: ds.minOut, secs: ds.secs,
      q: directAsset ? { kind: "nearbuy", s: ds as ReturnType<typeof buySummary>, asset: directAsset, fees } : { kind: "onebuy", dest: "BTC", pay: oneP!, s: ds as ReturnType<typeof oneSummary>, fees, activate: null } });
    if (ts) {
      const least = thorLeastDelivered(ts.amountOut, ts.outFee) ?? (ts.amountOut * 99n) / 100n;
      alts.push({ id: "thor", name: "THORChain", out: ts.amountOut, min: least, secs: ts.secs, q: { kind: "thorbuy", coin: "BTC", pay: thorBtc!, q: ts, fees, activate: null,
        s: { amountOut: ts.amountOut, minOut: least, feePct: (ts.feeBps ?? 0) / 100, outFee: ts.outFee, secs: ts.secs, costPct: ts.feeBps != null ? ts.feeBps / 100 : 0 } } });
    }
    if (alts.length) return showRoutes(alts);
    const dErr = d.status === "rejected" ? (d.reason as { minUsd?: number | null; minIn?: bigint | null; kind?: string; onebuy?: boolean }) : null;
    const tErr = th.status === "rejected" ? (th.reason as { thorbuy?: boolean; kind?: string; minIn?: bigint | null }) : null;
    if (tErr?.thorbuy && tErr.kind === "small" && tErr.minIn != null && !(dErr?.kind === "small" && dErr.minIn != null && dErr.minIn < tErr.minIn))
      throw Object.assign(new Error("ERR_BTCBUY"), { btcbuyWhy: { why: "small", minIn: tErr.minIn } as BtcBuyWhy });
    if (dErr?.onebuy && dErr.kind === "small" && dErr.minIn == null && dErr.minUsd != null) throw Object.assign(new Error("ERR_BTCBUY"), { nativeWhy: { why: "small", minIn: null, minUsd: dErr.minUsd } as NativeWhy });
    throw Object.assign(new Error("ERR_BTCBUY"), { btcbuyWhy: btcBuyFailure(l.status === "rejected" ? l.reason : null, dErr, !!directAsset || btcViaOne) });
  }

  async function crossRoutes(a: bigint): Promise<FormQuote> {

    const base = nearOnly ? null : crossReq(a), bridges = base ? LIFI_BRIDGES.split(",") : [];
    const [tc, nr, f, ...res] = await Promise.allSettled([
      thorTo && thorCrossPay && !gatherMove ? thorBuyQuote(thorCrossPay, tIn.decimals, thorTo, a, me) : Promise.resolve(null),
      gatherMove ? Promise.resolve(null) : nearCross(a),
      gasFees(net!),
      ...bridges.map((b) => lifiQuote({ ...base!, bridge: b }).then((lq) => {
        const r = { ...base!, bridge: b };
        const c = checkLifiTx(lq, r);
        return c.near ? checkNearDeposit(c.near, r).then(() => crossSummary(lq)) : crossSummary(lq);
      })),
    ]);
    const fees = f.status === "fulfilled" ? (f.value as GasFees) : undefined;
    const alts: RouteOpt<BaseQuote>[] = [];
    res.forEach((x, i) => {
      if (x.status !== "fulfilled") return;
      const s = x.value as ReturnType<typeof crossSummary>, b = bridges[i];
      if (s.tool && s.tool !== b) return;
      alts.push({ id: b, name: LIFI_BRIDGE_NAMES[b] ?? b, out: s.amountOut, min: s.minOut, secs: s.secs, q: { kind: "cross", s, fees, bridge: b } });
    });
    if (nr.status === "fulfilled" && nr.value) alts.push(nr.value);
    if (tc.status === "fulfilled" && tc.value) {
      const q = tc.value, least = thorLeastDelivered(q.amountOut, q.outFee) ?? (q.amountOut * 99n) / 100n;
      alts.push({ id: "thor", name: "THORChain", out: q.amountOut, min: least, secs: q.secs, q: { kind: "thorbuy", coin: thorTo!, pay: thorCrossPay!, q, fees, activate: null,
        s: { amountOut: q.amountOut, minOut: least, feePct: (q.feeBps ?? 0) / 100, outFee: q.outFee, secs: q.secs, costPct: q.feeBps != null ? q.feeBps / 100 : 0 } } });
    }
    if (alts.length) return showRoutes(alts);
    if (nr.status === "rejected" && ["small", "big"].includes((nr.reason as { onebuy?: boolean; kind?: string })?.kind ?? "")) throw nr.reason;
    const errs = res.map((x) => (x.status === "rejected" ? x.reason : null)).filter(Boolean) as { message?: string }[];
    if (errs.length && errs.every((e) => e.message === "ERR_UNSAFE")) throw Object.assign(new Error("ERR_ROUTE"), { route: true });
    throw errs.find((e) => e.message !== "ERR_UNSAFE") ?? new Error("ERR_NET");
  }

  const tronRoute = async (a: bigint): Promise<BaseQuote> => {
    const lq = await tronLifiQuote(tronReq(a));
    let callData: string;
    try { callData = checkTronLifiTx(lq, tronReq(a)).callData; } catch (e) { if ((e as Error).message === "ERR_UNSAFE") throw Object.assign(new Error("ERR_ROUTE"), { route: true }); throw e; }

    const [cost, px] = await Promise.all([tronSwapCost(tronMe, a, callData).catch(() => null), fetchPrices([TRON.coingecko], "usd").catch(() => ({}) as Prices)]);
    return { kind: "tron" as const, s: tronCrossSummary(lq), cost, trxUsd: px[TRON.coingecko]?.price ?? null };
  };

  const twoStepRoute = async (a: bigint): Promise<BaseQuote> => {
    const jq = await solQuote(from, SOL_USDC, a, solMe, { noFee: true });
    const r = mayanReq(jq.amountOut, SOL_USDC);
    let mq: MayanQuote;
    try { mq = await mayanQuote(r); } catch (e) { if ((e as Error).message === "ERR_UNSAFE") throw Object.assign(new Error("ERR_ROUTE"), { route: true }); throw e; }
    const sm = mayanSummary(mq);

    return { kind: "mayan" as const, q: mq, r, two: jq, s: { ...sm, minOut: jq.amountOut > 0n ? (sm.minOut * jq.minOut) / jq.amountOut : 0n } };
  };

  const mayanRoute = (a: bigint): Promise<BaseQuote> => mayanQuote(mayanReq(a)).then((mq) => ({ kind: "mayan" as const, q: mq, r: mayanReq(a), s: mayanSummary(mq) }))
    .catch((e) => { if ((e as Error).message === "ERR_UNSAFE") throw Object.assign(new Error("ERR_ROUTE"), { route: true }); throw e; });

  async function withNear(a: bigint, own: Promise<BaseQuote> | null, id: string, name: string): Promise<FormQuote> {
    const [o, n] = await Promise.allSettled([own ?? Promise.reject(new Error("ERR_UNSUPPORTED")), nearCross(a)]);
    const alts: RouteOpt<BaseQuote>[] = [];
    if (o.status === "fulfilled") { const s = (o.value as { s: { amountOut: bigint; minOut: bigint; secs?: number | null } }).s; alts.push({ id, name, out: s.amountOut, min: s.minOut, secs: s.secs ?? null, q: o.value }); }
    if (n.status === "fulfilled" && n.value) alts.push(n.value);
    if (alts.length) return showRoutes(alts);
    const nk = n.status === "rejected" ? (n.reason as { onebuy?: boolean; kind?: string }) : null;
    if (nk?.onebuy && (nk.kind === "small" || nk.kind === "big")) throw nk;
    if (o.status === "rejected" && (o.reason as Error)?.message !== "ERR_UNSUPPORTED") throw o.reason;
    if (n.status === "rejected") throw n.reason;
    throw Object.assign(new Error("ERR_ROUTE"), { route: true });
  }

  async function nativeBuyQuote(a: bigint): Promise<FormQuote> {
    const coin = buyCoin!, dest = ownDest(coin), tcoin = thorBuys(coin) ? coin : null;
    const [th, on, f, act] = await Promise.allSettled([
      thorP && tcoin ? thorBuyQuote(thorP, tIn.decimals, tcoin, a, dest) : Promise.reject(new Error("ERR_UNSUPPORTED")),
      oneP ? oneQuote(oneReq(a, coin, oneP!)) : Promise.reject(new Error("ERR_UNSUPPORTED")),
      net ? gasFees(net) : Promise.resolve(undefined),
      coin === "XRP" ? xrpActivationNeed(dest) : Promise.resolve(null),
    ]);
    if (act.status === "rejected") throw new Error("ERR_NET");
    const need = act.value, fees = f.status === "fulfilled" ? f.value : undefined;
    const thorMin = (q: ThorBuyQuote) => thorLeastDelivered(q.amountOut, q.outFee) ?? (q.amountOut * 99n) / 100n;
    const ts = th.status === "fulfilled" && activationCovered(thorLeastDelivered(th.value.amountOut, th.value.outFee), need) ? th.value : null;
    const os = on.status === "fulfilled" && activationCovered(on.value.minOut, need) ? oneSummary(on.value) : null;

    const alts: RouteOpt<BaseQuote>[] = [];
    if (ts && tcoin) alts.push({ id: "thor", name: "THORChain", out: ts.amountOut, min: thorMin(ts), secs: ts.secs, q: { kind: "thorbuy", coin: tcoin, pay: thorP!, q: ts, fees, activate: need,
      s: { amountOut: ts.amountOut, minOut: thorMin(ts), feePct: (ts.feeBps ?? 0) / 100, outFee: ts.outFee, secs: ts.secs, costPct: ts.feeBps != null ? ts.feeBps / 100 : 0 } } });
    if (os) alts.push({ id: "one", name: "NEAR Intents", out: os.amountOut, min: os.minOut, secs: os.secs, q: { kind: "onebuy", dest: coin, pay: oneP!, s: os, fees, activate: need } });
    if (alts.length) return showRoutes(alts);

    if (need != null && (th.status === "fulfilled" || on.status === "fulfilled")) throw Object.assign(new Error("ERR_XRP_ACTIVATE"), { need });
    throw Object.assign(new Error("ERR_NATIVEBUY"), { nativeWhy: nativeBuyFailure(th.status === "rejected" ? th.reason : null, on.status === "rejected" ? on.reason : null) });
  }
  const usdText = (u: number) => `$${u.toLocaleString("en-US")}`;

  const oneText = (e: unknown) => { const n = e as { kind?: string; minIn?: bigint | null; minUsd?: number | null };
    return nativeText({ why: n.kind === "small" ? "small" : n.kind === "big" ? "big" : n.kind === "busy" ? "busy" : "none", minIn: n.minIn ?? null, minUsd: n.minUsd ?? null }, tOut.symbol); };

  const nativeText = (w: NativeWhy, sym: string) => w.why === "small" && w.minIn ? fill(t.buyMinCoin, { c: sym, a: amt(formatUnitsStr(((w.minIn * 102n) / 100n), tIn.decimals), tIn.decimals), s: tIn.symbol })
    : w.why === "small" && w.minUsd ? fill(t.buyMinUsd, { c: sym, u: usdText(w.minUsd), s: tIn.symbol, n: tIn.netName })
    : w.why === "busy" ? t.busyWait : w.why === "big" ? t.btcBuyBig : w.why === "net" ? t.errNet : fill(t.buyNoPrice, { c: sym });

  const cents = (v: bigint, d: number) => { const u = 10n ** BigInt(Math.max(0, d - 2)); return ((v + u - 1n) / u) * u; };
  const dollarIn = /^(USD|DAI)/i.test(tIn.symbol);
  const buyText = (w: BtcBuyWhy) => w.why === "small" && w.minIn ? fill(t.btcBuyMin, { a: dollarIn ? amt(formatUnitsStr(cents((w.minIn * 102n) / 100n, tIn.decimals), tIn.decimals)) : amt(formatUnitsStr((w.minIn * 102n) / 100n, tIn.decimals), tIn.decimals), s: tIn.symbol })
    : w.why === "payWith" ? t.btcBuyPayWith : w.why === "busy" ? t.busyWait : w.why === "big" ? t.btcBuyBig : w.why === "net" ? t.errNet : t.btcBuyNoRoute;

  const balFor = useRef("");
  useEffect(() => {
    const k = `${pay.netId}|${from}|${idx}`;
    if (balFor.current !== k) { balFor.current = k; setBal(null); }
    (async () => {
      try {
        if (isBtcPay) { setBal((await btcBalance(btcMe)).confirmed); return; }
        if (utxoC) { setBal((await utxoBalance(utxoC, sellMe)).confirmed); return; }
        if (isXrpPay) { setBal((await xrpBalances(xrpMe)).spendable); return; }
        if (isAdaPay) { setBal((await adaBalance(adaMe)).lovelace); return; }
        if (isTrxPay) { setBal((await tronBalances(tronMe)).sun); return; }
        if (isNearPay) { setBal((await nearBalances(nearMe)).spendable); return; }
        if (isTronPay) { setBal((await tronBalances(tronMe)).usdt); return; }
        if (isSolNet) {
          const b = await solBalances(solMe, from === SOL_MINT ? [] : [from]);
          setBal(from === SOL_MINT ? b.lamports : b.tokens.get(from) ?? 0n);
        } else {
          const c = publicClient(net!);
          setBal(from === EVM_NATIVE ? await c.getBalance({ address: me }) : ((await c.readContract({ address: from as Address, abi: erc20Abi, functionName: "balanceOf", args: [me] })) as bigint));
        }
      } catch { setBal(null); }
    })();
  }, [from, pay.netId, idx, done, sent, tick]);

  useEffect(() => { routePick.current = null; setRouteGone(false); }, [from, to, pay.netId, get.netId]);

  useEffect(() => {
    const quiet = silent.current; silent.current = false;
    if (!quiet) { setQuote(null); setQErr(""); }
    if (!moved.current && !quiet) setErr(""); moved.current = false;
    if (!amtIn || amtIn <= 0n || sameTok(pay, get) || soon) { setQuote(null); setLoading(false); return; }
    const my = ++seq.current;
    if (!quiet) setLoading(true);
    const timer = setTimeout(async () => {
      try {

        const q: FormQuote = isSellPay ? await sellRoutes(amtIn!)

          : nativeBuy ? await nativeBuyQuote(amtIn!)
          : toBtc && (isSolNet || isTronPay) ? await btcBuyQuote(amtIn!)

          : isTronPay ? await withNear(amtIn!, tronOk ? tronRoute(amtIn!) : null, "lifi", "LI.FI")
          : isSolNet && cross ? await withNear(amtIn!, twoStep ? twoStepRoute(amtIn!) : mayanOk ? mayanRoute(amtIn!) : null, "mayan", "Mayan")
          : cross && toBtc ? await btcBuyQuote(amtIn!)
          : cross ? await crossRoutes(amtIn!)
          : { kind: "same", q: isSolNet ? await solQuote(from, to, amtIn!, solMe) : await bestEvmQuote(net!, from, to, amtIn!, me, evmQuote) };
        if (my === seq.current) setQuote(q);
      } catch (e) {
        const x = e as { status?: number; noRoute?: boolean; message?: string; route?: boolean; sell?: boolean; kind?: string; minSats?: bigint | null; btcbuyWhy?: BtcBuyWhy; nativeWhy?: NativeWhy; need?: bigint; payNeed?: bigint | null };
        if (my === seq.current && quiet) setQuote(null);
        if (my === seq.current && x.nativeWhy) setQErr(nativeText(x.nativeWhy, tOut.symbol));
        else if (my === seq.current && x.message === "ERR_XRP_ACTIVATE") setQErr(x.payNeed != null
          ? fill(t.xrpSwapTooSmall, { r: formatXrp(x.need ?? 0n), p: coinTxt(x.payNeed), c: tIn.symbol }) : fill(t.xrpBuyTooSmall, { r: formatXrp(x.need ?? 0n) }));
        else if (my === seq.current && x.btcbuyWhy) setQErr(buyText(x.btcbuyWhy));
        else if (my === seq.current && x.sell) {
          const key = `${pay.netId}|${from}`;
          const moved = x.kind === "small" && !!thorCoin && !thorSell && autoBase.current !== key && !!onThorBase?.();
          if (moved) { autoBase.current = key; setInfo(fill(t.thorAutoBase, { c: tIn.symbol })); setInfoWait(false); }
          else setQErr(sellText(x));
        }
        else if (my === seq.current && (x as { onebuy?: boolean }).onebuy) setQErr(oneText(x));
        else if (my === seq.current) setQErr(x.route ? (isTronPay ? t.swapNoRoute : fill(t.crossUnavailable, { sym: tIn.symbol })) : x.noRoute || x.status === 400 || /route/i.test(x.message ?? "") ? t.swapNoRoute : t.errNet);
      }
      if (my === seq.current) setLoading(false);
    }, 500);
    return () => clearTimeout(timer);
  }, [from, to, amount, pay.netId, get.netId, requote]);

  useEffect(() => {
    if (!quote || loading || step !== "idle" || (sellReview && sellReview.sats === amtIn)) { setLeft(0); return; }
    let s = REFRESH_S; setLeft(s);
    const id = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      s -= 1; setLeft(s);
      if (s <= 0) { clearInterval(id); silent.current = true; setRequote((n) => n + 1); }
    }, 1000);
    return () => clearInterval(id);
  }, [quote, loading, step]);

  const insufficient = bal != null && amtIn != null && amtIn > bal;
  const trx = (sun?: bigint) => `⁦${amt(formatUnitsStr(sun && sun > 0n ? sun : 0n, 6), 6)}⁩`;
  const iso = (s: string) => `⁦${s}⁩`;
  const friendly = (e: unknown) => {
    const m = (e as Error)?.message ?? "";
    if (payExtra && isSellPay) {
      const x = e as { waiting?: bigint; skipped?: bigint; need?: bigint; max?: bigint; reserve?: bigint; code?: string; amount?: bigint; to?: string };
      const xrp = (d: bigint) => iso(formatXrp(d < 0n ? 0n : d));
      if (utxoC) {
        if (m === "ERR_FUNDS") return [t.errFunds, x.waiting ? fill(t.utxoWaiting, { w: iso(formatUtxo(x.waiting)), sym: utxoC.symbol }) : "", x.skipped ? fill(t.utxoMweb, { s: iso(formatUtxo(x.skipped)), sym: utxoC.symbol }) : ""].filter(Boolean).join(" ");
        if (m === "ERR_DUST") return fill(t.errCoinDust, { n: utxoC.name, d: formatUtxo(utxoC.dust), sym: utxoC.symbol });
        if (m === "ERR_FEE_HIGH") return t.errCoinFeeHigh;
        if (m === "ERR_PROVIDER") return t.errProvider;
        if (m === "ERR_BROADCAST") return t.errBroadcast;
      } else if (isAdaPay) {
        if (m === "ERR_FUNDS") return [t.errFunds, x.max ? fill(t.adaMax, { m: iso(formatAda(x.max)) }) : ""].filter(Boolean).join(" ");
        if (m === "ERR_ADA_MIN") return fill(t.errAdaMin, { m: iso(formatAda((e as { min?: bigint }).min ?? 0n)) });
        if (m === "ERR_ADA_CHANGE") return fill(t.errAdaChange, { m: iso(formatAda(x.max ?? 0n)), k: iso(formatAda((e as { keep?: bigint }).keep ?? 0n)) });
        if (m === "ERR_ADA_INPUTS") return t.errAdaInputs;
        if (m === "ERR_FEE_HIGH") return t.errCoinFeeHigh;
        if (m === "ERR_PROVIDER") return t.errProvider;
        if (m === "ERR_BROADCAST") return t.errBroadcast;
        if (m === "ERR_SELF" || m === "ERR_ADDRESS" || m === "ERR_ADA_SCRIPT") return t.swapUnsafe;
        if (m === "ERR_ADA_TIME") return t.errAdaTime;
      } else if (isNearPay) {
        const near = (y: bigint) => iso(formatNear(y < 0n ? 0n : y));
        if (m === "ERR_NEAR_PENDING") return fill(t.nearPendingBlock, { a: near(x.amount ?? 0n), to: iso(short(x.to ?? "")) });
        if (m === "ERR_NEAR_MIN") return fill(t.errNearMin, { m: near(x.need ?? 0n) });
        if (m === "ERR_FUNDS" && x.reserve != null) return fill(t.errNearFunds, { m: near(x.max ?? 0n), r: near(x.reserve) });
        if (m === "ERR_NEAR_INACTIVE") return t.errNearInactive;
        if (m === "ERR_NEAR_KEY") return t.errNearKey;
        if (m === "ERR_FEE_HIGH") return t.errNearFeeHigh;
        if (m === "ERR_NEAR_REFUSED") return fill(t.errNearRefused, { c: x.code ?? "" });
        if (m === "ERR_NEAR_CHAIN") return fill(t.errNearChain, { c: x.code ?? "" });
        if (m === "ERR_NEAR_DROPPED") return t.errNearDropped;
        if (m === "ERR_NEAR") return t.errProvider;

        if (["ERR_SELF", "ERR_ADDRESS", "ERR_NO_ACCOUNT", "ERR_NEAR_ETH", "ERR_NEAR_CASE"].includes(m)) return t.swapUnsafe;
      } else {
        if (m === "ERR_XRP_PENDING") return fill(t.xrpPendingBlock, { a: xrp(x.amount ?? 0n), to: iso(short(x.to ?? "")) });
        if (m === "ERR_XRP_INACTIVE") return fill(t.errXrpInactive, { r: xrp(x.need ?? 0n) });
        if (m === "ERR_XRP_ACTIVATE") return fill(t.btcSellMin, { m: formatXrp(x.need ?? 0n), c: "XRP" });
        if (m === "ERR_FUNDS" && x.reserve != null) return fill(t.errXrpFunds, { m: xrp(x.max ?? 0n), r: xrp(x.reserve) });
        if (m === "ERR_FEE_HIGH") return t.errXrpFeeHigh;
        if (m === "ERR_HOSTS") return t.errXrpHosts;
        if (m === "ERR_XRPL") return t.errProvider;
        if (m === "ERR_XRP_REFUSED") return fill(t.errXrpRefused, { c: x.code ?? "" });
        if (m === "ERR_XRP_CHAIN") return fill(t.errXrpChain, { c: x.code ?? "" });
        if (m === "ERR_XRP_DROPPED") return t.errXrpDropped;

        if (["ERR_TAG_REQUIRED", "ERR_XRP_DISALLOWED", "ERR_DEPOSIT_AUTH", "ERR_SELF", "ERR_ADDRESS"].includes(m)) return t.swapUnsafe;
        if (/tooBusy|slowDown/i.test(m)) return t.errNet;
      }
    }
    if (isTrxPay) {
      const mx = (e as { max?: bigint }).max;
      if (m === "ERR_FUNDS" && mx != null) return fill(t.trxSaleMax, { m: iso(formatUnitsStr(mx, 6)) });
      if (m === "ERR_PROGRAM" || m === "ERR_SELF" || m === "ERR_ADDRESS") return t.swapUnsafe;
      if (m === "ERR_BROADCAST") return t.errBroadcast;
    }
    if (m === "ERR_TRX_FEE") return fill(t.tronFeeShort, { n: trx((e as { need?: bigint }).need), h: trx((e as { have?: bigint }).have) });
    if (isTronPay && m === "ERR_FEE_HIGH") return t.errTronFeeHigh;
    if (m === "ERR_TRON_CALL") return t.swapWouldFail;
    if (m === "ERR_TRON_BUILD") return t.errTronBuild;
    if (m === "ERR_BUSY") return t.busyWait;
    if (m === "ERR_MOVED") return t.swapMoved;
    if (e instanceof ThorSellCheck) return e.why === "paused" ? t.busyWait : e.why === "vault" ? t.swapUnsafe : t.errNet;
    if (m === "ERR_FEE_SOL") return t.feeAcctSol;

    if (m === "ERR_SIM_FAIL") { const why = (e as { reason?: string }).reason; return why === "price" ? t.swapMoved : why === "balance" ? t.errFunds : t.swapWouldFail; }
    if (m === "ERR_UNSAFE") return t.swapUnsafe;
    if (m === "ERR_FEE_HIGH") return t.errFeeHigh;
    if (m === "ERR_FEE_UNKNOWN") return t.errNet;
    if (m === "ERR_PENDING") return t.swapPending;
    if (m === "ERR_CHAIN") return t.swapFailed;
    if (m === "ERR_DROPPED") return t.swapDropped;

    if (/revert|simulation failed|would fail|execution reverted/i.test(m)) return t.swapWouldFail;
    if (m === "ERR_SOL_GAS") return t.solGasMayan;

    if (m === "ERR_SOL_REST") return fill(t.errSolRest, { amt: formatUnitsStr(solRent.min, 9) });
    if (m === "ERR_SOL_MIN") return fill(t.errSolMin, { amt: formatUnitsStr(solRent.min, 9) });
    if (m === "ERR_FUNDS") return t.errFunds;
    if (m === "ERR_DUST") return t.errDust;
    if (m === "ERR_FEE_SHARE") return fill(coinTo ? t.swapFeeHigh : t.btcSellFeeHigh, { f: coinTxt((e as { fee?: bigint }).fee ?? 0n), c: tIn.symbol, n: tIn.netName });
    if (m === "ERR_NET") return t.errNet;
    const nb = e as { onebuy?: boolean; thorbuy?: boolean; kind?: string; minIn?: bigint | null; minUsd?: number | null };
    if ((nb?.onebuy || nb?.thorbuy) && (toNative || buyCoin)) return nativeText({ why: nb.kind === "small" ? "small" : nb.kind === "big" ? "big" : nb.kind === "busy" ? "busy" : "none", minIn: nb.minIn ?? null, minUsd: nb.minUsd ?? null }, tOut.symbol);
    if (nb?.onebuy && nb.kind === "small" && nb.minIn == null && nb.minUsd != null) return nativeText({ why: "small", minIn: null, minUsd: nb.minUsd }, tOut.symbol);
    if ((nb?.onebuy || nb?.thorbuy) && toBtc) return buyText({ why: nb.kind === "small" ? "small" : nb.kind === "big" ? "big" : nb.kind === "busy" ? "busy" : "none", minIn: nb.minIn ?? null });
    if (nb?.onebuy) return oneText(nb);
    if (m === "ERR_GAS") return fill(t.needGas, { sym: isSolNet ? "SOL" : isTronPay ? "TRX" : net?.native.symbol ?? "" });
    if (m === "ERR_TOKEN") return t.swapUnsafe;
    const bb = e as { btcbuy?: boolean; kind?: string; minIn?: bigint | null };
    if (bb?.btcbuy) return buyText({ why: bb.kind === "small" ? "small" : bb.kind === "big" ? "big" : bb.kind === "busy" ? "busy" : "none", minIn: bb.minIn ?? null });
    if ((e as { sell?: boolean })?.sell) return sellText(e as never);
    if (/insufficient|exceeds balance/i.test(m)) return t.errFunds;
    if (/fetch|network|timeout|HTTP|abort/i.test(m)) return t.errNet;
    return t.errGeneric;
  };
  async function go() {
    if (!quote || !amtIn) return;

    const paused = [pay.netId, get.netId].find((id) => netOff(id));
    if (paused) { setErr(fill(t.netPaused, { n: netLabel(paused) })); return; }
    setErr(""); void touch();
    try {
      if (quote.kind === "sell" || quote.kind === "thorsell") {
        const pendings = { get: getPending, clear: clearPending, remove: removeActivity };

        const thor = quote.kind === "thorsell" ? quote : null;
        const reviewMemo = thor ? new TextEncoder().encode(thorSellMemo(thor.to, thorPayTo(thor.to), thorSellLimit(thor.q.out8, thor.coin))) : undefined;
        const routed = { kind: quote.kind, routeId: quote.routeId };
        if (!sellReview || sellReview.sats !== amtIn || sellReview.kind !== quote.kind) {
          routePick.current = quote.routeId ?? null;

          setStep("swapping");
          if (isBtcPay) {

            const prev = await btcSalePending(btcMe, pendings);
            if (prev && prevOk !== prev.txid) { setSalePrev(prev); setStep("idle"); return; }
            setSalePrev(null);
            const fees = await btcFees();

            const rateOf = (base: number) => (thor ? thorSellFeeRate("BTC", base, thor.q.gasRate, clampFeeRate) : base);

            const atNormal = () => quoteBtcSend(phrase, idx, btcMe, formatBtc(amtIn), rateOf(fees.normal), reviewMemo);
            let pre = fees.fast > fees.normal
              ? await quoteBtcSend(phrase, idx, btcMe, formatBtc(amtIn), rateOf(fees.fast), reviewMemo).catch((e) => { if ((e as Error)?.message === "ERR_FUNDS") return atNormal(); throw e; })
              : await atNormal();
            if (sellFeeTooHigh(amtIn, pre.fee) && pre.feeRate > rateOf(fees.normal)) pre = await atNormal();
            if (sellFeeTooHigh(amtIn, pre.fee)) throw Object.assign(new Error("ERR_FEE_SHARE"), { fee: pre.fee });
            setSellReview({ sats: amtIn, fee: pre.fee, feeRate: pre.feeRate, ...routed });
          } else if (utxoC) {

            const prev = await utxoSalePending(utxoC, sellMe, pendings);
            if (prev && prevOk !== prev.txid) { setSalePrev(prev); setStep("idle"); return; }
            const fees = await utxoFees(utxoC);
            const rate = thor ? thorSellFeeRate(thor.coin, fees.normal, thor.q.gasRate, (r) => clampUtxoRate(utxoC, r)) : fees.normal;
            const pre = await reviewUtxoSale(utxoC, phrase, idx, amtIn, rate, await ownTxids(utxoC), undefined, reviewMemo);
            if (sellFeeTooHigh(amtIn, pre.fee)) throw Object.assign(new Error("ERR_FEE_SHARE"), { fee: pre.fee });
            setSalePrev(null);
            setSellReview({ sats: amtIn, fee: pre.fee, feeRate: pre.feeRate, ...routed });
          } else if (isAdaPay) {

            const prev = await adaSalePending(sellMe, pendings);
            if (prev && prevOk !== prev.txid) { setSalePrev(prev); setStep("idle"); return; }
            const pre = await reviewAdaSale(phrase, idx, amtIn, prev?.ins ?? []);
            if (sellFeeTooHigh(amtIn, pre.fee)) throw Object.assign(new Error("ERR_FEE_SHARE"), { fee: pre.fee });
            setSalePrev(null);
            setSellReview({ sats: amtIn, fee: pre.fee, feeRate: 0, ...routed });
          } else if (isTrxPay) {

            const fresh = thor ? !(await tronAccount(thor.q.vault)).active : true;
            const pre = await reviewTrxSale(phrase, idx, amtIn, reviewMemo?.length ?? 0, fresh);
            if (sellFeeTooHigh(amtIn, pre.fee)) throw Object.assign(new Error("ERR_FEE_SHARE"), { fee: pre.fee });
            setSellReview({ sats: amtIn, fee: pre.fee, feeRate: 0, ...routed });
          } else if (isNearPay) {

            const open = await nearSalePending(nearMe, pendings);
            if (open) throw Object.assign(new Error("ERR_NEAR_PENDING"), { amount: open.amount, to: open.to });
            const pre = await reviewNearSale(phrase, idx, amtIn);
            if (sellFeeTooHigh(amtIn, pre.fee)) throw Object.assign(new Error("ERR_FEE_SHARE"), { fee: pre.fee });
            setSellReview({ sats: amtIn, fee: pre.fee, feeRate: 0, reserve: pre.reserve, ...routed });
          } else {
            const open = await xrpSalePending(xrpMe, pendings);
            if (open) throw Object.assign(new Error("ERR_XRP_PENDING"), { amount: open.amount, to: open.to });
            const pre = await reviewXrpSale(phrase, idx, amtIn);
            if (sellFeeTooHigh(amtIn, pre.fee)) throw Object.assign(new Error("ERR_FEE_SHARE"), { fee: pre.fee });
            setSellReview({ sats: amtIn, fee: pre.fee, feeRate: 0, reserve: pre.reserve, ...routed });
          }
          setStep("idle");
          return;
        }

        const rv = sellReview;
        setStep("swapping");

        if (utxoC) { const prev = await utxoSalePending(utxoC, sellMe, pendings); if (prev && prevOk !== prev.txid) { setSellReview(null); setSalePrev(prev); setStep("idle"); return; } }
        if (isBtcPay) { const prev = await btcSalePending(btcMe, pendings); if (prev && prevOk !== prev.txid) { setSellReview(null); setSalePrev(prev); setStep("idle"); return; } }
        if (isXrpPay) { const open = await xrpSalePending(xrpMe, pendings); if (open) throw Object.assign(new Error("ERR_XRP_PENDING"), { amount: open.amount, to: open.to }); }
        if (isAdaPay) { const prev = await adaSalePending(sellMe, pendings); if (prev && prevOk !== prev.txid) { setSellReview(null); setSalePrev(prev); setStep("idle"); return; } }
        if (isNearPay) { const open = await nearSalePending(nearMe, pendings); if (open) throw Object.assign(new Error("ERR_NEAR_PENDING"), { amount: open.amount, to: open.to }); }
        let deposit: string, memo: Uint8Array | undefined;
        if (thor) {

          if (isXrpPay || !THOR_SELL_FROM[thor.coin]) throw new Error("ERR_UNSAFE");
          const fresh = await thorSellQuote(thor.coin, amtIn, thor.to, thorPayTo(thor.to), undefined, true);
          if (fresh.amountOut * 10000n < quote.s.amountOut * BigInt(10000 - SLIPPAGE_BPS)) throw new Error("ERR_MOVED");
          deposit = await thorSellVault(thor.coin, thor.to, amtIn);

          const fl = thorSellLimit(fresh.out8, thor.coin), rl = thorSellTo8(quote.s.minOut, thor.to.dec);
          memo = new TextEncoder().encode(thorSellMemo(thor.to, thorPayTo(thor.to), fl > rl ? fl : rl));
        } else {
          const sq = await sellQuote({ sats: amtIn, asset: sellTo!, recipient: sellDest, refundTo: sellMe, dry: false, coin: sellCoin! });
          if (sq.amountOut * 10000n < quote.s.amountOut * BigInt(10000 - SLIPPAGE_BPS)) throw new Error("ERR_MOVED");

          if (quote.kind === "sell" && !activationCovered(sq.minOut, quote.activate ?? null)) throw new Error("ERR_MOVED");
          deposit = sq.deposit!;
        }
        let txid: string, wait: string | null = null;
        const outBand = outBandOf(quote.s, tOut.decimals);
        const toSide = saleTo(tOut, coinTo);
        if (isBtcPay) {
          const bq = await quoteBtcSend(phrase, idx, deposit, formatBtc(amtIn), rv.feeRate, memo);
          checkSellPayment(bq, deposit, amtIn, rv);

          const signed = signBtcPayment(phrase, idx, bq);
          txid = signed.txid;
          const at = Date.now();
          try {
            await setPending({ ...btcPendingOf(btcMe, bq, signed), at });
            await addActivity({ at, networkId: BTC.id, kind: "swap", asset: `BTC → ${tOut.symbol}`, amount: formatBtc(amtIn), to: deposit, hash: txid, from: btcMe, toNetworkId: get.netId, ...outBand });
          } catch { await clearPending(BTC.id, btcMe, txid).catch(() => {}); throw new Error("ERR_RECORD"); }
          let state: "sent" | "unknown" = "unknown";
          try { state = await broadcastBtc(signed.hex, txid); }
          catch (e) {
            if ((e as Error)?.message === "ERR_BROADCAST") { await clearPending(BTC.id, btcMe, txid).catch(() => {}); await removeActivity(txid).catch(() => {}); throw e; }
          }
          if (state === "sent") await clearPending(BTC.id, btcMe, txid).catch(() => {});
          else wait = t.utxoUnknown;
        } else if (utxoC) {

          const uq = await quoteUtxoSend(utxoC, phrase, idx, deposit, formatUtxo(amtIn), rv.feeRate, await ownTxids(utxoC), memo);
          if (!!memo !== !!uq.memo) throw new Error("ERR_UNSAFE");
          checkUtxoSellPayment(uq, utxoC, deposit, amtIn, rv);
          const signed = signUtxoPayment(utxoC, phrase, idx, uq);
          txid = signed.txid;

          const at = Date.now();
          try {
            await setPending({ ...utxoPendingOf(utxoC, uq, signed), at });
            await addActivity({ at, networkId: utxoC.id, kind: "swap", asset: `${utxoC.symbol} → ${tOut.symbol}`, amount: formatUtxo(amtIn), to: deposit, hash: txid, from: sellMe, toNetworkId: get.netId, ...outBand });
          } catch { await clearPending(utxoC.id, sellMe, txid).catch(() => {}); throw new Error("ERR_RECORD"); }
          let state: "sent" | "unknown" = "unknown";
          try { state = await broadcastUtxo(utxoC, signed.hex, txid); }
          catch (e) {
            if ((e as Error)?.message === "ERR_BROADCAST") {
              await clearPending(utxoC.id, sellMe, txid).catch(() => {}); await removeActivity(txid).catch(() => {});
              throw e;
            }
          }
          if (state === "sent") await clearPending(utxoC.id, sellMe, txid).catch(() => {});
          else wait = t.utxoUnknown;
        } else if (isAdaPay) {

          const aq = await quoteAdaSend(phrase, idx, deposit, formatAda(amtIn), await adaBusy());
          checkAdaSellPayment(aq, deposit, amtIn, rv);
          const signed = signAdaPayment(phrase, idx, aq);
          txid = signed.hash;

          const at = Date.now();
          try {
            await setPending({ ...adaPendingOf(aq, signed), at });
            await addActivity({ at, networkId: ADA.id, kind: "swap", asset: `ADA → ${tOut.symbol}`, amount: formatAda(amtIn), to: deposit, hash: txid, from: sellMe, toNetworkId: get.netId, ...outBand });
          } catch { await clearPending(ADA.id, sellMe, txid).catch(() => {}); throw new Error("ERR_RECORD"); }
          let state: "sent" | "unknown" = "unknown";
          try { state = await submitAda(signed.cbor, txid); }
          catch (e) {
            const x = e as { message?: string; notSent?: boolean };
            if (x?.message === "ERR_BROADCAST" || (x?.message === "ERR_BUSY" && x.notSent)) {
              await clearPending(ADA.id, sellMe, txid).catch(() => {}); await removeActivity(txid).catch(() => {});
              throw e;
            }
          }
          if (state !== "sent") wait = t.utxoUnknown;
        } else if (isTrxPay) {

          const tq = await quoteTronSend(phrase, idx, deposit, formatUnitsStr(amtIn, 6), undefined, memo);

          checkTrxSellPayment(tq, deposit, amtIn, rv, memo ? Array.from(memo, (b) => b.toString(16).padStart(2, "0")).join("") : undefined);
          const signed = await signTronSend(phrase, idx, tq);
          txid = signed.txID;
          try { await addActivity({ at: Date.now(), networkId: TRON.id, kind: "swap", asset: `TRX → ${tOut.symbol}`, amount: formatUnitsStr(amtIn, 6), to: deposit, hash: txid, from: tronMe, toNetworkId: get.netId, ...outBand }); }
          catch { throw new Error("ERR_RECORD"); }
          let accepted = false;
          try { await tronBroadcast(signed); accepted = true; } catch {  }
          if (!accepted) {

            const end = await tronSettle(txid, signed.expiration);
            if (end === "dropped") { await removeActivity(txid).catch(() => {}); throw new Error("ERR_BROADCAST"); }
            if (end === "unknown") wait = t.utxoUnknown;
          }
        } else if (isNearPay) {

          const nq = await quoteNearSend(phrase, idx, deposit, formatNear(amtIn));
          checkNearSellPayment(nq, nearMe, deposit, amtIn, rv);
          const s = await signNearSend(phrase, idx, nq);
          checkNearSellPayment(s, nearMe, deposit, amtIn, rv);
          txid = s.hash;
          const at = Date.now();
          try {
            await setPending({ ...nearPendingOf(s), at });
            await addActivity({ at, networkId: NEAR.id, kind: "swap", asset: `NEAR → ${tOut.symbol}`, amount: formatNear(amtIn), to: deposit, hash: txid, from: nearMe, toNetworkId: get.netId, ...outBand });
          } catch { await clearPending(NEAR.id, nearMe, txid).catch(() => {}); throw new Error("ERR_RECORD"); }
          const r = await submitNear(s);
          if (r.state === "refused") {
            await clearPending(NEAR.id, nearMe, txid).catch(() => {}); await removeActivity(txid).catch(() => {});
            throw Object.assign(new Error("ERR_NEAR_REFUSED"), { code: r.code });
          }

          const end: NearEnd = r.state === "ok" ? { state: "ok" } : r.state === "failed" ? { state: "failed", code: r.code } : await waitNear(s, at, { maxMs: 30_000 });
          if (end.state !== "pending") await clearPending(NEAR.id, nearMe, txid).catch(() => {});
          if (end.state === "dropped") { await removeActivity(txid).catch(() => {}); throw new Error("ERR_NEAR_DROPPED"); }
          if (end.state === "failed") throw Object.assign(new Error("ERR_NEAR_CHAIN"), { code: end.code });
          if (end.state === "pending") wait = t.nearPendingNote;
        } else {

          const xq = await quoteXrpSend(phrase, idx, deposit, "", formatXrp(amtIn));
          checkXrpSellPayment(xq, xrpMe, deposit, amtIn);
          const s = await signXrpSend(phrase, idx, xq);
          checkXrpSellPayment(s, xrpMe, deposit, amtIn);
          txid = s.hash;
          const at = Date.now();
          try {
            await setPending({ ...xrpPendingOf(s), at });
            await addActivity({ at, networkId: XRP.id, kind: "swap", asset: `XRP → ${tOut.symbol}`, amount: formatXrp(amtIn), to: deposit, hash: txid, from: xrpMe, toNetworkId: get.netId, ...outBand });
          } catch { await clearPending(XRP.id, xrpMe, txid).catch(() => {}); throw new Error("ERR_RECORD"); }
          const r = await submitXrp(s);
          if (r.state === "refused") {
            await clearPending(XRP.id, xrpMe, txid).catch(() => {}); await removeActivity(txid).catch(() => {});
            throw Object.assign(new Error("ERR_XRP_REFUSED"), { code: r.code ?? "" });
          }

          const end = await waitXrp(s, { maxMs: 60_000 });
          if (end.state === "ok" || end.state === "failed" || end.state === "dropped") await clearPending(XRP.id, xrpMe, txid).catch(() => {});
          if (end.state === "dropped") { await removeActivity(txid).catch(() => {}); throw new Error("ERR_XRP_DROPPED"); }
          if (end.state === "failed") throw Object.assign(new Error("ERR_XRP_CHAIN"), { code: end.code });
          if (end.state === "pending") wait = t.xrpPendingNote;
          if (end.state === "check") wait = fill(t.xrpCheckNote, { c: end.code ?? "" });
        }

        await saveXfer({ hash: txid, from: { netId: pay.netId, chainId: sellCoin!, token: from, decimals: tIn.decimals }, to: toSide,
          at: Date.now(), label: `${coinTxt(amtIn)} ${tIn.symbol} → ${tOut.symbol}`, step: thor ? 1 : 2, end: "", via: thor ? "thorsell" : "near", deposit });
        setAmount(""); swapped(get); setStep("idle");
        setInfo(wait ?? fill(coinTo ? t.coinSwapSent : t.btcSellSent, { c: tIn.symbol })); setInfoWait(!!wait);
        return;
      }
      if (quote.kind === "mayan" && quote.two) {

        const shownMin = quote.s.minOut;
        const { lamports } = await solBalances(solMe);
        if (lamports < MAYAN_SOL_NEEDED + (from === SOL_MINT ? amtIn : 0n) + 10_000n) throw new Error("ERR_SOL_GAS");
        setStep("swapping");
        const jq = await solQuote(from, SOL_USDC, amtIn, solMe, { noFee: true });
        const r0 = mayanReq(jq.amountOut, SOL_USDC);
        const check = await mayanQuote(r0);
        if ((mayanSummary(check).minOut * jq.minOut) / (jq.amountOut || 1n) * 10000n < shownMin * 9990n) throw new Error("ERR_MOVED");
        const before = (await solBalances(solMe, [SOL_USDC])).tokens.get(SOL_USDC) ?? 0n;
        setStage(1);
        const sig1 = await solSwap(phrase, idx, from, SOL_USDC, amtIn, jq.amountOut, jq.minOut, { noFee: true });
        await addActivity({ at: Date.now(), networkId: SOL.id, kind: "swap", asset: `${tIn.symbol} → USDC`, amount: amountTxt, to: solMe, hash: sig1, from: solMe });
        let got = 0n;
        for (let i = 0; i < 45 && got <= 0n; i++) {
          await new Promise((res) => setTimeout(res, 2000));
          got = ((await solBalances(solMe, [SOL_USDC]).catch(() => null))?.tokens.get(SOL_USDC) ?? before) - before;
        }
        setAmount(""); swapped(get);
        const atUsdc = (why: string) => { setStage(0); setStep("idle"); setErr(fill(t.atUsdc, { a: fmt(got > 0n ? got : 0n, 6), why })); };
        if (got <= 0n) { atUsdc(t.errNet); return; }
        setStage(2);
        const r = mayanReq(got, SOL_USDC);
        let fresh: MayanQuote;
        try { fresh = await mayanQuote(r); } catch { atUsdc(t.swapNoRoute); return; }
        if (mayanSummary(fresh).minOut * 10000n < shownMin * 9900n) { atUsdc(t.swapMoved); return; }
        let sig: string;
        try { sig = await sendMayanSwift(phrase, idx, fresh, r); } catch (e) { atUsdc(friendly(e)); return; }
        const side = (netId: string, token: string, decimals: number) => ({ netId, chainId: netId === SOL.id ? ("SOL" as const) : networkById(netId)!.chain.id, token, decimals });
        await saveXfer({ hash: sig, from: side(pay.netId, SOL_USDC, 6), to: side(get.netId, to, tOut.decimals), at: Date.now(), label: `${amountTxt} ${tIn.symbol} → ${tOut.symbol}`, step: 1, end: "", via: "mayan" });
        await addActivity({ at: Date.now(), networkId: pay.netId, kind: "swap", asset: `USDC → ${tOut.symbol}`, amount: fmt(got, 6), to: me, hash: sig, from: solMe, toNetworkId: get.netId });
        setStage(0); setStep("idle");
        return;
      }
      if (quote.kind === "mayan") {
        setStep("swapping");
        const r = mayanReq(amtIn);
        const fresh = await mayanQuote(r);
        if (mayanSummary(fresh).minOut * 10000n < quote.s.minOut * 9990n) throw new Error("ERR_MOVED");
        const sig = await sendMayanSwift(phrase, idx, fresh, r);
        const side = (netId: string, token: string, decimals: number) => ({ netId, chainId: netId === SOL.id ? ("SOL" as const) : networkById(netId)!.chain.id, token, decimals });
        await saveXfer({ hash: sig, from: side(pay.netId, from, tIn.decimals), to: side(get.netId, to, tOut.decimals), at: Date.now(), label: `${amountTxt} ${tIn.symbol} → ${tOut.symbol}`, step: 1, end: "", via: "mayan" });
        await addActivity({ at: Date.now(), networkId: pay.netId, kind: "swap", asset: `${tIn.symbol} → ${tOut.symbol}`, amount: amountTxt, to: me, hash: sig, from: solMe, toNetworkId: get.netId });
        setAmount(""); swapped(get);
        setStep("idle");
        return;
      }
      if (quote.kind === "tron") {

        const r = tronReq(amtIn);
        const hash = await tronLifiSwap(phrase, idx, r, { out: quote.s.amountOut, min: quote.s.minOut }, { approving: () => setStep("approving"), swapping: () => setStep("swapping") });
        const toSide = { netId: get.netId, chainId: r.toChain, token: to, decimals: tOut.decimals };
        await saveXfer({ hash, from: { netId: TRON.id, chainId: "TRON", token: TRON_USDT, decimals: 6 }, to: toSide, at: Date.now(), label: `${amountTxt} USDT → ${tOut.symbol}`, step: 1, end: "", via: "tron" });
        await addActivity({ at: Date.now(), networkId: TRON.id, kind: "swap", asset: `USDT → ${tOut.symbol}`, amount: amountTxt, to: r.to, hash, from: tronMe, toNetworkId: get.netId });
        setAmount(""); swapped(get);
        setStep("idle");
        return;
      }
      if (quote.kind === "thorbuy") {

        const dest = thorDest(quote.coin);
        const hash = await thorBuySend(net!, phrase, idx, me, quote.pay, tIn.decimals, quote.coin, amtIn, dest, { out: quote.s.amountOut }, quote.fees,
          { approving: () => setStep("approving"), sending: () => setStep("swapping") });
        await saveXfer({ hash, from: { netId: pay.netId, chainId: net!.chain.id, token: from, decimals: tIn.decimals }, to: { netId: get.netId, chainId: isThorEvmCoin(quote.coin) ? networkById(get.netId)!.chain.id : quote.coin, token: to, decimals: tOut.decimals },
          at: Date.now(), label: `${amountTxt} ${tIn.symbol} → ${tOut.symbol}`, step: 1, end: "", via: "thor" });
        await addActivity({ at: Date.now(), networkId: pay.netId, kind: "swap", asset: `${tIn.symbol} → ${tOut.symbol}`, amount: amountTxt, to: dest, hash, from: me, toNetworkId: get.netId });
        setAmount(""); swapped(get);
        setStep("idle");
        return;
      }
      if (quote.kind === "onebuy") {

        setStep("swapping");
        const r = oneReq(amtIn, quote.dest, quote.pay), shown = { out: quote.s.amountOut, min: quote.s.minOut };
        const sent = quote.pay.kind === "evm" ? await oneSendEvm(net!, phrase, idx, me, r, shown, quote.fees).then((x) => ({ hash: x.hash as string, deposit: x.deposit }))
          : quote.pay.kind === "sol" ? await oneSendSol(phrase, idx, solMe, r, shown).then((x) => ({ hash: x.sig, deposit: x.deposit }))
          : await oneSendTron(phrase, idx, tronMe, r, shown).then((x) => ({ hash: x.txid, deposit: x.deposit }));
        const fromSide = { netId: pay.netId, chainId: quote.pay.kind === "evm" ? net!.chain.id : quote.pay.kind === "sol" ? ("SOL" as const) : ("TRON" as const), token: from, decimals: tIn.decimals };
        await saveXfer({ hash: sent.hash, from: fromSide, to: { netId: get.netId, chainId: typeof quote.dest === "string" ? quote.dest : get.netId === SOL.id ? "SOL" : get.netId === TRON.id ? "TRON" : networkById(get.netId)!.chain.id, token: to, decimals: tOut.decimals }, at: Date.now(), label: `${amountTxt} ${tIn.symbol} → ${tOut.symbol}`, step: 1, end: "", via: "onebuy", deposit: sent.deposit });
        await addActivity({ at: Date.now(), networkId: pay.netId, kind: "swap", asset: `${tIn.symbol} → ${tOut.symbol}`, amount: amountTxt, to: ownDest(quote.dest), hash: sent.hash, from: payerOf(quote.pay), toNetworkId: get.netId, outMin: formatUnitsStr(quote.s.minOut, tOut.decimals), outEst: formatUnitsStr(quote.s.amountOut, tOut.decimals) });
        setAmount(""); swapped(get);
        setStep("idle");
        return;
      }
      if (quote.kind === "nearbuy") {

        setStep("swapping");
        const { hash, deposit } = await nearBuySend(net!, phrase, idx, { ...buyReq(amtIn), asset: quote.asset }, from, { out: quote.s.amountOut, min: quote.s.minOut }, quote.fees);
        const r = crossReq(amtIn);
        await saveXfer({ hash, from: r.from, to: r.to, at: Date.now(), label: `${amountTxt} ${tIn.symbol} → BTC`, step: 1, end: "", via: "nearbuy", deposit });
        await addActivity({ at: Date.now(), networkId: pay.netId, kind: "swap", asset: `${tIn.symbol} → BTC`, amount: amountTxt, to: btcMe, hash, from: me, toNetworkId: get.netId });
        setAmount(""); swapped(get);
        setStep("idle");
        return;
      }
      if (quote.kind === "cross") {
        const r: CrossRequest = { ...crossReq(amtIn), bridge: quote.bridge };
        const allowance = await evmAllowance(net!, phrase, idx, from, LIFI_DIAMOND);
        if (allowance < amtIn) { setStep("approving"); await evmApprove(net!, phrase, idx, from, amtIn, allowance, LIFI_DIAMOND, quote.fees); }
        setStep("swapping");
        const hash = await lifiSend(net!, phrase, idx, r, quote.s.amountOut, quote.s.minOut, quote.fees);
        await saveXfer({ hash, from: r.from, to: r.to, at: Date.now(), label: `${amountTxt} ${tIn.symbol} → ${tOut.symbol}`, step: 1, end: "" });
        await addActivity({ at: Date.now(), networkId: pay.netId, kind: "swap", asset: `${tIn.symbol} → ${tOut.symbol}`, amount: amountTxt, to: r.receiver, hash, from: me, toNetworkId: get.netId });
        setAmount(""); swapped(get);
        setStep("idle");
        return;
      }
      let hash: string;
      if (isSolNet) {
        setStep("swapping");
        hash = await solSwap(phrase, idx, from, to, amtIn, quote.q.amountOut, quote.q.minOut);

        await addActivity({ at: Date.now(), networkId: pay.netId, kind: "swap", asset: `${tIn.symbol} → ${tOut.symbol}`, amount: amountTxt, to: solMe, hash, from: solMe });
        await waitSol(hash);
      } else {

        const viaLifi = quote.q.via === "lifi";
        const spender = viaLifi ? LIFI_DIAMOND : undefined;
        const allowance = await evmAllowance(net!, phrase, idx, from, spender);
        if (allowance < amtIn) { setStep("approving"); await evmApprove(net!, phrase, idx, from, amtIn, allowance, spender, quote.q.fees); }
        setStep("swapping");
        if (viaLifi) { hash = await lifiSameSend(net!, phrase, idx, from, to, amtIn, quote.q.amountOut, quote.q.minOut, quote.q.fees); await waitOk(net!, hash as Hash); }
        else hash = await evmSwap(net!, phrase, idx, from, to, amtIn, quote.q.amountOut, quote.q.fees);
      }
      if (!isSolNet) await addActivity({ at: Date.now(), networkId: pay.netId, kind: "swap", asset: `${tIn.symbol} → ${tOut.symbol}`, amount: amountTxt, to: me, hash, from: me });
      setDone(hash); setAmount(""); swapped(get);
    } catch (e) {
      const h = (e as { hash?: string }).hash;
      if (saleQuote(quote)) { setSellReview(null); routePick.current = null; }
      setErr(friendly(e));
      if ((e as Error)?.message === "ERR_MOVED" || (e as Error)?.message === "ERR_FEE_HIGH" || ((e as Error)?.message === "ERR_SIM_FAIL" && (e as { reason?: string }).reason === "price")) { moved.current = true; setRequote((n) => n + 1); }
      if (h) setDone(null);
    }
    setStep("idle");
  }
  if (done)
    return (
      <div className="page stack">
        <div className="empty"><div className="ic" style={{ color: "var(--good)" }}><Check size={28} /></div>{t.swapDone}</div>
        <a className="btn ghost block" href={`${explorer}/tx/${done}`} target="_blank" rel="noreferrer"><ExternalLink size={16} />{t.viewTx}</a>
        <button className="btn primary block" onClick={() => setDone(null)}>{t.swapAgain}</button>
      </div>
    );
  const busy = step !== "idle";
  const out = quote ? (quote.kind === "same" ? quote.q.amountOut : quote.s.amountOut) : null;
  const tokBtn = (side: "pay" | "get", e: PickEntry) => lock === side
    ? <span className="tokbtn locked"><TokenIcon symbol={e.symbol} size={22} /><span className="tokbtn-txt"><small>{t.coinWord}</small><span>{e.symbol}</span></span></span>
    : <button className="tokbtn" onClick={() => onPick(side)} disabled={busy}><TokenIcon symbol={e.symbol} size={22} /><span className="tokbtn-txt"><small>{t.coinWord}</small><span>{e.symbol}</span></span><ChevronDown size={14} style={{ flex: "none" }} /></button>;
  return (
    <div className={embedded ? "stack" : "page stack"}>
      {!embedded && <h1><ArrowLeftRight size={18} />{t.swap}</h1>}
      <div className="sheet" style={{ marginTop: 0 }}>
        <div className="between"><span className="faint">{t.youPay} · {fill(t.onNet, { net: tIn.netName })}</span><span className="faint num">{t.balance}: {bal == null ? "…" : fmt(bal, tIn.decimals)}</span></div>
        <div className="row">
          <input className="input num" style={{ flex: 1, minWidth: 0 }} inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => { setAmount(e.target.value); setInfo(""); }} disabled={busy} />
          {tokBtn("pay", tIn)}
        </div>
        <PctRow key={pay.netId + from} disabled={busy} decimals={tIn.decimals} onPick={setAmount} getMax={() => isBtcPay ? btcFees().then((f) => btcSpendable(phrase, idx, f.normal))

          : utxoC ? utxoFees(utxoC).then(async (f) => utxoSpendable(utxoC, phrase, idx, f.normal, await ownTxids(utxoC))) : isXrpPay ? xrpSpendable(phrase, idx) : isAdaPay ? adaBusy().then((b) => adaSpendable(phrase, idx, b))
          : isTrxPay ? trxSaleMax(phrase, idx, toTronUsdt)
          : isNearPay ? nearSpendable(phrase, idx)
          : isTronPay ? tronBalances(tronMe).then((b) => b.usdt) : isSolNet
          ? solSpendable(phrase, idx, from === SOL_MINT ? undefined : { address: from }, from === SOL_MINT ? 5_000_000n : 0n)
          : evmSpendable(net!, phrase, idx, from === EVM_NATIVE ? { kind: "native" } : { kind: "token", token: { address: from } as Token }, 300_000n)} />
      </div>
      {!lock && <button className="iconbtn" style={{ alignSelf: "center", marginBlock: -6 }} title={t.flip} onClick={onFlip} disabled={busy || !canFlip}><ArrowLeftRight size={16} style={{ transform: "rotate(90deg)" }} /></button>}
      {}
      <div className="between"><b>{t.toHead}</b><span className="row" style={{ gap: 6 }}><span className="faint">{t.netWord}</span><SwapNetSelect value={get.netId} onChange={onGetNet} disabled={busy} label={t.netWord} ids={netIds} only={isTronPay ? (thorCoin ? [...new Set([...TRON_TO, ...THOR_SELL_TO.map((x) => x.netId), get.netId])] : TRON_TO) : isSellPay ? [...new Set([...SELL_NETS, ...(thorCoin ? THOR_SELL_TO.map((x) => x.netId) : []), ...(lock ? [] : SELL_COIN_NETS.filter((id) => id !== pay.netId)), get.netId])] : netIds.filter((id) => routeOk(pay.netId, id))} /></span></div>
      <div className="sheet" style={{ marginTop: 0 }}>
        <div className="faint">{t.youGet}</div>
        <div className="row">
          <div className="input num" style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center" }}>{loading ? "…" : out != null ? fmt(out, tOut.decimals) : "0"}</div>
          {tokBtn("get", tOut)}
        </div>
      </div>
      {soon && <div className="note info"><Clock size={16} />{noRoute ? fill(t.crossNetNo, { a: tIn.netName, b: tOut.netName }) : toTronOther ? t.tronGetOnly : toNative || buyCoin ? fill(t.buyNoRoute, { c: tOut.symbol, s: tIn.symbol, n: tIn.netName }) : isSellPay ? fill(t.btcSellTo, { c: tIn.symbol, coins: SELL_COINS.filter((x) => x !== sellCoin).join(" / ") }) : isTronPay ? t.tronSwapOnly : toTronUsdt ? fill(t.tronUsdtFrom, { s: tIn.symbol, n: tIn.netName, list: oneList }) : t.crossSoon}</div>}
      {saleQuote(quote) && (
        <div className="list" style={{ padding: "2px 14px" }}>
          <div className="kv"><span>{t.minReceived}</span><span className="num">{fmt(quote.s.minOut, tOut.decimals)} {tOut.symbol}</span></div>
          {}
          {(!isBtcPay || quote.kind === "thorsell") && quote.s.secs != null && <div className="kv"><span>{t.buyTime}</span><span>{minsText(t, Math.max(1, Math.ceil(quote.s.secs / 60)))}</span></div>}
          <div className="kv"><span>{t.crossVia}</span><span className="num">{quote.kind === "thorsell" ? "THORChain" : "NEAR Intents"}</span></div>
          {}
          <div className="kv"><span>{t.arrivesAt}</span><span className="row" style={{ gap: 6 }}><NetworkDot id={tOut.netId} size={16} /><span className="mono">{short(sellDest)}</span></span></div>
        </div>
      )}
      {quote?.kind === "sell" && <div className="note info"><Info size={15} />{coinTo ? fill(isBtcPay ? t.coinSwapBtcNote : t.coinSwapNote, { c: tIn.symbol, n: tIn.netName, g: tOut.symbol, gn: tOut.netName })
        : isBtcPay ? t.btcSellNote : fill(t.coinSellNote, { c: tIn.symbol, n: tIn.netName })}</div>}
      {quote?.kind === "sell" && quote.activate != null && <div className="note info"><Info size={15} /><span>{fillNodes(t.xrpBuyActivateNote, { r: formatXrp(quote.activate) })}</span></div>}
      {quote?.kind === "thorsell" && <div className="note info"><Info size={15} />{fill(t.thorSellNote, { c: tIn.symbol, n: tIn.netName })}</div>}
      {saleQuote(quote) && salePrev && (utxoC || isBtcPay || isAdaPay) && !sellReview && (
        <div className="sheet" style={{ gap: 8 }}>
          <b className="row" style={{ gap: 6 }}><TriangleAlert size={16} />{t.pendingTitle}</b>
          <span>{fill(t.utxoPendingWarn, { a: iso(utxoC ? formatUtxo(salePrev.amount) : isAdaPay ? formatAda(salePrev.amount) : formatBtc(salePrev.amount)), sym: utxoC ? utxoC.symbol : isAdaPay ? "ADA" : "BTC" })}</span>
          <a className="btn ghost block" href={utxoC ? utxoTxUrl(utxoC, salePrev.txid) : isAdaPay ? adaTxUrl(salePrev.txid) : `${BTC.explorer}/tx/${salePrev.txid}`} target="_blank" rel="noreferrer"><ExternalLink size={16} />{t.viewTx}</a>
          <label className="check"><input type="checkbox" checked={prevOk === salePrev.txid} onChange={(e) => setPrevOk(e.target.checked ? salePrev.txid : "")} />{t.pendingOverride}</label>
        </div>
      )}
      {saleQuote(quote) && sellReview && sellReview.sats === amtIn && (
        <div className="list" style={{ padding: "2px 14px" }} aria-live="polite">
          <div className="kv"><b>{coinTo ? t.coinSwapReview : t.btcSellReview}</b><span /></div>
          <div className="kv"><span>{t.amount}</span><span className="num" dir="ltr">{coinTxt(sellReview.sats)} {tIn.symbol}{payPrice != null && <span className="faint"> · {money((Number(sellReview.sats) / 10 ** tIn.decimals) * payPrice, cur)}</span>}</span></div>
          <div className="kv"><span>{t.btcFee}</span><span className="num" dir="ltr">{coinTxt(sellReview.fee)} {tIn.symbol}{isBtcPay ? ` · ${sellReview.feeRate} sat/vB` : utxoC ? ` · ${rateLabel(utxoC, sellReview.feeRate)}` : ""}{payPrice != null && <span className="faint"> · {money((Number(sellReview.fee) / 10 ** tIn.decimals) * payPrice, cur)}</span>}</span></div>
          {sellReview.reserve != null && <div className="kv"><span>{t.xrpReserveRow}</span><span className="num" dir="ltr">{coinTxt(sellReview.reserve)} {tIn.symbol}</span></div>}
          <div className="kv"><span>{t.total}</span><b className="num" dir="ltr">{coinTxt(sellReview.sats + sellReview.fee)} {tIn.symbol}</b></div>
        </div>
      )}
      {saleQuote(quote) && sellReview && sellReview.sats === amtIn && <div className="note warn"><TriangleAlert size={16} />{t.irreversible}</div>}
      {info && <div className="note info">{infoWait ? <Clock size={16} /> : <Check size={16} />}{info}</div>}
      {cross && !soon && <div className="note info"><Globe size={16} />{fill(t.crossTo, { net: tOut.netName })}</div>}
      {quote?.kind === "same" && (
        <div className="list" style={{ padding: "2px 14px" }}>
          <div className="kv"><span>{t.minReceived}</span><span className="num">{fmt(quote.q.minOut, tOut.decimals)} {tOut.symbol}</span></div>
          <div className="kv"><span>{t.madarFee}</span><span className="num">{quote.q.fee ? `${feeBps() / 100}% · ${fmt(quote.q.fee.amount, quote.q.fee.onOutput ? tOut.decimals : tIn.decimals)} ${quote.q.fee.onOutput ? tOut.symbol : tIn.symbol}` : t.noFee}</span></div>
          <div className="kv"><span>{t.maxSlippage}</span><span className="num">{SLIPPAGE_BPS / 100}%</span></div>
          <div className="kv"><span>{t.crossVia}</span><span className="num">{isSolNet ? "Jupiter" : quote.q.via === "lifi" ? "LI.FI" : "KyberSwap"}</span></div>
        </div>
      )}
      {quote?.kind === "mayan" && (
        <div className="list" style={{ padding: "2px 14px" }}>
          <div className="kv"><span>{t.minReceived}</span><span className="num">{fmt(quote.s.minOut, tOut.decimals)} {tOut.symbol}</span></div>
          <div className="kv"><span>{t.madarFee}</span><span className="num">{quote.r.feeBps ? `${quote.r.feeBps / 100}%` : t.noFee}</span></div>
          <div className="kv"><span>{t.crossVia}</span><span className="num">Mayan</span></div>
          {quote.two && <div className="kv"><span>{t.stepsLabel}</span><span>{t.twoSteps}</span></div>}
          <div className="kv"><span>{t.arrivesAt}</span><span className="row" style={{ gap: 6 }}><NetworkDot id={tOut.netId} size={16} /><span className="mono">{short(me)}</span></span></div>
        </div>
      )}
      {(mayanOk || twoStep) && <div className="faint">{t.solGasMayanNote}</div>}
      {stage > 0 && <div className="note info"><Clock size={16} />{stage === 1 ? t.step1 : fill(t.step2, { net: tOut.netName })}</div>}
      {quote?.alts && (

        <div className="routes">
          <div className="routes-h">{quote.alts.length === 2 ? t.routesTitle2 : fill(t.routesTitle, { n: String(quote.alts.length) })}</div>
          {routeGone && <div className="note info" style={{ margin: "6px 0" }}><Info size={16} />{t.routeGone}</div>}
          <div className="list">
            {quote.alts.map((r, i) => (
              <button key={r.id} type="button" className={"rowi route" + (r.id === quote.routeId ? " on" : "")} disabled={step !== "idle"} aria-pressed={r.id === quote.routeId}
                onClick={() => { routePick.current = r.id; setRouteGone(false); setQuote({ ...r.q, alts: quote.alts, routeId: r.id }); }}>
                <span className="rdot">{r.id === quote.routeId && <Check size={13} />}</span>
                <div className="grow">
                  <div className="t1 row" style={{ gap: 6 }}><bdi dir="ltr">{r.name}</bdi>{i === 0 && <span className="badge ok">{t.routeBest}</span>}</div>
                  <div className="t2">{r.secs != null ? minsText(t, Math.max(1, Math.round(r.secs / 60))) : t.routeTimeUnknown}</div>
                </div>
                <div className="end"><div className="t1 num" dir="ltr">{fmt(r.out, tOut.decimals)} {tOut.symbol}</div></div>
              </button>
            ))}
          </div>
        </div>
      )}
      {quote?.kind === "cross" && (
        <div className="list" style={{ padding: "2px 14px" }}>
          {quote.bridge && <div className="kv"><span>{t.crossVia}</span><span className="num">{LIFI_BRIDGE_NAMES[quote.bridge] ?? quote.bridge}</span></div>}
          <div className="kv"><span>{t.minReceived}</span><span className="num">{fmt(quote.s.minOut, tOut.decimals)} {tOut.symbol}</span></div>
          <div className="kv"><span>{t.crossFees}</span><span className="num">{+quote.s.feePct.toFixed(2)}%</span></div>
          <div className="kv"><span>{t.crossGas}</span><span className="num">{quote.s.gasUsd == null ? "—" : quote.s.gasUsd < 0.01 ? "< $0.01" : money(quote.s.gasUsd, "USD")}</span></div>
          <div className="kv"><span>{t.arrivesAt}</span><span className="row" style={{ gap: 6 }}><NetworkDot id={tOut.netId} size={16} /><span className="mono">{short(tOut.netId === SOL.id ? solMe : toBtc ? btcMe : me)}</span></span></div>
        </div>
      )}
      {quote?.kind === "nearbuy" && (
        <div className="list" style={{ padding: "2px 14px" }}>
          <div className="kv"><span>{t.minReceived}</span><span className="num">{fmt(quote.s.minOut, tOut.decimals)} {tOut.symbol}</span></div>
          <div className="kv"><span>{t.crossFees}</span><span className="num">{+quote.s.feePct.toFixed(2)}%</span></div>
          {quote.s.btcFee != null && <div className="kv"><span>{t.btcNetFee}</span><span className="num" dir="ltr">{fmt(quote.s.btcFee, 8)} BTC</span></div>}
          <div className="kv"><span>{t.crossGas}</span><span className="num" dir="ltr">{quote.fees ? `≈ ${amt(formatUnitsStr(BUY_TRANSFER_GAS * perGas(quote.fees), 18), 8)} ${net!.native.symbol}` : "—"}</span></div>
          <div className="kv"><span>{t.crossVia}</span><span className="num">NEAR Intents</span></div>
          <div className="kv"><span>{t.arrivesAt}</span><span className="row" style={{ gap: 6 }}><NetworkDot id={tOut.netId} size={16} /><span className="mono">{short(btcMe)}</span></span></div>
        </div>
      )}
      {quote?.kind === "nearbuy" && <div className="note info"><Info size={15} />{fill(t.btcBuyNote, { s: tIn.symbol })}</div>}
      {(quote?.kind === "onebuy" || quote?.kind === "thorbuy") && (
        <div className="list" style={{ padding: "2px 14px" }}>
          <div className="kv"><span>{t.minReceived}</span><span className="num" dir="ltr">{fmt(quote.s.minOut, tOut.decimals)} {tOut.symbol}</span></div>
          <div className="kv"><span>{t.crossFees}</span><span className="num">{+quote.s.feePct.toFixed(2)}%</span></div>
          {quote.s.outFee != null && <div className="kv"><span>{fill(t.buyOutFee, { c: tOut.netName })}</span><span className="num" dir="ltr">{fmt(quote.s.outFee, tOut.decimals)} {tOut.symbol}</span></div>}
          {quote.fees && net && <div className="kv"><span>{t.crossGas}</span><span className="num" dir="ltr">≈ {amt(formatUnitsStr((quote.kind === "thorbuy" ? THOR_DEPOSIT_GAS : BUY_TRANSFER_GAS) * perGas(quote.fees), 18), 8)} {net.native.symbol}</span></div>}
          {quote.s.secs != null && <div className="kv"><span>{t.buyTime}</span><span>{minsText(t, Math.max(1, Math.round(quote.s.secs / 60)))}</span></div>}
          <div className="kv"><span>{t.crossVia}</span><span className="num">{quote.kind === "thorbuy" ? "THORChain" : "NEAR Intents"}</span></div>
          <div className="kv"><span>{t.arrivesAt}</span><span className="row" style={{ gap: 6 }}><NetworkDot id={tOut.netId} size={16} /><span className="mono">{short(quote.kind === "thorbuy" ? thorDest(quote.coin) : ownDest(quote.dest))}</span></span></div>
        </div>
      )}
      {(quote?.kind === "onebuy" || quote?.kind === "thorbuy" || quote?.kind === "sell") && quote.s.outFee != null && quote.s.outFee * 50n > quote.s.amountOut && (
        <div className="note soft"><Info size={15} /><span>{fillNodes(t.buyFixedFeeNote, { f: `${fmt(quote.s.outFee, tOut.decimals)} ${tOut.symbol}`, c: tOut.netName, p: String(Math.round(Number((quote.s.outFee * 10000n) / quote.s.amountOut) / 100)) })}</span></div>
      )}
      {(quote?.kind === "onebuy" || quote?.kind === "thorbuy") && quote.activate != null && <div className="note info"><Info size={15} /><span>{fillNodes(t.xrpBuyActivateNote, { r: formatXrp(quote.activate) })}</span></div>}
      {(quote?.kind === "onebuy" || quote?.kind === "thorbuy") && <div className="note info"><Info size={15} />{fill(quote.kind === "thorbuy" ? t.coinBuyNoteThor : t.coinBuyNote, { s: tIn.symbol, c: tOut.symbol, n: tOut.netName })}</div>}
      {quote?.kind === "tron" && (
        <div className="list" style={{ padding: "2px 14px" }}>
          <div className="kv"><span>{t.minReceived}</span><span className="num">{fmt(quote.s.minOut, tOut.decimals)} {tOut.symbol}</span></div>
          <div className="kv"><span>{t.crossFees}</span><span className="num">{+quote.s.feePct.toFixed(2)}%</span></div>
          <div className="kv"><span>{t.crossGas}</span><span className="num">{quote.cost ? <bdi dir="ltr">≈ {fmt(quote.cost.fee, 6)} TRX{quote.trxUsd ? ` (≈ ${money((Number(quote.cost.fee) / 1e6) * quote.trxUsd, "USD")})` : ""}</bdi> : t.tronSwapGas}</span></div>
          <div className="kv"><span>{t.crossVia}</span><span className="num">LI.FI · LayerSwap</span></div>
          <div className="kv"><span>{t.arrivesAt}</span><span className="row" style={{ gap: 6 }}><NetworkDot id={tOut.netId} size={16} /><span className="mono">{short(tOut.netId === SOL.id ? solMe : me)}</span></span></div>
        </div>
      )}
      {quote?.kind === "tron" && quote.cost && quote.cost.have < quote.cost.need && <div className="err">{fill(t.tronFeeShort, { n: fmt(quote.cost.need, 6), h: fmt(quote.cost.have, 6) })}</div>}
      {quote?.kind === "tron" && quote.cost && quote.trxUsd && (Number(quote.cost.fee) / 1e6) * quote.trxUsd > (Number(amtIn ?? 0n) / 1e6) * 0.1 && <div className="note warn"><TriangleAlert size={16} /><span>{fill(t.tronFeeBig, { usd: money((Number(quote.cost.fee) / 1e6) * quote.trxUsd, "USD") })}</span></div>}
      {isTronPay && tronOk && <div className="faint">{t.tronSwapGasNote}</div>}
      {toTronUsdt && !soon && !isTrxPay && <div className="faint">{t.tronUsdtGasNote}</div>}
      {quote && left > 0 && <div className="faint row" style={{ gap: 6, justifyContent: "center" }} aria-live="off"><RefreshCw size={12} />{fill(t.priceRefresh, { s: String(left) })}</div>}
      {quote && !((quote.kind === "onebuy" || quote.kind === "thorbuy" || quote.kind === "sell") && quote.s.outFee != null && quote.s.outFee * 50n > quote.s.amountOut) && ((n) => n != null && <div className="note soft"><Info size={15} />{fill(t.smallAmountNote, { p: String(n) })}</div>)(bigCostNote(quote.kind === "sell" ? null : quote.kind === "thorsell" ? quote.s.costPct : quote.kind === "cross" || quote.kind === "tron" || quote.kind === "nearbuy" || quote.kind === "onebuy" || quote.kind === "thorbuy" ? quote.s.costPct : quote.kind === "mayan" ? mayanCostPct(quote.q, quote.r) : sameCostPct(quote.q, isSolNet)))}
      {(!tIn.verified || !tOut.verified) && <div className="note warn"><ShieldAlert size={16} />{t.swapUnverified}</div>}
      {amountBad && <div className="err">{t.errAmount}</div>}
      {!amountBad && ambiguous && <div className="note soft"><Info size={15} /><span>{fillNodes(t.amtAmbig, { v: ambiguous.read, w: ambiguous.other })}</span></div>}
      {qErr && <div className="err">{qErr}</div>}
      {insufficient && <div className="err">{t.errFunds}</div>}
      {err && <div className="err">{err}</div>}
      {quote && out != null && <div className="note info" style={{ justifyContent: "center", textAlign: "center" }}><span>{fillNodes(t.swapSummary, { a: `${amt(amountTxt, tIn.decimals)} ${tIn.symbol}`, n1: tIn.netName, b: `${fmt(out, tOut.decimals)} ${tOut.symbol}`, n2: tOut.netName })}</span></div>}
      <button className="btn primary block" disabled={!quote || busy || insufficient || soon || (quote.kind === "tron" && !!quote.cost && quote.cost.have < quote.cost.need)} onClick={go}>
        {step === "approving" ? fill(t.approving, { t: tIn.symbol }) : step === "swapping" ? t.swapping : saleQuote(quote) ? (sellReview && sellReview.sats === amtIn ? t.btcSellConfirm : t.review) : lock ? t.trConfirm : t.swapBtn}
      </button>
      {saleQuote(quote) && sellReview && sellReview.sats === amtIn && !busy && <button className="btn ghost block" onClick={() => setSellReview(null)}>{t.edit}</button>}
      <div className="faint" style={{ textAlign: "center" }}>{fill(t.needGas, { sym: isSolNet ? "SOL" : isSellPay ? tIn.symbol : isTronPay ? "TRX" : net!.native.symbol })}</div>
    </div>
  );
}

export function XferCard() {
  const { t } = useT();
  const [x, setX] = useState<Xfer | null>(null);
  const [, setNow] = useState(0);

  const [btcWait, setBtcWait] = useState<{ conf: number; lastBlockMin: number } | null>(null);
  useEffect(() => {
    void loadXfer().then(setX).catch(() => {});
    const on = (c: Record<string, chrome.storage.StorageChange>, area: string) => { if (area === "local" && "xfer" in c) setX((c.xfer.newValue as Xfer | undefined) ?? null); };
    chrome.storage.onChanged.addListener(on);
    return () => chrome.storage.onChanged.removeListener(on);
  }, []);
  const hash = x?.hash, ended = !!x?.end;
  useEffect(() => {
    if (!hash || ended) return;
    let live = true;
    (async () => {
      while (live) {
        const cur = await loadXfer().catch(() => null);
        if (!live || !cur || cur.hash !== hash || cur.end) return;
        const next: Xfer = { ...cur };
        if (cur.via === "near") {
          const coin = sellCoinByChain(cur.from.chainId, cur.from.netId) ?? "BTC";
          const s = await sellStatus(cur.deposit!, undefined, coin).catch(() => null);
          if (s) { const g = sellStage(s.state); if (g.step > next.step) next.step = g.step; next.end = g.end; next.incomplete = g.incomplete; }
          if (coin === "BTC" && !next.end && next.step <= 2) { const w = await btcWaitInfo(hash).catch(() => null); if (live && w) setBtcWait(w); }

          if (coin === "TRX" && !next.end && next.step <= 2 && Date.now() - cur.at > 15 * 60_000) {
            const r = await tronTxResult(hash).catch(() => undefined);
            if (r === null || r === "FAILED") next.end = "failed";
          }
        } else if (cur.via === "thorsell") {
          const s = await thorSellStatus(hash).catch(() => null);
          if (s) { if (s.step > next.step) next.step = s.step; next.end = s.state === "done" ? "ok" : s.state === "refunded" ? "refunded" : ""; }
          const c = thorSellCoinOf(cur.from.netId);
          if (!next.end && next.step === 1 && c && Date.now() - cur.at > thorSellUnseenMs(c)) next.end = "failed";
        } else if (next.step === 1 && cur.via === "mayan") {
          const st = await solRpc<{ value: ({ err: unknown; confirmationStatus?: string } | null)[] }>("getSignatureStatuses", [[hash], { searchTransactionHistory: true }]).catch(() => null);
          const v = st?.value?.[0];
          if (v) { if (v.err) next.end = "failed"; else if (v.confirmationStatus === "confirmed" || v.confirmationStatus === "finalized") next.step = 2; }
          else if (st && Date.now() - cur.at > 180_000) {
            const m: { status?: string } = await mayanStatus(hash).catch(() => ({}));
            if (m.status) next.step = 2; else next.end = "failed";
          }
        } else if (next.step === 1 && cur.via === "onebuy" && cur.from.chainId === "SOL") {
          const st = await solRpc<{ value: ({ err: unknown; confirmationStatus?: string } | null)[] }>("getSignatureStatuses", [[hash], { searchTransactionHistory: true }]).catch(() => null);
          const v = st?.value?.[0];
          if (v) { if (v.err) next.end = "failed"; else if (v.confirmationStatus === "confirmed" || v.confirmationStatus === "finalized") next.step = 2; }
          else if (st && Date.now() - cur.at > 180_000) next.end = "failed";
        } else if (next.step === 1 && cur.via === "onebuy" && cur.from.chainId === "TRON") {
          const r = await tronTxResult(hash).catch(() => undefined);
          if (r === "SUCCESS") next.step = 2;
          else if (r === "FAILED") next.end = "failed";
          else if (r === null && Date.now() - cur.at > 15 * 60_000) next.end = "failed";
        } else if (next.step === 1 && cur.via === "tron") {
          const r = await tronTxResult(hash).catch(() => undefined);
          if (r === "SUCCESS") next.step = 2;
          else if (r === "FAILED") next.end = "failed";
          else if (r === null && Date.now() - cur.at > 15 * 60_000) next.end = "failed";
        } else if (next.step === 1) {
          const n = networkById(cur.from.netId);
          const r = n ? await publicClient(n).getTransactionReceipt({ hash: hash as Hash }).catch(() => null) : null;
          if (r) { if (r.status === "success") next.step = 2; else next.end = "failed"; }
        }
        if (cur.via === "near" || cur.via === "thorsell") {  }
        else if (cur.via === "onebuy") {
          if (next.step >= 2 && !next.end) {
            const s = await oneStatus(cur.deposit!).catch(() => null);
            if (s) { const g = sellStage(s.state); if (g.step > next.step) next.step = g.step; next.end = g.end; next.incomplete = g.incomplete; }
          }
        } else if (cur.via === "thor") {
          if (next.step >= 2 && !next.end) {
            const s = await thorBuyStatus(hash).catch(() => null);
            if (s) { if (s.step > next.step) next.step = s.step; next.end = s.state === "done" ? "ok" : s.state === "refunded" ? "refunded" : ""; }
          }
        }
        else if (cur.via === "nearbuy") {
          if (next.step >= 2 && !next.end) {
            const s = await buyStatus(cur.deposit!).catch(() => null);
            if (s) { const g = sellStage(s.state); if (g.step > next.step) next.step = g.step; next.end = g.end; next.incomplete = g.incomplete; }
          }
        } else if (next.step >= 2 && !next.end && cur.via === "mayan") {
          const s = mayanStage(await mayanStatus(hash).catch(() => ({})));
          if (s.step > next.step) next.step = s.step;
          next.end = s.end;
        } else if (next.step >= 2 && !next.end) {
          const st = await lifiStatus(hash, cur.from, cur.to).catch((): LifiStatus => ({}));
          const s = xferStage(st);
          if (s.step > next.step) next.step = s.step;
          next.end = s.end;
          next.refunding = st.substatus === "REFUND_IN_PROGRESS";
        }
        if (!live) return;
        if (JSON.stringify(next) !== JSON.stringify(cur)) await saveXfer(next);

        if (next.step !== cur.step || next.end !== cur.end) balancesChanged();
        setNow(Date.now());
        if (next.end) return;

        await new Promise((res) => setTimeout(res, (cur.via === "near" || cur.via === "thorsell" || ((cur.via === "nearbuy" || cur.via === "onebuy" || cur.via === "thor") && next.step >= 2)) ? 15_000
          : Date.now() - cur.at > 3_600_000 ? 30_000 : next.step === 1 ? 3_000 : 8_000));
        await whenVisible();
      }
    })();
    return () => { live = false; };
  }, [hash, ended]);
  if (!x) return null;
  const f = netLabel(x.from.netId), c = netLabel(x.to.netId);
  const mins = Math.max(0, Math.floor((Date.now() - x.at) / 60_000));
  const labels = [fill(t.xs1, { c: f }), fill(t.xs2, { c: f }), fill(t.xs3, { c }), x.end === "refunded" ? t.xRefunded : fill(t.xs4, { c })];
  const soldExtra = x.via === "near" ? extraById(x.from.netId) : undefined;
  const state = (n: number) => (x.end === "failed" && n === x.step ? "bad" : n < x.step || (x.end && x.end !== "failed") ? "done" : n === x.step ? "now" : "todo");
  return (
    <div className="xcard">
      <div className="between">
        <div style={{ minWidth: 0 }}><b className="num">{x.label}</b><div className="faint"><span dir="ltr">{f} → {c}</span></div></div>
        {x.end && <button className="iconbtn" title={t.closeBtn} aria-label={t.closeBtn} onClick={() => void saveXfer(null)}><X size={16} /></button>}
      </div>
      <ol className="xsteps">
        {labels.map((l, i) => { const s = state(i + 1); return <li key={i} className={s}><i>{s === "done" ? <Check size={12} /> : s === "bad" ? "!" : i + 1}</i><span>{l}</span></li>; })}
      </ol>
      <div className={"xbar" + (x.end === "failed" ? " bad" : x.end ? " ok" : "")}><span style={{ width: `${stagePct(x.step, x.end)}%` }} /></div>
      <div className="between faint">
        <span>{x.end ? "" : fill(t.xElapsed, { n: String(mins) })}</span>
        <a className="row" style={{ gap: 4 }} href={soldExtra ? soldExtra.txUrl(x.hash) : (x.via === "onebuy" && x.from.chainId === "TRON") || (x.via === "near" && x.from.chainId === "TRX") ? tronTxUrl(x.hash) : scanLink(x.hash, x.via, x.from.chainId === "SOL" ? SOL.explorer : networkById(x.from.netId)?.explorer)} target="_blank" rel="noreferrer">{t.xTrack}<ExternalLink size={12} /></a>
      </div>
      {!x.end && x.via === "near" && x.from.netId === BTC.id && x.step <= 2 && btcWait && <div className="note info"><Clock size={16} /><span>{btcWait.conf === 0 ? t.btcWaitMempool : fill(t.btcWaitBlocks, { n: String(btcWait.conf), m: String(btcWait.lastBlockMin) })}</span></div>}
      {!x.end && x.refunding && <div className="note warn"><Clock size={16} />{fill(t.xRefunding, { f })}</div>}
      {!x.end && x.incomplete && <div className="note warn"><TriangleAlert size={16} />{t.xIncomplete}</div>}
      {!x.end && <div className="faint">{t.xCanClose}</div>}
      {x.end === "failed" && <div className="note bad"><TriangleAlert size={16} />{t.xFailed}</div>}
      {x.end === "partial" && <div className="note warn"><TriangleAlert size={16} />{fill(t.xPartial, { c })}</div>}
    </div>
  );
}
