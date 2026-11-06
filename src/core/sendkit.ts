import type { Family } from "./addressbook";
import type { PendingPayment } from "./store";

export type KitEnd = { state: "ok" } | { state: "failed"; code: string } | { state: "dropped" } | { state: "pending" };

export type KitSubmit = { state: "ok" } | { state: "failed"; code: string } | { state: "refused"; code: string } | { state: "unknown" };

export interface KitQuote {
  from: string; to: string; amount: bigint;
   fee: bigint;
   newAccount?: boolean;
   reserve?: bigint;
  memo?: string;
}
export interface KitSigned { from: string; to: string; amount: bigint; fee: bigint; hash: string; memo?: string }

export interface SendKit<Q extends KitQuote = KitQuote, S extends KitSigned = KitSigned> {
   id: string;
  name: string; symbol: string; decimals: number; family: Family;
   placeholder: string;
   memo?: boolean;
  address: (phrase: string, index: number) => string;
  format: (units: bigint) => string;
  quote: (phrase: string, index: number, to: string, amountText: string, memo?: string) => Promise<Q>;
  spendable: (phrase: string, index: number) => Promise<bigint>;
  sign: (phrase: string, index: number, q: Q) => Promise<S>;
  submit: (s: S) => Promise<KitSubmit>;
  wait: (s: S, signedAt: number, o: { maxMs: number }) => Promise<KitEnd>;
  pendingOf: (s: S) => Omit<PendingPayment, "at">;

  signedOf: (p: PendingPayment | null) => S | null;
  txUrl: (hash: string) => string;
}

export const kitErr = (code: string, extra: Record<string, unknown> = {}) => Object.assign(new Error(code), extra);

export function parseUnits(s: string, decimals: number, max: bigint): bigint {
  const v = String(s ?? "").trim();
  if (!new RegExp(`^\\d{1,15}(\\.\\d{1,${decimals}})?$`).test(v)) throw kitErr("ERR_AMOUNT");
  const [i, f = ""] = v.split(".");
  const one = 10n ** BigInt(decimals);
  const u = BigInt(i) * one + BigInt((f + "0".repeat(decimals)).slice(0, decimals));
  if (u > max) throw kitErr("ERR_AMOUNT");
  return u;
}

export function formatUnits(u: bigint, decimals: number): string {
  const neg = u < 0n, a = neg ? -u : u, one = 10n ** BigInt(decimals);
  const f = (a % one).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${a / one}${f ? "." + f : ""}`;
}

export function bigOf(v: unknown, max = (1n << 128n) - 1n): bigint | null {
  const s = typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? String(v) : typeof v === "string" ? v : null;
  if (s == null || !/^\d{1,39}$/.test(s)) return null;
  const b = BigInt(s);
  return b <= max ? b : null;
}

export function uleb(n: number | bigint): number[] {
  let v = BigInt(n);
  if (v < 0n) throw kitErr("ERR_UNSAFE");
  const out: number[] = [];
  do { let b = Number(v & 0x7fn); v >>= 7n; if (v) b |= 0x80; out.push(b); } while (v);
  return out;
}

export function leU(v: bigint, bytes: number): number[] {
  if (v < 0n || v >= 1n << BigInt(8 * bytes)) throw kitErr("ERR_UNSAFE");
  return Array.from({ length: bytes }, (_, i) => Number((v >> BigInt(8 * i)) & 0xffn));
}
export const concat = (...parts: (Uint8Array | number[])[]) => Uint8Array.from(parts.flatMap((p) => Array.from(p)));
export const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);
