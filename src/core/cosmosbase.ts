import { ripemd160 } from "@noble/hashes/legacy.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { bech32 } from "@scure/base";
import { HDKey } from "@scure/bip32";
import { mnemonicToSeedSync } from "@scure/bip39";
import { memoAddress, normalizePhrase } from "./account";
import { hostFetch } from "./hostgate";
import { notImported } from "./imported";
import { bigOf, formatUnits, kitErr, parseUnits } from "./sendkit";

export type CosmosId = "cosmoshub" | "osmosis" | "celestia";
export interface CosmosChain {
  id: CosmosId; name: string; symbol: "ATOM" | "OSMO" | "TIA"; coinName: string; coingecko: string; decimals: 6; family: "atom" | "osmo" | "tia";
  denom: string; prefix: string; chainId: string; rest: string[]; explorer: string;
   minPrice: bigint;
   maxFee: bigint;
   priceUrl?: string;
}
export const COSMOS_CHAINS: readonly CosmosChain[] = [
  { id: "cosmoshub", name: "Cosmos Hub", symbol: "ATOM", coinName: "Cosmos Hub", coingecko: "cosmos", decimals: 6, family: "atom", denom: "uatom", prefix: "cosmos", chainId: "cosmoshub-4",
    rest: ["https://cosmos-rest.publicnode.com", "https://rest.cosmos.directory/cosmoshub"], explorer: "https://www.mintscan.io/cosmos", minPrice: 10_000n, maxFee: 50_000n, priceUrl: "/feemarket/v1/gas_price/uatom" },
  { id: "osmosis", name: "Osmosis", symbol: "OSMO", coinName: "Osmosis", coingecko: "osmosis", decimals: 6, family: "osmo", denom: "uosmo", prefix: "osmo", chainId: "osmosis-1",
    rest: ["https://osmosis-rest.publicnode.com", "https://rest.cosmos.directory/osmosis"], explorer: "https://www.mintscan.io/osmosis", minPrice: 25_000n, maxFee: 200_000n, priceUrl: "/osmosis/txfees/v1beta1/cur_eip_base_fee" },
  { id: "celestia", name: "Celestia", symbol: "TIA", coinName: "Celestia", coingecko: "celestia", decimals: 6, family: "tia", denom: "utia", prefix: "celestia", chainId: "celestia",
    rest: ["https://celestia-rest.publicnode.com", "https://rest.cosmos.directory/celestia"], explorer: "https://www.mintscan.io/celestia", minPrice: 20_000n, maxFee: 200_000n },
];
export const cosmosById = (id: string) => COSMOS_CHAINS.find((c) => c.id === id);
export const cosmosTxUrl = (c: CosmosChain, hash: string) => `${c.explorer}/tx/${hash}`;

export const MICRO_MAX = 10n ** 12n * 10n ** 6n;

export function cosmosKey(phrase: string, index = 0): { priv: Uint8Array; pub: Uint8Array } {
  notImported(index);
  if (!Number.isInteger(index) || index < 0 || index > 0x7fffffff) throw new Error("bad index");
  const k = HDKey.fromMasterSeed(mnemonicToSeedSync(normalizePhrase(phrase))).derive(`m/44'/118'/0'/0/${index}`);
  if (!k.privateKey || !k.publicKey || k.publicKey.length !== 33) throw new Error("bad key");
  return { priv: k.privateKey, pub: k.publicKey };
}

export function cosmosAddressOf(prefix: string, pub: Uint8Array): string {
  if (pub.length !== 33) throw new Error("bad key");
  return bech32.encode(prefix, bech32.toWords(ripemd160(sha256(pub))));
}
export const cosmosAddress = (c: CosmosChain, phrase: string, index = 0) => memoAddress(`cosmos:${c.prefix}`, phrase, index, () => cosmosAddressOf(c.prefix, cosmosKey(phrase, index).pub));

export function isCosmosAddress(c: CosmosChain, a: string): boolean {
  const v = String(a ?? "").trim();
  if (v !== v.toLowerCase() || !v.startsWith(c.prefix + "1")) return false;
  try {
    const d = bech32.decode(v as `${string}1${string}`);
    const n = bech32.fromWords(d.words).length;
    return d.prefix === c.prefix && (n === 20 || n === 32);
  } catch { return false; }
}
export const accountIdHex = (a: string) => { try { return bytesToHex(bech32.fromWords(bech32.decode(a as `${string}1${string}`).words)); } catch { return ""; } };

export const parseCosmos = (s: string) => parseUnits(s, 6, MICRO_MAX);
export const formatCosmos = (u: bigint) => formatUnits(u, 6);

export class CosmosError extends Error { constructor(readonly status: number, readonly code: number, readonly detail: string) { super(`COSMOS_${code}`); } }

export async function cosmosFetch<T = Record<string, unknown>>(c: CosmosChain, path: string, init: RequestInit = {}, o: { hosts?: string[]; timeoutMs?: number } = {}): Promise<T> {
  if (!/^\/[A-Za-z0-9_/?=&.%-]*$/.test(path)) throw new Error("bad Cosmos path");
  let last: unknown = new Error("network");
  let said: CosmosError | null = null;
  for (const host of o.hosts ?? c.rest) {
    if (!c.rest.includes(host)) throw new Error("bad Cosmos host");
    try {
      const r = await hostFetch(host + path, init, o.timeoutMs ?? 10_000);
      const j = (await r.json().catch(() => null)) as Record<string, unknown> | null;
      if (r.status >= 400 && r.status < 500 && r.status !== 429 && j && typeof j === "object" && typeof j.code === "number")
        throw new CosmosError(r.status, j.code, String(j.message ?? "").slice(0, 300));

      if (r.status >= 500 && j && typeof j === "object" && typeof j.code === "number" && j.code > 0) { said = new CosmosError(r.status, j.code, String(j.message ?? "").slice(0, 300)); continue; }
      if (!r.ok || j == null) throw new Error(`HTTP ${r.status}`);
      return j as T;
    } catch (e) {
      if (e instanceof CosmosError) throw e;
      last = e;
    }
  }
  throw said ?? last;
}

export function readCosmosBalance(res: unknown, denom: string): bigint {
  const b = (res as { balance?: { denom?: unknown; amount?: unknown } | null })?.balance;
  if (b == null) return 0n;
  const v = bigOf(b.amount, MICRO_MAX);
  if (v == null || (b.denom != null && b.denom !== denom)) throw kitErr("ERR_PROVIDER");
  return v;
}

export async function cosmosBalances(c: CosmosChain, address: string): Promise<{ total: bigint; spendable: bigint }> {
  if (!isCosmosAddress(c, address)) throw kitErr("ERR_ADDRESS");
  const q = `?denom=${c.denom}`;
  const total = readCosmosBalance(await cosmosFetch(c, `/cosmos/bank/v1beta1/balances/${address}/by_denom${q}`), c.denom);
  const spendable = await cosmosFetch(c, `/cosmos/bank/v1beta1/spendable_balances/${address}/by_denom${q}`).then((r) => readCosmosBalance(r, c.denom), () => total);
  return { total, spendable: spendable < total ? spendable : total };
}
