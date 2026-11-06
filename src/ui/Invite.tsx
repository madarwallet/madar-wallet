import { useEffect, useState } from "react";
import { Check, CircleCheck, Copy, Gift, Link2, TriangleAlert } from "lucide-react";
import { checkCode, claimCode, defaultCode, fetchStatus, INVITE_KEY, inviteLink, linkAll, loadInvite, loadMyCode, loadStatus, MINE_KEY, normalizeCode, ownCode, ownCodeOf, saveStatus, STATUS_KEY, type InviteState, type InviteStatus, type LinkError, type MyCode } from "../core/invite";
import { feeBpsFor, setFeeDiscount } from "../core/swap";
import { evmAccount, evmAddress } from "../core/account";
import type { Settings } from "../core/store";
import { fill, useT, type Dict } from "./i18n";
import { ANDROID } from "../platform";

export function inviteAccounts(phrase: string, settings: Settings) {
  const out: { address: string; sign: (hash: `0x${string}`) => Promise<`0x${string}`> }[] = [];
  for (const a of settings.accounts) {
    try {
      out.push({ address: evmAddress(phrase, a.index), sign: (hash) => evmAccount(phrase, a.index).sign({ hash }) });
    } catch {  }
  }
  return out;
}

export function useInvite(): [InviteState | null | undefined, (s: InviteState | null) => void] {
  const [inv, setInv] = useState<InviteState | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void loadInvite().then((s) => live && setInv(s));
    const on = (ch: Record<string, chrome.storage.StorageChange>, area: string) => { if (area === "local" && INVITE_KEY in ch) void loadInvite().then((s) => live && setInv(s)); };
    chrome.storage.onChanged?.addListener(on);
    return () => { live = false; chrome.storage.onChanged?.removeListener(on); };
  }, []);
  return [inv, setInv];
}

export function useInviteSync(phrase: string, settings: Settings) {
  const n = settings.accounts.length;
  useEffect(() => {
    let live = true;
    void (async () => {
      const s = await loadInvite();
      if (!live || !s || !s.linked.length) return;
      const accs = inviteAccounts(phrase, settings).filter((a) => !s.linked.includes(a.address.toLowerCase()) && !s.other?.[a.address.toLowerCase()]);
      if (accs.length) await linkAll(s.code, accs, s);
    })().catch(() => {});
    return () => { live = false; };
  }, [phrase, n]); // eslint-disable-line react-hooks/exhaustive-deps
}

const errText = (t: Dict, e: LinkError | "unknown" | "bad" | "net") =>
  e === "unknown" ? t.invUnknown : e === "bad" ? t.invBad : e === "net" ? t.invNet : e === "own" ? t.invOwn : t.invFail;

function firstAccount(phrase: string, settings: Settings) {
  return inviteAccounts(phrase, settings)[0] ?? null;
}

function applyStatus(s: InviteStatus | null, account: string | null) {
  setFeeDiscount(!!s && !!account && s.account === account.toLowerCase() && feeBpsFor(s) !== feeBpsFor(null));
}

export async function refreshInviteFee(phrase: string, settings: Settings): Promise<InviteStatus | null> {
  const a = firstAccount(phrase, settings);
  if (!a) { applyStatus(null, null); return null; }
  const s = await fetchStatus(a.address);
  if (s) { await saveStatus(s); applyStatus(s, a.address); }
  return s;
}

export function useInviteFee(phrase: string, settings: Settings) {
  const first = settings.accounts[0]?.index;
  useEffect(() => {
    let live = true;
    const a = firstAccount(phrase, settings);
    void loadStatus().then((s) => { if (live) applyStatus(s, a?.address ?? null); });
    void refreshInviteFee(phrase, settings).catch(() => {});
    const on = (ch: Record<string, chrome.storage.StorageChange>, area: string) => { if (area === "local" && STATUS_KEY in ch) void loadStatus().then((s) => live && applyStatus(s, a?.address ?? null)); };
    chrome.storage.onChanged?.addListener(on);
    return () => { live = false; chrome.storage.onChanged?.removeListener(on); };
  }, [phrase, first]); // eslint-disable-line react-hooks/exhaustive-deps
}

export function useMyCode(): [MyCode | null | undefined, (c: MyCode | null) => void] {
  const [mine, setMine] = useState<MyCode | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void loadMyCode().then((c) => live && setMine(c));
    const on = (ch: Record<string, chrome.storage.StorageChange>, area: string) => { if (area === "local" && MINE_KEY in ch) void loadMyCode().then((c) => live && setMine(c)); };
    chrome.storage.onChanged?.addListener(on);
    return () => { live = false; chrome.storage.onChanged?.removeListener(on); };
  }, []);
  return [mine, setMine];
}

export function MyCodeBox({ phrase, settings, mine, setMine, say }: { phrase: string; settings: Settings; mine: MyCode | null | undefined; setMine: (c: MyCode | null) => void; say: (m: string) => void }) {
  const { t } = useT();
  const first = firstAccount(phrase, settings);
  const [code, setCode] = useState(() => (first ? defaultCode(first.address) : ""));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState("");
  const [status, setStatus] = useState<InviteStatus | null>(null);
  useEffect(() => {
    let live = true;
    void loadStatus().then((s) => live && setStatus(s));

    void refreshInviteFee(phrase, settings).then((s) => live && s && setStatus(s)).catch(() => {});
    return () => { live = false; };
  }, [mine]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!first) return <div className="sheet"><div className="faint" style={{ fontSize: 12.5 }}>{t.invNet}</div></div>;
  const copy = (v: string, which: string) => { void navigator.clipboard.writeText(v); setCopied(which); };
  const own = ownCode(first.address, mine, status);
  if (own) {
    const link = inviteLink(own);
    const isName = !(mine && mine.account === first.address.toLowerCase()) && status?.name === true;
    const on = !!status && String(status.account ?? "").toLowerCase() === first.address.toLowerCase() && feeBpsFor(status) !== feeBpsFor(null);
    return (
      <div className="sheet">
        {isName && <div className="faint" style={{ fontSize: 12.5, lineHeight: 1.7, marginBottom: 8 }}>{t.invByName}</div>}
        <div className="kv"><span>{t.invMineTitle}</span><span className="num" dir="ltr">{own}</span>
          <button className="iconbtn" aria-label={t.copy} onClick={() => copy(own, "code")}>{copied === "code" ? <Check size={15} /> : <Copy size={15} />}</button></div>
        <div className="kv"><span>{t.invMyLink}</span><span className="num" dir="ltr" style={{ fontSize: 11.5, overflowWrap: "anywhere" }}>{link}</span>
          <button className="iconbtn" aria-label={t.copy} onClick={() => copy(link, "link")}>{copied === "link" ? <Check size={15} /> : <Copy size={15} />}</button></div>
        <div className={`note ${on ? "info" : ""}`} style={{ marginTop: 10 }}>{on ? <CircleCheck size={16} /> : <Gift size={16} />}<span>{on ? t.invDiscount : t.invNoDiscount}</span></div>
      </div>
    );
  }
  const claim = async () => {
    setErr("");
    const c = ownCodeOf(code);
    if (!c) { setErr(t.invShort); return; }
    setBusy(true);
    try {
      const r = await claimCode(c, first.address, first.sign);
      if ("ok" in r || r.error === "has") {
        setMine({ code: r.code, account: first.address.toLowerCase() });
        say(t.done);
        void refreshInviteFee(phrase, settings).then((s) => s && setStatus(s)).catch(() => {});
        return;
      }
      setErr(r.error === "taken" ? t.invTaken : r.error === "name" ? t.invNameTaken : r.error === "bad" ? t.invShort : r.error === "net" ? t.invNet : t.invFail);
    } finally { setBusy(false); }
  };
  return (
    <div className="sheet">
      <div className="faint" style={{ fontSize: 12.5, lineHeight: 1.7, marginBottom: 10 }}>{t.invMineNote}</div>
      <div className="row" style={{ gap: 8 }}>
        <input className="input" style={{ flex: 1, minWidth: 0 }} dir="ltr" value={code} maxLength={32} placeholder={t.invMinePh} autoCapitalize="none" autoCorrect="off" spellCheck={false}
          onChange={(e) => { setCode(e.target.value); setErr(""); }} onKeyDown={(e) => { if (e.key === "Enter" && !busy && code.trim()) void claim(); }} />
        <button className="btn primary" style={{ flex: "none" }} disabled={busy || !code.trim()} onClick={() => void claim()}><Gift size={16} />{busy ? t.invClaimBusy : t.invClaimBtn}</button>
      </div>
      {err && <div className="note warn" style={{ marginTop: 10 }}><TriangleAlert size={16} /><span>{err}</span></div>}
      <div className="faint" style={{ fontSize: 12, lineHeight: 1.7, marginTop: 10 }}>
        {t.invGetName}{" "}
        {ANDROID
          ? <span>{t.invGetNameApp}</span>
          : <button className="linkbtn" onClick={() => void chrome.tabs.create({ url: "https://madarwallet.app/names/" })}>{t.freeNameGo}</button>}
      </div>
    </div>
  );
}

export function InviteBox({ phrase, settings, inv, setInv, say }: { phrase: string; settings: Settings; inv: InviteState | null | undefined; setInv: (s: InviteState | null) => void; say: (m: string) => void }) {
  const { t } = useT();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const others = Object.values(inv?.other ?? {});
  if (inv && inv.linked.length)
    return (
      <div className="sheet">
        <div className="note info"><CircleCheck size={16} /><span>{fill(t.invLinked, { c: inv.code })}</span></div>
        {others.length > 0 && <div className="faint" style={{ fontSize: 12, marginTop: 8, lineHeight: 1.6 }}>{fill(t.invOther, { c: others[0] })}</div>}
      </div>
    );
  const link = async () => {
    setErr("");
    const c = normalizeCode(code);
    if (!c) { setErr(t.invBad); return; }
    setBusy(true);
    try {
      const chk = await checkCode(c);
      if (chk !== "ok") { setErr(errText(t, chk)); return; }
      const { state, result } = await linkAll(c, inviteAccounts(phrase, settings), inv ?? null);
      setInv(state);
      if (state.linked.length) { say(t.done); void refreshInviteFee(phrase, settings).catch(() => {}); return; }
      const other = Object.values(state.other ?? {})[0];
      setErr(other ? fill(t.invOther, { c: other }) : errText(t, result.failed ?? "net"));
    } finally { setBusy(false); }
  };
  return (
    <div className="sheet">
      <div className="faint" style={{ fontSize: 12.5, lineHeight: 1.7, marginBottom: 10 }}>{t.invNote}</div>
      <div className="row" style={{ gap: 8 }}>
        <input className="input" style={{ flex: 1, minWidth: 0 }} dir="ltr" value={code} maxLength={40} placeholder={t.invPh} autoCapitalize="none" autoCorrect="off" spellCheck={false}
          onChange={(e) => { setCode(e.target.value); setErr(""); }} onKeyDown={(e) => { if (e.key === "Enter" && !busy && code.trim()) void link(); }} />
        <button className="btn primary" style={{ flex: "none" }} disabled={busy || !code.trim()} onClick={() => void link()}><Link2 size={16} />{busy ? t.invBusy : t.invBtn}</button>
      </div>
      {err && <div className="note warn" style={{ marginTop: 10 }}><TriangleAlert size={16} /><span>{err}</span></div>}
    </div>
  );
}
