import { evmAccount } from "./account";
import { nameClaimHash, parseNameClaim } from "../dapp/evmdecode";

const API = "https://madarwallet.app/api/ops-pro/v1";
const TIMEOUT = 20_000;

export const FREE_NAME_RE = /^[a-z0-9][a-z0-9-]{4,30}[a-z0-9]$/;
const NET_RE = /^0x[0-9a-f]{64}$/;
const REGISTER_MAX_AHEAD_MS = 7 * 86_400_000;

const getJson = async (path: string) => {
  const r = await fetch(API + path, { cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer", signal: AbortSignal.timeout(TIMEOUT) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(String(j?.error || `HTTP ${r.status}`));
  return j;
};
const pad2 = (n: number) => String(n).padStart(2, "0");

export const registerText = (name: string, network: string, until: number) =>
  `MADAR Names: register ${name}.madar to this wallet. No funds move.\nnetwork: ${network}\nvalid until: ${until}`;

export function claimText(name: string, until: number): string {
  const d = new Date(until);
  return `MADAR Names (madar-network.com): claim the free name ${name}.madar for this wallet. Valid until ${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())} UTC. No funds move.`;
}

export type FreeCheck = "free" | "taken" | "premium" | "blocked" | "bad";

export const NAME_RE = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/;

export async function checkName(name: string): Promise<{ kind: FreeCheck; usd: number | null; tier: string | null }> {
  if (!NAME_RE.test(name)) return { kind: "bad", usd: null, tier: null };
  const q = await getJson(`/names/check?name=${encodeURIComponent(name)}`);
  const usd = Number.isSafeInteger(q.verdict?.usd) && q.verdict.usd > 0 ? q.verdict.usd : null;
  const tier = typeof q.verdict?.tier === "string" ? q.verdict.tier : null;
  if (q.state === "blocked" || q.verdict?.status === "blocked") return { kind: "blocked", usd: null, tier };
  if (q.state !== "available" || q.verdict?.status !== "available") return { kind: "taken", usd: null, tier };
  return { kind: tier === "standard" && FREE_NAME_RE.test(name) ? "free" : "premium", usd, tier };
}
export async function checkFreeName(name: string): Promise<FreeCheck> {
  if (!FREE_NAME_RE.test(name)) return "bad";
  return (await checkName(name)).kind;
}

const statusCache = new Map<string, { at: number; v: { claimed: boolean; name: string | null; open: boolean } }>();
export async function freeStatus(address: string, fresh = false): Promise<{ claimed: boolean; name: string | null; open: boolean }> {
  const k = address.toLowerCase(), c = statusCache.get(k);
  if (!fresh && c && Date.now() - c.at < 5 * 60_000) return c.v;
  const st = await getJson(`/names/free-status?wallet=${encodeURIComponent(k)}`);
  const v = { claimed: !!st.claimed, name: typeof st.name === "string" ? st.name : null, open: st.open !== false };
  statusCache.set(k, { at: Date.now(), v });
  return v;
}

export async function signRegister(phrase: string, index: number, name: string) {
  if (!NAME_RE.test(name)) throw new Error("bad_name");
  const acct = evmAccount(phrase, index);
  const address = acct.address.toLowerCase();
  const p = await getJson("/names/sign-params");
  const now = Date.now(), until = p.register_until;
  if (p.v !== 2 || !NET_RE.test(p.network ?? "") || !Number.isSafeInteger(until) || until <= now || until > now + REGISTER_MAX_AHEAD_MS) throw new Error("try_again");
  const signature = await acct.signMessage({ message: registerText(name, p.network, until) });
  return { acct, address, until, proof: { evm: { address, signature }, valid_until: until } };
}

export async function claimFreeName(phrase: string, index: number, name: string): Promise<{ name: string; key: string }> {
  if (!FREE_NAME_RE.test(name)) throw new Error("bad_name");
  const { acct, address, until, proof } = await signRegister(phrase, index, name);
  const ct = claimText(name, until);
  parseNameClaim([ct]);
  const madar = { address, signature: await acct.sign({ hash: nameClaimHash(ct) }) };
  const body = JSON.stringify({ name, proof, madar });

  const r = await fetch(`${API}/names/claim-free`, { method: "POST", headers: { "Content-Type": "text/plain;charset=UTF-8" }, body, credentials: "omit", referrerPolicy: "no-referrer", signal: AbortSignal.timeout(TIMEOUT) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) throw new Error(String(j?.error || `HTTP ${r.status}`));
  if (typeof j.name !== "string" || typeof j.key !== "string") throw new Error("try_again");
  return { name: j.name, key: j.key };
}
