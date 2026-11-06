import { touch } from "../core/store";

export function answer(id: string, approve: boolean, confirmUnknown = false) {
  void touch();
  return Promise.resolve(chrome.runtime.sendMessage?.({ type: "madar-approval", id, approve, confirmUnknown })).catch(() => {});
}
