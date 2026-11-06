type Listener = (changes: Record<string, { oldValue?: unknown; newValue?: unknown }>, area: string) => void;
const listeners: Listener[] = [];
function area(name: string) {
  const data: Record<string, unknown> = {};
  const emit = (changes: Record<string, { oldValue?: unknown; newValue?: unknown }>) => listeners.forEach((l) => l(changes, name));
  return {
    async get(k: string | string[]) { return Object.fromEntries((Array.isArray(k) ? k : [k]).filter((x) => x in data).map((x) => [x, data[x]])); },
    async set(o: Record<string, unknown>) { const c: Record<string, { newValue: unknown }> = {}; for (const [k, v] of Object.entries(o)) { data[k] = v; c[k] = { newValue: v }; } emit(c); },
    async remove(k: string | string[]) { const ks = Array.isArray(k) ? k : [k]; for (const x of ks) delete data[x]; emit(Object.fromEntries(ks.map((x) => [x, {}]))); },
    async clear() { const c: Record<string, object> = {}; for (const k of Object.keys(data)) { delete data[k]; c[k] = {}; } emit(c); },
    async setAccessLevel() {},
  };
}
if (!(globalThis as { chrome?: { storage?: unknown } }).chrome?.storage) {
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: { local: area("local"), session: area("session"), onChanged: { addListener: (l: Listener) => listeners.push(l), removeListener: () => {} } },
    alarms: { create: async () => {}, clear: async () => true, onAlarm: { addListener: () => {} } },
    tabs: { create: () => {} },
    runtime: { getURL: (p: string) => p, ...devUpdate() },
  };
}

function devUpdate() {
  const subs: ((d: { version: string }) => void)[] = [];
  const on = new URLSearchParams(location.search).get("upd") === "1";
  return {
    getManifest: () => ({ version: "0.1.39" }),
    onUpdateAvailable: { addListener: (f: (d: { version: string }) => void) => void subs.push(f) },
    requestUpdateCheck: async () => {
      if (!on) return { status: "no_update" };
      setTimeout(() => subs.forEach((f) => f({ version: "0.1.40" })), 1500);
      return { status: "update_available", version: "0.1.40" };
    },
    reload: () => location.reload(),
  };
}
export {};

if (location.hash.startsWith("#demo")) {
  const tab = location.hash.slice(6) || "assets";
  (globalThis as { __DEMO_TAB__?: string }).__DEMO_TAB__ = tab === "approvals" ? "settings" : tab === "history" ? "assets" : tab === "coin" || tab === "coinusdc" || tab.startsWith("coin-") || tab === "freename" || tab === "newtoken" ? "assets" : tab;

  if (tab === "coin") (globalThis as { __DEMO_COIN__?: unknown }).__DEMO_COIN__ = { symbol: "ETH", name: "Ether", verified: true, cg: "ethereum", parts: [
    { networkId: "ethereum", networkName: "Ethereum", key: "native", amount: 0.25, decimals: 18 }, { networkId: "base", networkName: "Base", key: "native", amount: 0.04, decimals: 18 }] };
  if (tab === "coinusdc") (globalThis as { __DEMO_COIN__?: unknown }).__DEMO_COIN__ = { symbol: "USDC", name: "USD Coin", verified: true, cg: "usd-coin", parts: [
    { networkId: "base", networkName: "Base", key: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", amount: 300, decimals: 6, contract: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" }] };

  const one: Record<string, [string, string, string, string, number, number]> = { "coin-xrp": ["XRP", "XRP", "ripple", "xrp", 86.4, 6], "coin-btc": ["BTC", "Bitcoin", "bitcoin", "bitcoin", 0.008, 8],
    "coin-doge": ["DOGE", "Dogecoin", "dogecoin", "dogecoin", 1520, 8], "coin-ada": ["ADA", "Cardano", "cardano", "cardano", 412.5, 6], "coin-ton": ["TON", "Toncoin", "the-open-network", "ton", 7, 9], "coin-ltc0": ["LTC", "Litecoin", "litecoin", "litecoin", 0, 8],
    "coin-trx": ["TRX", "Tron", "tron", "tron", 42.5, 6], "coin-trx0": ["TRX", "Tron", "tron", "tron", 0, 6] };
  const NET_NAME: Record<string, string> = { xrp: "XRP Ledger", bitcoin: "Bitcoin", dogecoin: "Dogecoin", cardano: "Cardano", ton: "TON", litecoin: "Litecoin", tron: "Tron" };
  if (one[tab]) { const [symbol, name, cg, networkId, amount, decimals] = one[tab]; (globalThis as { __DEMO_COIN__?: unknown }).__DEMO_COIN__ = { symbol, name, verified: true, cg, parts: [{ networkId, networkName: NET_NAME[networkId] ?? networkId, key: "native", amount, decimals }] }; }

  if (tab === "freename") (globalThis as { __DEMO_FREENAME__?: boolean }).__DEMO_FREENAME__ = true;

  if (tab === "newtoken") (globalThis as { __DEMO_DETECT__?: unknown }).__DEMO_DETECT__ = [
    { networkId: "polygon", address: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174", symbol: "USDC.e", name: "USD Coin (bridged)", decimals: 6, raw: "125500000", verified: true, price: 0.9997 },
    { networkId: "solana", address: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", symbol: "Bonk", name: "Bonk", decimals: 5, raw: "150000000000", verified: false, price: 0.0000182 },
  ];
  (globalThis as { __DEMO_BAL__?: boolean }).__DEMO_BAL__ = true;
  (globalThis as { __DEMO_READY__?: Promise<void> }).__DEMO_READY__ = (async () => {
    const { createVault, saveSettings } = await import("../core/store");
    await createVault("test test test test test test test test test test test junk", "dev-preview-only-1");
    const q = new URLSearchParams(location.search);

    const on = [...(q.get("nets") ?? "").split(","), q.get("net") ?? ""].filter(Boolean);
    await saveSettings({ networkId: q.get("net") || (tab === "swap" ? "solana" : tab === "tokens" || tab === "receive" || tab === "send" ? "base" : "all"), lang: (q.get("lang") as "ar" | "en") || "ar", theme: q.get("theme") === "light" ? "light" : "dark", ...(on.length ? { networksOn: on } : {}) });

    (globalThis as { __DEMO_NAME__?: string | null }).__DEMO_NAME__ = q.get("name") ? `${q.get("name")}.madar` : null;

    if (tab === "history") {
      const me = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", dep = "0x3390000000000000000000000000000000c0da41", t0 = Date.now() - 30 * 60_000;
      const pay = "0x" + "a1".repeat(32), back = "0x" + "b2".repeat(32), ada = "c3".repeat(32);
      await chrome.storage.local.set({
        [`history:${me.toLowerCase()}`]: { at: Date.now(), items: [
          { id: `arbitrum:${pay}`, hash: pay, at: t0, networkId: "arbitrum", kind: "out", sent: [{ symbol: "USDC", amount: "39.429337", price: "usd-coin" }], got: [], party: dep },
          { id: `cardano:${ada}`, hash: ada, at: t0 + 60_000, networkId: "cardano", kind: "in", sent: [], got: [{ symbol: "ADA", amount: "202.645226", price: "cardano" }], party: "addr1v8jk9tqygmwd7xvf86pkz2033ahf0zrzdeesz0wy25my7xqgduf4l" },
          { id: `arbitrum:${back}`, hash: back, at: t0 + 4 * 60_000, networkId: "arbitrum", kind: "in", sent: [], got: [{ symbol: "USDC", amount: "0.0002", price: "usd-coin" }], party: dep },
        ] },
        activity: [{ at: t0, networkId: "arbitrum", kind: "swap", asset: "USDC → ADA", amount: "39.429337", to: dep, hash: pay, from: me, toNetworkId: "cardano" }],
      });
    }

    if (tab === "claim") await chrome.storage.session.set({ dappQueue: [{ kind: "name-claim", id: "demo", origin: "https://madar-network.com", at: Date.now(), accountIndex: 0, address: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", name: "sunrise.madar", until: "2026-10-23 18:30" }] });

    if (tab === "mayan") await chrome.storage.session.set({ dappQueue: [{
      kind: "sol-tx", id: "demo", origin: "https://swap.madar-network.com", at: Date.now(), accountIndex: 0, address: "BxMsjB6DM2cZV2vhzPQBETJnBh257ewnvkT61CoZpEMt", send: true, needsConfirm: false,
      review: { version: "legacy", feePayer: "BxMsjB6DM2cZV2vhzPQBETJnBh257ewnvkT61CoZpEMt", payerIsYou: true, fee: "11250", otherSigners: 0,
        items: [{ kind: "compute-limit", units: 250000 }, { kind: "compute-price", microLamports: "30000" },
          { kind: "create-ata", payer: "BxMsjB6DM2cZV2vhzPQBETJnBh257ewnvkT61CoZpEMt", ata: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin", owner: "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T", mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", symbol: "USDC", incomplete: false },
          { kind: "token-transfer", checked: false, amount: "5000000", decimals: 6, symbol: "USDC", mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", source: "C8xmfz6voEYL85fuP5RqqBV7dLNXnW1QsUsawD6ofwG9", dest: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin", destOwner: "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T", authority: "BxMsjB6DM2cZV2vhzPQBETJnBh257ewnvkT61CoZpEMt", incomplete: false },
          { kind: "unknown", program: "mayan34VedncxdK2XobtvWFDXQASUTBXhUVzt2kKgny" }],
        site: { kind: "mayan", mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", symbol: "USDC", decimals: 6, amount: "5000000", dest: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", ownDest: true,
          networkId: "base", network: "Base", tokenOut: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", outSymbol: "USDC", outDecimals: 6, minOut8: "4943407", fee: true } },
    }] });

    if (tab === "kyber" || tab === "simfail") await chrome.storage.session.set({ dappQueue: [{
      kind: "evm-tx", id: "demo", origin: "https://swap.madarwallet.app", at: Date.now(), accountIndex: 0, address: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", networkId: "base", network: "Base", needsConfirm: false,
      review: { to: "0x6131B5fae19EA4f9D964eAc0408E4408b66337b5", value: "10000000000000000", nativeSymbol: "ETH", nativeDecimals: 18, gas: "420000", fee: "2100000000000",
        call: { kind: "kyber", fn: "swap", tokenIn: null, tokenOut: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", amountIn: "10000000000000000", minOut: "25162060", feeBps: 50, fee: "50000000000000", payInfo: null,
          getInfo: { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", symbol: "USDC", name: "USD Coin", decimals: 6, verified: true } },

        sim: tab === "simfail" ? { status: "fail", reason: "balance", changes: null } : { status: "ok", changes: [{ token: "native", delta: "-10000000000000000", symbol: "ETH", decimals: 18, verified: true }, { token: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", delta: "25288014", symbol: "USDC", decimals: 6, verified: true }] } },
    }] });

    if (tab === "lifi") await chrome.storage.session.set({ dappQueue: [{
      kind: "evm-tx", id: "demo", origin: "https://swap.madar-network.com", at: Date.now(), accountIndex: 0, address: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", networkId: "base", network: "Base", needsConfirm: false,
      review: { to: "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE", value: "0", nativeSymbol: "ETH", nativeDecimals: 18, gas: "380000", fee: "1900000000000",
        call: { kind: "lifi", bridge: "near", tokenIn: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", amountIn: "100000000", dest: { kind: "btc", network: "Bitcoin" }, receiver: "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu",
          refund: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", tokenOut: "BTC", minOut: "120088", minOutDecimals: 8, madarFee: "500000", lifiFee: "250000", otherFees: false,
          payInfo: { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", symbol: "USDC", name: "USD Coin", decimals: 6, verified: true }, getInfo: null, receiverIsMe: true, refundIsMe: true } },
    }] });
  })();
}
