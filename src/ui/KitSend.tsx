import { APT_KIT } from "../core/aptos";
import { COSMOS_CHAINS, cosmosKit } from "../core/cosmos";
import { DOT_KIT } from "../core/dot";
import type { KitQuote, KitSigned, SendKit } from "../core/sendkit";
import type { Settings } from "../core/store";
import { SUI_KIT } from "../core/sui";
import { ChainSend, type KitTexts } from "./ChainSend";

const KITS: Record<string, [SendKit<KitQuote, KitSigned>, KitTexts]> = {
  sui: [SUI_KIT as unknown as SendKit<KitQuote, KitSigned>, { toHint: "suiToHint", feeNote: "suiFeeNote", badAddress: "errSuiAddress" }],
  aptos: [APT_KIT as unknown as SendKit<KitQuote, KitSigned>, { toHint: "aptToHint", feeNote: "aptFeeNote", badAddress: "errAptAddress" }],
  polkadot: [DOT_KIT as unknown as SendKit<KitQuote, KitSigned>, { toHint: "dotToHint", feeNote: "dotFeeNote", badAddress: "errDotAddress" }],
  ...Object.fromEntries(COSMOS_CHAINS.map((c) => [c.id, [cosmosKit(c) as unknown as SendKit<KitQuote, KitSigned>, { toHint: "cosmosToHint", feeNote: "cosmosFeeNote", badAddress: "errCosmosAddress" }]])),
};
export const hasKit = (id: string) => id in KITS;

export function KitSend({ id, phrase, index, settings, done }: { id: string; phrase: string; index: number; settings: Settings; done: () => void }) {
  const k = KITS[id];
  if (!k) return null;
  return <ChainSend key={id} kit={k[0]} texts={k[1]} phrase={phrase} index={index} settings={settings} done={done} />;
}
