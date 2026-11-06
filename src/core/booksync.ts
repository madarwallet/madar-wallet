import { HDKey } from "@scure/bip32";
import { mnemonicToSeed } from "@scure/bip39";
import { base64 } from "@scure/base";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { normalizePhrase } from "./account";
import { BOOK_KEY, BOOK_MAX, BOOK_SYNC_KEY, bookKey, entryTime, GONE_KEY, GONE_MAX, sanitize, sanitizeGone, type BookEntry, type BookGone, type Family } from "./addressbook";

export const BOOK_PATH = "m/1296122962'/1'/0'";
const TAG = "madar-addressbook-v1";
export const SYNC_API = "https://madarwallet.app/api/ops-pro/v1";

export const MAX_BLOB = 64 * 1024;
const TIMEOUT = 20_000;

export interface BookState { entries: BookEntry[]; gone: BookGone[] }
export const EMPTY: BookState = { entries: [], gone: [] };
export interface BookKeys { id: string; pub: string; key: CryptoKey; sign(text: string): string }

const utf8 = (s: string) => new TextEncoder().encode(s);

export async function bookKeys(phrase: string): Promise<BookKeys> {
  const seed = await mnemonicToSeed(normalizePhrase(phrase));
  const node = HDKey.fromMasterSeed(seed).derive(BOOK_PATH);
  seed.fill(0);
  if (!node.privateKey || !node.publicKey) throw new Error("ERR_KEY");
  const secret = node.privateKey.slice(), pub = node.publicKey.slice();
  node.wipePrivateData();
  const raw = hkdf(sha256, secret, undefined, utf8(TAG), 32);
  const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
  raw.fill(0);
  return { id: bytesToHex(sha256(pub)), pub: bytesToHex(pub), key, sign: (text) => bytesToHex(secp256k1.sign(utf8(text), secret)) };
}

export const readText = (id: string, ts: number) => `${TAG} read\nid: ${id}\nts: ${ts}`;
export const writeText = (id: string, version: number, blob: string, iv: string, ts: number) =>
  `${TAG} write\nid: ${id}\nversion: ${version}\nblob: ${bytesToHex(sha256(utf8(blob)))}\niv: ${iv}\nts: ${ts}`;
const aad = (id: string, version: number) => utf8(`${TAG}|${id}|${version}`);

interface Payload { v: 1; e: { f: Family; a: string; l: string; ad: number; up?: number }[]; g: { f: Family; a: string; t: number }[] }

export function toPayload(s: BookState): string {
  const p: Payload = {
    v: 1,
    e: s.entries.map((x) => ({ f: x.family, a: x.address, l: x.label, ad: x.added, ...(x.updated ? { up: x.updated } : {}) })),
    g: s.gone.map((x) => ({ f: x.family, a: x.address, t: x.at })),
  };
  return JSON.stringify(p);
}

export function fromPayload(text: string): BookState {
  let p: Partial<Payload>;
  try { p = JSON.parse(text); } catch { throw new Error("ERR_FORMAT"); }
  if (!p || typeof p !== "object" || p.v !== 1 || !Array.isArray(p.e) || !Array.isArray(p.g)) throw new Error("ERR_FORMAT");
  const entries = sanitize(p.e.map((x) => ({ family: x?.f, address: x?.a, label: x?.l, added: x?.ad, updated: x?.up })));
  const gone = sanitizeGone(p.g.map((x) => ({ family: x?.f, address: x?.a, at: x?.t })));
  return { entries, gone };
}

export async function seal(k: BookKeys, version: number, s: BookState): Promise<{ blob: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad(k.id, version) }, k.key, utf8(toPayload(s))));
  if (ct.length > MAX_BLOB) throw new Error("ERR_SIZE");
  return { blob: base64.encode(ct), iv: base64.encode(iv) };
}

export async function openBlob(k: BookKeys, version: number, blob: string, iv: string): Promise<BookState> {
  let ct: Uint8Array<ArrayBuffer>, nonce: Uint8Array<ArrayBuffer>;
  try { ct = new Uint8Array(base64.decode(blob)); nonce = new Uint8Array(base64.decode(iv)); } catch { throw new Error("ERR_FORMAT"); }
  if (nonce.length !== 12 || ct.length > MAX_BLOB + 16) throw new Error("ERR_FORMAT");
  let pt: ArrayBuffer;
  try { pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce, additionalData: aad(k.id, version) }, k.key, ct); } catch { throw new Error("ERR_DECRYPT"); }
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(pt); } catch { throw new Error("ERR_FORMAT"); }
  return fromPayload(text);
}

type Rec = { t: number; e?: BookEntry; g?: BookGone };
function better(x: Rec, y: Rec): Rec {
  if (x.t !== y.t) return x.t > y.t ? x : y;
  if (!!x.g !== !!y.g) return x.g ? x : y;
  return JSON.stringify(x.e ?? x.g) >= JSON.stringify(y.e ?? y.g) ? x : y;
}

export function merge(a: BookState, b: BookState): BookState {
  const win = new Map<string, Rec>();
  const offer = (k: string, r: Rec) => { const o = win.get(k); win.set(k, o ? better(o, r) : r); };
  for (const s of [a, b]) {
    for (const e of s.entries) offer(bookKey(e.family, e.address), { t: entryTime(e), e });
    for (const g of s.gone) offer(bookKey(g.family, g.address), { t: g.at, g });
  }
  const rows = [...win.entries()];
  const entries = rows.filter(([, r]) => r.e).sort(([ka, ra], [kb, rb]) => ra.e!.added - rb.e!.added || (ka < kb ? -1 : ka > kb ? 1 : 0)).map(([, r]) => r.e!).slice(0, BOOK_MAX);
  const gone = rows.filter(([, r]) => r.g).sort(([ka, ra], [kb, rb]) => rb.g!.at - ra.g!.at || (ka < kb ? -1 : ka > kb ? 1 : 0)).map(([, r]) => r.g!).slice(0, GONE_MAX);
  return { entries, gone };
}

export function canon(s: BookState): string {
  const e = s.entries.map((x) => [bookKey(x.family, x.address), x.address, x.label, x.added, x.updated ?? 0] as const).sort((p, q) => (p[0] < q[0] ? -1 : p[0] > q[0] ? 1 : 0));
  const g = s.gone.map((x) => [bookKey(x.family, x.address), x.at] as const).sort((p, q) => (p[0] < q[0] ? -1 : p[0] > q[0] ? 1 : 0));
  return JSON.stringify([e, g]);
}

export async function loadState(): Promise<BookState> {
  const r = await chrome.storage.local.get([BOOK_KEY, GONE_KEY]);
  return { entries: sanitize(r[BOOK_KEY]), gone: sanitizeGone(r[GONE_KEY]) };
}
async function saveState(s: BookState): Promise<void> {
  await chrome.storage.local.set({ [BOOK_KEY]: s.entries, [GONE_KEY]: s.gone });
}

export interface SyncStatus { okAt?: number; failAt?: number }
export async function recordSync(ok: boolean, now = Date.now()): Promise<void> {
  const prev = ((await chrome.storage.local.get(BOOK_SYNC_KEY))[BOOK_SYNC_KEY] ?? {}) as SyncStatus;
  await chrome.storage.local.set({ [BOOK_SYNC_KEY]: ok ? { okAt: now } : { ...(prev.okAt ? { okAt: prev.okAt } : {}), failAt: now } });
}

type Fetch = typeof fetch;

let skew = 0;
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;

async function signed(f: Fetch, path: string, body: (ts: number) => Record<string, unknown>): Promise<{ status: number; j: Record<string, unknown> }> {
  for (let i = 0; ; i++) {
    const r = await f(SYNC_API + path, {
      method: "POST", headers: { "Content-Type": "text/plain;charset=UTF-8" }, body: JSON.stringify(body(Date.now() + skew)),
      credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store", signal: AbortSignal.timeout(TIMEOUT),
    });
    const j = ((await r.json().catch(() => null)) ?? {}) as Record<string, unknown>;
    const now = Number(j.now);
    if (r.status === 400 && j.error === "time" && Number.isSafeInteger(now) && i === 0) { skew = now - Date.now(); continue; }
    return { status: r.status, j };
  }
}

export type Remote = { found: false; version: number } | { found: true; version: number; blob: string; iv: string };
export async function readRemote(k: BookKeys, f: Fetch = fetch): Promise<Remote> {
  const { status, j } = await signed(f, "/book/read", (ts) => ({ id: k.id, pub: k.pub, ts, sig: k.sign(readText(k.id, ts)) }));
  if (status !== 200) throw new Error(`ERR_HTTP_${status}`);
  if (j.found === false) return { found: false, version: 0 };
  const { version, blob, iv } = j;
  if (j.found !== true || !Number.isSafeInteger(version) || (version as number) < 1 || typeof blob !== "string" || typeof iv !== "string" || !B64.test(blob) || !B64.test(iv)) throw new Error("ERR_FORMAT");
  return { found: true, version: version as number, blob, iv };
}

export async function writeRemote(k: BookKeys, version: number, sealed: { blob: string; iv: string }, f: Fetch = fetch): Promise<"ok" | "conflict"> {
  const { status, j } = await signed(f, "/book/write", (ts) => ({ id: k.id, pub: k.pub, ts, version, ...sealed, sig: k.sign(writeText(k.id, version, sealed.blob, sealed.iv, ts)) }));
  if (status === 200 && j.ok === true && j.version === version) return "ok";
  if (status === 409 && j.error === "version") return "conflict";
  throw new Error(`ERR_HTTP_${status}`);
}

export async function syncBook(k: BookKeys, f: Fetch = fetch): Promise<{ canon: string; pulled: boolean; pushed: boolean }> {
  for (let round = 0; round < 2; round++) {
    const remote = await readRemote(k, f);
    const theirs = remote.found ? await openBlob(k, remote.version, remote.blob, remote.iv) : EMPTY;
    const mine = await loadState();
    const merged = merge(mine, theirs), c = canon(merged);
    const pulled = c !== canon(mine);
    if (pulled) await saveState(merged);
    if (remote.found ? c === canon(theirs) : !merged.entries.length) return { canon: c, pulled, pushed: false };
    const version = remote.version + 1;
    if ((await writeRemote(k, version, await seal(k, version, merged), f)) === "ok") return { canon: c, pulled, pushed: true };
  }
  throw new Error("ERR_CONFLICT");
}
