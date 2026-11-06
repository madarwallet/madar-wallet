import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, BadgeCheck, CandlestickChart, Check, ChevronDown, Clock, Compass, Copy, CreditCard, Eye, EyeOff, Globe, Home, Info, KeyRound, Lock, Plus, Repeat, Settings as Cog, ShieldCheck, SlidersHorizontal, TriangleAlert, X } from "lucide-react";
import { Fragment, lazy, memo, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { evmAddress } from "../core/account";
import { isImportedIndex, parsePrivateKey } from "../core/imported";
import { myName as lookupMyName } from "../core/names";
import { freeStatus } from "../core/freeName";
import { BTC, btcAddress, btcBalance, formatBtc } from "../core/btcbase";
import { activeNetworks, crossTo, NETWORKS, visibleTokens, type Network, type Token } from "../core/chains";
import { formatUnitsStr, SOL, solAddress, solBalances } from "../core/solbase";
import { TRON, tronAddress, tronBalances } from "../core/tronbase";
import { TON, tonAddress, tonBalances } from "../core/tonbase";
import { EXTRA_COINS, extraAmount, extraById } from "../core/natives";
import { coinSwapStart, swapNetworks } from "../core/picker";
import { formatXrp } from "../core/xrpbase";
import { balances, cachedPrices, fetchPrices, type Prices } from "../core/chainops";
import { importPrivateKey, lock, touch, type Settings } from "../core/store";
import { accountTotal, cachedTotal, dayChange, saveTotal } from "../core/portfolio";
import { readSnap, writeSnap } from "../core/snap";
import { coinName } from "../core/coins";
import type { ScanResult } from "../core/qrpayload";
import { fill, pwError, useT, watchTexts } from "./i18n";
import { Avatar, MadarName, NetworkDot, TokenIcon } from "./icons";
import { ANDROID } from "../platform";
import { FreeNameClaim } from "./FreeName";
import { UpdateCard } from "./Update";
import { useInviteFee, useInviteSync } from "./Invite";
import { ZakatCard } from "./Zakat";
import { netOff, startNetStatus } from "../core/netstatus";
import { useAccountsSync, useBookSync, useDiscoverAccounts } from "./BookSync";
import { accName, amt, byHoldings, fillNodes, money, RefreshBtn, short, STABLES, useLiveBalances, useToast, ZeroToggle, type CoinPart, type CoinView, type Tab, type Update } from "./common";

const BUY_SOON = true;

const Send = lazy(() => import("./Send").then((m) => ({ default: m.Send })));
const BtcSend = lazy(() => import("./Send").then((m) => ({ default: m.BtcSend })));
const SolSend = lazy(() => import("./Send").then((m) => ({ default: m.SolSend })));
const TronSend = lazy(() => import("./Send").then((m) => ({ default: m.TronSend })));
const TonSend = lazy(() => import("./Send").then((m) => ({ default: m.TonSend })));
const UtxoSend = lazy(() => import("./Send").then((m) => ({ default: m.UtxoSend })));
const XrpSend = lazy(() => import("./Send").then((m) => ({ default: m.XrpSend })));
const AdaSend = lazy(() => import("./Send").then((m) => ({ default: m.AdaSend })));
const NearSend = lazy(() => import("./NearSend").then((m) => ({ default: m.NearSend })));
const KitSend = lazy(() => import("./KitSend").then((m) => ({ default: m.KitSend })));
const TokensFor = lazy(() => import("./Tokens").then((m) => ({ default: m.TokensFor })));
import type { SwapWant } from "./Swap";
const SwapView = lazy(() => import("./Swap").then((m) => ({ default: m.SwapView })));
const XferCard = lazy(() => import("./Swap").then((m) => ({ default: m.XferCard })));
const Receive = lazy(() => import("./Receive").then((m) => ({ default: m.Receive })));
const Activity = lazy(() => import("./Activity").then((m) => ({ default: m.Activity })));
const CoinPage = lazy(() => import("./CoinPage").then((m) => ({ default: m.CoinPage })));
const SettingsView = lazy(() => import("./Settings").then((m) => ({ default: m.SettingsView })));
const Buy = lazy(() => import("./Buy").then((m) => ({ default: m.Buy })));
const Explore = lazy(() => import("./Explore").then((m) => ({ default: m.Explore })));
const Trade = lazy(() => import("./Trade").then((m) => ({ default: m.Trade })));
const P2P = lazy(() => import("./P2P").then((m) => ({ default: m.P2P })));
const BuyChoices = lazy(() => import("./P2P").then((m) => ({ default: m.BuyChoices })));
const NewTokenCard = lazy(() => import("./NewToken").then((m) => ({ default: m.NewTokenCard })));
const Loading = () => <div className="page"><div className="faint" style={{ textAlign: "center", padding: 24 }}>…</div></div>;

function usePrefetch() {
  useEffect(() => {
    const idle = (globalThis as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number }).requestIdleCallback ?? ((f: () => void) => setTimeout(f, 1200));
    const id = setTimeout(() => idle(() => { void import("./Swap"); void import("./Send"); void import("./CoinPage"); void import("./Receive"); }, { timeout: 4000 }), 1500);
    return () => clearTimeout(id);
  }, []);
}

function useWatchPlan(phrase: string, s: Settings) {
  const { t } = useT();
  const key = [s.notify, s.accountIndex, JSON.stringify(s.networksOn ?? []), JSON.stringify(s.enabledTokens), t.ntInTitle].join("|");
  useEffect(() => {
    if (!s.notify) return;
    const id = setTimeout(() => { void import("../core/watchplan").then((m) => m.refreshPlan(phrase, s, watchTexts(t))).catch(() => {}); }, 3000);
    return () => clearTimeout(id);
  }, [phrase, key]); // eslint-disable-line react-hooks/exhaustive-deps
}

function XferSlot() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let live = true;
    Promise.resolve(chrome.storage.local.get("xfer")).then((r) => { if (live && r?.xfer) setOn(true); }, () => {});
    const l = (c: Record<string, chrome.storage.StorageChange>, area: string) => { if (area === "local" && "xfer" in c) setOn(!!c.xfer.newValue); };
    chrome.storage.onChanged.addListener(l);
    return () => { live = false; chrome.storage.onChanged.removeListener(l); };
  }, []);
  return on ? <Suspense fallback={null}><XferCard /></Suspense> : null;
}

export function Wallet({ phrase, settings, update }: { phrase: string; settings: Settings; update: Update }) {
  const { t } = useT();
  const demoTab = import.meta.env.DEV ? (globalThis as { __DEMO_TAB__?: Tab }).__DEMO_TAB__ : undefined;
  const [tab, setTab] = useState<Tab>(() => (demoTab && demoTab !== "activity" ? demoTab : "assets"));

  const [, setNetTick] = useState(0);
  useEffect(() => startNetStatus(() => setNetTick((n) => n + 1)), []);

  const [homeView, setHomeView] = useState<HomeView>(() => (demoTab === "activity" ? "activity" : "tokens"));
  const [menu, setMenu] = useState(false);
  const [toast, say] = useToast();
  const [sendPre, setSendPre] = useState<string | undefined>();
  const [scanCarry, setScanCarry] = useState<{ netId: string; r: ScanResult } | null>(null);
  const [coin, setCoin] = useState<CoinView | null>(() => (import.meta.env.DEV ? (globalThis as { __DEMO_COIN__?: CoinView }).__DEMO_COIN__ ?? null : null));
  const [swapPrefer, setSwapPrefer] = useState<{ netId: string; key: string } | undefined>();
  const [sheet, setSheet] = useState(false);
  const [gasFor, setGasFor] = useState<string | undefined>();
  const [buyNet, setBuyNet] = useState<string | undefined>();
  const [swapGet, setSwapGet] = useState<SwapWant | undefined>();
  const [p2pMode, setP2pMode] = useState<"buy" | "sell">("buy");
  const [netsFocus, setNetsFocus] = useState(false);
  const go = (y: Tab) => {

    const x: Tab = y === "activity" ? "assets" : y;
    if (y === "activity") setHomeView("activity"); else if (y === "assets") setHomeView("tokens");
    if (x === "p2p" && tab !== "p2p") setP2pMode("buy"); setTab(x); setSheet(false); setMenu(false); setSendPre(undefined); setScanCarry(null); setCoin(null); setSwapPrefer(undefined); setGasFor(undefined); setBuyNet(undefined); setSwapGet(undefined); setNetsFocus(false); void touch(); };
  const openNets = () => { go("settings"); setNetsFocus(true); };
  const isBtc = settings.networkId === BTC.id, isSol = settings.networkId === SOL.id, isTron = settings.networkId === TRON.id, isTon = settings.networkId === TON.id, isAll = settings.networkId === ALL;
  const extra = extraById(settings.networkId);
  const nets = useNets(settings);
  const net = netOf(nets, settings.networkId);
  const evm = evmAddress(phrase, settings.accountIndex);
  const shown = isBtc ? btcAddress(phrase, settings.accountIndex) : isSol ? solAddress(phrase, settings.accountIndex) : isTron ? tronAddress(phrase, settings.accountIndex) : isTon ? tonAddress(phrase, settings.accountIndex) : extra ? extra.address(phrase, settings.accountIndex) : evm;
  const own = isBtc ? BTC : isSol ? SOL : isTron ? TRON : isTon ? TON : extra ?? null;
  const imp = isImportedIndex(settings.accountIndex);
  useEffect(() => { if (imp && own) void update({ networkId: ALL }); }, [imp, settings.networkId]); // eslint-disable-line react-hooks/exhaustive-deps
  const copy = (s: string) => { void navigator.clipboard.writeText(s); say(t.copied); };
  useInviteSync(phrase, settings);
  useInviteFee(phrase, settings);
  const myName = useMyName(evm);

  const nameCard = <><FreeNameCard name={myName} phrase={phrase} index={settings.accountIndex} />{settings.zakat && <ZakatCard key={settings.accountIndex} phrase={phrase} settings={settings} />}</>;

  const [detTick, setDetTick] = useState(0);
  const refreshed = useCallback(() => setDetTick((x) => x + 1), []);
  const tokenCard = isBtc || isTron || isTon || extra ? null : <Suspense fallback={null}><NewTokenCard key={`${settings.accountIndex}:${settings.networkId}`} phrase={phrase} settings={settings} update={update} tick={detTick} say={say} /></Suspense>;
  const cards = <>{tokenCard}{nameCard}</>;
  const copyMyName = () => { if (myName) { void navigator.clipboard.writeText(myName); say(t.nameCopied); } };
  usePrefetch();
  useWatchPlan(phrase, settings);
  useBookSync(phrase, !!settings.bookSync);
  useAccountsSync(phrase, !!settings.bookSync, settings.accounts, update);
  useDiscoverAccounts(phrase, settings.accounts, update);
  const openCoin = useCallback((c: CoinView) => { setCoin(c); setMenu(false); void touch(); }, []);

  const swapPays = (q: Pick<CoinPart, "networkId" | "key">) => q.networkId === SOL.id || q.networkId === BTC.id || (!!extraById(q.networkId) && !extraById(q.networkId)?.noSwap)
    || q.networkId === TRON.id || swapNetworks(settings).some((n) => n.id === q.networkId);

  const coinAct = (c: CoinView, x: "send" | "receive" | "swap" | "buy") => {
    const p = [...c.parts].sort((a, b) => b.amount - a.amount)[0];
    setCoin(null); setMenu(false); setSwapGet(undefined); void touch();
    if (x === "swap") {

      const s = coinSwapStart(c.parts, c.cg, swapPays);
      if (s.none) { setCoin(c); say(fill(t.swapNotHere, { coin: c.symbol })); return; }
      setSwapPrefer(s.prefer); setBuyNet(s.buy); setSwapGet(s.getCg ? { cg: s.getCg, symbol: c.symbol, name: c.name } : undefined);
      setTab("swap"); return;
    }
    if (x === "buy" || !p) { setTab(x === "buy" ? "buy" : x); return; }
    void update({ networkId: p.networkId });
    setSendPre(x === "send" ? p.key : undefined);
    setTab(x);
  };

  const NAV: [Tab, string, ReactNode][] = [
    ["assets", t.assets, <Home size={18} />], ["explore", t.explore, <Compass size={18} />], ["trade", t.trade, <CandlestickChart size={18} />], ["swap", t.swap, <ArrowLeftRight size={18} />], ["buy", t.buy, <CreditCard size={18} />],
    ["settings", t.settings, <Cog size={18} />],
  ];

  const BOTTOM: [Tab | "trade", string, ReactNode][] = [
    ["assets", t.assets, <Home size={20} />], ["explore", t.explore, <Compass size={20} />], ["trade", t.tradeHub, <Repeat size={20} />],
    ["settings", t.settings, <Cog size={20} />],
  ];

  const SHEET: [Tab, string, ReactNode][] = [
    ["trade", t.trade, <CandlestickChart size={18} />], ["buy", t.buy, <CreditCard size={18} />],
  ];
  const home = tab === "assets" && !coin;

  return (
    <div className="shell">
      <nav className="side">
        <div className="logo"><img src="logo-mark.png" alt="" />{t.appName}</div>
        {NAV.map(([x, label, ic]) => <button key={x} className={"nav" + (tab === x ? " on" : "")} onClick={() => go(x)}>{ic}{label}</button>)}
        <div className="keysafe"><ShieldCheck size={16} />{t.keysOnDevice}</div>
      </nav>
      <main className="main">
        <header className="topbar">
          <div style={{ position: "relative", minWidth: 0 }}>
            <button className="acct" onClick={() => setMenu(!menu)}>
              <Avatar address={evm} />
              <div style={{ textAlign: "start", minWidth: 0 }}>
                <div className="name row" style={{ gap: 4 }}>{accName(t, settings, settings.accountIndex)}<ChevronDown size={14} /></div>
                {}
                {myName ? (
                  <span className="acct-name" role="button" tabIndex={0} title={t.copyName} aria-label={`${t.myName}: ${myName}`}
                    onClick={(e) => { e.stopPropagation(); copyMyName(); }} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); copyMyName(); } }}>
                    <BadgeCheck size={13} className="nt-ic" /><bdi dir="ltr">{myName.slice(0, myName.lastIndexOf("."))}<span className="nt-tld">{myName.slice(myName.lastIndexOf("."))}</span></bdi>
                  </span>
                ) : <div className="faint mono">{isAll ? t.allNetworks : short(shown)}</div>}
              </div>
            </button>
            {menu && <AccountMenu phrase={phrase} settings={settings} update={update} close={() => setMenu(false)} />}
          </div>
          <div className="row" style={{ gap: 6 }}>
            {!isAll && <button className="iconbtn" title={t.copy} onClick={() => copy(shown)}><Copy size={16} /></button>}
            <label className="netchip" title={t.network}>
              {isAll ? <Globe size={16} /> : <NetworkDot id={own ? own.id : net.id} />}{isAll ? t.allNetworks : own ? own.name : net.name}<ChevronDown size={14} />
              <select value={isAll ? ALL : own ? own.id : net.id} onChange={(e) => { setCoin(null); if (e.target.value === MORE_NETS) openNets(); else { setSwapPrefer(undefined); setSwapGet(undefined); setBuyNet(undefined); setGasFor(undefined); void update({ networkId: e.target.value }); } }} aria-label={t.network}>
                <option value={ALL}>{t.allNetworks}</option>
                {}
                {!imp && <><option value={BTC.id}>{BTC.name}</option>
                <option value={SOL.id}>{SOL.name}</option>
                <option value={TRON.id}>{TRON.name}</option>
                <option value={TON.id}>{TON.name}</option>
                {EXTRA_COINS.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</>}
                {nets.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
                <option value={MORE_NETS}>{"+ " + t.netsMore}</option>
              </select>
            </label>
            <button className="iconbtn" title={t.lockNow} onClick={() => lock()}><Lock size={16} /></button>
          </div>
        </header>
        <Suspense fallback={<Loading />}>
          {home && <UpdateCard />}
          {home && <XferSlot />}
          {(tab === "assets" || tab === "explore") && coin && <CoinPage key={coin.symbol + "|" + (coin.cg ?? "") + "|" + coin.parts.map((p) => p.networkId).join(",")} coin={coin} phrase={phrase} settings={settings} back={() => setCoin(null)} act={(x) => coinAct(coin, x)} copy={copy} />}
          {home && isAll && <AllAssets phrase={phrase} settings={settings} update={update} go={go} card={cards} open={openCoin} onRefresh={refreshed} view={homeView} setView={setHomeView} />}
          {isAll && tab === "send" && <SendPicker phrase={phrase} settings={settings} onPick={(h) => { setSendPre(h.key); void update({ networkId: h.networkId }); }} />}
          {isAll && (tab === "receive" || tab === "tokens") && <NetPicker title={tab === "receive" ? t.receive : t.manageTokens} update={update} nets={nets} more={openNets} />}
          {!isAll && home && <NetAssets phrase={phrase} settings={settings} update={update} go={go} card={cards} open={openCoin} onRefresh={refreshed} view={homeView} setView={setHomeView} />}
          {!isAll && tab === "send" && netOff(settings.networkId) && <div className="page"><div className="note warn"><TriangleAlert size={16} />{fill(t.netPaused, { n: net?.name ?? extra?.name ?? settings.networkId })}</div></div>}
          {!isAll && tab === "send" && !netOff(settings.networkId) && (isBtc ? <BtcSend phrase={phrase} index={settings.accountIndex} settings={settings} done={() => go("activity")} />
            : extra ? (extra.id === "xrp" ? <XrpSend phrase={phrase} index={settings.accountIndex} settings={settings} done={() => go("activity")} />
              : extra.id === "cardano" ? <AdaSend phrase={phrase} index={settings.accountIndex} settings={settings} done={() => go("activity")} />
              : extra.id === "near" ? <NearSend phrase={phrase} index={settings.accountIndex} settings={settings} done={() => go("activity")} />
              : extra.id === "dogecoin" || extra.id === "litecoin" ? <UtxoSend key={extra.id} coin={extra.id} phrase={phrase} index={settings.accountIndex} settings={settings} done={() => go("activity")} />
              : <KitSend id={extra.id} phrase={phrase} index={settings.accountIndex} settings={settings} done={() => go("activity")} />)
            : isTon ? <TonSend phrase={phrase} index={settings.accountIndex} settings={settings} pre={sendPre} done={() => go("activity")} />
            : isTron ? <TronSend phrase={phrase} index={settings.accountIndex} settings={settings} pre={sendPre} done={() => go("activity")}
              gasHelp={{ swap: () => { setGasFor(TRON.id); setSwapPrefer(undefined); setSwapGet(undefined); setTab("swap"); }, p2p: () => { setP2pMode("buy"); setTab("p2p"); } }} /> : isSol ? <SolSend phrase={phrase} index={settings.accountIndex} settings={settings} pre={sendPre} done={() => go("activity")} /> : <Send key={net.id} net={net} phrase={phrase} index={settings.accountIndex} settings={settings} pre={sendPre} done={() => go("activity")} onSpeed={(sp) => void update({ gasSpeed: sp })}
            gasHelp={{ swap: crossTo(net) ? () => { setGasFor(net.id); setSwapPrefer(undefined); setSwapGet(undefined); setTab("swap"); } : undefined, p2p: () => { setP2pMode("buy"); setTab("p2p"); } }}
            scanned={scanCarry?.netId === net.id ? scanCarry.r : undefined} onScanNet={(id, r) => { setScanCarry({ netId: id, r }); void update({ networkId: id }); }} onScanUsed={() => setScanCarry(null)} />)}
          {!isAll && tab === "tokens" && (isBtc || isTron || isTon || extra ? <div className="page"><h1>{t.manageTokens}</h1><div className="note info"><Globe size={16} />{extra ? fill(t.extraNoTokens, { n: extra.name, sym: extra.symbol }) : isTron ? t.tronNoTokens : isTon ? t.tonNoTokens : t.btcNoTokens}</div></div> : <TokensFor netId={settings.networkId} settings={settings} update={update} say={say} sol={isSol ? { phrase, index: settings.accountIndex } : undefined} />)}
          {!isAll && tab === "receive" && <Receive address={shown} copy={copy} isBtc={isBtc} isSol={isSol} isTron={isTron} isTon={isTon} coin={extra} name={own ? null : myName} copyName={(n) => { void navigator.clipboard.writeText(n); say(t.nameCopied); }} nets={nets.map((n) => n.name)} />}
          {tab === "explore" && !coin && <Explore settings={settings} open={openCoin} />}
          {tab === "trade" && <Trade phrase={phrase} settings={settings} update={update} go={go} />}
          {tab === "p2p" && <P2P key={p2pMode} phrase={phrase} settings={settings} copy={copy} mode={p2pMode} send={() => go("send")} />}
          {tab === "settings" && <SettingsView settings={settings} update={update} say={say} focusNets={netsFocus} phrase={phrase} />}
          {tab === "swap" && <SwapView key={`${settings.accountIndex}:${settings.networkId}:${gasFor ?? ""}:${buyNet ?? ""}:${swapGet?.cg ?? ""}`} phrase={phrase} settings={settings} update={update} go={go} prefer={swapPrefer} getCoin={swapGet} gasFor={gasFor} buy={buyNet ?? (swapGet || swapPrefer || extra?.noSwap ? undefined : extra?.id)} />}
          {tab === "buy" && (BUY_SOON ? <BuyChoices p2p={() => { setP2pMode("buy"); setTab("p2p"); }} /> : <Buy phrase={phrase} settings={settings} />)}
        </Suspense>
      </main>
      <nav className="bottom">
        {BOTTOM.map(([x, label, ic]) => x === "trade"
          ? <button key={x} className={"trade-btn" + (sheet || ["trade", "buy", "p2p"].includes(tab) ? " on" : "")} onClick={() => setSheet((v) => !v)} aria-expanded={sheet}><span className="tb-ic">{ic}</span>{label}</button>
          : <button key={x} className={tab === x && !sheet ? "on" : ""} onClick={() => go(x)}>{ic}{label}</button>)}
      </nav>
      {sheet && (
        <div className="sheet-back" onClick={() => setSheet(false)}>
          <div className="tradesheet" role="dialog" aria-label={t.tradeHub} onClick={(e) => e.stopPropagation()}>
            <h2>{t.tradeSheet}</h2>
            <div className="tsgrid">
              {SHEET.map(([x, label, ic]) => (
                <button key={x} onClick={() => go(x)}>
                  <span className="ic-round">{ic}</span>{label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      {toast}
    </div>
  );
}

function useAccountTotals(phrase: string, settings: Settings): Record<number, number | null> {
  const [totals, setTotals] = useState<Record<number, number | null>>({});
  const key = settings.accounts.map((a) => a.index).join(",") + "|" + settings.currency + "|" + JSON.stringify([settings.enabledTokens, settings.customTokens, settings.networksOn ?? []]);
  useEffect(() => {
    let live = true;
    (async () => {
      for (const a of settings.accounts) {
        const evm = evmAddress(phrase, a.index);
        const c = await cachedTotal(evm, settings.currency).catch(() => null);
        if (!live) return;
        if (c) setTotals((x) => ({ ...x, [a.index]: c.value }));
        if (c && Date.now() - c.at < 60_000) continue;
        try {
          const v = await accountTotal(phrase, a.index, settings);
          await saveTotal(evm, settings.currency, v);
          if (live) setTotals((x) => ({ ...x, [a.index]: v }));
        } catch {  }
      }
    })();
    return () => { live = false; };
  }, [phrase, key]);
  return totals;
}

const addrOf = (phrase: string, index: number) => { try { return evmAddress(phrase, index); } catch { return ""; } };

function AccountMenu({ phrase, settings, update, close }: { phrase: string; settings: Settings; update: Update; close: () => void }) {
  const { t } = useT();
  const totals = useAccountTotals(phrase, settings);
  const [importing, setImporting] = useState(false);
  if (importing) return <ImportKey phrase={phrase} settings={settings} update={update} close={close} back={() => setImporting(false)} />;
  return (
    <div className="list" style={{ position: "absolute", top: 52, insetInlineStart: 0, width: 280, zIndex: 20, boxShadow: "0 12px 32px rgba(0,0,0,.35)" }}>
      {settings.accounts.map((a) => {
        const addr = addrOf(phrase, a.index);
        return (
          <button key={a.index} className="rowi" style={{ width: "100%", textAlign: "start" }} onClick={() => { void update({ accountIndex: a.index }); close(); }}>
            <Avatar address={addr} size={30} />
            <div className="grow"><div className="t1 row" style={{ gap: 6 }}>{accName(t, settings, a.index)}{isImportedIndex(a.index) && <span className="badge warn">{t.impBadge}</span>}</div><div className="t2 mono">{short(addr)}</div></div>
            <span className="num faint" style={{ fontSize: 13 }}>{totals[a.index] == null ? "…" : settings.hideBalances ? "••••" : money(totals[a.index]!, settings.currency)}</span>
            {a.index === settings.accountIndex ? <Check size={16} color="var(--accent-ink)" /> : <span style={{ width: 16, flex: "none" }} />}
          </button>
        );
      })}
      <button className="rowi" style={{ width: "100%", color: "var(--accent-ink)" }} onClick={() => { let index = 0; while (settings.accounts.some((a) => a.index === index)) index++; void update({ accounts: [...settings.accounts, { index, name: "" }], accountIndex: index }); close(); }}>
        <Plus size={18} />{t.sAddAccount}
      </button>
      <button className="rowi" style={{ width: "100%", color: "var(--accent-ink)" }} onClick={() => setImporting(true)}>
        <KeyRound size={18} />{t.impOpen}
      </button>
    </div>
  );
}

function ImportKey({ phrase, settings, update, close, back }: { phrase: string; settings: Settings; update: Update; close: () => void; back: () => void }) {
  const { t } = useT();
  const [key, setKey] = useState(""), [name, setName] = useState(""), [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const go = async () => {
    setErr("");
    const k = parsePrivateKey(key);
    if (!k) { setErr(t.impBadKey); return; }
    setBusy(true);
    try {

      const own = [...new Set([...settings.accounts.filter((a) => !isImportedIndex(a.index)).map((a) => a.index), ...Array.from({ length: 10 }, (_, i) => i)])].map((i) => evmAddress(phrase, i));
      const r = await importPrivateKey(pw, k, name.trim().slice(0, 40), own);
      setKey(""); setPw("");
      await update({ accountIndex: r.index, networkId: "all" });
      close();
    } catch (e) {
      const m = (e as Error)?.message ?? "";
      setErr(m === "ERR_DUP_KEY" ? t.impDup : m === "wrong password" || m === "ERR_WAIT" || m === "ERR_IMPORTED" || m === "ERR_RETRY" ? pwError(t, e) : t.errGeneric);
    }
    setBusy(false);
  };
  return (
    <div className="list stack" style={{ position: "absolute", top: 52, insetInlineStart: 0, width: 300, zIndex: 20, padding: 14, gap: 10, boxShadow: "0 12px 32px rgba(0,0,0,.35)" }}>
      <div className="t1" style={{ fontWeight: 700 }}>{t.impTitle}</div>
      <div className="note warn"><TriangleAlert size={16} /><span>{t.impWarn}</span></div>
      <input className="input mono" type="password" autoComplete="off" spellCheck={false} placeholder={t.impKey} value={key} onChange={(e) => setKey(e.target.value)} aria-label={t.impKey} />
      <input className="input" maxLength={40} placeholder={t.impName} value={name} onChange={(e) => setName(e.target.value)} aria-label={t.impName} />
      <input className="input" type="password" autoComplete="current-password" placeholder={t.impPw} value={pw} onChange={(e) => setPw(e.target.value)} aria-label={t.impPw} onKeyDown={(e) => { if (e.key === "Enter") void go(); }} />
      {err && <div className="err">{err}</div>}
      <div className="row" style={{ gap: 8 }}>
        <button className="btn ghost" style={{ flex: 1 }} disabled={busy} onClick={() => { setKey(""); setPw(""); back(); }}>{t.back}</button>
        <button className="btn primary" style={{ flex: 1 }} disabled={busy || !key || !pw} onClick={() => void go()}>{busy ? t.impBusy : t.impBtn}</button>
      </div>
    </div>
  );
}

type Cur = "usd" | "sar";

type Row = { key: string; symbol: string; name: string; verified: boolean; amount: string; decimals: number; cg?: string; contract?: string; pending?: string;

  reserve?: string; spendable?: string; inactive?: string };
const valueOf = (amount: number, cg: string | undefined, prices: Prices) => (amount === 0 ? 0 : cg && prices[cg] ? amount * prices[cg].price : null);
const changeOf = (cg: string | undefined, prices: Prices) => (cg && prices[cg] ? prices[cg].change : null);
const priceIdsOf = (cgs: (string | undefined)[]) => {
  const ids: string[] = [], custom: { platform: string; address: string }[] = [];
  for (const k of new Set(cgs)) { if (!k) continue; const i = k.indexOf(":"); if (i < 0) ids.push(k); else custom.push({ platform: k.slice(0, i), address: k.slice(i + 1) }); }
  return { ids, custom };
};

function useRows(snapKey: string, read: () => Promise<Row[]>, cgs: (string | undefined)[], cur: string, deps: unknown[]) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [prices, setPrices] = useState<Prices>({});
  const [err, setErr] = useState(false);
  const seq = useRef(0);
  const curL = cur.toLowerCase() as Cur;
  const load = useCallback(async () => {
    const my = ++seq.current;
    const { ids, custom } = priceIdsOf(cgs);
    const pr = fetchPrices(ids, curL, custom).then((p) => { if (my === seq.current) setPrices((o) => ({ ...o, ...p })); }).catch(() => {});
    try {
      const r = await read();
      if (my === seq.current) { setRows(r); setErr(false); void writeSnap(snapKey, r); }
    } catch { if (my === seq.current) setErr(true); }
    await pr;
  }, [snapKey, curL, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let live = true;
    setRows(null); setErr(false);
    void Promise.all([readSnap<Row[]>(snapKey), cachedPrices(curL)]).then(([s, p]) => {
      if (!live) return;
      setPrices((o) => ({ ...p, ...o }));
      if (s && Array.isArray(s.v)) setRows((r) => r ?? s.v);
    });
    void load();
    return () => { live = false; };
  }, [load]);
  return { rows, prices, err, load };
}

const AssetRow = memo(function AssetRow({ id, symbol, title, unverified, sub, value, amount, change, onOpen }: {
  id: string; symbol: string; title: string; unverified: string | null; sub: string; value: string; amount: string; change: number | null; onOpen: (id: string) => void;
}) {
  return (
    <button className="rowi" style={{ width: "100%", textAlign: "start" }} onClick={() => onOpen(id)}>
      <TokenIcon symbol={symbol} />
      <div className="grow">
        <div className="t1 row" style={{ gap: 6 }}>{title}{unverified && <span className="badge warn">{unverified}</span>}</div>
        <div className="t2">{sub}</div>
      </div>
      <div className="end">
        <div className="t1 num">{value}</div>
        <div className="t2 num">{amount}{change != null && <span className={change >= 0 ? "up" : "down"}> {change >= 0 ? "▲" : "▼"} {Math.abs(change).toFixed(1)}%</span>}</div>
      </div>
    </button>
  );
});
const Skeleton = ({ n = 3 }: { n?: number }) => <>{Array.from({ length: n }, (_, i) => (
  <div className="rowi" key={i}><div style={{ width: 36, height: 36, borderRadius: "50%", background: "var(--card-2)" }} /><div className="grow stack" style={{ gap: 6 }}><div className="skel" style={{ width: "40%" }} /><div className="skel" style={{ width: "25%" }} /></div></div>
))}</>;

function Hero({ label, total, day, settings, update }: { label: string; total: string | null; day?: { abs: number; pct: number } | null; settings: Settings; update: Update }) {
  const { t } = useT();
  const hide = settings.hideBalances;
  const sign = (v: number) => (v >= 0 ? "+" : "−");
  return (
    <div className="hero">
      <div className="label">
        {t.totalBalance} · {label}
        <button onClick={() => update({ hideBalances: !hide })} aria-label={hide ? t.show : t.hide}>{hide ? <EyeOff size={15} /> : <Eye size={15} />}</button>
      </div>
      <div className="amount"><span className="num">{total == null ? "…" : hide ? "••••" : total}</span></div>
      {}
      {total != null && day && (
        <div className={"chg " + (day.abs >= 0 ? "up" : "down")}>
          <bdi className="num" dir="ltr">{hide ? "••••" : `${sign(day.abs)}${money(Math.abs(day.abs), settings.currency)}`} ({sign(day.pct)}{Math.abs(day.pct).toFixed(2)}%)</bdi> <span className="faint">{t.day24}</span>
        </div>
      )}
    </div>
  );
}
function Actions({ go }: { go: (t: Tab) => void }) {
  const { t } = useT();
  return (
    <div className="actions">
      {([["send", t.send, <ArrowUpRight size={20} />], ["receive", t.receive, <ArrowDownLeft size={20} />], ["swap", t.swap, <ArrowLeftRight size={20} />], ["buy", t.buy, <CreditCard size={20} />]] as [Tab, string, ReactNode][]).map(([x, label, ic]) => (
        <button key={x} className="action" onClick={() => go(x)}><span className="ic">{ic}</span>{label}</button>
      ))}
    </div>
  );
}

export type HomeView = "tokens" | "activity";
function HomeTabs({ view, setView, tools }: { view: HomeView; setView: (v: HomeView) => void; tools?: ReactNode }) {
  const { t } = useT();
  const tabs: [HomeView, string][] = [["tokens", t.homeTokens], ["activity", t.activity]];
  return (
    <div className="sect home-tabs">
      <div className="htabs" role="tablist">
        {tabs.map(([v, label]) => (
          <button key={v} role="tab" aria-selected={view === v} className={view === v ? "on" : ""} onClick={() => { setView(v); void touch(); }}>{label}</button>
        ))}
      </div>
      {view === "tokens" && tools && <div className="row" style={{ gap: 4 }}>{tools}</div>}
    </div>
  );
}

function NetAssets({ phrase, settings, update, go, card, open, onRefresh, view, setView }: { phrase: string; settings: Settings; update: Update; go: (t: Tab) => void; card?: ReactNode; open: (c: CoinView) => void; onRefresh?: () => void; view: HomeView; setView: (v: HomeView) => void }) {
  const { t } = useT();
  const idx = settings.accountIndex, cur = settings.currency;
  const isBtc = settings.networkId === BTC.id, isSol = settings.networkId === SOL.id, isTron = settings.networkId === TRON.id, isTon = settings.networkId === TON.id;
  const extra = extraById(settings.networkId);
  const net = netOf(useNets(settings), settings.networkId);
  const own = isBtc ? BTC : isSol ? SOL : isTron ? TRON : isTon ? TON : extra ?? null;
  const netId = own ? own.id : net.id, netName = own ? own.name : net.name;
  const address = isBtc ? btcAddress(phrase, idx) : isSol ? solAddress(phrase, idx) : isTron ? tronAddress(phrase, idx) : isTon ? tonAddress(phrase, idx) : extra ? extra.address(phrase, idx) : evmAddress(phrase, idx);
  const single = isBtc || !!extra;

  const tokens: Token[] = single ? [] : isTron ? [...TRON.tokens] : isTon ? [...TON.tokens] : visibleTokens(isSol ? SOL : net, settings.enabledTokens, settings.customTokens);
  const tokKey = tokens.map((x) => x.address).join(",");
  const platform = isSol ? SOL.cgPlatform : isTron ? TRON.cgPlatform : isTon ? TON.cgPlatform : net.cgPlatform;
  const cgOf = (tk: Token) => tk.coingecko ?? `${platform}:${tk.address.toLowerCase()}`;
  const nativeCg = own ? own.coingecko : net.native.coingecko;
  const cgs = [nativeCg, ...tokens.map(cgOf)];
  const read = async (): Promise<Row[]> => {
    if (extra) {
      const b = await extra.balance(address);
      return [{ key: "native", symbol: extra.symbol, name: extra.coinName, verified: true, amount: extraAmount(extra, b.total), decimals: extra.decimals, cg: extra.coingecko,
        pending: b.pending !== 0n ? extraAmount(extra, b.pending) : undefined,
        ...(extra.id === "xrp" ? (b.active ? { reserve: formatXrp(b.reserve), spendable: formatXrp(b.total - b.reserve) } : { inactive: formatXrp(b.reserveBase) }) : {}) }];
    }
    if (isBtc) {
      const b = await btcBalance(address);
      return [{ key: "native", symbol: "BTC", name: "Bitcoin", verified: true, amount: formatBtc(b.confirmed + b.pending), decimals: 8, cg: BTC.coingecko, pending: b.pending !== 0n ? formatBtc(b.pending) : undefined }];
    }
    if (isTon) {
      const b = await tonBalances(address);
      return [{ key: "native", symbol: "TON", name: "Toncoin", verified: true, amount: formatUnitsStr(b.nano, 9), decimals: 9, cg: TON.coingecko },
        ...tokens.map((tk) => ({ key: tk.address as string, symbol: tk.symbol, name: tk.name, verified: true, amount: formatUnitsStr(b.usdt, tk.decimals), decimals: tk.decimals, cg: cgOf(tk), contract: tk.address as string }))];
    }
    if (isTron) {
      const b = await tronBalances(address);
      return [{ key: "native", symbol: "TRX", name: "Tron", verified: true, amount: formatUnitsStr(b.sun, 6), decimals: 6, cg: TRON.coingecko },
        ...tokens.map((tk) => ({ key: tk.address as string, symbol: tk.symbol, name: tk.name, verified: true, amount: formatUnitsStr(b.usdt, tk.decimals), decimals: tk.decimals, cg: cgOf(tk), contract: tk.address as string }))];
    }
    if (isSol) {
      const b = await solBalances(address, tokens.map((x) => x.address));
      return [{ key: "native", symbol: "SOL", name: "Solana", verified: true, amount: formatUnitsStr(b.lamports, 9), decimals: 9, cg: SOL.coingecko },
        ...tokens.map((tk) => ({ key: tk.address as string, symbol: tk.symbol, name: tk.name, verified: tk.verified, amount: formatUnitsStr(b.tokens.get(tk.address) ?? 0n, tk.decimals), decimals: tk.decimals, cg: cgOf(tk), contract: tk.address as string }))];
    }
    const list = await balances(net, address as `0x${string}`, tokens, {});
    return list.map((a) => { const tk = tokens.find((x) => x.address.toLowerCase() === a.key); return { key: a.key, symbol: a.symbol, name: a.name, verified: a.verified, amount: a.amount, decimals: a.decimals, cg: tk ? cgOf(tk) : nativeCg, contract: tk ? tk.address : undefined }; });
  };
  const { rows, prices, err, load } = useRows(`net:${netId}:${address}:${tokKey}`, read, cgs, cur, [address, tokKey]);
  useLiveBalances(load);
  const list = useMemo(() => rows && byHoldings(rows, (a) => Number(a.amount), (a) => valueOf(Number(a.amount), a.cg, prices)).filter((a) => !settings.hideZero || Number(a.amount) > 0), [rows, prices, settings.hideZero]);
  const total = rows ? rows.reduce((s, a) => s + (valueOf(Number(a.amount), a.cg, prices) ?? 0), 0) : null;
  const mask = (s: string) => (settings.hideBalances ? "••••" : s);
  const rowsRef = useRef(rows); rowsRef.current = rows;
  const onOpen = useCallback((key: string) => {
    const a = rowsRef.current?.find((x) => x.key === key);
    if (a) open({ symbol: a.symbol, name: a.name, verified: a.verified, cg: a.cg, parts: [{ networkId: netId, networkName: netName, key: a.key, amount: Number(a.amount), decimals: a.decimals, contract: a.contract }] });
  }, [open, netId, netName]);
  const pending = rows?.[0]?.pending;
  return (
    <>
      <Hero label={netName} total={rows ? money(total, cur) : null} day={rows ? dayChange(rows.map((a) => ({ value: valueOf(Number(a.amount), a.cg, prices), change: STABLES.has(a.symbol) ? 0 : changeOf(a.cg, prices) }))) : null} settings={settings} update={update} />
      <Actions go={go} />
      {card}
      <HomeTabs view={view} setView={setView} tools={<>
        {!single && <ZeroToggle settings={settings} update={update} />}
        {!single && !isTron && !isTon && <button className="iconbtn" title={t.manageTokens} onClick={() => go("tokens")}><SlidersHorizontal size={15} /></button>}
        <RefreshBtn onClick={() => { onRefresh?.(); return load(); }} />
      </>} />
      {view === "activity" ? <Suspense fallback={<Skeleton />}><Activity phrase={phrase} settings={settings} embedded netId={netId} /></Suspense> : <>
      {err && <div className="note bad" style={{ marginBottom: 10 }}><TriangleAlert size={16} />{t.netError}</div>}
      <div className="list">
        {!rows && !err && <Skeleton />}
        {list?.map((a) => (
          <AssetRow key={a.key} id={a.key} symbol={a.symbol} title={coinName(a.symbol, a.name, a.verified)} unverified={a.verified ? null : t.unverified} sub={`${a.symbol} · ${netName}`}
            value={mask(money(valueOf(Number(a.amount), a.cg, prices), cur))} amount={mask(`${amt(a.amount, a.symbol)} ${a.symbol}`)} change={STABLES.has(a.symbol) ? null : changeOf(a.cg, prices)} onOpen={onOpen} />
        ))}
      </div>
      {pending && <div className="note info" style={{ marginTop: 10 }}><Clock size={16} />{extra ? fill(t.coinPending, { amt: pending, sym: extra.symbol }) : fill(t.btcPending, { amt: pending })}</div>}
      {rows?.[0]?.reserve && <div className="note soft" style={{ marginTop: 10 }}><Info size={15} /><span>{fillNodes(t.xrpReserveNote, { r: rows[0].reserve, s: rows[0].spendable ?? "0" })}</span></div>}
      {rows?.[0]?.inactive && <div className="note info" style={{ marginTop: 10 }}><Info size={15} /><span>{fillNodes(t.xrpInactive, { r: rows[0].inactive })}</span></div>}
      {isTron && <div className="note soft" style={{ marginTop: 10 }}><Info size={15} /><span>{t.tronFeeNote}</span></div>}
      {isTon && <div className="note soft" style={{ marginTop: 10 }}><Info size={15} /><span>{t.tonFeeNote}</span></div>}
      {!single && !isTron && !isTon && <button className="link" style={{ marginTop: 10 }} onClick={() => go("tokens")}>+ {t.manageTokens}</button>}
      </>}
    </>
  );
}

const ALL = "all";

const MORE_NETS = "__nets";

function useNets(settings: Settings): Network[] {
  const key = (settings.networksOn ?? []).join(",");
  return useMemo(() => activeNetworks(settings), [key]); // eslint-disable-line react-hooks/exhaustive-deps
}

const netOf = (nets: Network[], id: string) => nets.find((n) => n.id === id) ?? NETWORKS[0];

type Holding = { symbol: string; name: string; verified: boolean; networkId: string; networkName: string; amount: number; native: boolean; key: string; decimals: number; cg?: string; contract?: string };

function useAllHoldings(phrase: string, settings: Settings) {
  const cur = settings.currency, idx = settings.accountIndex, curL = cur.toLowerCase() as Cur;
  const evm = evmAddress(phrase, idx);
  const tokKey = JSON.stringify([settings.enabledTokens, settings.customTokens, settings.networksOn ?? []]);
  const snapKey = `all:${evm}`;
  const [rows, setRows] = useState<Holding[] | null>(null);
  const [prices, setPrices] = useState<Prices>({});
  const [failed, setFailed] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const seq = useRef(0);
  const load = useCallback(async () => {
    const my = ++seq.current;
    const btcA = btcAddress(phrase, idx), solA = solAddress(phrase, idx), tronA = tronAddress(phrase, idx), tonA = tonAddress(phrase, idx);
    const solTokens = visibleTokens(SOL, settings.enabledTokens, settings.customTokens);
    const nets = activeNetworks(settings).map((n) => ({ n, tokens: visibleTokens(n, settings.enabledTokens, settings.customTokens) }));
    const solCg = (tk: Token) => tk.coingecko ?? `${SOL.cgPlatform}:${tk.address.toLowerCase()}`;
    const evmCg = (n: Network, tk: Token) => tk.coingecko ?? `${n.cgPlatform}:${tk.address.toLowerCase()}`;
    const { ids, custom } = priceIdsOf([BTC.coingecko, SOL.coingecko, TRON.coingecko, TON.coingecko, ...EXTRA_COINS.map((c) => c.coingecko), ...TRON.tokens.map((tk) => tk.coingecko), ...solTokens.map(solCg), ...nets.flatMap(({ n, tokens }) => [n.native.coingecko, ...tokens.map((tk) => evmCg(n, tk))])]);
    const pr = fetchPrices(ids, curL, custom).then((p) => { if (my === seq.current) setPrices((o) => ({ ...o, ...p })); }).catch(() => {});
    const got = new Map<string, Holding[]>(), bad: string[] = [];
    const put = (netId: string, list: Holding[]) => {
      got.set(netId, list);
      if (my === seq.current) setRows((old) => [...(old ?? []).filter((r) => r.networkId !== netId), ...list]);
    };
    await Promise.all([

      ...(isImportedIndex(idx) ? [] : [
      btcBalance(btcA).then((b) => put(BTC.id, [{ symbol: "BTC", name: "Bitcoin", verified: true, networkId: BTC.id, networkName: BTC.name, amount: Number(formatBtc(b.confirmed + b.pending)), native: true, key: "native", decimals: 8, cg: BTC.coingecko }])).catch(() => bad.push(BTC.name)),
      solBalances(solA, solTokens.map((x) => x.address)).then((b) => put(SOL.id, [
        { symbol: "SOL", name: "Solana", verified: true, networkId: SOL.id, networkName: SOL.name, amount: Number(formatUnitsStr(b.lamports, 9)), native: true, key: "native", decimals: 9, cg: SOL.coingecko },
        ...solTokens.map((tk) => ({ symbol: tk.symbol, name: tk.name, verified: tk.verified, networkId: SOL.id, networkName: SOL.name, amount: Number(formatUnitsStr(b.tokens.get(tk.address) ?? 0n, tk.decimals)), native: false, key: tk.address as string, decimals: tk.decimals, cg: solCg(tk), contract: tk.address as string })),
      ])).catch(() => bad.push(SOL.name)),
      tronBalances(tronA).then((b) => put(TRON.id, [
        { symbol: "TRX", name: "Tron", verified: true, networkId: TRON.id, networkName: TRON.name, amount: Number(formatUnitsStr(b.sun, 6)), native: true, key: "native", decimals: 6, cg: TRON.coingecko },
        ...TRON.tokens.map((tk) => ({ symbol: tk.symbol, name: tk.name, verified: true, networkId: TRON.id, networkName: TRON.name, amount: Number(formatUnitsStr(b.usdt, tk.decimals)), native: false, key: tk.address as string, decimals: tk.decimals, cg: tk.coingecko, contract: tk.address as string })),
      ])).catch(() => bad.push(TRON.name)),

      tonBalances(tonA).then((b) => put(TON.id, [
        { symbol: "TON", name: "Toncoin", verified: true, networkId: TON.id, networkName: TON.name, amount: Number(formatUnitsStr(b.nano, 9)), native: true, key: "native", decimals: 9, cg: TON.coingecko },
        ...TON.tokens.map((tk) => ({ symbol: tk.symbol, name: tk.name, verified: true, networkId: TON.id, networkName: TON.name, amount: Number(formatUnitsStr(b.usdt, tk.decimals)), native: false, key: tk.address as string, decimals: tk.decimals, cg: tk.coingecko, contract: tk.address as string })),
      ])).catch(() => bad.push(TON.name)),

      ...EXTRA_COINS.map((c) => c.balance(c.address(phrase, idx)).then((b) => put(c.id, [
        { symbol: c.symbol, name: c.coinName, verified: true, networkId: c.id, networkName: c.name, amount: Number(extraAmount(c, b.total)), native: true, key: "native", decimals: c.decimals, cg: c.coingecko },
      ])).catch(() => bad.push(c.name))),
      ]),
      ...nets.map(({ n, tokens }) => balances(n, evm, tokens, {}).then((list) => put(n.id, list.map((a) => {
        const tk = a.key === "native" ? undefined : tokens.find((x) => x.address.toLowerCase() === a.key);
        return { symbol: a.symbol, name: a.name, verified: a.verified, networkId: n.id, networkName: n.name, amount: Number(a.amount), native: a.key === "native", key: a.key, decimals: a.decimals, cg: tk ? evmCg(n, tk) : n.native.coingecko, contract: tk?.address };
      }))).catch(() => bad.push(n.name))),
    ]);
    await pr;
    if (my !== seq.current) return;
    setFailed(bad); setReady(true);

    const saved = (await readSnap<Holding[]>(snapKey))?.v ?? [];
    const keep = saved.filter((r) => !got.has(r.networkId) && bad.includes(r.networkName));
    void writeSnap(snapKey, [...[...got.values()].flat(), ...keep]);
  }, [phrase, idx, curL, tokKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let live = true;
    setRows(null); setReady(false); setFailed([]);
    void Promise.all([readSnap<Holding[]>(snapKey), cachedPrices(curL)]).then(([s, p]) => {
      if (!live) return;
      setPrices((o) => ({ ...p, ...o }));

      const shownIds = new Set([BTC.id, SOL.id, TRON.id, ...EXTRA_COINS.map((c) => c.id), ...activeNetworks(settings).map((n) => n.id)]);
      if (s && Array.isArray(s.v)) { setRows((r) => r ?? s.v.filter((x) => shownIds.has(x.networkId))); setReady(true); }
    });
    void load();
    return () => { live = false; };
  }, [load]); // eslint-disable-line react-hooks/exhaustive-deps
  return { rows, prices, failed, load, ready };
}

function coinViewOf(h: Holding, all: Holding[]): CoinView {
  const same = h.verified && h.cg ? all.filter((r) => r.verified && r.cg === h.cg && (r.native === h.native || r.symbol === h.symbol)) : [h];
  const parts = (same.some((r) => r.amount > 0) ? same.filter((r) => r.amount > 0 || r === h) : same)
    .map((r) => ({ networkId: r.networkId, networkName: r.networkName, key: r.key, amount: r.amount, decimals: r.decimals, contract: r.contract }));
  return { symbol: h.symbol, name: h.name, verified: h.verified, cg: h.cg, parts };
}

function AllAssets({ phrase, settings, update, go, card, open, onRefresh, view, setView }: { phrase: string; settings: Settings; update: Update; go: (t: Tab) => void; card?: ReactNode; open: (c: CoinView) => void; onRefresh?: () => void; view: HomeView; setView: (v: HomeView) => void }) {
  const { t } = useT();
  const { rows, prices, failed, load, ready } = useAllHoldings(phrase, settings);
  useLiveBalances(load, 45_000);
  const cur = settings.currency;
  const val = (r: Holding) => valueOf(r.amount, r.cg, prices);

  const BASE_ORDER = ["BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "TRX", "TON", "DOGE", "LTC", "POL", "AVAX", "S", "MNT", "xDAI", "CELO", "BERA"];
  const ORDER = [...BASE_ORDER, ...EXTRA_COINS.map((c) => c.symbol).filter((s) => !BASE_ORDER.includes(s))];
  type Item = { id: string; symbol: string; name: string; verified: boolean; amount: number; value: number | null; change: number | null; sub: string; pick: Holding };
  const items = useMemo<Item[]>(() => {
    if (!rows) return [];
    const groups: Item[] = ORDER.map((sym) => {
      const parts = rows.filter((r) => r.native && r.symbol === sym);
      if (!parts.length) return null;
      const vals = parts.map(val);
      const top = byHoldings(parts, (p) => p.amount, val)[0];
      return { id: "g:" + sym, symbol: sym, name: parts[0].name, verified: true, amount: parts.reduce((s, r) => s + r.amount, 0), value: vals.some((v) => v == null) ? null : vals.reduce((s: number, v) => s + (v ?? 0), 0),
        change: changeOf(parts[0].cg, prices), sub: parts.length > 1 ? fill(t.onNNetworks, { n: String(parts.length) }) : parts[0].networkName, pick: top };
    }).filter((x): x is Item => !!x);
    const ones: Item[] = rows.filter((r) => !r.native && r.amount > 0).map((r) => ({ id: r.networkId + "|" + r.key, symbol: r.symbol, name: r.name, verified: r.verified, amount: r.amount, value: val(r), change: STABLES.has(r.symbol) ? null : changeOf(r.cg, prices), sub: `${r.symbol} · ${r.networkName}`, pick: r }));
    return byHoldings([...groups, ...ones], (x) => x.amount, (x) => x.value).filter((x) => !settings.hideZero || x.amount > 0);
  }, [rows, prices, settings.hideZero, t]); // eslint-disable-line react-hooks/exhaustive-deps
  const total = rows ? rows.reduce((s, r) => s + (val(r) ?? 0), 0) : null;
  const mask = (s: string) => (settings.hideBalances ? "••••" : s);
  const ref = useRef({ items, rows }); ref.current = { items, rows };
  const onOpen = useCallback((id: string) => {
    const x = ref.current.items.find((i) => i.id === id);
    if (x && ref.current.rows) open(coinViewOf(x.pick, ref.current.rows));
  }, [open]);
  return (
    <>
      <Hero label={t.allNetworks} total={ready ? money(total, cur) : null} day={ready && rows ? dayChange(rows.map((r) => ({ value: val(r), change: STABLES.has(r.symbol) ? 0 : changeOf(r.cg, prices) }))) : null} settings={settings} update={update} />
      <Actions go={go} />
      {card}
      <HomeTabs view={view} setView={setView} tools={<><ZeroToggle settings={settings} update={update} /><RefreshBtn onClick={() => { onRefresh?.(); return load(); }} /></>} />
      {view === "activity" ? <Suspense fallback={<Skeleton />}><Activity phrase={phrase} settings={settings} embedded /></Suspense> : <>
      {failed.length > 0 && <div className="note warn" style={{ marginBottom: 10 }}><TriangleAlert size={16} />{fill(t.partialLoad, { list: failed.join("، ") })}</div>}
      <div className="list">
        {!rows && <Skeleton n={4} />}
        {rows && ready && items.length === 0 && <div className="empty" style={{ padding: 18 }}>{t.allHidden}</div>}
        {items.map((x) => (
          <AssetRow key={x.id} id={x.id} symbol={x.symbol} title={coinName(x.symbol, x.name, x.verified)} unverified={x.verified ? null : t.unverified} sub={x.sub}
            value={mask(money(x.value, cur))} amount={mask(`${amt(String(x.amount), x.symbol)} ${x.symbol}`)} change={x.change} onOpen={onOpen} />
        ))}
      </div>
      </>}
    </>
  );
}

function SendPicker({ phrase, settings, onPick }: { phrase: string; settings: Settings; onPick: (h: Holding) => void }) {
  const { t } = useT();
  const { rows, prices } = useAllHoldings(phrase, settings);
  const cur = settings.currency, mask = (x: string) => (settings.hideBalances ? "••••" : x);
  const val = (r: Holding) => valueOf(r.amount, r.cg, prices);
  const list = rows ? byHoldings(rows.filter((r) => r.amount > 0), (r) => r.amount, val) : null;
  return (
    <div className="page">
      <h1>{t.send}</h1>
      <p className="muted" style={{ marginTop: -6 }}>{t.pickToSend}</p>
      <div className="list">
        {!list && <Skeleton />}
        {list && list.length === 0 && <div className="empty" style={{ padding: 18 }}>{t.nothingToSend}</div>}
        {list?.map((r) => (
          <button key={r.networkId + "|" + r.key} className="rowi" style={{ width: "100%", textAlign: "start" }} onClick={() => onPick(r)}>
            <TokenIcon symbol={r.symbol} />
            <div className="grow"><div className="t1">{coinName(r.symbol, r.name, r.verified)}</div><div className="t2 row" style={{ gap: 6 }}><NetworkDot id={r.networkId} size={14} />{r.networkName}</div></div>
            <div className="end"><div className="t1 num">{mask(money(val(r), cur))}</div><div className="t2 num">{mask(`${amt(String(r.amount), r.symbol)} ${r.symbol}`)}</div></div>
          </button>
        ))}
      </div>
    </div>
  );
}

function NetPicker({ title, update, nets: evmNets, more }: { title: string; update: Update; nets: Network[]; more: () => void }) {
  const { t } = useT();
  const nets: [string, string][] = [[BTC.id, BTC.name], [SOL.id, SOL.name], [TRON.id, TRON.name], [TON.id, TON.name], ...EXTRA_COINS.map((c) => [c.id, c.name] as [string, string]), ...evmNets.map((n) => [n.id, n.name] as [string, string])];
  return (
    <div className="page">
      <h1>{title}</h1>
      <p className="muted" style={{ marginTop: -6 }}>{t.pickNetwork}</p>
      <div className="list">
        {nets.map(([id, name]) => (
          <button key={id} className="setrow" onClick={() => update({ networkId: id })}>
            <NetworkDot id={id} size={28} /><span className="grow">{name}</span><ChevronDown size={14} style={{ transform: "rotate(90deg)" }} />
          </button>
        ))}
        {}
        <button className="setrow" onClick={more}>
          <span className="ic-round" style={{ width: 28, height: 28 }}><Plus size={16} /></span><span className="grow">{t.netsMore}</span><ChevronDown size={14} style={{ transform: "rotate(90deg)" }} />
        </button>
      </div>
    </div>
  );
}

function useMyName(evm: string): string | null | undefined {
  const [name, setName] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    setName(undefined);
    const demo = import.meta.env.DEV ? (globalThis as { __DEMO_NAME__?: string | null }).__DEMO_NAME__ : undefined;
    if (demo !== undefined) { setName(demo); return; }
    lookupMyName(evm).then((n) => { if (live) setName(n); }, () => { if (live) setName(null); });
    return () => { live = false; };
  }, [evm]);
  return name;
}

const FREE_CARD_KEY = "freeNameCardClosed";

function FreeNameCard({ name, phrase, index }: { name: string | null | undefined; phrase: string; index: number }) {
  const { t } = useT();
  const [closed, setClosed] = useState<boolean | null>(null);
  const [claiming, setClaiming] = useState(() => import.meta.env.DEV && !!(globalThis as { __DEMO_FREENAME__?: boolean }).__DEMO_FREENAME__);

  const [open, setOpen] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    Promise.resolve(chrome.storage.local.get(FREE_CARD_KEY)).then((r) => { if (live) setClosed(r?.[FREE_CARD_KEY] === true); }, () => { if (live) setClosed(false); });
    return () => { live = false; };
  }, []);
  useEffect(() => {
    if (name !== null || closed !== false) return;
    let live = true;
    freeStatus(evmAddress(phrase, index)).then((s) => { if (live) setOpen(s.open); }, () => { if (live) setOpen(false); });
    return () => { live = false; };
  }, [name, closed, phrase, index]);
  if (claiming) return <div className="freecard" style={{ display: "block" }}><div className="fc-title" style={{ marginBottom: 10 }}>{t.fnBoxTitle}</div><FreeNameClaim phrase={phrase} index={index} onClose={() => setClaiming(false)} /></div>;
  if (closed !== false || name !== null || open !== true) return null;
  const close = () => { setClosed(true); void Promise.resolve(chrome.storage.local.set({ [FREE_CARD_KEY]: true })).catch(() => {}); };
  return (
    <div className="freecard">
      <span className="fc-mark" aria-hidden="true">M</span>
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="fc-title">{t.freeNameTitle}</div>
        <div className="fc-line"><span className="nw">{t.freeNameLine.split("{ex}").map((part, i) => (i ? <Fragment key={i}><MadarName name="sunrise.madar" />{part}</Fragment> : part))}</span> · <span className="nw">{t.freeNameOne}</span></div>
      </div>
      <button className="fc-go" onClick={() => (ANDROID ? setClaiming(true) : void chrome.tabs.create({ url: "https://madarwallet.app/names/" }))}>{t.freeNameGo}</button>
      <button className="fc-x" onClick={close} title={t.freeNameClose} aria-label={t.freeNameClose}><X size={14} /></button>
    </div>
  );
}
