import { privateKeyToAccount } from "viem/accounts";

export const IMPORTED_BASE = 1_000_000;
export const isImportedIndex = (i: number) => Number.isInteger(i) && i >= IMPORTED_BASE;

type Key = `0x${string}`;
const KEYS = new Map<number, Key>();

export function setImportedKeys(m: Record<string, string> | null | undefined): void {
  KEYS.clear();
  for (const [k, v] of Object.entries(m ?? {})) {
    const i = Number(k);
    if (isImportedIndex(i) && typeof v === "string" && /^0x[0-9a-f]{64}$/.test(v)) KEYS.set(i, v as Key);
  }
}
export const importedKey = (i: number): Key | undefined => KEYS.get(i);

export function parsePrivateKey(s: string): Key | null {
  const t = s.trim().replace(/^0x/i, "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(t)) return null;
  try { privateKeyToAccount(`0x${t}`); return `0x${t}`; } catch { return null; }
}

export function notImported(index: number): void {
  if (isImportedIndex(index)) throw new Error("ERR_IMPORTED_EVM_ONLY");
}
