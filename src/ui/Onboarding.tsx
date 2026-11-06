import { ChevronDown, Eye, FileKey, KeyRound, Mail, Plus, ShieldCheck, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useState, type ReactElement } from "react";
import { isValidPhrase, newPhrase, normalizePhrase } from "../core/account";
import { createVault, DISCOVER_FLAG, type Lang } from "../core/store";
import { BACKUP_MIN_PASSWORD, strongEnough } from "../core/backup";
import { EmailSetup, RestoreFile, StrengthMeter } from "./Backup";
import { useT } from "./i18n";

type Step = "welcome" | "method" | "show" | "confirm" | "import" | "password" | "email" | "file";

export function Onboarding({ onDone, lang, setLang }: { onDone: () => void; lang: Lang; setLang: (l: Lang) => void }) {
  const { t } = useT();
  const [step, setStep] = useState<Step>(() => (location.hash === "#restore-file" ? "file" : "welcome"));
  const [phrase, setPhrase] = useState("");
  const [wrote, setWrote] = useState(false);
  const [blur, setBlur] = useState(true);
  const [restoring, setRestoring] = useState(false);

  if (step === "welcome")
    return (
      <div className="onb">
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <div className="seg"><button className={lang === "ar" ? "on" : ""} onClick={() => setLang("ar")}>العربية</button><button className={lang === "en" ? "on" : ""} onClick={() => setLang("en")}>English</button></div>
        </div>
        <div className="brand">
          <img src="logo-mark.png" alt="" />
          <h1>{t.appName}</h1>
          <p className="muted" style={{ margin: 0 }}>{t.tagline}</p>
        </div>
        <div className="grow" />
        <button className="btn primary block" onClick={() => { setPhrase(newPhrase()); setRestoring(false); setStep("method"); }}><Plus size={18} />{t.createWallet}</button>
        <button className="btn ghost block" onClick={() => { setRestoring(true); setPhrase(""); setStep("import"); }}><KeyRound size={18} />{t.restoreWallet}</button>
        <button className="btn ghost block" onClick={() => { setRestoring(true); setStep("file"); }}><FileKey size={18} />{t.restoreBackup}</button>
        <div className="row faint" style={{ justifyContent: "center", textAlign: "center" }}><ShieldCheck size={14} style={{ flex: "none" }} />{t.scamNote}</div>
      </div>
    );

  if (step === "method")
    return (
      <div className="onb">
        <h2>{t.methodTitle}</h2>
        <p className="muted" style={{ margin: 0 }}>{t.methodHint}</p>
        <button className="method" onClick={() => setStep("show")}>
          <span className="ic"><KeyRound size={20} /></span>
          <span className="grow"><b>{t.mWords}</b><span className="faint">{t.mWordsHint}</span></span>
          <ChevronDown size={16} className="chev" />
        </button>
        <button className="method" onClick={() => setStep("email")}>
          <span className="ic"><Mail size={20} /></span>
          <span className="grow"><b>{t.mEmail}</b><span className="faint">{t.mEmailHint}</span></span>
          <ChevronDown size={16} className="chev" />
        </button>
        <div className="grow" />
        <button className="btn ghost block" onClick={() => setStep("welcome")}>{t.back}</button>
      </div>
    );

  if (step === "email")
    return (
      <div className="onb">
        <EmailSetup phrase={phrase} onDone={onDone} />
        <button className="btn ghost block" onClick={() => setStep("method")}>{t.back}</button>
      </div>
    );

  if (step === "file")
    return (
      <div className="onb">
        <RestoreFile onDone={onDone} onBack={() => { history.replaceState(null, "", location.pathname); setStep("welcome"); }} />
      </div>
    );

  const total = restoring ? 2 : 3, cur = step === "show" || step === "import" ? 1 : step === "confirm" ? 2 : total;
  const Steps = () => <div className="steps">{Array.from({ length: total }, (_, i) => <i key={i} className={i < cur ? "on" : ""} />)}</div>;

  if (step === "show")
    return (
      <div className="onb">
        <Steps />
        <h2>{t.phraseTitle}</h2>
        <div className="note warn"><TriangleAlert size={16} />{t.phraseWarn}</div>
        <div className={"blurwrap" + (blur ? " hidden" : "")}>
          {}
          <Words phrase={blur ? phrase.split(" ").map(() => "•••••").join(" ") : phrase} />
          {blur && <div className="reveal"><button className="btn ghost" onClick={() => setBlur(false)}><Eye size={16} />{t.show}</button></div>}
        </div>
        <label className="check"><input type="checkbox" checked={wrote} onChange={(e) => setWrote(e.target.checked)} />{t.phraseSaved}</label>
        <div className="grow" />
        {blur && wrote && <div className="faint" style={{ textAlign: "center" }}>{t.revealFirst}</div>}
        <button className="btn primary block" disabled={!wrote || blur} onClick={() => setStep("confirm")}>{t.next}</button>
        <button className="btn ghost block" onClick={() => setStep("method")}>{t.back}</button>
      </div>
    );

  if (step === "confirm") return <Confirm phrase={phrase} Steps={Steps} onBack={() => setStep("show")} onOk={() => setStep("password")} />;

  if (step === "import")
    return (
      <div className="onb">
        <Steps />
        <h2>{t.restoreTitle}</h2>
        <p className="muted" style={{ margin: 0 }}>{t.restoreHint}</p>
        <textarea rows={4} className="input mono" value={phrase} onChange={(e) => setPhrase(e.target.value)} autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} />
        {phrase.trim() && !isValidPhrase(phrase) && <div className="err">{t.badPhrase}</div>}
        <div className="grow" />
        <button className="btn primary block" disabled={!isValidPhrase(phrase)} onClick={() => { setPhrase(normalizePhrase(phrase)); setStep("password"); }}>{t.next}</button>
        <button className="btn ghost block" onClick={() => { setPhrase(""); setStep("welcome"); }}>{t.back}</button>
      </div>
    );

  return <Password phrase={phrase} Steps={Steps} onDone={onDone} restoring={restoring} />;
}

export function Words({ phrase }: { phrase: string }) {
  return (
    <div className="words">
      {phrase.split(" ").map((w, i) => <div className="word" key={i}><b>{i + 1}</b>{w}</div>)}
    </div>
  );
}

export function WordQuiz({ phrase, onChange }: { phrase: string; onChange: (ok: boolean) => void }) {
  const { t } = useT();
  const words = phrase.split(" ");
  const asks = useMemo(() => {
    const idx = new Set<number>();
    while (idx.size < 3) for (const r of crypto.getRandomValues(new Uint32Array(16))) { idx.add(r % words.length); if (idx.size === 3) break; }
    return [...idx].sort((a, b) => a - b);
  }, [phrase]);
  const [ans, setAns] = useState<Record<number, string>>({});
  const ok = asks.every((i) => (ans[i] ?? "").trim().toLowerCase() === words[i]);
  useEffect(() => onChange(ok), [ok]);
  return (
    <>
      {asks.map((i) => (
        <label key={i} className="field">{t.wordN} {i + 1}
          <input className="input mono" value={ans[i] ?? ""} onChange={(e) => setAns({ ...ans, [i]: e.target.value })} autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} />
        </label>
      ))}
    </>
  );
}

function Confirm({ phrase, Steps, onBack, onOk }: { phrase: string; Steps: () => ReactElement; onBack: () => void; onOk: () => void }) {
  const { t } = useT();
  const [ok, setOk] = useState(false);
  return (
    <div className="onb">
      <Steps />
      <h2>{t.confirmTitle}</h2>
      <p className="muted" style={{ margin: 0 }}>{t.confirmHint}</p>
      <WordQuiz phrase={phrase} onChange={setOk} />
      <div className="grow" />
      <button className="btn primary block" disabled={!ok} onClick={onOk}>{t.confirm}</button>
      <button className="btn ghost block" onClick={onBack}>{t.showAgain}</button>
    </div>
  );
}

function Password({ phrase, Steps, onDone, restoring }: { phrase: string; Steps: () => ReactElement; onDone: () => void; restoring?: boolean }) {
  const { t } = useT();
  const [a, setA] = useState(""), [b, setB] = useState("");
  const [busy, setBusy] = useState(false), [err, setErr] = useState(""), [left, setLeft] = useState(false);

  const short = left && a.length > 0 && a.length < BACKUP_MIN_PASSWORD, weak = a.length >= BACKUP_MIN_PASSWORD && !strongEnough(a), mismatch = b.length > 0 && a !== b;
  async function save() {
    setBusy(true); setErr("");
    try { await createVault(phrase, a); if (restoring) await chrome.storage.local.set({ [DISCOVER_FLAG]: true }); onDone(); } catch (e) { setErr((e as Error).message); setBusy(false); }
  }
  return (
    <div className="onb">
      <Steps />
      <h2>{t.pwTitle}</h2>
      <p className="muted" style={{ margin: 0 }}>{t.pwHint}</p>
      <input className="input" type="password" autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} placeholder={t.pwMinStrong} value={a} onChange={(e) => setA(e.target.value)} onBlur={() => setLeft(true)} />
      <StrengthMeter pw={a} />
      <input className="input" type="password" autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} placeholder={t.pwRepeat} value={b} onChange={(e) => setB(e.target.value)} />
      {short && <div className="err">{t.pwShort}</div>}
      {weak && <div className="err">{t.pwWeak}</div>}
      {mismatch && <div className="err">{t.pwMismatch}</div>}
      {err && <div className="err">{err}</div>}
      <div className="grow" />
      <button className="btn primary block" disabled={busy || !strongEnough(a) || a !== b} onClick={save}>{busy ? (restoring ? t.restoringWallet : t.encrypting) : (restoring ? t.restoreBtn : t.createBtn)}</button>
    </div>
  );
}
