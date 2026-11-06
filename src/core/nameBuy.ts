import { evmAccount } from "./account";
import { networkById, type Token } from "./chains";
import { SOL } from "./solbase";

const API = "https://madarwallet.app/api/ops-pro/v1";
const TIMEOUT = 20_000;
export const NAME_RECEIVER_EVM = "0xb95c91Bb8C58b929d501BD8D0aCcB420F8A7045d";
export const NAME_RECEIVER_SOL = "BxMsjB6DM2cZV2vhzPQBETJnBh257ewnvkT61CoZpEMt";

export const NAME_RAILS: readonly { id: string; netId: string; symbol: "USDC" | "USDT"; token: string }[] = [
  { id: "base_usdc", netId: "base", symbol: "USDC", token: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" },
  { id: "arbitrum_usdc", netId: "arbitrum", symbol: "USDC", token: "0xaf88d065e77c8cc2239327c5edb3a432268e5831" },
  { id: "arbitrum_usdt", netId: "arbitrum", symbol: "USDT", token: "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9" },
  { id: "solana_usdc", netId: "solana", symbol: "USDC", token: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" },
  { id: "solana_usdt", netId: "solana", symbol: "USDT", token: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB" },
  { id: "polygon_usdc", netId: "polygon", symbol: "USDC", token: "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359" },
  { id: "polygon_usdt", netId: "polygon", symbol: "USDT", token: "0xc2132d05d31c914a87c6611c10748aeb04b58e8f" },
  { id: "optimism_usdc", netId: "optimism", symbol: "USDC", token: "0x0b2c639c533813f4aa9d7837caf62653d097ff85" },
  { id: "optimism_usdt", netId: "optimism", symbol: "USDT", token: "0x94b008aa00579c1307b0ef2c499ad98a8ce58e58" },
  { id: "bsc_usdc", netId: "bsc", symbol: "USDC", token: "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d" },
  { id: "bsc_usdt", netId: "bsc", symbol: "USDT", token: "0x55d398326f99059ff775485246999027b3197955" },
  { id: "ethereum_usdc", netId: "ethereum", symbol: "USDC", token: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" },
  { id: "ethereum_usdt", netId: "ethereum", symbol: "USDT", token: "0xdac17f958d2ee523a2206206994597c13d831ec7" },
];

export function railToken(railId: string): Token | null {
  const r = NAME_RAILS.find((x) => x.id === railId);
  if (!r) return null;
  const list = r.netId === SOL.id ? SOL.tokens : networkById(r.netId)?.tokens ?? [];
  return (list.find((t) => (r.netId === SOL.id ? t.address === r.token : t.address.toLowerCase() === r.token)) as Token | undefined) ?? null;
}

const post = async (path: string, body: unknown) => {

  const r = await fetch(API + path, { method: "POST", headers: { "Content-Type": "text/plain;charset=UTF-8" }, body: JSON.stringify(body), credentials: "omit", referrerPolicy: "no-referrer", signal: AbortSignal.timeout(TIMEOUT) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(String(j?.error || `HTTP ${r.status}`));
  return j;
};

export interface NameInvoice { railId: string; amount: string; payTo: string; token: Token; expires: number }
export interface NameOrder { key: string; name: string; usd: number; invoice: NameInvoice }

export function checkInvoice(inv: any, railId: string, usd: number): NameInvoice {
  const r = NAME_RAILS.find((x) => x.id === railId), token = railToken(railId);
  if (!r || !token || !inv || inv.rail !== railId || inv.void || inv.paid) throw new Error("ERR_UNSAFE");
  const to = String(inv.pay_to ?? "");
  const okTo = r.netId === SOL.id ? to === NAME_RECEIVER_SOL : to.toLowerCase() === NAME_RECEIVER_EVM.toLowerCase();
  const okToken = r.netId === SOL.id ? inv.token === r.token : String(inv.token ?? "").toLowerCase() === r.token;
  const amount = String(inv.amount ?? "");
  if (!okTo || !okToken || !/^\d{1,9}(\.\d{1,6})?$/.test(amount)) throw new Error("ERR_UNSAFE");
  const [i, f = ""] = amount.split(".");
  const micro = BigInt(i) * 1_000_000n + BigInt(f.padEnd(6, "0"));
  const price = BigInt(Math.round(usd)) * 1_000_000n;
  if (!(Number.isSafeInteger(usd) && usd > 0) || micro < price || micro >= price + 100_000n) throw new Error("ERR_UNSAFE");
  return { railId, amount, payTo: to, token, expires: Number(inv.expires) || 0 };
}

export async function orderName(phrase: string, index: number, name: string, railId: string, usd: number, signRegister: (phrase: string, index: number, name: string) => Promise<{ proof: unknown }>): Promise<NameOrder> {
  const { proof } = await signRegister(phrase, index, name);
  const j = await post("/names/order-wallet", { name, proof, rail: railId });
  if (typeof j.key !== "string" || !/^mnk_[A-Za-z0-9_-]{10,80}$/.test(j.key)) throw new Error("try_again");
  const inv = (j.subscription?.invoices ?? []).find((x: any) => x.rail === railId);
  return { key: j.key, name: `${name}.madar`, usd, invoice: checkInvoice(inv, railId, usd) };
}

export type OrderState = "waiting" | "paid" | "written" | "void";

export async function orderStatus(key: string): Promise<OrderState> {
  const j = await post("/names/order-status", { key });
  const s = j.subscription ?? {};
  if ((Number(s.on_chain_until_ms) || 0) > Date.now() || s.chain_tx) return "written";
  const invs: any[] = s.invoices ?? [];
  if (invs.some((i) => i.paid)) return "paid";
  if (invs.length && invs.every((i) => i.void)) return "void";
  return "waiting";
}

const OKEY = "nameOrders";
export interface SavedOrder { key: string; name: string; at: number; paidTx?: string; state?: OrderState }
export async function savedOrders(): Promise<SavedOrder[]> {
  const v = (await chrome.storage.local.get(OKEY))[OKEY];
  return Array.isArray(v) ? (v as SavedOrder[]).filter((o) => o && typeof o.key === "string" && typeof o.name === "string") : [];
}
export async function saveOrder(o: SavedOrder): Promise<void> {
  const all = (await savedOrders()).filter((x) => x.key !== o.key);
  await chrome.storage.local.set({ [OKEY]: [o, ...all].slice(0, 10) });
}
export const evmOf = (phrase: string, index: number) => evmAccount(phrase, index).address;
