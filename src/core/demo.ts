import { parseUnits } from "viem";

export const demoOn = (): boolean => import.meta.env.DEV && (globalThis as { __DEMO_BAL__?: boolean }).__DEMO_BAL__ === true;

const NATIVE: Record<number, string> = { 1: "0.25", 8453: "0.04", 56: "0.5", 59144: "0.12", 146: "150" };
const TOKENS: Record<string, string> = { "8453:USDC": "300", "1:USDT": "150", "42161:USDC": "90", "59144:USDC": "85", "146:USDC": "40", "56:USDT": "40" };
export const demoEvmNative = (chainId: number, decimals: number): bigint => parseUnits(NATIVE[chainId] ?? "0", decimals);
export const demoEvmToken = (chainId: number, symbol: string, decimals: number): bigint => parseUnits(TOKENS[`${chainId}:${symbol}`] ?? "0", decimals);
export const DEMO_BTC_SATS = 800_000n;
export const DEMO_SOL_LAMPORTS = 3_200_000_000n;
export const DEMO_TRX_SUN = 42_500_000n;
export const DEMO_TRON_USDT = 250_000_000n;
export const DEMO_DOGE_KOINU = 152_000_000_000n;
export const DEMO_LTC_LITOSHI = 145_000_000n;
export const DEMO_XRP_DROPS = 86_400_000n;
export const DEMO_ADA_LOVELACE = 412_500_000n;
export const demoSolToken =(mint: string): bigint => (mint === "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" ? 120_000_000n : 0n);
