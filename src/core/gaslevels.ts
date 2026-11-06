export type GasSpeed = "slow" | "normal" | "fast";
export const GAS_SPEEDS: readonly GasSpeed[] = ["slow", "normal", "fast"];
export interface Eip1559 { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }

let speed: GasSpeed = "normal";

export function setGasSpeed(s: unknown): void { speed = s === "slow" || s === "fast" ? s : "normal"; }
export const gasSpeed = (): GasSpeed => speed;

export function median(xs: readonly bigint[]): bigint | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return s[Math.floor((s.length - 1) / 2)];
}

export function levelsFrom(base: bigint | null, rewards: readonly (readonly bigint[])[], est: Eip1559): Record<GasSpeed, Eip1559> {
  const col = (i: number) => median(rewards.map((r) => r[i]).filter((x): x is bigint => typeof x === "bigint" && x >= 0n));
  const normal = { maxFeePerGas: est.maxFeePerGas, maxPriorityFeePerGas: est.maxPriorityFeePerGas };
  const low = col(0), high = col(2);

  const slowTip = low == null ? est.maxPriorityFeePerGas / 2n : (low < est.maxPriorityFeePerGas ? low : est.maxPriorityFeePerGas);
  let slowMax = base != null ? (base * 115n) / 100n + slowTip : est.maxFeePerGas - (est.maxPriorityFeePerGas - slowTip);
  if (slowMax > est.maxFeePerGas) slowMax = est.maxFeePerGas;
  if (slowMax < slowTip) slowMax = slowTip;

  const twice = est.maxPriorityFeePerGas * 2n;
  const fastTip = high != null && high > twice ? high : twice;
  let fastMax = (base != null ? base * 2n : est.maxFeePerGas) + fastTip;
  const floor = (est.maxFeePerGas * 125n) / 100n;
  if (fastMax < floor) fastMax = floor;
  return { slow: { maxFeePerGas: slowMax, maxPriorityFeePerGas: slowTip }, normal, fast: { maxFeePerGas: fastMax, maxPriorityFeePerGas: fastTip } };
}

export function bumpFees(orig: Eip1559, fast: Eip1559): Eip1559 {
  const up = (x: bigint) => (x * 120n) / 100n + 1n;
  const tip = up(orig.maxPriorityFeePerGas) > fast.maxPriorityFeePerGas ? up(orig.maxPriorityFeePerGas) : fast.maxPriorityFeePerGas;
  let max = up(orig.maxFeePerGas) > fast.maxFeePerGas ? up(orig.maxFeePerGas) : fast.maxFeePerGas;
  if (max < tip) max = tip;
  return { maxFeePerGas: max, maxPriorityFeePerGas: tip };
}
