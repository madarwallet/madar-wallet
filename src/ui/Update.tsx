import { CircleCheck, Clock, Download, RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react";
import { ANDROID } from "../platform";
import { checkUpdate, offeredVersion, startUpdate, useUpdate, type UpdateState } from "../platform/update";
import { fill, useT, type Dict } from "./i18n";

function errText(t: Dict, e: string) {
  return e === "net" ? t.updErrNet : e === "sign" ? t.updErrSign : e === "perm" ? t.updErrPerm : e === "install" ? t.updErrInstall : e === "store" ? t.updErrStore : t.updErrBad;
}

function Body({ s }: { s: UpdateState }) {
  const { t, lang } = useT();
  const v = ("versionName" in s && s.versionName) || offeredVersion() || "";
  const title = <div className="row" style={{ gap: 8, fontWeight: 700 }}><Download size={18} />{fill(t.updAvail, { v })}</div>;
  if (s.state === "available" && !ANDROID)
    return (
      <>
        {title}
        <div className="muted" style={{ fontSize: 13, lineHeight: 1.7 }}>{t.updReady}</div>
        <button className="btn primary block" onClick={startUpdate}><Download size={16} />{t.updBtnNow}</button>
      </>
    );
  if (s.state === "preparing") return <>{title}<div className="row" style={{ gap: 8, fontSize: 13 }}><RefreshCw size={16} />{t.updPreparing}</div></>;
  if (s.state === "available") {
    const notes = lang === "ar" ? s.notes_ar : s.notes_en;
    return (
      <>
        {title}
        {notes && <div className="muted" style={{ fontSize: 13, lineHeight: 1.7 }}>{notes}</div>}
        <button className="btn primary block" onClick={startUpdate}><Download size={16} />{t.updBtn}</button>
      </>
    );
  }
  if (s.state === "downloading")
    return (
      <>
        {title}
        <div className="row" style={{ justifyContent: "space-between", fontSize: 13 }}><span>{t.updDownloading}</span><span className="num">{Math.round(s.progress)}%</span></div>
        <div className="xbar"><span style={{ width: `${Math.max(2, Math.min(100, s.progress))}%` }} /></div>
      </>
    );
  if (s.state === "verifying") return <>{title}<div className="row" style={{ gap: 8, fontSize: 13 }}><ShieldCheck size={16} />{t.updVerifying}</div></>;
  if (s.state === "permission") return <>{title}<div className="note info"><ShieldCheck size={16} />{t.updPerm}</div></>;
  if (s.state === "installing") return <>{title}<div className="note info"><ShieldCheck size={16} />{t.updInstalling}</div></>;
  if (s.state === "error")
    return (
      <>
        {v && title}
        <div className="note warn"><TriangleAlert size={16} />{errText(t, s.error)}</div>
        {v && <button className="btn ghost block" onClick={startUpdate}><RefreshCw size={16} />{t.updRetry}</button>}
      </>
    );
  return null;
}

export function UpdateCard() {
  const s = useUpdate();
  const offer = ["available", "preparing", "downloading", "verifying", "permission", "installing"].includes(s.state) || (s.state === "error" && !!offeredVersion());
  if (!offer) return null;
  return <div className="xcard"><Body s={s} /></div>;
}

export function UpdateSettings() {
  const { t } = useT();
  const s = useUpdate();
  const busy = s.state === "checking";
  return (
    <div className="group"><div className="gt">{t.updGroup}</div>
      <div className="list">
        <button className="setrow" disabled={busy} onClick={() => checkUpdate(true)}>
          <span className="ic"><RefreshCw size={16} /></span><span className="grow">{t.updCheck}</span>
          {busy && <span className="val">{t.updChecking}</span>}
        </button>
      </div>
      {s.state === "none" && <div className="note info" style={{ marginTop: 10 }}><CircleCheck size={16} />{t.updLatest}</div>}
      {s.state === "throttled" && <div className="note info" style={{ marginTop: 10 }}><Clock size={16} />{t.updThrottled}</div>}
      {s.state !== "none" && s.state !== "throttled" && s.state !== "idle" && s.state !== "checking" && <div className="xcard" style={{ marginTop: 10, marginBottom: 0 }}><Body s={s} /></div>}
    </div>
  );
}
