import { AUTOLOCK_ALARM, lock } from "./core/store";
import { balancesChanged } from "./core/balbus";
import { runWatch, fetchIO, WATCH_ALARM, WATCH_KEY, WATCH_MINUTES, type WatchPlan } from "./core/watch";
import { READY_KEY } from "./platform/extension/updver";
import "./dapp/host";

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === AUTOLOCK_ALARM) void lock();
});

chrome.runtime.onInstalled.addListener(() => {
  void chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
});

function useSidePanel() {
  const sp = (chrome as any).sidePanel;

  const nav = navigator as any;
  if (nav.userAgentData?.platform === "Android" || /Android/i.test(nav.userAgent ?? "")) {
    void chrome.action.setPopup({ popup: "index.html" });
    sp?.setPanelBehavior?.({ openPanelOnActionClick: false }).catch(() => {});
    return;
  }
  if (!sp?.setPanelBehavior) return;
  void chrome.action.setPopup({ popup: "" });
  sp.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => void chrome.action.setPopup({ popup: "index.html" }));
}
useSidePanel();
chrome.runtime.onStartup.addListener(useSidePanel);

chrome.runtime.onUpdateAvailable.addListener((d) => void chrome.storage.local.set({ [READY_KEY]: d.version }).catch(() => {}));

async function watchAlarm(): Promise<void> {
  const p = (await chrome.storage.local.get(WATCH_KEY))[WATCH_KEY] as WatchPlan | undefined;
  const has = await chrome.alarms.get(WATCH_ALARM).catch(() => undefined);
  if (p?.on && !has) await chrome.alarms.create(WATCH_ALARM, { periodInMinutes: WATCH_MINUTES, delayInMinutes: 1 });
  if (!p?.on && has) await chrome.alarms.clear(WATCH_ALARM);
}
let watching = false;
async function watchTick(): Promise<void> {
  if (watching) return;
  watching = true;
  try {
    const before = (await chrome.storage.local.get(WATCH_KEY))[WATCH_KEY] as WatchPlan | undefined;
    if (!before?.on) return;
    const allowed = await chrome.permissions.contains({ permissions: ["notifications"] }).catch(() => false);
    if (!allowed) return;
    const r = await runWatch(before, fetchIO);
    const links: Record<string, string> = {};
    for (const e of r.events) {
      chrome.notifications.create(e.key, { type: "basic", iconUrl: "icon.png", title: e.title, message: e.body, priority: 0 });
      if (e.link) links[e.key] = e.link;
    }
    if (r.events.length) balancesChanged();
    if (Object.keys(links).length) {
      const old = ((await chrome.storage.session.get("watchLinks")).watchLinks as Record<string, string> | undefined) ?? {};
      await chrome.storage.session.set({ watchLinks: { ...old, ...links } });
    }

    const now = (await chrome.storage.local.get(WATCH_KEY))[WATCH_KEY] as WatchPlan | undefined;
    if (!now?.on) return;
    if (now.at === before.at) await chrome.storage.local.set({ [WATCH_KEY]: r.plan });
    else {
      const done = [...new Set([...now.done, ...r.plan.done])].slice(-200);
      await chrome.storage.local.set({ [WATCH_KEY]: { ...now, done, txs: now.txs.filter((x) => !done.includes(x.hash)) } });
    }
  } catch {  } finally { watching = false; }
}
chrome.alarms.onAlarm.addListener((a) => { if (a.name === WATCH_ALARM) void watchTick(); });
chrome.storage.onChanged.addListener((c, area) => { if (area === "local" && WATCH_KEY in c) void watchAlarm(); });

let clicks = false;
function onClicks() {
  if (clicks || !chrome.notifications?.onClicked) return;
  clicks = true;
  chrome.notifications.onClicked.addListener((id) => {
    void chrome.storage.session.get("watchLinks").then((r) => {
      const url = (r.watchLinks as Record<string, string> | undefined)?.[id];
      if (url && /^https:\/\//.test(url)) void chrome.tabs.create({ url });
      chrome.notifications.clear(id);
    });
  });
}
onClicks();
chrome.permissions.onAdded.addListener(onClicks);
void watchAlarm();
