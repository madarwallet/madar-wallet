import { decryptPhrase, encryptPhrase, type Vault } from "./vault";
import { IMPORTED_BASE, isImportedIndex, setImportedKeys } from "./imported";
import { privateKeyToAccount } from "viem/accounts";
import { forgetAddresses } from "./account";
import { balancesChanged } from "./balbus";

export interface AccountMeta { index: number; name: string; imported?: boolean; named?: number }

export const DISCOVER_FLAG = "discoverAccounts";
export type Lang = "ar" | "en";
export type Currency = "USD" | "SAR";
export type Theme = "dark" | "light";

export interface CustomToken { networkId: string; address: `0x${string}`; symbol: string; name: string; decimals: number }
export interface Settings {
  autoLockMinutes: number;
  networkId: string;
  accountIndex: number;
  accounts: AccountMeta[];
  lang: Lang;
  currency: Currency;
  theme: Theme;
  hideBalances: boolean;

  hideZero?: boolean;

  enabledTokens: Record<string, string[]>;
  customTokens: CustomToken[];

  zakat?: boolean;

  bookSync?: boolean;

  networksOn?: string[];

  myPage?: string;

  gasSpeed?: "slow" | "normal" | "fast";

  notify?: boolean;

  login?: LoginInfo;
}

export interface LoginInfo { method: "email"; email: string; backupPending?: boolean; lastBackup?: number }
export const DEFAULT_SETTINGS: Settings = {
  autoLockMinutes: 15, networkId: "all", accountIndex: 0, accounts: [{ index: 0, name: "" }],
  lang: "ar", currency: "USD", theme: "dark", hideBalances: false, enabledTokens: {}, customTokens: [],
};

export interface ActivityItem {
  at: number;
  networkId: string;
  kind: "send" | "swap";
  asset: string;
  amount: string;
  to: string;
  hash: string;

  from?: string;

  toNetworkId?: string;

  outMin?: string;
  outEst?: string;
}

const local = chrome.storage.local;
const session = chrome.storage.session;
export const AUTOLOCK_ALARM = "madar-autolock";

export async function hasVault(): Promise<boolean> {
  return (await local.get("vault")).vault != null;
}

export async function createVault(phrase: string, password: string, login?: LoginInfo): Promise<void> {
  const vault = await encryptPhrase(phrase, password);

  await local.remove("importedVault");
  forgetAddresses();
  await local.set({ vault, settings: { ...(await getSettings()), accounts: DEFAULT_SETTINGS.accounts, accountIndex: 0, login }, activity: [] });
  await unlockWith(phrase);
}

const FAILS = "pwFails";
export const FREE_TRIES = 5;
export const waitAfter = (fails: number) => (fails < FREE_TRIES ? 0 : Math.min(15 * 60_000, 30_000 * 2 ** (fails - FREE_TRIES)));

export async function passwordWait(now = Date.now()): Promise<number> {
  const f = (await local.get(FAILS))[FAILS] as { n: number; at: number } | undefined;
  return f ? Math.max(0, waitAfter(f.n) - Math.max(0, now - f.at)) : 0;
}

let queue: Promise<unknown> = Promise.resolve();
function guarded<T>(check: () => Promise<T>): Promise<T> {
  const run = queue.then(() => attempt(check), () => attempt(check));
  queue = run.catch(() => {});
  return run;
}
async function attempt<T>(check: () => Promise<T>): Promise<T> {
  const now = Date.now();
  let prev = (await local.get(FAILS))[FAILS] as { n: number; at: number } | undefined;
  if (prev && prev.at > now) { prev = { n: prev.n, at: now }; await local.set({ [FAILS]: prev }); }
  const wait = await passwordWait(now);
  if (wait > 0) throw Object.assign(new Error("ERR_WAIT"), { waitMs: wait });
  await local.set({ [FAILS]: { n: (prev?.n ?? 0) + 1, at: now } });
  try {
    const r = await check();
    await local.remove(FAILS);
    return r;
  } catch (e) {
    if ((e as Error)?.message !== "wrong password") { if (prev) await local.set({ [FAILS]: prev }); else await local.remove(FAILS); }
    throw e;
  }
}

export async function unlock(password: string): Promise<string> {
  const { vault } = (await local.get("vault")) as { vault?: Vault };
  if (!vault) throw new Error("no wallet");
  const phrase = await guarded(() => decryptPhrase(vault, password));
  await unlockWith(phrase, await openImported(password));
  return phrase;
}

export async function checkPassword(password: string): Promise<string> {
  const { vault } = (await local.get("vault")) as { vault?: Vault };
  if (!vault) throw new Error("no wallet");
  return guarded(() => decryptPhrase(vault, password));
}

async function unlockWith(phrase: string, imported: Record<string, string> = {}): Promise<void> {
  setImportedKeys(imported);
  await session.set({ phrase, imported });
  await touch();
}

async function openImported(password: string, strict = false): Promise<Record<string, string>> {
  const { importedVault } = (await local.get("importedVault")) as { importedVault?: Vault };
  if (!importedVault) return {};
  try {
    const m = JSON.parse(await decryptPhrase(importedVault, password));
    if (m && typeof m === "object" && !Array.isArray(m)) return m;
  } catch {  }
  if (strict) throw new Error("ERR_IMPORTED");
  return {};
}

async function importedUnchanged(seen: unknown): Promise<void> {
  const now = (await local.get("importedVault")).importedVault;
  if (JSON.stringify(now ?? null) !== JSON.stringify(seen ?? null)) throw new Error("ERR_RETRY");
}

export async function importPrivateKey(password: string, key: `0x${string}`, name: string, ownAddresses: string[] = []): Promise<{ index: number; address: string }> {
  const phrase = await checkPassword(password);
  const seen = (await local.get("importedVault")).importedVault;
  const keys = await openImported(password, true);
  const address = privateKeyToAccount(key).address;
  const known = Object.values(keys).map((k) => privateKeyToAccount(k as `0x${string}`).address.toLowerCase());
  if (known.includes(address.toLowerCase()) || ownAddresses.some((a) => a.toLowerCase() === address.toLowerCase())) throw new Error("ERR_DUP_KEY");
  const used = Object.keys(keys).map(Number).filter(isImportedIndex);
  const index = used.length ? Math.max(...used) + 1 : IMPORTED_BASE;
  const next = { ...keys, [index]: key };
  const sealed = await encryptPhrase(JSON.stringify(next), password);
  await importedUnchanged(seen);
  await local.set({ importedVault: sealed });
  await unlockWith(phrase, next);
  const st = await getSettings();
  await saveSettings({ accounts: [...st.accounts, { index, name, imported: true }], accountIndex: index });
  return { index, address };
}

export async function unlockedPhrase(): Promise<string | null> {
  const r = await session.get(["phrase", "imported"]);
  setImportedKeys(r.imported as Record<string, string> | undefined);
  return (r.phrase as string | undefined) ?? null;
}

export async function lock(): Promise<void> {
  setImportedKeys(null);
  forgetAddresses();
  await session.remove(["phrase", "imported"]);
  await chrome.alarms.clear(AUTOLOCK_ALARM);
}

export async function touch(): Promise<void> {
  const s = await getSettings();
  if (!(s.autoLockMinutes > 0)) { await chrome.alarms.clear(AUTOLOCK_ALARM); return; }
  await chrome.alarms.create(AUTOLOCK_ALARM, { delayInMinutes: s.autoLockMinutes });
}

export async function getSettings(): Promise<Settings> {
  return { ...DEFAULT_SETTINGS, ...((await local.get("settings")).settings as Partial<Settings> | undefined) };
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const s = { ...(await getSettings()), ...patch };
  await local.set({ settings: s });
  return s;
}

export async function getActivity(): Promise<ActivityItem[]> {
  return ((await local.get("activity")).activity as ActivityItem[] | undefined) ?? [];
}

export async function addActivity(item: ActivityItem): Promise<void> {
  const list = [item, ...(await getActivity())].slice(0, 100);
  await local.set({ activity: list });
  balancesChanged();

  void import("./watchplan").then((m) => m.watchSent(item)).catch(() => {});
}

export async function removeActivity(hash: string): Promise<void> {
  const list = await getActivity();
  const next = list.filter((a) => a.hash !== hash);
  if (next.length !== list.length) await local.set({ activity: next });
}

const PENDING_KEY = "pendingPayments";
export interface PendingPayment { networkId: string; from: string; hash: string; at: number; data: Record<string, string | number | null> }
export async function getPending(networkId: string, from: string): Promise<PendingPayment | null> {
  const all = ((await local.get(PENDING_KEY))[PENDING_KEY] as Record<string, PendingPayment> | undefined) ?? {};
  const p = all[`${networkId}:${from}`];
  return p && p.networkId === networkId && p.from === from && typeof p.hash === "string" ? p : null;
}
export async function setPending(p: PendingPayment): Promise<void> {
  const all = ((await local.get(PENDING_KEY))[PENDING_KEY] as Record<string, PendingPayment> | undefined) ?? {};
  await local.set({ [PENDING_KEY]: { ...all, [`${p.networkId}:${p.from}`]: p } });
}

export async function clearPending(networkId: string, from: string, hash: string): Promise<void> {
  const all = ((await local.get(PENDING_KEY))[PENDING_KEY] as Record<string, PendingPayment> | undefined) ?? {};
  const k = `${networkId}:${from}`;
  if (all[k]?.hash !== hash) return;
  const { [k]: _gone, ...rest } = all;
  void _gone;
  await local.set({ [PENDING_KEY]: rest });
}

export async function changePassword(oldPassword: string, newPassword: string): Promise<void> {
  const phrase = await checkPassword(oldPassword);
  const seen = (await local.get("importedVault")).importedVault;
  const keys = await openImported(oldPassword, true);
  const vault = await encryptPhrase(phrase, newPassword);
  const importedVault = seen ? await encryptPhrase(JSON.stringify(keys), newPassword) : null;
  await importedUnchanged(seen);
  await local.set({ vault, ...(importedVault ? { importedVault } : {}) });
}

export async function wipe(): Promise<void> {
  const { lang, theme } = await getSettings();
  await lock();

  await import("./watchplan").then((m) => m.savePlan(null)).catch(() => {});
  await local.clear();
  await local.set({ settings: { ...DEFAULT_SETTINGS, lang, theme } });
}

export interface SitePerm { evm: boolean; sol: boolean; chainId?: number; at: number }

export async function getSitePerms(): Promise<Record<string, SitePerm>> {
  return ((await local.get("sitePerms")).sitePerms as Record<string, SitePerm> | undefined) ?? {};
}

export async function setSitePerm(origin: string, perm: SitePerm | null): Promise<void> {
  const all = { ...(await getSitePerms()) };
  if (perm) all[origin] = perm; else delete all[origin];
  await local.set({ sitePerms: all });
}
