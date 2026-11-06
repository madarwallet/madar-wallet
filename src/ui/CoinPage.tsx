import { ArrowDownLeft, ArrowLeft, ArrowLeftRight, ArrowUpRight, BadgeCheck, Copy, CreditCard, Info, ShieldCheck, TriangleAlert } from "lucide-react";
import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { cachedPrices } from "../core/chainops";
import { cgWait } from "../core/coingecko";
import { coinName } from "../core/coins";
import { coinChart, coinMarket, coinRef, MARKET_TTL, RANGES, savedChart, savedMarket, type ChartData, type Loaded, type Market, type Point, type Range } from "../core/market";
import type { Settings } from "../core/store";
import { Activity } from "./Activity";
import { amt, money, type CoinView } from "./common";
import { fill, useT, type Dict } from "./i18n";
import { NetworkDot, TokenIcon } from "./icons";

type Act = "send" | "receive" | "swap" | "buy";
const CONTRACT_RE = /^(0x[0-9a-fA-F]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$/;

export function fmtPrice(n: number | null | undefined, cur: string): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const o: Intl.NumberFormatOptions = n >= 1 ? { maximumFractionDigits: 2, minimumFractionDigits: 2 } : n >= 0.01 ? { maximumFractionDigits: 4 } : { maximumSignificantDigits: 4 };
  return new Intl.NumberFormat("en-US", { style: "currency", currency: cur, ...o }).format(n);
}

export function fmtCompact(n: number | null | undefined, cur?: string): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2, ...(cur ? { style: "currency", currency: cur } : {}) }).format(n);
}
const pct = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? "—" : `${n >= 0 ? "▲" : "▼"} ${Math.abs(n).toFixed(2)}%`);

export function CoinPage({ coin, phrase, settings, back, act, copy }: { coin: CoinView; phrase: string; settings: Settings; back: () => void; act: (x: Act) => void; copy: (s: string) => void }) {
  const { t, lang } = useT();
  const cur = settings.currency, curL = cur.toLowerCase();
  const ref = useMemo(() => coinRef(coin.cg), [coin.cg]);

  const listed = coin.listed && coin.listed.cur === curL && coin.listed.price != null ? coin.listed : null;
  const [saved, setSaved] = useState<{ price: number; change: number | null } | null>(listed ? { price: listed.price!, change: listed.change } : null);
  const [mkt, setMkt] = useState<Loaded<Market> | null>(listed?.m ? { data: listed.m, at: listed.at, stale: false, limited: false } : null);
  const [range, setRange] = useState<Range>("1D");
  const [charts, setCharts] = useState<Partial<Record<Range, Loaded<ChartData>>>>({});
  const [chartBusy, setChartBusy] = useState(false);

  const [retry, setRetry] = useState(0);
  const later = (l: Loaded<unknown>) => {
    if (!l.limited || l.data || retry >= 3) return;
    void cgWait().then((ms) => setTimeout(() => setRetry((n) => n + 1), ms + 800));
  };

  useEffect(() => {
    let live = true;
    if (coin.cg) void cachedPrices(curL as "usd" | "sar").then((p) => { if (live && coin.cg && p[coin.cg]) setSaved((s) => s ?? p[coin.cg!]); });

    if (ref && !(listed?.m && retry === 0 && Date.now() - listed.at < MARKET_TTL)) {
      void savedMarket(ref, curL).then((m) => { if (live && m) setMkt((x) => x ?? { data: m, at: 0, stale: false, limited: false }); });
      void coinMarket(ref, curL).then((m) => { if (live) { setMkt((x) => (m.data || !x?.data ? m : { ...x, stale: true, limited: m.limited })); later(m); } });
    }
    return () => { live = false; };
  }, [ref, curL, retry]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!ref || charts[range]?.data) return;
    let live = true;
    setChartBusy(true);
    void savedChart(ref, curL, range).then((c) => { if (live && c) setCharts((x) => (x[range] ? x : { ...x, [range]: { data: c, at: 0, stale: false, limited: false } })); });
    void coinChart(ref, curL, range).then((c) => { if (live) { setCharts((x) => ({ ...x, [range]: c.data || !x[range]?.data ? c : x[range] })); setChartBusy(false); later(c); } });
    return () => { live = false; };
  }, [ref, curL, range, retry]); // eslint-disable-line react-hooks/exhaustive-deps

  const m = mkt?.data ?? null;
  const price = m?.price ?? saved?.price ?? null;
  const change = m?.change24h ?? saved?.change ?? null;
  const ch = charts[range];
  const pts = ch?.data?.pts ?? null;
  const up = pts && pts.length > 1 ? pts[pts.length - 1][1] >= pts[0][1] : (change ?? 0) >= 0;
  const total = coin.parts.reduce((s, p) => s + p.amount, 0);
  const hide = settings.hideBalances, mask = (s: string) => (hide ? "••••" : s);
  const locale = lang === "ar" ? "ar-SA-u-nu-latn-ca-gregory" : "en-US";
  const day = (ms: number | null) => (ms == null ? "" : new Date(ms).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" }));
  const staleNote = mkt && (mkt.stale || mkt.limited) ? (mkt.data ? fill(t.cStale, { t: new Date(mkt.at).toLocaleString(locale, { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" }) }) : t.cBusy) : null;
  const RANGE_LABEL: Record<Range, string> = { "1D": t.cR1D, "1W": t.cR1W, "1M": t.cR1M, "3M": t.cR3M, "1Y": t.cR1Y, ALL: t.cRALL };
  const ACTS: [Act, string, ReactNode][] = [["send", t.send, <ArrowUpRight size={20} />], ["receive", t.receive, <ArrowDownLeft size={20} />], ["swap", t.swap, <ArrowLeftRight size={20} />], ["buy", t.buy, <CreditCard size={20} />]];
  const name = coinName(coin.symbol, coin.name, coin.verified);

  return (
    <div className="page coin">
      <div className="coinhead">
        <button className="iconbtn backbtn" onClick={back} title={t.back} aria-label={t.back}><ArrowLeft size={18} /></button>
        <TokenIcon symbol={coin.symbol} size={36} img={coin.img} known={coin.img === undefined || coin.verified} />
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            <b className="ct">{name}</b>
            {coin.verified ? <span className="badge ok row" style={{ gap: 3 }}><BadgeCheck size={11} />{t.cVerifiedBadge}</span> : <span className="badge warn">{t.unverified}</span>}
          </div>
          <div className="faint">{coin.symbol}</div>
        </div>
      </div>

      <div className="coinprice num">{fmtPrice(price, cur)}</div>
      <div className="faint">
        <span className={"num " + ((change ?? 0) >= 0 ? "up" : "down")}>{pct(change)}</span> {t.cChange24}
      </div>

      <div className="chartbox">
        {pts && pts.length > 1 ? <PriceChart pts={pts} up={up} cur={cur} locale={locale} range={range} label={t.cChartLabel} />
          : chartBusy || (!ch && ref) ? <div className="skel" style={{ height: "100%" }} /> : <div className="empty chart-empty">{ch?.limited ? t.cBusy : t.cNoChart}</div>}
      </div>
      {ref && (
        <div className="ranges" role="tablist" aria-label={t.cChartLabel}>
          {RANGES.map((r) => <button key={r} role="tab" aria-selected={range === r} className={range === r ? "on" : ""} onClick={() => setRange(r)}>{RANGE_LABEL[r]}</button>)}
        </div>
      )}
      {range === "ALL" && ch?.data?.capped && <div className="faint" style={{ marginTop: -8, marginBottom: 10 }}>{t.cCapped}</div>}

      <div className="actions" style={{ marginTop: 4 }}>
        {ACTS.map(([x, label, ic]) => <button key={x} className="action" onClick={() => act(x)}><span className="ic">{ic}</span>{label}</button>)}
      </div>

      <div className="group">
        <div className="gt">{t.cYourBalance}</div>
        <div className="list">
          <div className="rowi">
            <TokenIcon symbol={coin.symbol} size={30} img={coin.img} known={coin.img === undefined || coin.verified} />
            <div className="grow"><div className="t1">{name}</div><div className="t2">{coin.parts.length > 1 ? fill(t.onNNetworks, { n: String(coin.parts.length) }) : coin.parts[0]?.networkName}</div></div>
            <div className="end"><div className="t1 num">{mask(money(price == null ? (total === 0 ? 0 : null) : total * price, cur))}</div><div className="t2 num">{mask(`${amt(String(total), coin.symbol)} ${coin.symbol}`)}</div></div>
          </div>
          {coin.parts.length > 1 && coin.parts.map((p) => (
            <div className="rowi sub" key={p.networkId + p.key}>
              <NetworkDot id={p.networkId} size={20} />
              <div className="grow"><div className="t2" style={{ color: "var(--text)" }}>{p.networkName}</div></div>
              <div className="end"><div className="t2 num">{mask(`${amt(String(p.amount), coin.symbol)} ${coin.symbol}`)} · {mask(money(price == null ? null : p.amount * price, cur))}</div></div>
            </div>
          ))}
        </div>
      </div>

      <div className="group">
        <div className="gt">{t.cSecurity}</div>
        {coin.verified
          ? <div className="note ok"><ShieldCheck size={16} /><span>{t.cVerifiedLine}</span></div>
          : <div className="note warn"><TriangleAlert size={16} /><span>{coin.parts.length ? t.cUnverifiedLine : t.cUnverifiedExplore}</span></div>}
      </div>

      <div className="group">
        <div className="gt">{t.cDetails}</div>
        <div className="list" style={{ padding: "2px 14px" }}>
          {coin.parts.map((p) => (
            <div key={p.networkId + p.key} className="kvblock">
              <div className="kv"><span>{t.network}</span><span className="row" style={{ gap: 6 }}><NetworkDot id={p.networkId} size={16} />{p.networkName}</span></div>
              <div className="kv"><span>{t.cContract}</span>{p.contract && CONTRACT_RE.test(p.contract)
                ? <span className="row" style={{ gap: 4, minWidth: 0 }}><bdi dir="ltr" className="mono" style={{ fontSize: 12 }}>{`${p.contract.slice(0, 6)}…${p.contract.slice(-4)}`}</bdi>
                  <button className="iconbtn sm" title={t.cCopyContract} aria-label={t.cCopyContract} onClick={() => copy(p.contract!)}><Copy size={14} /></button></span>
                : <span>{t.cNative}</span>}</div>
              <div className="kv"><span>{t.cDecimals}</span><span className="num">{p.decimals}</span></div>
            </div>
          ))}
        </div>
      </div>

      {ref && (
        <div className="group">
          <div className="gt">{t.cMarket}</div>
          {m ? <MarketList m={m} cur={cur} symbol={coin.symbol} day={day} t={t} /> : mkt ? <div className="empty" style={{ padding: 16 }}>{mkt.limited ? t.cBusy : t.cNoMarket}</div> : <div className="list" style={{ padding: 14 }}><div className="skel" style={{ width: "70%" }} /><div className="skel" style={{ width: "50%", marginTop: 10 }} /></div>}
          {staleNote && m && <div className="note soft" style={{ marginTop: 8 }}><Info size={15} /><span>{staleNote}</span></div>}
          <div className="faint" style={{ marginTop: 6, fontSize: 12 }}>{t.cSource}</div>
        </div>
      )}

      <div className="group">
        <div className="gt">{t.cActivity}</div>
        <Activity phrase={phrase} settings={settings} coin={{ price: coin.cg, symbol: coin.symbol, netIds: coin.parts.map((p) => p.networkId) }} />
      </div>
    </div>
  );
}

function MarketList({ m, cur, symbol, day, t }: { m: Market; cur: string; symbol: string; day: (ms: number | null) => string; t: Dict }) {
  const ratio = m.volume24h != null && m.marketCap ? (m.volume24h / m.marketCap) * 100 : null;
  const rows: [string, ReactNode][] = [
    [t.cMarketCap, <span className="num">{fmtCompact(m.marketCap, cur)}</span>],
    [t.cVolume, <span className="num">{fmtCompact(m.volume24h, cur)}</span>],
    [t.cVolCap, <span className="num">{ratio == null ? "—" : `${ratio.toFixed(2)}%`}</span>],
    [t.cSupply, <span className="num">{m.circulating == null ? "—" : `${fmtCompact(m.circulating)} ${symbol}`}</span>],
    [t.cAth, <span className="stackr"><span className="num">{fmtPrice(m.ath, cur)}</span>{m.athDate != null && <span className="faint">{day(m.athDate)}</span>}</span>],
    [t.cAtl, <span className="stackr"><span className="num">{fmtPrice(m.atl, cur)}</span>{m.atlDate != null && <span className="faint">{day(m.atlDate)}</span>}</span>],
  ];
  return <div className="list" style={{ padding: "2px 14px" }}>{rows.map(([k, v]) => <div className="kv" key={k}><span>{k}</span>{v}</div>)}</div>;
}

function PriceChart({ pts, up, cur, locale, range, label }: { pts: Point[]; up: boolean; cur: string; locale: string; range: Range; label: string }) {
  const W = 320, H = 150, PAD = 6;
  const gid = useId().replace(/:/g, "");
  const [hover, setHover] = useState<number | null>(null);
  const geo = useMemo(() => {
    const t0 = pts[0][0], t1 = pts[pts.length - 1][0];
    let lo = Infinity, hi = -Infinity;
    for (const [, p] of pts) { if (p < lo) lo = p; if (p > hi) hi = p; }
    const span = hi - lo || hi || 1;
    const xy = pts.map(([t, p]) => [((t - t0) / (t1 - t0 || 1)) * W, H - PAD - ((p - lo) / span) * (H - 2 * PAD)] as [number, number]);
    const line = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join("");
    return { xy, line, area: `${line}L${W} ${H}L0 ${H}Z` };
  }, [pts]);
  const color = up ? "var(--good)" : "var(--bad)";
  const pick = (clientX: number, el: SVGSVGElement) => {
    const r = el.getBoundingClientRect();
    const x = ((clientX - r.left) / r.width) * W;
    let best = 0;
    for (let i = 1; i < geo.xy.length; i++) if (Math.abs(geo.xy[i][0] - x) < Math.abs(geo.xy[best][0] - x)) best = i;
    setHover(best);
  };
  const h = hover != null ? pts[hover] : null;
  const when = (ms: number) => new Date(ms).toLocaleString(locale, range === "1D" ? { hour: "2-digit", minute: "2-digit" } : { day: "numeric", month: "short", year: range === "1Y" || range === "ALL" ? "numeric" : undefined });
  return (
    <>
      {h && <div className="charttip"><span className="num">{fmtPrice(h[1], cur)}</span> · <bdi>{when(h[0])}</bdi></div>}
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label} data-chart-ready=""
        onPointerMove={(e) => pick(e.clientX, e.currentTarget)} onPointerDown={(e) => pick(e.clientX, e.currentTarget)} onPointerLeave={() => setHover(null)}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity=".22" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={geo.area} fill={`url(#${gid})`} />
        <path d={geo.line} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
        {hover != null && <line x1={geo.xy[hover][0]} x2={geo.xy[hover][0]} y1="0" y2={H} stroke="var(--line-2)" strokeWidth="1" vectorEffect="non-scaling-stroke" />}
      </svg>
    </>
  );
}
