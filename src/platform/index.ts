export const ANDROID: boolean = import.meta.env.MODE === "android";

export type AndroidMsg =
  | { t: "open"; url: string } | { t: "copy"; text: string } | { t: "save"; name: string; data: string }
  | { t: "update-check"; force: boolean } | { t: "update-start" } | { t: "scan" }

  | { t: "notify-perm" } | { t: "watch"; plan: string };
export function androidPost(msg: AndroidMsg): boolean {
  const port = (globalThis as { MadarAndroid?: { postMessage(s: string): void } }).MadarAndroid;
  if (!port) return false;
  port.postMessage(JSON.stringify(msg));
  return true;
}
