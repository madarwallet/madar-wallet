import { onePay, type OneDest } from "./oneclick";
import { thorPay } from "./thorbuy";
import { xrpAccount, xrpLedger } from "./xrpbase";
import type { ThorCoin } from "../dapp/thordecode";
import { TRON, TRX_TOKEN } from "./tronbase";

export type BuyCoin = (ThorCoin & OneDest) | "ADA" | "TRX" | "NEAR";
export const BUY_COIN_OF: Readonly<Record<string, BuyCoin>> = { dogecoin: "DOGE", litecoin: "LTC", xrp: "XRP", cardano: "ADA", near: "NEAR" };

export const buyCoinOf = (netId: string, token: string): BuyCoin | null =>
  netId === TRON.id ? (token === TRX_TOKEN ? "TRX" : null) : Object.prototype.hasOwnProperty.call(BUY_COIN_OF, netId) ? BUY_COIN_OF[netId] : null;

export const thorBuys = (c: BuyCoin): c is ThorCoin & OneDest => c !== "ADA" && c !== "TRX" && c !== "NEAR";

export function nativeRoutes(netId: string, token: string): { thor: ReturnType<typeof thorPay>; one: ReturnType<typeof onePay> } {
  return { thor: thorPay(netId, token), one: onePay(netId, token) };
}

export function pickNativeRoute(thor: { amountOut: bigint } | null, one: { amountOut: bigint } | null): "thor" | "one" | null {
  if (thor && one) return one.amountOut > thor.amountOut ? "one" : "thor";
  return thor ? "thor" : one ? "one" : null;
}

export type NativeWhy = { why: "small" | "busy" | "big" | "net" | "none"; minIn: bigint | null; minUsd: number | null };
type Refusal = { message?: string; kind?: string; minIn?: bigint | null; minUsd?: number | null; thorbuy?: boolean; onebuy?: boolean; api?: boolean } | null | undefined;
export function nativeBuyFailure(thorErr: unknown, oneErr: unknown): NativeWhy {
  const t = thorErr as Refusal, o = oneErr as Refusal;
  const small = [t, o].filter((e) => e && (e.thorbuy || e.onebuy) && e.kind === "small");
  if (small.length) {

    const ins = small.map((e) => e!.minIn).filter((v): v is bigint => v != null);
    const usd = small.map((e) => e!.minUsd).filter((v): v is number => v != null);
    return { why: "small", minIn: ins.length ? ins.reduce((a, b) => (b < a ? b : a)) : null, minUsd: usd.length && !ins.length ? Math.min(...usd) : null };
  }
  if ([t, o].some((e) => e && (e.thorbuy || e.onebuy) && e.kind === "busy" && e.message === "ERR_BUSY")) return { why: "busy", minIn: null, minUsd: null };
  if ([t, o].some((e) => e && e.onebuy && e.kind === "big")) return { why: "big", minIn: null, minUsd: null };
  const offline = (e: Refusal) => !e || (!e.thorbuy && !e.onebuy && e.message !== "ERR_UNSAFE" && /fetch|network|timeout|abort|ERR_NET/i.test(e.message ?? "")) || (e.thorbuy && e.message === "ERR_NET");
  if (offline(t) && offline(o) && (t || o)) return { why: "net", minIn: null, minUsd: null };
  return { why: "none", minIn: null, minUsd: null };
}

export async function xrpActivationNeed(address: string): Promise<bigint | null> {
  const a = await xrpAccount(address);
  if (a.exists) return null;
  return (await xrpLedger()).reserveBase;
}

export const activationOk = (minOut: bigint, need: bigint | null) => need == null || minOut >= need;

export function thorLeastDelivered(amountOut: bigint, outFee: bigint | null): bigint | null {
  if (outFee == null || outFee < 0n) return null;
  const least = (amountOut * 99n) / 100n - outFee;
  return least > 0n ? least : 0n;
}

export const activationCovered = (least: bigint | null, need: bigint | null) => need == null || (least != null && activationOk((least * 100n) / 102n, need));
