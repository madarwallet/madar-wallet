import { ArrowLeftRight, AtSign, ChevronDown, ExternalLink, Search, TrendingUp, TriangleAlert, Trophy } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { cgWait } from "../core/coingecko";
import { KNOWN_IDS, searchCoins, splitResults, topCoins, trendingCoins, type ExploreCoin } from "../core/explore";
import type { Loaded } from "../core/market";
import type { Settings } from "../core/store";
import { fmtPrice } from "./CoinPage";
import type { CoinView } from "./common";
import { fill, useT } from "./i18n";
import { TokenIcon } from "./icons";

const view = (c: ExploreCoin, cur: string, at: number): CoinView => ({
  symbol: c.symbol, name: c.name, verified: KNOWN_IDS.has(c.id), cg: c.id, parts: [], img: c.img ?? null,
  listed: c.price != null ? { cur, at, price: c.price, change: c.change24h, m: c.m ?? null } : undefined,
});
const openUrl = (url: string) => void chrome.tabs.create({ url });

export function Explore({ settings, open }: { settings: Settings; open: (c: CoinView) => void }) {
  const { t } = useT();
  const cur = settings.currency.toLowerCase();
  const [top, setTop] = useState<Loaded<ExploreCoin[]> | null>(null);
  const [trend, setTrend] = useState<Loaded<ExploreCoin[]> | null>(null);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<ExploreCoin[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let live = true;
    const later = (x: Loaded<ExploreCoin[]>) => { if (live && x.limited && !x.data && retry < 3) void cgWait().then((ms) => setTimeout(() => live && setRetry((n) => n + 1), ms + 800)); };
    void trendingCoins().then((x) => { if (live) { setTrend((o) => (x.data || !o?.data ? x : o)); later(x); } });
    void topCoins(cur).then((x) => { if (live) { setTop((o) => (x.data || !o?.data ? x : o)); later(x); } });
    return () => { live = false; };
  }, [cur, retry]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const s = q.trim();
    if (s.length < 2) { setFound(null); setSearching(false); return; }
    let live = true;
    setSearching(true);
    const id = setTimeout(() => {
      searchCoins(s).then((r) => { if (live) { setFound(r); setSearchFailed(false); setSearching(false); } }, () => { if (live) { setFound([]); setSearchFailed(true); setSearching(false); } });
    }, 600);
    return () => { live = false; clearTimeout(id); };
  }, [q]);

  const busy = (l: Loaded<ExploreCoin[]> | null) => !l || (!l.data && !l.limited);
  const SERVICES: [string, string, ReactNode, string][] = useMemo(() => [
    [t.exNames, t.exNamesText, <AtSign size={18} />, "https://madarwallet.app/names/"],
    [t.exSwapSite, t.exSwapSiteText, <ArrowLeftRight size={18} />, "https://swap.madarwallet.app/"],
  ], [t]);

  return (
    <div className="page stack explore">
      <h1><Search size={18} />{t.explore}</h1>
      <input className="input" placeholder={t.exSearch} value={q} onChange={(e) => setQ(e.target.value)} spellCheck={false} aria-label={t.exSearch} />
      {found != null || searching ? (
        <Section title={t.exResults} icon={<Search size={15} />}>
          {searching ? <Skel /> : found!.length === 0 ? <div className="empty">{searchFailed ? t.cBusy : t.noMatch}</div> : <Found list={found!} open={open} />}
        </Section>
      ) : (
        <>
          <Section title={t.exTrending} icon={<TrendingUp size={15} />}>
            {busy(trend) ? <Skel /> : trend!.data?.length ? <Rows list={trend!.data.slice(0, 10)} cur="usd" at={trend!.at} open={open} /> : <div className="empty">{t.cBusy}</div>}
          </Section>
          <Section title={t.exTop} icon={<Trophy size={15} />}>
            {busy(top) ? <Skel /> : top!.data?.length ? <Rows list={top!.data} cur={cur} at={top!.at} open={open} /> : <div className="empty">{t.cBusy}</div>}
          </Section>
        </>
      )}
      <Section title={t.exServices} icon={<ExternalLink size={15} />}>
        <div className="list">
          {SERVICES.map(([title, text, ic, url]) => (
            <button key={url} className="rowi" style={{ width: "100%", textAlign: "start" }} onClick={() => openUrl(url)}>
              <span className="ic-round">{ic}</span>
              <span className="grow"><span className="t1" style={{ display: "block" }}>{title}</span><span className="t2" style={{ display: "block" }}>{text}</span></span>
              <ExternalLink size={14} className="muted" />
            </button>
          ))}
        </div>
      </Section>
      <div className="faint" style={{ fontSize: 11 }}>{t.exSource}</div>
    </div>
  );
}

function Found({ list, open }: { list: ExploreCoin[]; open: (c: CoinView) => void }) {
  const { t } = useT();
  const { main, less } = useMemo(() => splitResults(list), [list]);
  const [more, setMore] = useState(false);
  useEffect(() => setMore(false), [list]);
  return (
    <>
      {main.length > 0 && <Rows list={main} cur="usd" at={Date.now()} open={open} />}
      {less.length > 0 && !more && <button className="btn ghost sm" style={{ marginTop: 8, width: "100%" }} onClick={() => setMore(true)}><ChevronDown size={14} />{fill(t.exLess, { n: String(less.length) })}</button>}
      {less.length > 0 && more && (
        <div style={{ marginTop: 10 }}>
          <div className="note warn" style={{ marginBottom: 8 }}><TriangleAlert size={16} />{t.exLessWarn}</div>
          <Rows list={less} cur="usd" at={Date.now()} open={open} />
        </div>
      )}
    </>
  );
}

function Section({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return <div className="group"><div className="gt row" style={{ gap: 6 }}>{icon}{title}</div>{children}</div>;
}
const Skel = () => <div className="list">{[0, 1, 2].map((i) => <div className="rowi" key={i}><div className="skel" style={{ width: 32, height: 32, borderRadius: "50%" }} /><div className="grow"><div className="skel" style={{ width: "45%" }} /></div></div>)}</div>;

function Rows({ list, cur, at, open }: { list: ExploreCoin[]; cur: string; at: number; open: (c: CoinView) => void }) {
  const { t } = useT();
  return (
    <div className="list">
      {list.map((c) => (
        <button key={c.id} className="rowi" style={{ width: "100%", textAlign: "start" }} onClick={() => open(view(c, cur, at))}>
          <TokenIcon symbol={c.symbol} size={32} img={c.img} known={KNOWN_IDS.has(c.id)} />
          <span className="grow" style={{ minWidth: 0 }}>
            <span className="t1 row" style={{ gap: 6 }}><bdi className="ellip">{c.name}</bdi>{KNOWN_IDS.has(c.id) && <span className="badge ok">{t.cVerifiedBadge}</span>}</span>
            <span className="t2" style={{ display: "block" }}>{c.symbol}{c.rank ? ` · #${c.rank}` : ""}</span>
          </span>
          {c.price != null && (
            <span className="end">
              <span className="t1 num" style={{ display: "block" }}>{fmtPrice(c.price, cur.toUpperCase())}</span>
              {c.change24h != null && <span className={"t2 num " + (c.change24h >= 0 ? "up" : "down")} style={{ display: "block" }}>{c.change24h >= 0 ? "▲" : "▼"} {Math.abs(c.change24h).toFixed(2)}%</span>}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
