export const ALLOWED_ORIGINS: readonly string[] = ["https://madarwallet.app", "https://swap.madarwallet.app"];

export const SITE_ORIGINS: readonly string[] = ["https://madarwallet.app"];

export const SWAP_ORIGINS: readonly string[] = ["https://swap.madarwallet.app"];

export const ALLOWED_ORIGIN = "https://madarwallet.app";

export const isAllowedOrigin = (o: unknown): o is string => typeof o === "string" && ALLOWED_ORIGINS.includes(o);

export const EVM_ONLY_ORIGINS: readonly string[] = [];
export const solAllowedOrigin = (o: unknown): boolean => isAllowedOrigin(o) && !EVM_ONLY_ORIGINS.includes(o);

export function senderOrigin(s: { origin?: string; url?: string } | undefined): string | null {
  if (!s) return null;
  if (s.origin) return s.origin;
  try { if (!s.url) return null; const u = new URL(s.url); return u.origin !== "null" ? u.origin : `${u.protocol}//${u.host}`; } catch { return null; }
}

export const PAGE_TARGET = "madar-wallet:page";
export const CS_TARGET = "madar-wallet:cs";
export const PORT_NAME = "madar-dapp";

export type DappChain = "evm" | "sol";
export interface DappRequest { chain: DappChain; method: string; params?: unknown }
export interface DappError { code: number; message: string }
export type DappReply = { ok: true; result: unknown } | { ok: false; error: DappError };

export interface DappState { evm: { accounts: string[]; chainId: string }; sol: { accounts: string[] } }

export const ERR = {
  rejected: 4001,
  unauthorized: 4100,
  unsupported: 4200,
  disconnected: 4900,
  unknownChain: 4902,
  pending: -32002,
  invalidParams: -32602,
  limit: -32005,
  internal: -32603,
} as const;

export class DappRpcError extends Error {
  constructor(public code: number, message: string) { super(message); }
}
export const rpcError = (code: number, message: string) => new DappRpcError(code, message);
export function toDappError(e: unknown): DappError {
  if (e instanceof DappRpcError) return { code: e.code, message: e.message };
  const m = e instanceof Error ? e.message : String(e);
  return { code: ERR.internal, message: m.slice(0, 300) || "Internal error" };
}

export interface PageRequestMsg { target: typeof CS_TARGET; channel: string; id: number; req: DappRequest }
export interface PageHelloMsg { target: typeof CS_TARGET; hello: string }
export interface PageReplyMsg { target: typeof PAGE_TARGET; channel: string; id: number; reply: DappReply }
export interface PageStateMsg { target: typeof PAGE_TARGET; channel: string; state: DappState }

export const toB64 = (b: Uint8Array) => { let s = ""; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };
export const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
