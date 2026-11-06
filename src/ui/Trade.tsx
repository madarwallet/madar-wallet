import { ChevronDown, ExternalLink, Search, X } from "lucide-react";
import { createChart, type IChartApi, type ISeriesApi, type UTCTimestamp } from "lightweight-charts";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { hlCandles, hlMarkets, range24, TFS, tradeable, tradeCoin, type Candle, type HlMarket, type Tf } from "../core/hl";
import type { Settings } from "../core/store";
import { NETWORKS } from "../core/chains";
import { isImportedIndex } from "../core/imported";
import { isForeignCopy } from "../core/picker";

const EVM_OWN: ReadonlySet<string> = new Set(NETWORKS.flatMap((n) => [n.native.symbol, ...n.tokens.filter((t) => t.verified && !isForeignCopy({ netId: n.id, symbol: t.symbol, native: false })).map((t) => t.symbol)]));
import { fmtCompact, fmtPrice } from "./CoinPage";
import type { Tab } from "./common";
import { useT } from "./i18n";
import { TokenIcon } from "./icons";

const SwapView = lazy(() => import("./Swap").then((m) => ({ default: m.SwapView })));
const LimitOrder = lazy(() => import("./LimitOrder").then((m) => ({ default: m.LimitOrder })));
const MARKET_KEY = "tradeMarket", TF_KEY = "tradeTf", ENGINE_KEY = "tradeChart", DOLLAR_KEY = "tradeDollar";
const load = (k: string, d: string) => { try { return localStorage.getItem(k) || d; } catch { return d; } };
const save = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch {  } };
const pct = (n: number | null) => (n == null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`);

export function Trade({ phrase, settings, update, go }: { phrase: string; settings: Settings; update: (p: Partial<Settings>) => unknown; go: (t: Tab) => void }) {
  const { t } = useT();
  const [markets, setMarkets] = useState<HlMarket[] | null>(null);
  const [err, setErr] = useState(false);
  const [coin, setCoin] = useState(() => load(MARKET_KEY, "ETH"));
  const [tf, setTf] = useState<Tf>(() => TFS.find((x) => x.id === load(TF_KEY, "1h")) ?? TFS[1]);
  const [side, setSide] = useState<"buy" | "sell">("buy");

  const [kind, setKind] = useState<"market" | "limit">("market");

  const [dollar, setDollar] = useState<"USDT" | "USDC">(() => (load(DOLLAR_KEY, "USDT") === "USDC" ? "USDC" : "USDT"));
  const [engine, setEngine] = useState<"madar" | "tv">(() => (load(ENGINE_KEY, "madar") === "tv" ? "tv" : "madar"));
  const [picking, setPicking] = useState(false);
  const [hi, setHi] = useState<{ high: number; low: number } | null>(null);

  const evmOnly = isImportedIndex(settings.accountIndex);
  useEffect(() => {
    let live = true;
    const run = () => { if (typeof document !== "undefined" && document.hidden) return; hlMarkets().then((m) => { if (live) { setMarkets(m.filter((x) => tradeable(x.coin) && (!evmOnly || EVM_OWN.has(tradeCoin(x.coin))))); setErr(false); } }, () => live && setErr(true)); };
    run();
    const id = setInterval(run, 15_000);
    return () => { live = false; clearInterval(id); };
  }, [evmOnly]);
  useEffect(() => {
    let live = true;
    hlCandles(coin, TFS[1], 26).then((c) => live && setHi(range24(c)), () => live && setHi(null));
    return () => { live = false; };
  }, [coin]);

  const list = useMemo(() => [...(markets ?? [])].sort((a, b) => (b.vol ?? 0) - (a.vol ?? 0)), [markets]);
  const m = list.find((x) => x.coin === coin) ?? null;

  useEffect(() => { if (markets && markets.length && !markets.some((x) => x.coin === coin)) pick(list[0].coin); }, [markets]); // eslint-disable-line react-hooks/exhaustive-deps
  function pick(c: string) { setCoin(c); save(MARKET_KEY, c); setPicking(false); }
  const TF_LABEL: Record<string, string> = { "15m": t.trTf15m, "1h": t.trTf1h, "4h": t.trTf4h, "1d": t.trTf1d, "1w": t.trTf1w };

  if (picking) return <MarketList list={list} cur={coin} onPick={pick} onClose={() => setPicking(false)} />;
  return (
    <div className="page stack trade">
      <div className="between" style={{ alignItems: "flex-start" }}>
        <button className="trade-mkt" onClick={() => setPicking(true)} aria-label={t.trMarkets}>
          <TokenIcon symbol={tradeCoin(coin)} size={28} />
          <span><b dir="ltr">{coin}/USD</b><ChevronDown size={15} /></span>
        </button>
        <div style={{ textAlign: "end" }}>
          <div className="trade-px num">{m ? fmtPrice(m.price, "USD") : "…"}</div>
          <div className={"num " + ((m?.change ?? 0) >= 0 ? "up" : "down")} style={{ fontSize: 13 }}>{pct(m?.change ?? null)}</div>
        </div>
      </div>
      <div className="trade-stats">
        <div><span>{t.trHigh}</span><b className="num">{hi ? fmtPrice(hi.high, "USD") : "—"}</b></div>
        <div><span>{t.trLow}</span><b className="num">{hi ? fmtPrice(hi.low, "USD") : "—"}</b></div>
        <div><span>{t.trVol}</span><b className="num">{m?.vol != null ? fmtCompact(m.vol, "USD") : "—"}</b></div>
      </div>
      {err && !markets && <div className="note warn">{t.trErr}</div>}
      <div className="trade-bar">
        <div className="trade-tfs" role="tablist" aria-label={t.trTf}>
          {TFS.map((x) => <button key={x.id} role="tab" aria-selected={tf.id === x.id} className={tf.id === x.id ? "on" : ""} onClick={() => { setTf(x); save(TF_KEY, x.id); }}>{TF_LABEL[x.id]}</button>)}
        </div>
        <div className="trade-eng" role="tablist">
          {(["madar", "tv"] as const).map((e) => <button key={e} role="tab" aria-selected={engine === e} className={engine === e ? "on" : ""} onClick={() => { setEngine(e); save(ENGINE_KEY, e); }}>{e === "madar" ? t.trEngMadar : t.trEngTv}</button>)}
        </div>
      </div>
      {engine === "madar" ? <PriceChart coin={coin} tf={tf} /> : <TvChart coin={coin} tf={tf} />}
      {engine === "tv" && <div className="faint" style={{ fontSize: 11.5 }}>{t.trTvNote}</div>}
      <div className="between faint" style={{ fontSize: 11.5, gap: 8 }}>
        <span>{t.trRef}</span>
        <button className="linkbtn" onClick={() => void chrome.tabs.create({ url: "https://swap.madarwallet.app/#trade" })}>{t.trAdvanced}<ExternalLink size={12} /></button>
      </div>
      <div className="trade-side" role="tablist">
        <button role="tab" aria-selected={side === "buy"} className={side === "buy" ? "on buy" : ""} onClick={() => setSide("buy")}>{t.trBuy} {tradeCoin(coin)}</button>
        <button role="tab" aria-selected={side === "sell"} className={side === "sell" ? "on sell" : ""} onClick={() => setSide("sell")}>{t.trSell} {tradeCoin(coin)}</button>
      </div>
      <div className="chips" role="tablist" aria-label={t.lmLimitTab} style={{ margin: 0 }}>
        {(["market", "limit"] as const).map((k) => <button key={k} role="tab" aria-selected={kind === k} className={kind === k ? "on" : ""} onClick={() => setKind(k)}>{k === "market" ? t.lmMarketTab : t.lmLimitTab}</button>)}
      </div>
      {kind === "limit" ? <div className={"trade-order " + side}><Suspense fallback={<div className="faint" style={{ textAlign: "center", padding: 16 }}>…</div>}>
        <LimitOrder key={`${settings.accountIndex}:${coin}:${side}:${dollar}`} phrase={phrase} settings={settings} coin={tradeCoin(coin)} side={side} dollar={dollar} market={m?.price ?? null} />
      </Suspense></div> :
      <div className={"trade-order " + side}><Suspense fallback={<div className="faint" style={{ textAlign: "center", padding: 16 }}>…</div>}>
        <SwapView key={`${settings.accountIndex}:${coin}:${side}:${dollar}`} embedded pair={{ symbol: tradeCoin(coin), side, dollar }} onDollar={(d) => { setDollar(d); save(DOLLAR_KEY, d); }} phrase={phrase} settings={settings} update={update} go={go} />
      </Suspense></div>}
    </div>
  );
}

function MarketList({ list, cur, onPick, onClose }: { list: HlMarket[]; cur: string; onPick: (c: string) => void; onClose: () => void }) {
  const { t } = useT();
  const [q, setQ] = useState("");
  const shown = list.filter((m) => !q.trim() || m.coin.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className="page stack">
      <div className="between"><h1 style={{ margin: 0 }}>{t.trMarkets}</h1><button className="iconbtn" title={t.closeBtn} aria-label={t.closeBtn} onClick={onClose}><X size={18} /></button></div>
      <div className="row" style={{ gap: 8 }}><Search size={16} className="muted" /><input className="input" autoFocus placeholder={t.trSearch} value={q} onChange={(e) => setQ(e.target.value)} spellCheck={false} /></div>
      {shown.length === 0 ? <div className="empty">{list.length ? t.noMatch : "…"}</div> : (
        <div className="list">
          {shown.map((m) => (
            <button key={m.coin} className={"rowi" + (m.coin === cur ? " on" : "")} style={{ width: "100%", textAlign: "start" }} onClick={() => onPick(m.coin)}>
              <TokenIcon symbol={tradeCoin(m.coin)} size={30} />
              <span className="grow"><span className="t1" dir="ltr" style={{ display: "block", textAlign: "start" }}>{m.coin}/USD</span><span className="t2" style={{ display: "block" }}>{t.trVol} {m.vol != null ? fmtCompact(m.vol, "USD") : "—"}</span></span>
              <span className="end"><span className="t1 num" style={{ display: "block" }}>{fmtPrice(m.price, "USD")}</span><span className={"t2 num " + ((m.change ?? 0) >= 0 ? "up" : "down")} style={{ display: "block" }}>{pct(m.change)}</span></span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function PriceChart({ coin, tf }: { coin: string; tf: Tf }) {
  const { t } = useT();
  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const candles = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const vols = useRef<ISeriesApi<"Histogram"> | null>(null);
  const [state, setState] = useState<"load" | "ok" | "err">("load");

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const css = getComputedStyle(document.documentElement);
    const v = (n: string, d: string) => css.getPropertyValue(n).trim() || d;
    const up = v("--good", "#16c784"), down = v("--bad", "#ea3943");
    const c = createChart(el, {
      height: 300, autoSize: true,

      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: { time: true, price: false } },
      layout: { background: { color: "transparent" }, textColor: v("--faint", "#8a8f98"), fontSize: 10, attributionLogo: true },
      grid: { vertLines: { color: v("--line", "#2a2d33") }, horzLines: { color: v("--line", "#2a2d33") } },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.08, bottom: 0.2 } },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false, rightOffset: 3, barSpacing: 7, minBarSpacing: 2 },
      crosshair: { mode: 1 },
    });
    candles.current = c.addCandlestickSeries({ upColor: up, downColor: down, borderVisible: false, wickUpColor: up, wickDownColor: down });
    vols.current = c.addHistogramSeries({ priceScaleId: "", priceFormat: { type: "volume" } });
    c.priceScale("").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    chart.current = c;
    return () => { c.remove(); chart.current = null; candles.current = null; vols.current = null; };
  }, []);

  useEffect(() => {
    let live = true;
    const css = getComputedStyle(document.documentElement);
    const up = css.getPropertyValue("--good").trim() || "#16c784", down = css.getPropertyValue("--bad").trim() || "#ea3943";
    const put = (rows: Candle[], fit: boolean) => {
      if (!live || !candles.current || !vols.current) return;
      candles.current.setData(rows.map((x) => ({ time: (x.t / 1000) as UTCTimestamp, open: x.o, high: x.h, low: x.l, close: x.c })));
      vols.current.setData(rows.map((x) => ({ time: (x.t / 1000) as UTCTimestamp, value: x.v, color: (x.c >= x.o ? up : down) + "66" })));
      if (fit && rows.length) chart.current?.timeScale().setVisibleLogicalRange({ from: Math.max(0, rows.length - 70), to: rows.length + 3 });
    };
    setState("load");
    hlCandles(coin, tf, 300).then((rows) => { put(rows, true); if (live) setState(rows.length ? "ok" : "err"); }, () => live && setState("err"));
    const id = setInterval(() => {
      if (document.hidden) return;
      hlCandles(coin, tf, 300).then((rows) => rows.length && put(rows, false), () => {});
    }, 10_000);
    return () => { live = false; clearInterval(id); };
  }, [coin, tf]);

  return (
    <div className="trade-chart" dir="ltr">
      <div ref={box} style={{ width: "100%", height: 300 }} />
      {state !== "ok" && <div className="trade-chart-note">{state === "err" ? t.trErr : "…"}</div>}
    </div>
  );
}

const TV_INTERVAL: Record<string, string> = { "15m": "15", "1h": "60", "4h": "240", "1d": "D", "1w": "W" };
function TvChart({ coin, tf }: { coin: string; tf: Tf }) {
  const { lang } = useT();
  const dark = document.documentElement.dataset.theme !== "light";
  const q = new URLSearchParams({ frameElementId: "madar-tv", symbol: `BINANCE:${coin}USDT`, interval: TV_INTERVAL[tf.id] ?? "60", theme: dark ? "dark" : "light",
    style: "1", timezone: "Etc/UTC", locale: lang === "ar" ? "ar_AE" : "en", withdateranges: "1", hideideas: "1", saveimage: "0", symboledit: "0" });
  return (
    <div className="trade-chart tv" dir="ltr">
      <iframe key={coin + tf.id} title="TradingView" src={`https://s.tradingview.com/widgetembed/?${q}`} style={{ width: "100%", height: 380, border: 0, display: "block" }}
        sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer" />
    </div>
  );
}
