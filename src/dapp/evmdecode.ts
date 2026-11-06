import { decodeFunctionData, formatUnits, getAddress, hexToBytes, isAddress, isHex, keccak256, maxUint256, parseAbi, type Abi, type Hex } from "viem";
import { NETWORKS, type Network } from "../core/chains";
import { rpcError, ERR } from "./protocol";

export const chainHex = (id: number) => `0x${id.toString(16)}`;
export const networkByChainId = (id: number): Network | undefined => NETWORKS.find((n) => n.chain.id === id);
export function parseChainId(v: unknown): number | null {
  if (typeof v === "number" && Number.isSafeInteger(v) && v > 0) return v;
  if (typeof v === "string" && /^0x[0-9a-fA-F]{1,12}$/.test(v)) return parseInt(v, 16);
  if (typeof v === "string" && /^[1-9][0-9]{0,12}$/.test(v)) return Number(v);
  return null;
}

export type NamesMessage =
  | { kind: "register"; name: string }
  | { kind: "sale"; name: string; price: string; payTo: string; offer: string }
  | { kind: "buy"; name: string; price: string; offer: string }
  | { kind: "link"; name: string; account: string }
  | { kind: "transfer" };
export interface MessageView { text: string | null; hex: string; names: NamesMessage | null }

const NAME = "([a-z0-9](?:[a-z0-9-]{1,30})[a-z0-9])";
const RE_REGISTER = new RegExp(`^MADAR Names: register ${NAME}\\.madar to this wallet\\. No funds move\\.$`);
const RE_SALE = new RegExp(`^MADAR Names: I offer ${NAME}\\.madar for (\\d{1,18}\\.\\d{2}) USD, paid to ([^\\s,]{1,128}), under the MADAR Names sale terms v1\\. Offer (\\d{1,10}), valid until (\\d{1,20})\\.$`);
const RE_BUY = new RegExp(`^MADAR Names: I buy ${NAME}\\.madar for (\\d{1,18}\\.\\d{2}) USD plus the MADAR fee, under the MADAR Names sale terms v1\\. Offer (\\d{1,10})\\. The name comes to this wallet\\.$`);

const RE_LINK = new RegExp(`^MADAR Names: link ${NAME}\\.madar to the MADAR account (\\S{1,64}) \\(link (\\d{1,10})\\)\\. No funds move\\.$`);

const RE_LINK2 = new RegExp(`^madar-network\\.com asks you to sign:\\nMADAR Names: link ${NAME}\\.madar to the MADAR account ([^\\p{Cc}\\p{Cf}\\n]{1,120}) \\(link (\\d{1,10})\\)\\.\\nThe page of \\1\\.madar, its private messages and its editing move to that account\\.\\nIssued At: \\d{4}-\\d\\d-\\d\\dT\\d\\d:\\d\\d:\\d\\dZ\\nExpires: \\d{4}-\\d\\d-\\d\\dT\\d\\d:\\d\\d:\\d\\dZ$`, "u");
const RE_MOVES = /\b(offer|offers|buy|buys|sell|sells|sale|transfer|transfers|move|moves|give|gives|owner|ownership|accept|accepts)\b/i;

export function namesMessage(text: string | null): NamesMessage | null {
  if (text == null || !/MADAR Names/i.test(text)) return null;
  let m = RE_REGISTER.exec(text);
  if (m) return { kind: "register", name: m[1] };
  if ((m = RE_SALE.exec(text))) return { kind: "sale", name: m[1], price: m[2], payTo: m[3], offer: m[4] };
  if ((m = RE_BUY.exec(text))) return { kind: "buy", name: m[1], price: m[2], offer: m[3] };
  if ((m = RE_LINK.exec(text))) return { kind: "link", name: m[1], account: m[2] };
  if ((m = RE_LINK2.exec(text))) return { kind: "link", name: m[1], account: m[2] };
  if (/^MADAR Names: link /.test(text)) return { kind: "transfer" };

  return RE_MOVES.test(text.split("No funds move.").join("")) ? { kind: "transfer" } : null;
}

export const namesNeedsConfirm = (n: NamesMessage | null) => n != null && n.kind !== "register";

export function messageView(bytes: Uint8Array): MessageView {
  const hex = "0x" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  let text: string | null = null;
  try {
    const s = new TextDecoder("utf-8", { fatal: true }).decode(bytes);

    if (!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f‪-‮⁦-⁩‎‏؜​⁠﻿]/.test(s)) text = s;
  } catch {  }
  return { text, hex, names: namesMessage(text) };
}

export function parsePersonalSign(params: unknown): { bytes: Uint8Array; address: string } {
  if (!Array.isArray(params) || params.length < 2) throw rpcError(ERR.invalidParams, "personal_sign expects [message, address]");
  let [msg, addr] = params as unknown[];
  if (typeof msg === "string" && isAddress(msg) && !(typeof addr === "string" && isAddress(addr))) [msg, addr] = [addr, msg];
  if (typeof msg !== "string" || typeof addr !== "string" || !isAddress(addr)) throw rpcError(ERR.invalidParams, "personal_sign expects [message, address]");
  const bytes = isHex(msg) && msg.length % 2 === 0 ? hexToBytes(msg as Hex) : new TextEncoder().encode(msg);
  if (bytes.length > 64 * 1024) throw rpcError(ERR.invalidParams, "Message too long");
  return { bytes, address: addr };
}

export interface TxParams { from?: string; to: `0x${string}`; value: bigint; data: Hex; gas?: bigint; chainId?: number }

const toBig = (v: unknown, what: string): bigint => {
  if (v == null) return 0n;
  if (typeof v === "string" && /^0x[0-9a-fA-F]{0,64}$/.test(v)) return v === "0x" ? 0n : BigInt(v);
  if (typeof v === "string" && /^[0-9]{1,78}$/.test(v)) return BigInt(v);
  if (typeof v === "number" && Number.isSafeInteger(v) && v >= 0) return BigInt(v);
  throw rpcError(ERR.invalidParams, `Invalid ${what}`);
};

export function parseTx(params: unknown): TxParams {
  const p = Array.isArray(params) ? params[0] : null;
  if (!p || typeof p !== "object") throw rpcError(ERR.invalidParams, "eth_sendTransaction expects [transaction]");
  const tx = p as Record<string, unknown>;
  if (typeof tx.to !== "string" || !isAddress(tx.to)) throw rpcError(ERR.invalidParams, "A valid 'to' address is required (contract deployment is not supported)");
  if (tx.from != null && (typeof tx.from !== "string" || !isAddress(tx.from))) throw rpcError(ERR.invalidParams, "Invalid 'from'");
  const data = (tx.data ?? tx.input ?? "0x") as string;
  if (typeof data !== "string" || !/^0x([0-9a-fA-F]{2})*$/.test(data)) throw rpcError(ERR.invalidParams, "Invalid 'data'");
  const value = toBig(tx.value, "value");
  const gas = tx.gas ?? tx.gasLimit;
  let chainId: number | undefined;
  if (tx.chainId != null) { const c = parseChainId(tx.chainId); if (c == null) throw rpcError(ERR.invalidParams, "Invalid 'chainId'"); chainId = c; }
  return { from: tx.from as string | undefined, to: getAddress(tx.to), value, data: data.toLowerCase() as Hex, gas: gas == null ? undefined : toBig(gas, "gas"), chainId };
}

const ERC20_ABI = [
  { type: "function", name: "transfer", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "transferFrom", stateMutability: "nonpayable", inputs: [{ name: "from", type: "address" }, { name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "increaseAllowance", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
  {
    type: "function", name: "permit", stateMutability: "nonpayable", outputs: [],
    inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }, { name: "value", type: "uint256" }, { name: "deadline", type: "uint256" }, { name: "v", type: "uint8" }, { name: "r", type: "bytes32" }, { name: "s", type: "bytes32" }],
  },
] as const;

export type Erc20Fn = "transfer" | "transferFrom" | "approve" | "increaseAllowance" | "permit";

export interface Field { k: "recipient" | "from" | "spender" | "owner" | "amount" | "deadline"; v: string }
export interface Erc20Call { fn: Erc20Fn; fields: Field[]; amount: bigint; unlimited: boolean }

export function decodeErc20(data: Hex): Erc20Call | null {
  if (data.length < 10) return null;
  let d;
  try { d = decodeFunctionData({ abi: ERC20_ABI, data }); } catch { return null; }
  const a = d.args as readonly unknown[];
  const big = (x: unknown) => x as bigint, addr = (x: unknown) => getAddress(x as string);
  switch (d.functionName) {
    case "transfer": return { fn: "transfer", fields: [{ k: "recipient", v: addr(a[0]) }, { k: "amount", v: String(a[1]) }], amount: big(a[1]), unlimited: false };
    case "transferFrom": return { fn: "transferFrom", fields: [{ k: "from", v: addr(a[0]) }, { k: "recipient", v: addr(a[1]) }, { k: "amount", v: String(a[2]) }], amount: big(a[2]), unlimited: false };
    case "approve":
    case "increaseAllowance":
      return { fn: d.functionName, fields: [{ k: "spender", v: addr(a[0]) }, { k: "amount", v: String(a[1]) }], amount: big(a[1]), unlimited: isUnlimited(big(a[1])) };
    case "permit":
      return { fn: "permit", fields: [{ k: "owner", v: addr(a[0]) }, { k: "spender", v: addr(a[1]) }, { k: "amount", v: String(a[2]) }, { k: "deadline", v: String(a[3]) }], amount: big(a[2]), unlimited: isUnlimited(big(a[2])) };
  }
  return null;
}

export const UNLIMITED_FROM = 2n ** 96n;
export const isUnlimited = (v: bigint) => v === maxUint256 || v >= UNLIMITED_FROM;

export const MADAR_SPLIT: Readonly<Record<number, string>> = {
  8453: "0x326edbd73c12d67e5c94c8f29b191fe28abc4a9b",
  42161: "0x9a4e399e39a9b340ba7b793d3a6f6e38326cc298",
  10: "0x9a4e399e39a9b340ba7b793d3a6f6e38326cc298",
  56: "0x9a4e399e39a9b340ba7b793d3a6f6e38326cc298",
  137: "0x1c55d0bc456a6db69c229b73c640bf21a884c391",
};
export const SPLIT_FEE_RECIPIENT = "0xb95c91Bb8C58b929d501BD8D0aCcB420F8A7045d";
export const SPLIT_RATES = [700, 1000] as const;
export const isMadarSplit = (chainId: number, to: string) => MADAR_SPLIT[chainId] === to.toLowerCase();

export const SPLIT_ABI = [
  { type: "function", name: "donate", stateMutability: "nonpayable", outputs: [], inputs: [{ name: "token", type: "address" }, { name: "to", type: "address" }, { name: "amount", type: "uint256" }, { name: "feeBps", type: "uint16" }, { name: "ref", type: "bytes32" }] },
  {
    type: "function", name: "donateWithPermit", stateMutability: "nonpayable", outputs: [],
    inputs: [{ name: "token", type: "address" }, { name: "to", type: "address" }, { name: "amount", type: "uint256" }, { name: "feeBps", type: "uint16" }, { name: "ref", type: "bytes32" }, { name: "deadline", type: "uint256" }, { name: "v", type: "uint8" }, { name: "r", type: "bytes32" }, { name: "s", type: "bytes32" }],
  },
] as const;

export type SplitRef = { kind: "gift"; gift: string; name: string; cut: boolean } | { kind: "name"; name: string } | { kind: "none" } | { kind: "raw"; hex: string };
export function decodeSplitRef(ref: string): SplitRef {
  const h = ref.toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{64}$/.test(h)) return { kind: "raw", hex: ref };
  const bytes = (h.match(/../g) as string[]).map((x) => parseInt(x, 16));
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) end--;
  if (end === 0) return { kind: "none" };
  const used = bytes.slice(0, end);
  if (used.some((b) => b < 0x21 || b > 0x7e)) return { kind: "raw", hex: "0x" + h };
  const s = String.fromCharCode(...used);
  const g = /^g1:([a-z0-9_-]{1,16}):([a-z0-9-]{1,30})$/.exec(s);
  if (g) return { kind: "gift", gift: g[1], name: g[2], cut: s.length === 32 };
  if (/^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/.test(s)) return { kind: "name", name: s };
  return { kind: "raw", hex: "0x" + h };
}

export interface SplitCall {
  fn: "donate" | "donateWithPermit";
  token: string; recipient: string;

  amount: string; fee: string; recipientGets: string;
  feeBps: number; validRate: boolean;
  ref: SplitRef; deadline: string | null;
}

export function decodeSplit(chainId: number, to: string, data: Hex): SplitCall | null {
  if (!isMadarSplit(chainId, to) || data.length < 10) return null;
  let d;
  try { d = decodeFunctionData({ abi: SPLIT_ABI, data }); } catch { return null; }
  const a = d.args as readonly unknown[];
  const amount = a[2] as bigint, feeBps = Number(a[3]);
  const validRate = (SPLIT_RATES as readonly number[]).includes(feeBps);
  const fee = validRate ? (amount * BigInt(feeBps)) / 10000n : 0n;
  return {
    fn: d.functionName, token: getAddress(a[0] as string), recipient: getAddress(a[1] as string),
    amount: amount.toString(), fee: fee.toString(), recipientGets: (amount - fee).toString(), feeBps, validRate,
    ref: decodeSplitRef(a[4] as string), deadline: d.functionName === "donateWithPermit" ? String(a[5]) : null,
  };
}

export const KYBER_ROUTER = "0x6131b5fae19ea4f9d964eac0408e4408b66337b5";

export const KYBER_ROUTERS: Readonly<Record<number, string>> = { 1: KYBER_ROUTER, 10: KYBER_ROUTER, 56: KYBER_ROUTER, 137: KYBER_ROUTER, 8453: KYBER_ROUTER, 42161: KYBER_ROUTER, 43114: KYBER_ROUTER };
export const isKyberRouter = (chainId: number, to: string) => KYBER_ROUTERS[chainId] === to.toLowerCase();
const KYBER_DESC = "(address srcToken,address dstToken,address[] srcReceivers,uint256[] srcAmounts,address[] feeReceivers,uint256[] feeAmounts,address dstReceiver,uint256 amount,uint256 minReturnAmount,uint256 flags,bytes permit)";

export const KYBER_ABI = parseAbi([
  `function swap((address callTarget,address approveTarget,bytes targetData,${KYBER_DESC} desc,bytes clientData) execution)`,
  `function swapSimpleMode(address caller,${KYBER_DESC} desc,bytes executorData,bytes clientData)`,
] as string[]) as Abi;

export const KYBER_EXECUTORS = ["0x8F10B468b06c6FD214B65F87778827F7D113f996"];

export const KYBER_NATIVE = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

export const SWAP_FEE_BPS = 50;
export const SWAP_FEE_RECEIVER = "0xb95c91Bb8C58b929d501BD8D0aCcB420F8A7045d";
const KY_FLAGS_NO_FEE = 0x200n, KY_FLAGS_FEE = 0x280n;
type KyberDesc = { flags: bigint; srcToken: string; dstToken: string; srcReceivers: readonly string[]; srcAmounts: readonly bigint[]; feeReceivers: readonly string[]; feeAmounts: readonly bigint[]; dstReceiver: string; amount: bigint; minReturnAmount: bigint; permit: Hex };

export interface KyberCall {
  fn: "swap" | "swapSimpleMode";

  tokenIn: string | null; tokenOut: string | null;

  amountIn: string; minOut: string; feeBps: number; fee: string;
}

export function decodeKyber(chainId: number, to: string, value: bigint, data: Hex, me: string): KyberCall | null {
  if (!isKyberRouter(chainId, to) || data.length < 10) return null;
  let d;
  try { d = decodeFunctionData({ abi: KYBER_ABI, data }); } catch { return null; }
  const same = (x: unknown, y: string) => typeof x === "string" && x.toLowerCase() === y.toLowerCase();
  const args = (d.args ?? []) as readonly unknown[];
  const fn = d.functionName as KyberCall["fn"];
  if (fn !== "swap" && fn !== "swapSimpleMode") return null;
  const exec = fn === "swap" ? (args[0] as { callTarget: string; approveTarget: string; desc: KyberDesc }) : null;
  const desc = (exec ? exec.desc : args[1]) as KyberDesc;
  const target = exec ? exec.callTarget : (args[0] as string);
  if (!KYBER_EXECUTORS.some((x) => same(target, x))) return null;
  if (exec && !same(exec.approveTarget, "0x0000000000000000000000000000000000000000")) return null;

  if (desc.srcReceivers.length !== desc.srcAmounts.length || desc.srcAmounts.reduce((a, b) => a + b, 0n) > desc.amount) return null;
  if (desc.srcAmounts.reduce((a, b) => a + b, 0n) > desc.amount) return null;
  if (desc.permit !== "0x" || !same(desc.dstReceiver, me) || desc.amount <= 0n) return null;
  if (same(desc.srcToken, desc.dstToken)) return null;
  const nativeIn = same(desc.srcToken, KYBER_NATIVE), nativeOut = same(desc.dstToken, KYBER_NATIVE);
  if (value !== (nativeIn ? desc.amount : 0n)) return null;
  let feeBps = 0;
  if (desc.flags === KY_FLAGS_FEE) {
    if (desc.feeReceivers.length !== 1 || desc.feeAmounts.length !== 1 || !same(desc.feeReceivers[0], SWAP_FEE_RECEIVER) || desc.feeAmounts[0] !== BigInt(SWAP_FEE_BPS)) return null;
    feeBps = SWAP_FEE_BPS;
  } else if (desc.flags !== KY_FLAGS_NO_FEE || desc.feeReceivers.length !== 0 || desc.feeAmounts.length !== 0) return null;
  return {
    fn, tokenIn: nativeIn ? null : getAddress(desc.srcToken), tokenOut: nativeOut ? null : getAddress(desc.dstToken),
    amountIn: desc.amount.toString(), minOut: desc.minReturnAmount.toString(), feeBps, fee: ((desc.amount * BigInt(feeBps)) / 10000n).toString(),
  };
}

type TypedField = { name: string; type: string };
export interface TypedData { domain: Record<string, unknown>; types: Record<string, TypedField[]>; primaryType: string; message: Record<string, unknown> }

export function parseTypedDataParams(params: unknown): { address: string; data: TypedData } {
  if (!Array.isArray(params) || params.length < 2) throw rpcError(ERR.invalidParams, "eth_signTypedData_v4 expects [address, typedData]");
  const [addr, raw] = params as unknown[];
  if (typeof addr !== "string" || !isAddress(addr)) throw rpcError(ERR.invalidParams, "Invalid address");
  let td: unknown = raw;
  if (typeof raw === "string") { if (raw.length > 64 * 1024) throw rpcError(ERR.invalidParams, "Typed data too large"); try { td = JSON.parse(raw); } catch { throw rpcError(ERR.invalidParams, "Typed data is not valid JSON"); } }
  const o = td as Partial<TypedData> | null;
  if (!o || typeof o !== "object" || typeof o.primaryType !== "string" || !o.types || typeof o.types !== "object" || !o.message || typeof o.message !== "object" || !o.domain || typeof o.domain !== "object")
    throw rpcError(ERR.invalidParams, "Invalid typed data");
  if (!Array.isArray(o.types[o.primaryType])) throw rpcError(ERR.invalidParams, "Unknown primaryType");
  return { address: addr, data: o as TypedData };
}

export interface PermitView { token: string; owner: string; spender: string; value: string; nonce: string; deadline: string; unlimited: boolean; tokenName: string }

export function permitView(td: TypedData): PermitView | null {
  if (td.primaryType !== "Permit") return null;
  const names = (td.types.Permit ?? []).map((f) => `${f.name}:${f.type}`).sort().join(",");
  if (names !== "deadline:uint256,nonce:uint256,owner:address,spender:address,value:uint256") return null;
  const m = td.message, vc = td.domain.verifyingContract;
  if (typeof vc !== "string" || !isAddress(vc) || typeof m.owner !== "string" || !isAddress(m.owner) || typeof m.spender !== "string" || !isAddress(m.spender)) return null;
  let value: bigint, nonce: bigint, deadline: bigint;
  try { value = BigInt(m.value as string); nonce = BigInt(m.nonce as string); deadline = BigInt(m.deadline as string); } catch { return null; }
  if (value < 0n || deadline < 0n) return null;
  return {
    token: getAddress(vc), owner: getAddress(m.owner), spender: getAddress(m.spender), value: value.toString(), nonce: nonce.toString(), deadline: deadline.toString(),
    unlimited: isUnlimited(value), tokenName: typeof td.domain.name === "string" ? td.domain.name.slice(0, 60) : "",
  };
}

export const MAX_TYPED_LINES = 300;
const DOMAIN_FIELDS: Record<string, string> = { name: "string", version: "string", chainId: "uint256", verifyingContract: "address", salt: "bytes32" };
const ATOMIC = /^(address|bool|string|bytes([1-9]|[12][0-9]|3[0-2])?|u?int(8|16|24|32|40|48|56|64|72|80|88|96|104|112|120|128|136|144|152|160|168|176|184|192|200|208|216|224|232|240|248|256)?)$/;
const bad = (why: string) => rpcError(ERR.invalidParams, `Typed data ${why}`);

function atomicText(type: string, v: unknown, path: string): string {
  if (type === "address") { if (typeof v !== "string" || !isAddress(v, { strict: false })) throw bad(`field ${path} is not an address`); return getAddress(v); }
  if (type === "bool") { if (typeof v !== "boolean") throw bad(`field ${path} is not a bool`); return String(v); }
  if (/^u?int/.test(type)) {

    if (typeof v === "number" ? !Number.isSafeInteger(v) : typeof v === "string" ? !/^(-?[0-9]{1,78}|0x[0-9a-fA-F]{1,64})$/.test(v) : typeof v !== "bigint") throw bad(`field ${path} is not a number`);
    let n: bigint;
    try { n = BigInt(v as string | number | bigint); } catch { throw bad(`field ${path} is not a number`); }

    const [, u, bits] = /^(u?)int(\d*)$/.exec(type)!;
    const size = BigInt(bits || "256");
    const [lo, hi] = u ? [0n, 2n ** size - 1n] : [-(2n ** (size - 1n)), 2n ** (size - 1n) - 1n];
    if (n < lo || n > hi) throw bad(`field ${path} is out of range for ${type}`);
    return n.toString();
  }
  if (typeof v !== "string") throw bad(`field ${path} must be text`);
  return v;
}

export function typedLines(types: Record<string, TypedField[]>, type: string, value: unknown, path = "", out: [string, string][] = [], depth = 0): [string, string][] {
  if (depth > 16) throw bad("is nested too deeply");
  const arr = /^(.+)\[(\d*)\]$/.exec(type);
  if (arr) {
    if (!Array.isArray(value) || (arr[2] !== "" && value.length !== Number(arr[2]))) throw bad(`field ${path} is not the expected list`);
    value.forEach((x, i) => typedLines(types, arr[1], x, `${path}[${i}]`, out, depth + 1));
    return out;
  }
  const struct = types[type];
  if (struct) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw bad(`field ${path || type} is not an object`);
    const names = new Set(struct.map((f) => f.name));
    for (const k of Object.keys(value)) if (!names.has(k)) throw bad(`has a field that is not in its types: ${(path ? `${path}.` : "") + k.slice(0, 60)}`);
    for (const f of struct) {
      const p = path ? `${path}.${f.name}` : f.name;
      if (!(f.name in (value as object)) || (value as Record<string, unknown>)[f.name] == null) throw bad(`is missing the field ${p}`);
      typedLines(types, f.type, (value as Record<string, unknown>)[f.name], p, out, depth + 1);
    }
    return out;
  }
  if (!ATOMIC.test(type)) throw bad(`uses an unknown type: ${type.slice(0, 60)}`);
  out.push([path, atomicText(type, value, path)]);
  if (out.length > MAX_TYPED_LINES) throw bad(`has more than ${MAX_TYPED_LINES} fields; it is too large to review`);
  return out;
}

export function domainLines(domain: Record<string, unknown>): [string, string][] {
  for (const k of Object.keys(domain)) if (!(k in DOMAIN_FIELDS)) throw bad(`domain has a field that is not signed: ${k.slice(0, 60)}`);
  return Object.keys(DOMAIN_FIELDS).filter((k) => domain[k] != null).map((k) => [k, atomicText(DOMAIN_FIELDS[k], domain[k], k)]);
}

export function typedReview(td: TypedData): { domain: [string, string][]; fields: [string, string][] } {

  if (td.primaryType === "EIP712Domain") throw bad("cannot use EIP712Domain as the primary type");
  for (const [name, fields] of Object.entries(td.types)) {
    if (name.endsWith("]")) throw bad(`type name ${name.slice(0, 60)} is invalid`);
    if (!Array.isArray(fields) || fields.some((f) => !f || typeof f.name !== "string" || typeof f.type !== "string")) throw bad(`type ${name.slice(0, 60)} is invalid`);
  }
  return { domain: domainLines(td.domain), fields: typedLines(td.types, td.primaryType, td.message) };
}

export const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
export interface Permit2Token { token: string; amount: string; unlimited: boolean; expiration: string | null }

export interface Permit2View { kind: "allowance" | "transfer"; tokens: Permit2Token[]; spender: string; deadline: string; nonce: string | null }

const shape = (td: TypedData, t: string) => (td.types[t] ?? []).map((f) => `${f.name}:${f.type}`).sort().join(",");
const P2_DETAILS = "amount:uint160,expiration:uint48,nonce:uint48,token:address", P2_PERM = "amount:uint256,token:address";

export function permit2View(td: TypedData): Permit2View | null {
  const vc = td.domain.verifyingContract;
  if (td.domain.name !== "Permit2" || typeof vc !== "string" || vc.toLowerCase() !== PERMIT2.toLowerCase()) return null;
  const m = td.message as Record<string, any>;
  const big = (x: unknown) => BigInt(x as string);
  try {
    const tok = (x: Record<string, unknown>, exp: unknown): Permit2Token => {
      if (typeof x.token !== "string" || !isAddress(x.token)) throw new Error("token");
      const amount = big(x.amount);
      return { token: getAddress(x.token), amount: amount.toString(), unlimited: isUnlimited(amount), expiration: exp == null ? null : big(exp).toString() };
    };
    if (typeof m.spender !== "string" || !isAddress(m.spender)) return null;
    const spender = getAddress(m.spender);
    switch (td.primaryType) {
      case "PermitSingle":
        if (shape(td, "PermitSingle") !== "details:PermitDetails,sigDeadline:uint256,spender:address" || shape(td, "PermitDetails") !== P2_DETAILS) return null;
        return { kind: "allowance", tokens: [tok(m.details, m.details.expiration)], spender, deadline: big(m.sigDeadline).toString(), nonce: big(m.details.nonce).toString() };
      case "PermitBatch":
        if (shape(td, "PermitBatch") !== "details:PermitDetails[],sigDeadline:uint256,spender:address" || shape(td, "PermitDetails") !== P2_DETAILS || !Array.isArray(m.details)) return null;
        return { kind: "allowance", tokens: m.details.map((d: Record<string, unknown>) => tok(d, d.expiration)), spender, deadline: big(m.sigDeadline).toString(), nonce: null };
      case "PermitTransferFrom":
        if (shape(td, "PermitTransferFrom") !== "deadline:uint256,nonce:uint256,permitted:TokenPermissions,spender:address" || shape(td, "TokenPermissions") !== P2_PERM) return null;
        return { kind: "transfer", tokens: [tok(m.permitted, null)], spender, deadline: big(m.deadline).toString(), nonce: big(m.nonce).toString() };
      case "PermitBatchTransferFrom":
        if (shape(td, "PermitBatchTransferFrom") !== "deadline:uint256,nonce:uint256,permitted:TokenPermissions[],spender:address" || shape(td, "TokenPermissions") !== P2_PERM || !Array.isArray(m.permitted)) return null;
        return { kind: "transfer", tokens: m.permitted.map((p: Record<string, unknown>) => tok(p, null)), spender, deadline: big(m.deadline).toString(), nonce: big(m.nonce).toString() };
    }
  } catch { return null; }
  return null;
}

export function typedForSigning(td: TypedData) {
  const { EIP712Domain: _drop, ...types } = td.types;
  return { domain: td.domain as Record<string, never>, types, primaryType: td.primaryType, message: td.message };
}

export function reviewAmount(raw: bigint, decimals: number): string {
  const s = formatUnits(raw, decimals);
  const [i, f = ""] = s.split(".");
  if (i.replace("-", "").length > 15) { const d = i.replace("-", ""); return `${i.startsWith("-") ? "-" : ""}${d[0]}.${d.slice(1, 4)}e${d.length - 1}`; }
  if (!f) return i;
  const room = 24 - i.length - 1;
  return room >= f.length ? s : room > 0 ? `${i}.${f.slice(0, room)}…` : `${i}…`;
}

const NAME_CLAIM = /^MADAR Names \(madar-network\.com\): claim the free name ([a-z0-9][a-z0-9-]{4,30}[a-z0-9])\.madar for this wallet\. Valid until (\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}) UTC\. No funds move\.$/;

export const NAME_CLAIM_MAX_AHEAD_MS = 4 * 86_400_000 + 2 * 60_000 + 10 * 60_000;
export interface NameClaim { text: string; name: string; until: string; untilMs: number }
export function parseNameClaim(params: unknown, now = Date.now()): NameClaim {
  const text = Array.isArray(params) && params.length === 1 ? params[0] : undefined;
  const m = typeof text === "string" && text.length <= 200 ? NAME_CLAIM.exec(text) : null;
  if (!m) throw rpcError(ERR.invalidParams, "madar_signNameClaim expects the free name claim text from madar-network.com");
  const [y, mo, d, h, mi] = [m[2], m[3], m[4], m[5], m[6]].map(Number);
  const untilMs = Date.UTC(y, mo - 1, d, h, mi);
  const back = new Date(untilMs);

  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d || back.getUTCHours() !== h || back.getUTCMinutes() !== mi)
    throw rpcError(ERR.invalidParams, "madar_signNameClaim: the date in the claim text is not valid");

  if (untilMs + 60_000 <= now) throw rpcError(ERR.invalidParams, "This free name claim has expired; reload the names page and try again");
  if (untilMs > now + NAME_CLAIM_MAX_AHEAD_MS) throw rpcError(ERR.invalidParams, "This free name claim is valid for too long; reload the names page and try again");
  return { text: m[0], name: m[1], until: `${m[2]}-${m[3]}-${m[4]} ${m[5]}:${m[6]}`, untilMs };
}

export function nameClaimHash(text: string): Hex {
  const body = new TextEncoder().encode(text);
  return keccak256(new Uint8Array([...new TextEncoder().encode(`\x19MADAR Name Claim:\n${body.length}`), ...body]));
}
