import { evmAddress } from "../core/account";
import { fetchPrices, publicClient, quoteContractTx, readTokenInfo, sendContractTx } from "../core/chainops";
import { simulateEvm } from "../core/simulate";
import { addressRisk, siteRisk } from "../core/phishing";
import { addActivity, getSettings, getSitePerms, hasVault, setSitePerm, unlockedPhrase } from "../core/store";
import { solAddress, solRpc } from "../core/sol";
import { btcAddress } from "../core/btcbase";
import { DOGE, LTC, utxoAddress } from "../core/utxobase";
import { xrpAddress } from "../core/xrpbase";
import { btcFees, formatBtc, quoteBtcSend, sendBtc, type BtcQuote } from "../core/btc";
import { thorInbound } from "./thordecode";
import { resolveName } from "../core/names";
import { ERR, isAllowedOrigin, PORT_NAME, rpcError, senderOrigin, toDappError, type DappReply } from "./protocol";
import { createRouter, type Answer, type ApprovalBody, type ApprovalView, type Ctx, type TokenLite } from "./router";

const session = chrome.storage.session;
const LOOKUP_TABLE_PROGRAM = "AddressLookupTab1e1111111111111111111111111";
const TOKEN_PROGRAMS = new Set(["spl-token", "spl-token-2022"]);

const addrCache = new Map<number, { evm: `0x${string}`; sol: string; btc: string; doge: string; ltc: string; xrp: string }>();
function addresses(phrase: string, index: number) {
  let a = addrCache.get(index);
  if (!a) { a = { evm: evmAddress(phrase, index), sol: solAddress(phrase, index), btc: btcAddress(phrase, index), doge: utxoAddress(DOGE, phrase, index), ltc: utxoAddress(LTC, phrase, index), xrp: xrpAddress(phrase, index) }; addrCache.set(index, a); }
  return a;
}

interface Waiter { view: ApprovalView; ctx: Ctx; resolve: (a: Answer) => void; reject: (e: Error) => void }
const waiting = new Map<string, Waiter>();
let approvalWindowId: number | null = null;
const publish = () => session.set({ dappQueue: [...waiting.values()].map((w) => w.view) });
void publish();

function finish(id: string, answer: Answer | null, err?: Error) {
  const w = waiting.get(id);
  if (!w) return;
  waiting.delete(id);
  void publish();
  if (err || !answer) w.reject(err ?? rpcError(ERR.rejected, "The user rejected the request")); else w.resolve(answer);
}

function enqueue(ctx: Ctx, body: ApprovalBody): Promise<Answer> {
  return new Promise<Answer>((resolve, reject) => {
    const id = crypto.randomUUID();
    waiting.set(id, { view: { ...body, id, origin: ctx.origin, at: Date.now() } as ApprovalView, ctx, resolve, reject });
    ctx.signal?.addEventListener("abort", () => finish(id, null, rpcError(ERR.rejected, "The request was cancelled because the page was closed")), { once: true });
    void publish().then(() => showUi(ctx)).catch(() => {});
  });
}

async function sidePanelOpen(windowId?: number): Promise<boolean> {
  try {
    const ctxs = await chrome.runtime.getContexts({ contextTypes: ["SIDE_PANEL" as chrome.runtime.ContextType] });
    return ctxs.some((c) => windowId == null || c.windowId === windowId);
  } catch { return false; }
}

async function showUi(ctx: Ctx) {
  if (await sidePanelOpen(ctx.windowId)) return;
  if (approvalWindowId != null) {
    try { await chrome.windows.update(approvalWindowId, { focused: true }); return; } catch { approvalWindowId = null; }
  }
  const width = 400, height = 660;
  let left: number | undefined, top: number | undefined;
  try {
    if (ctx.windowId != null) { const pw = await chrome.windows.get(ctx.windowId); if (pw.left != null && pw.width != null) { left = Math.max(0, pw.left + pw.width - width - 16); top = (pw.top ?? 0) + 72; } }
  } catch {  }
  const w = await chrome.windows.create({ url: chrome.runtime.getURL("index.html#approval"), type: "popup", width, height, left, top, focused: true });
  approvalWindowId = w?.id ?? null;
}

chrome.windows.onRemoved.addListener((id) => {
  if (id !== approvalWindowId) return;
  approvalWindowId = null;

  void (async () => { for (const w of [...waiting.values()]) if (!(await sidePanelOpen(w.ctx.windowId))) finish(w.view.id, null); })();
});

async function askUnlock(ctx: Ctx, method: string): Promise<void> {
  if (await unlockedPhrase()) return;
  const p = enqueue(ctx, { kind: "unlock", method });
  if (await unlockedPhrase()) resolveUnlocks();
  await p;
}
function resolveUnlocks() { for (const w of [...waiting.values()]) if (w.view.kind === "unlock") finish(w.view.id, {}); }

chrome.runtime.onMessage.addListener((m, sender, reply) => {
  if (!m || m.type !== "madar-approval") return;
  const extOrigin = chrome.runtime.getURL("").replace(/\/$/, "");
  if (sender.id !== chrome.runtime.id || senderOrigin(sender) !== extOrigin) return;
  if (typeof m.id === "string") finish(m.id, m.approve === true ? { confirmUnknown: m.confirmUnknown === true } : null);
  reply({ ok: true });
});

async function tokenInfo(n: Parameters<typeof readTokenInfo>[0], address: string, s: Awaited<ReturnType<typeof getSettings>>): Promise<TokenLite | null> {
  const a = address.toLowerCase();
  const v = n.tokens.find((t) => t.address.toLowerCase() === a);
  if (v) return { address: v.address, symbol: v.symbol, name: v.name, decimals: v.decimals, verified: true };
  const c = s.customTokens.find((t) => t.networkId === n.id && t.address.toLowerCase() === a);
  if (c) return { address: c.address, symbol: c.symbol, name: c.name, decimals: c.decimals, verified: false };
  try { const r = await readTokenInfo(n, address); return { address: r.address, symbol: r.symbol, name: r.name, decimals: r.decimals, verified: false }; } catch { return null; }
}

type ParsedAcc = { owner: string; data: { program?: string; parsed?: { type?: string; info?: Record<string, any> } } } | null;
const multiple = async (addrs: string[]) => (await solRpc<{ value: ParsedAcc[] }>("getMultipleAccounts", [addrs, { encoding: "jsonParsed", commitment: "confirmed" }])).value;

export const router = createRouter({
  hasVault,
  getSettings,
  getPerms: getSitePerms,
  setPerm: setSitePerm,
  phrase: unlockedPhrase,
  addresses,
  ask: enqueue,
  askUnlock,
  evmRpc: (n, method, params) => publicClient(n).request({ method, params } as never),
  evmQuote: quoteContractTx,
  evmSend: sendContractTx,
  tokenInfo,
  addrRisk: (chainId, address) => addressRisk(chainId, address),
  siteRisk: (origin) => siteRisk(origin),
  async simulate(n, from, tx, s) {
    const r = await simulateEvm(n, [{ from, to: tx.to, value: tx.value, data: tx.data === "0x" ? undefined : tx.data }]);
    if (r.status !== "ok") return { status: r.status, reason: r.status === "fail" ? r.reason : undefined, changes: null };
    if (!r.changes) return { status: "ok", changes: null };
    const changes = await Promise.all(r.changes.slice(0, 8).map(async (c) => {
      const info = c.token === "native" ? { symbol: n.native.symbol, decimals: n.chain.nativeCurrency.decimals, verified: true }
        : c.nft ? null : await tokenInfo(n, c.token, s).catch(() => null);
      return { token: c.token, delta: c.delta.toString(), nft: c.nft, symbol: info?.symbol ?? null, decimals: info?.decimals ?? null, verified: !!info?.verified };
    }));
    return { status: "ok", changes };
  },
  nameOwner: async (name) => { const h = await resolveName(`${name}.madar`); return h?.kind === "evm" ? h.address : null; },
  async solTables(tables) {
    const out: Record<string, string[]> = {};
    (await multiple(tables)).forEach((a, i) => { const ad = a?.data.parsed?.info?.addresses; if (a && a.owner === LOOKUP_TABLE_PROGRAM && Array.isArray(ad)) out[tables[i]] = ad; });
    return out;
  },
  async solTokenAccounts(addrs) {
    const out: Record<string, { owner: string; mint: string; decimals: number } | null> = {};
    (await multiple(addrs)).forEach((a, i) => {
      const inf = a?.data.parsed?.info;
      out[addrs[i]] = a && TOKEN_PROGRAMS.has(a.data.program ?? "") && a.data.parsed?.type === "account" && inf ? { owner: inf.owner, mint: inf.mint, decimals: inf.tokenAmount?.decimals } : null;
    });
    return out;
  },
  solSend: (wire, o) => solRpc<string>("sendTransaction", [wire, { encoding: "base64", skipPreflight: o.skipPreflight, preflightCommitment: "confirmed", maxRetries: 3 }]),
  addActivity,

  thorInbound: (chainId, coin) => thorInbound(chainId, coin, (url) => fetch(url, { credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store", signal: AbortSignal.timeout(10_000) })),

  async btcPrepare(phrase, index, to, sats) {
    const f = await btcFees();
    const q = await quoteBtcSend(phrase, index, to, formatBtc(sats), f.normal);
    return { to: q.to, amount: q.amount, fee: q.fee, feeRate: q.feeRate, quote: q };
  },
  btcBroadcast: (phrase, index, p) => sendBtc(phrase, index, p.quote as BtcQuote),
  btcPrice: async (cur) => (await fetchPrices(["bitcoin"], cur.toLowerCase() as "usd" | "sar"))["bitcoin"]?.price ?? null,
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== PORT_NAME) return;
  const s = port.sender;
  const origin = senderOrigin(s);

  if (!s || s.id !== chrome.runtime.id || !s.tab?.id || s.frameId !== 0 || !isAllowedOrigin(origin)) { port.disconnect(); return; }
  const ctrl = new AbortController();
  port.onDisconnect.addListener(() => ctrl.abort());
  let used = false;
  port.onMessage.addListener(async (m) => {
    if (used || !m || typeof m !== "object" || !("req" in m)) return;
    used = true;
    void addTab(s.tab!.id!, origin);
    let reply: DappReply;
    try { reply = { ok: true, result: await router.handle({ origin, tabId: s.tab!.id, windowId: s.tab!.windowId, signal: ctrl.signal }, m.req) }; }
    catch (e) { reply = { ok: false, error: toDappError(e) }; }
    try { port.postMessage({ reply }); } catch {  }
  });
});

interface DappTab { id: number; origin: string }
const dappTabs = async () => (((await session.get("dappTabs")).dappTabs as unknown[] | undefined) ?? [])
  .filter((x): x is DappTab => !!x && typeof x === "object" && typeof (x as DappTab).id === "number" && isAllowedOrigin((x as DappTab).origin));
async function addTab(id: number, origin: string) {
  const tabs = (await dappTabs()).filter((x) => x.id !== id);
  await session.set({ dappTabs: [...tabs, { id, origin }].slice(-50) });
}
async function broadcast() {
  const tabs = await dappTabs();
  if (!tabs.length) return;
  const states = new Map<string, Awaited<ReturnType<typeof router.state>>>();
  for (const o of new Set(tabs.map((x) => x.origin))) states.set(o, await router.state(o));
  const alive: DappTab[] = [];
  await Promise.all(tabs.map(async (x) => {
    try {
      const tab = await chrome.tabs.get(x.id);
      if (senderOrigin({ url: tab.url }) !== x.origin) return;
      await chrome.tabs.sendMessage(x.id, { type: "madar-state", origin: x.origin, state: states.get(x.origin) }, { frameId: 0 });
      alive.push(x);
    } catch {  }
  }));
  if (alive.length !== tabs.length) await session.set({ dappTabs: alive });
}
chrome.storage.onChanged.addListener((ch, area) => {
  if (area === "session" && "phrase" in ch) { addrCache.clear(); if (ch.phrase.newValue) resolveUnlocks(); void broadcast(); }
  if (area === "local" && ("settings" in ch || "sitePerms" in ch)) void broadcast();
});
