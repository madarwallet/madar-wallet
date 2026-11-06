import { useEffect, useState } from "react";
import type { UpdateState } from "../android/update";
import { CHECKED_KEY, EVERY_MS, READY_KEY, newer } from "./updver";

let current: UpdateState = { state: "idle" };
let offer: string | undefined;
const subs = new Set<(s: UpdateState) => void>();
let started: Promise<void> | undefined;

function set(s: UpdateState) {
  if ("versionName" in s && s.versionName) offer = s.versionName;
  current = s;
  subs.forEach((f) => f(current));
}

const mine = () => chrome.runtime.getManifest().version;

function ready(version: string) {
  if (newer(version, mine())) set({ state: "available", versionName: version });
}

function listen(): Promise<void> {
  if (started) return started;
  chrome.runtime.onUpdateAvailable?.addListener((d) => ready(d.version));

  return (started = chrome.storage.local.get(READY_KEY).then((r) => {
    const v = r[READY_KEY];
    if (typeof v !== "string") return;
    if (newer(v, mine())) ready(v);
    else void chrome.storage.local.remove(READY_KEY);
  }).catch(() => {}));
}

export async function checkUpdate(force: boolean) {
  await listen();
  if (current.state === "available" || current.state === "preparing") return;
  if (!force) {
    const r = await chrome.storage.local.get(CHECKED_KEY).catch(() => ({} as Record<string, unknown>));
    const at = Number(r[CHECKED_KEY]) || 0;
    if (Date.now() - at < EVERY_MS) return;
  }
  if (force) set({ state: "checking" });
  try {
    const { status, version } = await chrome.runtime.requestUpdateCheck();
    void chrome.storage.local.set({ [CHECKED_KEY]: Date.now() }).catch(() => {});
    if ((current.state as string) === "available") return;
    if (status === "update_available" && version && newer(version, mine())) set({ state: "preparing", versionName: version });
    else if (status === "throttled") { if (force) set({ state: "throttled" }); }
    else if (force) set({ state: "none" });
  } catch {
    if (force) set({ state: "error", error: "store" });
  }
}

export function startUpdate() {
  if (current.state === "available") chrome.runtime.reload();
}
export const offeredVersion = () => offer;
export const updateState = () => current;

export function useUpdate(): UpdateState {
  const [s, setS] = useState(current);
  useEffect(() => { void listen(); subs.add(setS); return () => void subs.delete(setS); }, []);
  return s;
}
