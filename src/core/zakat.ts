export const ZAKAT_RATE = 0.025;
export const NISAB_GOLD_GRAMS = 85;
export const TROY_OUNCE_GRAMS = 31.1034768;

export const GOLD_ID = "pax-gold";

export function nisabValue(ouncePrice: number | null | undefined): number | null {
  if (typeof ouncePrice !== "number" || !Number.isFinite(ouncePrice) || ouncePrice <= 0) return null;
  return (NISAB_GOLD_GRAMS / TROY_OUNCE_GRAMS) * ouncePrice;
}

export interface ZakatView { total: number; nisab: number; reached: boolean; due: number }

export function zakatOf(total: number | null | undefined, nisab: number | null | undefined): ZakatView | null {
  if (typeof total !== "number" || !Number.isFinite(total) || total < 0 || typeof nisab !== "number" || !Number.isFinite(nisab) || nisab <= 0) return null;
  const reached = total >= nisab;
  return { total, nisab, reached, due: reached ? total * ZAKAT_RATE : 0 };
}
