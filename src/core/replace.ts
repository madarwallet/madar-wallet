import { keccak256, recoverTransactionAddress, serializeTransaction, type Address, type Hash, type Hex, type TransactionSerializable } from "viem";
import { evmAddress } from "./account";
import type { Network } from "./chains";
import { checkFeeRise, checkFeeSane, gasFeeLevels, publicClient, type GasFees } from "./chainops";
import { bumpFees, type Eip1559 } from "./gaslevels";
import { guardEvm } from "./simulate";
import { wallet } from "./swap";

export interface NodeTx {
  hash: string; from: string; to: string | null; nonce: number; value: bigint; input: Hex; gas: bigint; chainId?: number; type: string;
  maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint; gasPrice?: bigint; accessList?: readonly { address: Address; storageKeys: readonly Hex[] }[];
  r: Hex; s: Hex; v?: bigint; yParity?: number; blockNumber?: bigint | null;
}

export function txMatchesHash(tx: NodeTx, hash: string): boolean {
  const ser = signedBytes(tx);
  return !!ser && keccak256(ser).toLowerCase() === hash.toLowerCase();
}

function signedBytes(tx: NodeTx): Hex | null {
  try {
    const base = { chainId: tx.chainId, nonce: tx.nonce, to: (tx.to ?? undefined) as Address | undefined, value: tx.value, data: tx.input, gas: tx.gas };
    let s: TransactionSerializable;
    if (tx.type === "eip1559" && tx.maxFeePerGas != null && tx.maxPriorityFeePerGas != null && tx.chainId != null) {
      s = { ...base, chainId: tx.chainId, type: "eip1559", maxFeePerGas: tx.maxFeePerGas, maxPriorityFeePerGas: tx.maxPriorityFeePerGas, accessList: tx.accessList ?? [] };
    } else if (tx.type === "legacy" && tx.gasPrice != null) {
      s = { ...base, type: "legacy", gasPrice: tx.gasPrice };
    } else return null;
    const sig = tx.type === "legacy" ? { r: tx.r, s: tx.s, v: tx.v! } : { r: tx.r, s: tx.s, yParity: tx.yParity! };
    return serializeTransaction(s, sig);
  } catch { return null; }
}

export type PendState = { state: "pending"; tx: NodeTx } | { state: "done" } | { state: "replaced" } | { state: "unknown" };

export async function pendingState(n: Network, hash: string, me: string): Promise<PendState> {
  const c = publicClient(n);
  const [rc, tx, used] = await Promise.all([
    c.getTransactionReceipt({ hash: hash as Hash }).catch(() => null),
    c.getTransaction({ hash: hash as Hash }).catch(() => null) as Promise<NodeTx | null>,
    c.getTransactionCount({ address: me as Address, blockTag: "latest" }).catch(() => null),
  ]);
  if (rc) return { state: "done" };
  if (!tx) return { state: "unknown" };
  if (tx.from.toLowerCase() !== me.toLowerCase() || !txMatchesHash(tx, hash)) return { state: "unknown" };

  if (tx.chainId !== n.chain.id) return { state: "unknown" };
  const signer = await recoverTransactionAddress({ serializedTransaction: signedBytes(tx)! as never }).catch(() => null);
  if (!signer || signer.toLowerCase() !== me.toLowerCase()) return { state: "unknown" };
  if (tx.blockNumber != null) return { state: "done" };
  if (used != null && used > tx.nonce) return { state: "replaced" };
  return { state: "pending", tx };
}

export type ReplaceMode = "speed" | "cancel";
export interface ReplacePlan { mode: ReplaceMode; tx: NodeTx; fees: Eip1559; gas: bigint; maxCost: bigint }

export async function planReplace(n: Network, phrase: string, index: number, hash: string, mode: ReplaceMode): Promise<ReplacePlan> {
  const me = evmAddress(phrase, index);
  const st = await pendingState(n, hash, me);
  if (st.state === "done" || st.state === "replaced") throw new Error("ERR_TX_DONE");
  if (st.state !== "pending" || st.tx.type !== "eip1559" || !st.tx.to) throw new Error("ERR_TX_UNKNOWN");
  const tx = st.tx;
  const fees = bumpFees({ maxFeePerGas: tx.maxFeePerGas!, maxPriorityFeePerGas: tx.maxPriorityFeePerGas! }, (await gasFeeLevels(n)).fast as Eip1559);
  checkFeeSane(n.id, fees);
  const gas = mode === "cancel" ? 21_000n : tx.gas;
  return { mode, tx, fees, gas, maxCost: gas * fees.maxFeePerGas };
}

export async function replaceTx(n: Network, phrase: string, index: number, hash: string, reviewed: ReplacePlan): Promise<Hash> {
  const fresh = await planReplace(n, phrase, index, hash, reviewed.mode);
  checkFeeRise(reviewed.fees as GasFees, fresh.fees as GasFees);
  const me = evmAddress(phrase, index) as Address, tx = fresh.tx;
  const w = wallet(n, phrase, index);
  const fee = { maxFeePerGas: fresh.fees.maxFeePerGas, maxPriorityFeePerGas: fresh.fees.maxPriorityFeePerGas };
  if (reviewed.mode === "cancel") return w.sendTransaction({ to: me, value: 0n, nonce: tx.nonce, gas: 21_000n, ...fee } as never);
  await guardEvm(n, [{ from: me, to: tx.to as Address, data: tx.input === "0x" ? undefined : tx.input, value: tx.value }]);
  return w.sendTransaction({ to: tx.to as Address, value: tx.value, data: tx.input, nonce: tx.nonce, gas: tx.gas, ...fee } as never);
}
