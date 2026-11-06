import { DUST_SATS, isBtcAddress } from "../core/btcbase";
import { ERR, rpcError, SITE_ORIGINS, SWAP_ORIGINS } from "./protocol";

export const BTC_SEND_ORIGINS: readonly string[] = [...SITE_ORIGINS, ...SWAP_ORIGINS];
export const MAX_SATS = 21_000_000n * 100_000_000n;

export const btcFeeTooHigh = (amount: bigint, fee: bigint) => fee * 10n > amount;

export function parseBtcSendParams(params: unknown): { to: string; sats: bigint } {
  const p = (Array.isArray(params) ? params[0] : params) as Record<string, unknown> | null | undefined;
  const bad = (why: string) => rpcError(ERR.invalidParams, `madar_sendBitcoin: ${why} (expected [{ to: "<Bitcoin address>", sats: "<integer>" }])`);
  if (!p || typeof p !== "object" || Array.isArray(p)) throw bad("missing request");
  const keys = Object.keys(p);
  if (keys.some((k) => k !== "to" && k !== "sats")) throw bad("unknown field");
  if (typeof p.to !== "string" || p.to.length > 100) throw bad("invalid address");
  const raw = p.to.trim();
  const to = /^BC1[02-9AC-HJ-NP-Z]+$/.test(raw) ? raw.toLowerCase() : raw;
  if (!isBtcAddress(to)) throw bad("invalid Bitcoin mainnet address");
  let sats: bigint;
  if (typeof p.sats === "string" && /^[1-9]\d{0,15}$/.test(p.sats)) sats = BigInt(p.sats);
  else if (typeof p.sats === "number" && Number.isSafeInteger(p.sats) && p.sats > 0) sats = BigInt(p.sats);
  else throw bad("invalid amount");
  if (sats < DUST_SATS) throw bad(`amount below ${DUST_SATS} sats`);
  if (sats > MAX_SATS) throw bad("amount too large");
  return { to, sats };
}
