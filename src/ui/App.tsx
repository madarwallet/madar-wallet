import { Globe, Lock, Mail, TriangleAlert } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import { getSettings, hasVault, saveSettings, unlock, unlockedPhrase, wipe, type Settings } from "../core/store";
import type { ApprovalView } from "../dapp/router";
import { answer } from "./answer";
import { DICTS, fill, I18n, pwError, useT } from "./i18n";
import { Wallet } from "./Wallet";
import { setGasSpeed } from "../core/gaslevels";

const Approval = lazy(() => import("./Approval").then((m) => ({ default: m.Approval })));
const Onboarding = lazy(() => import("./Onboarding").then((m) => ({ default: m.Onboarding })));
const BackupGate = lazy(() => import("./Backup").then((m) => ({ default: m.BackupGate })));

type Mode = "loading" | "new" | "locked" | "open";

const APPROVAL_WINDOW = location.hash === "#approval";

export function App() {
  const [mode, setMode] = useState<Mode>("loading");
  const [phrase, setPhrase] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [queue, setQueue] = useState<ApprovalView[]>([]);
  const [seen, setSeen] = useState(false);

  async function refresh() {
    setSettings(await getSettings());
    if (!(await hasVault())) return setMode("new");
    const p = await unlockedPhrase();
    setPhrase(p);
    setMode(p ? "open" : "locked");
  }
  useEffect(() => {
    void refresh();

    const on = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "session" && "phrase" in changes) void refresh();
      if (area === "session" && "dappQueue" in changes) setQueue((changes.dappQueue.newValue as ApprovalView[] | undefined) ?? []);
    };
    void chrome.storage.session.get("dappQueue").then((r) => setQueue((r.dappQueue as ApprovalView[] | undefined) ?? []));
    chrome.storage.onChanged.addListener(on);
    return () => chrome.storage.onChanged.removeListener(on);
  }, []);

  const lang = settings?.lang ?? "ar";
  useEffect(() => { setGasSpeed(settings?.gasSpeed); }, [settings?.gasSpeed]);
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
    document.documentElement.dataset.theme = settings?.theme ?? "dark";
    document.title = DICTS[lang].appName;
  }, [lang, settings?.theme]);

  useEffect(() => {
    if (!APPROVAL_WINDOW) return;
    if (queue.length) { setSeen(true); return; }
    const id = setTimeout(() => window.close(), seen ? 1200 : 2500);
    return () => clearTimeout(id);
  }, [queue.length, seen]);

  const update = async (patch: Partial<Settings>) => setSettings(await saveSettings(patch));
  if (mode === "loading" || !settings) return null;
  const pending = queue.find((v) => v.kind !== "unlock");
  const gate = !!settings.login?.backupPending && !APPROVAL_WINDOW;
  return (
    <I18n.Provider value={{ t: DICTS[lang], lang }}>
      <Suspense fallback={null}>
      {mode === "new" && <Onboarding onDone={refresh} lang={lang} setLang={(l) => update({ lang: l })} />}
      {mode === "locked" && <Unlock email={settings.login?.email} onDone={refresh} onReset={async () => { await wipe(); await refresh(); }} request={queue[0]} />}
      {mode === "open" && gate && <BackupGate settings={settings} onDone={refresh} />}
      {mode === "open" && !gate && (pending ? <Approval key={pending.id} view={pending} settings={settings} pending={queue.filter((v) => v.kind !== "unlock").length} /> : APPROVAL_WINDOW ? null : <Wallet phrase={phrase!} settings={settings} update={update} />)}
      </Suspense>
    </I18n.Provider>
  );
}

function Unlock({ email, onDone, onReset, request }: { email?: string; onDone: () => void; onReset: () => void; request?: ApprovalView }) {
  const { t } = useT();
  const [pw, setPw] = useState(""), [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false), [typed, setTyped] = useState("");
  async function go() {
    setBusy(true); setErr("");
    try { await unlock(pw); onDone(); } catch (e) { setErr(pwError(t, e)); setBusy(false); }
  }
  if (forgot)
    return (
      <div className="onb">
        <h2>{t.forgot}</h2>
        <div className="note warn"><TriangleAlert size={16} />{email ? t.forgotWarnEmail : t.forgotWarn}</div>
        <label className="field">{t.typeDelete}<input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} /></label>
        <div className="grow" />
        <button className="btn danger block" disabled={typed.trim() !== t.deleteWord} onClick={onReset}>{t.removeFromDevice}</button>
        <button className="btn ghost block" onClick={() => setForgot(false)}>{t.back}</button>
      </div>
    );
  return (
    <div className="onb">
      <div className="brand">
        <img src="logo-mark.png" alt="" />
        <h1>{t.appName}</h1>
        <p className="muted" style={{ margin: 0 }}>{t.locked}</p>
      </div>
      {request && (
        <div className="note info"><Globe size={16} /><span>{fill(t.dLockedReq, { site: (() => { try { return new URL(request.origin).host; } catch { return request.origin; } })() })}</span></div>
      )}
      <div className="grow" />
      {email && <div className="row muted" style={{ gap: 6, justifyContent: "center" }}><Mail size={15} />{t.signedInAs}: <span dir="ltr">{email}</span></div>}
      <input className="input" type="password" placeholder={t.password} autoFocus value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === "Enter" && pw && go()} />
      {err && <div className="err">{err}</div>}
      <button className="btn primary block" disabled={!pw || busy} onClick={go}><Lock size={16} />{busy ? t.unlocking : t.unlock}</button>
      {request && <button className="btn ghost block" onClick={() => answer(request.id, false)}>{t.dReject}</button>}
      <button className="link" style={{ alignSelf: "center" }} onClick={() => setForgot(true)}>{t.forgot}</button>
    </div>
  );
}
