import { base58, bech32 } from "@scure/base";
import { decodeFunctionData, parseAbi, toFunctionSelector, type Abi, type AbiFunction, type Address, type Hash, type Hex } from "viem";
import { evmAddress } from "./account";
import { isBtcAddress } from "./btcbase";
import { sellAddrOk, sellCoinByChain } from "./nearsell";
import { thorSellCoinOf, thorVaultOk } from "./thorsell";
import type { Network } from "./chains";
import { feeFields, type GasFees } from "./chainops";
import { EVM_NATIVE, evmFeeOn, feeBps, sendFees, SLIPPAGE_BPS, SOL_MINT, wallet } from "./swap";
import { guardEvm } from "./simulate";

const BRIDGE_DATA = "(bytes32 transactionId,string bridge,string integrator,address referrer,address sendingAssetId,address receiver,uint256 minAmount,uint256 destinationChainId,bool hasSourceSwaps,bool hasDestinationCall)";
const SWAP_DATA = "(address callTo,address approveTo,address sendingAssetId,address receivingAssetId,uint256 fromAmount,bytes callData,bool requiresDeposit)[]";
const ACROSS_V4 = "(bytes32 receiverAddress,bytes32 refundAddress,bytes32 sendingAssetId,bytes32 receivingAssetId,uint256 outputAmount,uint128 outputAmountMultiplier,bytes32 exclusiveRelayer,uint32 quoteTimestamp,uint32 fillDeadline,uint32 exclusivityDeadline,bytes message)";
const LAYERSWAP = "(bytes32 requestId,address depositoryReceiver,address refundRecipient,bytes32 nonEVMReceiver,bytes signature,uint256 deadline)";
const NEAR_INTENTS = "(bytes32 nonEVMReceiver,bytes32 destinationAsset,address depositAddress,bytes32 quoteId,uint256 deadline,uint256 minAmountOut,address refundRecipient,bytes signature)";
const MAYAN = "(bytes32 nonEVMReceiver,address mayanProtocol,bytes protocolData,address f3,bytes f4,address f5,uint256 f6,address f7,uint256 f8)";

export const LIFI_FACETS = parseAbi([
  `function swapAndStartBridgeTokensViaAcrossV4(${BRIDGE_DATA} bridgeData, ${SWAP_DATA} swapData, ${ACROSS_V4} acrossData)`,
  `function swapAndStartBridgeTokensViaMayan(${BRIDGE_DATA} bridgeData, ${SWAP_DATA} swapData, ${MAYAN} mayanData)`,

  `function swapAndStartBridgeTokensViaLayerSwap(${BRIDGE_DATA} bridgeData, ${SWAP_DATA} swapData, ${LAYERSWAP} layerSwapData)`,
  `function swapAndStartBridgeTokensViaNEARIntents(${BRIDGE_DATA} bridgeData, ${SWAP_DATA} swapData, ${NEAR_INTENTS} nearData)`,
] as string[]) as Abi;
export const LIFI_SELECTORS: string[] = LIFI_FACETS.map((f) => toFunctionSelector(f as AbiFunction));
export const LIFI_BRIDGES = "across,mayan";

export const LIFI_BRIDGE_NAMES: Readonly<Record<string, string>> = { across: "Across", mayan: "Mayan", layerswap: "LayerSwap", near: "NEAR Intents" };

export function allowedBridges(toChain: Side["chainId"], bridge?: string): string {
  const list = toChain === "BTC" ? LIFI_BTC_BRIDGES : LIFI_BRIDGES;
  return bridge && list.split(",").includes(bridge) ? bridge : list;
}

export const LIFI_BTC_BRIDGES = "layerswap,near";
export const LIFI_BTC_CHAIN = "20000000000001";
const BTC_FACETS = ["swapAndStartBridgeTokensViaLayerSwap", "swapAndStartBridgeTokensViaNEARIntents"];

const LAYERSWAP_DEPOSITORIES = ["0x08b00ceee2fb66029b53d76110b19eeaabfd1e65", "0x2fc617e933a52713247ce25730f6695920b3befe"];

export const NEAR_1CLICK = "https://1click.chaindefuser.com";
const NEAR_MAX_DEADLINE_S = 4 * 86400;

export function btcReceiverWord(addr: string): string {
  if (!/^bc1q[02-9ac-hj-np-z]{38}$/.test(addr)) throw unsafe("btc address");
  const d = bech32.decode(addr as `${string}1${string}`);
  if (d.prefix !== "bc" || d.words[0] !== 0 || d.words.length !== 33) throw unsafe("btc address");
  return "0x" + hex(Uint8Array.from(d.words.slice(1)));
}

export const NON_EVM_ADDRESS = "0x11f111f111f111F111f111f111F111f111f111F1";

const TOLERANCE_BPS = 10n;

export const LIFI_API = "https://swap.madarwallet.app/lifi";
export const LIFI_DIAMOND = "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE";
export const LIFI_INTEGRATOR = "madar-swap";
export const LIFI_FEE = 0.005;

export const lifiFee = () => feeBps() / 10000;
export const LIFI_SOL_CHAIN = "1151111081099710";
const SOL_NATIVE = "11111111111111111111111111111111";
const ZERO = "0x0000000000000000000000000000000000000000";
const TIMEOUT = 20_000;

const same = (x: unknown, y: unknown) => String(x ?? "").toLowerCase() === String(y ?? "").toLowerCase();
const unsafe = (why: string) => Object.assign(new Error("ERR_UNSAFE"), { why });
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

export interface Side { netId: string; chainId: number | "SOL" | "BTC" | "TRON" | BuyChain; token: string;  decimals?: number }

export type BuyChain = "DOGE" | "LTC" | "XRP" | "ADA" | "TRX" | "NEAR";
const BUY_CHAINS: readonly string[] = ["BTC", "DOGE", "LTC", "XRP", "ADA", "TRX", "NEAR"];

export interface CrossRequest { from: Side; to: Side; amount: bigint; sender: string; receiver: string; noFee?: boolean; fromSymbol?: string; toSymbol?: string; bridge?: string }
const dollarKind = (s?: string) => (!s ? null : /USDC/.test(s) ? "USDC" : /^USD(T|₮)/.test(s) ? "USDT" : null);
export const dollarPair = (a?: string, b?: string) => !!dollarKind(a) && dollarKind(a) === dollarKind(b);
const feeFree = (r: CrossRequest) => !!r.noFee && dollarPair(r.fromSymbol, r.toSymbol);

const chainParam = (s: Side) => (s.chainId === "SOL" ? "SOL" : s.chainId === "BTC" ? "BTC" : s.chainId === "TRON" ? "TRN" : String(s.chainId));
const chainNum = (s: Side) => (s.chainId === "SOL" ? LIFI_SOL_CHAIN : s.chainId === "BTC" ? LIFI_BTC_CHAIN : s.chainId === "TRON" ? "728126428" : String(s.chainId));

export const tokParam = (s: Side) => (s.chainId === "BTC" ? "bitcoin" : s.chainId === "SOL" ? (s.token === SOL_MINT ? SOL_NATIVE : s.token) : same(s.token, EVM_NATIVE) ? ZERO : s.token);

export function lifiQuoteUrl(r: CrossRequest): string {
  const p = new URLSearchParams({
    fromChain: chainParam(r.from), toChain: chainParam(r.to), fromToken: tokParam(r.from), toToken: tokParam(r.to),

    fromAmount: r.amount.toString(), fromAddress: /^0x[0-9a-fA-F]{40}$/.test(r.sender) ? r.sender.toLowerCase() : r.sender, toAddress: r.receiver, integrator: LIFI_INTEGRATOR, slippage: String(SLIPPAGE_BPS / 10000),
    allowBridges: allowedBridges(r.to.chainId, r.bridge),
    allowExchanges: "none",
  });
  if (evmFeeOn(r.sender) && !feeFree(r)) p.set("fee", String(lifiFee()));
  return `${LIFI_API}/quote?${p}`;
}

export async function lifiQuote(r: CrossRequest): Promise<any> {
  if (r.from.chainId === "SOL" || r.from.chainId === "BTC" || r.from.chainId === "TRON") throw new Error("ERR_UNSUPPORTED");
  const res = await fetch(lifiQuoteUrl(r), { signal: AbortSignal.timeout(TIMEOUT), referrerPolicy: "no-referrer", cache: "no-store" });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.transactionRequest || !j.estimate || !j.action) throw Object.assign(new Error(j.message || "lifi"), { api: true, status: res.status, noRoute: res.status === 404 || j.code === 1002 });
  return j;
}

export function crossSummary(q: any): { amountOut: bigint; minOut: bigint; feePct: number; gasUsd: number | null; costPct: number; secs: number | null; tool: string | null } {
  const e = q.estimate;
  const pct = (e.feeCosts ?? []).reduce((n: number, f: { percentage?: string }) => n + (parseFloat(f.percentage ?? "") || 0), 0);
  const gas = (e.gasCosts ?? []).reduce((n: number, g: { amountUSD?: string }) => n + (parseFloat(g.amountUSD ?? "") || 0), 0);
  const usdIn = parseFloat(e.fromAmountUSD ?? "");

  const costPct = pct * 100 + (usdIn > 0 && gas > 0 ? (gas / usdIn) * 100 : 0);
  const secs = Number(e.executionDuration);

  const tool = typeof q.tool === "string" && Object.hasOwn(LIFI_BRIDGE_NAMES, q.tool) ? q.tool : null;
  return { amountOut: BigInt(e.toAmount), minOut: BigInt(e.toAmountMin), feePct: pct * 100, gasUsd: gas || null, costPct, secs: Number.isFinite(secs) && secs > 0 ? secs : null, tool };
}

export function checkLifiTx(q: any, r: CrossRequest, shownMin?: bigint, nowSec = Math.floor(Date.now() / 1000), shownOut?: bigint): { to: Address; data: `0x${string}`; value: bigint; near?: NearDeposit } {
  const tx = q?.transactionRequest ?? {}, a = q?.action ?? {};
  if (r.from.chainId === "SOL" || r.from.chainId === "BTC" || r.from.chainId === "TRON") throw unsafe("from");
  const exact = r.to.chainId === "SOL" || r.to.chainId === "BTC";
  if (!same(tx.to, LIFI_DIAMOND)) throw unsafe("to");
  if (Number(tx.chainId) !== r.from.chainId) throw unsafe("chain");
  if (String(a.fromChainId) !== chainNum(r.from) || String(a.toChainId) !== chainNum(r.to)) throw unsafe("chains");
  const toTok = tokParam(r.to);
  if (!same(a.fromToken?.address, tokParam(r.from)) || (exact ? a.toToken?.address !== toTok : !same(a.toToken?.address, toTok))) throw unsafe("tokens");
  if (String(a.fromAmount) !== r.amount.toString()) throw unsafe("amount");
  if (!same(a.fromAddress, r.sender) || (exact ? a.toAddress !== r.receiver : !same(a.toAddress, r.receiver))) throw unsafe("addresses");
  let value: bigint;
  try { value = BigInt(tx.value || "0x0"); } catch { throw unsafe("value"); }
  const native = same(r.from.token, EVM_NATIVE);
  if (value !== (native ? r.amount : 0n)) throw unsafe("value");
  if (!native && !same(q.estimate?.approvalAddress, LIFI_DIAMOND)) throw unsafe("approval");
  const data = String(tx.data || "").toLowerCase();
  if (!/^0x[0-9a-f]{8,}$/.test(data)) throw unsafe("data");
  let toAmount: bigint, toAmountMin: bigint;
  try { toAmount = BigInt(q?.estimate?.toAmount ?? "0"); toAmountMin = BigInt(q?.estimate?.toAmountMin ?? "0"); } catch { throw unsafe("estimate"); }
  const min = shownMin ?? toAmountMin;

  const ref = shownOut ?? (min * 10000n) / BigInt(10000 - SLIPPAGE_BPS);
  if (toAmount * 100n > ref * 105n) throw unsafe("estimate above shown");

  if (r.to.chainId === "BTC" && (toAmount < min || toAmountMin * 10000n < min * (10000n - TOLERANCE_BPS))) throw unsafe("estimate below shown");
  const near = decodeLifiCall(data as Hex, r, min, ref, nowSec);
  return { to: LIFI_DIAMOND, data: tx.data, value, ...(near ? { near } : {}) };
}

export const LIFI_FEE_COLLECTOR = "0xCE40449B773a3E6E5e769ADb4e567179d4828cbd";
export const FEE_STEP_ABI = parseAbi(["function forwardERC20Fees(address token, (address recipient, uint256 amount)[] fees)", "function forwardNativeFees((address recipient, uint256 amount)[] fees)"] as string[]) as Abi;

export const WRAPPED_NATIVE: Record<number, string> = {
  1: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", 10: "0x4200000000000000000000000000000000000006", 8453: "0x4200000000000000000000000000000000000006",
  42161: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", 137: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270", 56: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", 43114: "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7",

  59144: "0xe5D7C2a44FfDDf6b295A15c148167daaAf5Cf34f", 130: "0x4200000000000000000000000000000000000006",
};

export const WORMHOLE_CHAIN: Record<string, number> = { SOL: 1, 1: 2, 56: 4, 137: 5, 43114: 6, 42161: 23, 10: 24, 8453: 30 };

export const LIFI_FEE_WALLET = "0xC06ebbefD94032B85424D51906e2A335EFAe264B";
export const MADAR_FEE_WALLET = "0xb95c91Bb8C58b929d501BD8D0aCcB420F8A7045d";
const LIFI_OWN_FEE_BPS = 25n;

const MAYAN_AUCTION_MODES = [2, 3];
const MAYAN_MAX_DEADLINE_S = 2 * 3600;
const MAYAN_CREATE_ORDER = "0xa3a30834";

export interface NearDeposit { deposit: string; minOut: bigint; amount: bigint }
function decodeLifiCall(data: Hex, r: CrossRequest, shownMin: bigint, shownRef: bigint, nowSec: number): NearDeposit | null {
  if (!LIFI_SELECTORS.includes(data.slice(0, 10))) throw unsafe("facet");
  let d;
  try { d = decodeFunctionData({ abi: LIFI_FACETS, data }); } catch { throw unsafe("decode"); }
  type BridgeData = { integrator: string; sendingAssetId: string; receiver: string; minAmount: bigint; destinationChainId: bigint; hasSourceSwaps: boolean; hasDestinationCall: boolean };
  type SwapStep = { callTo: string; approveTo: string; sendingAssetId: string; receivingAssetId: string; fromAmount: bigint; callData: Hex };
  const [b, swaps, x] = (d.args ?? []) as unknown as [BridgeData, readonly SwapStep[], unknown];
  const sol = r.to.chainId === "SOL", btc = r.to.chainId === "BTC";
  if (btc !== BTC_FACETS.includes(d.functionName)) throw unsafe("facet");
  const word = (h: string) => "0x" + h.replace(/^0x/, "").toLowerCase().padStart(64, "0");
  const recvWord = btc ? btcReceiverWord(r.receiver) : sol ? "0x" + hex(base58.decode(r.receiver)) : word(r.receiver);
  const fromTok = tokParam(r.from);
  if (b.integrator !== LIFI_INTEGRATOR) throw unsafe("integrator");
  if (b.hasDestinationCall) throw unsafe("destination call");
  if (String(b.destinationChainId) !== chainNum(r.to)) throw unsafe("destination");
  if (sol || btc ? !same(b.receiver, NON_EVM_ADDRESS) : !same(b.receiver, r.receiver)) throw unsafe("receiver");
  if (btc && (b as unknown as { bridge: string }).bridge !== (d.functionName === BTC_FACETS[0] ? "layerswap" : "near")) throw unsafe("bridge");

  if (!same(b.sendingAssetId, fromTok)) throw unsafe("asset");
  if (b.minAmount > r.amount || b.minAmount * 10000n < r.amount * 9900n) throw unsafe("min amount");

  if (b.hasSourceSwaps !== swaps.length > 0) throw unsafe("swaps");
  if (!swaps.length && b.minAmount !== r.amount) throw unsafe("asset");

  const madarFee = evmFeeOn(r.sender) && !feeFree(r) ? (r.amount * BigInt(feeBps())) / 10000n : 0n;
  let prev = fromTok, fees = 0n, lifi = 0n, madar = 0n;
  swaps.forEach((s, i) => {
    if (!same(s.sendingAssetId, prev) || !same(s.receivingAssetId, fromTok)) throw unsafe("swap chain");
    if (i === 0 && s.fromAmount !== r.amount) throw unsafe("swap input");
    if (!same(s.callTo, LIFI_FEE_COLLECTOR) || !same(s.approveTo, LIFI_FEE_COLLECTOR)) throw unsafe("swap step");
    let f;
    try { f = decodeFunctionData({ abi: FEE_STEP_ABI, data: s.callData }); } catch { throw unsafe("fee step"); }
    const native = same(fromTok, ZERO);
    if (f.functionName === "forwardERC20Fees" ? native || !same((f.args as unknown[])[0], fromTok) : !native) throw unsafe("fee token");
    const list = (f.functionName === "forwardERC20Fees" ? (f.args as unknown[])[1] : (f.args as unknown[])[0]) as readonly { amount: bigint }[];
    for (const e of list as readonly { recipient: string; amount: bigint }[]) {
      fees += e.amount;
      if (same(e.recipient, LIFI_FEE_WALLET)) lifi += e.amount;
      else if (same(e.recipient, MADAR_FEE_WALLET)) madar += e.amount;
      else throw unsafe("fee recipient");
    }
    prev = s.receivingAssetId;
  });
  if (fees * 100n > r.amount) throw unsafe("fees");
  if (madar !== madarFee) throw unsafe("madar fee");
  if (lifi * 10000n > r.amount * LIFI_OWN_FEE_BPS) throw unsafe("lifi fee");
  const minOk = (v: bigint) => v * 10000n >= shownMin * (10000n - TOLERANCE_BPS);
  if (btc && d.functionName === BTC_FACETS[1]) {

    const n = x as { nonEVMReceiver: Hex; destinationAsset: Hex; depositAddress: string; deadline: bigint; minAmountOut: bigint; refundRecipient: string; signature: Hex };
    if (n.nonEVMReceiver.toLowerCase() !== recvWord) throw unsafe("near receiver");
    if (n.destinationAsset.toLowerCase() !== word(EVM_NATIVE)) throw unsafe("near asset");
    if (!same(n.refundRecipient, r.sender)) throw unsafe("near refund");
    if (/^0x0{40}$/i.test(n.depositAddress) || same(n.depositAddress, LIFI_DIAMOND)) throw unsafe("near deposit");
    if ((n.signature.length - 2) / 2 !== 65) throw unsafe("near signature");
    const dl = Number(n.deadline);
    if (dl < nowSec || dl > nowSec + NEAR_MAX_DEADLINE_S) throw unsafe("near deadline");
    if (b.minAmount !== r.amount - fees) throw unsafe("near amount");
    if (!minOk(n.minAmountOut) || n.minAmountOut * 100n > shownRef * 105n) throw unsafe("near min out");
    return { deposit: n.depositAddress.toLowerCase(), minOut: n.minAmountOut, amount: b.minAmount };
  }
  if (btc) {

    const l = x as { depositoryReceiver: string; refundRecipient: string; nonEVMReceiver: Hex; signature: Hex; deadline: bigint };
    if (!LAYERSWAP_DEPOSITORIES.some((y) => same(y, l.depositoryReceiver))) throw unsafe("layerswap depository");
    if (!same(l.refundRecipient, r.sender)) throw unsafe("layerswap refund");
    if (l.nonEVMReceiver.toLowerCase() !== recvWord) throw unsafe("layerswap receiver");
    if ((l.signature.length - 2) / 2 !== 65) throw unsafe("layerswap signature");
    const dl = Number(l.deadline);
    if (dl < nowSec || dl > nowSec + 2 * 3600) throw unsafe("layerswap deadline");
    if (b.minAmount !== r.amount - fees) throw unsafe("layerswap amount");
    return null;
  }
  if (d.functionName === "swapAndStartBridgeTokensViaAcrossV4") {
    const a = x as { receiverAddress: Hex; refundAddress: Hex; sendingAssetId: Hex; receivingAssetId: Hex; outputAmount: bigint; outputAmountMultiplier: bigint; exclusiveRelayer: Hex; message: Hex };
    if (sol) throw unsafe("across to solana");
    const outTok = same(r.to.token, EVM_NATIVE) ? WRAPPED_NATIVE[r.to.chainId as number] : r.to.token;
    if (!outTok || a.receivingAssetId.toLowerCase() !== word(outTok)) throw unsafe("across output token");
    if (a.receiverAddress.toLowerCase() !== recvWord) throw unsafe("across receiver");
    const inTok = same(fromTok, ZERO) ? WRAPPED_NATIVE[r.from.chainId as number] : fromTok;
    if (!inTok || a.sendingAssetId.toLowerCase() !== word(inTok)) throw unsafe("across input token");
    if (a.refundAddress.toLowerCase() !== word(r.sender)) throw unsafe("across refund");
    if (!/^0x0{64}$/.test(a.exclusiveRelayer)) throw unsafe("across relayer");
    if (a.message !== "0x") throw unsafe("across message");

    if (!minOk(a.outputAmount) || !minOk((b.minAmount * a.outputAmountMultiplier) / 10n ** 18n)) throw unsafe("across min out");
  } else {
    const m = x as { nonEVMReceiver: Hex; protocolData: Hex; f3: string; f4: Hex; f5: string; f6: bigint; f7: string; f8: bigint };
    const nonEvm = m.nonEVMReceiver.toLowerCase();
    if (sol ? nonEvm !== recvWord : nonEvm !== recvWord && !/^0x0{64}$/.test(nonEvm)) throw unsafe("mayan receiver");
    if (!same(m.f3, ZERO) || m.f4 !== "0x" || !same(m.f5, ZERO) || m.f6 !== 0n) throw unsafe("mayan extra");
    if (!same(m.f7, r.sender) || m.f8 !== b.minAmount) throw unsafe("mayan sender / amount");
    const pd = m.protocolData.toLowerCase();
    if (!pd.startsWith(MAYAN_CREATE_ORDER) || pd.length < 10 + 64 * 16) throw unsafe("mayan order");
    const w = (i: number) => "0x" + pd.slice(10 + 64 * i, 10 + 64 * (i + 1));
    const n = (i: number) => BigInt(w(i));
    const dec = r.to.decimals;
    if (dec == null) throw unsafe("mayan decimals");
    const outTok = sol ? (r.to.token === SOL_MINT ? "0x" + "0".repeat(64) : "0x" + hex(base58.decode(r.to.token))) : word(same(r.to.token, EVM_NATIVE) ? ZERO : r.to.token);
    const wormhole = WORMHOLE_CHAIN[String(r.to.chainId)];
    if (w(0) !== word(fromTok) || n(1) !== b.minAmount) throw unsafe("mayan input");
    if (w(3) !== word(r.sender)) throw unsafe("mayan trader");
    if (w(4) !== recvWord) throw unsafe("mayan destination");
    if (wormhole == null || n(5) !== BigInt(wormhole)) throw unsafe("mayan chain");
    if (w(7) !== outTok) throw unsafe("mayan output token");
    if (n(9) !== 0n || n(13) !== 0n) throw unsafe("mayan gas drop / referrer fee");
    if (n(2) !== 1n) throw unsafe("mayan payload type");
    if (!MAYAN_AUCTION_MODES.includes(Number(n(14)))) throw unsafe("mayan auction mode");
    const deadline = Number(n(12));
    if (deadline < nowSec || deadline > nowSec + MAYAN_MAX_DEADLINE_S) throw unsafe("mayan deadline");

    const inDec = r.from.decimals;
    if (inDec == null) throw unsafe("mayan decimals");
    const normIn = inDec > 8 ? b.minAmount / 10n ** BigInt(inDec - 8) : b.minAmount;
    if ((n(10) + n(11)) * 100n > normIn) throw unsafe("mayan cancel/refund fee");
    const norm = (v: bigint) => (dec > 8 ? v / 10n ** BigInt(dec - 8) : v);
    if (n(8) * 10000n < norm(shownMin) * (10000n - TOLERANCE_BPS)) throw unsafe("mayan min out");
    if (n(8) * 100n > norm(shownRef) * 105n) throw unsafe("mayan min out too high");
  }
  return null;
}

export async function checkNearDeposit(near: NearDeposit, r: CrossRequest, fetcher: typeof fetch = fetch): Promise<true> {
  let j: any;
  try { j = await (await fetcher(`${NEAR_1CLICK}/v0/status?depositAddress=${near.deposit}`, { referrerPolicy: "no-referrer", credentials: "omit", cache: "no-store", signal: AbortSignal.timeout(TIMEOUT) })).json(); } catch { throw unsafe("near status"); }
  const rq = j?.quoteResponse?.quoteRequest, qt = j?.quoteResponse?.quote;
  if (!rq || !qt || j.status !== "PENDING_DEPOSIT") throw unsafe("near status");
  if (rq.dry !== false || rq.recipient !== r.receiver || rq.recipientType !== "DESTINATION_CHAIN" || rq.destinationAsset !== "nep141:btc.omft.near") throw unsafe("near recipient");
  if (!same(rq.refundTo, r.sender) || rq.refundType !== "ORIGIN_CHAIN" || rq.depositType !== "ORIGIN_CHAIN") throw unsafe("near refund");
  if (!same(qt.depositAddress, near.deposit)) throw unsafe("near deposit");
  if (String(rq.amount) !== near.amount.toString() || String(qt.amountIn) !== near.amount.toString()) throw unsafe("near amount");
  let minOut: bigint;
  try { minOut = BigInt(qt.minAmountOut); } catch { throw unsafe("near min out"); }
  if (minOut < near.minOut) throw unsafe("near min out");
  const tok = tokParam(r.from).toLowerCase();
  if (tok !== ZERO && !String(rq.originAsset || "").toLowerCase().includes(tok.slice(2))) throw unsafe("near origin");
  return true;
}

export async function lifiSend(n: Network, phrase: string, index: number, r: CrossRequest, shownOut: bigint, shownMin?: bigint, reviewed?: GasFees): Promise<Hash> {
  if (!same(evmAddress(phrase, index), r.sender)) throw unsafe("sender");
  const q = await lifiQuote(r);

  if (r.bridge && q.tool !== r.bridge) throw new Error("ERR_MOVED");
  if (BigInt(q.estimate.toAmount) * 10000n < shownOut * BigInt(10000 - SLIPPAGE_BPS)) throw new Error("ERR_MOVED");
  if (shownMin != null && BigInt(q.estimate.toAmountMin) * 10000n < shownMin * (10000n - TOLERANCE_BPS)) throw new Error("ERR_MOVED");
  const tx = checkLifiTx(q, r, shownMin, undefined, shownOut);
  if (tx.near) await checkNearDeposit(tx.near, r);

  await guardEvm(n, [{ from: r.sender as Address, to: tx.to, data: tx.data, value: tx.value }]);
  const fees = await sendFees(n, reviewed, true);
  return wallet(n, phrase, index).sendTransaction({ to: tx.to, data: tx.data, value: tx.value, ...feeFields(fees) } as never);
}

export interface LifiStatus { status?: string; substatus?: string; sending?: { txHash?: string } }
export async function lifiStatus(hash: string, from: Side, to: Side): Promise<LifiStatus> {
  const p = new URLSearchParams({ txHash: hash, fromChain: chainParam(from), toChain: chainParam(to) });
  const r = await fetch(`${LIFI_API}/status?${p}`, { signal: AbortSignal.timeout(TIMEOUT), referrerPolicy: "no-referrer", cache: "no-store" });
  return r.json().catch(() => ({}));
}

export const scanLink = (hash: string, via?: XferVia, explorer?: string) => (via === "mayan" ? `https://explorer.mayan.finance/tx/${hash}` : via === "near" ? `https://mempool.space/tx/${hash}`
  : via === "thor" || via === "thorsell" ? `https://track.ninerealms.com/${hash.replace(/^0x/, "")}` : (via === "nearbuy" || via === "onebuy") && explorer ? `${explorer}/tx/${hash}` : `https://scan.li.fi/tx/${hash}`);

export type XferEnd = "" | "ok" | "refunded" | "partial" | "failed";

export function xferStage(st: LifiStatus): { step: 1 | 2 | 3 | 4; end: XferEnd } {
  if (st.status === "DONE") return { step: 4, end: st.substatus === "REFUNDED" ? "refunded" : st.substatus === "PARTIAL" ? "partial" : "ok" };
  if (st.status === "FAILED") return { step: 3, end: "failed" };
  if (st.status === "PENDING" && (st.substatus === "WAIT_DESTINATION_TRANSACTION" || (st.sending?.txHash && st.substatus !== "WAIT_SOURCE_CONFIRMATIONS"))) return { step: 3, end: "" };
  return { step: 2, end: "" };
}
export const stagePct = (step: number, end: XferEnd) => (end ? 100 : [0, 12, 37, 62, 100][step] ?? 0);

export type XferVia = "mayan" | "near" | "tron" | "nearbuy" | "thor" | "onebuy" | "thorsell";
export interface Xfer { hash: string; from: Side; to: Side; at: number; label: string; step: 1 | 2 | 3 | 4; end: XferEnd; refunding?: boolean; via?: XferVia; deposit?: string; incomplete?: boolean }

export function validXfer(x: Xfer | null | undefined): x is Xfer {
  if (!x || typeof x.hash !== "string") return false;
  if (x.via === "near") {

    const coin = typeof x.from?.chainId === "string" && x.from.chainId !== "BTC" ? sellCoinByChain(x.from.chainId, x.from.netId) : null;

    const to = x.to?.chainId;
    if (to === "TRON" ? x.to.netId !== "tron" : typeof to === "string" && (!sellCoinByChain(to, x.to.netId) || to === (coin ?? "BTC"))) return false;
    if (!coin) return /^[0-9a-f]{64}$/.test(x.hash) && typeof x.deposit === "string" && isBtcAddress(x.deposit);

    return x.from.chainId === coin && (coin === "XRP" ? /^[0-9A-F]{64}$/ : coin === "NEAR" ? /^[1-9A-HJ-NP-Za-km-z]{32,44}$/ : /^[0-9a-f]{64}$/).test(x.hash) && sellAddrOk(coin, x.deposit);
  }
  if (x.via === "tron") return /^[0-9a-f]{64}$/.test(x.hash) && x.from?.chainId === "TRON";

  if (x.via === "thorsell") { const c = thorSellCoinOf(x.from?.netId ?? ""); return !!c && x.from.chainId === c && /^[0-9a-f]{64}$/.test(x.hash) && thorVaultOk(c, x.deposit) && (typeof x.to?.chainId === "number" || (x.to?.chainId === "TRON" && x.to.netId === "tron")); }
  if (x.via === "nearbuy") return /^0x[0-9a-fA-F]{64}$/.test(x.hash) && typeof x.deposit === "string" && /^0x[0-9a-fA-F]{40}$/.test(x.deposit) && x.to?.chainId === "BTC" && typeof x.from?.chainId === "number";
  if (x.via === "thor") return /^0x[0-9a-fA-F]{64}$/.test(x.hash) && typeof x.from?.chainId === "number"
    && (["DOGE", "LTC", "XRP", "BTC"].includes(String(x.to?.chainId)) || (typeof x.to?.chainId === "number" && x.to.chainId !== x.from.chainId));
  if (x.via === "onebuy") {

    const toOk = BUY_CHAINS.includes(String(x.to?.chainId)) || x.to?.chainId === "SOL" || (x.to?.chainId === "TRON" && x.to?.netId === "tron") || (typeof x.to?.chainId === "number" && Number.isSafeInteger(x.to.chainId) && x.to.chainId > 0);
    if (typeof x.deposit !== "string" || !toOk) return false;
    if (typeof x.from?.chainId === "number") return /^0x[0-9a-fA-F]{64}$/.test(x.hash) && /^0x[0-9a-fA-F]{40}$/.test(x.deposit);
    if (x.from?.chainId === "SOL") return /^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(x.hash) && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(x.deposit);
    if (x.from?.chainId === "TRON") return /^[0-9a-f]{64}$/.test(x.hash) && /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(x.deposit);
    return false;
  }
  return (x.via === "mayan" ? /^[1-9A-HJ-NP-Za-km-z]{64,90}$/ : /^0x[0-9a-fA-F]{64}$/).test(x.hash);
}
const XKEY = "xfer";
export async function loadXfer(): Promise<Xfer | null> {
  const x = (await chrome.storage.local.get(XKEY))[XKEY] as Xfer | undefined;
  return validXfer(x) ? x : null;
}
export const saveXfer = (x: Xfer | null) => (x ? chrome.storage.local.set({ [XKEY]: x }) : chrome.storage.local.remove(XKEY));
