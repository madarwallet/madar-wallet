import { install } from "./inpage";

const w = window as unknown as { __madarWalletInstalled?: boolean };
if (!w.__madarWalletInstalled) {
  Object.defineProperty(w, "__madarWalletInstalled", { value: true });
  install(window as never);
}
