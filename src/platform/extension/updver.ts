export const READY_KEY = "madar-upd-ready";
export const CHECKED_KEY = "madar-upd-checked";
export const EVERY_MS = 6 * 3600 * 1000;

export function newer(a: string, b: string): boolean {
  const x = a.split(".").map((n) => parseInt(n, 10) || 0), y = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
}
