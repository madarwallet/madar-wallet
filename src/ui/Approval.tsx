import { BadgeCheck, FileSignature, Globe, Link2, ShieldCheck, TriangleAlert } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type { Settings } from "../core/store";
import { reviewAmount, type MessageView } from "../dapp/evmdecode";
import { formatBtc } from "../core/btcbase";
import type { ApprovalView, EvmTxReview, SimView, SiteSolSwap, SolItem } from "../dapp/router";
import { fill, useT, type Dict } from "./i18n";
import { MadarName, NetworkDot } from "./icons";
import { money } from "./common";
import { answer } from "./answer";

const short = (a: string) => (a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);
const accName = (t: Dict, s: Settings, index: number) => s.accounts.find((a) => a.index === index)?.name || `${t.account} ${index + 1}`;
const fmt = (raw: string, decimals: number) => reviewAmount(BigInt(raw), decimals);

export { answer } from "./answer";

export function SiteHeader({ origin }: { origin: string }) {
  const { t } = useT();
  const host = (() => { try { return new URL(origin).host; } catch { return origin; } })();
  return (
    <div className="list" style={{ padding: "12px 14px", display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
      <Globe size={20} />
      <div style={{ minWidth: 0 }}>
        <div className="faint" style={{ fontSize: 12 }}>{t.dRequestFrom}</div>
        <div dir="ltr" style={{ fontWeight: 700, fontSize: 16, wordBreak: "break-all" }}>{host}</div>
      </div>
    </div>
  );
}

function SiteSwapRows({ x }: { x: SiteSolSwap }) {
  const { t } = useT();
  const amt = (raw: string, d: number | null, sym: string | null) => (d != null ? `${fmt(raw, d)} ${sym ?? ""}` : `${raw} (${t.dBaseUnits})`);
  if (x.kind === "jupiter") return (
    <>
      <div className="list" style={{ padding: "4px 14px" }}>
        <KV k={t.youPay}><b className="num">{amt(x.amountIn, x.inDecimals, x.inSymbol)}</b></KV>
        <KV k={t.minReceived}><b className="num">{amt(x.minOut, x.outDecimals, x.outSymbol)}</b></KV>
        <KV k={t.madarFee}>{x.fee ? "0.5%" : t.noFee}</KV>
      </div>
      <div className="note info"><ShieldCheck size={16} />{t.dSiteSwapNote}</div>
    </>
  );
  const minOut = x.outDecimals != null ? (BigInt(x.minOut8) * 10n ** BigInt(Math.max(0, x.outDecimals - Math.min(8, x.outDecimals)))).toString() : x.minOut8;
  return (
    <>
      <div className="list" style={{ padding: "4px 14px" }}>
        <KV k={t.youPay}><b className="num">{amt(x.amount, x.decimals, x.symbol)}</b> · Solana</KV>
        <KV k={t.dToNetwork}><span className="row" style={{ gap: 6 }}>{x.networkId && <NetworkDot id={x.networkId} />}{x.network}</span></KV>
        <KV k={t.minReceived}><b className="num">{amt(minOut, x.outDecimals, x.outSymbol)}</b>{x.outSymbol == null && <> <Mono v={x.tokenOut} /></>}</KV>
        <KV k={t.dReceiver}><Mono v={x.dest} /></KV>
        <KV k={t.madarFee}>{x.fee ? "0.5%" : t.noFee}</KV>
        <KV k={t.crossVia}>Mayan</KV>
      </div>
      {x.ownDest ? <div className="note info"><ShieldCheck size={16} />{t.dOwnDest}</div> : <div className="note warn"><TriangleAlert size={16} />{t.dOtherDest}</div>}
      <div className="note info"><ShieldCheck size={16} />{t.dMayanNote}</div>
    </>
  );
}
const KV = ({ k, children }: { k: string; children: ReactNode }) => <div className="kv"><span>{k}</span><span style={{ textAlign: "end", minWidth: 0, wordBreak: "break-all" }}>{children}</span></div>;
const Mono = ({ v }: { v: string }) => <span className="mono" dir="ltr" style={{ fontSize: 12, wordBreak: "break-all" }}>{v}</span>;
const Box = ({ children }: { children: ReactNode }) => (
  <div className="list mono" dir="ltr" style={{ padding: 12, whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 240, overflow: "auto", fontSize: 12.5, lineHeight: 1.6 }}>{children}</div>
);

export const APPROVE_DELAY_MS = 1000;

export function Approval({ view, settings, pending = 1 }: { view: ApprovalView; settings: Settings; pending?: number }) {
  const { t, lang } = useT();
  const [busy, setBusy] = useState(false), [ok, setOk] = useState(false), [armed, setArmed] = useState(false);
  useEffect(() => {
    setBusy(false); setOk(false); setArmed(false);
    const id = setTimeout(() => setArmed(true), APPROVE_DELAY_MS);
    return () => clearTimeout(id);
  }, [view.id]);
  if (view.kind === "unlock") return null;
  const needsConfirm = "needsConfirm" in view && view.needsConfirm;

  const simFails = view.kind === "evm-tx" && view.review.sim?.status === "fail";

  const scam = view.kind === "evm-tx" && !!view.review.risk?.bad;
  const date = (secs: string) => {
    const n = Number(secs);
    if (!Number.isFinite(n) || n > 32503680000) return t.dNoExpiry;
    return new Date(n * 1000).toLocaleString(lang === "ar" ? "ar-u-nu-latn-ca-gregory" : "en-US");
  };
  const go = async (approve: boolean) => { setBusy(true); await answer(view.id, approve, approve && ok); };

  let title = "", body: ReactNode = null, approveLabel = t.dApprove;
  const account = (
    <>
      <KV k={t.account}>{accName(t, settings, view.accountIndex)}</KV>
      <KV k={t.addressLabel}><Mono v={view.address} /></KV>
    </>
  );

  switch (view.kind) {
    case "connect":
      title = t.dConnectTitle; approveLabel = t.dConnect;
      body = (
        <>
          <div className="list" style={{ padding: "4px 14px" }}>
            {account}
            <KV k={t.network}><span className="row" style={{ gap: 6 }}><NetworkDot id={view.networkId} />{view.chain === "sol" ? t.dSolAccount : `${t.dEvmAccount} · ${view.network}`}</span></KV>
          </div>
          <div className="note info"><Link2 size={16} />{t.dConnectText}</div>
        </>
      );
      break;
    case "name-claim":
      title = t.dNameClaimTitle; approveLabel = t.dNameClaim;
      body = (
        <>
          <div className="namecard gold" style={{ marginBottom: 12 }}><div className="namebig"><MadarName name={view.name} /></div></div>
          <div className="list" style={{ padding: "4px 14px" }}>
            {account}
            <KV k={t.dValidUntil}><span dir="ltr">{view.until} UTC</span></KV>
          </div>
          <div className="note info"><BadgeCheck size={16} />{t.dNameClaimText}</div>
          <div className="note warn"><TriangleAlert size={16} />{t.dNameClaimCheck}</div>
        </>
      );
      break;
    case "evm-message":
    case "sol-message": {
      title = t.dSignTitle; approveLabel = t.dSign;
      const m = view.message;
      body = (
        <>
          <div className="list" style={{ padding: "4px 14px" }}>{account}<KV k={t.network}>{view.kind === "sol-message" ? "Solana" : view.network}</KV></div>
          <NamesNote m={m} />
          <div className="field">{t.dMessage}</div>
          <Box>{m.text ?? m.hex}</Box>
        </>
      );
      break;
    }
    case "evm-typed": {
      const p = view.permit, p2 = view.permit2;
      title = p || p2 ? t.dPermitTitle : t.dTypedTitle; approveLabel = t.dSign;
      body = p2 ? (
        <>
          <div className="list" style={{ padding: "4px 14px" }}>
            {account}
            <KV k={t.network}>{view.network}</KV>
            <KV k={t.dTxTitle}><b>{p2.kind === "allowance" ? t.dPermit2Allowance : t.dPermit2Transfer}</b><div><Mono v="Permit2" /></div></KV>
            <KV k={t.dSpender}><Mono v={p2.spender} /></KV>
            {p2.tokens.map((x, i) => (
              <div key={i}>
                <KV k={t.dToken}><span className="row" style={{ gap: 6, justifyContent: "flex-end", flexWrap: "wrap" }}><b>{x.symbol ?? "?"}</b>{!x.verified && <span className="badge warn">{t.unverified}</span>}</span><div><Mono v={x.token} /></div></KV>
                <KV k={t.dAllowed}><b className="num">{x.unlimited ? t.dUnlimited : x.decimals != null ? `${fmt(x.amount, x.decimals)} ${x.symbol ?? ""}` : `${x.amount} (${t.dBaseUnits})`}</b></KV>
                {x.expiration != null && <KV k={t.dPermit2Expires}>{date(x.expiration)}</KV>}
              </div>
            ))}
            <KV k={t.dDeadline}>{date(p2.deadline)}</KV>
          </div>
          <div className="note info"><FileSignature size={16} />{p2.kind === "allowance" ? t.dPermit2AllowanceText : t.dPermit2TransferText}</div>
          {p2.tokens.some((x) => x.unlimited) && <div className="note bad"><TriangleAlert size={16} />{t.dUnlimitedWarn}</div>}
          {!p2.spenderKnown && <div className="note warn"><TriangleAlert size={16} />{t.dSpenderUnknown}</div>}
          {p2.tokens.some((x) => x.decimals == null) && <div className="note warn"><TriangleAlert size={16} />{t.dUnknownToken}</div>}
        </>
      ) : p ? (
        <>
          <div className="list" style={{ padding: "4px 14px" }}>
            {account}
            <KV k={t.network}>{view.network}</KV>
            <KV k={t.dToken}><span className="row" style={{ gap: 6, justifyContent: "flex-end", flexWrap: "wrap" }}><b>{p.symbol ?? p.tokenName ?? "?"}</b>{!p.verified && <span className="badge warn">{t.unverified}</span>}</span><div><Mono v={p.token} /></div></KV>
            <KV k={t.dSpender}>{p.spenderIsSplit && <SplitBadge />}<Mono v={p.spender} /></KV>
            <KV k={t.dAllowed}><b className="num">{p.unlimited ? t.dUnlimited : p.decimals != null ? `${fmt(p.value, p.decimals)} ${p.symbol ?? ""}` : `${p.value} (${t.dBaseUnits})`}</b></KV>
            <KV k={t.dDeadline}>{date(p.deadline)}</KV>
            <KV k={t.dNonce}><span className="num">{p.nonce}</span></KV>
          </div>
          <div className="note info"><FileSignature size={16} />{t.dPermitText}</div>
          {p.unlimited && <div className="note bad"><TriangleAlert size={16} />{t.dUnlimitedWarn}</div>}
          {!p.spenderKnown && <div className="note warn"><TriangleAlert size={16} />{t.dSpenderUnknown}</div>}
          {p.decimals == null && <div className="note warn"><TriangleAlert size={16} />{t.dUnknownToken}</div>}
        </>
      ) : (
        <>
          <div className="list" style={{ padding: "4px 14px" }}>{account}<KV k={t.network}>{view.network}</KV><KV k={t.dType}><Mono v={view.primaryType} /></KV></div>
          <div className="note warn"><TriangleAlert size={16} />{t.dTypedWarn}</div>
          <div className="field">{t.dDomain}</div>
          <Box>{view.domain.map(([k, v]) => `${k}: ${v}`).join("\n")}</Box>
          <div className="field">{t.dFields}</div>
          <Box>{view.fields.map(([k, v]) => `${k}: ${v}`).join("\n")}</Box>
        </>
      );
      break;
    }
    case "evm-tx": {
      const r = view.review, c = r.call;
      title = t.dTxTitle; approveLabel = t.confirmSend;
      const tokAmt = (raw: string) => (c.kind === "erc20" && c.token ? `${fmt(raw, c.token.decimals)} ${c.token.symbol}` : `${raw} (${t.dBaseUnits})`);
      const fnName = c.kind === "erc20" ? { transfer: t.dFnTransfer, transferFrom: t.dFnTransferFrom, approve: t.dFnApprove, increaseAllowance: t.dFnIncrease, permit: t.dFnPermit }[c.fn] : "";
      const label: Record<string, string> = { recipient: t.to, from: t.dFrom, spender: t.dSpender, owner: t.dOwner, amount: t.amount, deadline: t.dDeadline };
      body = (
        <>
          <div className="list" style={{ padding: "4px 14px" }}>
            {account}
            <KV k={t.network}><span className="row" style={{ gap: 6 }}><NetworkDot id={view.networkId} />{view.network}</span></KV>
            {c.kind === "erc20" && (
              <>
                <KV k={t.dTxTitle}><b>{fnName}</b></KV>
                <KV k={t.dToken}>{c.token ? <span className="row" style={{ gap: 6, justifyContent: "flex-end", flexWrap: "wrap" }}><b>{c.token.symbol}</b>{!c.token.verified && <span className="badge warn">{t.unverified}</span>}</span> : t.dUnknownToken}<div><Mono v={r.to} /></div></KV>
                {c.fields.map((f) => (
                  <KV key={f.k} k={f.k === "amount" && (c.fn === "approve" || c.fn === "increaseAllowance" || c.fn === "permit") ? t.dAllowed : label[f.k]}>
                    {f.k === "amount" ? <b className="num">{c.unlimited ? t.dUnlimited : tokAmt(f.v)}</b> : f.k === "deadline" ? date(f.v) : <>{f.k === "spender" && c.spenderIsSplit && <SplitBadge />}{f.k === "spender" && c.spenderIsKyber && <KyberBadge />}{f.k === "spender" && c.spenderName && <NamedBadge name={c.spenderName} />}<Mono v={f.v} /></>}
                  </KV>
                ))}
              </>
            )}
            {c.kind === "split" && <SplitRows c={c} />}
            {c.kind === "kyber" && <KyberRows c={c} r={r} />}
            {c.kind === "lifi" && <LifiRows c={c} r={r} />}
            {c.kind === "thor" && <ThorRows c={c} r={r} />}
            {c.kind !== "erc20" && c.kind !== "split" && <KV k={c.kind === "none" ? t.to : t.dContract}>{c.kind === "kyber" && <KyberBadge />}<Mono v={r.to} /></KV>}
            {c.kind === "unknown" && <KV k={t.dTxTitle}><b>{t.dUnknownCall}</b> <Mono v={c.selector} /></KV>}
            {(c.kind === "none" || r.value !== "0") && <KV k={fill(t.dValue, { sym: r.nativeSymbol })}><b className="num">{fmt(r.value, r.nativeDecimals)} {r.nativeSymbol}</b></KV>}
            <KV k={t.fee}><span className="num">{fmt(r.fee, r.nativeDecimals)} {r.nativeSymbol}</span></KV>
          </div>
          {c.kind === "split" && <div className="note info"><ShieldCheck size={16} />{t.dSplitNote}</div>}
          {c.kind === "kyber" && <div className="note info"><ShieldCheck size={16} />{t.dKyberNote}</div>}
          {c.kind === "lifi" && <div className="note info"><ShieldCheck size={16} />{t.dLifiNote}</div>}
          {c.kind === "thor" && <div className="note info"><ShieldCheck size={16} />{t.dThorNote}</div>}
          {c.kind === "thor" && c.minOut == null && <div className="note bad"><TriangleAlert size={16} />{t.dThorNoMin}</div>}
          {c.kind === "thor" && c.affiliate && !c.affiliateKnown && <div className="note warn"><TriangleAlert size={16} /><span>{fillNodes(t.dThorAffWarn, { p: String((c.affiliateBps ?? 0) / 100), a: c.affiliate })}</span></div>}
          {c.kind === "lifi" && !c.receiverIsMe && <div className="note warn"><TriangleAlert size={16} />{t.dLifiNotYou}</div>}
          {c.kind === "thor" && !c.destIsMine && <div className="note warn"><TriangleAlert size={16} />{t.dLifiNotYou}</div>}
          {c.kind === "lifi" && !c.refundIsMe && <div className="note bad"><TriangleAlert size={16} />{t.dLifiRefundBad}</div>}
          {c.kind === "lifi" && c.otherFees && <div className="note bad"><TriangleAlert size={16} />{t.dLifiOtherFee}</div>}
          {c.kind === "lifi" && c.tokenIn && !c.payInfo && <div className="note warn"><TriangleAlert size={16} />{t.dUnknownWarn}</div>}
          {c.kind === "kyber" && ((c.tokenIn && !c.payInfo) || (c.tokenOut && !c.getInfo)) && <div className="note warn"><TriangleAlert size={16} />{t.dUnknownWarn}</div>}
          {c.kind === "split" && c.nameVerified === false && <div className="note bad"><TriangleAlert size={16} />{t.dSplitNameBad}</div>}
          {c.kind === "split" && !c.validRate && <div className="note bad"><TriangleAlert size={16} />{t.dSplitBadRate}</div>}
          {c.kind === "split" && !c.tokenInfo && <div className="note warn"><TriangleAlert size={16} />{t.dUnknownWarn}</div>}
          {c.kind === "erc20" && c.unlimited && <div className="note bad"><TriangleAlert size={16} />{t.dUnlimitedWarn}</div>}
          {c.kind === "erc20" && c.fn !== "transfer" && c.fn !== "transferFrom" && !c.spenderKnown && <div className="note warn"><TriangleAlert size={16} />{t.dSpenderUnknown}</div>}
          {c.kind === "unknown" && <><div className="note warn"><TriangleAlert size={16} />{t.dUnknownWarn}</div><div className="field">{t.dData}</div><Box>{c.data.length > 4000 ? c.data.slice(0, 4000) + "…" : c.data}</Box></>}
          {c.kind === "erc20" && !c.token && <div className="note warn"><TriangleAlert size={16} />{t.dUnknownWarn}</div>}
          {r.risk?.bad && <div className="note bad"><TriangleAlert size={16} /><span>{fill(t.scamCall, { a: r.risk.address })}</span></div>}
          <SimRows sim={r.sim ?? null} />
          <div className="note warn"><TriangleAlert size={16} />{t.irreversible}</div>
        </>
      );
      break;
    }
    case "btc-send": {
      title = t.dBtcSendTitle; approveLabel = t.confirmSend;
      const sats = BigInt(view.sats), fee = BigInt(view.fee);
      const cash = (v: bigint) => (view.price != null ? <div className="faint num">{money((Number(v) / 1e8) * view.price, view.currency)}</div> : null);
      body = (
        <>
          <div className="list" style={{ padding: "4px 14px" }}>
            {account}
            <KV k={t.network}><span className="row" style={{ gap: 6 }}><NetworkDot id="bitcoin" />Bitcoin</span></KV>
            <KV k={t.to}><Mono v={view.to} /></KV>
            <KV k={t.amount}><b className="num" dir="ltr">{formatBtc(sats)} BTC</b>{cash(sats)}</KV>
            <KV k={t.btcFee}><span className="num" dir="ltr">{formatBtc(fee)} BTC · {view.feeRate} sat/vB</span>{cash(fee)}</KV>
            <KV k={t.total}><b className="num" dir="ltr">{formatBtc(sats + fee)} BTC</b>{cash(sats + fee)}</KV>
          </div>
          <div className="note warn"><TriangleAlert size={16} />{t.dBtcSendText}</div>
        </>
      );
      break;
    }
    case "sol-tx": {
      const r = view.review;
      title = t.dSolTxTitle; approveLabel = view.send ? t.confirmSend : t.dSign;
      body = (
        <>
          <div className="list" style={{ padding: "4px 14px" }}>
            {account}
            <KV k={t.network}><span className="row" style={{ gap: 6 }}><NetworkDot id="solana" />Solana</span></KV>
            <KV k={t.dFeePayer}>{r.payerIsYou ? t.dYou : <Mono v={r.feePayer} />}</KV>
            <KV k={t.dSolFee}><span className="num">{fmt(r.fee, 9)} SOL</span></KV>
          </div>
          {!r.payerIsYou && <div className="note info"><Globe size={16} />{t.dOtherPays}</div>}
          {r.otherSigners > 0 && <div className="note info"><Globe size={16} />{fill(t.dOtherSigners, { n: String(r.otherSigners) })}</div>}
          {r.site && <SiteSwapRows x={r.site} />}
          <div className="field">{t.dSteps}</div>
          <div className="list" style={{ padding: "4px 14px" }}>{r.items.map((x, i) => <SolStep key={i} x={x} me={view.address} checked={!!r.site} />)}</div>
          {!view.send && <div className="note info"><FileSignature size={16} />{t.dSignOnly}</div>}
          {!r.site && r.items.some((x) => x.kind === "unknown" || x.incomplete) && <div className="note warn"><TriangleAlert size={16} />{t.dUnknownWarn}</div>}
          {view.send && <div className="note warn"><TriangleAlert size={16} />{t.irreversible}</div>}
        </>
      );
      break;
    }
  }

  return (
    <div className="page stack" style={{ maxWidth: 520, margin: "0 auto", padding: "16px 16px 24px" }}>
      <SiteHeader origin={view.origin} />
      {pending > 1 && <div className="note info"><Globe size={16} />{fill(t.dPendingCount, { n: String(pending) })}</div>}
      <h1 style={{ marginTop: 0 }}>{title}</h1>
      {body}
      {needsConfirm && (
        <label className="row" style={{ gap: 8, alignItems: "flex-start", fontSize: 13, cursor: "pointer" }}>
          <input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} style={{ marginTop: 3 }} />{confirmText(t, view)}
        </label>
      )}
      <button className="btn primary block" disabled={busy || !armed || (needsConfirm && !ok) || simFails || scam} onClick={() => go(true)}><BadgeCheck size={16} />{approveLabel}</button>
      <button className="btn ghost block" disabled={busy} onClick={() => go(false)}>{t.dReject}</button>
    </div>
  );
}

export function confirmText(t: Dict, view: ApprovalView): string {
  switch (view.kind) {
    case "evm-message":
    case "sol-message": return view.message.text == null ? t.dHexConfirm : t.dNamesConfirm;
    case "btc-send": return t.dBtcSendConfirm;
    case "evm-typed": return (view.permit && view.permit.decimals != null) || (view.permit2 && view.permit2.tokens.every((x) => x.decimals != null)) ? t.dApproveConfirm : t.dUnknownConfirm;
    case "evm-tx": {
      const c = view.review.call;
      if (c.kind === "unknown" || (c.kind === "erc20" && !c.token)) return t.dUnknownConfirm;
      if (c.kind === "erc20" && c.fn !== "transfer" && c.fn !== "transferFrom") return t.dApproveConfirm;
      return c.kind === "thor" || c.kind === "lifi" || c.kind === "split" || c.kind === "kyber" ? t.dWarnConfirm : t.dUnknownConfirm;
    }
    default: return t.dUnknownConfirm;
  }
}

const fillNodes = (s: string, vars: Record<string, string>) => s.split(/\{(\w+)\}/).map((part, i) => (i % 2 ? <bdi key={i} dir="ltr"><b>{vars[part] ?? ""}</b></bdi> : part));

function NamesNote({ m }: { m: MessageView }) {
  const { t } = useT();
  const n = m.names;
  if (n?.kind === "register") return <div className="note info"><FileSignature size={16} /><span>{fillNodes(t.dNamesRegister, { name: `${n.name}.madar` })}</span></div>;
  if (n?.kind === "sale") return <div className="note bad"><TriangleAlert size={16} /><span>{fillNodes(t.dNamesSale, { name: `${n.name}.madar`, price: `${n.price} USD`, to: n.payTo })}</span></div>;
  if (n?.kind === "buy") return <div className="note bad"><TriangleAlert size={16} /><span>{fillNodes(t.dNamesBuy, { name: `${n.name}.madar`, price: `${n.price} USD` })}</span></div>;
  if (n?.kind === "link") return <div className="note bad"><TriangleAlert size={16} /><span>{fillNodes(t.dNamesLink, { name: `${n.name}.madar` })}</span></div>;
  if (n?.kind === "transfer") return <div className="note bad"><TriangleAlert size={16} />{t.dNamesTransfer}</div>;
  return m.text != null ? <div className="note info"><FileSignature size={16} />{t.dSignNote}</div> : <div className="note warn"><TriangleAlert size={16} />{t.dHexNote}</div>;
}

function SimRows({ sim }: { sim: SimView | null }) {
  const { t } = useT();
  if (!sim) return null;

  if (sim.status === "unknown") return <div className="note warn"><TriangleAlert size={16} /><span>{t.simUnknown}</span></div>;
  if (sim.status === "fail") {
    const why = ({ balance: t.simWhyBalance, allowance: t.simWhyAllowance, price: t.simWhyPrice, expired: t.simWhyExpired } as Record<string, string>)[sim.reason ?? ""] ?? "";
    return <div className="note bad"><TriangleAlert size={16} /><span>{t.simFail} {why}</span></div>;
  }
  if (!sim.changes) return <div className="note info"><ShieldCheck size={16} />{t.simOk}</div>;
  if (!sim.changes.length) return null;
  return (
    <>
      <div className="field">{t.simTitle}</div>
      <div className="list" style={{ padding: "4px 14px" }}>
        {sim.changes.map((c) => {
          const neg = c.delta.startsWith("-"), abs = neg ? c.delta.slice(1) : c.delta;
          const amount = c.nft ? `${abs} NFT` : c.decimals != null ? `${fmt(abs, c.decimals)} ${c.symbol ?? ""}` : `${abs} (${t.dBaseUnits})`;
          return (
            <KV key={c.token + (c.nft ? ":nft" : "")} k={c.token === "native" || c.verified ? (c.symbol ?? "") : t.dUnknownToken}>
              <b className={"num " + (neg ? "down" : "up")} dir="ltr">{neg ? "−" : "+"}{amount}</b>
              {c.token !== "native" && !c.verified && <div><span className="badge warn">{t.unverified}</span> <Mono v={c.token} /></div>}
            </KV>
          );
        })}
      </div>
      <div className="faint" style={{ fontSize: 12, margin: "-4px 2px 8px" }}>{t.simNote}</div>
    </>
  );
}

const SplitBadge = () => { const { t } = useT(); return <div className="row" style={{ gap: 4, justifyContent: "flex-end", fontSize: 12 }}><BadgeCheck size={13} />{t.dSplitContract}</div>; };

const NamedBadge = ({ name }: { name: string }) => <div className="row" style={{ gap: 4, justifyContent: "flex-end", fontSize: 12 }}><BadgeCheck size={13} /><span dir="ltr">{name}</span></div>;

const KyberBadge = () => { const { t } = useT(); return <div className="row" style={{ gap: 4, justifyContent: "flex-end", fontSize: 12 }}><BadgeCheck size={13} />{t.dKyberRouter}</div>; };

function KyberRows({ c, r }: { c: Extract<EvmTxReview["call"], { kind: "kyber" }>; r: EvmTxReview }) {
  const { t } = useT();
  const side = (addr: string | null, info: typeof c.payInfo) => (addr == null ? { sym: r.nativeSymbol, dec: r.nativeDecimals, verified: true } : info ? { sym: info.symbol, dec: info.decimals, verified: info.verified } : null);
  const pay = side(c.tokenIn, c.payInfo), get = side(c.tokenOut, c.getInfo);
  const amt = (raw: string, s: typeof pay) => (s ? `${fmt(raw, s.dec)} ${s.sym}` : `${raw} (${t.dBaseUnits})`);
  const tok = (addr: string | null, s: typeof pay) => (
    <>{!s ? <div>{t.dUnknownToken}</div> : !s.verified && <div><span className="badge warn">{t.unverified}</span></div>}{addr && <div><Mono v={addr} /></div>}</>
  );
  return (
    <>
      <KV k={t.dTxTitle}><span className="row" style={{ gap: 6, justifyContent: "flex-end", flexWrap: "wrap" }}><b>{t.dKyberSwap}</b><span className="badge ok">{t.dSplitVerified}</span></span></KV>
      <KV k={t.dKyberPay}><b className="num">{amt(c.amountIn, pay)}</b>{tok(c.tokenIn, pay)}</KV>
      {c.feeBps > 0 && <KV k={fill(t.dKyberFee, { p: String(c.feeBps / 100) })}><span className="num">{amt(c.fee, pay)}</span></KV>}
      <KV k={t.dKyberGet}><b className="num">{amt(c.minOut, get)}</b>{tok(c.tokenOut, get)}</KV>
      <KV k={t.dKyberTo}>{t.dYou}</KV>
    </>
  );
}

function LifiRows({ c, r }: { c: Extract<EvmTxReview["call"], { kind: "lifi" }>; r: EvmTxReview }) {
  const { t } = useT();
  const pay = c.tokenIn == null ? { sym: r.nativeSymbol, dec: r.nativeDecimals } : c.payInfo ? { sym: c.payInfo.symbol, dec: c.payInfo.decimals } : null;
  const amt = (raw: string) => (pay ? `${fmt(raw, pay.dec)} ${pay.sym}` : `${raw} (${t.dBaseUnits})`);
  const outSym = c.dest.kind === "btc" ? "BTC" : c.dest.kind === "sol" ? (c.tokenOut === "SOL" ? "SOL" : null) : c.getInfo?.symbol ?? null;
  const outDec = c.minOutDecimals ?? c.getInfo?.decimals ?? null;
  const bridgeName = { across: "Across", mayan: "Mayan", layerswap: "LayerSwap", near: "NEAR Intents" }[c.bridge];
  return (
    <>
      <KV k={t.dTxTitle}><span className="row" style={{ gap: 6, justifyContent: "flex-end", flexWrap: "wrap" }}><b dir="auto">{t.dLifiTitle}</b><span className="badge ok">{bridgeName}</span></span></KV>
      <KV k={t.dLifiPay}><b className="num">{amt(c.amountIn)}</b>{c.tokenIn && !c.payInfo && <div><Mono v={c.tokenIn} /></div>}</KV>
      <KV k={t.dLifiDest}><b>{c.dest.network}</b></KV>
      <KV k={t.dLifiGet}>{c.minOut != null && outDec != null ? <b className="num">{fmt(c.minOut, outDec)} {outSym ?? ""}</b> : <span dir="auto">{fill(t.dLifiGetBridge, { b: bridgeName })}</span>}{c.dest.kind === "sol" && c.tokenOut && c.tokenOut !== "SOL" && <div><Mono v={c.tokenOut} /></div>}</KV>
      <KV k={t.dLifiTo}>{c.receiverIsMe ? <b dir="auto">{fill(t.dLifiYouOn, { c: c.dest.network })}</b> : null}<div><Mono v={c.receiver} /></div></KV>
      {c.refund && <KV k={t.dLifiRefund}>{c.refundIsMe ? <b>{t.dYou}</b> : <Mono v={c.refund} />}</KV>}
      {c.madarFee !== "0" && <KV k={t.dLifiMadarFee}><span className="num">{amt(c.madarFee)}</span></KV>}
      {c.lifiFee !== "0" && <KV k={t.dLifiLifiFee}><span className="num">{amt(c.lifiFee)}</span></KV>}
    </>
  );
}

function ThorRows({ c, r }: { c: Extract<EvmTxReview["call"], { kind: "thor" }>; r: EvmTxReview }) {
  const { t } = useT();
  const pay = c.tokenIn == null ? { sym: r.nativeSymbol, dec: r.nativeDecimals } : c.payInfo ? { sym: c.payInfo.symbol, dec: c.payInfo.decimals } : null;
  return (
    <>
      <KV k={t.dTxTitle}><span className="row" style={{ gap: 6, justifyContent: "flex-end", flexWrap: "wrap" }}><b dir="auto">{fill(t.dThorTitle, { coin: c.coin })}</b><span className="badge ok">THORChain</span></span></KV>
      <KV k={t.dLifiPay}><b className="num">{pay ? `${fmt(c.amountIn, pay.dec)} ${pay.sym}` : `${c.amountIn} (${t.dBaseUnits})`}</b>{c.tokenIn && !c.payInfo && <div><Mono v={c.tokenIn} /></div>}</KV>
      <KV k={t.dLifiGet}>{c.minOut != null ? <b className="num">{fmt(c.minOut, c.outDecimals)} {c.coin}</b> : <span>—</span>}</KV>
      <KV k={t.dLifiTo}>{c.destIsMine ? <b dir="auto">{fill(t.dLifiYouOn, { c: c.coin })}</b> : null}<div><Mono v={c.dest} /></div></KV>
      <KV k={t.dThorVault}>{c.vaultChecked && <div className="row" style={{ gap: 4, justifyContent: "flex-end", fontSize: 12 }}><BadgeCheck size={13} />{t.dThorVaultOk}</div>}<Mono v={c.vault} /></KV>
      <KV k={t.dThorExpiry}><span dir="ltr">{new Date(c.expiry * 1000).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</span></KV>
      <KV k={t.dThorAffiliate}>{c.affiliate ? <span dir="ltr">{c.affiliate} · {(c.affiliateBps ?? 0) / 100}%</span> : t.noFee}</KV>
    </>
  );
}

function SplitRows({ c }: { c: Extract<EvmTxReview["call"], { kind: "split" }> }) {
  const { t } = useT();
  const tok = c.tokenInfo;
  const amt = (raw: string) => (tok ? `${fmt(raw, tok.decimals)} ${tok.symbol}` : `${raw} (${t.dBaseUnits})`);
  const ref = c.ref;
  const giftName = ref.kind === "gift" ? ((t as Record<string, string>)[`gift_${ref.gift}`] ?? ref.gift) : "";
  return (
    <>
      <KV k={t.dTxTitle}><span className="row" style={{ gap: 6, justifyContent: "flex-end", flexWrap: "wrap" }}><b>{t.dSplitContract}</b><span className="badge ok">{t.dSplitVerified}</span></span></KV>
      <KV k={t.dSplitKind}><b>{ref.kind === "gift" ? fill(t.dSplitGift, { g: giftName }) : t.dSplitSupport}</b></KV>
      <KV k={t.dToken}>{tok ? <span className="row" style={{ gap: 6, justifyContent: "flex-end", flexWrap: "wrap" }}><b>{tok.symbol}</b>{!tok.verified && <span className="badge warn">{t.unverified}</span>}</span> : t.dUnknownToken}<div><Mono v={c.token} /></div></KV>
      <KV k={t.dSplitRecipient}><Mono v={c.recipient} /></KV>
      {(ref.kind === "gift" || ref.kind === "name") && (
        <KV k={t.dSplitName}><span className="row" style={{ gap: 6, justifyContent: "flex-end" }}><b dir="ltr">{ref.name}.madar</b>{c.nameVerified && <BadgeCheck size={14} aria-label={t.dSplitNameOk} />}</span>{c.nameVerified && <div className="faint" style={{ fontSize: 12 }}>{t.dSplitNameOk}</div>}</KV>
      )}
      <KV k={t.dSplitTotal}><b className="num">{amt(c.amount)}</b></KV>
      <KV k={fill(t.dSplitFee, { p: String(c.feeBps / 100) })}><span className="num">{amt(c.fee)}</span></KV>
      <KV k={t.dSplitGets}><b className="num">{amt(c.recipientGets)}</b></KV>
    </>
  );
}

const CHECKED_PROGRAMS: Record<string, string> = { JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4: "Jupiter", mayan34VedncxdK2XobtvWFDXQASUTBXhUVzt2kKgny: "Mayan Swift" };
function SolStep({ x, me, checked }: { x: SolItem; me: string; checked?: boolean }) {
  const { t } = useT();
  const who = (a: string | null | undefined) => (!a ? "?" : a === me ? t.dYou : short(a));
  const amount = (raw: string, d: number | null | undefined, sym: string | null | undefined) => (d != null ? `${fmt(raw, d)} ${sym ?? ""}` : `${raw} (${t.dBaseUnits})`);
  let head = "", lines: [string, ReactNode][] = [];
  switch (x.kind) {
    case "sol-transfer": head = t.dIxSol; lines = [[t.amount, <b className="num">{fmt(x.lamports, 9)} SOL</b>], [t.dFrom, who(x.from)], [t.to, <Mono v={x.to ?? "?"} />]]; break;
    case "create-account": head = t.dIxCreateAcc; lines = [[t.amount, <b className="num">{fmt(x.lamports, 9)} SOL</b>], [t.dFrom, who(x.from)], [t.addressLabel, <Mono v={x.account ?? "?"} />]]; break;
    case "token-transfer":
      head = t.dIxToken;
      lines = [[t.amount, <b className="num">{amount(x.amount, x.decimals, x.symbol)}</b>], [t.dToken, x.symbol ?? <Mono v={x.mint ?? "?"} />], [t.dFrom, who(x.authority)],
        [t.to, x.destOwner ? <Mono v={x.destOwner} /> : <span><Mono v={x.dest ?? "?"} /> <span className="faint">({t.dTokenAccount})</span></span>]];
      break;
    case "token-approve": head = t.dIxApprove; lines = [[t.dAllowed, <b className="num">{amount(x.amount, x.decimals, x.symbol)}</b>], [t.dToken, x.symbol ?? <Mono v={x.mint ?? "?"} />], [t.dSpender, <Mono v={x.delegate ?? "?"} />]]; break;
    case "token-close": head = t.dIxClose; lines = [[t.dTokenAccount, <Mono v={x.account ?? "?"} />], [t.to, who(x.dest)]]; break;
    case "sync-native": head = t.dIxSync; break;
    case "create-ata": head = t.dIxAta; lines = [[t.dToken, x.symbol ?? <Mono v={x.mint ?? "?"} />], [t.dWallet, who(x.owner)]]; break;
    case "compute-limit": head = t.dIxLimit; lines = [["", <span className="num">{x.units.toLocaleString("en-US")}</span>]]; break;
    case "compute-price": head = t.dIxPrice; lines = [["", <span className="num">{x.microLamports} µLamports/CU</span>]]; break;
    case "memo": head = t.dIxMemo; lines = [["", <span dir="auto" style={{ whiteSpace: "pre-wrap" }}>{x.text}</span>]]; break;
    case "unknown": head = checked && CHECKED_PROGRAMS[x.program] ? CHECKED_PROGRAMS[x.program] : t.dIxUnknown; lines = [["", <Mono v={x.program} />]]; break;
  }
  const bad = (x.kind === "unknown" && !(checked && CHECKED_PROGRAMS[x.program])) || (x.incomplete && !checked);
  return (
    <div style={{ padding: "10px 0", borderBottom: "1px solid var(--line)" }}>
      <div className="row" style={{ gap: 6, fontWeight: 600, fontSize: 13, color: bad ? "var(--warn)" : undefined }}>{bad && <TriangleAlert size={14} />}{head}</div>
      {lines.map(([k, v], i) => <div key={i} className="kv" style={{ borderBottom: 0, padding: "4px 0" }}><span>{k}</span><span style={{ textAlign: "end", minWidth: 0, wordBreak: "break-all" }}>{v}</span></div>)}
      {x.incomplete && <div className="faint" style={{ fontSize: 12 }}>{t.dIncomplete}</div>}
    </div>
  );
}
