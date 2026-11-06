import { keccak256, type Hex } from "viem";

export const INVITE_API = "https://madarwallet.app/api/ops-pro/v1";
export const INVITE_KEY = "madar-invite-v1";

export const INVITE_TTL_MS = 10 * 60_000;
const TIMEOUT = 15_000;

export function normalizeCode(s: string): string | null {
  let c = s.trim().toLowerCase();
  if (c.endsWith(".madar")) c = c.slice(0, -".madar".length);
  return /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/.test(c) ? c : null;
}

export const inviteText = (code: string, account: string, untilMs: number) =>
  `Madar Wallet invite\ncode: ${code}\naccount: ${account}\nuntil: ${untilMs}`;

export function inviteHash(text: string): Hex {
  const body = new TextEncoder().encode(text);
  return keccak256(new Uint8Array([...new TextEncoder().encode(`\x19MADAR Invite:\n${body.length}`), ...body]));
}

export interface InviteState { code: string; linked: string[]; other?: Record<string, string> }

export async function loadInvite(): Promise<InviteState | null> {
  const r = await chrome.storage.local.get(INVITE_KEY).catch(() => ({} as Record<string, unknown>));
  const v = r[INVITE_KEY] as InviteState | undefined;
  return v && typeof v.code === "string" && Array.isArray(v.linked) ? v : null;
}
const saveInvite = (s: InviteState) => chrome.storage.local.set({ [INVITE_KEY]: s });

export type CheckResult = "ok" | "unknown" | "bad" | "net";

export async function checkCode(raw: string): Promise<CheckResult> {
  const code = normalizeCode(raw);
  if (!code) return "bad";
  try {
    const r = await fetch(`${INVITE_API}/invite/check?code=${encodeURIComponent(code)}`, { cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer", signal: AbortSignal.timeout(TIMEOUT) });
    if (r.status === 200) return "ok";
    if (r.status === 404) return "unknown";
    if (r.status === 400) return "bad";
    return "net";
  } catch { return "net"; }
}

export type LinkResult = { ok: true; code: string } | { error: "linked"; code: string } | { error: "unknown" | "bad" | "signature" | "excluded" | "own" | "time" | "net" };
type Signer = (hash: Hex) => Promise<Hex>;
export type LinkError = Extract<LinkResult, { error: string }>["error"];

export async function linkAccount(code: string, address: string, sign: Signer, now = Date.now()): Promise<LinkResult> {
  const account = address.toLowerCase();
  const send = async (base: number): Promise<{ status: number; body: Record<string, unknown> }> => {
    const until = base + INVITE_TTL_MS;
    const signature = await sign(inviteHash(inviteText(code, account, until)));
    const r = await fetch(`${INVITE_API}/invite/link`, {
      method: "POST", headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: JSON.stringify({ code, until, proof: { madar: { address: account, signature } } }),
      credentials: "omit", referrerPolicy: "no-referrer", signal: AbortSignal.timeout(TIMEOUT),
    });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  try {
    let { status, body } = await send(now);
    if (status === 400 && body.error === "time" && typeof body.now === "number") ({ status, body } = await send(body.now));
    if (status === 200 && body.ok === true) return { ok: true, code: typeof body.code === "string" ? body.code : code };
    if (status === 409 && body.error === "linked" && typeof body.code === "string") return { error: "linked", code: body.code };
    if (status === 404) return { error: "unknown" };
    const e = body.error;
    return { error: e === "code" ? "bad" : e === "signature" || e === "excluded" || e === "own" || e === "time" ? e : "net" };
  } catch { return { error: "net" }; }
}

export interface LinkAllResult { linked: number; other: Record<string, string>; failed: LinkError | null }

export async function linkAll(code: string, accounts: { address: string; sign: Signer }[], prev: InviteState | null): Promise<{ state: InviteState; result: LinkAllResult }> {
  const state: InviteState = prev && prev.code === code ? { code, linked: [...prev.linked], other: { ...(prev.other ?? {}) } } : { code, linked: [], other: {} };
  const result: LinkAllResult = { linked: 0, other: {}, failed: null };
  for (const a of accounts) {
    const addr = a.address.toLowerCase();
    if (state.linked.includes(addr) || state.other?.[addr]) continue;
    const r = await linkAccount(code, addr, a.sign);
    if ("ok" in r) { state.linked.push(addr); result.linked++; continue; }
    if (r.error === "linked") { state.other![addr] = r.code; result.other[addr] = r.code; continue; }
    result.failed = r.error;
    if (r.error === "unknown" || r.error === "net" || r.error === "bad" || r.error === "own") break;
  }
  if (state.linked.length || Object.keys(state.other ?? {}).length) await saveInvite(state);
  return { state, result };
}

export const MINE_KEY = "madar-invite-mine-v1";
export const STATUS_KEY = "madar-invite-status-v1";

export const MIN_OWN_CODE = 4;
export const INVITE_SITE = "https://madarwallet.app/";

export const codeText = (code: string, account: string, untilMs: number) =>
  `Madar Wallet invite code\ncode: ${code}\naccount: ${account}\nuntil: ${untilMs}`;

export function codeHash(text: string): Hex {
  const body = new TextEncoder().encode(text);
  return keccak256(new Uint8Array([...new TextEncoder().encode(`\x19MADAR Invite Code:\n${body.length}`), ...body]));
}

export function defaultCode(address: string): string {
  return "m" + keccak256(new TextEncoder().encode(address.toLowerCase())).slice(2, 9);
}

export const inviteLink = (code: string) => `${INVITE_SITE}?invite=${encodeURIComponent(code)}`;

export const ownCodeOf = (raw: string) => { const c = normalizeCode(raw); return c && c.length >= MIN_OWN_CODE ? c : null; };

export interface MyCode { code: string; account: string }
export async function loadMyCode(): Promise<MyCode | null> {
  const r = await chrome.storage.local.get(MINE_KEY).catch(() => ({} as Record<string, unknown>));
  const v = r[MINE_KEY] as MyCode | undefined;
  return v && typeof v.code === "string" && typeof v.account === "string" ? v : null;
}

export type ClaimResult = { ok: true; code: string } | { error: "has"; code: string } | { error: "taken" | "name" | "bad" | "signature" | "excluded" | "time" | "net" };

export async function claimCode(code: string, address: string, sign: Signer, now = Date.now()): Promise<ClaimResult> {
  const account = address.toLowerCase();
  const send = async (base: number): Promise<{ status: number; body: Record<string, unknown> }> => {
    const until = base + INVITE_TTL_MS;
    const signature = await sign(codeHash(codeText(code, account, until)));
    const r = await fetch(`${INVITE_API}/invite/claim`, {
      method: "POST", headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: JSON.stringify({ code, until, proof: { madar: { address: account, signature } } }),
      credentials: "omit", referrerPolicy: "no-referrer", signal: AbortSignal.timeout(TIMEOUT),
    });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  try {
    let { status, body } = await send(now);
    if (status === 400 && body.error === "time" && typeof body.now === "number") ({ status, body } = await send(body.now));
    const got = typeof body.code === "string" && normalizeCode(body.code) ? body.code : null;
    if (status === 200 && body.ok === true) {
      const c = got ?? code;
      await chrome.storage.local.set({ [MINE_KEY]: { code: c, account } satisfies MyCode });
      return { ok: true, code: c };
    }
    if (status === 409 && body.error === "has" && got) {
      await chrome.storage.local.set({ [MINE_KEY]: { code: got, account } satisfies MyCode });
      return { error: "has", code: got };
    }

    if (status === 409 && body.error === "name") return { error: "name" };
    if (status === 409) return { error: "taken" };
    const e = body.error;
    return { error: e === "code" ? "bad" : e === "signature" || e === "excluded" || e === "time" ? e : "net" };
  } catch { return { error: "net" }; }
}

export interface InviteStatus { account: string; invited: boolean; inviter: boolean; code: string | null; at: number;  name?: boolean }

export function readStatus(account: string, j: unknown, at: number): InviteStatus | null {
  const v = j as { ok?: unknown; invited?: unknown; inviter?: unknown; code?: unknown; name?: unknown } | null;
  if (!v || v.ok !== true || typeof v.invited !== "boolean" || typeof v.inviter !== "boolean") return null;
  const code = typeof v.code === "string" ? normalizeCode(v.code) : null;
  if (v.code != null && !code) return null;
  return { account: account.toLowerCase(), invited: v.invited, inviter: v.inviter, code, at, ...(code && v.name === true ? { name: true } : {}) };
}
export async function fetchStatus(address: string): Promise<InviteStatus | null> {
  const account = address.toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(account)) return null;
  try {
    const r = await fetch(`${INVITE_API}/invite/status?account=${account}`, { cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer", signal: AbortSignal.timeout(TIMEOUT) });
    if (r.status !== 200) return null;
    return readStatus(account, await r.json().catch(() => null), Date.now());
  } catch { return null; }
}
export async function loadStatus(): Promise<InviteStatus | null> {
  const r = await chrome.storage.local.get(STATUS_KEY).catch(() => ({} as Record<string, unknown>));
  const v = r[STATUS_KEY] as InviteStatus | undefined;
  return v && typeof v.account === "string" && typeof v.invited === "boolean" && typeof v.inviter === "boolean" ? v : null;
}
export const saveStatus = (s: InviteStatus) => chrome.storage.local.set({ [STATUS_KEY]: s });

export function ownCode(first: string, mine: MyCode | null | undefined, status: InviteStatus | null | undefined): string | null {
  const a = first.toLowerCase();
  if (mine && mine.account === a) return mine.code;
  return status && status.account === a && status.code ? status.code : null;
}
