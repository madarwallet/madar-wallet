import { formatUnitsStr } from "./solbase";
import { DOGE, isUtxoAddress, LTC, utxoAddress, utxoBalance, utxoTxUrl, type UtxoCoin } from "./utxobase";
import { isXrpAddress, XRP, xrpAddress, xrpBalances, xrpTxUrl } from "./xrpbase";
import { ADA, adaAddress, adaBalance, adaTxUrl, isAdaAddress } from "./adabase";
import { isNearAddress, NEAR, nearAddress, nearBalances, nearTxUrl } from "./nearbase";
import { isSuiAddress, SUI, suiAddress, suiBalances, suiTxUrl } from "./suibase";
import { APT, aptAddress, aptBalance, aptTxUrl, isAptAddress } from "./aptosbase";
import { COSMOS_CHAINS, cosmosAddress, cosmosBalances, cosmosTxUrl, isCosmosAddress, type CosmosChain } from "./cosmosbase";
import { DOT, dotAccount, dotAddress, dotTxUrl, isDotAddress } from "./dotbase";

export type ExtraId = "dogecoin" | "litecoin" | "xrp" | "cardano" | "near" | "sui" | "aptos" | "cosmoshub" | "osmosis" | "celestia" | "polkadot";
export type ExtraFamily = "doge" | "ltc" | "xrp" | "ada" | "near" | "sui" | "aptos" | "atom" | "osmo" | "tia" | "dot";

export interface ExtraBalance { total: bigint; pending: bigint; reserve: bigint; active: boolean;  reserveBase: bigint }
export interface ExtraCoin {
  id: ExtraId; name: string; symbol: "DOGE" | "LTC" | "XRP" | "ADA" | "NEAR" | "SUI" | "APT" | "ATOM" | "OSMO" | "TIA" | "DOT"; coinName: string; coingecko: string; decimals: number; family: ExtraFamily; explorer: string;
  txUrl: (hash: string) => string;
  address: (phrase: string, index: number) => string;
  isAddress: (a: string) => boolean;
  balance: (address: string) => Promise<ExtraBalance>;

  placeholder: string;

  noSwap?: boolean;

  noTrade?: boolean;
}
const utxo = (c: UtxoCoin, placeholder: string): ExtraCoin => ({
  id: c.id, name: c.name, symbol: c.symbol, coinName: c.name, coingecko: c.coingecko, decimals: 8, family: c.family, explorer: c.explorer, placeholder,
  txUrl: (h) => utxoTxUrl(c, h), address: (p, i) => utxoAddress(c, p, i), isAddress: (a) => isUtxoAddress(c, a),
  balance: async (a) => { const b = await utxoBalance(c, a); return { total: b.confirmed + b.pending, pending: b.pending, reserve: 0n, active: true, reserveBase: 0n }; },
});
export const DOGE_NET = utxo(DOGE, "D…");
export const LTC_NET = utxo(LTC, "ltc1…");
export const XRP_NET: ExtraCoin = {
  id: "xrp", name: XRP.name, symbol: "XRP", coinName: "XRP", coingecko: XRP.coingecko, decimals: 6, family: "xrp", explorer: XRP.explorer, placeholder: "r…",
  txUrl: xrpTxUrl, address: xrpAddress, isAddress: isXrpAddress,
  balance: async (a) => { const b = await xrpBalances(a); return { total: b.total, pending: 0n, reserve: b.reserve, active: b.active, reserveBase: b.reserveBase }; },
};
export const ADA_NET: ExtraCoin = {
  id: "cardano", name: ADA.name, symbol: "ADA", coinName: "Cardano", coingecko: ADA.coingecko, decimals: 6, family: "ada", explorer: ADA.explorer, placeholder: "addr1…",
  txUrl: adaTxUrl, address: adaAddress, isAddress: isAdaAddress,
  balance: async (a) => { const b = await adaBalance(a); return { total: b.lovelace, pending: 0n, reserve: 0n, active: true, reserveBase: 0n }; },
};
export const NEAR_NET: ExtraCoin = {
  id: "near", name: NEAR.name, symbol: "NEAR", coinName: "NEAR Protocol", coingecko: NEAR.coingecko, decimals: NEAR.decimals, family: "near", explorer: NEAR.explorer,
  placeholder: "name.near", noTrade: true,
  txUrl: nearTxUrl, address: nearAddress, isAddress: isNearAddress,

  balance: async (a) => { const b = await nearBalances(a); return { total: b.total, pending: 0n, reserve: b.reserve, active: b.active, reserveBase: 0n }; },
};

export const SUI_NET: ExtraCoin = {
  id: "sui", name: SUI.name, symbol: "SUI", coinName: "Sui", coingecko: SUI.coingecko, decimals: SUI.decimals, family: "sui", explorer: SUI.explorer, placeholder: "0x…",
  noSwap: true, noTrade: true, txUrl: suiTxUrl, address: suiAddress, isAddress: isSuiAddress,
  balance: async (a) => { const b = await suiBalances(a); return { total: b.total, pending: 0n, reserve: 0n, active: true, reserveBase: 0n }; },
};
export const APT_NET: ExtraCoin = {
  id: "aptos", name: APT.name, symbol: "APT", coinName: "Aptos", coingecko: APT.coingecko, decimals: APT.decimals, family: "aptos", explorer: APT.explorer, placeholder: "0x…",
  noSwap: true, noTrade: true, txUrl: aptTxUrl, address: aptAddress, isAddress: isAptAddress,
  balance: async (a) => ({ total: await aptBalance(a), pending: 0n, reserve: 0n, active: true, reserveBase: 0n }),
};
const cosmosNet = (c: CosmosChain): ExtraCoin => ({
  id: c.id, name: c.name, symbol: c.symbol, coinName: c.coinName, coingecko: c.coingecko, decimals: c.decimals, family: c.family, explorer: c.explorer, placeholder: `${c.prefix}1…`,
  noSwap: true, noTrade: true, txUrl: (h) => cosmosTxUrl(c, h), address: (p, i) => cosmosAddress(c, p, i), isAddress: (a) => isCosmosAddress(c, a),
  balance: async (a) => ({ total: (await cosmosBalances(c, a)).total, pending: 0n, reserve: 0n, active: true, reserveBase: 0n }),
});
export const [ATOM_NET, OSMO_NET, TIA_NET] = COSMOS_CHAINS.map(cosmosNet);
export const DOT_NET: ExtraCoin = {
  id: "polkadot", name: DOT.name, symbol: "DOT", coinName: "Polkadot", coingecko: DOT.coingecko, decimals: DOT.decimals, family: "dot", explorer: DOT.explorer, placeholder: "1…",
  noSwap: true, noTrade: true, txUrl: dotTxUrl, address: dotAddress, isAddress: isDotAddress,
  balance: async (a) => { const b = await dotAccount(a); return { total: b.free + b.reserved, pending: 0n, reserve: 0n, active: b.exists, reserveBase: 0n }; },
};
export const EXTRA_COINS: readonly ExtraCoin[] = [XRP_NET, ADA_NET, DOGE_NET, LTC_NET, SUI_NET, APT_NET, ATOM_NET, OSMO_NET, TIA_NET, DOT_NET, NEAR_NET];
export const EXTRA_IDS: readonly string[] = EXTRA_COINS.map((c) => c.id);
export const extraById = (id: string | undefined): ExtraCoin | undefined => EXTRA_COINS.find((c) => c.id === id);
export const extraByFamily = (f: string): ExtraCoin | undefined => EXTRA_COINS.find((c) => c.family === f);
export const extraAmount = (c: ExtraCoin, units: bigint) => formatUnitsStr(units < 0n ? -units : units, c.decimals);
