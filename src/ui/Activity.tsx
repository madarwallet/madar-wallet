import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Clock } from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { evmAddress } from "../core/account";
import { BTC, btcAddress } from "../core/btcbase";
import { activeNetworks, networkById } from "../core/chains";
import { SOL, solAddress } from "../core/solbase";
import { TRON, tronAddress, tronTxUrl } from "../core/tronbase";
import { ADA_NET, DOGE_NET, EXTRA_COINS, extraById, LTC_NET, XRP_NET } from "../core/natives";
import { TON, tonAddress, tonTxUrl } from "../core/tonbase";
import { cachedHistory, filterByCoin, filterHistory, groupByDay, ownLocal, HISTORY_MAX, loadChainHistory, mergeHistory, pairSwaps, saveHistory, type HistFilter, type HistItem } from "../core/history";
import { fetchPrices, type Prices } from "../core/chainops";
import { addActivity, getActivity, type Settings } from "../core/store";
import { onBalancesChanged } from "../core/balbus";
import { pendingState, planReplace, replaceTx, type ReplaceMode, type ReplacePlan } from "../core/replace";
import { formatUnits } from "viem";
import { fill, useT } from "./i18n";
import { amt, money, RefreshBtn, short } from "./common";

export const histAmt = (s: string) => { const n = Number(s); return n > 0 && n < 0.0001 ? n.toLocaleString("en-US", { maximumSignificantDigits: 4 }) : amt(s); };
export const histNet = (id: string) => { const x = extraById(id); return x ? { name: x.name, explorer: x.explorer } : id === BTC.id ? { name: BTC.name, explorer: BTC.explorer } : id === SOL.id ? { name: SOL.name, explorer: SOL.explorer } : id === TRON.id ? { name: TRON.name, explorer: TRON.explorer } : id === TON.id ? { name: TON.name, explorer: TON.explorer } : networkById(id); };

export const txLink = (networkId: string, hash: string) => { const n = histNet(networkId), x = extraById(networkId); return !n ? undefined : x ? x.txUrl(hash) : networkId === TRON.id ? tronTxUrl(hash) : networkId === TON.id ? tonTxUrl(hash) : `${n.explorer}/tx/${hash}`; };

function SwapDetails({ x, mask }: { x: HistItem; mask: (s: string) => string }) {
  const { t } = useT();
  const paid = x.sent[0], got = x.got[0], p = x.pair!;
  const nPaid = Number(paid?.amount), nGot = Number(got?.amount);
  const dollar = (s?: string) => !!s && /^USD/.test(s);

  const price = nPaid > 0 && nGot > 0 ? (dollar(paid.symbol) && !dollar(got.symbol) ? { coin: got.symbol, per: nPaid / nGot, in: paid.symbol }
    : !dollar(paid.symbol) && dollar(got.symbol) ? { coin: paid.symbol, per: nGot / nPaid, in: got.symbol } : null) : null;
  const mins = p.inAt != null ? Math.max(0, Math.round((p.inAt - x.at) / 60_000)) : null;
  const kv = (k: string, v: React.ReactNode) => <div className="kv"><span>{k}</span><b>{v}</b></div>;
  const pay = txLink(x.networkId, x.hash), rec = p.inHash && p.inNetworkId ? txLink(p.inNetworkId, p.inHash) : undefined;
  return (
    <div className="swapd">
      {kv(t.pPaid, <bdi dir="ltr">{mask(`${histAmt(paid?.amount ?? "")} ${paid?.symbol ?? ""}`)} · {histNet(x.networkId)?.name}</bdi>)}
      {kv(t.pGot, got?.amount ? <bdi dir="ltr">{mask(`${histAmt(got.amount)} ${got.symbol}`)} · {histNet(x.toNetworkId ?? "")?.name}</bdi> : t.pWaiting)}
      {price && kv(t.pPrice, <bdi dir="ltr">{`1 ${price.coin} = ${price.per.toLocaleString("en-US", { maximumSignificantDigits: 5 })} ${price.in}`}</bdi>)}
      {price && <div className="faint" style={{ fontSize: 12, margin: "-2px 0 6px" }}>{t.pPriceNote}</div>}
      {mins != null && kv(t.pTime, mins < 1 ? t.pUnderMin : mins === 1 ? t.pMin1 : mins === 2 ? t.pMin2 : fill(mins <= 10 ? t.pMinsFew : t.pMins, { n: String(mins) }))}
      {p.refund && kv(t.pRefund, <bdi dir="ltr">{mask(`${histAmt(p.refund.amount)} ${p.refund.symbol}`)}</bdi>)}
      <div className="row" style={{ gap: 14, marginTop: 6, flexWrap: "wrap" }}>
        {pay && <a href={pay} target="_blank" rel="noreferrer">{t.pTxPay}</a>}
        {rec && <a href={rec} target="_blank" rel="noreferrer">{t.pTxGot}</a>}
      </div>
    </div>
  );
}

export function Activity({ phrase, settings, coin, embedded, netId }: { phrase: string; settings: Settings; coin?: { price?: string; symbol: string; netIds: string[] }; embedded?: boolean; netId?: string }) {
  const { t, lang } = useT();
  const idx = settings.accountIndex, cur = settings.currency;
  const addrs = useMemo(() => ({ evm: evmAddress(phrase, idx), sol: solAddress(phrase, idx), btc: btcAddress(phrase, idx), tron: tronAddress(phrase, idx),
    doge: DOGE_NET.address(phrase, idx), ltc: LTC_NET.address(phrase, idx), xrp: XRP_NET.address(phrase, idx), ton: tonAddress(phrase, idx), ada: ADA_NET.address(phrase, idx),

    extra: EXTRA_COINS.map((c) => c.address(phrase, idx)) }), [phrase, idx]);
  const [items, setItems] = useState<HistItem[] | null>(null);
  const [failed, setFailed] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<HistFilter>("all");
  const [prices, setPrices] = useState<Prices>({});
  const [open, setOpen] = useState<string | null>(null);
  const seq = useRef(0);
  const customKey = JSON.stringify([settings.customTokens, settings.networksOn ?? []]);
  const load = useCallback(async (force: boolean) => {
    const my = ++seq.current;
    const records = await getActivity();
    const own = (chain: HistItem[]) => ownLocal(records, addrs, chain, settings.customTokens);
    const cached = await cachedHistory(addrs.evm).catch(() => null);
    if (my !== seq.current) return;

    const joined = (list: HistItem[]) => pairSwaps(list, records, settings.customTokens);
    setItems(joined(mergeHistory(cached?.items ?? [], own(cached?.items ?? []))));
    if (!force && cached && Date.now() - cached.at < 60_000) { setBusy(false); return; }
    setBusy(true);
    try {
      const r = await loadChainHistory(addrs, settings.customTokens, activeNetworks(settings));
      const chain = mergeHistory(r.items, cached?.items ?? [], HISTORY_MAX * 2);
      await saveHistory(addrs.evm, chain);
      if (my !== seq.current) return;
      setItems(joined(mergeHistory(chain, own(chain)))); setFailed(r.failed);
    } catch { if (my === seq.current) setFailed([t.allNetworks]); }
    if (my === seq.current) setBusy(false);
  }, [addrs, customKey]);
  useEffect(() => { setItems(null); setFailed([]); void load(false); }, [load]);

  useEffect(() => onBalancesChanged(() => void load(false)), [load]);
  useEffect(() => {
    if (!items?.length) return;
    const keys = [...new Set(items.flatMap((x) => [...x.sent, ...x.got]).map((l) => l.price ?? ""))].filter(Boolean);
    const custom = keys.filter((k) => k.includes(":")).map((k) => ({ platform: k.slice(0, k.indexOf(":")), address: k.slice(k.indexOf(":") + 1) }));
    void fetchPrices(keys.filter((k) => !k.includes(":")), cur.toLowerCase() as "usd" | "sar", custom).then(setPrices).catch(() => {});
  }, [items, cur]);

  const locale = lang === "ar" ? "ar-SA-u-nu-latn" : "en-US";
  const hide = settings.hideBalances, mask = (s: string) => (hide ? "••••" : s);
  const dayTitle = (d: string) => (d === "today" ? t.today : d === "yesterday" ? t.yesterday : new Date(`${d}T00:00`).toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" }));
  const coinKey = coin ? JSON.stringify(coin) : "";
  const mine = useMemo(() => (items && coin ? filterByCoin(items, coin) : items && netId ? items.filter((x) => x.networkId === netId || x.toNetworkId === netId) : items), [items, coinKey, netId]); // eslint-disable-line react-hooks/exhaustive-deps
  const list = mine ? filterHistory(mine, filter) : null;
  const FILTERS: [HistFilter, string][] = [["all", t.fAll], ["in", t.fIn], ["out", t.fOut], ["swap", t.fSwap]];
  const row = (x: HistItem) => {
    const n = histNet(x.networkId);
    const main = x.kind === "in" || (x.kind === "swap" && x.got[0]?.amount) ? x.got[0] : x.sent[0];
    const plus = !!main && main === x.got[0];
    const p = main?.price ? prices[main.price] : undefined;
    const value = main && p ? Number(main.amount) * p.price : null;
    const paired = x.kind === "swap" && !!x.pair;
    const dollar = (s?: string) => !!s && /^USD/.test(s);
    const title = paired && dollar(x.sent[0]?.symbol) && !dollar(x.got[0]?.symbol) ? fill(t.hBuy, { c: x.got[0]?.symbol ?? "" })
      : paired && !dollar(x.sent[0]?.symbol) && dollar(x.got[0]?.symbol) ? fill(t.hSell, { c: x.sent[0]?.symbol ?? "" })
      : x.kind === "in" ? t.hIn : x.kind === "swap" ? t.hSwap : t.hOut;
    const sub = paired ? null
      : x.kind === "swap" ? <span dir="ltr">{x.sent[0]?.symbol} → {x.got[0]?.symbol}</span>
      : x.kind === "self" ? t.hSelf
      : x.party ? <>{fill(x.kind === "in" ? t.hFrom : t.hTo, { p: "" })}<span className="mono">{short(x.party)}</span></> : null;

    const maybePending = !!x.local && x.kind !== "in" && !!networkById(x.networkId) && Date.now() - x.at < 3 * 86_400_000;
    const inner = (
      <>
        <div className={"hic" + (x.kind === "in" ? " in" : x.kind === "swap" ? "" : " out")}>{x.kind === "in" ? <ArrowDownLeft size={18} /> : x.kind === "swap" ? <ArrowLeftRight size={18} /> : <ArrowUpRight size={18} />}</div>
        <div className="grow">
          <div className="t1">{title}</div>
          <div className="t2">{sub && <><bdi>{sub}</bdi> · </>}<bdi dir="ltr">{n?.name}{x.toNetworkId && <> → {histNet(x.toNetworkId)?.name}</>}</bdi> · <bdi>{new Date(x.at).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}</bdi></div>
        </div>
        {main && (
          <div className="end">
            <div className={"t1 num " + (plus ? "up" : "down")}>{mask(`${plus ? "+" : "−"}${histAmt(main.amount)} ${main.symbol}`)}</div>
            {paired && plus && x.sent[0]?.amount ? <div className="t2 num down">{mask(`−${histAmt(x.sent[0].amount)} ${x.sent[0].symbol}`)}</div>
              : value != null && <div className="t2 num">{mask(money(value, cur))}</div>}
          </div>
        )}
      </>
    );
    return (
      <Fragment key={x.id}>
      {paired
        ? <button type="button" className="rowi rowb" aria-expanded={open === x.id} onClick={() => setOpen(open === x.id ? null : x.id)}>{inner}</button>
        : <a className="rowi" href={txLink(x.networkId, x.hash)} target="_blank" rel="noreferrer">{inner}</a>}
      {paired && open === x.id && <SwapDetails x={x} mask={mask} />}
      {maybePending && <PendingTx x={x} phrase={phrase} index={idx} />}
      </Fragment>
    );
  };
  return (
    <div className={coin || embedded ? undefined : "page"}>
      {!coin && !embedded && <div className="between"><h1>{t.activity}</h1><RefreshBtn onClick={() => load(true)} /></div>}
      {!coin && (
        <div className={embedded ? "between hist-bar" : undefined}>
          <div className="chips">{FILTERS.map(([k, label]) => <button key={k} className={filter === k ? "on" : ""} onClick={() => setFilter(k)}>{label}</button>)}</div>
          {embedded && <RefreshBtn onClick={() => load(true)} />}
        </div>
      )}
      {!list && (
        <div className="list">{[0, 1, 2].map((i) => <div className="rowi" key={i}><div className="hic" /><div className="grow stack" style={{ gap: 6 }}><div className="skel" style={{ width: "40%" }} /><div className="skel" style={{ width: "25%" }} /></div></div>)}</div>
      )}
      {list && list.length === 0 && (busy ? <div className="faint" style={{ textAlign: "center", padding: 24 }}>{t.hLoading}</div> : <div className="empty"><div className="ic"><Clock size={26} /></div>{coin ? t.cNoActivity : t.hEmpty}</div>)}
      {list && groupByDay(list).map((g) => (
        <Fragment key={g.day}>
          <div className="dayh">{dayTitle(g.day)}</div>
          <div className="list">{g.items.map(row)}</div>
        </Fragment>
      ))}
      {busy && !!list?.length && <div className="faint" style={{ textAlign: "center", marginTop: 10 }}>{t.hLoading}</div>}
      {!busy && failed.length > 0 && <div className="faint" style={{ marginTop: 10 }}>{fill(t.hPartial, { list: failed.join("، ") })}</div>}
      {items && !coin && <div className="faint" style={{ marginTop: 10 }}>{t.hRecentNote}</div>}
    </div>
  );
}

function PendingTx({ x, phrase, index }: { x: HistItem; phrase: string; index: number }) {
  const { t } = useT();
  const n = networkById(x.networkId);
  const me = evmAddress(phrase, index);
  const [on, setOn] = useState(false);
  const [plan, setPlan] = useState<ReplacePlan | null>(null);
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState("");
  useEffect(() => {
    let live = true;
    if (n) void pendingState(n, x.hash, me).then((st) => { if (live) setOn(st.state === "pending"); }, () => {});
    return () => { live = false; };
  }, [x.hash, me]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!n || (!on && !msg)) return null;
  const why = (e: unknown) => { const m = (e as Error)?.message ?? ""; return m === "ERR_TX_DONE" ? t.txDone : m === "ERR_FEE_HIGH" ? t.errFeeHigh : m === "ERR_SIM_FAIL" ? t.sendWouldFail : /insufficient funds/i.test(m) ? fill(t.needGas, { sym: n.native.symbol }) : t.txUnknown; };
  const ask = async (mode: ReplaceMode) => {
    setBusy(true); setMsg("");
    try { setPlan(await planReplace(n, phrase, index, x.hash, mode)); } catch (e) { setMsg(why(e)); if ((e as Error)?.message === "ERR_TX_DONE") setOn(false); }
    setBusy(false);
  };
  const go = async () => {
    if (!plan) return;
    setBusy(true); setMsg("");
    try {
      const h = await replaceTx(n, phrase, index, x.hash, plan);
      const cancel = plan.mode === "cancel", leg = x.sent[0];
      await addActivity({ at: Date.now(), networkId: n.id, kind: "send", asset: cancel ? n.native.symbol : leg?.symbol ?? n.native.symbol, amount: cancel ? "0" : leg?.amount ?? "0", to: cancel ? me : x.party ?? me, hash: h, from: me });
      setMsg(cancel ? t.txCancelSent : t.txSpeedSent); setPlan(null); setOn(false);
    } catch (e) { setMsg(why(e)); }
    setBusy(false);
  };
  return (
    <div className="pend">
      {on && !plan && (
        <div className="between">
          <span className="row" style={{ gap: 6 }}><Clock size={14} />{t.txPending}</span>
          <span className="row" style={{ gap: 6 }}>
            <button className="btn ghost sm" disabled={busy} onClick={() => void ask("speed")}>{t.txSpeedUp}</button>
            <button className="btn ghost sm" disabled={busy} onClick={() => void ask("cancel")}>{t.txCancel}</button>
          </span>
        </div>
      )}
      {plan && (
        <div className="stack" style={{ gap: 8 }}>
          <div>{fill(plan.mode === "speed" ? t.txSpeedAsk : t.txCancelAsk, { f: amt(formatUnits(plan.maxCost, n.chain.nativeCurrency.decimals)), sym: n.native.symbol })}</div>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn ghost" style={{ flex: 1 }} disabled={busy} onClick={() => setPlan(null)}>{t.back}</button>
            <button className="btn primary" style={{ flex: 1 }} disabled={busy} onClick={() => void go()}>{busy ? t.sending : plan.mode === "speed" ? t.txSpeedUp : t.txCancel}</button>
          </div>
        </div>
      )}
      {msg && <div className="faint" style={{ fontSize: 12 }}>{msg}</div>}
    </div>
  );
}
