import { evmAddress } from "./account";
import { api, btcAddress } from "./btcbase";
import { publicClient } from "./chainops";
import { networkById } from "./chains";
import { solAddress, solRpc } from "./solbase";

export type Probe = (index: number) => Promise<boolean>;
export const DISCOVER_MAX = 5;

export async function discoverAccounts(probe: Probe, max = DISCOVER_MAX): Promise<number[]> {
  const used = await Promise.all(Array.from({ length: max }, (_, k) => probe(k + 1).catch(() => false)));
  const hi = used.lastIndexOf(true);
  return hi < 0 ? [] : Array.from({ length: hi + 1 }, (_, k) => k + 1);
}

const EVM_NETS = ["ethereum", "base", "arbitrum", "bsc", "polygon", "optimism", "avalanche"];

export function makeProbe(phrase: string): Probe {
  return async (index) => {
    const evm = evmAddress(phrase, index) as `0x${string}`;
    const checks: Promise<boolean>[] = EVM_NETS.map(async (id) => {
      const c = publicClient(networkById(id)!);
      const [nonce, bal] = await Promise.all([c.getTransactionCount({ address: evm }), c.getBalance({ address: evm })]);
      return nonce > 0 || bal > 0n;
    });
    checks.push(api<{ chain_stats?: { tx_count?: number }; mempool_stats?: { tx_count?: number } }>(`/address/${btcAddress(phrase, index)}`)
      .then((a) => (a.chain_stats?.tx_count ?? 0) + (a.mempool_stats?.tx_count ?? 0) > 0));
    checks.push(solRpc<unknown[]>("getSignaturesForAddress", [solAddress(phrase, index), { limit: 1 }]).then((s) => Array.isArray(s) && s.length > 0));
    const all = await Promise.allSettled(checks);
    return all.some((r) => r.status === "fulfilled" && r.value);
  };
}
