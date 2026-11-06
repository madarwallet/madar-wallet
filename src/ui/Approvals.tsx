import { RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { Address } from "viem";
import { evmAddress } from "../core/account";
import { readApprovals, revokeApproval, type Approval } from "../core/approvals";
import { activeNetworks } from "../core/chains";
import type { Settings } from "../core/store";
import { amt } from "./common";
import { fill, useT } from "./i18n";
import { NetworkDot, TokenIcon } from "./icons";
import { formatUnits } from "viem";

const DEMO_ROWS: Approval[] = import.meta.env.DEV ? [
  { networkId: "base", token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", symbol: "USDC", decimals: 6, verified: true, spender: "0x000000000022d473030f116ddee9f6b43ac78ba3", spenderName: "Uniswap Permit2", amount: 2n ** 256n - 1n, unlimited: true },
  { networkId: "arbitrum", token: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", symbol: "USDT", decimals: 6, verified: true, spender: "0x6131b5fae19ea4f9d964eac0408e4408b66337b5", spenderName: "KyberSwap", amount: 25_000_000n, unlimited: false },
] : [];

export function Approvals({ settings, phrase, say }: { settings: Settings; phrase: string; say: (m: string) => void }) {
  const { t } = useT();
  const me = evmAddress(phrase, settings.accountIndex) as Address;
  const nets = activeNetworks(settings);
  const [rows, setRows] = useState<Approval[] | null>(null);
  const [failed, setFailed] = useState<string[]>([]);
  const [ask, setAsk] = useState<Approval | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const netKey = nets.map((n) => n.id).join(",");

  const load = useCallback(async () => {
    setRows(null); setFailed([]);
    if (import.meta.env.DEV && location.hash === "#demo-approvals") { setRows(DEMO_ROWS); return; }
    const res = await Promise.all(nets.map((n) => readApprovals(n, me, settings.customTokens).then((a) => ({ a, fail: "" }), () => ({ a: [] as Approval[], fail: n.name }))));
    setRows(res.flatMap((r) => r.a));
    setFailed(res.map((r) => r.fail).filter(Boolean));
  }, [me, netKey, settings.customTokens]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [load]);

  const netOf = (id: string) => nets.find((n) => n.id === id);
  const revoke = async (a: Approval) => {
    const n = netOf(a.networkId);
    if (!n) return;
    setBusy(true); setErr("");
    try {
      await revokeApproval(n, phrase, settings.accountIndex, a.token, a.spender);
      setAsk(null);
      say(t.apprDone);
      await load();
    } catch (e) {
      const m = (e as Error)?.message ?? "";
      setErr(m === "ERR_SIM_FAIL" ? t.sendWouldFail : /insufficient funds/i.test(m) ? fill(t.needGas, { sym: n.native.symbol }) : m === "ERR_FEE_HIGH" ? t.errFeeHigh : /fetch|network|timeout/i.test(m) ? t.errNet : t.errGeneric);
    } finally { setBusy(false); }
  };

  return (
    <div className="sheet">
      <div className="faint" style={{ fontSize: 13 }}>{t.apprNote}</div>
      {rows == null ? <div className="faint row" style={{ gap: 6 }}><RefreshCw size={14} className="spin" />{t.apprScanning}</div>
        : rows.length === 0 ? <div className="note info"><ShieldCheck size={16} />{t.apprNone}</div>
        : (
          <div className="list">
            {rows.map((a) => {
              const n = netOf(a.networkId);
              const key = a.networkId + a.token + a.spender;
              return (
                <div key={key} className="rowi" style={{ flexWrap: "wrap", gap: 8 }}>
                  <TokenIcon symbol={a.symbol} size={28} known={a.verified} />
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="t1 row" style={{ gap: 6 }}><bdi>{a.symbol}</bdi>{!a.verified && <span className="badge warn">{t.unverified}</span>}<span className="faint row" style={{ gap: 4, fontSize: 12 }}><NetworkDot id={a.networkId} size={14} />{n?.name}</span></div>
                    <div className="t2">{t.apprCan}: <b className={a.unlimited ? "down" : ""}>{a.unlimited ? t.apprUnlimited : <bdi dir="ltr">{amt(formatUnits(a.amount, a.decimals), a.symbol)} {a.symbol}</bdi>}</b> · <span dir="ltr">{a.spenderName}</span></div>
                  </div>
                  <button className="btn ghost" style={{ padding: "6px 10px" }} disabled={busy} onClick={() => { setErr(""); setAsk(a); }}>{t.apprRevoke}</button>
                  {ask === a && (
                    <div className="sheet" style={{ width: "100%" }}>
                      <div>{fill(t.apprAsk, { s: a.spenderName, tok: a.symbol, net: n?.name ?? "", sym: n?.native.symbol ?? "" })}</div>
                      {err && <div className="note bad"><TriangleAlert size={16} />{err}</div>}
                      <div className="row" style={{ gap: 8 }}>
                        <button className="btn ghost" style={{ flex: 1 }} disabled={busy} onClick={() => setAsk(null)}>{t.back}</button>
                        <button className="btn danger" style={{ flex: 1 }} disabled={busy} onClick={() => void revoke(a)}>{busy ? t.apprSending : t.apprRevoke}</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      {failed.length > 0 && <div className="faint" style={{ fontSize: 12 }}>{fill(t.apprFailed, { n: failed.join("، ") })}</div>}
      {rows != null && <button className="btn ghost" onClick={() => void load()}><RefreshCw size={14} />{t.refresh}</button>}
    </div>
  );
}
