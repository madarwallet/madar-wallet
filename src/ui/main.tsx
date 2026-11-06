import { createRoot } from "react-dom/client";
import "./style.css";

async function start() {
  if (import.meta.env.DEV) { await import("./devshim"); await (globalThis as { __DEMO_READY__?: Promise<void> }).__DEMO_READY__; }
  const { App } = await import("./App");
  createRoot(document.getElementById("root")!).render(<App />);

  const { checkUpdate } = await import("../platform/extension/update");
  void checkUpdate(false);
}
void start();
