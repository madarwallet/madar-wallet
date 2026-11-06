export class HostBusy extends Error { constructor() { super("ERR_BUSY"); } }

type Gate = { until: number; backoff: number };
const gates = new Map<string, Gate>();
const lanes = new Map<string, Promise<unknown>>();
const MAX_BACKOFF = 5 * 60_000;

const GAP_MS: Record<string, number> = {
  "https://api.blockcypher.com": 400,
  "https://api.blockchair.com": 2_000,
  "https://api.bitcore.io": 150,
  "https://litecoinspace.org": 150,
  "https://xrplcluster.com": 120,
  "https://swap.madarwallet.app": 200,
  "https://rpc.ankr.com": 120,
};
let gapOverride: number | null = null;

export function hostBackoff(prev: number, retryAfterSec: number | null): number {
  if (retryAfterSec != null && Number.isFinite(retryAfterSec) && retryAfterSec > 0) return Math.min(MAX_BACKOFF, Math.max(10_000, retryAfterSec * 1000));
  return Math.min(MAX_BACKOFF, prev > 0 ? prev * 2 : 30_000);
}

export const hostWait = (origin: string, now = Date.now()) => Math.max(0, (gates.get(origin)?.until ?? 0) - now);

function inLane<T>(origin: string, run: () => Promise<T>): Promise<T> {
  const gap = gapOverride ?? GAP_MS[origin] ?? 150;
  const prev = lanes.get(origin) ?? Promise.resolve();
  const p = prev.then(run, run);
  const rest = () => new Promise((r) => setTimeout(r, gap));
  lanes.set(origin, p.then(rest, rest));
  return p;
}

export async function hostFetch(url: string, init: RequestInit = {}, timeoutMs = 10_000): Promise<Response> {
  const origin = new URL(url).origin;
  if (hostWait(origin) > 0) throw new HostBusy();
  return inLane(origin, async () => {
    if (hostWait(origin) > 0) throw new HostBusy();
    const r = await fetch(url, { ...init, cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer", signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined });
    if (r.status === 429 || r.status === 430) {
      const ra = Number(r.headers.get("retry-after"));
      const b = hostBackoff(gates.get(origin)?.backoff ?? 0, Number.isFinite(ra) && ra > 0 ? ra : null);
      gates.set(origin, { until: Date.now() + b, backoff: b });
      throw new HostBusy();
    }
    if (r.ok && gates.get(origin)?.backoff) gates.delete(origin);
    return r;
  });
}

export async function hostJson<T = unknown>(url: string, init: RequestInit = {}, timeoutMs = 10_000): Promise<T> {
  const r = await hostFetch(url, init, timeoutMs);
  if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { status: r.status, body: await r.text().catch(() => "") });
  return (await r.json()) as T;
}

export async function firstOk<T>(tries: (() => Promise<T>)[]): Promise<T> {
  let last: unknown = new Error("network");
  for (const f of tries) {
    try { return await f(); } catch (e) { last = e; }
  }
  throw last;
}

export function _resetHostGates(gapMs: number | null = null) { gates.clear(); lanes.clear(); gapOverride = gapMs; }
