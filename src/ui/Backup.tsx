import { Download, Eye, FileKey, Mail, Maximize2, TriangleAlert } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { isValidPhrase } from "../core/account";
import { BackupError, backupFileName, BACKUP_MIN_PASSWORD, isValidEmail, makeBackup, normalizeEmail, openBackup, parseBackup, passwordStrength, strongEnough, type BackupFile } from "../core/backup";
import { changePassword, checkPassword, createVault, DISCOVER_FLAG, getSettings, saveSettings, touch, unlockedPhrase, type LoginInfo, type Settings } from "../core/store";
import { fill, pwError, useT, type Dict } from "./i18n";
import { WordQuiz, Words } from "./Onboarding";
import { ANDROID, androidPost } from "../platform";

export const pendingBackup = { password: "" };

export function inPopup(): boolean {
  try { return (chrome.extension?.getViews?.({ type: "popup" }) ?? []).includes(window); } catch { return false; }
}
export function openFullWindow(hash: string) {
  void chrome.tabs.create({ url: chrome.runtime.getURL(`index.html${hash}`) });
  window.close();
}

function download(file: BackupFile) {

  if (ANDROID && androidPost({ t: "save", name: backupFileName(file.email, new Date(file.created)), data: JSON.stringify(file, null, 2) + "\n" })) return;
  const a = document.createElement("a");
  a.href = "data:application/octet-stream;charset=utf-8," + encodeURIComponent(JSON.stringify(file, null, 2) + "\n");
  a.download = backupFileName(file.email, new Date(file.created));
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

const backupErr = (t: Dict, e: unknown) => {
  const c = e instanceof BackupError ? e.code : "";
  return c === "ERR_FILE" ? t.errFile : c === "ERR_EMAIL" ? t.errEmailMismatch : c === "ERR_PASSWORD" ? t.errBackupPw : c === "ERR_WEAK" ? t.backupShort : t.errGeneric;
};

export function StrengthMeter({ pw }: { pw: string }) {
  const { t } = useT();
  if (!pw) return null;
  const s = passwordStrength(pw);
  const label = [t.s0, t.s1, t.s2, t.s3, t.s4][s];
  const color = s <= 1 ? "var(--bad)" : s === 2 ? "var(--warn)" : "var(--good)";
  return (
    <div className="strength" aria-live="polite">
      <div className="bars">{[1, 2, 3, 4].map((i) => <i key={i} style={{ background: i <= Math.max(s, 1) ? color : undefined }} />)}</div>
      <span style={{ color }}>{t.strength}: {label}</span>
    </div>
  );
}

export function EmailPasswordForm({ submitLabel, busy, onSubmit, extra, initialEmail = "" }: { submitLabel: string; busy: boolean; onSubmit: (email: string, pw: string) => void; extra?: ReactNode; initialEmail?: string }) {
  const { t } = useT();
  const [email, setEmail] = useState(initialEmail), [a, setA] = useState(""), [b, setB] = useState(""), [ok, setOk] = useState(false);
  const emailBad = email.trim().length > 3 && !isValidEmail(email);
  const ready = isValidEmail(email) && a.length >= BACKUP_MIN_PASSWORD && strongEnough(a) && a === b && ok;
  return (
    <>
      <label className="field">{t.emailLabel}
        <input className="input" type="email" dir="ltr" autoComplete="username" spellCheck={false} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" />
      </label>
      <div className="faint">{t.emailNote}</div>
      {emailBad && <div className="err">{t.emailBad}</div>}
      {extra}
      <input className="input" type="password" autoComplete="new-password" placeholder={t.pwMinStrong} value={a} onChange={(e) => setA(e.target.value)} />
      <StrengthMeter pw={a} />
      {a.length >= BACKUP_MIN_PASSWORD && !strongEnough(a) && <div className="err">{t.pwWeak}</div>}
      <input className="input" type="password" autoComplete="new-password" placeholder={t.pwRepeat} value={b} onChange={(e) => setB(e.target.value)} />
      {b && a !== b && <div className="err">{t.pwMismatch}</div>}
      <div className="note warn"><TriangleAlert size={16} />{t.noRecovery}</div>
      <label className="check"><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} />{t.noRecoveryOk}</label>
      <button className="btn primary block" disabled={!ready || busy} onClick={() => onSubmit(normalizeEmail(email), a)}>{busy ? t.encrypting : submitLabel}</button>
    </>
  );
}

export function EmailSetup({ phrase, onDone }: { phrase: string; onDone: () => void }) {
  const { t } = useT();
  const [busy, setBusy] = useState(false), [err, setErr] = useState("");
  async function create(email: string, pw: string) {
    setBusy(true); setErr("");
    try {
      pendingBackup.password = pw;
      await createVault(phrase, pw, { method: "email", email, backupPending: true });
      onDone();
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  }
  return (
    <>
      <h2>{t.emailTitle}</h2>
      <EmailPasswordForm submitLabel={t.continueBtn} busy={busy} onSubmit={create} />
      {err && <div className="err">{err}</div>}
    </>
  );
}

export function SaveBackup({ email, presetPassword, onSaved, required }: { email: string; presetPassword?: string; onSaved: () => void; required?: boolean }) {
  const { t } = useT();
  const [pw, setPw] = useState(""), [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const [saved, setSaved] = useState<string | null>(null), [ok, setOk] = useState(false);

  const [weak, setWeak] = useState<string | null>(null), [na, setNa] = useState(""), [nb, setNb] = useState("");
  async function save(phrase: string, password: string) {
    const file = await makeBackup(phrase, email, password);
    download(file);
    setSaved(backupFileName(file.email, new Date(file.created))); setPw(""); void touch();
  }
  async function go() {
    setBusy(true); setErr("");
    try {
      const password = presetPassword || pw;
      const phrase = presetPassword ? (await unlockedPhrase()) ?? (await checkPassword(password)) : await checkPassword(password);
      if (password.length < BACKUP_MIN_PASSWORD || !strongEnough(password)) setWeak(password);
      else await save(phrase, password);
    } catch (e) { setErr(e instanceof BackupError ? backupErr(t, e) : pwError(t, e)); }
    setBusy(false);
  }
  async function renew() {
    if (weak == null) return;
    setBusy(true); setErr("");
    try {
      await changePassword(weak, na);
      if (presetPassword) pendingBackup.password = na;
      const phrase = await checkPassword(na);
      setWeak(null); setNa(""); setNb("");
      await save(phrase, na);
    } catch (e) { setErr(e instanceof BackupError ? backupErr(t, e) : t.errGeneric); }
    setBusy(false);
  }
  if (weak != null && !saved)
    return (
      <div className="stack" style={{ gap: 12 }}>
        <div className="note warn"><TriangleAlert size={16} />{t.backupShort}</div>
        <input className="input" type="password" autoComplete="new-password" placeholder={t.pwMinStrong} value={na} onChange={(e) => setNa(e.target.value)} />
        <StrengthMeter pw={na} />
        {na.length >= BACKUP_MIN_PASSWORD && !strongEnough(na) && <div className="err">{t.pwWeak}</div>}
        <input className="input" type="password" autoComplete="new-password" placeholder={t.pwRepeat} value={nb} onChange={(e) => setNb(e.target.value)} />
        {nb && na !== nb && <div className="err">{t.pwMismatch}</div>}
        {err && <div className="err">{err}</div>}
        <button className="btn primary block" disabled={busy || !strongEnough(na) || na !== nb} onClick={renew}><Download size={16} />{busy ? t.encrypting : t.backupDownload}</button>
      </div>
    );
  async function finish() {
    const s = await getSettings();
    if (s.login?.method === "email") await saveSettings({ login: { ...s.login, backupPending: false, lastBackup: Date.now() } });
    pendingBackup.password = "";
    onSaved();
  }
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="faint" style={{ fontSize: 13 }}>{t.backupHint}</div>
      {required && <div className="note info"><FileKey size={16} />{t.backupRequired}</div>}
      {!presetPassword && !saved && <input className="input" type="password" autoComplete="current-password" placeholder={t.backupPw} value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === "Enter" && pw && !busy && go()} />}
      {err && <div className="err">{err}</div>}
      {!saved && <button className="btn primary block" disabled={busy || (!presetPassword && !pw)} onClick={go}><Download size={16} />{busy ? t.encrypting : t.backupDownload}</button>}
      {saved && (
        <>
          <div className="kv"><span>{t.backupFile}</span><span className="mono" style={{ fontSize: 12, wordBreak: "break-all" }}>{saved}</span></div>
          <label className="check"><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} />{t.backupSavedCheck}</label>
          <button className="btn primary block" disabled={!ok} onClick={finish}>{required ? t.backupDone : t.done}</button>
          <button className="btn ghost block" onClick={() => { setSaved(null); setOk(false); }}><Download size={16} />{t.backupAgain}</button>
        </>
      )}
      {inPopup() && <button className="link" style={{ alignSelf: "center" }} onClick={() => openFullWindow("")}><Maximize2 size={13} /> {t.backupWindow}</button>}
    </div>
  );
}

export function BackupGate({ settings, onDone }: { settings: Settings; onDone: () => void }) {
  const { t } = useT();
  return (
    <div className="onb">
      <h2>{t.backupTitle}</h2>
      <div className="row muted" style={{ gap: 6 }}><Mail size={15} /><span dir="ltr">{settings.login?.email}</span></div>
      <SaveBackup email={settings.login?.email ?? ""} presetPassword={pendingBackup.password || undefined} onSaved={onDone} required />
      <div className="note warn"><TriangleAlert size={16} />{t.noRecovery}</div>
    </div>
  );
}

export function RestoreFile({ onDone, onBack }: { onDone: () => void; onBack: () => void }) {
  const { t } = useT();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<BackupFile | null>(null), [fileName, setFileName] = useState("");
  const [email, setEmail] = useState(""), [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false), [err, setErr] = useState("");
  async function pick(f: File | undefined) {
    setErr(""); setFile(null); setFileName(f?.name ?? "");
    if (!f) return;
    try {
      if (f.size > 64 * 1024) throw new BackupError("ERR_FILE");
      const parsed = parseBackup(await f.text());
      setFile(parsed);
      if (!email) setEmail(parsed.email);
    } catch (e) { setErr(backupErr(t, e)); }
  }
  async function restore() {
    if (!file) return;
    setBusy(true); setErr("");
    try {
      const phrase = await openBackup(file, email, pw);
      if (!isValidPhrase(phrase)) throw new BackupError("ERR_FILE");
      await createVault(phrase, pw, { method: "email", email: file.email, lastBackup: Date.parse(file.created) || undefined });
      await chrome.storage.local.set({ [DISCOVER_FLAG]: true });
      onDone();
    } catch (e) { setErr(backupErr(t, e)); setBusy(false); }
  }
  if (inPopup())
    return (
      <>
        <h2>{t.restoreFileTitle}</h2>
        <div className="note info"><Maximize2 size={16} />{t.fileNeedsWindow}</div>
        <div className="grow" />
        <button className="btn primary block" onClick={() => openFullWindow("#restore-file")}><Maximize2 size={16} />{t.openFull}</button>
        <button className="btn ghost block" onClick={onBack}>{t.back}</button>
      </>
    );
  return (
    <>
      <h2>{t.restoreFileTitle}</h2>
      <p className="muted" style={{ margin: 0 }}>{t.restoreFileHint}</p>
      <input ref={input} type="file" accept=".madarbackup,.json,application/json,application/octet-stream" hidden onChange={(e) => void pick(e.target.files?.[0])} />
      <button className="btn ghost block" onClick={() => input.current?.click()}><FileKey size={16} />{fileName ? <span className="mono" style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis" }}>{fileName}</span> : t.pickFile}</button>
      <label className="field">{t.emailLabel}
        <input className="input" type="email" dir="ltr" autoComplete="username" spellCheck={false} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" />
      </label>
      <input className="input" type="password" autoComplete="current-password" placeholder={t.password} value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === "Enter" && file && pw && !busy && restore()} />
      <div className="faint">{t.restorePwNote}</div>
      {err && <div className="err">{err}</div>}
      <div className="grow" />
      <button className="btn primary block" disabled={!file || !isValidEmail(email) || !pw || busy} onClick={restore}>{busy ? t.restoring : t.restoreBtn}</button>
      <button className="btn ghost block" onClick={onBack} disabled={busy}>{t.back}</button>
    </>
  );
}

export function LoginMethod({ settings, update, say }: { settings: Settings; update: (p: Partial<Settings>) => Promise<void>; say: (m: string) => void }) {
  const { t } = useT();
  const login = settings.login;
  return (
    <div className="sheet">
      <div className="kv"><span>{t.currentMethod}</span><b>{login ? t.loginEmail : t.loginWords}</b></div>
      {login && <div className="kv"><span>{t.emailLabel}</span><span dir="ltr">{login.email}</span></div>}
      {login?.lastBackup && <div className="faint">{fill(t.backupLast, { d: new Date(login.lastBackup).toLocaleDateString("en-GB") })}</div>}
      {login ? <ToWords update={update} say={say} /> : <ToEmail update={update} />}
    </div>
  );
}

function ToWords({ update, say }: { update: (p: Partial<Settings>) => Promise<void>; say: (m: string) => void }) {
  const { t } = useT();
  const [pw, setPw] = useState(""), [err, setErr] = useState(""), [phrase, setPhrase] = useState<string | null>(null);
  const [wrote, setWrote] = useState(false), [quiz, setQuiz] = useState(false), [ok, setOk] = useState(false);
  async function open() { setErr(""); try { setPhrase(await checkPassword(pw)); setPw(""); void touch(); } catch (e) { setErr(pwError(t, e)); } }
  if (!phrase)
    return (
      <>
        <b style={{ marginTop: 6 }}>{t.toWords}</b>
        <div className="faint" style={{ fontSize: 13 }}>{t.toWordsHint}</div>
        <input className="input" type="password" placeholder={t.password} value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === "Enter" && pw && open()} />
        {err && <div className="err">{err}</div>}
        <button className="btn ghost block" disabled={!pw} onClick={open}><Eye size={16} />{t.show}</button>
      </>
    );
  if (!quiz)
    return (
      <>
        <div className="note warn"><TriangleAlert size={16} />{t.phraseWarn}</div>
        <Words phrase={phrase} />
        <label className="check"><input type="checkbox" checked={wrote} onChange={(e) => setWrote(e.target.checked)} />{t.phraseSaved}</label>
        <button className="btn primary block" disabled={!wrote} onClick={() => setQuiz(true)}>{t.next}</button>
      </>
    );
  return (
    <>
      <p className="muted" style={{ margin: 0 }}>{t.confirmHint}</p>
      <WordQuiz phrase={phrase} onChange={setOk} />
      <button className="btn primary block" disabled={!ok} onClick={async () => { await update({ login: undefined }); say(t.loginSwitched); }}>{t.confirm}</button>
      <button className="btn ghost block" onClick={() => setQuiz(false)}>{t.showAgain}</button>
    </>
  );
}

function ToEmail({ update }: { update: (p: Partial<Settings>) => Promise<void> }) {
  const { t } = useT();
  const [cur, setCur] = useState(""), [busy, setBusy] = useState(false), [err, setErr] = useState("");
  async function go(email: string, pw: string) {
    setBusy(true); setErr("");
    try {
      await checkPassword(cur);
      if (pw !== cur) await changePassword(cur, pw);
      pendingBackup.password = pw;
      const login: LoginInfo = { method: "email", email, backupPending: true };
      await update({ login });
    } catch (e) { setErr(pwError(t, e)); setBusy(false); }
  }
  return (
    <>
      <b style={{ marginTop: 6 }}>{t.toEmail}</b>
      <div className="faint" style={{ fontSize: 13 }}>{t.toEmailHint}</div>
      <EmailPasswordForm submitLabel={t.continueBtn} busy={busy} onSubmit={go}
        extra={<input className="input" type="password" autoComplete="current-password" placeholder={t.sCurrentPw} value={cur} onChange={(e) => setCur(e.target.value)} />} />
      {err && <div className="err">{err}</div>}
    </>
  );
}
