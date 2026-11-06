import { androidPost } from "../index";

export type ScanAnswer = { text: string } | { err: "preparing" | "unavailable" | "failed" | "cancel" | "empty" | "busy" | "none" };
let waiting: ((s: ScanAnswer) => void) | null = null;
let listening = false;
function listen() {
  if (listening) return;
  listening = true;
  const port = (globalThis as { MadarAndroid?: EventTarget }).MadarAndroid;
  port?.addEventListener?.("message", (e) => {
    try {
      const m = JSON.parse(String((e as MessageEvent).data)) as { t?: string; ok?: boolean; text?: string; err?: string };
      if (m.t !== "scan" || !waiting) return;
      const w = waiting; waiting = null;
      w(m.ok && typeof m.text === "string" ? { text: m.text } : { err: (["preparing", "unavailable", "failed", "cancel", "empty"].includes(String(m.err)) ? m.err : "failed") as "failed" });
    } catch {  }
  });
}

export function scanQr(): Promise<ScanAnswer> {
  listen();
  if (waiting) return Promise.resolve({ err: "busy" });
  return new Promise((res) => {
    waiting = res;
    if (!androidPost({ t: "scan" })) { waiting = null; res({ err: "none" }); }
  });
}
