import { isLegacyLtcP2sh, type UtxoCoin } from "./utxobase";

export const feeShareHigh = (fee: bigint, amount: bigint) => amount <= 0n || fee * 10n > amount;

export const feePct = (fee: bigint, amount: bigint) => (amount > 0n ? String(Math.round(Number((fee * 1000n) / amount)) / 10) : "100");

export const xrpAskTag = (q: { tag: number | null; newAccount: boolean }, ownIdx: number | null | undefined) => q.tag == null && ownIdx == null && !q.newAccount;

export const ltcOld3Ok = (c: UtxoCoin, to: string, tickedFor: string) => !isLegacyLtcP2sh(c, to) || (tickedFor !== "" && tickedFor === to.trim());

export const OVERRIDE_AFTER_MS = 10 * 60_000;
export const canGoPast = (signedAt: number, now = Date.now()) => now - signedAt > OVERRIDE_AFTER_MS;
export const xrpBlocked = (pendingHash: string | null | undefined, wentPast: string | null) => pendingHash != null && pendingHash !== wentPast;
