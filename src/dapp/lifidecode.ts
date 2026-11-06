import { base58, bech32 } from "@scure/base";
import { decodeFunctionData, getAddress, parseAbi, type Abi, type Hex } from "viem";
import { NETWORKS } from "../core/chains";

export const LIFI_DIAMOND = "0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae";
const NON_EVM = "0x11f111f111f111f111f111f111f111f111f111f1";
const FEE_COLLECTOR = "0xce40449b773a3e6e5e769adb4e567179d4828cbd";
export const LIFI_FEE_WALLET = "0xc06ebbefd94032b85424d51906e2a335efae264b";
export const MADAR_FEE_WALLET = "0xb95c91bb8c58b929d501bd8d0accb420f8a7045d";
const SOL_CHAIN = 1151111081099710n, BTC_CHAIN = 20000000000001n;
const ZERO = "0x0000000000000000000000000000000000000000";

const BRIDGE_DATA = "(bytes32 transactionId,string bridge,string integrator,address referrer,address sendingAssetId,address receiver,uint256 minAmount,uint256 destinationChainId,bool hasSourceSwaps,bool hasDestinationCall)";
const SWAP_DATA = "(address callTo,address approveTo,address sendingAssetId,address receivingAssetId,uint256 fromAmount,bytes callData,bool requiresDeposit)[]";
const ACROSS_V4 = "(bytes32 receiverAddress,bytes32 refundAddress,bytes32 sendingAssetId,bytes32 receivingAssetId,uint256 outputAmount,uint128 outputAmountMultiplier,bytes32 exclusiveRelayer,uint32 quoteTimestamp,uint32 fillDeadline,uint32 exclusivityDeadline,bytes message)";
const MAYAN = "(bytes32 nonEVMReceiver,address mayanProtocol,bytes protocolData,address f3,bytes f4,address f5,uint256 f6,address f7,uint256 f8)";
const LAYERSWAP = "(bytes32 requestId,address depositoryReceiver,address refundRecipient,bytes32 nonEVMReceiver,bytes signature,uint256 deadline)";
const NEAR = "(bytes32 nonEVMReceiver,bytes32 destinationAsset,address depositAddress,bytes32 quoteId,uint256 deadline,uint256 minAmountOut,address refundRecipient,bytes signature)";
const FACETS = parseAbi([
  `function swapAndStartBridgeTokensViaAcrossV4(${BRIDGE_DATA} bridgeData, ${SWAP_DATA} swapData, ${ACROSS_V4} acrossData)`,
  `function swapAndStartBridgeTokensViaMayan(${BRIDGE_DATA} bridgeData, ${SWAP_DATA} swapData, ${MAYAN} mayanData)`,
  `function swapAndStartBridgeTokensViaLayerSwap(${BRIDGE_DATA} bridgeData, ${SWAP_DATA} swapData, ${LAYERSWAP} layerSwapData)`,
  `function swapAndStartBridgeTokensViaNEARIntents(${BRIDGE_DATA} bridgeData, ${SWAP_DATA} swapData, ${NEAR} nearData)`,
] as string[]) as Abi;
const FEE_STEPS = parseAbi([
  "function forwardERC20Fees(address token, (address recipient, uint256 amount)[] fees)",
  "function forwardNativeFees((address recipient, uint256 amount)[] fees)",
]) as Abi;

export type LifiDest = { kind: "evm"; chainId: number; network: string } | { kind: "sol"; network: "Solana" } | { kind: "btc"; network: "Bitcoin" };
export interface LifiCall {
  bridge: "across" | "mayan" | "layerswap" | "near";

  tokenIn: string | null; amountIn: string;
  dest: LifiDest;

  receiver: string;

  refund: string | null;

  tokenOut: string | null;

  minOut: string | null; minOutDecimals: number | null;
  madarFee: string; lifiFee: string;

  otherFees: boolean;
}

const wordToAddr = (w: string): string | null => (/^0x0{24}[0-9a-f]{40}$/i.test(w) ? getAddress("0x" + w.slice(26)) : null);
const bytes = (w: string) => Uint8Array.from((w.replace(/^0x/, "").match(/../g) || []).map((x) => parseInt(x, 16)));

export function btcFromWord(w: string): string | null {
  const b = bytes(w);
  if (b.length !== 32) return null;
  if (b.every((x) => x < 32)) return bech32.encode("bc", [0, ...b]);
  if (b.slice(0, 7).every((x) => x === 0) && (b[7] === 0 || b[7] === 5)) return base58.encode(b.slice(7));
  return null;
}

export function decodeLifiSite(chainId: number, to: string, value: bigint, data: Hex): LifiCall | null {
  if (to.toLowerCase() !== LIFI_DIAMOND || !NETWORKS.some((n) => n.chain.id === chainId)) return null;
  let d: { functionName: string; args: readonly unknown[] };
  try { d = decodeFunctionData({ abi: FACETS, data }) as never; } catch { return null; }
  const [b, swaps, x] = d.args as [any, any[], any];
  if (b.hasDestinationCall) return null;
  const dc = BigInt(b.destinationChainId);
  const net = NETWORKS.find((n) => BigInt(n.chain.id) === dc);
  const dest: LifiDest | null = dc === SOL_CHAIN ? { kind: "sol", network: "Solana" } : dc === BTC_CHAIN ? { kind: "btc", network: "Bitcoin" } : net ? { kind: "evm", chainId: net.chain.id, network: net.name } : null;
  if (!dest) return null;
  const BRIDGES: Record<string, LifiCall["bridge"]> = { swapAndStartBridgeTokensViaAcrossV4: "across", swapAndStartBridgeTokensViaMayan: "mayan", swapAndStartBridgeTokensViaLayerSwap: "layerswap", swapAndStartBridgeTokensViaNEARIntents: "near" };
  const bridge: LifiCall["bridge"] | undefined = BRIDGES[d.functionName];
  if (!bridge || ((bridge === "layerswap" || bridge === "near") !== (dest.kind === "btc"))) return null;
  const nativeIn = String(b.sendingAssetId).toLowerCase() === ZERO;

  let madar = 0n, lifi = 0n, other = false;
  for (const s of swaps) {
    if (String(s.callTo).toLowerCase() !== FEE_COLLECTOR) return null;
    let f: { functionName: string; args: readonly unknown[] };
    try { f = decodeFunctionData({ abi: FEE_STEPS, data: s.callData }) as never; } catch { return null; }
    const list = (f.functionName === "forwardERC20Fees" ? f.args[1] : f.args[0]) as { recipient: string; amount: bigint }[];
    for (const e of list) {
      const r = e.recipient.toLowerCase();
      if (r === MADAR_FEE_WALLET) madar += e.amount; else if (r === LIFI_FEE_WALLET) lifi += e.amount; else other = true;
    }
  }
  const amountIn = swaps.length ? BigInt(swaps[0].fromAmount) : BigInt(b.minAmount);
  if (nativeIn && value !== amountIn) return null;
  let receiver: string | null = null, refund: string | null = null, tokenOut: string | null = null, minOut: bigint | null = null, minOutDecimals: number | null = null;
  if (bridge === "across") {
    receiver = wordToAddr(x.receiverAddress); refund = wordToAddr(x.refundAddress);
    const out = wordToAddr(x.receivingAssetId); tokenOut = out; minOut = BigInt(x.outputAmount);
  } else if (bridge === "mayan") {
    const pd = String(x.protocolData);
    if (pd.length < 10 + 64 * 16) return null;
    const w = (i: number) => "0x" + pd.slice(10 + 64 * i, 10 + 64 * (i + 1));
    const dst = w(4), outTok = w(7);
    if (dest.kind === "sol") { receiver = base58.encode(bytes(dst)); tokenOut = /^0x0{64}$/.test(outTok) ? "SOL" : base58.encode(bytes(outTok)); }
    else { receiver = wordToAddr(dst); const t = wordToAddr(outTok); tokenOut = t && t.toLowerCase() !== ZERO ? t : null; }
    refund = wordToAddr(w(3)); minOut = BigInt(w(8)); minOutDecimals = 8;
  } else if (bridge === "layerswap") {
    receiver = btcFromWord(x.nonEVMReceiver); refund = getAddress(x.refundRecipient); tokenOut = "BTC";
  } else {
    receiver = btcFromWord(x.nonEVMReceiver); refund = getAddress(x.refundRecipient); tokenOut = "BTC"; minOut = BigInt(x.minAmountOut); minOutDecimals = 8;
  }
  if (dest.kind === "evm" && String(b.receiver).toLowerCase() !== NON_EVM && receiver && receiver.toLowerCase() !== String(b.receiver).toLowerCase()) return null;
  if (!receiver) return null;
  return {
    bridge, tokenIn: nativeIn ? null : getAddress(b.sendingAssetId), amountIn: amountIn.toString(), dest, receiver, refund, tokenOut,
    minOut: minOut == null ? null : minOut.toString(), minOutDecimals, madarFee: madar.toString(), lifiFee: lifi.toString(), otherFees: other,
  };
}
