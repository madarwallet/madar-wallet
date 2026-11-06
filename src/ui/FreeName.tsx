import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { evmAddress } from "../core/account";
import { networkById } from "../core/chains";
import { quoteSend, send } from "../core/chainops";
import { checkName, claimFreeName, freeStatus, NAME_RE, signRegister, type FreeCheck } from "../core/freeName";
import { NAME_RAILS, orderName, orderStatus, saveOrder, type NameOrder, type OrderState } from "../core/nameBuy";
import { formatUnitsStr } from "../core/solbase";
import { fill, useT } from "./i18n";
import { MadarName } from "./icons";

const ERR_KEYS = ["already_claimed", "taken", "premium", "bad_name", "not_allowed", "address_full", "day_full", "too_many", "madar_wallet", "held", "excluded"] as const;
const netName = (id: string) => (id === "solana" ? "Solana" : networkById(id)?.name ?? id);

export function FreeNameClaim({ phrase, index, onClose }: { phrase: string; index: number; onClose: () => void }) {
  const { t } = useT();
  const [name, setName] = useState("");
  const [dropped, setDropped] = useState(false);
  const [info, setInfo] = useState<{ kind: FreeCheck; usd: number | null } | "loading" | null>(null);
  const [had, setHad] = useState<string | null | undefined>(undefined);
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const [done, setDone] = useState<{ name: string; key: string } | null>(null), [copied, setCopied] = useState(false);
  const [rail, setRail] = useState(NAME_RAILS[0].id);
  const [order, setOrder] = useState<NameOrder | null>(null), [fee, setFee] = useState<string | null>(null);
  const [state, setState] = useState<OrderState | null>(null);
  const n = name.trim().toLowerCase();
  useEffect(() => {
    let live = true;
    freeStatus(evmAddress(phrase, index), true).then((s) => { if (live) { setHad(s.claimed ? s.name ?? "" : null); setOpen(s.open); } }, () => { if (live) setHad(null); });
    return () => { live = false; };
  }, [phrase, index]);
  useEffect(() => {
    setErr("");
    if (!n) { setInfo(null); return; }
    if (!NAME_RE.test(n)) { setInfo({ kind: "bad", usd: null }); return; }
    setInfo("loading");
    let live = true;
    const tm = setTimeout(() => { checkName(n).then((c) => { if (live) setInfo(c); }, () => { if (live) setInfo(null); }); }, 400);
    return () => { live = false; clearTimeout(tm); };
  }, [n]);
  useEffect(() => {
    if (!order || !state || state === "written" || state === "void") return;
    let live = true;
    const tick = async () => {
      const s = await orderStatus(order.key).catch(() => null);
      if (!live || !s) return;
      setState(s);
      void saveOrder({ key: order.key, name: order.name, at: Date.now(), state: s });
    };
    const id = setInterval(() => void tick(), 10_000);
    void tick();
    return () => { live = false; clearInterval(id); };
  }, [order, state === "written" || state === "void"]);

  const errText = (e: unknown) => {
    const m = String((e as Error)?.message ?? ""), code = m.split(":")[0];
    if ((ERR_KEYS as readonly string[]).includes(code)) return t[`fnE_${code}` as keyof typeof t] as string;
    if (/^paused\b|booking opens soon/i.test(m)) return t.fnPaused;
    if (m === "ERR_UNSAFE") return t.fnUnsafe;
    if (m === "ERR_FUNDS" || /insufficient|exceeds balance|transfer amount exceeds/i.test(m)) return t.errFunds;
    if (m === "ERR_GAS") return t.errFunds;

    if (/^[a-z_]+:|^HTTP [45]\d\d/.test(m) || /^(forbidden|bad request|try_again)$/.test(m)) return t.fnE_server;
    return t.errNet;
  };
  const ci = info === "loading" ? null : info;
  const free = ci?.kind === "free" && had === null;
  const forSale = !!ci && ci.usd != null && (ci.kind === "premium" || (ci.kind === "free" && !!had));

  const claim = async () => {
    setBusy(true); setErr("");
    try { setDone(await claimFreeName(phrase, index, n)); } catch (e) { setErr(errText(e)); }
    setBusy(false);
  };
  const startOrder = async () => {
    if (!ci?.usd) return;
    setBusy(true); setErr("");
    try {
      const o = await orderName(phrase, index, n, rail, ci.usd, signRegister);
      setOrder(o);
      const r = NAME_RAILS.find((x) => x.id === rail)!;
      if (r.netId === "solana") {
        const { quoteSolSend } = await import("../core/sol");
        const q = await quoteSolSend(phrase, index, o.invoice.payTo, o.invoice.amount, o.invoice.token);
        setFee(`${formatUnitsStr(q.feeLamports, 9)} SOL`);
      } else {
        const network = networkById(r.netId)!;
        const q = await quoteSend({ network, phrase, accountIndex: index, asset: { kind: "token", token: o.invoice.token }, to: o.invoice.payTo, amount: o.invoice.amount });
        setFee(`${formatUnitsStr(q.feeNative, network.chain.nativeCurrency.decimals)} ${network.native.symbol}`);
      }
    } catch (e) { setErr(errText(e)); }
    setBusy(false);
  };
  const pay = async () => {
    if (!order) return;
    setBusy(true); setErr("");
    try {
      const r = NAME_RAILS.find((x) => x.id === order.invoice.railId)!, inv = order.invoice;
      let tx: string;
      if (r.netId === "solana") {
        const { quoteSolSend, sendSol } = await import("../core/sol");
        tx = await sendSol(phrase, index, await quoteSolSend(phrase, index, inv.payTo, inv.amount, inv.token));
      } else {
        const req = { network: networkById(r.netId)!, phrase, accountIndex: index, asset: { kind: "token" as const, token: inv.token }, to: inv.payTo, amount: inv.amount };
        tx = await send(req, await quoteSend(req));
      }
      await saveOrder({ key: order.key, name: order.name, at: Date.now(), paidTx: tx, state: "waiting" });
      setState("waiting");
    } catch (e) { setErr(errText(e)); }
    setBusy(false);
  };

  const keyBox = (key: string) => (
    <>
      <div className="faint">{t.fnKeyNote}</div>
      <div className="row" style={{ gap: 8 }}>
        <code className="mono" dir="ltr" style={{ wordBreak: "break-all", fontSize: 12, flex: 1 }}>{key}</code>
        <button className="iconbtn" aria-label={t.copy} onClick={() => { void navigator.clipboard.writeText(key); setCopied(true); }}>{copied ? <Check size={15} /> : <Copy size={15} />}</button>
      </div>
    </>
  );
  if (done) return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="row" style={{ gap: 6, color: "var(--good)", fontWeight: 600 }}><Check size={16} />{fill(t.fnDone, { n: done.name })}</div>
      {keyBox(done.key)}
      <button className="btn ghost block" onClick={onClose}>{t.closeBtn}</button>
    </div>
  );
  if (order && state) return (
    <div className="stack" style={{ gap: 10 }}>
      <div style={{ fontWeight: 600, color: state === "written" ? "var(--good)" : state === "void" ? "var(--warn)" : undefined }}>
        {state === "written" ? fill(t.fnDone, { n: order.name }) : state === "paid" ? t.fnPaid : state === "void" ? t.fnVoid : t.fnWaiting}
      </div>
      {keyBox(order.key)}
      <button className="btn ghost block" onClick={onClose}>{t.closeBtn}</button>
    </div>
  );
  if (order) {
    const r = NAME_RAILS.find((x) => x.id === order.invoice.railId)!;
    return (
      <div className="stack" style={{ gap: 10 }}>
        <div><MadarName name={order.name} /></div>
        <div className="list" style={{ padding: "2px 14px" }}>
          <div className="kv"><span>{t.youPay}</span><b className="num" dir="ltr">{order.invoice.amount} {r.symbol}</b></div>
          <div className="kv"><span>{t.network}</span><span>{netName(r.netId)}</span></div>
          <div className="kv"><span>{t.to}</span><span>{t.fnPayTo}</span></div>
          <div className="kv"><span>{t.fnNetFee}</span><span className="num">{fee ?? "…"}</span></div>
        </div>
        <div className="faint">{t.fnBuyNote}</div>
        {err && <div className="err">{err}</div>}
        <button className="btn primary block" disabled={busy || !fee} onClick={pay}>{busy ? t.fnPaying : t.fnPay}</button>
        <button className="btn ghost block" disabled={busy} onClick={() => { setOrder(null); setFee(null); setErr(""); }}>{t.back}</button>
      </div>
    );
  }
  if (!open) return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="note info">{t.fnPaused}</div>
      <button className="btn ghost block" onClick={onClose}>{t.closeBtn}</button>
    </div>
  );
  return (
    <div className="stack" style={{ gap: 10 }}>
      {had && <div className="faint">{fill(t.fnHadNote, { n: had })}</div>}
      <div className="row" dir="ltr" style={{ gap: 6 }}>
        <input className="input" dir="ltr" autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={32} placeholder="sunrise" value={name}
          onChange={(e) => { const v = e.target.value.toLowerCase(), c = v.replace(/[^a-z0-9-]/g, ""); setDropped(c !== v); setName(c); }} style={{ flex: 1, minWidth: 0 }} />
        <span className="faint" dir="ltr">.madar</span>
      </div>
      {dropped && <div className="note warn" aria-live="polite">{t.nameLatinOnly}</div>}
      <div className="faint" aria-live="polite">
        {info === "loading" && t.fnChecking}
        {free && <span style={{ color: "var(--good)" }}><MadarName name={`${n}.madar`} /> · {t.fnFree}</span>}
        {forSale && <span><MadarName name={`${n}.madar`} /> · {fill(t.fnPrice, { usd: (ci!.usd ?? 0).toLocaleString("en-US") })}</span>}
        {ci?.kind === "taken" && <span style={{ color: "var(--warn)" }}>{t.fnTaken}</span>}
        {ci?.kind === "blocked" && <span style={{ color: "var(--warn)" }}>{t.fnE_not_allowed}</span>}
        {(info === null || ci?.kind === "bad") && t.fnRuleAny}
      </div>
      {forSale && (
        <div className="row" style={{ gap: 8 }}>
          <span className="faint">{t.fnPayWith}</span>
          <select className="input" value={rail} onChange={(e) => setRail(e.target.value)} style={{ flex: 1, minWidth: 0 }}>
            {NAME_RAILS.map((r) => <option key={r.id} value={r.id}>{r.symbol} · {netName(r.netId)}</option>)}
          </select>
        </div>
      )}
      {err && <div className="err">{err}</div>}
      {forSale
        ? <button className="btn primary block" disabled={busy} onClick={startOrder}>{busy ? t.fnSigning : fill(t.fnBuy, { usd: (ci?.usd ?? 0).toLocaleString("en-US") })}</button>
        : <button className="btn primary block" disabled={!free || busy || had === undefined} onClick={claim}>{busy ? t.fnSigning : t.freeNameGo}</button>}
      <div className="faint">{forSale ? t.fnSaleNote : t.fnNote}</div>
    </div>
  );
}
