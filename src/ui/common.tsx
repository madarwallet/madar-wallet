import { ListFilter, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { onBalancesChanged } from "../core/balbus";
import { BOOK_KEY, cleanAddress, FAMILIES, LABEL_MAX, loadBook, saveAddress, type BookEntry, type Family } from "../core/addressbook";
import type { Market } from "../core/market";
import { isMadarName } from "../core/names";
import { formatUnitsStr } from "../core/solbase";
import type { Settings } from "../core/store";
import { useT, type Dict } from "./i18n";

export type Tab = "assets" | "explore" | "trade" | "p2p" | "tokens" | "send" | "receive" | "swap" | "buy" | "activity" | "settings";
export type Update = (p: Partial<Settings>) => Promise<void>;
export const VERSION = (globalThis as { chrome?: { runtime?: { getManifest?: () => { version: string } } } }).chrome?.runtime?.getManifest?.().version ?? "dev";

export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export const amt = (s: string, hint?: number | string) => {
  const n = Number(s);
  if (n === 0) return "0";
  if (hint === 8 || (typeof hint === "string" && /BTC$/i.test(hint))) return n.toLocaleString("en-US", { maximumFractionDigits: 8 });
  return n < 0.0001 ? "<0.0001" : n.toLocaleString("en-US", { maximumFractionDigits: 6 });
};
export const money = (n: number | null, cur: string) => (n == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: cur, maximumFractionDigits: 2 }).format(n));
export const STABLES = new Set(["USDC", "USDT", "DAI", "DAI.e", "USDC.e"]);

export function byHoldings<T>(list: T[], amount: (x: T) => number, value: (x: T) => number | null): T[] {
  return list.map((x, i) => ({ x, i })).sort((a, b) => {
    const ha = amount(a.x) > 0 ? 1 : 0, hb = amount(b.x) > 0 ? 1 : 0;
    if (ha !== hb) return hb - ha;
    if (ha) { const d = (value(b.x) ?? 0) - (value(a.x) ?? 0); if (d) return d; return amount(b.x) - amount(a.x); }
    return a.i - b.i;
  }).map((y) => y.x);
}

export const accName = (t: Dict, s: Settings, index: number) => s.accounts.find((a) => a.index === index)?.name || (index >= 1_000_000 ? `${t.impDefault} ${index - 1_000_000 + 1}` : `${t.account} ${index + 1}`);

export const fillNodes = (s: string, vars: Record<string, string>) => s.split(/\{(\w+)\}/).map((part, i) => (i % 2 ? <bdi key={i} dir="ltr">{vars[part] ?? ""}</bdi> : part));

export function useToast(): [ReactNode, (m: string) => void] {
  const [msg, setMsg] = useState("");
  useEffect(() => { if (msg) { const id = setTimeout(() => setMsg(""), 1600); return () => clearTimeout(id); } }, [msg]);
  return [msg ? <div className="toast">{msg}</div> : null, setMsg];
}

export function ZeroToggle({ settings, update }: { settings: Settings; update: Update }) {
  const { t } = useT();
  const on = !!settings.hideZero;
  return <button className={"iconbtn" + (on ? " active" : "")} title={on ? t.showZero : t.hideZero} aria-pressed={on} onClick={() => update({ hideZero: !on })}><ListFilter size={15} /></button>;
}

export function RefreshBtn({ onClick }: { onClick: () => Promise<void> | void }) {
  const { t } = useT();
  const [spin, setSpin] = useState(false);
  async function go() {
    if (spin) return;
    setSpin(true);
    await Promise.all([Promise.resolve(onClick()).catch(() => {}), new Promise((r) => setTimeout(r, 600))]);
    setSpin(false);
  }
  return <button className="iconbtn" title={t.refresh} onClick={go} disabled={spin}><RefreshCw size={15} className={spin ? "spin" : undefined} /></button>;
}

export function PctRow({ getMax, decimals, onPick, disabled }: { getMax: () => Promise<bigint>; decimals: number; onPick: (v: string) => void; disabled?: boolean }) {
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  async function pick(pct: bigint) {
    setBusy(true);
    try { onPick(formatUnitsStr((await getMax()) * pct / 100n, decimals)); } catch {  }
    setBusy(false);
  }
  return (
    <div className="pct">
      {[25n, 50n, 75n, 100n].map((p) => <button key={String(p)} type="button" disabled={busy || disabled} onClick={() => pick(p)}>{p === 100n ? t.max : `${p}%`}</button>)}
    </div>
  );
}

export function useBook(): BookEntry[] {
  const [list, setList] = useState<BookEntry[]>([]);
  useEffect(() => {
    let live = true;
    const load = () => void loadBook().then((l) => { if (live) setList(l); }).catch(() => {});
    load();
    const on = (c: Record<string, chrome.storage.StorageChange>, area: string) => { if (area === "local" && BOOK_KEY in c) load(); };
    chrome.storage.onChanged.addListener(on);
    return () => { live = false; chrome.storage.onChanged.removeListener(on); };
  }, []);
  return list;
}

export function AddAddressForm({ family, onDone }: { family?: Family; onDone?: () => void }) {
  const { t } = useT();
  const [label, setLabel] = useState(""), [addr, setAddr] = useState(""), [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  const detect = (a: string): Family | null => {
    const v = a.trim();
    if (!v) return null;
    if (isMadarName(v)) return family === "solana" ? family : "evm";
    if (family && cleanAddress(v, family)) return family;
    for (const f of FAMILIES) if (cleanAddress(v, f)) return f;
    return null;
  };
  async function save() {
    setErr("");
    const fam = detect(addr);
    if (!fam) { setErr(t.bookErrAddr); return; }
    setBusy(true);
    try { await saveAddress(label, addr, fam); setLabel(""); setAddr(""); onDone?.(); }
    catch (e) { const m = (e as Error).message; setErr(m === "ERR_LABEL" ? t.bookErrLabel : m === "ERR_DUP" ? t.bookErrDup : m === "ERR_FULL" ? t.bookErrFull : t.bookErrAddr); }
    setBusy(false);
  }
  return (
    <div className="stack" style={{ gap: 6 }}>
      <input className="input" placeholder={t.bookNamePh} maxLength={LABEL_MAX * 2} value={label} onChange={(e) => setLabel(e.target.value)} />
      <input className="input mono" placeholder={t.bookAddrPh} value={addr} onChange={(e) => setAddr(e.target.value)} spellCheck={false} dir="ltr" />
      {err && <div className="err">{err}</div>}
      <button className="btn primary block" disabled={busy || !label.trim() || !addr.trim()} onClick={save}>{t.bookAddBtn}</button>
    </div>
  );
}

export interface CoinPart { networkId: string; networkName: string; key: string; amount: number; decimals: number; contract?: string }

export interface CoinListed { cur: string; at: number; price: number | null; change: number | null; m?: Market | null }
export interface CoinView { symbol: string; name: string; verified: boolean; cg?: string; parts: CoinPart[]; img?: string | null; listed?: CoinListed }

export function useLiveBalances(load: () => Promise<unknown>, every = 40_000): void {
  const ref = useRef(load); ref.current = load;
  useEffect(() => {
    let live = true, running = false, again = false, last = Date.now();
    const run = async () => {
      if (!live) return;
      if (running) { again = true; return; }
      running = true; last = Date.now();
      try { await ref.current(); } catch {  } finally { running = false; }
      if (again && live) { again = false; void run(); }
    };
    const off = onBalancesChanged(() => void run());
    const id = setInterval(() => { if (!document.hidden && Date.now() - last >= every - 1_000) void run(); }, every);
    const back = () => { if (!document.hidden && Date.now() - last > 10_000) void run(); };
    document.addEventListener("visibilitychange", back);
    window.addEventListener("focus", back);
    return () => { live = false; off(); clearInterval(id); document.removeEventListener("visibilitychange", back); window.removeEventListener("focus", back); };
  }, [every]);
}

export function whenVisible(): Promise<void> {
  if (typeof document === "undefined" || !document.hidden) return Promise.resolve();
  return new Promise((res) => {
    const on = () => { if (!document.hidden) { document.removeEventListener("visibilitychange", on); res(); } };
    document.addEventListener("visibilitychange", on);
  });
}
