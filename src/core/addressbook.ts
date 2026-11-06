import { isAddress } from "viem";
import { evmAddress } from "./account";
import { btcAddress, isBtcAddress } from "./btcbase";
import { isMadarName } from "./names";
import { isSolAddress, solAddress } from "./solbase";
import { isTronAddress, tronAddress } from "./tronbase";
import { isTonAddress, parseTonAddress, tonAddress } from "./tonbase";
import { DOGE, isUtxoAddress, LTC, utxoAddress } from "./utxobase";
import { isXrpAddress, xrpAddress } from "./xrpbase";
import { adaAddress, isAdaAddress } from "./adabase";
import { isNearAddress, nearAddress } from "./nearbase";
import { isSuiAddress, suiAddress } from "./suibase";
import { aptAddress, isAptAddress } from "./aptosbase";
import { cosmosAddress, cosmosById, isCosmosAddress, type CosmosChain } from "./cosmosbase";
import { dotAddress, isDotAddress } from "./dotbase";
import type { AccountMeta } from "./store";

export type Family = "evm" | "solana" | "btc" | "tron" | "doge" | "ltc" | "xrp" | "ton" | "ada" | "sui" | "aptos" | "atom" | "osmo" | "tia" | "dot" | "near";

export const FAMILIES: Family[] = ["evm", "solana", "btc", "tron", "doge", "ltc", "xrp", "ton", "ada", "sui", "aptos", "atom", "osmo", "tia", "dot", "near"];

const NO_NAMES: readonly Family[] = ["btc", "tron", "doge", "ltc", "xrp", "ton", "ada", "sui", "aptos", "atom", "osmo", "tia", "dot", "near"];

const COSMOS_OF: Partial<Record<Family, string>> = { atom: "cosmoshub", osmo: "osmosis", tia: "celestia" };
const cosmosOf = (f: Family): CosmosChain | undefined => (COSMOS_OF[f] ? cosmosById(COSMOS_OF[f]!) : undefined);

export interface BookEntry { label: string; address: string; family: Family; added: number; updated?: number }

export interface BookGone { family: Family; address: string; at: number }

export const BOOK_KEY = "addressBook";

export const GONE_KEY = "addressBookGone";

export const BOOK_SYNC_KEY = "bookSyncState";
export const BOOK_MAX = 100;
export const GONE_MAX = 100;
export const LABEL_MAX = 40;

const BAD_LABEL = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

export function cleanLabel(s: string): string | null {
  const v = String(s ?? "").trim();
  const n = [...v].length;
  if (n < 1 || n > LABEL_MAX || BAD_LABEL.test(v)) return null;
  return v;
}

export function cleanAddress(a: string, family: Family): string | null {
  const v = String(a ?? "").trim();
  if (!v) return null;
  if (!NO_NAMES.includes(family) && isMadarName(v)) return v.toLowerCase();
  if (family === "tron") return isTronAddress(v) ? v : null;
  if (family === "ton") return isTonAddress(v) ? v : null;
  if (family === "doge") return isUtxoAddress(DOGE, v) ? v : null;
  if (family === "ltc") return isUtxoAddress(LTC, v) ? (/^ltc1/i.test(v) ? v.toLowerCase() : v) : null;
  if (family === "xrp") return isXrpAddress(v) ? v : null;
  if (family === "ada") return isAdaAddress(v) ? v : null;
  if (family === "near") return isNearAddress(v) ? v : null;
  if (family === "sui") return isSuiAddress(v.toLowerCase()) ? v.toLowerCase() : null;
  if (family === "aptos") return isAptAddress(v.toLowerCase()) ? v.toLowerCase() : null;
  if (family === "dot") return isDotAddress(v) ? v : null;
  const cos = cosmosOf(family);
  if (cos) return isCosmosAddress(cos, v.toLowerCase()) ? v.toLowerCase() : null;
  if (family === "evm") {
    const hex = v.slice(2);
    const mixed = /[a-f]/.test(hex) && /[A-F]/.test(hex);
    return isAddress(v, { strict: mixed }) ? v : null;
  }
  if (family === "solana") return isSolAddress(v) ? v : null;
  return isBtcAddress(v) ? v : null;
}

export function addrKey(a: string, family: Family): string {
  const v = a.trim();
  if (family === "evm" || isMadarName(v)) return v.toLowerCase();
  if (family === "btc" && /^bc1/i.test(v)) return v.toLowerCase();
  if (family === "ltc" && /^ltc1/i.test(v)) return v.toLowerCase();
  if (family === "ton") { const x = parseTonAddress(v); if (x) return x.toRawString(); }
  if (family === "sui" || family === "aptos" || cosmosOf(family)) return v.toLowerCase();
  return v;
}
export const sameAddr = (a: string, b: string, family: Family) => addrKey(a, family) === addrKey(b, family);

export type BookError = "ERR_LABEL" | "ERR_ADDRESS" | "ERR_DUP" | "ERR_FULL";

export function addEntry(list: BookEntry[], label: string, address: string, family: Family, now = Date.now()): BookEntry[] {
  const l = cleanLabel(label);
  if (!l) throw new Error("ERR_LABEL");
  const a = cleanAddress(address, family);
  if (!a) throw new Error("ERR_ADDRESS");
  if (list.some((e) => e.family === family && sameAddr(e.address, a, family))) throw new Error("ERR_DUP");
  if (list.length >= BOOK_MAX) throw new Error("ERR_FULL");
  return [...list, { label: l, address: a, family, added: now }];
}

export const entryTime = (e: BookEntry) => e.updated ?? e.added;

export const bookKey = (family: Family, address: string) => `${family}|${addrKey(address, family)}`;

export function renameEntry(list: BookEntry[], family: Family, address: string, label: string, now = Date.now()): BookEntry[] {
  const l = cleanLabel(label);
  if (!l) throw new Error("ERR_LABEL");
  return list.map((e) => (e.family === family && sameAddr(e.address, address, family) && e.label !== l ? { ...e, label: l, updated: Math.max(now, entryTime(e) + 1) } : e));
}

export const removeEntry = (list: BookEntry[], family: Family, address: string) => list.filter((e) => !(e.family === family && sameAddr(e.address, address, family)));
export const forFamily = (list: BookEntry[], family: Family) => list.filter((e) => e.family === family);

export function sanitize(raw: unknown): BookEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: BookEntry[] = [];
  for (const x of raw as Partial<BookEntry>[]) {
    const fam = x?.family;
    if (!fam || !FAMILIES.includes(fam)) continue;
    const l = cleanLabel(String(x.label ?? "")), a = cleanAddress(String(x.address ?? ""), fam);
    if (!l || !a || out.some((e) => e.family === fam && sameAddr(e.address, a, fam))) continue;
    const up = Number(x.updated);
    out.push({ label: l, address: a, family: fam, added: Number(x.added) || 0, ...(Number.isSafeInteger(up) && up > 0 ? { updated: up } : {}) });
    if (out.length >= BOOK_MAX) break;
  }
  return out;
}

export function sanitizeGone(raw: unknown): BookGone[] {
  if (!Array.isArray(raw)) return [];
  const best = new Map<string, BookGone>();
  for (const x of raw as Partial<BookGone>[]) {
    const fam = x?.family, at = Number(x?.at);
    if (!fam || !FAMILIES.includes(fam) || !Number.isSafeInteger(at) || at <= 0) continue;
    const a = cleanAddress(String(x.address ?? ""), fam);
    if (!a) continue;
    const k = bookKey(fam, a), old = best.get(k);
    if (!old || at > old.at) best.set(k, { family: fam, address: addrKey(a, fam), at });
  }
  return [...best.values()].sort((p, q) => q.at - p.at).slice(0, GONE_MAX);
}

export const goneFor = (e: BookEntry, now = Date.now()): BookGone => ({ family: e.family, address: addrKey(e.address, e.family), at: Math.max(now, entryTime(e) + 1) });

export async function loadBook(): Promise<BookEntry[]> {
  return sanitize((await chrome.storage.local.get(BOOK_KEY))[BOOK_KEY]);
}
export async function loadGone(): Promise<BookGone[]> {
  return sanitizeGone((await chrome.storage.local.get(GONE_KEY))[GONE_KEY]);
}
async function saveBook(list: BookEntry[], gone?: BookGone[]): Promise<BookEntry[]> {
  const items: Record<string, unknown> = { [BOOK_KEY]: list };
  if (gone) items[GONE_KEY] = gone;
  await chrome.storage.local.set(items);
  return list;
}

export async function saveAddress(label: string, address: string, family: Family): Promise<BookEntry[]> {
  const [list, gone] = [await loadBook(), await loadGone()];
  const a = cleanAddress(address, family), k = a ? bookKey(family, a) : "";
  const was = gone.find((g) => bookKey(g.family, g.address) === k);
  const next = addEntry(list, label, address, family, was ? Math.max(Date.now(), was.at + 1) : Date.now());
  return saveBook(next, was ? gone.filter((g) => g !== was) : undefined);
}
export const renameAddress = async (family: Family, address: string, label: string) => saveBook(renameEntry(await loadBook(), family, address, label));

export async function deleteAddress(family: Family, address: string): Promise<BookEntry[]> {
  const [list, gone] = [await loadBook(), await loadGone()];
  const hit = list.filter((e) => e.family === family && sameAddr(e.address, address, family));
  if (!hit.length) return list;
  return saveBook(removeEntry(list, family, address), sanitizeGone([...hit.map((e) => goneFor(e)), ...gone]));
}

export function ownAddress(phrase: string, index: number, family: Family): string {
  if (family === "doge") return utxoAddress(DOGE, phrase, index);
  if (family === "ltc") return utxoAddress(LTC, phrase, index);
  if (family === "xrp") return xrpAddress(phrase, index);
  if (family === "ton") return tonAddress(phrase, index);
  if (family === "ada") return adaAddress(phrase, index);
  if (family === "near") return nearAddress(phrase, index);
  if (family === "sui") return suiAddress(phrase, index);
  if (family === "aptos") return aptAddress(phrase, index);
  if (family === "dot") return dotAddress(phrase, index);
  const cos = cosmosOf(family);
  if (cos) return cosmosAddress(cos, phrase, index);
  return family === "evm" ? evmAddress(phrase, index) : family === "solana" ? solAddress(phrase, index) : family === "tron" ? tronAddress(phrase, index) : btcAddress(phrase, index);
}

export function otherAccounts(phrase: string, accounts: AccountMeta[], current: number, family: Family): { index: number; address: string }[] {
  return accounts.filter((a) => a.index !== current).map((a) => ({ index: a.index, address: ownAddress(phrase, a.index, family) }));
}

function body(a: string, family: Family): string {
  const v = addrKey(a, family);
  if (family === "evm") return v.replace(/^0x/, "");
  if (family === "tron") return v.replace(/^T/, "");
  if (family === "btc" && v.startsWith("bc1")) return v.slice(4);
  if (family === "ltc" && v.startsWith("ltc1")) return v.slice(5);
  if (family === "doge") return v.replace(/^D/, "");
  if (family === "xrp") return v.replace(/^r/, "");
  if (family === "ton") return v.replace(/^-?\d+:/, "");
  if (family === "ada") return v.replace(/^addr1./, "");
  if (family === "near") return /^[0-9a-f]{64}$/.test(v) ? v : v.replace(/\.[a-z\d_-]+$/, "");
  if (family === "sui" || family === "aptos") return v.toLowerCase().replace(/^0x/, "");
  if (family === "dot") return v.slice(1);
  const cos = cosmosOf(family);
  if (cos) return v.toLowerCase().slice(cos.prefix.length + 1);
  return v;
}

function tonBodies(a: string): string[] {
  const x = parseTonAddress(a.trim());
  if (!x) return [a.trim()];
  return [x.toString({ bounceable: false }).slice(2), x.toString({ bounceable: true }).slice(2), x.toRawString().replace(/^-?\d+:/, "")];
}

export function looksAlike(a: string, b: string, family: Family): boolean {
  if (isMadarName(a) || isMadarName(b)) return false;
  if (family === "ton") {
    if (sameAddr(a, b, family)) return false;
    const xs = tonBodies(a), ys = tonBodies(b);
    return xs.some((x, i) => ys[i] !== undefined && alike(x, ys[i]));
  }
  return alike(body(a, family), body(b, family));
}
function alike(x: string, y: string): boolean {
  if (x.length < 8 || y.length < 8 || x === y) return false;
  let front = 0, back = 0;
  while (front < x.length && front < y.length && x[front] === y[front]) front++;
  while (back < x.length && back < y.length && x[x.length - 1 - back] === y[y.length - 1 - back]) back++;
  return (front >= 3 && back >= 3) || front >= 5 || back >= 5;
}

export function lookAlikeOf<T extends { address: string }>(to: string, known: T[], family: Family): T | null {
  if (!to) return null;
  if (known.some((k) => sameAddr(k.address, to, family))) return null;
  return known.find((k) => looksAlike(to, k.address, family)) ?? null;
}

export type ToSource = "typed" | "own" | "saved" | "history";

export function mayOfferSave(o: { input: string; family: Family; source: ToSource; unknownToken?: boolean; book: BookEntry[]; own: string[]; lookAlike: boolean }): boolean {
  if (o.source === "own" || o.source === "saved" || o.lookAlike || o.unknownToken) return false;
  const a = cleanAddress(o.input, o.family);
  if (!a) return false;
  if (o.own.some((x) => sameAddr(x, a, o.family))) return false;
  if (o.book.length >= BOOK_MAX) return false;
  return !o.book.some((e) => e.family === o.family && sameAddr(e.address, a, o.family));
}
