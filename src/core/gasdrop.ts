export const DROP_CHAINS: Readonly<Record<string, number>> = { ethereum: 1, bsc: 56, arbitrum: 42161, base: 8453, polygon: 137 };

export const DROP_MIN_USD = 5;
export const GASDROP_URL = "https://swap.madarwallet.app/gasdrop";
const TIMEOUT = 60_000;

export type DropWhy = "used" | "no_coin" | "not_needed" | "busy" | "too_many" | "gas_high" | "empty" | "other";
export type DropAnswer = { ok: true; tx: string; wei: bigint; coin: string } | { ok: false; why: DropWhy };

export function dropOffer(netId: string, nativeBalance: bigint | null | undefined, dollarsUsd: number): boolean {
  return netId in DROP_CHAINS && nativeBalance === 0n && dollarsUsd >= DROP_MIN_USD;
}

const WHY: Readonly<Record<string, DropWhy>> = { used: "used", no_coin: "no_coin", not_needed: "not_needed", busy: "busy", too_many: "too_many", gas_high: "gas_high", empty: "empty" };

export function readDropAnswer(status: number, j: unknown): DropAnswer {
  const o = (j ?? {}) as { ok?: unknown; tx?: unknown; wei?: unknown; coin?: unknown; error?: unknown };
  if (status === 200 && o.ok === true && typeof o.tx === "string" && /^0x[0-9a-fA-F]{64}$/.test(o.tx) && typeof o.wei === "string" && /^[0-9]{1,30}$/.test(o.wei) && BigInt(o.wei) > 0n)
    return { ok: true, tx: o.tx, wei: BigInt(o.wei), coin: typeof o.coin === "string" ? o.coin.slice(0, 8) : "" };
  return { ok: false, why: WHY[String(o.error ?? "")] ?? "other" };
}

export async function askGasDrop(netId: string, address: string, fetcher: typeof fetch = fetch): Promise<DropAnswer> {
  const chain = DROP_CHAINS[netId];
  if (!chain || !/^0x[0-9a-fA-F]{40}$/.test(address)) return { ok: false, why: "other" };
  try {
    const r = await fetcher(GASDROP_URL, {
      method: "POST", headers: { "Content-Type": "text/plain;charset=UTF-8" }, body: JSON.stringify({ chain, address }),
      credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store", signal: AbortSignal.timeout(TIMEOUT),
    });
    return readDropAnswer(r.status, await r.json().catch(() => null));
  } catch {
    return { ok: false, why: "other" };
  }
}
