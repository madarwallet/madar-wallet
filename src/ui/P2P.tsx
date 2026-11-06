import { ArrowUpRight, Copy, CreditCard, ExternalLink, Info, ShieldCheck, Users } from "lucide-react";
import { useState } from "react";
import { evmAddress } from "../core/account";
import { solAddress } from "../core/solbase";
import { tronAddress } from "../core/tronbase";
import type { Settings } from "../core/store";
import { useT } from "./i18n";

export type P2PMode = "buy" | "sell";
const PLATFORMS: Record<P2PMode, [string, string][]> = {
  buy: [
    ["Binance P2P", "https://p2p.binance.com/en/trade/all-payments/USDT"],
    ["OKX P2P", "https://www.okx.com/p2p-markets"],
    ["Bybit P2P", "https://www.bybit.com/fiat/trade/otc/buy/USDT"],
  ],
  sell: [
    ["Binance P2P", "https://p2p.binance.com/en/trade/sell/USDT"],
    ["OKX P2P", "https://www.okx.com/p2p-markets"],
    ["Bybit P2P", "https://www.bybit.com/fiat/trade/otc/sell/USDT"],
  ],
};

export function P2P({ phrase, settings, copy, mode: start = "buy", send }: { phrase: string; settings: Settings; copy: (s: string) => void; mode?: P2PMode; send?: () => void }) {
  const { t } = useT();
  const [mode, setMode] = useState<P2PMode>(start);
  const evm = evmAddress(phrase, settings.accountIndex), sol = solAddress(phrase, settings.accountIndex), tron = tronAddress(phrase, settings.accountIndex);
  const sell = mode === "sell";
  return (
    <div className="page stack p2p">
      <h1><Users size={18} />{sell ? t.p2pSellTitle : t.p2pTitle}</h1>
      <div className="seg" role="tablist" style={{ alignSelf: "flex-start" }} aria-label={t.p2p}>
        <button role="tab" aria-selected={!sell} className={sell ? "" : "on"} onClick={() => setMode("buy")}>{t.p2pModeBuy}</button>
        <button role="tab" aria-selected={sell} className={sell ? "on" : ""} onClick={() => setMode("sell")}>{t.p2pModeSell}</button>
      </div>
      <p className="faint" style={{ margin: 0 }}>{sell ? t.p2pSellIntro : t.p2pIntro}</p>

      <div className="group">
        <div className="gt">{t.p2pPlatforms}</div>
        <div className="list">
          {PLATFORMS[mode].map(([name, url]) => (
            <button key={url} className="rowi" style={{ width: "100%", textAlign: "start" }} onClick={() => void chrome.tabs.create({ url })}>
              <span className="ic-round"><ShieldCheck size={17} /></span>
              <span className="grow"><span className="t1" dir="ltr" style={{ display: "block", textAlign: "start" }}>{name}</span><span className="t2" style={{ display: "block" }}>{sell ? t.p2pSellEscrow : t.p2pEscrow}</span></span>
              <ExternalLink size={14} className="muted" />
            </button>
          ))}
        </div>
      </div>

      <div className="group">
        <div className="gt">{t.p2pSteps}</div>
        <ol className="p2p-steps">
          {sell
            ? <><li>{t.p2pSellS1}</li><li>{t.p2pSellS2}</li><li>{t.p2pSellS3}</li><li>{t.p2pSellS4}</li></>
            : <><li>{t.p2pS1}</li><li>{t.p2pS2}</li><li>{t.p2pS3}</li><li>{t.p2pS4}</li></>}
        </ol>
      </div>

      {sell ? (
        <>
          {send && <button className="btn primary block" onClick={send}><ArrowUpRight size={16} />{t.p2pSellSend}</button>}
          <div className="note warn"><Info size={16} /><span>{t.p2pSellNet}</span></div>
          <div className="note info"><ShieldCheck size={16} /><span>{t.p2pSellSafety}</span></div>
        </>
      ) : (
        <>
          <div className="group">
            <div className="gt">{t.p2pAddrs}</div>
            <div className="list">
              <div className="rowi">
                <span className="grow" style={{ minWidth: 0 }}><span className="t1" style={{ display: "block" }}>{t.p2pEvm}</span><span className="t2" dir="ltr" style={{ display: "block", textAlign: "start", fontSize: 11 }}>{t.p2pEvmNets}</span><span className="t2 mono ellip" dir="ltr" style={{ display: "block", textAlign: "start" }}>{evm}</span></span>
                <button className="iconbtn" title={t.copy} aria-label={t.copy} onClick={() => copy(evm)}><Copy size={16} /></button>
              </div>
              {}{sol && (<div className="rowi">
                <span className="grow" style={{ minWidth: 0 }}><span className="t1" style={{ display: "block" }}>{t.p2pSol}</span><span className="t2 mono ellip" dir="ltr" style={{ display: "block", textAlign: "start" }}>{sol}</span></span>
                <button className="iconbtn" title={t.copy} aria-label={t.copy} onClick={() => copy(sol)}><Copy size={16} /></button>
              </div>)}
              {tron && (<div className="rowi">
                <span className="grow" style={{ minWidth: 0 }}><span className="t1" style={{ display: "block" }}>{t.p2pTronAddr}</span><span className="t2" dir="ltr" style={{ display: "block", textAlign: "start", fontSize: 11 }}>{t.p2pTronNets}</span><span className="t2 mono ellip" dir="ltr" style={{ display: "block", textAlign: "start" }}>{tron}</span></span>
                <button className="iconbtn" title={t.copy} aria-label={t.copy} onClick={() => copy(tron)}><Copy size={16} /></button>
              </div>)}
            </div>
          </div>
          <div className="note info"><Info size={16} /><span>{t.p2pTron}</span></div>
          <div className="note info"><ShieldCheck size={16} /><span>{t.p2pSafety}</span></div>
        </>
      )}
    </div>
  );
}

export function BuyChoices({ p2p }: { p2p: () => void }) {
  const { t } = useT();
  return (
    <div className="page stack">
      <h1>{t.buy}</h1>
      <div className="list">
        <button className="rowi" style={{ width: "100%", textAlign: "start" }} onClick={p2p}>
          <span className="ic-round"><Users size={17} /></span>
          <span className="grow"><span className="t1" style={{ display: "block" }}>{t.buyP2P}</span><span className="t2" style={{ display: "block" }}>{t.buyP2PNote}</span></span>
        </button>
        <div className="rowi" aria-disabled="true" style={{ opacity: 0.6 }}>
          <span className="ic-round"><CreditCard size={17} /></span>
          <span className="grow"><span className="t1" style={{ display: "block" }}>{t.buyCard} <span className="badge warn">{t.soon}</span></span><span className="t2" style={{ display: "block" }}>{t.soonBuy}</span></span>
        </div>
      </div>
    </div>
  );
}
