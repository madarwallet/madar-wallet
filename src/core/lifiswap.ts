import { decodeFunctionData, parseAbi, toFunctionSelector, type Abi, type AbiFunction, type Address, type Hash, type Hex } from "viem";
import { evmAddress } from "./account";
import { lifiSwapsOn, type Network } from "./chains";
import { feeFields, gasFees, type GasFees } from "./chainops";
import { FEE_STEP_ABI, LIFI_API, LIFI_DIAMOND, lifiFee, LIFI_FEE_COLLECTOR, LIFI_FEE_WALLET, LIFI_INTEGRATOR, MADAR_FEE_WALLET } from "./lifi";
import { EVM_NATIVE, evmFeeOn, feeBps, sendFees, SLIPPAGE_BPS, wallet, type SwapQuote } from "./swap";
import { guardEvm, simKey } from "./simulate";

const SD = "(address callTo,address approveTo,address sendingAssetId,address receivingAssetId,uint256 fromAmount,bytes callData,bool requiresDeposit)";
const HEAD = "bytes32 _transactionId,string _integrator,string _referrer,address _receiver,uint256 _minAmountOut";
const MULTI = ["swapTokensGeneric", "swapTokensMultipleV3ERC20ToERC20", "swapTokensMultipleV3ERC20ToNative", "swapTokensMultipleV3NativeToERC20"];
const SINGLE = ["swapTokensSingleV3ERC20ToERC20", "swapTokensSingleV3ERC20ToNative", "swapTokensSingleV3NativeToERC20"];
export const LIFI_SWAP_FACETS = parseAbi([
  ...MULTI.map((f) => `function ${f}(${HEAD},${SD}[] _swapData)`),
  ...SINGLE.map((f) => `function ${f}(${HEAD},${SD} _swapData)`),
] as string[]) as Abi;
export const LIFI_SWAP_SELECTORS = LIFI_SWAP_FACETS.map((f) => toFunctionSelector(f as AbiFunction));
const LIFI_OWN_FEE_BPS = 25n;
const TOLERANCE_BPS = 10n;
const ZERO = "0x0000000000000000000000000000000000000000";
const TIMEOUT = 15_000;
const same = (x: unknown, y: unknown) => String(x ?? "").toLowerCase() === String(y ?? "").toLowerCase();
const unsafe = (why: string) => Object.assign(new Error("ERR_UNSAFE"), { why });

const tok = (t: string) => (same(t, EVM_NATIVE) ? ZERO : t);

export interface SameReq { n: Network; tokenIn: string; tokenOut: string; amountIn: bigint; me: string }

export function lifiSameUrl(r: SameReq): string {
  const p = new URLSearchParams({
    fromChain: String(r.n.chain.id), toChain: String(r.n.chain.id), fromToken: tok(r.tokenIn), toToken: tok(r.tokenOut),
    fromAmount: r.amountIn.toString(), fromAddress: r.me, toAddress: r.me, integrator: LIFI_INTEGRATOR, slippage: String(SLIPPAGE_BPS / 10000),
  });
  if (evmFeeOn(r.me)) p.set("fee", String(lifiFee()));
  return `${LIFI_API}/quote?${p}`;
}

async function fetchQuote(r: SameReq): Promise<any> {
  const res = await fetch(lifiSameUrl(r), { signal: AbortSignal.timeout(TIMEOUT), referrerPolicy: "no-referrer", cache: "no-store" });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.transactionRequest || !j.estimate || !j.action) throw Object.assign(new Error(j.message || "lifi"), { api: true, status: res.status, noRoute: res.status === 404 || j.code === 1002 });
  return j;
}

export function checkLifiSwap(q: any, r: SameReq, shownMin?: bigint, shownOut?: bigint): { to: Address; data: Hex; value: bigint; minOut: bigint } {
  const tx = q?.transactionRequest ?? {}, a = q?.action ?? {};
  if (!same(tx.to, LIFI_DIAMOND)) throw unsafe("to");
  if (Number(tx.chainId) !== r.n.chain.id || Number(a.fromChainId) !== r.n.chain.id || Number(a.toChainId) !== r.n.chain.id) throw unsafe("chain");
  if (!same(a.fromToken?.address, tok(r.tokenIn)) || !same(a.toToken?.address, tok(r.tokenOut))) throw unsafe("tokens");
  if (String(a.fromAmount) !== r.amountIn.toString()) throw unsafe("amount");
  if (!same(a.fromAddress, r.me) || !same(a.toAddress, r.me)) throw unsafe("addresses");
  let value: bigint;
  try { value = BigInt(tx.value || "0x0"); } catch { throw unsafe("value"); }
  const nativeIn = same(r.tokenIn, EVM_NATIVE);
  if (value !== (nativeIn ? r.amountIn : 0n)) throw unsafe("value");
  if (!nativeIn && !same(q.estimate?.approvalAddress, LIFI_DIAMOND)) throw unsafe("approval");
  const data = String(tx.data || "") as Hex;
  if (!/^0x[0-9a-fA-F]{8,}$/.test(data) || !LIFI_SWAP_SELECTORS.includes(data.slice(0, 10).toLowerCase() as Hex)) throw unsafe("facet");
  let d;
  try { d = decodeFunctionData({ abi: LIFI_SWAP_FACETS, data }); } catch { throw unsafe("decode"); }
  type Step = { callTo: string; approveTo: string; sendingAssetId: string; receivingAssetId: string; fromAmount: bigint; callData: Hex };
  const args = (d.args ?? []) as readonly unknown[];
  const [, integrator, , receiver, minAmountOut] = args as [Hex, string, string, string, bigint];
  const steps: readonly Step[] = SINGLE.includes(d.functionName) ? [args[5] as Step] : (args[5] as readonly Step[]);
  if (integrator !== LIFI_INTEGRATOR) throw unsafe("integrator");
  if (!same(receiver, r.me)) throw unsafe("receiver");

  const nativeOut = same(r.tokenOut, EVM_NATIVE);
  if (/NativeToERC20$/.test(d.functionName) !== nativeIn && d.functionName !== "swapTokensGeneric") throw unsafe("facet kind");
  if (/ERC20ToNative$/.test(d.functionName) !== nativeOut && d.functionName !== "swapTokensGeneric") throw unsafe("facet kind");
  if (!steps.length) throw unsafe("steps");
  const tin = tok(r.tokenIn), tout = tok(r.tokenOut);
  const madarFee = evmFeeOn(r.me) ? (r.amountIn * BigInt(feeBps())) / 10000n : 0n;
  let prev = tin, lifi = 0n, madar = 0n, swaps = 0;
  steps.forEach((s, i) => {
    if (!same(s.sendingAssetId, prev)) throw unsafe("chain of steps");
    if (i === 0 && s.fromAmount !== r.amountIn) throw unsafe("first step amount");

    for (const x of [tin, tout]) if (x !== ZERO && (same(s.callTo, x) || same(s.approveTo, x))) throw unsafe("token call");
    if (same(s.callTo, LIFI_FEE_COLLECTOR)) {
      if (!same(s.approveTo, LIFI_FEE_COLLECTOR) || !same(s.receivingAssetId, s.sendingAssetId) || !same(s.sendingAssetId, tin)) throw unsafe("fee step");
      let f;
      try { f = decodeFunctionData({ abi: FEE_STEP_ABI, data: s.callData }); } catch { throw unsafe("fee step"); }
      const native = tin === ZERO;
      if (f.functionName === "forwardERC20Fees" ? native || !same((f.args as unknown[])[0], tin) : !native) throw unsafe("fee token");
      const list = (f.functionName === "forwardERC20Fees" ? (f.args as unknown[])[1] : (f.args as unknown[])[0]) as readonly { recipient: string; amount: bigint }[];
      for (const e of list) {
        if (same(e.recipient, LIFI_FEE_WALLET)) lifi += e.amount;
        else if (same(e.recipient, MADAR_FEE_WALLET)) madar += e.amount;
        else throw unsafe("fee recipient");
      }
    } else {
      if (same(s.callTo, ZERO) || same(s.callTo, LIFI_DIAMOND)) throw unsafe("step target");
      swaps++;
    }
    prev = s.receivingAssetId;
  });
  if (!same(prev, tout) || swaps < 1) throw unsafe("last step");
  if (madar !== madarFee) throw unsafe("madar fee");
  if (lifi * 10000n > r.amountIn * LIFI_OWN_FEE_BPS) throw unsafe("lifi fee");
  let toAmount: bigint, toAmountMin: bigint;
  try { toAmount = BigInt(q.estimate.toAmount); toAmountMin = BigInt(q.estimate.toAmountMin); } catch { throw unsafe("estimate"); }
  const min = shownMin ?? toAmountMin;
  const ref = shownOut ?? toAmount;
  if (minAmountOut * 10000n < min * (10000n - TOLERANCE_BPS)) throw Object.assign(new Error("ERR_MOVED"), { why: "min out" });
  if (minAmountOut * 100n > ref * 105n || toAmount * 100n > ref * 105n) throw unsafe("min out above shown");
  return { to: LIFI_DIAMOND as Address, data, value, minOut: minAmountOut };
}

export async function lifiSameQuote(r: SameReq): Promise<SwapQuote> {
  const [q, fees] = await Promise.all([fetchQuote(r), gasFees(r.n).catch(() => undefined)]);
  const c = checkLifiSwap(q, r);
  const out = BigInt(q.estimate.toAmount);
  const fee = evmFeeOn(r.me) ? { amount: (r.amountIn * BigInt(feeBps())) / 10000n, onOutput: false } : null;
  return { amountIn: r.amountIn, amountOut: out, minOut: c.minOut, fee, raw: q, fees, via: "lifi" };
}

export async function lifiSameSend(n: Network, phrase: string, index: number, tokenIn: string, tokenOut: string, amountIn: bigint, shownOut: bigint, shownMin: bigint, reviewed?: GasFees): Promise<Hash> {
  const me = evmAddress(phrase, index);
  const r: SameReq = { n, tokenIn, tokenOut, amountIn, me };
  const q = await fetchQuote(r);
  if (BigInt(q.estimate.toAmount) * 10000n < shownOut * BigInt(10000 - SLIPPAGE_BPS)) throw new Error("ERR_MOVED");
  const c = checkLifiSwap(q, r, shownMin, shownOut);

  await guardEvm(n, [{ from: me as Address, to: c.to, data: c.data, value: c.value }], { token: simKey(tokenOut), min: c.minOut });
  const fees = await sendFees(n, reviewed);
  return wallet(n, phrase, index).sendTransaction({ to: c.to, data: c.data, value: c.value, ...feeFields(fees) } as never);
}

export async function bestEvmQuote(n: Network, tokenIn: string, tokenOut: string, amountIn: bigint, me: string, kyberQuote: (n: Network, a: string, b: string, x: bigint, m: string) => Promise<SwapQuote>): Promise<SwapQuote> {

  const [k, l] = await Promise.allSettled([kyberQuote(n, tokenIn, tokenOut, amountIn, me), lifiSwapsOn(n) ? lifiSameQuote({ n, tokenIn, tokenOut, amountIn, me }) : Promise.reject(new Error("ERR_UNSUPPORTED"))]);
  const kq = k.status === "fulfilled" ? { ...k.value, via: "kyber" as const } : null;
  const lq = l.status === "fulfilled" ? l.value : null;
  if (kq && lq) return lq.amountOut > kq.amountOut ? lq : kq;
  if (kq || lq) return (kq ?? lq)!;
  throw (k as PromiseRejectedResult).reason;
}
