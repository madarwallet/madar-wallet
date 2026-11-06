const DIGITS = (s: string) => s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6f0));

export function normAmount(input: unknown): string {
  let s = DIGITS(String(input ?? "").trim()).replace(/[٫،]/g, ".").replace(/[٬\s  ]/g, "");
  if (s.includes(",") && s.includes(".")) s = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  else if (/^[1-9]\d{0,2}(,\d{3}){2,}$/.test(s)) s = s.replace(/,/g, "");
  else s = s.replace(/,/g, ".");
  if (/^\.\d+$/.test(s)) s = "0" + s;
  else if (/^\d+\.$/.test(s)) s = s.slice(0, -1);
  return s;
}

export const isAmountText = (s: string) => /^\d+(\.\d+)?$/.test(s);

export function amountAmbiguous(input: unknown): { read: string; other: string } | null {
  const raw = DIGITS(String(input ?? "").trim());
  return /^[1-9]\d{0,2},\d{3}$/.test(raw) ? { read: normAmount(raw), other: raw.replace(",", "") } : null;
}

export function amountChars(input: string): string {
  const clean = DIGITS(input).replace(/[٫,،]/g, ".").replace(/[^0-9.]/g, "");
  const i = clean.indexOf(".");
  return i < 0 ? clean : clean.slice(0, i + 1) + clean.slice(i + 1).replace(/\./g, "");
}
