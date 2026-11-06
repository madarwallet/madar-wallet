import { BTC } from "./btcbase";
import { networkById } from "./chains";
import { MAYAN_SOL_TOKENS } from "./mayan";
import { buyCoinOf, thorBuys, type BuyCoin } from "./nativebuy";
import { extraById } from "./natives";
import { coinSwapTo, sellAsset, sellCoinOf, SELL_FROM, type SellCoin } from "./nearsell";
import { buyAsset } from "./nearbuy";
import { onePay, oneTarget, type OnePay } from "./oneclick";
import { routeOkBase } from "./picker";
import { SOL } from "./solbase";
import { thorEvmCoin, thorPay, type ThorPay } from "./thorbuy";
import type { ThorEvmCoin } from "../dapp/thordecode";
import { TRON, TRON_USDT } from "./tronbase";
import { thorSellCoinOf, thorSellTarget, type ThorSellCoin, type ThorSellTarget } from "./thorsell";
import { TRON_TO } from "./tronlifi";

export type RouteKind = "soon" | "sell" | "nativeBuy" | "btcBuy" | "tron" | "twoStep" | "mayan" | "cross" | "same";

export interface RoutePlan {
  kind: RouteKind;
  isSolNet: boolean; isBtcPay: boolean; isTronPay: boolean; cross: boolean; noRoute: boolean; toBtc: boolean;

  sellCoin: SellCoin | null; sellTo: string | null;

  coinTo: SellCoin | null;
  mayanOk: boolean; twoStep: boolean; tronOk: boolean;
  buyCoin: BuyCoin | null; oneP: OnePay | null; thorP: ThorPay | null; nativeBuy: boolean;
   toTronOther: boolean;

  toTronUsdt: boolean;
  btcDirect: string | null; btcViaOne: boolean; viaBuy: boolean; soon: boolean;
   thorBtc: ThorPay | null;

  thorCoin: ThorSellCoin | null; thorSell: ThorSellTarget | null;
   nearOnly: boolean;

  thorTo: ThorEvmCoin | null; thorCrossPay: ThorPay | null;

  oneFrom: OnePay | null; oneTo: OnePay | null; oneCross: boolean;
}

export function planRoute(pay: { netId: string; token: string; symbol: string }, get: { netId: string; token: string; symbol: string }): RoutePlan {
  const isSolNet = pay.netId === SOL.id;

  const sellCoin = sellCoinOf(pay.netId, pay.token), isSellPay = !!sellCoin, isBtcPay = pay.netId === BTC.id;

  const coinTo = coinSwapTo(pay, get);
  const sellTo = isSellPay ? (coinTo ? SELL_FROM[coinTo].asset : sellAsset(get.netId, get.symbol)) : null;

  const thorCoin = isSellPay ? thorSellCoinOf(pay.netId) : null;
  const thorSell = thorCoin ? thorSellTarget(get.netId, get.token) : null;
  const cross = pay.netId !== get.netId;

  const noRoute = cross && !routeOkBase(pay.netId, get.netId);

  const mayanOk = cross && !noRoute && isSolNet && pay.token in MAYAN_SOL_TOKENS && !!networkById(get.netId);
  const twoStep = cross && !noRoute && isSolNet && !(pay.token in MAYAN_SOL_TOKENS) && !!networkById(get.netId);

  const isTronPay = pay.netId === TRON.id && !isSellPay;
  const tronOk = isTronPay && pay.token === TRON_USDT && TRON_TO.includes(get.netId) && (get.netId === SOL.id || !!networkById(get.netId));

  const toNative = extraById(get.netId);
  const buyCoin: BuyCoin | null = buyCoinOf(get.netId, get.token);

  const toTronUsdt = get.netId === TRON.id && get.token === TRON_USDT;
  const toTronOther = get.netId === TRON.id && !buyCoin && !toTronUsdt;
  const oneP: OnePay | null = get.netId === BTC.id || buyCoin ? onePay(pay.netId, pay.token) : null;
  const thorP: ThorPay | null = buyCoin && thorBuys(buyCoin) ? thorPay(pay.netId, pay.token) : null;
  const nativeBuy = !!buyCoin && (!!oneP || !!thorP);
  const btcDirect = get.netId === BTC.id && !!networkById(pay.netId) ? buyAsset(pay.netId, pay.token) : null;
  const btcViaOne = get.netId === BTC.id && !btcDirect && !!oneP;
  const thorBtc = get.netId === BTC.id && !!networkById(pay.netId) ? thorPay(pay.netId, pay.token) : null;
  const viaBuy = nativeBuy || (get.netId === BTC.id && (isSolNet || isTronPay) && btcViaOne);
  const toBtc = get.netId === BTC.id;

  const oneFrom = cross && !isSellPay && !buyCoin && !toBtc ? onePay(pay.netId, pay.token) : null;
  const oneTo = oneFrom ? oneTarget(get.netId, get.token) : null;
  const oneCross = !!oneFrom && !!oneTo;

  const thorTo = cross && !isSellPay && !!networkById(pay.netId) && !!networkById(get.netId) ? thorEvmCoin(get.netId, get.token) : null;
  const thorCrossPay = thorTo ? thorPay(pay.netId, pay.token) : null;
  const nearOk = oneCross || (!!buyCoin && !!oneP) || (toBtc && btcViaOne);
  const nearOnly = (noRoute || toTronUsdt) && nearOk;

  const soon = !coinTo && ((noRoute && !nearOk) || (cross && isSolNet && !mayanOk && !twoStep && !viaBuy && !oneCross) || (isSellPay && !sellTo && !thorSell) || (isTronPay && !tronOk && !viaBuy && !oneCross) || ((!!toNative || !!buyCoin) && !nativeBuy) || toTronOther
    || (toTronUsdt && cross && !isSellPay && !oneCross));
  const kind: RouteKind = soon ? "soon" : isSellPay ? "sell" : nativeBuy ? "nativeBuy" : toBtc && (isSolNet || isTronPay) ? "btcBuy"
    : isTronPay ? (tronOk ? "tron" : "cross") : isSolNet && cross ? (twoStep ? "twoStep" : mayanOk ? "mayan" : "cross") : cross && toBtc ? "btcBuy" : cross ? "cross" : "same";
  return { kind, isSolNet, isBtcPay, isTronPay, cross, noRoute, toBtc, sellCoin, sellTo, coinTo, mayanOk, twoStep, tronOk, buyCoin, toTronOther, toTronUsdt, oneP, thorP, nativeBuy, btcDirect, btcViaOne, viaBuy, soon, thorBtc, thorCoin, thorSell, nearOnly, thorTo, thorCrossPay: thorTo ? thorCrossPay : null, oneFrom, oneTo, oneCross };
}
