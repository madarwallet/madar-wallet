const KEY = "balPing";

export const BAL_FOLLOW_MS = [4_000, 15_000, 45_000] as const;
type Listener = () => void;
const listeners = new Set<Listener>();
const self = Math.random().toString(36).slice(2);
let timers: ReturnType<typeof setTimeout>[] = [];

function fire() {
  for (const f of [...listeners]) {
    try { f(); } catch {  }
  }
}
function follow() {
  for (const t of timers) clearTimeout(t);
  fire();
  timers = BAL_FOLLOW_MS.map((ms) => setTimeout(fire, ms));
}

export function balancesChanged(): void {
  follow();
  try { void Promise.resolve(chrome.storage.session.set({ [KEY]: { by: self, at: Date.now() } })).catch(() => {}); } catch {  }
}

export function onBalancesChanged(f: Listener): () => void {
  listeners.add(f);
  return () => { listeners.delete(f); };
}

try {
  chrome.storage.onChanged.addListener((c, area) => {
    if (area !== "session" || !(KEY in c)) return;
    const v = c[KEY].newValue as { by?: string } | undefined;
    if (v && v.by !== self) follow();
  });
} catch {  }
