import { Copy, Globe, Info } from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { NETWORKS } from "../core/chains";
import type { ExtraCoin } from "../core/natives";
import { formatXrp, xrpLedger } from "../core/xrpbase";
import { fill, useT } from "./i18n";
import { fillNodes } from "./common";
import { MadarName } from "./icons";

export function Receive({ address, copy, isBtc, isSol, isTron, isTon, coin, name, copyName, nets }: { address: string; copy: (s: string) => void; isBtc?: boolean; isSol?: boolean; isTron?: boolean; isTon?: boolean; coin?: ExtraCoin; name?: string | null; copyName?: (n: string) => void; nets?: string[] }) {
  const { t } = useT();
  const [qr, setQr] = useState("");
  const [reserve, setReserve] = useState<bigint | null>(null);
  useEffect(() => { void QRCode.toDataURL(address, { margin: 1, width: 440 }).then(setQr); }, [address]);
  useEffect(() => {
    if (coin?.id !== "xrp") return;
    let live = true;
    xrpLedger().then((l) => { if (live) setReserve(l.reserveBase); }, () => {});
    return () => { live = false; };
  }, [coin?.id]);
  const warn = isBtc ? t.btcReceiveWarn : isSol ? t.solReceiveWarn : isTron ? t.tronReceiveWarn : isTon ? t.tonReceiveWarn
    : coin?.id === "dogecoin" ? t.dogeReceiveWarn : coin?.id === "litecoin" ? t.ltcReceiveWarn : coin?.id === "xrp" ? t.xrpReceiveWarn : coin?.id === "cardano" ? t.adaReceiveWarn : coin?.id === "near" ? t.nearReceiveWarn
    : coin?.id === "sui" ? t.suiReceiveWarn : coin?.id === "aptos" ? t.aptReceiveWarn : coin?.id === "polkadot" ? t.dotReceiveWarn
    : coin && coin.family && ["atom", "osmo", "tia"].includes(coin.family) ? fill(t.cosmosReceiveWarn, { n: coin.name, s: coin.symbol }) : null;
  return (
    <div className="page stack">
      <h1>{t.receive}</h1>
      {name && (
        <div className="namecard">
          <div className="faint">{t.myName}</div>
          <div className="namebig"><MadarName name={name} /></div>
          <button className="btn ghost sm" onClick={() => copyName?.(name)}><Copy size={15} />{t.copyName}</button>
        </div>
      )}
      <div className="qrbox">{qr && <img src={qr} alt={t.qrAlt} />}</div>
      <div className="faint" style={{ textAlign: "center" }}>{t.addressLabel}</div>
      <div className="addrbox mono">{address}</div>
      <button className="btn primary block" onClick={() => copy(address)}><Copy size={16} />{t.copy}</button>
      <div className="note info"><Globe size={16} />{warn ?? <span>{fillNodes(t.receiveWarn, { list: (nets ?? NETWORKS.map((n) => n.name)).join(", ") })}</span>}</div>
      {isTron && <div className="note soft"><Info size={15} /><span>{t.tronFeeNote}</span></div>}
      {isTon && <div className="note soft"><Info size={15} /><span>{t.tonFeeNote}</span></div>}
      {coin?.id === "xrp" && reserve != null && <div className="note soft"><Info size={15} /><span>{fill(t.xrpReceiveReserve, { r: formatXrp(reserve) })}</span></div>}
    </div>
  );
}
