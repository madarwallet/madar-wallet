import { createPublicClient, createWalletClient, encodeFunctionData, erc20Abi, fallback, formatUnits, http, isAddress, type Address, type Hash, type Hex } from "viem";
import { guardEvm } from "./simulate";
import { gasSpeed, levelsFrom, type Eip1559, type GasSpeed } from "./gaslevels";
import { cleanTokenText, parseUnitsStr } from "./solbase";
import { demoEvmNative, demoEvmToken, demoOn } from "./demo";
import { evmAccount, evmAddress } from "./account";
import type { Network, Token } from "./chains";
import { cgGet } from "./coingecko";
import { readSnap, writeSnap } from "./snap";

const transport = (n: Network) => fallback(n.rpcs.map((u) => http(u, { timeout: 8_000 })), { rank: false, retryCount: 1 });
const clients = new Map<string, ReturnType<typeof createPublicClient>>();
export function publicClient(n: Network) {
  let c = clients.get(n.id);
  if (!c) {
    c = createPublicClient({ chain: n.chain, transport: transport(n), batch: { multicall: true } });
    clients.set(n.id, c);
  }
  return c;
}

export interface AssetBalance {
  key: string;
  symbol: string;
  name: string;
  verified: boolean;
  amount: string;
  raw: bigint;
  decimals: number;
  value: number | null;
  change24h: number | null;
}

export type Prices = Record<string, { price: number; change: number }>;

const CG_CACHE = new Map<string, { at: number; data: Record<string, Record<string, number>> }>();
async function cg(path: string): Promise<Record<string, Record<string, number>> | null> {
  const hit = CG_CACHE.get(path);

  const ttl = path.startsWith("simple/token_price/") ? 300_000 : 60_000;
  if (hit && Date.now() - hit.at < ttl) return hit.data;
  try {
    const data = (await cgGet(path)) as Record<string, Record<string, number>>;
    if (!data || typeof data !== "object") return hit?.data ?? null;
    CG_CACHE.set(path, { at: Date.now(), data });
    return data;
  } catch {
    return hit?.data ?? null;
  }
}

const priceSnapKey = (currency: string) => `prices:${currency}`;

export async function cachedPrices(currency: "usd" | "sar"): Promise<Prices> {
  return (await readSnap<Prices>(priceSnapKey(currency)))?.v ?? {};
}
let priceSave: Promise<void> = Promise.resolve();
function rememberPrices(currency: string, fresh: Prices) {
  if (!Object.keys(fresh).length) return;
  priceSave = priceSave.then(async () => {
    const old = (await readSnap<Prices>(priceSnapKey(currency)))?.v ?? {};
    const merged = { ...old, ...fresh };
    const keys = Object.keys(merged);
    for (const k of keys.slice(0, Math.max(0, keys.length - 400))) delete merged[k];
    await writeSnap(priceSnapKey(currency), merged);
  }).catch(() => {});
}

export async function fetchPrices(ids: string[], currency: "usd" | "sar", custom: { platform: string; address: string }[] = []): Promise<Prices> {
  const out: Prices = {};
  const put = (key: string, v: Record<string, number>) => {
    const p = v?.[currency], c = v?.[`${currency}_24h_change`];
    if (typeof p === "number" && Number.isFinite(p)) out[key] = { price: p, change: typeof c === "number" && Number.isFinite(c) ? c : 0 };
  };
  const uniq = [...new Set(ids)].filter((x) => /^[a-z0-9-]+$/.test(x));
  const jobs: Promise<void>[] = [];
  if (uniq.length) jobs.push(cg(`simple/price?ids=${uniq.join(",")}&vs_currencies=${currency}&include_24hr_change=true`).then((raw) => { for (const [id, v] of Object.entries(raw ?? {})) put(id, v); }));

  const tokenJobs = new Map<string, { platform: string; address: string }>();
  for (const c of custom) {
    if (!/^[a-z0-9-]+$/.test(c.platform) || !/^[0-9A-Za-z]{32,44}$/.test(c.address)) continue;
    const address = c.platform === "solana" ? c.address : c.address.toLowerCase();
    tokenJobs.set(`${c.platform}:${c.address.toLowerCase()}`, { platform: c.platform, address });
  }
  for (const [key, { platform, address }] of tokenJobs)
    jobs.push(cg(`simple/token_price/${platform}?contract_addresses=${address}&vs_currencies=${currency}&include_24hr_change=true`).then((raw) => {
      for (const [a, v] of Object.entries(raw ?? {})) if (a.toLowerCase() === address.toLowerCase()) put(key, v);
    }));
  await Promise.all(jobs);
  rememberPrices(currency, out);
  const want = [...uniq, ...tokenJobs.keys()];
  if (want.some((k) => !out[k])) { const saved = await cachedPrices(currency); for (const k of want) if (!out[k] && saved[k]) out[k] = saved[k]; }
  return out;
}

export async function balances(n: Network, owner: Address, tokens: Token[], prices: Prices): Promise<AssetBalance[]> {
  const c = publicClient(n);
  const [nativeRaw, ...tokRaw] = import.meta.env.DEV && demoOn() ? [demoEvmNative(n.chain.id, n.chain.nativeCurrency.decimals), ...tokens.map((tk) => demoEvmToken(n.chain.id, tk.symbol, tk.decimals))] : await Promise.all([
    c.getBalance({ address: owner }),
    ...tokens.map((tk) => c.readContract({ address: tk.address, abi: erc20Abi, functionName: "balanceOf", args: [owner] }).catch(() => null)),
  ]);
  const priceOf = (tk: Token) => (tk.coingecko ? prices[tk.coingecko] : prices[`${n.cgPlatform}:${tk.address.toLowerCase()}`]);
  const np = prices[n.native.coingecko];
  const nativeAmt = formatUnits(nativeRaw, n.chain.nativeCurrency.decimals);
  const list: AssetBalance[] = [
    { key: "native", symbol: n.native.symbol, name: n.native.name, verified: true, amount: nativeAmt, raw: nativeRaw, decimals: n.chain.nativeCurrency.decimals, value: nativeRaw === 0n ? 0 : np ? Number(nativeAmt) * np.price : null, change24h: np ? np.change : null },
  ];
  tokens.forEach((tk, i) => {
    const raw = tokRaw[i] as bigint | null;
    if (raw == null) return;
    const amount = formatUnits(raw, tk.decimals), p = priceOf(tk);
    list.push({ key: tk.address.toLowerCase(), symbol: tk.symbol, name: tk.name, verified: tk.verified, amount, raw, decimals: tk.decimals, value: raw === 0n ? 0 : p ? Number(amount) * p.price : null, change24h: p ? p.change : null });
  });
  return list;
}

export async function readTokenInfo(n: Network, address: string): Promise<Omit<Token, "verified" | "coingecko">> {
  if (!isAddress(address)) throw new Error("bad address");
  const c = publicClient(n);
  const [symbol, name, decimals] = await Promise.all([
    c.readContract({ address, abi: erc20Abi, functionName: "symbol" }),
    c.readContract({ address, abi: erc20Abi, functionName: "name" }).catch(() => ""),
    c.readContract({ address, abi: erc20Abi, functionName: "decimals" }),
  ]);
  const clean = cleanTokenText;
  if (decimals > 36) throw new Error("bad decimals");
  return { address, symbol: clean(symbol, 12) || "?", name: clean(name, 40), decimals };
}

export type SendAsset = { kind: "native" } | { kind: "token"; token: Token };

export interface SendRequest {
  network: Network;
  phrase: string;
  accountIndex: number;
  asset: SendAsset;
  to: string;
  amount: string;
}

export interface SendQuote {
  to: Address;
  value: bigint;
  feeNative: bigint;
  gas: bigint;
  fees: GasFees;
}

export type GasFees = { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint; gasPrice?: undefined } | { gasPrice: bigint; maxFeePerGas?: undefined; maxPriorityFeePerGas?: undefined };
const GWEI = 1_000_000_000n;

export const PRIORITY_CAP: Record<string, bigint> = { polygon: 2_000n * GWEI };
export const DEFAULT_PRIORITY_CAP = 20n * GWEI;

export const FEE_RISE_LIMIT = 2n;

export const perGas = (f: GasFees): bigint => f.gasPrice ?? f.maxFeePerGas;
export const feeFields = (f: GasFees) => (f.gasPrice != null ? { gasPrice: f.gasPrice } : { maxFeePerGas: f.maxFeePerGas, maxPriorityFeePerGas: f.maxPriorityFeePerGas });

export function capPriority(netId: string, f: GasFees): GasFees {
  if (f.gasPrice != null) return f;
  const cap = PRIORITY_CAP[netId] ?? DEFAULT_PRIORITY_CAP;
  let tip = f.maxPriorityFeePerGas < 0n ? 0n : f.maxPriorityFeePerGas;
  const max = tip > cap ? f.maxFeePerGas - (tip - cap) : f.maxFeePerGas;
  if (tip > cap) tip = cap;
  return { maxFeePerGas: max, maxPriorityFeePerGas: tip > max ? max : tip };
}

export function checkFeeRise(reviewed: GasFees, fresh: GasFees): void {
  if (perGas(fresh) > FEE_RISE_LIMIT * perGas(reviewed)) throw new Error("ERR_FEE_HIGH");
}

export async function gasFees(n: Network, deadline = false): Promise<GasFees> {
  const chosen = gasSpeed(), s = deadline && chosen === "slow" ? "normal" : chosen;
  return s === "normal" ? normalFees(n) : (await gasFeeLevels(n))[s];
}
async function normalFees(n: Network): Promise<GasFees> {
  const f = await publicClient(n).estimateFeesPerGas().catch(() => null);
  return feesFromEstimate(n.id, f);
}

export async function gasFeeLevels(n: Network): Promise<Record<GasSpeed, GasFees>> {
  const c = publicClient(n);
  const [normal, h] = await Promise.all([normalFees(n), c.getFeeHistory({ blockCount: 10, rewardPercentiles: [10, 50, 90] }).catch(() => null)]);
  if (normal.gasPrice != null) return { slow: normal, normal, fast: normal };
  const bases = h?.baseFeePerGas ?? [];
  const lv = levelsFrom(bases.length ? bases[bases.length - 1] : null, h?.reward ?? [], normal);
  const fit = (f: Eip1559): GasFees => { const x = capPriority(n.id, f); checkFeeSane(n.id, x); return x; };
  return { slow: fit(lv.slow), normal, fast: fit(lv.fast) };
}

export function feesFromEstimate(netId: string, f: { maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint; gasPrice?: bigint } | null): GasFees {
  if (f?.maxFeePerGas == null) throw new Error("ERR_FEE_UNKNOWN");
  const fees = capPriority(netId, { maxFeePerGas: f.maxFeePerGas, maxPriorityFeePerGas: f.maxPriorityFeePerGas ?? 0n });
  checkFeeSane(netId, fees);
  return fees;
}

export const MAX_GAS_PRICE: Record<string, bigint> = { polygon: 10_000n * GWEI };
export const DEFAULT_MAX_GAS_PRICE = 1_000n * GWEI;
export function checkFeeSane(netId: string, f: GasFees): void {
  if (perGas(f) > (MAX_GAS_PRICE[netId] ?? DEFAULT_MAX_GAS_PRICE)) throw new Error("ERR_FEE_HIGH");
}

export function feeShort(native: boolean, bal: bigint, value: bigint, fee: bigint): "ERR_FUNDS" | "ERR_GAS" | null {
  if (native) return bal < value ? "ERR_FUNDS" : bal < value + fee ? "ERR_GAS" : null;
  return bal < fee ? "ERR_GAS" : null;
}

export async function quoteSend(r: SendRequest): Promise<SendQuote> {
  if (!isAddress(r.to)) throw new Error("ERR_ADDRESS");
  const decimals = r.asset.kind === "native" ? r.network.chain.nativeCurrency.decimals : r.asset.token.decimals;

  const value = parseUnitsStr(r.amount, decimals);
  if (value <= 0n) throw new Error("ERR_ZERO");
  const c = publicClient(r.network);
  const from = evmAddress(r.phrase, r.accountIndex);
  const [est, fees] = await Promise.all([
    r.asset.kind === "native"
      ? c.estimateGas({ account: from, to: r.to, value })
      : c.estimateContractGas({ account: from, address: r.asset.token.address, abi: erc20Abi, functionName: "transfer", args: [r.to, value] }),
    gasFees(r.network),
  ]);
  const gas = (est * 12n) / 10n;
  const feeNative = gas * perGas(fees);

  const bal = await c.getBalance({ address: from });
  const short = feeShort(r.asset.kind === "native", bal, value, feeNative);
  if (short === "ERR_FUNDS") throw new Error(short);
  if (short === "ERR_GAS") throw Object.assign(new Error(short), { need: feeNative + (r.asset.kind === "native" ? value : 0n), have: bal, fee: feeNative });
  return { to: r.to, value, gas, fees, feeNative };
}

export async function send(r: SendRequest, q: SendQuote): Promise<Hash> {
  checkFeeRise(q.fees, await gasFees(r.network));
  const account = evmAccount(r.phrase, r.accountIndex);
  const w = createWalletClient({ account, chain: r.network.chain, transport: transport(r.network) });
  const fee = { gas: q.gas, ...feeFields(q.fees) };

  const from = account.address;
  await guardEvm(r.network, [r.asset.kind === "native" ? { from, to: q.to, value: q.value }
    : { from, to: r.asset.token.address, data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [q.to, q.value] }) }]);
  if (r.asset.kind === "native") return w.sendTransaction({ to: q.to, value: q.value, ...fee } as never);
  return w.writeContract({ address: r.asset.token.address, abi: erc20Abi, functionName: "transfer", args: [q.to, q.value], ...fee } as never);
}

export async function evmSpendable(n: Network, phrase: string, index: number, asset: SendAsset, gasUnits = 21_000n): Promise<bigint> {
  const c = publicClient(n);
  const me = evmAddress(phrase, index);
  if (asset.kind === "token") return (await c.readContract({ address: asset.token.address, abi: erc20Abi, functionName: "balanceOf", args: [me] })) as bigint;
  const [bal, fees] = await Promise.all([c.getBalance({ address: me }), c.estimateFeesPerGas().catch(async () => ({ maxFeePerGas: undefined, gasPrice: await c.getGasPrice() }))]);
  const perGas = fees.maxFeePerGas ?? fees.gasPrice ?? 0n;

  const l2Floor = ["base", "optimism", "arbitrum", "unichain", "blast", "scroll", "opbnb", "mantle"].includes(n.id) ? 20_000_000_000_000n : 0n;
  const left = bal - (gasUnits * perGas * 2n + l2Floor);
  return left > 0n ? left : 0n;
}

export interface ContractTx { to: Address; value: bigint; data: Hex; gas?: bigint }

export async function quoteContractTx(n: Network, from: Address, tx: ContractTx): Promise<{ gas: bigint; feeNative: bigint; fees: GasFees }> {
  const c = publicClient(n);
  const [gas, fees] = await Promise.all([
    tx.gas != null ? Promise.resolve(tx.gas) : c.estimateGas({ account: from, to: tx.to, value: tx.value, data: tx.data === "0x" ? undefined : tx.data }).then((g) => (g * 12n) / 10n),
    gasFees(n),
  ]);
  return { gas, fees, feeNative: gas * perGas(fees) };
}

export async function sendContractTx(n: Network, phrase: string, index: number, tx: ContractTx & { gas: bigint; fees?: GasFees }): Promise<Hash> {
  if (tx.fees) checkFeeRise(tx.fees, await gasFees(n));
  const account = evmAccount(phrase, index);

  await guardEvm(n, [{ from: account.address, to: tx.to, data: tx.data === "0x" ? undefined : tx.data, value: tx.value }]);
  const w = createWalletClient({ account, chain: n.chain, transport: transport(n) });
  return w.sendTransaction({ to: tx.to, value: tx.value, data: tx.data === "0x" ? undefined : tx.data, gas: tx.gas, ...(tx.fees ? feeFields(tx.fees) : {}) } as never);
}
