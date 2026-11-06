import "./shim";
import { createRoot } from "react-dom/client";
import "../../ui/style.css";

async function start() {

  const { AUTOLOCK_ALARM, lock } = await import("../../core/store");
  chrome.alarms.onAlarm.addListener((a) => { if (a.name === AUTOLOCK_ALARM) void lock(); });
  const { App } = await import("../../ui/App");
  createRoot(document.getElementById("root")!).render(<App />);

  const { checkUpdate } = await import("./update");
  checkUpdate(false);
}
void start();
