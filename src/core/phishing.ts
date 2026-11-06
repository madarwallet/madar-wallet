const GOPLUS = "https://api.gopluslabs.io/api/v1/address_security/";
const PHISH_LIST = "https://raw.githubusercontent.com/MetaMask/eth-phishing-detect/main/src/config.json";
const PHISH_KEY = "phishList";
const DAY = 24 * 3600_000;

export const BAD_FLAGS = ["phishing_activities", "stealing_attack", "cybercrime", "blackmail_activities", "honeypot_related_address", "financial_crime", "darkweb_transactions", "malicious_mining_activities", "fake_token", "fake_kyc"] as const;
export interface AddrRisk { bad: boolean; why: string[] }

export function riskFrom(j: unknown): AddrRisk | null {
  const r = (j as { code?: number; result?: Record<string, unknown> } | null);
  if (!r || r.code !== 1 || !r.result || typeof r.result !== "object") return null;
  const why = BAD_FLAGS.filter((k) => String(r.result![k] ?? "0") === "1");
  return { bad: why.length > 0, why };
}

const cache = new Map<string, { at: number; v: AddrRisk | null }>();

export async function addressRisk(chainId: number, address: string, fetcher: typeof fetch = fetch): Promise<AddrRisk | null> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address) || !Number.isInteger(chainId) || chainId <= 0) return null;
  const k = `${chainId}:${address.toLowerCase()}`;
  const hit = cache.get(k);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.v;
  try {
    const r = await fetcher(`${GOPLUS}${address.toLowerCase()}?chain_id=${chainId}`, { cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer", signal: AbortSignal.timeout(6_000) });
    const v = r.ok ? riskFrom(await r.json()) : null;
    if (v) cache.set(k, { at: Date.now(), v });
    return v;
  } catch { return null; }
}

export interface PhishCfg { blacklist: string[]; whitelist: string[]; fuzzylist: string[]; tolerance: number }

export function levenshtein(a: string, b: string): number {
  const d = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]; d[0] = i;
    for (let j = 1; j <= b.length; j++) { const t = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = t; }
  }
  return d[b.length];
}

const parents = (host: string) => { const p = host.split("."); return p.slice(0, -1).map((_, i) => p.slice(i).join(".")); };

export function siteVerdict(hostIn: string, cfg: PhishCfg): { fraud: boolean; like?: string } {
  const host = hostIn.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
  if (!host || !host.includes(".")) return { fraud: false };
  const all = parents(host);
  const allow = new Set(cfg.whitelist), block = new Set(cfg.blacklist);
  if (all.some((h) => allow.has(h))) return { fraud: false };
  if (all.some((h) => block.has(h))) return { fraud: true };
  const root = all[all.length - 1];
  for (const f of cfg.fuzzylist) {
    const dist = levenshtein(root, f);
    if (dist > 0 && dist <= cfg.tolerance) return { fraud: true, like: f };
  }
  return { fraud: false };
}

async function phishCfg(): Promise<PhishCfg | null> {
  try {
    const saved = (await chrome.storage.local.get(PHISH_KEY))[PHISH_KEY] as { at: number; cfg: PhishCfg } | undefined;
    if (saved && Date.now() - saved.at < DAY) return saved.cfg;
    const r = await fetch(PHISH_LIST, { cache: "no-store", credentials: "omit", signal: AbortSignal.timeout(20_000) });
    const j = r.ok ? await r.json() as Partial<PhishCfg> : null;
    const ok = j && Array.isArray(j.blacklist) && Array.isArray(j.whitelist) && Array.isArray(j.fuzzylist);
    if (!ok) return saved?.cfg ?? null;
    const cfg: PhishCfg = { blacklist: j!.blacklist!.filter((x) => typeof x === "string"), whitelist: j!.whitelist!.filter((x) => typeof x === "string"), fuzzylist: j!.fuzzylist!.filter((x) => typeof x === "string"), tolerance: Math.min(3, Math.max(0, Number(j!.tolerance ?? 1) | 0)) };
    await chrome.storage.local.set({ [PHISH_KEY]: { at: Date.now(), cfg } }).catch(() => {});
    return cfg;
  } catch { return null; }
}

export async function siteRisk(origin: string): Promise<{ fraud: boolean; like?: string }> {
  let host = "";
  try { host = new URL(origin).hostname; } catch { return { fraud: false }; }
  const cfg = await phishCfg();
  return cfg ? siteVerdict(host, cfg) : { fraud: false };
}
