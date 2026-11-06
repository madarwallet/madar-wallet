import { CS_TARGET, ERR, isAllowedOrigin, PAGE_TARGET, PORT_NAME, type DappReply, type DappRequest, type DappState } from "./protocol";

interface PortLike {
  postMessage(m: unknown): void;
  disconnect(): void;
  onMessage: { addListener(f: (m: any) => void): void };
  onDisconnect: { addListener(f: () => void): void };
}
export interface RuntimeLike {
  id?: string;
  connect(info: { name: string }): PortLike;
  onMessage: { addListener(f: (m: any, sender: { id?: string }) => void): void };
}
export interface WindowLike {
  location: { origin: string };
  addEventListener(type: "message", f: (e: MessageEvent) => void): void;
  postMessage(m: unknown, targetOrigin: string): void;
}

const MAX_REQUEST_BYTES = 256 * 1024;

export function validRequest(r: unknown): r is DappRequest {
  if (!r || typeof r !== "object") return false;
  const q = r as DappRequest;
  if ((q.chain !== "evm" && q.chain !== "sol") || typeof q.method !== "string" || !/^[A-Za-z0-9_:]{1,64}$/.test(q.method)) return false;
  try { return JSON.stringify(q).length <= MAX_REQUEST_BYTES; } catch { return false; }
}

export function startBridge(win: WindowLike, runtime: RuntimeLike, opts: { pingMs?: number } = {}): boolean {
  if (!isAllowedOrigin(win.location.origin)) return false;
  let channel: string | null = null;
  const origin = win.location.origin;
  const toPage = (m: Record<string, unknown>) => { if (channel) win.postMessage({ target: PAGE_TARGET, channel, ...m }, origin); };

  win.addEventListener("message", (e) => {
    if (e.source !== (win as unknown) || e.origin !== origin) return;
    const d = e.data;
    if (!d || typeof d !== "object" || d.target !== CS_TARGET) return;
    if (typeof d.hello === "string") {
      if (!channel && /^[0-9a-f]{32}$/.test(d.hello)) channel = d.hello;
      if (d.hello === channel) toPage({ ack: true });
      return;
    }
    if (!channel || d.channel !== channel || typeof d.id !== "number") return;
    const id = d.id as number;
    if (!validRequest(d.req)) { toPage({ id, reply: { ok: false, error: { code: ERR.invalidParams, message: "Invalid request" } } satisfies DappReply }); return; }
    forward(id, { chain: d.req.chain, method: d.req.method, params: d.req.params });
  });

  function forward(id: number, req: DappRequest) {
    let port: PortLike;
    try { port = runtime.connect({ name: PORT_NAME }); }
    catch { toPage({ id, reply: { ok: false, error: { code: ERR.disconnected, message: "Madar Wallet was updated or disabled. Reload the page." } } }); return; }
    let done = false;
    const ping = setInterval(() => { try { port.postMessage({ ping: 1 }); } catch {  } }, opts.pingMs ?? 20_000);
    port.onMessage.addListener((m) => {
      if (done || !m || typeof m !== "object" || !("reply" in m)) return;
      done = true; clearInterval(ping);
      toPage({ id, reply: m.reply });
      try { port.disconnect(); } catch {  }
    });
    port.onDisconnect.addListener(() => {
      clearInterval(ping);
      if (!done) { done = true; toPage({ id, reply: { ok: false, error: { code: ERR.disconnected, message: "Madar Wallet stopped responding. Try again." } } }); }
    });
    port.postMessage({ req });
  }

  win.postMessage({ target: PAGE_TARGET, ready: true }, origin);

  runtime.onMessage.addListener((m, sender) => {
    if (sender.id !== runtime.id || !m || m.type !== "madar-state" || m.origin !== origin) return;
    toPage({ state: m.state as DappState });
  });
  return true;
}
