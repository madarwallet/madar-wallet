import { useEffect, useState } from "react";
import { androidPost } from "../index";

export type UpdateState =
  | { state: "idle" | "checking" | "none" | "verifying" | "permission" | "installing" }
  | { state: "available"; versionName: string; notes_ar?: string; notes_en?: string }
  | { state: "downloading"; versionName: string; progress: number }

  | { state: "preparing"; versionName: string } | { state: "throttled" }
  | { state: "error"; error: "net" | "bad" | "sign" | "perm" | "install" | string; versionName?: string };

let current: UpdateState = { state: "idle" };
let lastOffer: string | undefined;
const subs = new Set<(s: UpdateState) => void>();
let started = false;

function listen() {
  if (started) return;
  started = true;
  const port = (globalThis as { MadarAndroid?: EventTarget }).MadarAndroid;
  port?.addEventListener?.("message", (e) => {
    try {
      const m = JSON.parse(String((e as MessageEvent).data)) as { t?: string } & UpdateState;
      if (m.t !== "update") return;
      const { t: _t, ...s } = m;
      if ("versionName" in s && s.versionName) lastOffer = s.versionName;
      current = s as UpdateState;
      subs.forEach((f) => f(current));
    } catch {  }
  });
}

export function checkUpdate(force: boolean) {
  listen();
  if (force) { current = { state: "checking" }; subs.forEach((f) => f(current)); }
  androidPost({ t: "update-check", force });
}
export function startUpdate() { listen(); androidPost({ t: "update-start" }); }
export const offeredVersion = () => lastOffer;

export function useUpdate(): UpdateState {
  const [s, set] = useState(current);
  useEffect(() => { listen(); subs.add(set); return () => void subs.delete(set); }, []);
  return s;
}
