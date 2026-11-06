import { CreditCard, ExternalLink, ShieldCheck, TriangleAlert, Check } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { evmAddress } from "../core/account";
import { BTC, btcAddress } from "../core/btcbase";
import { AMOUNT_PRESETS, BUY_COINS, FIATS, PREFERRED, STABLE_NETWORKS, widgetUrl, type BuyCoin } from "../core/buy";
import { NETWORKS } from "../core/chains";
import { SOL, solAddress } from "../core/solbase";
import type { Settings } from "../core/store";
import { useT } from "./i18n";
import { NetworkDot } from "./icons";
import { amountChars } from "../core/amount";

const netName = (id: string) => (id === BTC.id ? BTC.name : id === SOL.id ? SOL.name : NETWORKS.find((n) => n.id === id)?.name ?? id);
const key = (c: BuyCoin) => `${c.networkId}:${c.ticker}`;

const westernDigits = amountChars;

const GAS: Record<string, string> = { base: "ETH", ethereum: "ETH", bsc: "BNB", solana: "SOL" };

export function Buy({ phrase, settings }: { phrase: string; settings: Settings }) {
  const { t } = useT();
  const idx = settings.accountIndex;

  const [stable, setStable] = useState<"USDC" | "USDT">("USDC");
  const nets = STABLE_NETWORKS[stable];
  const [netId, setNetId] = useState<string>("");
  const first = BUY_COINS.find((c) => c.symbol === stable && c.networkId === (nets.includes(netId) ? netId : PREFERRED[stable]))!;
  const coinKey = key(first);
  const [fiat, setFiat] = useState<string>("USD");
  const [amount, setAmount] = useState<number>(AMOUNT_PRESETS[0]);
  const [amountText, setAmountText] = useState<string>(String(AMOUNT_PRESETS[0]));
  const coin = first;
  const address = coin.kind === "btc" ? btcAddress(phrase, idx) : coin.kind === "sol" ? solAddress(phrase, idx) : evmAddress(phrase, idx);
  const url = useMemo(() => widgetUrl({ coin, address, fiat, amount }), [coin, address, fiat, amount]);

  const [loaded, setLoaded] = useState(false), [slow, setSlow] = useState(false);
  useEffect(() => { setLoaded(false); setSlow(false); const id = setTimeout(() => setSlow(true), 20_000); return () => clearTimeout(id); }, [url]);
  const popup = () => void chrome.windows.create({ url, type: "popup", width: 480, height: 760, focused: true });

  return (
    <div className="page stack">
      <h1><CreditCard size={18} />{t.buyTitle}</h1>
      {}
      <div className="row" style={{ gap: 8, alignItems: "flex-end" }}>
        <label className="field" style={{ flex: 1 }}>{t.buyAmount}
          <input className="input" type="text" inputMode="decimal" dir="ltr" lang="en" placeholder={t.buyOther}
            value={amountText} onChange={(e) => { const s = westernDigits(e.target.value); setAmountText(s); const v = Number(s); if (Number.isFinite(v) && v > 0) setAmount(v); }} />
        </label>
        <label className="field" style={{ width: 96 }}>{t.buyFiat}
          <select className="input" value={fiat} onChange={(e) => setFiat(e.target.value)}>{FIATS.map((f) => <option key={f} value={f}>{f}</option>)}</select>
        </label>
      </div>
      <div className="pct" style={{ marginTop: 0 }}>
        {AMOUNT_PRESETS.map((a) => <button key={a} type="button" className={amount === a ? "on" : ""} onClick={() => { setAmount(a); setAmountText(String(a)); }}>{a}</button>)}
      </div>
      {}
      <label className="field">{t.buyCoin}
        <div className="pct" style={{ marginTop: 0 }}>
          {(["USDC", "USDT"] as const).map((s) => <button key={s} type="button" className={stable === s ? "on" : ""} onClick={() => { setStable(s); setNetId(""); }}>{s}</button>)}
        </div>
      </label>
      <label className="field">{t.buyNetwork}
        <select className="input" value={coin.networkId} onChange={(e) => setNetId(e.target.value)}>
          {nets.map((n) => <option key={n} value={n}>{netName(n)}{n === PREFERRED[stable] ? " · " + t.buyRecommended : ""}</option>)}
        </select>
      </label>
      <div className="faint" style={{ fontSize: 12, marginTop: -4 }}>{t.buyGas.replace("{g}", GAS[coin.networkId] ?? "ETH")}</div>
      <div className="kv buyaddr">
        <span className="row" style={{ gap: 6 }}><NetworkDot id={coin.networkId} size={16} />{t.buyTo}</span>
        <span className="mono" style={{ fontSize: 12, wordBreak: "break-all" }}>{address}</span>
      </div>
      {}
      <div className="note info" style={{ fontWeight: 700 }}><Check size={16} />{t.buyAgreeHint}</div>
      <div className="note warn" style={{ fontSize: 14, fontWeight: 700 }}><CreditCard size={16} />{t.buyCardHint}</div>
      <div className="buyframe">
        {!loaded && <div className="faint buyloading">{t.buyLoading}</div>}
        <iframe
          key={url}
          src={url}
          title={t.buyTitle}
          onLoad={() => setLoaded(true)}
          referrerPolicy="no-referrer"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
          allow="payment; clipboard-write"
        />
      </div>
      {slow && !loaded && <div className="note warn"><TriangleAlert size={16} />{t.buyLoadFail}</div>}
      <div className="faint" style={{ fontSize: 12 }}>{t.buyHow}</div>
      <div className="note info"><ShieldCheck size={16} />{t.buyNote}</div>
      <button className="btn ghost block" onClick={popup}><ExternalLink size={16} />{t.buyOpenWindow}</button>
    </div>
  );
}
