import { base58 } from "@scure/base";

export const NAME_RE = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]\.madar$/;

const ENS_SUFFIX = ".madarnames.eth";
const short = (s: string) => { const v = s.trim().toLowerCase(); return v.endsWith(ENS_SUFFIX) ? v.slice(0, -ENS_SUFFIX.length) + ".madar" : v; };
export const isMadarName = (s: string) => NAME_RE.test(short(s));

export interface NameHit {
  name: string;
  kind: "evm" | "solana";
  address: string;
  expiresMs: number;
}

const API = "https://madarwallet.app/api/ops-pro/v1/names/check?name=";

async function check(full: string): Promise<Record<string, any>> {
  const r = await fetch(API + encodeURIComponent(full.slice(0, -".madar".length)), { cache: "no-store", signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error("ERR_NAME_LOOKUP");
  return r.json();
}

export async function resolveName(input: string): Promise<NameHit | null> {
  const full = short(input);
  if (!NAME_RE.test(full)) return null;
  return hitOf(full, await check(full));
}

export async function namePage(input: string): Promise<{ hit: NameHit | null; page: boolean; url: string } | null> {
  const full = short(input.includes(".") ? input : input + ".madar");
  if (!NAME_RE.test(full)) return null;
  const j = await check(full);
  const hit = hitOf(full, j);
  return { hit, page: !!hit && !!j.profile && typeof j.profile === "object", url: pageUrl(full) };
}
export const pageUrl = (full: string) => `https://madarwallet.app/${encodeURIComponent(full.replace(/\.madar$/, ""))}`;

function hitOf(full: string, j: Record<string, any>): NameHit | null {
  if (j.state !== "taken" || !j.owner) return null;
  const o = j.owner;
  if (o.kind === "evm" && /^0x[0-9a-f]{40}$/.test(o.address ?? "")) return { name: full, kind: "evm", address: o.address, expiresMs: j.expires_ms ?? 0 };
  if (o.kind === "solana" && /^[0-9a-f]{64}$/.test(o.public ?? "")) {
    const bytes = Uint8Array.from((o.public as string).match(/../g)!.map((h: string) => parseInt(h, 16)));
    return { name: full, kind: "solana", address: base58.encode(bytes), expiresMs: j.expires_ms ?? 0 };
  }
  return null;
}

const LIST_API = "https://madarwallet.app/api/ops-pro/v1/names/ens-list";

export async function nameOfAddress(address: string): Promise<string | null> {
  const me = address.toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(me)) return null;
  const r = await fetch(LIST_API, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error("ERR_NAME_LOOKUP");
  const j = (await r.json()) as { names?: unknown };
  const mine = (Array.isArray(j.names) ? j.names : [])
    .filter((x): x is { name: string; evm: string } => !!x && typeof x === "object" && typeof (x as { name?: unknown }).name === "string" && typeof (x as { evm?: unknown }).evm === "string")
    .filter((x) => x.evm.toLowerCase() === me && NAME_RE.test(`${x.name}.madar`))
    .map((x) => `${x.name}.madar`)
    .sort((a, b) => a.length - b.length || (a < b ? -1 : 1));
  for (const full of mine.slice(0, 3)) {
    const hit = await resolveName(full);
    if (hit?.kind === "evm" && hit.address.toLowerCase() === me) return full;
  }
  return null;
}

const MY_NAME_KEY = "myMadarName";
const NAME_TTL_MS = 6 * 3600_000, NONE_TTL_MS = 10 * 60_000;
type MyNameCache = Record<string, { name: string | null; at: number }>;

export async function myName(address: string, fresh = false): Promise<string | null> {
  const me = address.toLowerCase();
  let cache: MyNameCache = {};
  try { cache = ((await chrome.storage.local.get(MY_NAME_KEY))[MY_NAME_KEY] as MyNameCache | undefined) ?? {}; } catch {  }
  const c = cache[me];
  if (!fresh && c && (c.name === null || NAME_RE.test(c.name)) && Date.now() - c.at < (c.name ? NAME_TTL_MS : NONE_TTL_MS) && c.at <= Date.now()) return c.name;
  const name = await nameOfAddress(me);
  try {
    const keep = Object.fromEntries(Object.entries(cache).filter(([, v]) => Date.now() - v.at < NAME_TTL_MS).slice(-20));
    await chrome.storage.local.set({ [MY_NAME_KEY]: { ...keep, [me]: { name, at: Date.now() } } });
  } catch {  }
  return name;
}
