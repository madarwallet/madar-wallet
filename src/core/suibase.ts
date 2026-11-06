import { blake2b } from "@noble/hashes/blake2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { ed25519 } from "@noble/curves/ed25519.js";
import { mnemonicToSeedSync } from "@scure/bip39";
import { memoAddress, normalizePhrase } from "./account";
import { hostFetch } from "./hostgate";
import { notImported } from "./imported";
import { slip10Ed25519 } from "./nearbase";
import { bigOf, formatUnits, kitErr, parseUnits } from "./sendkit";

export const SUI = { id: "sui", name: "Sui", symbol: "SUI", coingecko: "sui", decimals: 9, explorer: "https://suivision.xyz", family: "sui" } as const;
export const suiTxUrl = (digest: string) => `${SUI.explorer}/txblock/${digest}`;
export const SUI_GQL = ["https://graphql.mainnet.sui.io/graphql"];
export const SUI_COIN = "0x2::sui::SUI";

export const MIST_MAX = 10n ** 10n * 10n ** 9n;

export function suiSecret(phrase: string, index = 0): Uint8Array {
  notImported(index);
  if (!Number.isInteger(index) || index < 0 || index > 0x7fffffff) throw new Error("bad index");
  return slip10Ed25519(mnemonicToSeedSync(normalizePhrase(phrase)), [44, 784, index, 0, 0]);
}
export const suiPublicKey = (secret: Uint8Array) => ed25519.getPublicKey(secret);

export function suiAddressOf(pub: Uint8Array): string {
  if (pub.length !== 32) throw new Error("bad key");
  return "0x" + bytesToHex(blake2b(Uint8Array.from([0, ...pub]), { dkLen: 32 }));
}
export const suiAddress = (phrase: string, index = 0) => memoAddress("sui", phrase, index, () => suiAddressOf(suiPublicKey(suiSecret(phrase, index))));

export const isSuiAddress = (a: string) => /^0x[0-9a-f]{64}$/.test(String(a ?? "").trim());

export const parseSui = (s: string) => parseUnits(s, 9, MIST_MAX);
export const formatSui = (mist: bigint) => formatUnits(mist, 9);

export class SuiGqlError extends Error { constructor(readonly messages: string[]) { super("ERR_SUI_GQL"); } }

export async function suiGql<T = Record<string, unknown>>(query: string, variables: Record<string, unknown> = {}, o: { timeoutMs?: number; retry?: boolean } = {}): Promise<T> {
  let last: unknown = new Error("network");
  for (let i = 0; i < (o.retry === false ? 1 : 2); i++) {
    if (i) await new Promise((r) => setTimeout(r, 1500));
    for (const host of SUI_GQL) {
      try {
        const r = await hostFetch(host, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query, variables }) }, o.timeoutMs ?? 15_000);
        const j = (await r.json().catch(() => null)) as { data?: unknown; errors?: { message?: unknown }[] } | null;
        if (!j || typeof j !== "object") throw new Error(`HTTP ${r.status}`);
        if (Array.isArray(j.errors) && j.errors.length) throw new SuiGqlError(j.errors.map((e) => String(e?.message ?? "")));
        if (!r.ok || !j.data || typeof j.data !== "object") throw new Error(`HTTP ${r.status}`);
        return j.data as T;
      } catch (e) {
        if (e instanceof SuiGqlError) throw e;
        last = e;
      }
    }
  }
  throw last;
}

export interface SuiBalances { total: bigint; coins: bigint; addressBalance: bigint }

export function readSuiBalance(res: unknown): SuiBalances {
  const b = (res as { address?: { balance?: Record<string, unknown> | null } | null })?.address?.balance;
  if (b == null) return { total: 0n, coins: 0n, addressBalance: 0n };
  const total = bigOf(b.totalBalance, MIST_MAX), coins = bigOf(b.coinBalance ?? b.totalBalance, MIST_MAX), ab = bigOf(b.addressBalance ?? "0", MIST_MAX);
  if (total == null || coins == null || ab == null || coins > total) throw kitErr("ERR_PROVIDER");
  return { total, coins, addressBalance: ab };
}
export async function suiBalances(address: string): Promise<SuiBalances> {
  if (!isSuiAddress(address)) throw kitErr("ERR_ADDRESS");
  return readSuiBalance(await suiGql(`query($a:SuiAddress!){ address(address:$a){ balance(coinType:"${SUI_COIN}"){ totalBalance coinBalance addressBalance } } }`, { a: address }));
}
