import { HandCoins } from "lucide-react";
import { useEffect, useState } from "react";
import { evmAddress } from "../core/account";
import { fetchPrices } from "../core/chainops";
import { accountTotal, cachedTotal, saveTotal } from "../core/portfolio";
import type { Settings } from "../core/store";
import { GOLD_ID, nisabValue, zakatOf } from "../core/zakat";
import { money } from "./common";
import { useT } from "./i18n";

const FRESH_MS = 5 * 60_000;

export function ZakatCard({ phrase, settings }: { phrase: string; settings: Settings }) {
  const { t } = useT();
  const evm = evmAddress(phrase, settings.accountIndex);
  const cur = settings.currency;
  const [total, setTotal] = useState<number | null>(null);
  const [gold, setGold] = useState<number | null>(null);
  const tokensKey = JSON.stringify([settings.enabledTokens, settings.customTokens]);
  useEffect(() => {
    let live = true;
    setTotal(null);
    (async () => {
      const c = await cachedTotal(evm, cur).catch(() => null);
      if (live && c) setTotal(c.value);
      if (c && Date.now() - c.at < FRESH_MS) return;
      try {
        const v = await accountTotal(phrase, settings.accountIndex, settings);
        await saveTotal(evm, cur, v);
        if (live) setTotal(v);
      } catch {  }
    })();
    return () => { live = false; };
  }, [evm, cur, tokensKey]);
  useEffect(() => {
    let live = true;
    fetchPrices([GOLD_ID], cur.toLowerCase() as "usd" | "sar").then((p) => { if (live && p[GOLD_ID]) setGold(p[GOLD_ID].price); }, () => {});
    return () => { live = false; };
  }, [cur]);

  const z = zakatOf(total, nisabValue(gold));
  const show = (v: number) => (settings.hideBalances ? "••••" : money(v, cur));
  return (
    <div className="list zakat" style={{ padding: "4px 14px" }}>
      <div className="kv" style={{ fontWeight: 700 }}><span className="row" style={{ gap: 6 }}><HandCoins size={16} />{t.zkTitle}</span>{!z && <span className="faint">{t.zkWait}</span>}</div>
      {z && <>
        <div className="kv"><span>{t.zkAssets}</span><span className="num">{show(z.total)}</span></div>
        <div className="kv"><span>{t.zkNisab}</span><span className="num">{money(z.nisab, cur)}</span></div>
        {z.reached
          ? <div className="kv"><b>{t.zkDue}</b><b className="num">{show(z.due)}</b></div>
          : <div className="kv"><span className="faint">{t.zkBelow}</span></div>}
      </>}
      <div className="faint" style={{ fontSize: 12, padding: "2px 0 8px" }}>{t.zkNote}</div>
    </div>
  );
}
