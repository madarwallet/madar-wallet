declare const __MADAR_VERSION__: string;
import { androidPost } from "../index";

type Change = { oldValue?: unknown; newValue?: unknown };
type Listener = (changes: Record<string, Change>, area: string) => void;
const listeners = new Set<Listener>();
const emit = (changes: Record<string, Change>, area: string) => {
  if (!Object.keys(changes).length) return;
  setTimeout(() => listeners.forEach((l) => { try { l(changes, area); } catch (e) { console.error(e); } }), 0);
};

interface Backend { keys(): string[]; read(k: string): string | null; write(k: string, v: string): void; del(k: string): void }
const PREFIX = "madar.local:";
const localBackend: Backend = {
  keys: () => { const out: string[] = []; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k?.startsWith(PREFIX)) out.push(k.slice(PREFIX.length)); } return out; },
  read: (k) => localStorage.getItem(PREFIX + k),
  write: (k, v) => localStorage.setItem(PREFIX + k, v),
  del: (k) => localStorage.removeItem(PREFIX + k),
};
const mem = new Map<string, string>();
const sessionBackend: Backend = { keys: () => [...mem.keys()], read: (k) => mem.get(k) ?? null, write: (k, v) => void mem.set(k, v), del: (k) => void mem.delete(k) };

const parse = (s: string | null): unknown => (s == null ? undefined : JSON.parse(s));
type Cb<T> = ((r: T) => void) | undefined;
const done = <T>(p: Promise<T>, cb: Cb<T>) => (cb ? void p.then(cb) : p);

function area(name: "local" | "session", b: Backend) {
  async function get(keys?: string | string[] | Record<string, unknown> | null): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = {};
    if (keys == null) { for (const k of b.keys()) out[k] = parse(b.read(k)); return out; }
    if (typeof keys === "string") keys = [keys];
    if (Array.isArray(keys)) { for (const k of keys) { const v = parse(b.read(k)); if (v !== undefined) out[k] = v; } return out; }
    for (const [k, def] of Object.entries(keys)) { const v = parse(b.read(k)); out[k] = v === undefined ? def : v; }
    return out;
  }
  async function set(items: Record<string, unknown>): Promise<void> {
    const changes: Record<string, Change> = {};
    for (const [k, v] of Object.entries(items)) {
      if (v === undefined) continue;
      const json = JSON.stringify(v);
      const old = b.read(k);
      if (old === json) continue;
      b.write(k, json);
      changes[k] = old == null ? { newValue: JSON.parse(json) } : { oldValue: parse(old), newValue: JSON.parse(json) };
    }
    emit(changes, name);
  }
  async function remove(keys: string | string[]): Promise<void> {
    const changes: Record<string, Change> = {};
    for (const k of typeof keys === "string" ? [keys] : keys) { const old = b.read(k); if (old == null) continue; b.del(k); changes[k] = { oldValue: parse(old) }; }
    emit(changes, name);
  }
  async function clear(): Promise<void> {
    const changes: Record<string, Change> = {};
    for (const k of b.keys()) { changes[k] = { oldValue: parse(b.read(k)) }; b.del(k); }
    emit(changes, name);
  }
  return {
    get: (k?: string | string[] | Record<string, unknown> | null, cb?: Cb<Record<string, unknown>>) => done(get(k), cb),
    set: (o: Record<string, unknown>, cb?: Cb<void>) => done(set(o), cb),
    remove: (k: string | string[], cb?: Cb<void>) => done(remove(k), cb),
    clear: (cb?: Cb<void>) => done(clear(), cb),
    setAccessLevel: async () => {},
    onChanged: { addListener: (l: (c: Record<string, Change>) => void) => listeners.add((c, a) => a === name && l(c)), removeListener: () => {} },
  };
}

type Alarm = { name: string; scheduledTime: number };
const alarms = new Map<string, { at: number; timer: ReturnType<typeof setTimeout> }>();
const alarmListeners = new Set<(a: Alarm) => void>();
function fire(name: string) {
  const a = alarms.get(name);
  if (!a) return;
  clearTimeout(a.timer);
  alarms.delete(name);
  alarmListeners.forEach((l) => { try { l({ name, scheduledTime: a.at }); } catch (e) { console.error(e); } });
}
function checkAlarms() { const now = Date.now(); for (const [n, a] of [...alarms]) if (a.at <= now) fire(n); }
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") checkAlarms(); });
window.addEventListener("focus", checkAlarms);

const ORIGIN = location.origin;
export function openExternal(url: string) {
  let u: URL;
  try { u = new URL(url, location.href); } catch { return; }
  if (u.origin === ORIGIN) return;
  if (!["https:", "mailto:"].includes(u.protocol)) return;
  if (!androidPost({ t: "open", url: u.href })) location.href = u.href;
}
const openTab = (o: { url?: string }) => { if (o?.url) openExternal(o.url); return Promise.resolve(undefined); };

(globalThis as unknown as { chrome: unknown }).chrome = {
  storage: {
    local: area("local", localBackend),
    session: area("session", sessionBackend),
    onChanged: { addListener: (l: Listener) => void listeners.add(l), removeListener: (l: Listener) => void listeners.delete(l), hasListener: (l: Listener) => listeners.has(l) },
  },
  alarms: {
    create: async (name: string, info: { delayInMinutes?: number; when?: number }) => {
      const old = alarms.get(name); if (old) clearTimeout(old.timer);
      const at = info.when ?? Date.now() + (info.delayInMinutes ?? 0) * 60_000;
      alarms.set(name, { at, timer: setTimeout(() => fire(name), Math.max(0, at - Date.now())) });
    },
    clear: async (name: string) => { const a = alarms.get(name); if (!a) return false; clearTimeout(a.timer); alarms.delete(name); return true; },
    onAlarm: { addListener: (l: (a: Alarm) => void) => void alarmListeners.add(l), removeListener: (l: (a: Alarm) => void) => void alarmListeners.delete(l) },
  },
  tabs: { create: openTab },
  windows: { create: openTab },
  runtime: {
    id: "madar-wallet-android",
    getManifest: () => ({ version: __MADAR_VERSION__ }),
    getURL: (p: string) => new URL(p.replace(/^\//, ""), ORIGIN + "/").href,
    sendMessage: () => Promise.resolve(undefined),
    onMessage: { addListener: () => {}, removeListener: () => {} },
    onConnect: { addListener: () => {}, removeListener: () => {} },
  },
};

if (navigator.clipboard) {
  const orig = navigator.clipboard.writeText?.bind(navigator.clipboard);
  try {
    Object.defineProperty(navigator.clipboard, "writeText", {
      configurable: true,
      value: (text: string) => (androidPost({ t: "copy", text: String(text) }) ? Promise.resolve() : orig ? orig(text) : Promise.reject(new Error("clipboard"))),
    });
  } catch {  }
}

window.open = ((url?: string | URL) => { if (url) openExternal(String(url)); return null; }) as typeof window.open;
document.addEventListener("click", (e) => {
  const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
  if (!a || a.hasAttribute("download")) return;
  const href = a.getAttribute("href") ?? "";
  if (!href || href.startsWith("#")) return;
  let u: URL;
  try { u = new URL(href, location.href); } catch { return; }
  if (u.origin === ORIGIN) return;
  e.preventDefault();
  openExternal(u.href);
}, true);

export {};
