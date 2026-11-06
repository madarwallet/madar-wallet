export const NETSTATUS_URL = "https://madarwallet.app/api/ops-pro/v1/netstatus";
export const NETSTATUS_EVERY_MS = 180_000;
const MAX_AGE = 15 * 60_000;

export type NetOff = Readonly<Record<string, { since: number; why: string }>>;
let off: NetOff = {};
let readAt = 0;
const listeners = new Set<() => void>();

export function readNetStatus(j: unknown): NetOff | null {
  const o = j as { at?: unknown; off?: unknown } | null;
  if (!o || typeof o !== "object" || typeof o.at !== "number" || !o.off || typeof o.off !== "object" || Array.isArray(o.off)) return null;
  const out: Record<string, { since: number; why: string }> = {};
  for (const [k, v] of Object.entries(o.off as Record<string, unknown>)) {
    if (!/^[a-z0-9-]{2,24}$/.test(k)) continue;
    const x = (v ?? {}) as { since?: unknown; why?: unknown };
    out[k] = { since: Number.isFinite(Number(x.since)) ? Number(x.since) : 0, why: typeof x.why === "string" ? x.why.slice(0, 80) : "" };
  }
  return out;
}

export async function refreshNetStatus(fetcher: typeof fetch = fetch, now = Date.now): Promise<void> {
  const before = JSON.stringify(off);
  try {
    const r = await fetcher(NETSTATUS_URL, { credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store", signal: AbortSignal.timeout(8000) });
    const v = r.ok ? readNetStatus(await r.json()) : null;
    if (v) { off = v; readAt = now(); }
  } catch {  }
  if (now() - readAt > MAX_AGE) off = {};
  if (JSON.stringify(off) !== before) listeners.forEach((f) => f());
}

export const netOff = (id: string | null | undefined): boolean => !!id && Object.prototype.hasOwnProperty.call(off, id);

export const offNets = (): string[] => Object.keys(off);

export function startNetStatus(onChange?: () => void): () => void {
  if (onChange) listeners.add(onChange);
  void refreshNetStatus();
  const h = setInterval(() => void refreshNetStatus(), NETSTATUS_EVERY_MS);
  return () => { clearInterval(h); if (onChange) listeners.delete(onChange); };
}

export function setNetStatusForTest(v: NetOff, at = Date.now()): void { off = v; readAt = at; }
