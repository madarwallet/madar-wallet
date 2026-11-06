import { BookUser, Download, Gift, ExternalLink, ListChecks, Eye, Globe, KeyRound, Languages, Lock, LogOut, Mail, Maximize2, Moon, Palette, Pencil, Plus, ShieldAlert, ShieldCheck, Timer, Trash2, TriangleAlert, Wallet as WalletIcon, ListFilter, EyeOff, HandCoins, Fuel, Bell, Link2 } from "lucide-react";
import { GAS_SPEEDS } from "../core/gaslevels";
import { refreshPlan, savePlan } from "../core/watchplan";
import { askNotify } from "../platform/android/notify";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { crossTo, NETWORKS, networksOnPatch, POPULAR, swapsOn, type Network } from "../core/chains";
import { NetworkDot } from "./icons";
import { cleanLabel, forFamily, LABEL_MAX, renameAddress, deleteAddress, type BookEntry, type Family } from "../core/addressbook";
import { changePassword, checkPassword, getSitePerms, lock, setSitePerm, touch, wipe, type Settings, type SitePerm } from "../core/store";
import { BACKUP_MIN_PASSWORD, strongEnough } from "../core/backup";
import { fill, gasSpeedLabel, pwError, useT, watchTexts } from "./i18n";
import { Words } from "./Onboarding";
import { LoginMethod, SaveBackup, StrengthMeter } from "./Backup";
import { ANDROID } from "../platform";
import { BTC } from "../core/btcbase";
import { SOL } from "../core/solbase";
import { TRON } from "../core/tronbase";
import { EXTRA_COINS } from "../core/natives";
import { UpdateSettings } from "./Update";
import { BookSyncRow } from "./BookSync";
import { Approvals } from "./Approvals";
import { InviteBox, MyCodeBox, useInvite, useMyCode } from "./Invite";
import { accName, AddAddressForm, useBook, VERSION, type Update } from "./common";

function Row({ icon, label, value, onClick, danger, children }: { icon: ReactNode; label: string; value?: ReactNode; onClick?: () => void; danger?: boolean; children?: ReactNode }) {
  const inner = (<><span className="ic">{icon}</span><span className="grow">{label}</span>{value != null && <span className="val">{value}</span>}{children}</>);
  return onClick ? <button className={"setrow" + (danger ? " danger" : "")} onClick={onClick}>{inner}</button> : <div className={"setrow" + (danger ? " danger" : "")}>{inner}</div>;
}

export function SettingsView({ settings, update, say, focusNets, phrase }: { settings: Settings; update: Update; say: (m: string) => void; focusNets?: boolean; phrase?: string }) {
  const { t } = useT();

  const [open, setOpen] = useState<"" | "pw" | "phrase" | "remove" | "rename" | "hideacc" | "login" | "backup" | "book" | "appr" | "invite" | "mycode">(() => (import.meta.env.DEV && location.hash === "#demo-approvals" ? "appr" : ""));
  const toggle = (k: typeof open) => setOpen(open === k ? "" : k);

  const [notifyErr, setNotifyErr] = useState("");
  const toggleNotify = async () => {
    setNotifyErr("");
    if (settings.notify) { await update({ notify: false }); await savePlan(null); return; }
    const ok = ANDROID ? await askNotify() : await chrome.permissions.request({ permissions: ["notifications"] }).catch(() => false);
    if (!ok) { setNotifyErr(t.sNotifyDenied); return; }
    await update({ notify: true });
    if (phrase) void refreshPlan(phrase, { ...settings, notify: true }, watchTexts(t)).catch(() => {});
  };
  const book = useBook();
  const [inv, setInv] = useInvite();
  const [mine, setMine] = useMyCode();
  return (
    <div className="page">
      <h1>{t.settings}</h1>

      <div className="group"><div className="gt">{t.sAccounts}</div>
        <div className="list">
          <Row icon={<WalletIcon size={16} />} label={accName(t, settings, settings.accountIndex)} value={t.sActive} />
          <Row icon={<Pencil size={16} />} label={t.sRename} onClick={() => toggle("rename")} />
          {open === "rename" && <div style={{ padding: "0 14px 14px" }}><Rename settings={settings} update={update} done={() => { setOpen(""); say(t.done); }} /></div>}
          <Row icon={<BookUser size={16} />} label={t.savedTitle} value={<span className="num">{book.length}</span>} onClick={() => toggle("book")} />
          {open === "book" && <div style={{ padding: "0 14px 14px" }}><AddressBook book={book} /></div>}
          <BookSyncRow settings={settings} update={update} />
          {phrase && <Row icon={<Link2 size={16} />} label={t.invTitle} value={inv?.linked.length ? <span dir="ltr">{inv.code}</span> : undefined} onClick={() => toggle("invite")} />}
          {open === "invite" && phrase && <div style={{ padding: "0 14px 14px" }}><InviteBox phrase={phrase} settings={settings} inv={inv} setInv={setInv} say={say} /></div>}
          {phrase && <Row icon={<Gift size={16} />} label={t.invMineTitle} value={mine ? <span dir="ltr">{mine.code}</span> : undefined} onClick={() => toggle("mycode")} />}
          {open === "mycode" && phrase && <div style={{ padding: "0 14px 14px" }}><MyCodeBox phrase={phrase} settings={settings} mine={mine} setMine={setMine} say={say} /></div>}
          <Row icon={<Plus size={16} />} label={t.sAddAccount} onClick={() => { const index = Math.max(...settings.accounts.map((a) => a.index)) + 1; void update({ accounts: [...settings.accounts, { index, name: "" }], accountIndex: index }); say(t.done); }} />
        </div>
      </div>

      <div className="group"><div className="gt">{t.sSecurity}</div>
        <div className="list">
          <Row icon={<Timer size={16} />} label={t.sAutoLock}>
            <div className="seg">{[5, 15, 30, 60, 0].map((m) => <button key={m} className={settings.autoLockMinutes === m ? "on" : ""} onClick={async () => { await update({ autoLockMinutes: m }); void touch(); }}>{m || t.sNeverLock}</button>)}</div>
          </Row>
          {settings.autoLockMinutes === 0 && <div style={{ padding: "0 14px 12px" }}><div className="note warn"><TriangleAlert size={16} />{t.sNeverLockWarn}</div></div>}
          <Row icon={<Mail size={16} />} label={t.sLogin} value={settings.login ? t.loginEmail : t.loginWords} onClick={() => toggle("login")} />
          {open === "login" && <div style={{ padding: "0 14px 14px" }}><LoginMethod settings={settings} update={update} say={(m) => { setOpen(""); say(m); }} /></div>}
          {settings.login && <Row icon={<Download size={16} />} label={t.sBackup} onClick={() => toggle("backup")} />}
          {open === "backup" && settings.login && <div style={{ padding: "0 14px 14px" }}><div className="sheet"><SaveBackup email={settings.login.email} onSaved={() => { setOpen(""); say(t.done); }} /></div></div>}
          <Row icon={<KeyRound size={16} />} label={t.sChangePw} onClick={() => toggle("pw")} />
          {open === "pw" && <div style={{ padding: "0 14px 14px" }}><ChangePw email={!!settings.login} done={() => { setOpen(""); say(settings.login ? t.pwChangedBackup : t.pwChanged); }} /></div>}
          <Row icon={<Eye size={16} />} label={t.sRevealPhrase} onClick={() => toggle("phrase")} />
          {open === "phrase" && <div style={{ padding: "0 14px 14px" }}><Reveal /></div>}
          {phrase && <Row icon={<ListChecks size={16} />} label={t.sApprovals} onClick={() => toggle("appr")} />}
          {open === "appr" && phrase && <div style={{ padding: "0 14px 14px" }}><Approvals settings={settings} phrase={phrase} say={say} /></div>}
          <Row icon={<Lock size={16} />} label={t.lockNow} onClick={() => lock()} />
        </div>
        {}
        <div className="faint row" style={{ gap: 6, padding: "8px 4px 0" }}><ShieldCheck size={14} />{t.keysOnDevice}</div>
      </div>

      {ANDROID ? <SitesSoon /> : <ConnectedSites />}

      <Networks settings={settings} update={update} focus={focusNets} />

      {}
      <div className="group"><div className="gt">{t.sNotify}</div>
        <div className="list">
          <Row icon={<Bell size={16} />} label={t.sNotifyOn} onClick={() => void toggleNotify()}>
            <span className={"switch" + (settings.notify ? " on" : "")} />
          </Row>
        </div>
        <div className="faint" style={{ fontSize: 12, margin: "6px 4px 0", lineHeight: 1.6 }}>{t.sNotifyNote}</div>
        {notifyErr && <div className="note warn" style={{ marginTop: 8 }}>{notifyErr}</div>}
      </div>

      {}
      <div className="group"><div className="gt">{t.sFees}</div>
        <div className="list">
          <Row icon={<Fuel size={16} />} label={t.sGasSpeed}>
            <div className="seg">{GAS_SPEEDS.map((s) => <button key={s} className={(settings.gasSpeed ?? "normal") === s ? "on" : ""} onClick={() => update({ gasSpeed: s })}>{gasSpeedLabel(t, s)}</button>)}</div>
          </Row>
        </div>
        <div className="faint" style={{ fontSize: 12, margin: "6px 4px 0", lineHeight: 1.6 }}>{t.sGasSpeedNote}</div>
      </div>

      <div className="group"><div className="gt">{t.sDisplay}</div>
        <div className="list">
          <Row icon={<Languages size={16} />} label={t.sLanguage}>
            <div className="seg"><button className={settings.lang === "ar" ? "on" : ""} onClick={() => update({ lang: "ar" })}>العربية</button><button className={settings.lang === "en" ? "on" : ""} onClick={() => update({ lang: "en" })}>English</button></div>
          </Row>
          <Row icon={<span style={{ fontWeight: 700, fontSize: 13 }}>$</span>} label={t.sCurrency}>
            <div className="seg">{(["USD", "SAR"] as const).map((c) => <button key={c} className={settings.currency === c ? "on" : ""} onClick={() => update({ currency: c })}>{c}</button>)}</div>
          </Row>
          <Row icon={settings.theme === "dark" ? <Moon size={16} /> : <Palette size={16} />} label={t.sTheme}>
            <div className="seg"><button className={settings.theme === "dark" ? "on" : ""} onClick={() => update({ theme: "dark" })}>{t.themeDark}</button><button className={settings.theme === "light" ? "on" : ""} onClick={() => update({ theme: "light" })}>{t.themeLight}</button></div>
          </Row>
          <Row icon={<EyeOff size={16} />} label={t.sHideBalances} onClick={() => update({ hideBalances: !settings.hideBalances })}>
            <span className={"switch" + (settings.hideBalances ? " on" : "")} />
          </Row>
          <Row icon={<ListFilter size={16} />} label={t.hideZero} onClick={() => update({ hideZero: !settings.hideZero })}>
            <span className={"switch" + (settings.hideZero ? " on" : "")} />
          </Row>
          <Row icon={<HandCoins size={16} />} label={t.sZakat} onClick={() => update({ zakat: !settings.zakat })}>
            <span className={"switch" + (settings.zakat ? " on" : "")} />
          </Row>
        </div>
      </div>

      <div className="group"><div className="gt">{t.sAbout}</div>
        <div className="list">
          <Row icon={<ShieldCheck size={16} />} label={t.version} value={<span className="num">{VERSION}</span>} />
          <Row icon={<Globe size={16} />} label={t.website} onClick={() => chrome.tabs.create({ url: "https://madarwallet.app" })}><ExternalLink size={14} className="muted" /></Row>
          <Row icon={<Mail size={16} />} label={t.supportEmail} value={<span dir="ltr" style={{ userSelect: "text", display: "grid", gap: 2, textAlign: "end" }}><span>contact@madarwallet.app</span></span>} />
          {!ANDROID && <Row icon={<Maximize2 size={16} />} label={t.sWindow} onClick={() => chrome.tabs.create({ url: chrome.runtime.getURL("index.html") })} />}
        </div>
        <div className="note warn" style={{ marginTop: 10 }}><ShieldAlert size={16} />{t.scamNote}</div>
      </div>

      <div className="group"><div className="gt">{t.sDanger}</div>
        <div className="list">
          {settings.accounts.length > 1 && <Row icon={<Trash2 size={16} />} label={t.sHideAccount} danger onClick={() => toggle("hideacc")} />}
          {open === "hideacc" && settings.accounts.length > 1 && <div style={{ padding: "0 14px 14px" }}><div className="sheet">
            <div className="t1" style={{ fontWeight: 700 }}>{fill(t.hideAccAsk, { a: accName(t, settings, settings.accountIndex) })}</div>
            <div className="faint" style={{ fontSize: 13 }}>{t.hideAccNote2}</div>
            <div className="row" style={{ gap: 8 }}>
              <button className="btn ghost" style={{ flex: 1 }} onClick={() => setOpen("")}>{t.cancel}</button>
              <button className="btn danger" style={{ flex: 1 }} onClick={async () => { const rest = settings.accounts.filter((a) => a.index !== settings.accountIndex); await update({ accounts: rest, accountIndex: rest[0].index }); setOpen(""); say(t.done); }}>{t.hideAccBtn}</button>
            </div>
          </div></div>}
          <Row icon={<LogOut size={16} />} label={t.sLogout} danger onClick={() => toggle("remove")} />
          {open === "remove" && <div style={{ padding: "0 14px 14px" }}><Logout email={!!settings.login} onCancel={() => setOpen("")} /></div>}
        </div>
      </div>

      <UpdateSettings />
    </div>
  );
}

function AddressBook({ book }: { book: BookEntry[] }) {
  const { t } = useT();
  const [edit, setEdit] = useState<string | null>(null), [label, setLabel] = useState(""), [err, setErr] = useState("");
  const FAMS: [Family, string][] = [["evm", t.famEvm], ["solana", SOL.name], ["btc", BTC.name], ["tron", TRON.name], ["ton", "TON"], ...EXTRA_COINS.map((c) => [c.family, c.name] as [Family, string])];
  const key = (e: BookEntry) => `${e.family}|${e.address}`;
  async function rename(e: BookEntry) {
    setErr("");
    try { await renameAddress(e.family, e.address, label); setEdit(null); } catch { setErr(t.bookErrLabel); }
  }
  return (
    <div className="sheet">
      <div className="faint" style={{ fontSize: 12, fontWeight: 600 }}>{t.bookAdd}</div>
      <AddAddressForm />
      {!book.length && <div className="faint" style={{ fontSize: 13 }}>{t.bookEmpty}</div>}
      {FAMS.map(([fam, name]) => {
        const list = forFamily(book, fam);
        if (!list.length) return null;
        return (
          <div key={fam} className="stack" style={{ gap: 6 }}>
            <div className="faint" style={{ fontSize: 12, fontWeight: 600 }}>{name}</div>
            {list.map((e) => (
              <div key={key(e)} className="stack" style={{ gap: 6 }}>
                <div className="between">
                  <div style={{ minWidth: 0 }}>
                    <div className="t1"><bdi>{e.label}</bdi></div>
                    <div className="t2 mono" dir="ltr" style={{ fontSize: 12, wordBreak: "break-all" }}>{e.address}</div>
                  </div>
                  <div className="row" style={{ gap: 2, flex: "none" }}>
                    <button className="iconbtn" title={t.sRename} aria-label={t.sRename} onClick={() => { setEdit(edit === key(e) ? null : key(e)); setLabel(e.label); setErr(""); }}><Pencil size={15} /></button>
                    <button className="iconbtn" title={t.sDelete} aria-label={t.sDelete} onClick={() => void deleteAddress(e.family, e.address)}><Trash2 size={15} /></button>
                  </div>
                </div>
                {edit === key(e) && (
                  <div className="row" style={{ gap: 6 }}>
                    <input className="input" style={{ flex: 1, minWidth: 0 }} maxLength={LABEL_MAX * 2} value={label} onChange={(x) => setLabel(x.target.value)} />
                    <button className="btn primary" disabled={!cleanLabel(label)} onClick={() => rename(e)}>{t.save}</button>
                  </div>
                )}
                {edit === key(e) && err && <div className="err">{err}</div>}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function Networks({ settings, update, focus }: { settings: Settings; update: Update; focus?: boolean }) {
  const { t } = useT();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (focus) ref.current?.scrollIntoView({ block: "start" }); }, [focus]);
  const cap = (n: Network) => (!swapsOn(n) ? t.netCapBasic : crossTo(n) ? t.netCapIn : t.netCapSwap);

  const [q, setQ] = useState("");
  const shown = POPULAR.filter((n) => !q.trim() || n.name.toLowerCase().includes(q.trim().toLowerCase()) || n.id.includes(q.trim().toLowerCase()))
    .sort((a, b) => Number(!!settings.networksOn?.includes(b.id)) - Number(!!settings.networksOn?.includes(a.id)));
  return (
    <div className="group" ref={ref} style={{ scrollMarginTop: 84 }}><div className="gt">{t.sNets}</div>
      {POPULAR.length > 10 && <input className="input" style={{ marginBottom: 8 }} placeholder={t.netSearch} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t.netSearch} />}
      <div className="list">
        {shown.map((n) => {
          const on = !!settings.networksOn?.includes(n.id);
          return (
            <button key={n.id} className="setrow" role="switch" aria-checked={on} onClick={() => { const p = networksOnPatch(settings, n.id, !on); if (p) void update(p); }}>
              <NetworkDot id={n.id} size={32} />
              <span className="grow"><span className="t1" style={{ display: "block" }}>{n.name}</span><span className="t2" style={{ display: "block" }}>{cap(n)}</span></span>
              <span className={"switch" + (on ? " on" : "")} />
            </button>
          );
        })}
      </div>
      <div className="faint" style={{ fontSize: 12, marginTop: 6 }}>{t.netsNote}</div>
      <div className="faint" style={{ fontSize: 12, marginTop: 4 }}>{t.netsAlways} <bdi dir="ltr">{[BTC.name, SOL.name, TRON.name, "TON", ...EXTRA_COINS.map((c) => c.name), ...NETWORKS.map((n) => n.name)].join(" · ")}</bdi></div>
    </div>
  );
}

function SitesSoon() {
  const { t } = useT();
  return (
    <div className="group"><div className="gt">{t.dSites}</div>
      <div className="list">
        <Row icon={<Globe size={16} />} label={t.dSitesSoon}><span className="faint" style={{ fontSize: 12 }}>{t.soon}</span></Row>
      </div>
      <div className="faint" style={{ fontSize: 12, marginTop: 6 }}>{t.dSitesSoonNote}</div>
    </div>
  );
}

function ConnectedSites() {
  const { t } = useT();
  const [sites, setSites] = useState<[string, SitePerm][] | null>(null);
  const load = useCallback(() => void getSitePerms().then((p) => setSites(Object.entries(p).filter(([, v]) => v.evm || v.sol))), []);
  useEffect(() => {
    load();
    const on = (c: Record<string, chrome.storage.StorageChange>, area: string) => { if (area === "local" && "sitePerms" in c) load(); };
    chrome.storage.onChanged.addListener(on);
    return () => chrome.storage.onChanged.removeListener(on);
  }, [load]);
  if (!sites) return null;
  return (
    <div className="group"><div className="gt">{t.dSites}</div>
      <div className="list">
        {sites.length === 0 && <Row icon={<Globe size={16} />} label={t.dNoSites} />}
        {sites.map(([origin, p]) => (
          <Row key={origin} icon={<Globe size={16} />} label={origin.replace("https://", "")} value={[p.evm && "EVM", p.sol && "Solana"].filter(Boolean).join(" · ")}>
            <button className="btn ghost" style={{ height: 30, padding: "0 10px", fontSize: 12 }} onClick={async () => { await setSitePerm(origin, null); void touch(); }}>{t.dDisconnect}</button>
          </Row>
        ))}
      </div>
      <div className="faint" style={{ fontSize: 12, marginTop: 6 }}>{t.dSitesNote}</div>
    </div>
  );
}

function Rename({ settings, update, done }: { settings: Settings; update: Update; done: () => void }) {
  const { t } = useT();
  const [name, setName] = useState(settings.accounts.find((a) => a.index === settings.accountIndex)?.name ?? "");
  return (
    <div className="sheet">
      <input className="input" maxLength={24} value={name} placeholder={`${t.account} ${settings.accountIndex + 1}`} onChange={(e) => setName(e.target.value)} />
      <button className="btn primary block" onClick={async () => { await update({ accounts: settings.accounts.map((a) => (a.index === settings.accountIndex ? { ...a, name: name.trim(), named: Date.now() } : a)) }); done(); }}>{t.save}</button>
    </div>
  );
}

function ChangePw({ done, email }: { done: () => void; email?: boolean }) {
  const { t } = useT();
  const [oldPw, setOld] = useState(""), [a, setA] = useState(""), [b, setB] = useState(""), [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true); setErr("");
    try { await changePassword(oldPw, a); done(); } catch (e) { setErr(pwError(t, e)); }
    setBusy(false);
  }
  return (
    <div className="sheet">
      <input className="input" type="password" placeholder={t.sCurrentPw} value={oldPw} onChange={(e) => setOld(e.target.value)} />
      <input className="input" type="password" autoComplete="new-password" placeholder={`${t.sNewPw} — ${t.pwMinStrong}`} value={a} onChange={(e) => setA(e.target.value)} />
      <StrengthMeter pw={a} />
      {a.length >= BACKUP_MIN_PASSWORD && !strongEnough(a) && <div className="err">{t.pwWeak}</div>}
      <input className="input" type="password" placeholder={t.pwRepeat} value={b} onChange={(e) => setB(e.target.value)} />
      {b && a !== b && <div className="err">{t.pwMismatch}</div>}
      {err && <div className="err">{err}</div>}
      <button className="btn primary block" disabled={busy || !oldPw || !strongEnough(a) || a !== b} onClick={go}>{busy ? t.encrypting : t.save}</button>
    </div>
  );
}

function Reveal() {
  const { t } = useT();
  const [pw, setPw] = useState(""), [shown, setShown] = useState<string | null>(null), [err, setErr] = useState("");
  async function go() { setErr(""); try { setShown(await checkPassword(pw)); setPw(""); } catch (e) { setErr(pwError(t, e)); } }
  return (
    <div className="sheet">
      <div className="note warn"><TriangleAlert size={16} />{t.sRevealWarn}</div>
      {shown ? (
        <><Words phrase={shown} /><button className="btn ghost block" onClick={() => setShown(null)}><EyeOff size={16} />{t.hide}</button></>
      ) : (
        <><input className="input" type="password" placeholder={t.password} value={pw} onChange={(e) => setPw(e.target.value)} />
          {err && <div className="err">{err}</div>}
          <button className="btn primary block" disabled={!pw} onClick={go}><Eye size={16} />{t.show}</button></>
      )}
    </div>
  );
}

function Logout({ email, onCancel }: { email: boolean; onCancel: () => void }) {
  const { t } = useT();
  const [ok, setOk] = useState(false), [pw, setPw] = useState(""), [err, setErr] = useState(""), [busy, setBusy] = useState(false);

  async function go() { setErr(""); setBusy(true); try { await checkPassword(pw); await wipe(); } catch (e) { setErr(pwError(t, e)); setBusy(false); } }
  return (
    <div className="sheet">
      <div className="t1" style={{ fontWeight: 700 }}>{t.logoutAsk}</div>
      <div className="note bad"><TriangleAlert size={16} />{email ? t.logoutWarnEmail : t.logoutWarnWords}</div>
      <label className="row" style={{ gap: 8, fontSize: 13, cursor: "pointer" }}><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} />{email ? t.logoutOkEmail : t.logoutOkWords}</label>
      <input className="input" type="password" placeholder={t.password} value={pw} onChange={(e) => setPw(e.target.value)} />
      {err && <div className="err">{err}</div>}
      <div className="row" style={{ gap: 8 }}>
        <button className="btn ghost" style={{ flex: 1 }} onClick={onCancel}>{t.cancel}</button>
        <button className="btn danger" style={{ flex: 1 }} disabled={!ok || !pw || busy} onClick={go}><LogOut size={16} />{t.sLogout}</button>
      </div>
    </div>
  );
}
