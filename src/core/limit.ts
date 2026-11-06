import { concat, encodeAbiParameters, getAddress, hashTypedData, keccak256, numberToHex, toBytes, type Address, type Hex } from "viem";
import { evmAccount, evmAddress } from "./account";
import type { Network } from "./chains";
import { EVM_NATIVE, evmFeeOn, feeBps, feeReceiverFor } from "./swap";

export const COW_NETS: Readonly<Record<string, string>> = {
  ethereum: "mainnet", arbitrum: "arbitrum_one", base: "base", polygon: "polygon", bsc: "bnb", avalanche: "avalanche",
  gnosis: "xdai", linea: "linea", ink: "ink",
};
export const COW_API = "https://api.cow.fi";

export const COW_SETTLEMENT = "0x9008D19f58AAbD9eD0D60971565AA8510560ab41";
export const COW_RELAYER = "0xC92E8bdf79f0507f65a392b0ab4667716BFE0110";

export const APP_DATA = JSON.stringify({ appCode: "Madar Wallet", metadata: {}, version: "1.3.0" });
export const APP_DATA_HASH = keccak256(toBytes(APP_DATA));
export const DAY = 86_400;
export const VALID_DAYS = [1, 7, 30] as const;

export const cowNet = (netId: string): string | null => COW_NETS[netId] ?? null;
const err = (why: string) => Object.assign(new Error("ERR_LIMIT"), { why });
const isNative = (a: string) => a.toLowerCase() === EVM_NATIVE.toLowerCase();

export interface CowOrder {
  sellToken: Address; buyToken: Address; receiver: Address; sellAmount: bigint; buyAmount: bigint; validTo: number;
  appData: Hex; feeAmount: bigint; kind: "sell"; partiallyFillable: false; sellTokenBalance: "erc20"; buyTokenBalance: "erc20";
}

export const ORDER_TYPES = {
  Order: [
    { name: "sellToken", type: "address" }, { name: "buyToken", type: "address" }, { name: "receiver", type: "address" },
    { name: "sellAmount", type: "uint256" }, { name: "buyAmount", type: "uint256" }, { name: "validTo", type: "uint32" },
    { name: "appData", type: "bytes32" }, { name: "feeAmount", type: "uint256" }, { name: "kind", type: "string" },
    { name: "partiallyFillable", type: "bool" }, { name: "sellTokenBalance", type: "string" }, { name: "buyTokenBalance", type: "string" },
  ],
} as const;
export const CANCEL_TYPES = { OrderCancellations: [{ name: "orderUids", type: "bytes[]" }] } as const;
export const cowDomain = (chainId: number) => ({ name: "Gnosis Protocol", version: "v2", chainId, verifyingContract: COW_SETTLEMENT as Address });

export function cowDomainSeparator(chainId: number): Hex {
  const typeHash = keccak256(toBytes("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"));
  return keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }, { type: "address" }],
    [typeHash, keccak256(toBytes("Gnosis Protocol")), keccak256(toBytes("v2")), BigInt(chainId), COW_SETTLEMENT as Address]));
}

export function makeOrder(p: { sellToken: string; buyToken: string; sellAmount: bigint; buyAmount: bigint; me: string; validTo: number; receiver?: string }): CowOrder {
  if (isNative(p.sellToken)) throw err("native sell");
  if (p.sellToken.toLowerCase() === p.buyToken.toLowerCase()) throw err("same coin");
  if (p.sellAmount <= 0n || p.buyAmount <= 0n) throw err("amount");
  return {
    sellToken: getAddress(p.sellToken), buyToken: getAddress(p.buyToken), receiver: getAddress(p.receiver ?? p.me), sellAmount: p.sellAmount, buyAmount: p.buyAmount,
    validTo: p.validTo, appData: APP_DATA_HASH, feeAmount: 0n, kind: "sell", partiallyFillable: false, sellTokenBalance: "erc20", buyTokenBalance: "erc20",
  };
}

export function orderUid(chainId: number, o: CowOrder, owner: string): Hex {
  const digest = hashTypedData({ domain: cowDomain(chainId), types: ORDER_TYPES, primaryType: "Order", message: o });
  return concat([digest, getAddress(owner), numberToHex(o.validTo, { size: 4 })]).toLowerCase() as Hex;
}

export function parsePrice(s: string): { num: bigint; den: bigint } | null {
  const t = s.replace(/[,\s٬]/g, "").replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)).replace("٫", ".");
  const m = /^(\d{1,15})(?:\.(\d{1,18}))?$/.exec(t);
  if (!m) return null;
  const frac = m[2] ?? "";
  const num = BigInt(m[1] + frac), den = 10n ** BigInt(frac.length);
  return num > 0n ? { num, den } : null;
}
const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;

export function buyAmountFor(dollars: bigint, dollarDecimals: number, price: { num: bigint; den: bigint }, coinDecimals: number): bigint {
  return ceilDiv(dollars * price.den * 10n ** BigInt(coinDecimals), price.num * 10n ** BigInt(dollarDecimals));
}

export function sellAmountFor(coins: bigint, coinDecimals: number, price: { num: bigint; den: bigint }, dollarDecimals: number): bigint {
  return ceilDiv(coins * price.num * 10n ** BigInt(dollarDecimals), price.den * 10n ** BigInt(coinDecimals));
}

export function fillsNow(side: "buy" | "sell", price: { num: bigint; den: bigint }, market: number | null): boolean {
  if (market == null || !(market > 0)) return false;
  const p = Number(price.num) / Number(price.den);
  return side === "buy" ? p >= market : p <= market;
}

export function checkOrder(o: CowOrder, e: { me: string; sellToken: string; buyToken: string; sellAmount: bigint; buyAmount: bigint; now: number; receiver?: string }) {
  if (o.receiver.toLowerCase() !== (e.receiver ?? e.me).toLowerCase()) throw err("receiver");
  if (o.sellToken.toLowerCase() !== e.sellToken.toLowerCase() || o.buyToken.toLowerCase() !== e.buyToken.toLowerCase()) throw err("coins");
  if (o.sellAmount !== e.sellAmount || o.buyAmount !== e.buyAmount) throw err("amounts");
  if (o.feeAmount !== 0n || o.partiallyFillable || o.kind !== "sell" || o.sellTokenBalance !== "erc20" || o.buyTokenBalance !== "erc20") throw err("terms");
  if (o.appData !== APP_DATA_HASH) throw err("app data");
  if (o.validTo < e.now + DAY - 600 || o.validTo > e.now + 30 * DAY + 600) throw err("expiry");
}

export function splitFee(total: bigint, owner: string): { main: bigint; fee: bigint } {
  const fee = evmFeeOn(owner) ? (total * BigInt(feeBps())) / 10_000n : 0n;
  return { main: total - fee, fee };
}

export const limitFeeReceiver = (netId: string, buyToken: string) => feeReceiverFor(netId, buyToken);

let lane: Promise<unknown> = Promise.resolve();

export async function cowFetch(path: string, init: RequestInit = {}, gapMs = 1100): Promise<Response> {
  const run = async () => {
    for (let i = 0; ; i++) {
      const r = await fetch(COW_API + path, { ...init, cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer", signal: AbortSignal.timeout(15_000) });
      if (r.status !== 429 || i >= 2) return r;
      await new Promise((ok) => setTimeout(ok, gapMs * 1.5));
    }
  };
  const p = lane.then(run, run);
  lane = p.then(() => new Promise((ok) => setTimeout(ok, gapMs)), () => new Promise((ok) => setTimeout(ok, gapMs)));
  return p;
}
async function cowJson(path: string, init?: RequestInit): Promise<any> {
  const r = await cowFetch(path, init);
  const text = await r.text();
  let j: any = null;
  try { j = JSON.parse(text); } catch {  }
  if (!r.ok) throw Object.assign(new Error("ERR_COW"), { why: String(j?.errorType ?? r.status), detail: String(j?.description ?? text).slice(0, 200) });
  return j;
}
const base = (n: Network) => { const s = cowNet(n.id); if (!s) throw err("network"); return `/${s}/api/v1`; };

export interface PlacedOrder { uid: Hex; netId: string; owner: string; sellToken: string; buyToken: string; sellAmount: string; buyAmount: string; validTo: number; side: "buy" | "sell"; coin: string; dollar: string; at: number;

  feeUid?: Hex; feeSell?: string }

export async function placeOrder(n: Network, phrase: string, index: number, o: CowOrder): Promise<Hex> {
  const me = evmAddress(phrase, index);
  const uid = orderUid(n.chain.id, o, me);
  const signature = await evmAccount(phrase, index).signTypedData({ domain: cowDomain(n.chain.id), types: ORDER_TYPES, primaryType: "Order", message: o });
  const body = {
    sellToken: o.sellToken, buyToken: o.buyToken, receiver: o.receiver, sellAmount: String(o.sellAmount), buyAmount: String(o.buyAmount), validTo: o.validTo,
    appData: APP_DATA, appDataHash: APP_DATA_HASH, feeAmount: "0", kind: "sell", partiallyFillable: false, sellTokenBalance: "erc20", buyTokenBalance: "erc20",
    signingScheme: "eip712", signature, from: me,
  };
  const got = await cowJson(`${base(n)}/orders`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (typeof got !== "string" || got.toLowerCase() !== uid) throw err("order id");
  return uid;
}

export type OrderState = "open" | "filled" | "cancelled" | "expired" | "unknown";

export async function orderState(n: Network, uid: string): Promise<{ state: OrderState; executedBuy: bigint }> {
  const j = await cowJson(`${base(n)}/orders/${uid}`);
  const s = String(j?.status ?? "");
  const state: OrderState = s === "open" || s === "presignaturePending" ? "open" : s === "fulfilled" ? "filled" : s === "cancelled" ? "cancelled" : s === "expired" ? "expired" : "unknown";
  return { state, executedBuy: BigInt(/^\d+$/.test(String(j?.executedBuyAmount ?? "")) ? j.executedBuyAmount : 0) };
}

export async function cancelOrders(n: Network, phrase: string, index: number, uids: Hex[]): Promise<void> {
  if (!uids.length) return;
  const signature = await evmAccount(phrase, index).signTypedData({ domain: cowDomain(n.chain.id), types: CANCEL_TYPES, primaryType: "OrderCancellations", message: { orderUids: uids } });
  await cowJson(`${base(n)}/orders`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderUids: uids, signature, signingScheme: "eip712" }) });
}

const KEY = "limitOrders";
export async function loadOrders(): Promise<PlacedOrder[]> {
  try { const v = (await chrome.storage.local.get(KEY))[KEY]; return Array.isArray(v) ? (v as PlacedOrder[]) : []; } catch { return []; }
}
export async function saveOrder(o: PlacedOrder): Promise<void> {
  const all = (await loadOrders()).filter((x) => x.uid !== o.uid);
  await chrome.storage.local.set({ [KEY]: [o, ...all].slice(0, 100) });
}
export async function dropOrder(uid: string): Promise<void> {
  await chrome.storage.local.set({ [KEY]: (await loadOrders()).filter((x) => x.uid !== uid) });
}

export function allowanceNeed(orders: readonly PlacedOrder[], netId: string, owner: string, token: string, extra: bigint, now: number): bigint {
  return orders.filter((o) => o.netId === netId && o.owner.toLowerCase() === owner.toLowerCase() && o.sellToken.toLowerCase() === token.toLowerCase() && o.validTo > now)
    .reduce((s, o) => s + BigInt(o.sellAmount) + BigInt(o.feeSell ?? 0), extra);
}
