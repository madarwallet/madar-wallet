import "./bufferShim";
import { Buffer } from "buffer";
import { Address, beginCell, Cell, contractAddress } from "@ton/core";
import { ed25519 } from "@noble/curves/ed25519.js";
import { mnemonicToSeedSync } from "@scure/bip39";
import { hmac } from "@noble/hashes/hmac.js";
import { sha512 } from "@noble/hashes/sha2.js";
import { memoAddress, normalizePhrase } from "./account";
import { notImported } from "./imported";
import type { Token } from "./chains";

export const TON_USDT = "EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs";
const tv = (symbol: string, name: string, address: string, decimals: number, coingecko: string): Token =>
  ({ symbol, name, address: address as `0x${string}`, decimals, coingecko, verified: true });
export const TON = {
  id: "ton", name: "TON", symbol: "TON", coingecko: "the-open-network", explorer: "https://tonviewer.com", decimals: 9, cgPlatform: "the-open-network",
  tokens: [tv("USDT", "Tether USD", TON_USDT, 6, "tether")],
  defaultTokens: ["USDT"],
} as const;
export const tonTxUrl = (hash: string) => `${TON.explorer}/transaction/${hash}`;
export const TONCENTER = "https://toncenter.com/api/v2/jsonRPC";
export const TONAPI = "https://tonapi.io/v2";

export const WALLET_V4R2_CODE_B64 = "te6ccgECFAEAAtQAART/APSkE/S88sgLAQIBIAIDAgFIBAUE+PKDCNcYINMf0x/THwL4I7vyZO1E0NMf0x/T//QE0VFDuvKhUVG68qIF+QFUEGT5EPKj+AAkpMjLH1JAyx9SMMv/UhD0AMntVPgPAdMHIcAAn2xRkyDXSpbTB9QC+wDoMOAhwAHjACHAAuMAAcADkTDjDQOkyMsfEssfy/8QERITAubQAdDTAyFxsJJfBOAi10nBIJJfBOAC0x8hghBwbHVnvSKCEGRzdHK9sJJfBeAD+kAwIPpEAcjKB8v/ydDtRNCBAUDXIfQEMFyBAQj0Cm+hMbOSXwfgBdM/yCWCEHBsdWe6kjgw4w0DghBkc3RyupJfBuMNBgcCASAICQB4AfoA9AQw+CdvIjBQCqEhvvLgUIIQcGx1Z4MesXCAGFAEywUmzxZY+gIZ9ADLaRfLH1Jgyz8gyYBA+wAGAIpQBIEBCPRZMO1E0IEBQNcgyAHPFvQAye1UAXKwjiOCEGRzdHKDHrFwgBhQBcsFUAPPFiP6AhPLassfyz/JgED7AJJfA+ICASAKCwBZvSQrb2omhAgKBrkPoCGEcNQICEekk30pkQzmkD6f+YN4EoAbeBAUiYcVnzGEAgFYDA0AEbjJftRNDXCx+AA9sp37UTQgQFA1yH0BDACyMoHy//J0AGBAQj0Cm+hMYAIBIA4PABmtznaiaEAga5Drhf/AABmvHfaiaEAQa5DrhY/AAG7SB/oA1NQi+QAFyMoHFcv/ydB3dIAYyMsFywIizxZQBfoCFMtrEszMyXP7AMhAFIEBCPRR8qcCAHCBAQjXGPoA0z/IVCBHgQEI9FHyp4IQbm90ZXB0gBjIywXLAlAGzxZQBPoCFMtqEssfyz/Jc/sAAgBsgQEI1xj6ANM/MFIkgQEI9Fnyp4IQZHN0cnB0gBjIywXLAlAFzxZQA/oCE8tqyx8Syz/Jc/sAAAr0AMntVA==";
export const WALLET_ID = 698983191;

function slip10(seed: Uint8Array, path: number[]): Uint8Array {
  let I = hmac(sha512, new TextEncoder().encode("ed25519 seed"), seed);
  let k = I.slice(0, 32), c = I.slice(32);
  for (const idx of path) {
    const data = new Uint8Array(37);
    data.set(k, 1);
    new DataView(data.buffer).setUint32(33, (idx | 0x80000000) >>> 0);
    I = hmac(sha512, c, data);
    k = I.slice(0, 32); c = I.slice(32);
  }
  return k;
}

export function tonSecret(phrase: string, index = 0): Uint8Array {
  notImported(index);
  return slip10(mnemonicToSeedSync(normalizePhrase(phrase)), [44, 607, index]);
}

export function walletInit(publicKey: Uint8Array): { code: Cell; data: Cell } {
  const code = Cell.fromBoc(Buffer.from(WALLET_V4R2_CODE_B64, "base64"))[0];
  const data = beginCell().storeUint(0, 32).storeUint(WALLET_ID, 32).storeBuffer(Buffer.from(publicKey)).storeBit(0).endCell();
  return { code, data };
}
export const tonWallet = (publicKey: Uint8Array): Address => contractAddress(0, walletInit(publicKey));

export const tonAddress = (phrase: string, index = 0): string => memoAddress("ton", phrase, index, () =>
  tonWallet(ed25519.getPublicKey(tonSecret(phrase, index))).toString({ bounceable: false, urlSafe: true }));

export function parseTonAddress(s: string): Address | null {
  const v = s.trim();
  if (!v) return null;
  try { return Address.parse(v); } catch { return null; }
}
export const isTonAddress = (s: string) => parseTonAddress(s) != null;

export const sameTonAddress = (a: string, b: string) => { const x = parseTonAddress(a), y = parseTonAddress(b); return !!x && !!y && x.equals(y); };

let chain: Promise<unknown> = Promise.resolve();
let nextAt = 0;
const GAP_MS = 1100;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function queued<T>(f: () => Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    const wait = nextAt - Date.now();
    if (wait > 0) await sleep(wait);
    try { return await f(); } finally { nextAt = Date.now() + GAP_MS; }
  });
  chain = run.catch(() => {});
  return run;
}

export async function tcCall<T>(method: string, params: Record<string, unknown>): Promise<T> {
  for (let i = 0; i < 3; i++) {
    const r = await queued(() => fetch(TONCENTER, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), cache: "no-store", credentials: "omit", signal: AbortSignal.timeout(10_000) }));
    if (r.status === 429) { await sleep(1500); continue; }
    const j = await r.json().catch(() => null) as { ok?: boolean; result?: T; error?: string; code?: number } | null;
    if (!r.ok || !j?.ok) throw Object.assign(new Error(String(j?.error ?? `HTTP ${r.status}`)), { status: r.status, code: j?.code });
    return j.result as T;
  }
  throw Object.assign(new Error("busy"), { status: 429 });
}
async function tonapiGet<T>(path: string): Promise<T> {
  const r = await fetch(TONAPI + path, { cache: "no-store", credentials: "omit", signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { status: r.status });
  return r.json() as Promise<T>;
}

type StackItem = [string, unknown];
export const stackNum = (it: StackItem | undefined): bigint => { if (!it || it[0] !== "num") throw new Error("ERR_TON_STACK"); const s = String(it[1]); return s.startsWith("-") ? -BigInt(s.slice(1)) : BigInt(s); };
export const stackCell = (it: StackItem | undefined): Cell => {
  const b = (it?.[1] as { bytes?: string } | undefined)?.bytes;
  if (!it || (it[0] !== "cell" && it[0] !== "slice") || typeof b !== "string") throw new Error("ERR_TON_STACK");
  return Cell.fromBoc(Buffer.from(b, "base64"))[0];
};
export async function runGet(address: string, method: string, stack: unknown[] = []): Promise<StackItem[]> {
  const r = await tcCall<{ exit_code: number; stack: StackItem[] }>("runGetMethod", { address, method, stack });
  if (r.exit_code !== 0 && r.exit_code !== 1) throw Object.assign(new Error("ERR_TON_GET"), { exit: r.exit_code });
  return r.stack;
}

export async function jettonWalletOf(master: string, owner: string): Promise<Address> {
  const ownerSlice = beginCell().storeAddress(Address.parse(owner)).endCell().toBoc().toString("base64");
  const st = await runGet(master, "get_wallet_address", [["tvm.Slice", ownerSlice]]);
  return stackCell(st[0]).beginParse().loadAddress();
}

export async function jettonWalletChecked(master: string, owner: string): Promise<Address> {
  const a = await jettonWalletOf(master, owner);
  let b: Address | null = null;
  try {
    const r = await fetch(`${TONAPI}/accounts/${encodeURIComponent(owner)}/jettons/${encodeURIComponent(master)}`, { signal: AbortSignal.timeout(10_000), credentials: "omit", referrerPolicy: "no-referrer" });
    if (r.ok) b = parseTonAddress(String(((await r.json()) as { wallet_address?: { address?: string } })?.wallet_address?.address ?? ""));
  } catch {  }
  if (b && !b.equals(a)) throw new Error("ERR_TON_JETTON");
  return a;
}

export async function tonBalances(address: string): Promise<{ nano: bigint; usdt: bigint; active: boolean }> {
  const info = await tcCall<{ balance: string | number; state: string }>("getAddressInformation", { address }).catch(async () => {
    const a = await tonapiGet<{ balance: number; status: string }>(`/accounts/${encodeURIComponent(address)}`);
    return { balance: a.balance, state: a.status };
  });
  let usdt = 0n;
  try {
    const jw = await jettonWalletOf(TON_USDT, address);
    const st = await runGet(jw.toString(), "get_wallet_data").catch((e) => { if ((e as { exit?: number }).exit != null) return null; throw e; });
    usdt = st ? stackNum(st[0]) : 0n;
  } catch {
    const j = await tonapiGet<{ balance?: string }>(`/accounts/${encodeURIComponent(address)}/jettons/${TON_USDT}`).catch(() => null);
    usdt = j?.balance ? BigInt(j.balance) : 0n;
  }
  return { nano: BigInt(String(info.balance)), usdt, active: info.state === "active" };
}

export async function tonSeqno(address: string): Promise<number> {
  const info = await tcCall<{ state: string }>("getAddressInformation", { address });
  if (info.state !== "active") return 0;
  return Number(stackNum((await runGet(address, "seqno"))[0]));
}
