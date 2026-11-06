import { base58 } from "@scure/base";

export const SYSTEM_PROGRAM = "11111111111111111111111111111111";
export const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
export const ATA_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
export const COMPUTE_BUDGET_PROGRAM = "ComputeBudget111111111111111111111111111111";
export const MEMO_PROGRAMS = new Set(["MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr", "Memo1UhkJRfHyvLMcVucJwxXeuD6YPGGjkyA1ScUPiQr6FV9u"]);
export const SIGNATURE_FEE = 5000n;

export interface RawIx { programIndex: number; accounts: number[]; data: Uint8Array }
export interface Lookup { table: string; writable: number[]; readonly: number[] }
export interface ParsedTx {
  version: "legacy" | 0;
  sigCount: number;
  sigStart: number;
  message: Uint8Array;
  header: { required: number; roSigned: number; roUnsigned: number };
  staticKeys: string[];
  blockhash: string;
  instructions: RawIx[];
  lookups: Lookup[];
}

export class SolDecodeError extends Error {}

export function parseSolTransaction(raw: Uint8Array): ParsedTx {
  let o = 0;
  const need = (n: number) => { if (o + n > raw.length) throw new SolDecodeError("truncated"); };
  const u8 = () => { need(1); return raw[o++]; };
  const cu16 = () => { let v = 0; for (let s = 0; s < 21; s += 7) { const b = u8(); v |= (b & 0x7f) << s; if (!(b & 0x80)) return v; } throw new SolDecodeError("bad length"); };
  const bytes = (n: number) => { need(n); const b = raw.slice(o, o + n); o += n; return b; };
  const key = () => base58.encode(bytes(32));

  const sigCount = cu16();
  const sigStart = o;
  bytes(64 * sigCount);
  const msgStart = o;
  let version: "legacy" | 0 = "legacy";
  if (raw[o] & 0x80) { const v = u8() & 0x7f; if (v !== 0) throw new SolDecodeError("unsupported version"); version = 0; }
  const header = { required: u8(), roSigned: u8(), roUnsigned: u8() };
  const nKeys = cu16();
  const staticKeys: string[] = [];
  for (let i = 0; i < nKeys; i++) staticKeys.push(key());
  const blockhash = key();
  const nIx = cu16();
  const instructions: RawIx[] = [];
  for (let i = 0; i < nIx; i++) {
    const programIndex = u8();
    const na = cu16();
    const accounts = Array.from(bytes(na));
    const nd = cu16();
    instructions.push({ programIndex, accounts, data: bytes(nd) });
  }
  const lookups: Lookup[] = [];
  if (version === 0) {
    const nl = cu16();
    for (let i = 0; i < nl; i++) {
      const table = key();
      const writable = Array.from(bytes(cu16()));
      const readonly = Array.from(bytes(cu16()));
      lookups.push({ table, writable, readonly });
    }
  }
  if (o !== raw.length) throw new SolDecodeError("trailing bytes");
  if (sigCount !== header.required || header.required === 0 || header.required > nKeys) throw new SolDecodeError("bad signer count");
  for (const ix of instructions) if (ix.programIndex >= nKeys) throw new SolDecodeError("program must be a static key");
  return { version, sigCount, sigStart, message: raw.slice(msgStart), header, staticKeys, blockhash, instructions, lookups };
}

export function accountKeys(tx: ParsedTx, tables: Record<string, string[]> = {}): (string | null)[] {
  const out: (string | null)[] = [...tx.staticKeys];
  for (const l of tx.lookups) for (const i of l.writable) out.push(tables[l.table]?.[i] ?? null);
  for (const l of tx.lookups) for (const i of l.readonly) out.push(tables[l.table]?.[i] ?? null);
  return out;
}

export type SolIx =
  | { kind: "sol-transfer"; from: string | null; to: string | null; lamports: string }
  | { kind: "create-account"; from: string | null; account: string | null; lamports: string }
  | { kind: "token-transfer"; checked: boolean; amount: string; decimals: number | null; mint: string | null; source: string | null; dest: string | null; authority: string | null; program: string }
  | { kind: "token-approve"; amount: string; decimals: number | null; mint: string | null; source: string | null; delegate: string | null; program: string }
  | { kind: "token-close"; account: string | null; dest: string | null }
  | { kind: "sync-native"; account: string | null }
  | { kind: "create-ata"; payer: string | null; ata: string | null; owner: string | null; mint: string | null }
  | { kind: "compute-limit"; units: number }
  | { kind: "compute-price"; microLamports: string }
  | { kind: "memo"; text: string }
  | { kind: "unknown"; program: string };

const le = (d: Uint8Array, at: number, n: number) => { let v = 0n; for (let i = n - 1; i >= 0; i--) v = (v << 8n) | BigInt(d[at + i]); return v; };

export function describeInstruction(ix: RawIx, keys: (string | null)[]): SolIx {
  const program = keys[ix.programIndex] as string;
  const acc = (i: number) => (ix.accounts[i] != null ? keys[ix.accounts[i]] ?? null : null);
  const d = ix.data;
  if (program === SYSTEM_PROGRAM && d.length >= 4) {
    const tag = Number(le(d, 0, 4));
    if (tag === 2 && d.length === 12 && ix.accounts.length >= 2) return { kind: "sol-transfer", from: acc(0), to: acc(1), lamports: le(d, 4, 8).toString() };
    if (tag === 0 && d.length === 52 && ix.accounts.length >= 2) return { kind: "create-account", from: acc(0), account: acc(1), lamports: le(d, 4, 8).toString() };
  }
  if ((program === TOKEN_PROGRAM || program === TOKEN_2022_PROGRAM) && d.length >= 1) {
    const tag = d[0];
    if (tag === 3 && d.length === 9 && ix.accounts.length >= 3)
      return { kind: "token-transfer", checked: false, amount: le(d, 1, 8).toString(), decimals: null, mint: null, source: acc(0), dest: acc(1), authority: acc(2), program };
    if (tag === 12 && d.length === 10 && ix.accounts.length >= 4)
      return { kind: "token-transfer", checked: true, amount: le(d, 1, 8).toString(), decimals: d[9], mint: acc(1), source: acc(0), dest: acc(2), authority: acc(3), program };
    if (tag === 4 && d.length === 9 && ix.accounts.length >= 3)
      return { kind: "token-approve", amount: le(d, 1, 8).toString(), decimals: null, mint: null, source: acc(0), delegate: acc(1), program };
    if (tag === 13 && d.length === 10 && ix.accounts.length >= 4)
      return { kind: "token-approve", amount: le(d, 1, 8).toString(), decimals: d[9], mint: acc(1), source: acc(0), delegate: acc(2), program };
    if (tag === 9 && d.length === 1 && ix.accounts.length >= 3) return { kind: "token-close", account: acc(0), dest: acc(1) };
    if (tag === 17 && d.length === 1 && ix.accounts.length >= 1) return { kind: "sync-native", account: acc(0) };
  }
  if (program === ATA_PROGRAM && (d.length === 0 || (d.length === 1 && (d[0] === 0 || d[0] === 1))) && ix.accounts.length >= 4)
    return { kind: "create-ata", payer: acc(0), ata: acc(1), owner: acc(2), mint: acc(3) };
  if (program === COMPUTE_BUDGET_PROGRAM && d.length >= 1) {
    if (d[0] === 2 && d.length === 5) return { kind: "compute-limit", units: Number(le(d, 1, 4)) };
    if (d[0] === 3 && d.length === 9) return { kind: "compute-price", microLamports: le(d, 1, 8).toString() };
  }
  if (MEMO_PROGRAMS.has(program)) {
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(d);
      if (text.length <= 566 && !/[\u0000-\u0008\u000b-\u001f‪-‮⁦-⁩]/.test(text)) return { kind: "memo", text };
    } catch {  }
  }
  return { kind: "unknown", program };
}

export function estimateSolFee(tx: ParsedTx, items: SolIx[]): bigint {
  const price = items.find((x) => x.kind === "compute-price") as { microLamports: string } | undefined;
  const limitIx = items.find((x) => x.kind === "compute-limit") as { units: number } | undefined;
  const nonBudget = items.filter((x) => x.kind !== "compute-limit" && x.kind !== "compute-price").length;
  const limit = BigInt(limitIx ? limitIx.units : Math.min(1_400_000, 200_000 * Math.max(1, nonBudget)));
  const priority = price ? (BigInt(price.microLamports) * limit + 999_999n) / 1_000_000n : 0n;
  return SIGNATURE_FEE * BigInt(tx.header.required) + priority;
}

export const signerIndex = (tx: ParsedTx, signer: string) => tx.staticKeys.slice(0, tx.header.required).indexOf(signer);

export function withSignature(raw: Uint8Array, tx: ParsedTx, index: number, signature: Uint8Array): Uint8Array {
  if (signature.length !== 64 || index < 0 || index >= tx.sigCount) throw new SolDecodeError("bad signature slot");
  const out = raw.slice();
  out.set(signature, tx.sigStart + 64 * index);
  return out;
}

const OFFCHAIN_PREFIX = Uint8Array.from([0xff, ...new TextEncoder().encode("solana offchain")]);
const startsWith = (b: Uint8Array, p: Uint8Array) => b.length >= p.length && p.every((x, i) => b[i] === x);

export function looksLikeSolTransaction(bytes: Uint8Array): boolean {
  try { parseSolTransaction(bytes); return true; } catch {  }
  if (!bytes.length) return false;
  const n = bytes[bytes[0] & 0x80 ? 1 : 0];
  if (n == null || n === 0 || n > 127) return false;
  const wire = new Uint8Array(1 + 64 * n + bytes.length);
  wire[0] = n;
  wire.set(bytes, 1 + 64 * n);
  try { parseSolTransaction(wire); return true; } catch { return false; }
}

export function solMessageAllowed(bytes: Uint8Array): boolean {
  if (!bytes.length) return false;
  if (startsWith(bytes, OFFCHAIN_PREFIX)) return true;

  if (bytes[0] < 0x20) return false;
  if (looksLikeSolTransaction(bytes)) return false;
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { return false; }
  return !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(text);
}
