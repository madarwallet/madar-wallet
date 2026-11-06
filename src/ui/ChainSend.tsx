import { Check, ExternalLink, Globe, Info, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { KitEnd, KitQuote, KitSigned, SendKit } from "../core/sendkit";
import { canGoPast, feePct, feeShareHigh, xrpBlocked } from "../core/sendgates";
import { addActivity, clearPending, getPending, removeActivity, setPending, touch, type Settings } from "../core/store";
import { PctRow, short } from "./common";
import { fill, useT, type Dict } from "./i18n";
import { NetworkDot } from "./icons";
import { AlikeWarn, AmountNote, amountState, iso, SaveOffer, toAddrLabel, ToField, ToReview, useRecipient } from "./Send";

export interface KitTexts { toHint: keyof Dict; feeNote: keyof Dict; badAddress: keyof Dict }
type Track<S> = { s: S; at: number; end: KitEnd | null; mine: boolean };

export function ChainSend<Q extends KitQuote, S extends KitSigned>({ kit, texts, phrase, index, settings, done }: { kit: SendKit<Q, S>; texts: KitTexts; phrase: string; index: number; settings: Settings; done: () => void }) {
  const { t } = useT();
  const from = useMemo(() => kit.address(phrase, index), [kit, phrase, index]);
  const [to, setTo] = useState(""), [amount, setAmount] = useState(""), [memo, setMemo] = useState("");
  const rc = useRecipient(phrase, settings, index, kit.family, to, to.trim() || null);
  const [quote, setQuote] = useState<Q | null>(null);
  const [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const [track, setTrack] = useState<Track<S> | null | undefined>(undefined), [prevNote, setPrevNote] = useState("");
  const [overOk, setOverOk] = useState(false), [past, setPast] = useState<string | null>(null);
  const fmt = (u: bigint) => kit.format(u < 0n ? 0n : u);
  const amt = (u: bigint) => iso(`${fmt(u)} ${kit.symbol}`);
  const friendly = (e: unknown) => {
    const x = e as { message?: string; need?: bigint; max?: bigint; reserve?: bigint; fee?: bigint };
    const m = x?.message ?? String(e);
    if (m === "ERR_FUNDS" && x.max != null) return x.reserve ? fill(t.errKitKeep, { m: amt(x.max), r: amt(x.reserve) }) : fill(t.errKitFunds, { m: amt(x.max) });
    if (m === "ERR_KIT_MIN") return fill(t.errKitMin, { m: amt(x.need ?? 0n) });
    if (m === "ERR_FEE_HIGH") return fill(t.errKitFeeHigh, { n: kit.name });
    if (m === "ERR_KIT_SIM") return fill(t.errKitSim, { c: String((e as { code?: string }).code ?? "") });
    const map: Record<string, string> = {
      ERR_ADDRESS: t[texts.badAddress], ERR_KIT_INACTIVE: fill(t.errKitInactive, { n: kit.name }), ERR_KIT_COINS: fill(t.errKitCoins, { n: kit.name }),
      ERR_KIT_MEMO: t.errKitMemo, ERR_KIT_KEY: fill(t.errKitKey, { n: kit.name }), ERR_AMOUNT: t.errAmount, ERR_ZERO: t.errZero, ERR_FUNDS: t.errFunds, ERR_SELF: t.errSelf,
      ERR_UNSAFE: t.swapUnsafe, ERR_BUSY: t.busyWait, ERR_PROVIDER: t.errProvider, ERR_KIT_RUNTIME: fill(t.errKitRuntime, { n: kit.name }),
    };
    if (map[m]) return map[m];
    if (/fetch|network|HTTP|timeout|abort/i.test(m)) return t.errNet;
    return t.errGeneric;
  };
  async function settle(s: S, end: KitEnd): Promise<boolean> {
    if (end.state === "pending") return false;
    await clearPending(kit.id, s.from, s.hash);
    if (end.state === "dropped") await removeActivity(s.hash);
    return true;
  }
  async function follow(s: S, at: number, mine: boolean, maxMs: number) {
    setTrack({ s, at, end: null, mine });
    const end = await kit.wait(s, at, { maxMs }).catch((): KitEnd => ({ state: "pending" }));
    const fin = await settle(s, end).catch(() => false);
    if (!mine && fin) {
      setTrack(null);
      setPrevNote(end.state === "dropped" ? fill(t.kitPrevDropped, { a: amt(s.amount) }) : end.state === "failed" ? fill(t.errKitChain, { c: end.code }) : "");
      return;
    }
    setTrack({ s, at, end, mine });
  }
  useEffect(() => {
    let live = true;
    void (async () => {
      const p = await getPending(kit.id, from).catch(() => null);
      const s = kit.signedOf(p);
      if (!live) return;
      if (!s || !p || s.from !== from) { setTrack(null); return; }
      await follow(s, p.at, false, 0);
    })();
    return () => { live = false; };
  }, [from, kit]);
  async function review() {
    setBusy(true); setErr(""); void touch();
    try { setQuote(await kit.quote(phrase, index, to, amountState(amount).txt, kit.memo ? memo : undefined)); } catch (e) { setErr(friendly(e)); }
    setBusy(false);
  }
  async function confirm() {
    if (!quote || rc.blocked || busy || track) return;
    setBusy(true); setErr(""); void touch();
    const p = await getPending(kit.id, from).catch(() => null), open = kit.signedOf(p);
    if (open && p && xrpBlocked(open.hash, past)) { setQuote(null); setBusy(false); await follow(open, p.at, false, 0); return; }
    let s: S;
    try { s = await kit.sign(phrase, index, quote); } catch (e) { setErr(friendly(e)); setQuote(null); setBusy(false); return; }
    const at = Date.now();
    try {
      await setPending({ ...kit.pendingOf(s), at });
      await addActivity({ at, networkId: kit.id, kind: "send", asset: kit.symbol, amount: kit.format(s.amount), to: s.to, hash: s.hash, from: s.from });
    } catch { await clearPending(kit.id, s.from, s.hash).catch(() => {}); setErr(t.errGeneric); setBusy(false); return; }
    setTrack({ s, at, end: null, mine: true });
    const r = await kit.submit(s).catch(() => ({ state: "unknown" as const }));
    if (r.state === "refused") {
      await clearPending(kit.id, s.from, s.hash).catch(() => {}); await removeActivity(s.hash).catch(() => {});
      setTrack(null); setQuote(null); setErr(fill(t.errKitRefused, { c: r.code })); setBusy(false); return;
    }
    if (r.state === "ok" || r.state === "failed") {
      const end: KitEnd = r.state === "ok" ? { state: "ok" } : { state: "failed", code: r.code };
      await settle(s, end).catch(() => false);
      setTrack({ s, at, end, mine: true }); setBusy(false); return;
    }
    await follow(s, at, true, 30_000);
    setBusy(false);
  }
  async function again(resubmit: boolean) {
    if (!track || busy) return;
    setBusy(true); setPrevNote("");
    if (resubmit) await kit.submit(track.s).catch(() => null);
    await follow(track.s, track.at, track.mine, resubmit ? 20_000 : 0);
    setBusy(false);
  }
  const explorer = (h: string) => <a className="btn ghost block" href={kit.txUrl(h)} target="_blank" rel="noreferrer"><ExternalLink size={16} />{t.viewTx}</a>;
  if (track && track.mine) {
    const e = track.end;
    return (
      <div className="page stack">
        {!e && <div className="empty">{t.sending}</div>}
        {e?.state === "ok" && <div className="empty"><div className="ic" style={{ color: "var(--good)" }}><Check size={28} /></div>{t.sent}</div>}
        {e?.state === "failed" && <div className="err">{fill(t.errKitChain, { c: e.code })}</div>}
        {e?.state === "dropped" && <div className="err">{t.errKitDropped}</div>}
        {e?.state === "pending" && <div className="note info"><Globe size={16} /><span>{t.kitPendingNote}</span></div>}
        {e?.state !== "dropped" && explorer(track.s.hash)}
        {e?.state === "pending" && <button className="btn ghost block" disabled={busy} onClick={() => void again(false)}>{t.checkAgain}</button>}
        {e?.state === "ok" && <SaveOffer rc={rc} />}
        {e?.state === "dropped"
          ? <button className="btn primary block" onClick={() => { setTrack(null); setQuote(null); }}>{t.edit}</button>
          : e && <button className="btn primary block" onClick={done}>{t.toActivity}</button>}
      </div>
    );
  }
  if (track) {
    const e = track.end, canOver = canGoPast(track.at);
    return (
      <div className="page stack">
        <h1>{t.sendOn} {kit.name}</h1>
        <div className="sheet" style={{ gap: 8 }}>
          <b className="row" style={{ gap: 6 }}><TriangleAlert size={16} />{t.pendingTitle}</b>
          <span>{fill(t.kitPendingBlock, { a: amt(track.s.amount), to: iso(short(track.s.to)) })}</span>
          {explorer(track.s.hash)}
          <button className="btn ghost block" disabled={busy || !e} onClick={() => void again(false)}>{busy || !e ? t.pendingChecking : t.checkAgain}</button>
          <button className="btn ghost block" disabled={busy || !e} onClick={() => void again(true)}>{t.resubmitSame}</button>
          <span className="faint">{t.resubmitNote}</span>
          {canOver && e && <label className="check"><input type="checkbox" checked={overOk} onChange={(ev) => setOverOk(ev.target.checked)} />{t.pendingOverride}</label>}
          {canOver && e && <button className="btn ghost block" disabled={!overOk || busy} onClick={() => { setPast(track.s.hash); setTrack(null); setOverOk(false); }}>{t.pendingContinue}</button>}
        </div>
      </div>
    );
  }
  if (quote)
    return (
      <div className="page stack">
        <h1>{t.reviewTitle}</h1>
        <div className="list" style={{ padding: "4px 14px" }}>
          <div className="kv"><span>{t.amount}</span><b className="num" dir="ltr">{fmt(quote.amount)} {kit.symbol}</b></div>
          <ToReview rc={rc} />
          <div className="kv"><span>{toAddrLabel(t, rc)}</span><span className="mono" style={{ fontSize: 12, wordBreak: "break-all" }}>{quote.to}</span></div>
          {quote.memo && <div className="kv"><span>{t.kitMemo}</span><span className="mono" style={{ fontSize: 12, wordBreak: "break-all" }}>{quote.memo}</span></div>}
          <div className="kv"><span>{t.network}</span><span className="row" style={{ gap: 6 }}><NetworkDot id={kit.id} />{kit.name}</span></div>
          <div className="kv"><span>{t.kitFeeMax}</span><span className="num" dir="ltr">{fmt(quote.fee)} {kit.symbol}</span></div>
          {!!quote.reserve && <div className="kv"><span>{t.kitReserveRow}</span><span className="num" dir="ltr">{fmt(quote.reserve)} {kit.symbol}</span></div>}
          <div className="kv"><span>{t.total}</span><b className="num" dir="ltr">{fmt(quote.amount + quote.fee)} {kit.symbol}</b></div>
        </div>
        {quote.newAccount && <div className="note info"><Globe size={16} /><span>{t.kitNewAccount}</span></div>}
        {feeShareHigh(quote.fee, quote.amount) && <div className="note warn"><TriangleAlert size={16} /><span>{fill(t.feeShareWarn, { f: iso(`${fmt(quote.fee)} ${kit.symbol}`), p: feePct(quote.fee, quote.amount) })}</span></div>}
        <AlikeWarn rc={rc} />
        <div className="note warn"><TriangleAlert size={16} />{t.irreversible}</div>
        {err && <div className="err">{err}</div>}
        <button className="btn primary block" onClick={confirm} disabled={busy || rc.blocked}>{busy ? t.sending : t.confirmSend}</button>
        <button className="btn ghost block" onClick={() => setQuote(null)} disabled={busy}>{t.edit}</button>
      </div>
    );
  return (
    <div className="page stack">
      <h1>{t.sendOn} {kit.name}</h1>
      {prevNote && <div className="note soft"><Info size={15} /><span>{prevNote}</span></div>}
      <ToField rc={rc} to={to} setTo={setTo} label={t.recipient} placeholder={kit.placeholder} setAmount={setAmount} />
      <span className="faint">{t[texts.toHint]}</span>
      <AlikeWarn rc={rc} check />
      <label className="field">{t.amount} ({kit.symbol})<input className="input num" inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
      <AmountNote amount={amount} />
      <PctRow getMax={() => kit.spendable(phrase, index)} decimals={kit.decimals} onPick={setAmount} />
      {kit.memo && <label className="field">{t.kitMemo}<input className="input" maxLength={200} value={memo} onChange={(e) => setMemo(e.target.value)} placeholder={t.kitMemoPh} /></label>}
      {kit.memo && <span className="faint">{t.kitMemoHint}</span>}
      <div className="faint">{t[texts.feeNote]}</div>
      {track === undefined && <div className="faint">{t.pendingChecking}</div>}
      {err && <div className="err">{err}</div>}
      <button className="btn primary block" disabled={busy || track === undefined || !to.trim() || !amount || amountState(amount).bad || rc.blocked} onClick={review}>{busy ? t.calculating : t.review}</button>
    </div>
  );
}
