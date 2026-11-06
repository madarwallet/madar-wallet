import { RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { BOOK_KEY, BOOK_SYNC_KEY, GONE_KEY } from "../core/addressbook";
import type { BookKeys, SyncStatus } from "../core/booksync";
import { DISCOVER_FLAG, type AccountMeta, type Settings } from "../core/store";
import { fill, useT } from "./i18n";
import type { Update } from "./common";

const RETRY_MAX = 15 * 60_000;
const STALE = 5 * 60_000;

export function useBookSync(phrase: string, on: boolean) {
  useEffect(() => {
    if (!on) return;
    let live = true, busy = false, again = false, synced = "", fails = 0, last = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let keys: Promise<BookKeys> | null = null;
    const later = (ms: number, why: "open" | "change" | "retry") => { clearTimeout(timer); timer = setTimeout(() => void run(why), ms); };
    async function run(why: "open" | "change" | "retry") {
      if (!live) return;
      if (busy) { again = true; return; }
      busy = true;
      try {
        const m = await import("../core/booksync");
        if (why === "change" && !fails && synced && m.canon(await m.loadState()) === synced) return;
        keys ??= m.bookKeys(phrase);
        const r = await m.syncBook(await keys);
        synced = r.canon;
        fails = 0;
        if (live) await m.recordSync(true);
      } catch {
        keys = null;
        fails++;
        if (live) {
          await import("../core/booksync").then((m) => m.recordSync(false)).catch(() => {});
          later(Math.min(RETRY_MAX, 60_000 * 2 ** (fails - 1)), "retry");
        }
      } finally {
        busy = false;
        last = Date.now();
        if (again && live) { again = false; later(300, "change"); }
      }
    }
    void run("open");
    const onChange = (c: Record<string, chrome.storage.StorageChange>, area: string) => { if (area === "local" && (BOOK_KEY in c || GONE_KEY in c)) later(1500, "change"); };
    const onShow = () => { if (document.visibilityState === "visible" && !busy && Date.now() - last > STALE) later(0, "open"); };
    chrome.storage.onChanged.addListener(onChange);
    document.addEventListener("visibilitychange", onShow);
    return () => { live = false; clearTimeout(timer); chrome.storage.onChanged.removeListener(onChange); document.removeEventListener("visibilitychange", onShow); };
  }, [phrase, on]);
}

export function useAccountsSync(phrase: string, on: boolean, accounts: readonly AccountMeta[], update: Update) {
  const ref = useRef(accounts); ref.current = accounts;
  const upd = useRef(update); upd.current = update;
  const key = JSON.stringify(accounts.filter((a) => !a.imported).map((a) => [a.index, a.name, a.named ?? 0]));
  const state = useRef<{ synced: string; keys: Promise<BookKeys> | null; busy: boolean; fails: number; timer?: ReturnType<typeof setTimeout> }>({ synced: "", keys: null, busy: false, fails: 0 });
  useEffect(() => {
    if (!on) return;
    let live = true;
    const s = state.current;
    async function run() {
      if (!live || s.busy) return;
      s.busy = true;
      try {
        const m = await import("../core/accountsync");
        if (s.synced && m.accCanon(m.recsOf(ref.current)) === s.synced) return;
        s.keys ??= m.accountKeys(phrase);
        const r = await m.syncAccounts(await s.keys, async () => ref.current, async (merged) => { await upd.current({ accounts: m.applyAcc(ref.current, merged) }); });
        s.synced = r.canon; s.fails = 0;
      } catch {
        s.keys = null; s.fails++;
        if (live) { clearTimeout(s.timer); s.timer = setTimeout(() => void run(), Math.min(RETRY_MAX, 60_000 * 2 ** (s.fails - 1))); }
      } finally { s.busy = false; }
    }
    clearTimeout(s.timer);
    s.timer = setTimeout(() => void run(), s.synced ? 1500 : 0);
    return () => { live = false; clearTimeout(s.timer); };
  }, [phrase, on, key]);
}

export function useDiscoverAccounts(phrase: string, accounts: readonly AccountMeta[], update: Update) {
  const ref = useRef(accounts); ref.current = accounts;
  useEffect(() => {
    let live = true;
    void Promise.resolve(chrome.storage.local.get(DISCOVER_FLAG)).then(async (r) => {
      if (!live || !r?.[DISCOVER_FLAG]) return;
      const m = await import("../core/discover");
      const found = await m.discoverAccounts(m.makeProbe(phrase)).catch(() => null);
      if (!live || found == null) return;
      await chrome.storage.local.remove(DISCOVER_FLAG);
      const add = found.filter((i) => !ref.current.some((a) => a.index === i)).map((index) => ({ index, name: "" }));
      if (add.length) await update({ accounts: [...ref.current.filter((a) => !a.imported), ...add].sort((x, y) => x.index - y.index).concat(ref.current.filter((a) => a.imported)) });
    }, () => {});
    return () => { live = false; };
  }, [phrase]); // eslint-disable-line react-hooks/exhaustive-deps
}

function useSyncStatus(): SyncStatus {
  const [st, setSt] = useState<SyncStatus>({});
  useEffect(() => {
    let live = true;
    const load = () => void Promise.resolve(chrome.storage.local.get(BOOK_SYNC_KEY)).then((r) => { if (live) setSt((r?.[BOOK_SYNC_KEY] as SyncStatus | undefined) ?? {}); }, () => {});
    load();
    const on = (c: Record<string, chrome.storage.StorageChange>, area: string) => { if (area === "local" && BOOK_SYNC_KEY in c) load(); };
    chrome.storage.onChanged.addListener(on);
    return () => { live = false; chrome.storage.onChanged.removeListener(on); };
  }, []);
  return st;
}

export function BookSyncRow({ settings, update }: { settings: Settings; update: Update }) {
  const { t, lang } = useT();
  const st = useSyncStatus();
  const on = !!settings.bookSync;
  const when = (ms: number) => new Date(ms).toLocaleString(lang === "ar" ? "ar-SA-u-nu-latn-ca-gregory" : "en-US", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const status = !on ? t.bookSyncNote : st.failAt && st.failAt > (st.okAt ?? 0) ? t.bookSyncFail : st.okAt ? fill(t.bookSyncOk, { t: when(st.okAt) }) : t.bookSyncBusy;
  async function flip() {
    if (!on) await chrome.storage.local.remove(BOOK_SYNC_KEY);
    await update({ bookSync: !on });
  }
  return (
    <button className="setrow" role="switch" aria-checked={on} onClick={() => void flip()}>
      <span className="ic"><RefreshCw size={16} /></span>
      <span className="grow"><span style={{ display: "block" }}>{t.sBookSync}</span><span className="faint" style={{ display: "block", fontSize: 12, marginTop: 2, lineHeight: 1.5 }}>{status}</span></span>
      <span className={"switch" + (on ? " on" : "")} />
    </button>
  );
}
