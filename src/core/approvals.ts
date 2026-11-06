import { encodeFunctionData, erc20Abi, maxUint256, type Address, type Hash } from "viem";
import { evmAddress } from "./account";
import type { Network, Token } from "./chains";
import { feeFields, publicClient } from "./chainops";
import { guardEvm } from "./simulate";
import { sendFees, waitOk, wallet } from "./swap";
import { KYBER_ROUTERS, MADAR_SPLIT } from "../dapp/evmdecode";
import { LIFI_DIAMOND } from "../dapp/lifidecode";
import { THOR_ROUTERS } from "../dapp/thordecode";

const PERMIT2 = "0x000000000022d473030f116ddee9f6b43ac78ba3";
const ONEINCH_V6 = "0x111111125421ca6dc452d289314280a0f8842a65";

export interface Spender { address: Address; name: string }

export function spendersOf(n: Network): Spender[] {
  const id = n.chain.id;
  const list: [string | undefined, string][] = [
    [KYBER_ROUTERS[id] ?? (n.swap?.kyber ? KYBER_ROUTERS[1] : undefined), "KyberSwap"],
    [LIFI_DIAMOND, "LI.FI"],
    [THOR_ROUTERS[id], "THORChain"],
    [MADAR_SPLIT[id], "Madar"],
    [PERMIT2, "Uniswap Permit2"],
    [ONEINCH_V6, "1inch"],
  ];
  const seen = new Set<string>();
  const out: Spender[] = [];
  for (const [a, name] of list) {
    const x = a?.toLowerCase();
    if (!x || !/^0x[0-9a-f]{40}$/.test(x) || seen.has(x)) continue;
    seen.add(x);
    out.push({ address: x as Address, name });
  }
  return out;
}

export interface Approval { networkId: string; token: Address; symbol: string; decimals: number; verified: boolean; spender: Address; spenderName: string; amount: bigint; unlimited: boolean }

export const isUnlimited = (v: bigint) => v >= maxUint256 / 2n;

type OwnToken = { networkId: string; address: string; symbol: string; decimals: number };

export async function readApprovals(n: Network, owner: Address, own: OwnToken[] = []): Promise<Approval[]> {
  const tokens: (Pick<Token, "address" | "symbol" | "decimals"> & { verified: boolean })[] = [
    ...n.tokens.map((t) => ({ address: t.address, symbol: t.symbol, decimals: t.decimals, verified: true })),
    ...own.filter((t) => t.networkId === n.id && /^0x[0-9a-fA-F]{40}$/.test(t.address)).map((t) => ({ address: t.address as Address, symbol: t.symbol, decimals: t.decimals, verified: false })),
  ].filter((t, i, a) => a.findIndex((x) => x.address.toLowerCase() === t.address.toLowerCase()) === i);
  const spenders = spendersOf(n);
  const pairs = tokens.flatMap((t) => spenders.map((s) => ({ t, s })));
  if (!pairs.length) return [];
  const c = publicClient(n);
  const contracts = pairs.map(({ t, s }) => ({ address: t.address, abi: erc20Abi, functionName: "allowance" as const, args: [owner, s.address] as const }));
  let amounts: (bigint | null)[];
  try {
    const r = await c.multicall({ contracts, allowFailure: true });
    amounts = r.map((x) => (x.status === "success" ? (x.result as bigint) : null));
  } catch {

    amounts = await Promise.all(contracts.map((k) => c.readContract(k).then((v) => v as bigint, () => null)));
  }
  const out: Approval[] = [];
  pairs.forEach(({ t, s }, i) => {
    const amount = amounts[i];
    if (amount == null || amount === 0n) return;
    out.push({ networkId: n.id, token: t.address, symbol: t.symbol, decimals: t.decimals, verified: t.verified, spender: s.address, spenderName: s.name, amount, unlimited: isUnlimited(amount) });
  });
  return out.sort((a, b) => Number(b.unlimited) - Number(a.unlimited));
}

export async function revokeApproval(n: Network, phrase: string, index: number, token: Address, spender: Address): Promise<Hash> {
  const me = evmAddress(phrase, index);
  const data = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, 0n] });
  await guardEvm(n, [{ from: me as Address, to: token, data }]);
  const fees = await sendFees(n);
  const hash = await wallet(n, phrase, index).sendTransaction({ to: token, data, value: 0n, ...feeFields(fees) } as never);
  await waitOk(n, hash);
  return hash;
}
