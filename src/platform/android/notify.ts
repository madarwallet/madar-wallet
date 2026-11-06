import { androidPost } from "../index";

let waiting: ((ok: boolean) => void) | null = null;
let listening = false;
function listen() {
  if (listening) return;
  listening = true;
  const port = (globalThis as { MadarAndroid?: EventTarget }).MadarAndroid;
  port?.addEventListener?.("message", (e) => {
    try {
      const m = JSON.parse(String((e as MessageEvent).data)) as { t?: string; ok?: boolean };
      if (m.t !== "notify-perm" || !waiting) return;
      const w = waiting; waiting = null; w(!!m.ok);
    } catch {  }
  });
}

export function askNotify(): Promise<boolean> {
  listen();
  if (waiting) return Promise.resolve(false);
  return new Promise((res) => {
    waiting = res;
    if (!androidPost({ t: "notify-perm" })) { waiting = null; res(false); return; }
    setTimeout(() => { if (waiting === res) { waiting = null; res(false); } }, 120_000);
  });
}
