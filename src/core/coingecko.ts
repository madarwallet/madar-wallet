const API = "https://api.coingecko.com/api/v3/";
const SERVER = "https://madarwallet.app/wallet-api/cg/";

const SERVER_PATH = /^\/api\/v3\/(simple\/price|simple\/token_price\/[a-z0-9-]{1,64}|coins\/markets|search|search\/trending|coins\/[a-z0-9][a-z0-9-]{0,99}\/market_chart|coins\/[a-z0-9-]{1,64}\/contract\/[A-Za-z0-9]{20,64}(\/market_chart)?|coins\/[a-z0-9][a-z0-9-]{0,99})$/;
const SERVER_QUERY = /^(\?[A-Za-z0-9_=&%,.:-]{0,1500})?$/;
const GATE_KEY = "cgGate";
const MAX_BACKOFF = 5 * 60_000;
const SERVER_MAX_BACKOFF = 2 * 60_000;
type Gate = { until: number; backoff: number };
let gate: Gate = { until: 0, backoff: 0 };
let serverGate: Gate = { until: 0, backoff: 0 };
let loaded: Promise<void> | null = null;
const loadGate = () => (loaded ??= Promise.resolve(chrome.storage.local.get(GATE_KEY)).then((r) => {
  const g = r?.[GATE_KEY] as Gate | undefined;
  if (g && Number.isFinite(g.until) && Number.isFinite(g.backoff)) gate = { until: Math.min(g.until, Date.now() + MAX_BACKOFF), backoff: Math.min(g.backoff, MAX_BACKOFF) };
}).catch(() => {}));
const saveGate = () => void Promise.resolve(chrome.storage.local.set({ [GATE_KEY]: gate })).catch(() => {});

export class CgLimited extends Error { constructor() { super("ERR_CG_LIMIT"); } }

export async function cgWait(now = Date.now()): Promise<number> { await loadGate(); return Math.max(0, Math.min(gate.until, serverGate.until) - now); }

export function nextBackoff(prev: number, retryAfterSec: number | null): number {
  if (retryAfterSec != null && Number.isFinite(retryAfterSec) && retryAfterSec > 0) return Math.min(MAX_BACKOFF, Math.max(10_000, retryAfterSec * 1000));
  return Math.min(MAX_BACKOFF, prev > 0 ? prev * 2 : 30_000);
}

function limit(retryAfterSec: number | null) {
  gate.backoff = nextBackoff(gate.backoff, retryAfterSec);
  gate.until = Date.now() + gate.backoff;
  saveGate();
}
function limitServer() {
  serverGate.backoff = Math.min(SERVER_MAX_BACKOFF, serverGate.backoff > 0 ? serverGate.backoff * 2 : 15_000);
  serverGate.until = Date.now() + serverGate.backoff;
}
const isTimeout = (e: unknown) => (e as Error)?.name === "TimeoutError" || (e as Error)?.name === "AbortError";
const get = (href: string, timeoutMs: number) => fetch(href, { cache: "no-store", credentials: "omit", signal: AbortSignal.timeout(timeoutMs) });

export async function cgGet(path: string, timeoutMs = 8_000): Promise<unknown> {
  const url = new URL(path, API);
  if (url.origin + "/" !== new URL(API).origin + "/" || !url.pathname.startsWith("/api/v3/")) throw new Error("bad CoinGecko path");
  await loadGate();
  if (gate.until <= Date.now()) {
    let r: Response | null = null;
    try {
      r = await get(url.href, timeoutMs);
    } catch (e) {

      if (isTimeout(e)) throw e;
      limit(null);
    }
    if (r?.status === 429) {
      const ra = Number(r.headers.get("retry-after"));
      limit(Number.isFinite(ra) ? ra : null);
    } else if (r && r.status < 500) {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      if (gate.backoff) { gate = { until: 0, backoff: 0 }; saveGate(); }
      return r.json();
    }
  }
  return viaServer(url, timeoutMs);
}

async function viaServer(url: URL, timeoutMs: number): Promise<unknown> {
  if (!SERVER_PATH.test(url.pathname) || !SERVER_QUERY.test(url.search) || serverGate.until > Date.now()) throw new CgLimited();
  let r: Response;
  try {
    r = await get(SERVER + url.pathname.slice("/api/v3/".length) + url.search, timeoutMs);
  } catch (e) {
    if (isTimeout(e)) throw e;
    limitServer();
    throw new CgLimited();
  }

  if (r.status === 429 || r.status >= 500) { limitServer(); throw new CgLimited(); }
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  if (serverGate.backoff) serverGate = { until: 0, backoff: 0 };
  return r.json();
}

export function _resetGate() { gate = { until: 0, backoff: 0 }; serverGate = { until: 0, backoff: 0 }; loaded = null; }
