import { decodeFunctionData, parseAbi, toFunctionSelector, type Abi, type AbiFunction } from "viem";
import { base58 } from "@scure/base";
import { evmAddress } from "./account";
import { solAddress } from "./solbase";
import { crossSummary, FEE_STEP_ABI, LIFI_API, lifiFee, LIFI_INTEGRATOR, NON_EVM_ADDRESS } from "./lifi";
import { feeBps, SLIPPAGE_BPS } from "./swap";
import {
  approveData, checkEnvelope, checkTronCall, MAX_TRC20_FEE_LIMIT_SUN, tronAccount, tronAddress, tronBroadcast, tronEnergy, tronPost, tronPrices,
  tronResource, tronToHex, signTronTx, trc20Allowance, trc20Balance, TRON_USDT, txBandwidth, unsafe, waitTron, type TronTx,
} from "./tron";

export const TRON_DIAMOND = "TU3ymitEKCWQFtASkEeHaPb8NfZcJtCHLt";
export const TRON_FEE_COLLECTOR = "41" + "8a07dd6ca9ea2dccff2a0015811c895ac1abfcc5";
export const TRON_LIFI_FEE_WALLET = "41" + "a7d988115b81dca9d80f0bd14600f01d1ba25cbd";

export const TRON_MADAR_FEE_WALLET = "TYBzMGpseGV938f1XdA4JoGmh9aLySiZNL";

export const LAYERSWAP_DEPOSITORY_RECEIVERS = ["0x9b55eabe5abe37240be122894500b609b73bada3"];
export const LIFI_TRON_CHAIN = "728126428";
const LIFI_SOL_CHAIN = "1151111081099710";

export const MAX_FEE_LIMIT_SUN = 150_000_000;

const MAX_AHEAD_MS = 15 * 60_000;

export const TRON_TO = ["arbitrum", "base", "ethereum", "bsc", "polygon", "optimism", "avalanche", "solana"];
export const TRON_BRIDGES = "layerswap";
export const tronFeeOn = () => lifiFee() > 0;

const same = (x: unknown, y: unknown) => String(x ?? "").toLowerCase() === String(y ?? "").toLowerCase();
const hexOf = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

export const tronAbi = (a: string) => "0x" + tronToHex(a).slice(2);
const abi20 = (h41: string) => "0x" + h41.slice(2);

const BRIDGE_DATA = "(bytes32 transactionId,string bridge,string integrator,address referrer,address sendingAssetId,address receiver,uint256 minAmount,uint256 destinationChainId,bool hasSourceSwaps,bool hasDestinationCall)";
const SWAP_DATA = "(address callTo,address approveTo,address sendingAssetId,address receivingAssetId,uint256 fromAmount,bytes callData,bool requiresDeposit)[]";
const LAYERSWAP = "(bytes32 requestId,address depositoryReceiver,address refundRecipient,bytes32 nonEVMReceiver,bytes signature,uint256 deadline)";
const TRON_FACET = parseAbi([`function swapAndStartBridgeTokensViaLayerSwap(${BRIDGE_DATA} bridgeData, ${SWAP_DATA} swapData, ${LAYERSWAP} layerSwapData)`] as string[]) as Abi;
export const TRON_FACET_SELECTOR = toFunctionSelector(TRON_FACET[0] as AbiFunction);

export interface TronCross { toNetId: string; toChain: number | "SOL"; toToken: string; amount: bigint; from: string; to: string }

export function tronLifiQuoteUrl(r: TronCross): string {
  const p = new URLSearchParams({
    fromChain: "TRN", toChain: r.toChain === "SOL" ? "SOL" : String(r.toChain), fromToken: TRON_USDT, toToken: r.toToken,
    fromAmount: r.amount.toString(), fromAddress: r.from, toAddress: r.to, integrator: LIFI_INTEGRATOR, slippage: String(SLIPPAGE_BPS / 10000),
    allowBridges: TRON_BRIDGES, allowExchanges: "none",
  });
  if (tronFeeOn()) p.set("fee", String(lifiFee()));
  return `${LIFI_API}/quote?${p}`;
}
export async function tronLifiQuote(r: TronCross): Promise<any> {
  const res = await fetch(tronLifiQuoteUrl(r), { signal: AbortSignal.timeout(20_000), referrerPolicy: "no-referrer", cache: "no-store" });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.transactionRequest || !j.estimate || !j.action) throw Object.assign(new Error(j.message || "lifi"), { api: true, status: res.status, noRoute: res.status === 404 || j.code === 1002 });
  return j;
}

export function checkTronLifiTx(q: any, exp: TronCross, o: { shownMin?: bigint; shownOut?: bigint; nowMs?: number } = {}): { tx: TronTx; callData: string; feeLimit: number } {
  const nowMs = o.nowMs ?? Date.now(), a = q?.action ?? {}, tr = q?.transactionRequest ?? {};
  const tt = tr.customData?.tronTransaction;
  if (!tt || typeof tt.raw_data_hex !== "string" || String(tr.data || "").toLowerCase() !== "0x" + tt.raw_data_hex.toLowerCase()) throw unsafe("tron data");
  if (!same(tr.to, TRON_DIAMOND)) throw unsafe("tron to");
  let v: bigint;
  try { v = BigInt(tr.value || "0x0"); } catch { throw unsafe("tron value"); }
  if (v !== 0n) throw unsafe("tron value");
  const toSol = exp.toChain === "SOL", toChainNum = toSol ? LIFI_SOL_CHAIN : String(exp.toChain);
  if (String(a.fromChainId) !== LIFI_TRON_CHAIN || String(a.toChainId) !== toChainNum) throw unsafe("chains");
  if (a.fromToken?.address !== TRON_USDT || (toSol ? a.toToken?.address !== exp.toToken : !same(a.toToken?.address, exp.toToken))) throw unsafe("tokens");
  if (String(a.fromAmount) !== exp.amount.toString()) throw unsafe("amount");
  if (a.fromAddress !== exp.from || (toSol ? a.toAddress !== exp.to : !same(a.toAddress, exp.to))) throw unsafe("addresses");
  if (q.estimate?.approvalAddress !== TRON_DIAMOND) throw unsafe("approval");
  let toAmount: bigint, toAmountMin: bigint;
  try { toAmount = BigInt(q.estimate?.toAmount ?? "0"); toAmountMin = BigInt(q.estimate?.toAmountMin ?? "0"); } catch { throw unsafe("estimate"); }
  const min = o.shownMin ?? toAmountMin, ref = o.shownOut ?? toAmount;
  if (toAmount * 100n > ref * 105n || toAmount < min) throw unsafe("estimate");

  const { raw, c } = checkEnvelope(tt, { owner: exp.from, type: 31, maxFeeLimit: MAX_FEE_LIMIT_SUN, nowMs, maxAheadMs: MAX_AHEAD_MS });
  if (c.call!.contract !== tronToHex(TRON_DIAMOND)) throw unsafe("tron contract");
  const data = ("0x" + (c.call!.data ?? "")) as `0x${string}`;
  if (data.slice(0, 10) !== TRON_FACET_SELECTOR) throw unsafe("facet");
  let d;
  try { d = decodeFunctionData({ abi: TRON_FACET, data }); } catch { throw unsafe("facet"); }
  type B = { bridge: string; integrator: string; sendingAssetId: string; receiver: string; minAmount: bigint; destinationChainId: bigint; hasSourceSwaps: boolean; hasDestinationCall: boolean };
  type S = { callTo: string; approveTo: string; sendingAssetId: string; receivingAssetId: string; fromAmount: bigint; callData: `0x${string}` };
  type L = { depositoryReceiver: string; refundRecipient: string; nonEVMReceiver: string; signature: string; deadline: bigint };
  const [b, swaps, ls] = (d.args ?? []) as unknown as [B, readonly S[], L];
  const usdt = tronAbi(TRON_USDT), me = tronAbi(exp.from), amount = exp.amount;
  if (b.integrator !== LIFI_INTEGRATOR || b.bridge !== "layerswap") throw unsafe("integrator");
  if (b.hasDestinationCall) throw unsafe("destination call");
  if (String(b.destinationChainId) !== toChainNum) throw unsafe("destination");
  if (toSol ? !same(b.receiver, NON_EVM_ADDRESS) : !same(b.receiver, exp.to)) throw unsafe("receiver");
  if (!same(b.sendingAssetId, usdt)) throw unsafe("asset");
  if (b.minAmount > amount || b.minAmount * 10000n < amount * 9900n) throw unsafe("min amount");
  if (!b.hasSourceSwaps || swaps.length !== 1) throw unsafe("swaps");

  const s = swaps[0];
  if (!same(s.callTo, abi20(TRON_FEE_COLLECTOR)) || !same(s.approveTo, abi20(TRON_FEE_COLLECTOR))) throw unsafe("swap step");
  if (!same(s.sendingAssetId, usdt) || !same(s.receivingAssetId, usdt) || s.fromAmount !== amount) throw unsafe("swap chain");
  let f;
  try { f = decodeFunctionData({ abi: FEE_STEP_ABI, data: s.callData }); } catch { throw unsafe("fee step"); }
  if (f.functionName !== "forwardERC20Fees" || !same((f.args as unknown[])[0], usdt)) throw unsafe("fee token");
  let fees = 0n, lifi = 0n, madar = 0n;
  const ours = tronAbi(TRON_MADAR_FEE_WALLET);
  for (const e of (f.args as unknown[])[1] as readonly { recipient: string; amount: bigint }[]) {
    fees += e.amount;
    if (same(e.recipient, abi20(TRON_LIFI_FEE_WALLET))) lifi += e.amount;
    else if (same(e.recipient, ours)) madar += e.amount;
    else throw unsafe("fee recipient");
  }
  const madarFee = tronFeeOn() ? (amount * BigInt(feeBps())) / 10000n : 0n;
  if (madar !== madarFee) throw unsafe("madar fee");
  if (lifi * 10000n > amount * 25n) throw unsafe("lifi fee");
  if (fees * 100n > amount || b.minAmount !== amount - fees) throw unsafe("fees");

  if (!LAYERSWAP_DEPOSITORY_RECEIVERS.some((x) => same(x, ls.depositoryReceiver))) throw unsafe("layerswap depository");
  if (!same(ls.refundRecipient, me)) throw unsafe("layerswap refund");
  let solWord = "0x" + "0".repeat(64);
  if (toSol) { try { solWord = "0x" + hexOf(base58.decode(exp.to)); } catch { throw unsafe("receiver"); } if (solWord.length !== 66) throw unsafe("receiver"); }
  if (String(ls.nonEVMReceiver).toLowerCase() !== solWord) throw unsafe("layerswap receiver");
  if ((ls.signature.length - 2) / 2 !== 65) throw unsafe("layerswap signature");
  const dl = Number(ls.deadline), nowS = Math.floor(nowMs / 1000);
  if (dl < nowS || dl > nowS + 2 * 3600) throw unsafe("layerswap deadline");
  return { tx: { txID: tt.txID, raw_data: tt.raw_data, raw_data_hex: tt.raw_data_hex, visible: tt.visible }, callData: data, feeLimit: raw.feeLimit! };
}

export function checkTronApprove(tt: TronTx, e: { owner: string; amount: bigint; nowMs?: number }): TronTx {
  return checkTronCall(tt, { owner: e.owner, contract: TRON_USDT, data: approveData(TRON_DIAMOND, e.amount), maxFeeLimit: MAX_TRC20_FEE_LIMIT_SUN, nowMs: e.nowMs, maxAheadMs: 24 * 3600_000 });
}
async function buildApprove(owner: string, amount: bigint): Promise<TronTx> {
  const j = await tronPost<any>("/wallet/triggersmartcontract", {
    owner_address: owner, contract_address: TRON_USDT, function_selector: "approve(address,uint256)", parameter: approveData(TRON_DIAMOND, amount).slice(8),
    fee_limit: MAX_TRC20_FEE_LIMIT_SUN, call_value: 0, visible: true,
  });
  if (!j?.result?.result || !j.transaction) throw new Error("ERR_TRON_BUILD");
  return checkTronApprove(j.transaction, { owner, amount });
}

export const tronCrossSummary = (q: any) => { const s = crossSummary(q); return { ...s, gasUsd: null, costPct: s.feePct }; };

export async function tronCallNeed(owner: string, energy: number, rawHex: string): Promise<{ need: bigint; fee: bigint }> {
  const [res, prices] = await Promise.all([tronResource(owner), tronPrices()]);
  const bw = txBandwidth(rawHex);
  const bwSun = res.stakedBandwidth >= bw || res.freeBandwidth >= bw ? 0n : BigInt(bw) * BigInt(prices.byteSun);
  const short = BigInt(Math.max(0, energy - res.energy)) * BigInt(prices.energySun);
  return { fee: bwSun + short, need: bwSun + (short * 12n + 9n) / 10n };
}

export const TRON_SWAP_ENERGY_EST = 400_000;
const APPROVE_BYTES = 345, SWAP_BYTES = 1_200;
export interface TronSwapCost { approve: boolean; energy: number; fee: bigint; need: bigint; have: bigint; estimated: boolean }

export async function tronSwapCost(owner: string, amount: bigint, callData?: string): Promise<TronSwapCost> {
  const [allowance, res, prices, acct] = await Promise.all([trc20Allowance(owner, TRON_USDT, TRON_DIAMOND), tronResource(owner), tronPrices(), tronAccount(owner)]);
  const approve = allowance < amount;
  let energy = 0, estimated = false;
  if (approve) energy += (await tronEnergy(owner, TRON_USDT, approveData(TRON_DIAMOND, amount))) * (allowance > 0n ? 2 : 1);
  if (!approve && callData) energy += await tronEnergy(owner, TRON_DIAMOND, callData);
  else { energy += TRON_SWAP_ENERGY_EST; estimated = true; }
  const bytes = SWAP_BYTES + (approve ? APPROVE_BYTES * (allowance > 0n ? 2 : 1) : 0);
  const bw = res.stakedBandwidth >= bytes || res.freeBandwidth >= bytes ? 0n : BigInt(bytes) * BigInt(prices.byteSun);
  const burn = BigInt(Math.max(0, energy - res.energy)) * BigInt(prices.energySun);
  return { approve, energy, fee: bw + burn, need: bw + (burn * 12n + 9n) / 10n, have: acct.sun, estimated };
}

export async function tronLifiSwap(phrase: string, index: number, r: TronCross, shown: { out: bigint; min: bigint }, on: { approving?: () => void; swapping?: () => void } = {}): Promise<string> {
  const me = tronAddress(phrase, index);
  if (r.from !== me) throw unsafe("sender");

  if (r.toChain === "SOL" ? r.to !== solAddress(phrase, index) : !same(r.to, evmAddress(phrase, index))) throw unsafe("receiver");
  if ((await trc20Balance(me, TRON_USDT)) < r.amount) throw new Error("ERR_FUNDS");
  const allowance = await trc20Allowance(me, TRON_USDT, TRON_DIAMOND);
  if (allowance < r.amount) {

    const cost = await tronSwapCost(me, r.amount);
    if (cost.have < cost.need) throw Object.assign(new Error("ERR_TRX_FEE"), { need: cost.need, have: cost.have });
    on.approving?.();

    for (const amt of allowance > 0n ? [0n, r.amount] : [r.amount]) {
      const tx = await buildApprove(me, amt);
      const energy = await tronEnergy(me, TRON_USDT, approveData(TRON_DIAMOND, amt));
      const { need } = await tronCallNeed(me, energy, tx.raw_data_hex);
      const { sun } = await tronAccount(me);
      if (sun < need) throw Object.assign(new Error("ERR_TRX_FEE"), { need, have: sun });
      const id = await tronBroadcast(signTronTx(tx, phrase, index, me));
      await waitTron(id, { maxMs: 120_000 });
    }
    if ((await trc20Allowance(me, TRON_USDT, TRON_DIAMOND)) < r.amount) throw new Error("ERR_CHAIN");
  }
  on.swapping?.();
  const q = await tronLifiQuote(r);
  if (BigInt(q.estimate.toAmount) * 10000n < shown.out * BigInt(10000 - SLIPPAGE_BPS)) throw new Error("ERR_MOVED");
  if (BigInt(q.estimate.toAmountMin) * 10000n < shown.min * 9990n) throw new Error("ERR_MOVED");
  const c = checkTronLifiTx(q, r, { shownMin: shown.min, shownOut: shown.out });

  const energy = await tronEnergy(me, TRON_DIAMOND, c.callData);
  const { need } = await tronCallNeed(me, energy, c.tx.raw_data_hex);
  if (need > BigInt(c.feeLimit)) throw Object.assign(new Error("ERR_FEE_HIGH"), { need });
  const { sun } = await tronAccount(me);
  if (sun < need) throw Object.assign(new Error("ERR_TRX_FEE"), { need, have: sun });
  return tronBroadcast(signTronTx(c.tx, phrase, index, me));
}
