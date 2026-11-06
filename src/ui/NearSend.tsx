import { Check, ExternalLink, Globe, Info, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  formatNear, NEAR, nearAddress, nearPendingOf, nearSignedOf, nearSpendable, nearTxUrl, quoteNearSend, signNearSend, submitNear, waitNear,
  type NearEnd, type NearQuote, type NearSigned,
} from "../core/near";
import { canGoPast, feePct, feeShareHigh, xrpBlocked } from "../core/sendgates";
import { addActivity, clearPending, getPending, removeActivity, setPending, touch, type Settings } from "../core/store";
import { PctRow, short } from "./common";
import { fill, useT } from "./i18n";
import { NetworkDot } from "./icons";
import { AlikeWarn, AmountNote, amountState, iso, SaveOffer, toAddrLabel, ToField, ToReview, useRecipient } from "./Send";

type NearTrack = { s: NearSigned; at: number; end: NearEnd | null; mine: boolean };

export function NearSend({ phrase, index, settings, done }: { phrase: string; index: number; settings: Settings; done: () => void }) {
  const { t } = useT();
  const from = useMemo(() => nearAddress(phrase, index), [phrase, index]);
  const [to, setTo] = useState(""), [amount, setAmount] = useState("");
  const rc = useRecipient(phrase, settings, index, "near", to, to.trim() || null);
  const [quote, setQuote] = useState<NearQuote | null>(null);
  const [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const [track, setTrack] = useState<NearTrack | null | undefined>(undefined), [prevNote, setPrevNote] = useState("");
  const [overOk, setOverOk] = useState(false), [past, setPast] = useState<string | null>(null);
  const near = (y: bigint) => formatNear(y < 0n ? 0n : y);
  const friendly = (e: unknown) => {
    const x = e as { message?: string; need?: bigint; max?: bigint; reserve?: bigint };
    const m = x?.message ?? String(e);
    if (m === "ERR_NEAR_MIN") return fill(t.errNearMin, { m: iso(near(x.need ?? 0n)) });
    if (m === "ERR_FUNDS" && x.reserve != null) return fill(t.errNearFunds, { m: iso(near(x.max ?? 0n)), r: iso(near(x.reserve)) });
    const map: Record<string, string> = {
      ERR_ADDRESS: t.errNearAddress, ERR_NEAR_ETH: t.errNearEth, ERR_NEAR_CASE: t.errNearCase, ERR_NO_ACCOUNT: t.errNearNoAccount, ERR_NEAR_INACTIVE: t.errNearInactive,
      ERR_NEAR_KEY: t.errNearKey, ERR_FEE_HIGH: t.errNearFeeHigh, ERR_AMOUNT: t.errAmount, ERR_ZERO: t.errZero, ERR_FUNDS: t.errFunds, ERR_SELF: t.errSelf,
      ERR_UNSAFE: t.swapUnsafe, ERR_BUSY: t.busyWait, ERR_NEAR: t.errProvider,
    };
    if (map[m]) return map[m];
    if (/fetch|network|HTTP|timeout|abort|TIMEOUT|INTERNAL|SYNC/i.test(m)) return t.errNet;
    return t.errGeneric;
  };

  async function settle(s: NearSigned, end: NearEnd): Promise<boolean> {
    if (end.state === "pending") return false;
    await clearPending(NEAR.id, s.from, s.hash);
    if (end.state === "dropped") await removeActivity(s.hash);
    return true;
  }

  async function follow(s: NearSigned, at: number, mine: boolean, maxMs: number) {
    setTrack({ s, at, end: null, mine });
    const end = await waitNear(s, at, { maxMs });
    const fin = await settle(s, end).catch(() => false);
    if (!mine && fin) {
      setTrack(null);
      setPrevNote(end.state === "dropped" ? fill(t.nearPrevDropped, { a: iso(formatNear(s.amount)) }) : end.state === "failed" ? fill(t.errNearChain, { c: end.code }) : "");
      return;
    }
    setTrack({ s, at, end, mine });
  }
  useEffect(() => {
    let live = true;
    void (async () => {
      const p = await getPending(NEAR.id, from).catch(() => null);
      const s = nearSignedOf(p);
      if (!live) return;
      if (!s || !p || s.from !== from) { setTrack(null); return; }
      await follow(s, p.at, false, 0);
    })();
    return () => { live = false; };
  }, [from]);
  async function review() {
    setBusy(true); setErr(""); void touch();
    try { setQuote(await quoteNearSend(phrase, index, to, amountState(amount).txt)); } catch (e) { setErr(friendly(e)); }
    setBusy(false);
  }
  async function confirm() {
    if (!quote || rc.blocked || busy || track) return;
    setBusy(true); setErr(""); void touch();

    const p = await getPending(NEAR.id, from).catch(() => null), open = nearSignedOf(p);
    if (open && p && xrpBlocked(open.hash, past)) { setQuote(null); setBusy(false); await follow(open, p.at, false, 0); return; }
    let s: NearSigned;
    try { s = await signNearSend(phrase, index, quote); } catch (e) { setErr(friendly(e)); setQuote(null); setBusy(false); return; }

    const at = Date.now();
    try {
      await setPending({ ...nearPendingOf(s), at });
      await addActivity({ at, networkId: NEAR.id, kind: "send", asset: "NEAR", amount: formatNear(s.amount), to: s.to, hash: s.hash, from: s.from });
    } catch { await clearPending(NEAR.id, s.from, s.hash).catch(() => {}); setErr(t.errGeneric); setBusy(false); return; }
    setTrack({ s, at, end: null, mine: true });
    const r = await submitNear(s);
    if (r.state === "refused") {
      await clearPending(NEAR.id, s.from, s.hash).catch(() => {}); await removeActivity(s.hash).catch(() => {});
      setTrack(null); setQuote(null); setErr(fill(t.errNearRefused, { c: r.code })); setBusy(false); return;
    }
    if (r.state === "ok" || r.state === "failed") {
      const end: NearEnd = r.state === "ok" ? { state: "ok" } : { state: "failed", code: r.code };
      await settle(s, end).catch(() => false);
      setTrack({ s, at, end, mine: true }); setBusy(false); return;
    }
    await follow(s, at, true, 30_000);
    setBusy(false);
  }
  async function again(resubmit: boolean) {
    if (!track || busy) return;
    setBusy(true); setPrevNote("");
    if (resubmit) await submitNear(track.s);
    await follow(track.s, track.at, track.mine, resubmit ? 20_000 : 0);
    setBusy(false);
  }
  const explorer = (h: string) => <a className="btn ghost block" href={nearTxUrl(h)} target="_blank" rel="noreferrer"><ExternalLink size={16} />{t.viewTx}</a>;
  if (track && track.mine) {
    const e = track.end;
    return (
      <div className="page stack">
        {!e && <div className="empty">{t.sending}</div>}
        {e?.state === "ok" && <div className="empty"><div className="ic" style={{ color: "var(--good)" }}><Check size={28} /></div>{t.sent}</div>}
        {e?.state === "failed" && <div className="err">{fill(t.errNearChain, { c: e.code })}</div>}
        {e?.state === "dropped" && <div className="err">{t.errNearDropped}</div>}
        {e?.state === "pending" && <div className="note info"><Globe size={16} /><span>{t.nearPendingNote}</span></div>}
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
        <h1>{t.sendOn} {NEAR.name}</h1>
        <div className="sheet" style={{ gap: 8 }}>
          <b className="row" style={{ gap: 6 }}><TriangleAlert size={16} />{t.pendingTitle}</b>
          <span>{fill(t.nearPendingBlock, { a: iso(formatNear(track.s.amount)), to: iso(short(track.s.to)) })}</span>
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
          <div className="kv"><span>{t.amount}</span><b className="num" dir="ltr">{formatNear(quote.amount)} NEAR</b></div>
          <ToReview rc={rc} />
          <div className="kv"><span>{toAddrLabel(t, rc)}</span><span className="mono" style={{ fontSize: 12, wordBreak: "break-all" }}>{quote.to}</span></div>
          <div className="kv"><span>{t.network}</span><span className="row" style={{ gap: 6 }}><NetworkDot id={NEAR.id} />{NEAR.name}</span></div>
          <div className="kv"><span>{t.fee}</span><span className="num" dir="ltr">{formatNear(quote.fee)} NEAR</span></div>
          {quote.reserve > 0n && <div className="kv"><span>{t.xrpReserveRow}</span><span className="num" dir="ltr">{formatNear(quote.reserve)} NEAR</span></div>}
          <div className="kv"><span>{t.total}</span><b className="num" dir="ltr">{formatNear(quote.amount + quote.fee)} NEAR</b></div>
        </div>
        {quote.newAccount && <div className="note info"><Globe size={16} /><span>{t.nearNewAccount}</span></div>}
        {feeShareHigh(quote.fee, quote.amount) && <div className="note warn"><TriangleAlert size={16} /><span>{fill(t.feeShareWarn, { f: iso(`${formatNear(quote.fee)} NEAR`), p: feePct(quote.fee, quote.amount) })}</span></div>}
        <AlikeWarn rc={rc} />
        <div className="note warn"><TriangleAlert size={16} />{t.irreversible}</div>
        {err && <div className="err">{err}</div>}
        <button className="btn primary block" onClick={confirm} disabled={busy || rc.blocked}>{busy ? t.sending : t.confirmSend}</button>
        <button className="btn ghost block" onClick={() => setQuote(null)} disabled={busy}>{t.edit}</button>
      </div>
    );
  return (
    <div className="page stack">
      <h1>{t.sendOn} {NEAR.name}</h1>
      {prevNote && <div className="note soft"><Info size={15} /><span>{prevNote}</span></div>}
      <ToField rc={rc} to={to} setTo={setTo} label={t.recipient} placeholder="name.near / 64 hex" setAmount={setAmount} />
      <span className="faint">{t.nearToHint}</span>
      <AlikeWarn rc={rc} check />
      <label className="field">{t.amount} (NEAR)<input className="input num" inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
      <AmountNote amount={amount} />
      <PctRow getMax={() => nearSpendable(phrase, index)} decimals={NEAR.decimals} onPick={setAmount} />
      <div className="faint">{t.nearFeeNote}</div>
      {track === undefined && <div className="faint">{t.pendingChecking}</div>}
      {err && <div className="err">{err}</div>}
      <button className="btn primary block" disabled={busy || track === undefined || !to.trim() || !amount || amountState(amount).bad || rc.blocked} onClick={review}>{busy ? t.calculating : t.review}</button>
    </div>
  );
}
