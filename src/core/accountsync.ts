import { HDKey } from "@scure/bip32";
import { mnemonicToSeed } from "@scure/bip39";
import { base64 } from "@scure/base";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { normalizePhrase } from "./account";
import { MAX_BLOB, readRemote, writeRemote, type BookKeys } from "./booksync";
import { IMPORTED_BASE } from "./imported";
import type { AccountMeta } from "./store";

export const ACCOUNTS_PATH = "m/1296122962'/2'/0'";
const TAG = "madar-accounts-v1";

export const ACCOUNTS_MAX = 50;

export const NAME_MAX = 32;
const utf8 = (s: string) => new TextEncoder().encode(s);

export async function accountKeys(phrase: string): Promise<BookKeys> {
  const seed = await mnemonicToSeed(normalizePhrase(phrase));
  const node = HDKey.fromMasterSeed(seed).derive(ACCOUNTS_PATH);
  seed.fill(0);
  if (!node.privateKey || !node.publicKey) throw new Error("ERR_KEY");
  const secret = node.privateKey.slice(), pub = node.publicKey.slice();
  node.wipePrivateData();
  const raw = hkdf(sha256, secret, undefined, utf8(TAG), 32);
  const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
  raw.fill(0);
  return { id: bytesToHex(sha256(pub)), pub: bytesToHex(pub), key, sign: (text) => bytesToHex(secp256k1.sign(utf8(text), secret)) };
}

export interface AccRec { i: number; n: string; t: number }

export function cleanName(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, "").trim();
  return [...s].length <= NAME_MAX ? s : null;
}
const recOk = (x: unknown): x is AccRec => {
  const r = x as AccRec;
  return !!r && Number.isSafeInteger(r.i) && r.i >= 0 && r.i < IMPORTED_BASE && Number.isSafeInteger(r.t) && r.t >= 0 && cleanName(r.n) === r.n;
};

export const recsOf = (accounts: readonly AccountMeta[]): AccRec[] =>
  accounts.filter((a) => !a.imported && a.index < IMPORTED_BASE).map((a) => ({ i: a.index, n: cleanName(a.name) ?? "", t: a.named ?? 0 }));

function better(x: AccRec, y: AccRec): AccRec {
  if (x.t !== y.t) return x.t > y.t ? x : y;
  if (!!x.n !== !!y.n) return x.n ? x : y;
  return x.n >= y.n ? x : y;
}

export function mergeAcc(a: readonly AccRec[], b: readonly AccRec[]): AccRec[] {
  const m = new Map<number, AccRec>();
  for (const r of [...a, ...b]) { const o = m.get(r.i); m.set(r.i, o ? better(o, r) : r); }
  return [...m.values()].sort((x, y) => x.i - y.i).slice(0, ACCOUNTS_MAX);
}
export const accCanon = (l: readonly AccRec[]) => JSON.stringify([...l].sort((x, y) => x.i - y.i).map((r) => [r.i, r.n, r.t]));

export function applyAcc(accounts: readonly AccountMeta[], merged: readonly AccRec[]): AccountMeta[] {
  const derived = merged.map((r) => { const old = accounts.find((a) => a.index === r.i && !a.imported); return { ...(old ?? {}), index: r.i, name: r.n, ...(r.t ? { named: r.t } : {}) } as AccountMeta; });
  return [...derived, ...accounts.filter((a) => a.imported || a.index >= IMPORTED_BASE)];
}

export function toAccPayload(l: readonly AccRec[]): string { return JSON.stringify({ v: 1, a: l.map((r) => ({ i: r.i, n: r.n, t: r.t })) }); }

export function fromAccPayload(text: string): AccRec[] {
  let p: { v?: unknown; a?: unknown };
  try { p = JSON.parse(text); } catch { throw new Error("ERR_FORMAT"); }
  if (!p || typeof p !== "object" || p.v !== 1 || !Array.isArray(p.a)) throw new Error("ERR_FORMAT");
  return mergeAcc([], (p.a as unknown[]).map((x) => ({ i: (x as AccRec)?.i, n: (x as AccRec)?.n, t: (x as AccRec)?.t })).filter(recOk));
}
const aad = (id: string, version: number) => utf8(`${TAG}|${id}|${version}`);
export async function sealAcc(k: BookKeys, version: number, l: readonly AccRec[]): Promise<{ blob: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad(k.id, version) }, k.key, utf8(toAccPayload(l))));
  if (ct.length > MAX_BLOB) throw new Error("ERR_SIZE");
  return { blob: base64.encode(ct), iv: base64.encode(iv) };
}
export async function openAcc(k: BookKeys, version: number, blob: string, iv: string): Promise<AccRec[]> {
  let ct: Uint8Array<ArrayBuffer>, nonce: Uint8Array<ArrayBuffer>;
  try { ct = new Uint8Array(base64.decode(blob)); nonce = new Uint8Array(base64.decode(iv)); } catch { throw new Error("ERR_FORMAT"); }
  if (nonce.length !== 12 || ct.length > MAX_BLOB + 16) throw new Error("ERR_FORMAT");
  let pt: ArrayBuffer;
  try { pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce, additionalData: aad(k.id, version) }, k.key, ct); } catch { throw new Error("ERR_DECRYPT"); }
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(pt); } catch { throw new Error("ERR_FORMAT"); }
  return fromAccPayload(text);
}

export async function syncAccounts(k: BookKeys, local: () => Promise<readonly AccountMeta[]>, apply: (merged: AccRec[]) => Promise<void>, f: typeof fetch = fetch): Promise<{ canon: string; pulled: boolean; pushed: boolean }> {
  for (let round = 0; round < 2; round++) {
    const remote = await readRemote(k, f);
    const theirs = remote.found ? await openAcc(k, remote.version, remote.blob, remote.iv) : [];
    const mine = recsOf(await local());
    const merged = mergeAcc(mine, theirs), c = accCanon(merged);
    const pulled = c !== accCanon(mine);
    if (pulled) await apply(merged);
    const trivial = merged.length <= 1 && !merged.some((r) => r.n);
    if (remote.found ? c === accCanon(theirs) : trivial) return { canon: c, pulled, pushed: false };
    const version = remote.version + 1;
    if ((await writeRemote(k, version, await sealAcc(k, version, merged), f)) === "ok") return { canon: c, pulled, pushed: true };
  }
  throw new Error("ERR_CONFLICT");
}
