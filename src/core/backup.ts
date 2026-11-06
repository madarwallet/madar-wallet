import { scryptAsync } from "@noble/hashes/scrypt.js";
import { isValidPhrase, normalizePhrase } from "./account";

export const BACKUP_KIND = "madar-wallet-backup" as const;
export const BACKUP_KDF = { N: 2 ** 18, r: 8, p: 1 } as const;

const MIN_N = 2 ** 17;

const MAX_N = 2 ** 20;

export const BACKUP_MIN_PASSWORD = 12;
export const BACKUP_EXT = ".madarbackup";

export interface BackupFile {
  v: 1;
  kind: typeof BACKUP_KIND;
  email: string;
  created: string;
  kdf: { name: "scrypt"; N: number; r: number; p: number; salt: string };
  iv: string;
  ct: string;
}

export class BackupError extends Error {
  constructor(public code: "ERR_FILE" | "ERR_EMAIL" | "ERR_PASSWORD" | "ERR_WEAK") { super(code); }
}

const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
function unb64(s: string): Uint8Array<ArrayBuffer> {
  if (typeof s !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(s)) throw new BackupError("ERR_FILE");
  try { return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); } catch { throw new BackupError("ERR_FILE"); }
}

export const normalizeEmail = (s: string) => s.normalize("NFKC").trim().toLowerCase();

export function isValidEmail(s: string): boolean {
  const e = normalizeEmail(s);
  return e.length <= 254 && /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(e);
}

export function passwordStrength(pw: string): 0 | 1 | 2 | 3 | 4 {
  if (pw.length < BACKUP_MIN_PASSWORD) return 0;
  const kinds = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length + (/[^\x00-\x7f]/.test(pw) ? 1 : 0);
  const unique = new Set(pw).size;
  if (unique < 5 || /^(.)\1+$/.test(pw) || /^(0123456789|1234567890|abcdefghij|qwertyuiop|password)/i.test(pw)) return 1;
  let s = 1;
  if (pw.length >= 12) s++;
  if (pw.length >= 16) s++;
  if (kinds >= 3) s++;
  if (kinds <= 1 && pw.length < 16) s--;
  return Math.max(1, Math.min(4, s)) as 1 | 2 | 3 | 4;
}

export const strongEnough = (pw: string) => passwordStrength(pw) >= 2;

function aad(f: Pick<BackupFile, "v" | "kind" | "email" | "created" | "kdf">): Uint8Array<ArrayBuffer> {
  const k = f.kdf;
  return new TextEncoder().encode(JSON.stringify([f.v, f.kind, f.email, f.created, k.name, k.N, k.r, k.p, k.salt]));
}

async function key(password: string, salt: Uint8Array, p: { N: number; r: number; p: number }): Promise<CryptoKey> {
  const raw = await scryptAsync(new TextEncoder().encode(password.normalize("NFKC")), salt, { N: p.N, r: p.r, p: p.p, dkLen: 32, maxmem: 2 ** 31 });
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function makeBackup(phrase: string, email: string, password: string, now = new Date(), kdf: { N: number; r: 8; p: 1 } = BACKUP_KDF): Promise<BackupFile> {
  if (!isValidPhrase(phrase)) throw new Error("invalid phrase");
  if (!isValidEmail(email)) throw new BackupError("ERR_EMAIL");
  if (password.length < BACKUP_MIN_PASSWORD || !strongEnough(password)) throw new BackupError("ERR_WEAK");
  if (kdf.N < MIN_N || kdf.N > MAX_N) throw new Error("bad kdf");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const head = { v: 1 as const, kind: BACKUP_KIND, email: normalizeEmail(email), created: now.toISOString(), kdf: { name: "scrypt" as const, N: kdf.N, r: kdf.r, p: kdf.p, salt: b64(salt) } };
  const k = await key(password, salt, kdf);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad(head) }, k, new TextEncoder().encode(normalizePhrase(phrase))));
  return { ...head, iv: b64(iv), ct: b64(ct) };
}

export function parseBackup(text: string): BackupFile {
  let o: unknown;
  try { o = JSON.parse(text); } catch { throw new BackupError("ERR_FILE"); }
  const f = o as BackupFile;
  const k = f?.kdf;
  const ok = !!f && typeof f === "object" && f.v === 1 && f.kind === BACKUP_KIND && typeof f.email === "string" && isValidEmail(f.email) && f.email === normalizeEmail(f.email)
    && typeof f.created === "string" && f.created.length <= 40 && typeof f.iv === "string" && typeof f.ct === "string" && f.ct.length <= 4096
    && !!k && k.name === "scrypt" && Number.isInteger(k.N) && k.N >= MIN_N && k.N <= MAX_N && (k.N & (k.N - 1)) === 0 && k.r === 8 && k.p === 1 && typeof k.salt === "string";
  if (!ok) throw new BackupError("ERR_FILE");
  if (unb64(k.salt).length !== 16 || unb64(f.iv).length !== 12 || unb64(f.ct).length < 16 + 20) throw new BackupError("ERR_FILE");
  return { v: 1, kind: BACKUP_KIND, email: f.email, created: f.created, kdf: { name: "scrypt", N: k.N, r: k.r, p: k.p, salt: k.salt }, iv: f.iv, ct: f.ct };
}

export async function openBackup(file: BackupFile, email: string, password: string): Promise<string> {
  const f = parseBackup(JSON.stringify(file));
  if (normalizeEmail(email) !== f.email) throw new BackupError("ERR_EMAIL");
  const k = await key(password, unb64(f.kdf.salt), f.kdf);
  let pt: ArrayBuffer;
  try { pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(f.iv), additionalData: aad(f) }, k, unb64(f.ct)); } catch { throw new BackupError("ERR_PASSWORD"); }
  const phrase = new TextDecoder().decode(pt);
  if (!isValidPhrase(phrase)) throw new BackupError("ERR_FILE");
  return normalizePhrase(phrase);
}

export function backupFileName(email: string, now = new Date()): string {
  const prefix = normalizeEmail(email).split("@")[0].replace(/[^a-z0-9._-]/g, "").slice(0, 32) || "wallet";
  return `madar-wallet-${prefix}-${now.toISOString().slice(0, 10)}${BACKUP_EXT}`;
}
