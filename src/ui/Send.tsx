import { BadgeCheck, BookUser, Check, Copy, ExternalLink, Fuel, Globe, Info, Plus, ScanLine, ShieldAlert, TriangleAlert, Users } from "lucide-react";
import { ANDROID } from "../platform";
import { scanQr } from "../platform/android/scan";
import { isRefused, parseScan, type ScanResult, type ScanRefused } from "../core/qrpayload";
import { amountAmbiguous, isAmountText, normAmount } from "../core/amount";
import { useEffect, useMemo, useState } from "react";
import { formatUnits, type Hash } from "viem";
import { evmAddress } from "../core/account";
import { isMadarName, resolveName, type NameHit } from "../core/names";
import { cleanAddress, cleanLabel, forFamily, LABEL_MAX, lookAlikeOf, mayOfferSave, ownAddress, sameAddr, saveAddress, type Family } from "../core/addressbook";
import { BTC, btcAddress, btcFees, btcSpendable, formatBtc, quoteBtcSend, sendBtc, type BtcFees, type BtcQuote } from "../core/btc";
import { activeNetworks, visibleTokens, type Network } from "../core/chains";
import { solRent, formatUnitsStr, quoteSolSend, sendSol, SOL, solAddress, solSpendable, type SolQuote } from "../core/sol";
import { parseUnitsStr } from "../core/solbase";
import { sameTonAddress, TON, TON_USDT, tonAddress, tonBalances } from "../core/tonbase";
import type { TonQuote } from "../core/ton";
import { waitSol } from "../core/swap";
import { quoteTronSend, sendTron, TRON, tronAddress, tronSpendable, tronTxUrl, waitTron, type TronQuote } from "../core/tron";
import { broadcastUtxo, DOGE, formatUtxo, isLegacyLtcP2sh, LTC, quoteUtxoSend, rateLabel, signUtxoPayment, utxoAddress, utxoFees, utxoPendingOf, utxoSignedOf, utxoSpendable, utxoTxStatus, utxoTxUrl, type UtxoFees, type UtxoQuote } from "../core/utxo";
import { adaPaymentState, adaPendingOf, adaSignedOf, adaSpendable, quoteAdaSend, signAdaPayment, submitAda, type AdaQuote } from "../core/ada";
import { ADA, adaAddress, adaTxUrl, formatAda } from "../core/adabase";
import { decodeXAddress, formatXrp, isXrpClassic, quoteXrpSend, signXrpSend, submitXrp, waitXrp, XRP, xrpAddress, xrpPendingOf, xrpSignedOf, xrpSpendable, xrpTxUrl, type XrpEnd, type XrpQuote, type XrpSigned } from "../core/xrp";
import { evmSpendable, quoteSend, send, type SendAsset, type SendQuote, type SendRequest } from "../core/chainops";
import { GAS_SPEEDS, gasSpeed, setGasSpeed, type GasSpeed } from "../core/gaslevels";
import { addActivity, clearPending, getActivity, getPending, removeActivity, setPending, touch, type Settings } from "../core/store";
import { coinName } from "../core/coins";
import { canGoPast, feePct, feeShareHigh, ltcOld3Ok, xrpAskTag, xrpBlocked } from "../core/sendgates";
import { fill, gasSpeedLabel, useT, type Dict } from "./i18n";
import { NetworkDot } from "./icons";
import { accName, amt, AddAddressForm, fillNodes, PctRow, short, useBook } from "./common";

export function amountState(amount: string) {
  const txt = normAmount(amount);
  return { txt, bad: amount.trim() !== "" && !isAmountText(txt), amb: amountAmbiguous(amount) };
}
export function AmountNote({ amount }: { amount: string }) {
  const { t } = useT();
  const s = amountState(amount);
  if (s.bad) return <div className="err">{t.errAmount}</div>;
  if (s.amb) return <div className="note soft"><span>{fillNodes(t.amtAmbig, { v: s.amb.read, w: s.amb.other })}</span></div>;
  return null;
}
const refusedText = (t: Dict, r: ScanRefused) => (r.refused === "reference" ? t.scanRefuse : r.refused === "function" ? t.scanFunction : r.refused === "req" ? t.scanReq : t.scanAmountBad);

type NameState = { status: "none" } | { status: "looking" } | { status: "ok"; hit: NameHit } | { status: "missing" } | { status: "error" };
function useMadarName(to: string): NameState {
  const [st, setSt] = useState<NameState>({ status: "none" });
  useEffect(() => {
    const v = to.trim().toLowerCase();
    if (!isMadarName(v)) { setSt({ status: "none" }); return; }
    setSt({ status: "looking" });
    let live = true;
    const h = setTimeout(async () => {
      try { const hit = await resolveName(v); if (live) setSt(hit ? { status: "ok", hit } : { status: "missing" }); }
      catch { if (live) setSt({ status: "error" }); }
    }, 350);
    return () => { live = false; clearTimeout(h); };
  }, [to]);
  return st;
}
function NameLine({ st, want }: { st: NameState; want: "evm" | "solana" }) {
  const { t } = useT();
  if (st.status === "none") return null;
  if (st.status === "looking") return <div className="faint">{t.nameLooking}</div>;
  if (st.status === "missing") return <div className="err">{t.nameMissing}</div>;
  if (st.status === "error") return <div className="err">{t.nameErr}</div>;
  if (st.hit.kind !== want) return <div className="err">{want === "evm" ? t.nameWrongEvm : t.nameWrongSol}</div>;
  return <div className="note info" style={{ wordBreak: "break-all" }}><BadgeCheck size={16} /><span><b>{t.nameOk}</b> · <span className="mono">{st.hit.address}</span></span></div>;
}

function effectiveTo(to: string, st: NameState, want: "evm" | "solana"): string | null {
  if (st.status === "none") return to.trim();
  return st.status === "ok" && st.hit.kind === want ? st.hit.address : null;
}

const shortAny = (a: string) => (isMadarName(a) ? a : short(a));
export type Recip = ReturnType<typeof useRecipient>;

export function useRecipient(phrase: string, settings: Settings, index: number, family: Family, input: string, dest: string | null, chainId?: number) {
  const { t } = useT();
  const book = useBook();
  const fam = useMemo(() => forFamily(book, family), [book, family]);
  const accKey = settings.accounts.map((a) => a.index).join(",");
  const ownAll = useMemo(() => settings.accounts.map((a) => ({ index: a.index, address: ownAddress(phrase, a.index, family) })), [phrase, accKey, family]);
  const others = ownAll.filter((o) => o.index !== index);
  const d = dest?.trim() ?? "";
  const ownIdx = d ? ownAll.find((o) => sameAddr(o.address, d, family))?.index : undefined;
  const saved = fam.find((e) => (input.trim() && sameAddr(e.address, input, family)) || (d && sameAddr(e.address, d, family)));

  const [sentTo, setSentTo] = useState<string[]>([]);
  useEffect(() => { void getActivity().then((list) => setSentTo([...new Set(list.filter((a) => a.kind === "send" && a.to && cleanAddress(a.to, family)).map((a) => a.to))].slice(0, 100))); }, [family]);
  const known = [...fam.filter((e) => !isMadarName(e.address)).map((e) => ({ address: e.address, label: e.label })), ...ownAll.map((o) => ({ address: o.address, label: accName(t, settings, o.index) })),
    ...sentTo.map((a) => ({ address: a, label: t.pastRecipient }))];

  const alike = d && cleanAddress(d, family) ? lookAlikeOf(d, known, family) : null;

  const [okFor, setOkFor] = useState("");
  const ok = !!d && okFor === d;
  const setOk = (v: boolean) => setOkFor(v ? d : "");

  const viaName = (family === "evm" || family === "solana") && !!d && !isMadarName(d) && isMadarName(input.trim()) && ownIdx == null;
  const [nameOkFor, setNameOkFor] = useState("");
  const nameOk = viaName && nameOkFor === d;
  const setNameOk = (v: boolean) => setNameOkFor(v ? d : "");

  const [scamFor, setScamFor] = useState("");
  useEffect(() => {
    let live = true;
    if (family !== "evm" || !chainId || !/^0x[0-9a-fA-F]{40}$/.test(d)) return;
    if (ownAll.some((o) => sameAddr(o.address, d, "evm"))) return;
    void import("../core/phishing").then((m) => m.addressRisk(chainId, d)).then((r) => { if (live) setScamFor(r?.bad ? d : ""); });
    return () => { live = false; };
  }, [d, chainId, family]);
  const scam = !!d && scamFor === d;
  return { family, fam, others, ownAll, ownIdx, saved, alike, ok, setOk, scam, viaName, nameOk, setNameOk, dest: d, blocked: (!!alike && !ok) || scam || (viaName && !nameOk), settings, input };
}

export function ToField({ rc, to, setTo, label, placeholder, setAmount, onScan }: { rc: Recip; to: string; setTo: (v: string) => void; label: string; placeholder: string; setAmount?: (v: string) => void;

  onScan?: (r: ScanResult) => string | null }) {
  const { t } = useT();
  const [book, setBook] = useState(false), [adding, setAdding] = useState(false), [scanBad, setScanBad] = useState(""), [scanning, setScanning] = useState(false);

  const scan = async () => {
    if (scanning) return;
    setScanBad(""); setScanning(true);
    const a = await scanQr().finally(() => setScanning(false));
    if ("err" in a) { if (a.err !== "cancel" && a.err !== "busy") setScanBad(a.err === "preparing" ? t.scanPreparing : t.scanFailed); return; }
    const r = parseScan(a.text, rc.family === "solana" ? "sol" : rc.family);
    if (!r) { setScanBad(t.scanBad); return; }
    if (isRefused(r)) { setScanBad(refusedText(t, r)); return; }
    if (onScan) { const why = onScan(r); if (why) { setScanBad(why); return; } }
    else { setTo(r.to); if (r.amount && setAmount) setAmount(r.amount); }
    setBook(false);
  };
  return (
    <>
      {rc.others.length > 0 && (
        <div className="field">{t.toMine}
          <div className="chips" style={{ margin: 0 }}>
            {rc.others.map((o) => (
              <button key={o.index} type="button" className={rc.ownIdx === o.index ? "on" : ""} onClick={() => setTo(o.address)}>
                <bdi>{accName(t, rc.settings, o.index)}</bdi> · <bdi className="mono" dir="ltr">{short(o.address)}</bdi>
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="field">{label}
        <div className="row" style={{ gap: 8 }}>
          <input className="input mono grow" aria-label={label} placeholder={placeholder} value={to} onChange={(e) => setTo(e.target.value)} spellCheck={false} />
          {}
          <button type="button" className={"iconbtn" + (book ? " on" : "")} title={t.savedTitle} aria-label={t.savedTitle} aria-expanded={book}
            onClick={() => setBook(!book)} style={{ width: 46, height: 46, flex: "0 0 auto", borderRadius: 12, border: "1px solid " + (book ? "var(--accent)" : "var(--line)"), background: "var(--panel)", color: book ? "var(--accent-ink)" : "var(--text)" }}><BookUser size={20} /></button>
          {ANDROID && <button type="button" className="iconbtn" title={t.scanTitle} aria-label={t.scanTitle} onClick={() => void scan()}
            style={{ width: 46, height: 46, flex: "0 0 auto", borderRadius: 12, border: "1px solid var(--line)", background: "var(--panel)", color: "var(--text)" }}><ScanLine size={20} /></button>}
        </div>
        {scanBad && <div className="note warn" style={{ marginTop: 8 }}><TriangleAlert size={16} />{scanBad}</div>}
        {book && (
          <div className="list" style={{ marginTop: 8 }}>
            {rc.fam.length === 0 && !adding && <div className="empty" style={{ padding: 14 }}>{t.savedNone}</div>}
            {rc.fam.map((e) => (
              <button key={e.address} type="button" className="rowi" style={{ width: "100%", textAlign: "start" }} onClick={() => { setTo(e.address); setBook(false); }}>
                <div className="grow"><div className="t1"><bdi>{e.label}</bdi></div><div className="t2 mono" dir="ltr">{shortAny(e.address)}</div></div>
              </button>
            ))}
            {adding
              ? <div style={{ padding: 12 }}><AddAddressForm family={rc.family} onDone={() => setAdding(false)} /></div>
              : <button type="button" className="rowi" style={{ width: "100%", textAlign: "start", color: "var(--accent-ink)" }} onClick={() => setAdding(true)}><Plus size={16} /><div className="grow t1">{t.bookAdd}</div></button>}
          </div>
        )}
      </div>
    </>
  );
}

export function AlikeWarn({ rc, check }: { rc: Recip; check?: boolean }) {
  const { t } = useT();
  if (rc.scam) return <div className="note bad"><ShieldAlert size={16} /><span>{t.scamAddr}</span></div>;
  const name = rc.viaName && (
    <>
      <div className="note warn" style={{ wordBreak: "break-all" }}><TriangleAlert size={16} /><span>{fill(t.nameFromServer, { a: rc.dest })}</span></div>
      {check && <label className="check"><input type="checkbox" checked={rc.nameOk} onChange={(e) => rc.setNameOk(e.target.checked)} />{t.nameConfirmOk}</label>}
    </>
  );
  if (!rc.alike) return name || null;
  return (
    <>
      {name}
      <div className="note bad"><TriangleAlert size={16} /><span>{fill(t.lookAlikeWarn, { l: rc.alike.label })}</span></div>
      {check && <label className="check"><input type="checkbox" checked={rc.ok} onChange={(e) => rc.setOk(e.target.checked)} />{t.lookAlikeOk}</label>}
    </>
  );
}

export function ToReview({ rc }: { rc: Recip }) {
  const { t } = useT();
  if (rc.ownIdx != null) return <div className="kv"><span>{t.to}</span><b>{t.myAccount} <bdi>{accName(t, rc.settings, rc.ownIdx)}</bdi></b></div>;
  if (rc.saved) return <div className="kv"><span>{t.to}</span><b><bdi>{rc.saved.label}</bdi>{isMadarName(rc.saved.address) && <> · <bdi dir="ltr">{rc.saved.address}</bdi></>}</b></div>;
  return null;
}
export const toAddrLabel = (t: Dict, rc: Recip) => (rc.ownIdx != null || rc.saved ? t.toAddr : t.to);

export function SaveOffer({ rc }: { rc: Recip }) {
  const { t } = useT();
  const [offer] = useState(() => mayOfferSave({ input: rc.input, family: rc.family, source: rc.ownIdx != null ? "own" : rc.saved ? "saved" : "typed", book: rc.fam, own: rc.ownAll.map((o) => o.address), lookAlike: !!rc.alike }));
  const [label, setLabel] = useState(""), [err, setErr] = useState(""), [saved, setSaved] = useState(false);
  if (!offer) return null;
  if (saved) return <div className="note ok"><Check size={16} />{t.addrSaved}</div>;
  async function save() {
    setErr("");
    try { await saveAddress(label, rc.input, rc.family); setSaved(true); }
    catch (e) { const m = (e as Error).message; setErr(m === "ERR_DUP" ? t.bookErrDup : m === "ERR_FULL" ? t.bookErrFull : m === "ERR_LABEL" ? t.bookErrLabel : t.errGeneric); }
  }
  return (
    <div className="sheet">
      <b>{t.saveThis}</b>
      <div className="mono faint" style={{ fontSize: 12, wordBreak: "break-all" }} dir="ltr">{rc.input.trim()}</div>
      <input className="input" maxLength={LABEL_MAX * 2} placeholder={t.saveLabelPh} value={label} onChange={(e) => setLabel(e.target.value)} />
      {err && <div className="err">{err}</div>}
      <button className="btn primary block" disabled={!cleanLabel(label)} onClick={save}><BookUser size={16} />{t.saveThis}</button>
    </div>
  );
}

export function Send({ net, phrase, index, settings, pre, done, scanned, onScanNet, onScanUsed, gasHelp, onSpeed }: { net: Network; phrase: string; index: number; settings: Settings; pre?: string; done: () => void;

  gasHelp?: GasWays;

  onSpeed?: (s: GasSpeed) => void;

  scanned?: ScanResult;

  onScanNet?: (networkId: string, r: ScanResult) => void; onScanUsed?: () => void }) {
  const { t } = useT();
  const tokens = visibleTokens(net, settings.enabledTokens, settings.customTokens);

  const [assetKey, setAssetKey] = useState<string>(pre && (pre === "native" || tokens.some((x) => x.address.toLowerCase() === pre)) ? pre : "native");
  const token = tokens.find((x) => x.address.toLowerCase() === assetKey);
  const asset: SendAsset = token ? { kind: "token", token } : { kind: "native" };
  const [to, setTo] = useState(""), [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<SendQuote | null>(null);
  const [busy, setBusy] = useState(false), [err, setErr] = useState(""), [hash, setHash] = useState<Hash | null>(null);
  const [gasShort, setGasShort] = useState(false);
  const symbol = token ? token.symbol : net.native.symbol;
  const ns = useMadarName(to);
  const dest = effectiveTo(to, ns, "evm");
  const rc = useRecipient(phrase, settings, index, "evm", to, dest, net.chain.id);
  const am = amountState(amount);
  const req = (): SendRequest => ({ network: net, phrase, accountIndex: index, asset, to: dest ?? "", amount: am.txt });
  const [scanNote, setScanNote] = useState("");

  const applyScan = (r: ScanResult): string | null => {
    if (r.chainId != null && r.chainId !== net.chain.id) {
      const n = activeNetworks(settings).find((x) => x.chain.id === r.chainId);
      if (!n || !onScanNet) return fill(t.scanNetUnknown, { id: String(r.chainId) });
      onScanNet(n.id, r);
      return null;
    }
    let key = "native", dec = net.chain.nativeCurrency.decimals;
    if (r.token) {
      const tk = tokens.find((x) => x.address.toLowerCase() === r.token!.toLowerCase());
      if (!tk) return t.scanTokenUnknown;
      key = tk.address.toLowerCase(); dec = tk.decimals;
    }
    setAssetKey(key); setTo(r.to);
    if (r.raw) setAmount(formatUnits(BigInt(r.raw), dec));
    return null;
  };
  useEffect(() => {
    if (!scanned) return;
    const why = applyScan(scanned);
    setScanNote(why ?? fill(t.scanSwitched, { n: net.name }));
    onScanUsed?.();
  }, [scanned]);
  const friendly = (e: unknown) => {
    const m = (e as Error)?.message ?? String(e);
    if (m === "ERR_ADDRESS") return t.errAddress;
    if (m === "ERR_AMOUNT") return t.errAmount;
    if (m === "ERR_ZERO") return t.errZero;
    if (m === "ERR_FEE_HIGH") return t.errFeeHigh;
    if (m === "ERR_FEE_UNKNOWN") return t.errNet;
    if (m === "ERR_SIM_FAIL") return (e as { reason?: string }).reason === "balance" ? t.errFunds : t.sendWouldFail;
    if (m === "ERR_GAS") {
      const x = e as { need?: bigint; have?: bigint; fee?: bigint }, d = net.chain.nativeCurrency.decimals;

      if (!token) return fill(t.gasNativeShort, { sym: net.native.symbol, fee: amt(formatUnits(x.fee ?? 0n, d)) });
      return fill(t.gasShort, { sym: net.native.symbol, need: amt(formatUnits(x.need ?? 0n, d)), have: amt(formatUnits(x.have ?? 0n, d)) });
    }
    if (token && /insufficient funds/i.test(m)) return fill(t.needGas, { sym: net.native.symbol });
    if (/insufficient funds|exceeds balance|transfer amount exceeds/i.test(m)) return t.errFunds;
    if (/fetch|network|timeout|HTTP request failed/i.test(m)) return t.errNet;
    return t.errGeneric;
  };
  const isGasErr = (e: unknown) => { const m = (e as Error)?.message ?? ""; return !!token && (m === "ERR_GAS" || /insufficient funds/i.test(m)); };
  async function review() {
    setBusy(true); setErr(""); setGasShort(false); void touch();
    try { setQuote(await quoteSend(req())); } catch (e) { setErr(friendly(e)); setGasShort(isGasErr(e)); }
    setBusy(false);
  }

  const [speed, setSpeed] = useState<GasSpeed>(gasSpeed());
  const pickSpeed = (s: GasSpeed) => { if (s === speed || busy) return; setGasSpeed(s); setSpeed(s); onSpeed?.(s); void review(); };
  async function confirm() {
    if (!quote || rc.blocked) return;
    setBusy(true); setErr(""); void touch();
    try {
      const h = await send(req(), quote);
      await addActivity({ at: Date.now(), networkId: net.id, kind: "send", asset: symbol, amount: am.txt, to: quote.to, hash: h, from: evmAddress(phrase, index) });
      setHash(h);
    } catch (e) { setErr(friendly(e)); setGasShort(isGasErr(e)); }
    setBusy(false);
  }
  const gasBox = gasShort && <GasHelp sym={net.native.symbol} netName={net.name} address={evmAddress(phrase, index)} ways={gasHelp} />;
  if (hash)
    return (
      <div className="page stack">
        <div className="empty"><div className="ic" style={{ color: "var(--good)" }}><Check size={28} /></div>{t.sent}</div>
        <a className="btn ghost block" href={`${net.explorer}/tx/${hash}`} target="_blank" rel="noreferrer"><ExternalLink size={16} />{t.viewTx}</a>
        <SaveOffer rc={rc} />
        <button className="btn primary block" onClick={done}>{t.toActivity}</button>
      </div>
    );
  if (quote)
    return (
      <div className="page stack">
        <h1>{t.reviewTitle}</h1>
        <div className="list" style={{ padding: "4px 14px" }}>
          <div className="kv"><span>{t.amount}</span><b className="num">{amt(formatUnits(quote.value, token ? token.decimals : net.chain.nativeCurrency.decimals), token ? token.decimals : symbol)} {symbol}</b></div>
          {token && <div className="kv"><span>{t.asset}</span><span className="row" style={{ gap: 6 }}>{coinName(token.symbol, token.name, token.verified)}{!token.verified && <span className="badge warn">{t.unverified}</span>}</span></div>}
          {ns.status === "ok" && <div className="kv"><span>{t.nameLabel}</span><span className="row" style={{ gap: 6 }}><BadgeCheck size={14} />{ns.hit.name}</span></div>}
          <ToReview rc={rc} />
          <div className="kv"><span>{toAddrLabel(t, rc)}</span><span className="mono" style={{ fontSize: 12, wordBreak: "break-all" }}>{quote.to}</span></div>
          <div className="kv"><span>{t.network}</span><span className="row" style={{ gap: 6 }}><NetworkDot id={net.id} />{net.name}</span></div>
          <div className="kv"><span>{t.fee}</span><span className="num">{amt(formatUnits(quote.feeNative, net.chain.nativeCurrency.decimals))} {net.native.symbol}</span></div>
          <div className="kv"><span>{t.sGasSpeed}</span><div className="seg seg-sm">{GAS_SPEEDS.map((s) => <button key={s} type="button" className={speed === s ? "on" : ""} disabled={busy} onClick={() => pickSpeed(s)}>{gasSpeedLabel(t, s)}</button>)}</div></div>
        </div>
        <AlikeWarn rc={rc} />
        <div className="note warn"><TriangleAlert size={16} />{t.irreversible}</div>
        {err && <div className="err">{err}</div>}
        {gasBox}
        <button className="btn primary block" onClick={confirm} disabled={busy || rc.blocked}>{busy ? t.sending : t.confirmSend}</button>
        <button className="btn ghost block" onClick={() => setQuote(null)} disabled={busy}>{t.edit}</button>
      </div>
    );
  return (
    <div className="page stack">
      <h1>{t.sendOn} {net.name}</h1>
      <label className="field">{t.asset}
        <select className="input" value={assetKey} onChange={(e) => setAssetKey(e.target.value)}>
          <option value="native">{net.native.symbol} — {coinName(net.native.symbol, net.native.name, true)}</option>
          {tokens.map((x) => <option key={x.address} value={x.address.toLowerCase()}>{x.symbol} — {x.verified ? coinName(x.symbol, x.name, true) : `${x.name || x.symbol} (${t.unverified})`}</option>)}
        </select>
      </label>
      <ToField rc={rc} to={to} setTo={setTo} label={t.recipientOrName} placeholder="0x… / sunrise.madar" onScan={(r) => { setScanNote(""); return applyScan(r); }} />
      {scanNote && <div className="note info"><Globe size={16} />{scanNote}</div>}
      <NameLine st={ns} want="evm" />
      <AlikeWarn rc={rc} check />
      <label className="field">{t.amount}<input className="input num" inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
      <AmountNote amount={amount} />
      <PctRow key={assetKey} getMax={() => evmSpendable(net, phrase, index, asset)} decimals={token ? token.decimals : net.chain.nativeCurrency.decimals} onPick={setAmount} />
      {token && <div className="faint">{fill(t.needGas, { sym: net.native.symbol })}</div>}
      {err && <div className="err">{err}</div>}
      {gasBox}
      <button className="btn primary block" disabled={busy || !dest || !amount || am.bad || rc.blocked} onClick={review}>{busy ? t.calculating : t.review}</button>
    </div>
  );
}

export function BtcSend({ phrase, index, settings, done }: { phrase: string; index: number; settings: Settings; done: () => void }) {
  const { t } = useT();
  const [to, setTo] = useState(""), [amount, setAmount] = useState("");
  const rc = useRecipient(phrase, settings, index, "btc", to, to.trim() || null);
  const [fees, setFees] = useState<BtcFees | null>(null), [speed, setSpeed] = useState<keyof BtcFees>("normal");
  const [quote, setQuote] = useState<BtcQuote | null>(null);
  const [busy, setBusy] = useState(false), [err, setErr] = useState(""), [txid, setTxid] = useState<string | null>(null);
  useEffect(() => { void btcFees().then(setFees).catch(() => setFees({ fast: 10, normal: 5, slow: 2 })); }, []);
  const friendly = (e: unknown) => {
    const m = (e as Error)?.message ?? String(e);
    if (m === "ERR_ADDRESS") return t.errBtcAddress;
    if (m === "ERR_AMOUNT") return t.errAmount;
    if (m === "ERR_ZERO") return t.errZero;
    if (m === "ERR_DUST") return t.errDust;
    if (m === "ERR_FUNDS") return t.errFunds;
    if (/fetch|network|Failed/i.test(m)) return t.errNet;
    return t.errGeneric;
  };
  async function review() {
    setBusy(true); setErr(""); void touch();
    try { setQuote(await quoteBtcSend(phrase, index, to, amountState(amount).txt, fees ? fees[speed] : 5)); } catch (e) { setErr(friendly(e)); }
    setBusy(false);
  }
  async function confirm() {
    if (!quote || rc.blocked) return;
    setBusy(true); setErr(""); void touch();
    try {
      const id = await sendBtc(phrase, index, quote);
      await addActivity({ at: Date.now(), networkId: BTC.id, kind: "send", asset: "BTC", amount: formatBtc(quote.amount), to: quote.to, hash: id, from: btcAddress(phrase, index) });
      setTxid(id);
    } catch (e) { setErr(friendly(e)); setQuote(null); }
    setBusy(false);
  }
  const SPEEDS: [keyof BtcFees, string][] = [["slow", t.feeSlow], ["normal", t.feeNormal], ["fast", t.feeFast]];
  if (txid)
    return (
      <div className="page stack">
        <div className="empty"><div className="ic" style={{ color: "var(--good)" }}><Check size={28} /></div>{t.sent}</div>
        <a className="btn ghost block" href={`${BTC.explorer}/tx/${txid}`} target="_blank" rel="noreferrer"><ExternalLink size={16} />{t.viewTx}</a>
        <SaveOffer rc={rc} />
        <button className="btn primary block" onClick={done}>{t.toActivity}</button>
      </div>
    );
  if (quote)
    return (
      <div className="page stack">
        <h1>{t.reviewTitle}</h1>
        <div className="list" style={{ padding: "4px 14px" }}>
          <div className="kv"><span>{t.amount}</span><b className="num">{formatBtc(quote.amount)} BTC</b></div>
          <ToReview rc={rc} />
          <div className="kv"><span>{toAddrLabel(t, rc)}</span><span className="mono" style={{ fontSize: 12, wordBreak: "break-all" }}>{quote.to}</span></div>
          <div className="kv"><span>{t.network}</span><span className="row" style={{ gap: 6 }}><NetworkDot id="bitcoin" />{BTC.name}</span></div>
          <div className="kv"><span>{t.btcFee}</span><span className="num">{formatBtc(quote.fee)} BTC · {quote.feeRate} sat/vB</span></div>
          <div className="kv"><span>{t.total}</span><b className="num">{formatBtc(quote.amount + quote.fee)} BTC</b></div>
        </div>
        <AlikeWarn rc={rc} />
        <div className="note warn"><TriangleAlert size={16} />{t.irreversible}</div>
        {err && <div className="err">{err}</div>}
        <button className="btn primary block" onClick={confirm} disabled={busy || rc.blocked}>{busy ? t.sending : t.confirmSend}</button>
        <button className="btn ghost block" onClick={() => setQuote(null)} disabled={busy}>{t.edit}</button>
      </div>
    );
  return (
    <div className="page stack">
      <h1>{t.sendOn} {BTC.name}</h1>
      <ToField rc={rc} to={to} setTo={setTo} label={t.recipient} placeholder="bc1…" setAmount={setAmount} />
      <AlikeWarn rc={rc} check />
      <label className="field">{t.amount} (BTC)<input className="input num" inputMode="decimal" placeholder="0.00000000" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
      <AmountNote amount={amount} />
      <PctRow getMax={() => btcSpendable(phrase, index, fees ? fees[speed] : 5)} decimals={8} onPick={setAmount} />
      <div className="field">{t.feeSpeed}
        <div className="seg" style={{ alignSelf: "flex-start" }}>
          {SPEEDS.map(([k, label]) => <button key={k} className={speed === k ? "on" : ""} onClick={() => setSpeed(k)}>{label}{fees ? ` · ${fees[k]}` : ""}</button>)}
        </div>
        <span className="faint">{t.feeHint}</span>
      </div>
      {err && <div className="err">{err}</div>}
      <button className="btn primary block" disabled={busy || !to || !amount || amountState(amount).bad || rc.blocked} onClick={review}>{busy ? t.calculating : t.review}</button>
    </div>
  );
}

export function SolSend({ phrase, index, settings, pre, done }: { phrase: string; index: number; settings: Settings; pre?: string; done: () => void }) {
  const { t } = useT();
  const tokens = visibleTokens(SOL, settings.enabledTokens, settings.customTokens);
  const [assetKey, setAssetKey] = useState<string>(pre && (pre === "native" || tokens.some((x) => x.address === pre)) ? pre : "native");
  const token = tokens.find((x) => x.address === assetKey);
  const [to, setTo] = useState(""), [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<SolQuote | null>(null);
  const [busy, setBusy] = useState(false), [err, setErr] = useState(""), [sig, setSig] = useState<string | null>(null);
  const symbol = token ? token.symbol : "SOL";
  const ns = useMadarName(to);
  const solDest = effectiveTo(to, ns, "solana");
  const rc = useRecipient(phrase, settings, index, "solana", to, solDest);
  const friendly = (e: unknown) => {
    const m = (e as Error)?.message ?? String(e);
    const map: Record<string, string> = {
      ERR_ADDRESS: t.errSolAddress, ERR_AMOUNT: t.errAmount, ERR_ZERO: t.errZero, ERR_FUNDS: t.errFunds, ERR_SELF: t.errSelf,
      ERR_TOKEN_ACCOUNT: t.errTokenAccount, ERR_PROGRAM: t.errProgramAddress, ERR_OFF_CURVE: t.errOffCurve, ERR_SOL_MIN: fill(t.errSolMin, { amt: formatUnitsStr(solRent.min, 9) }), ERR_SOL_REST: fill(t.errSolRest, { amt: formatUnitsStr(solRent.min, 9) }), ERR_GAS: fill(t.needGas, { sym: "SOL" }),
      ERR_DROPPED: t.swapDropped, ERR_CHAIN: t.swapFailed,
    };
    if (map[m]) return map[m];
    if (/insufficient|0x1\b/i.test(m)) return t.errFunds;
    if (/fetch|network|HTTP/i.test(m)) return t.errNet;
    return t.errGeneric;
  };
  async function review() {
    setBusy(true); setErr(""); void touch();
    try { setQuote(await quoteSolSend(phrase, index, solDest ?? "", amountState(amount).txt, token)); } catch (e) { setErr(friendly(e)); }
    setBusy(false);
  }
  async function confirm() {
    if (!quote || rc.blocked) return;
    setBusy(true); setErr(""); void touch();
    try {
      const s = await sendSol(phrase, index, quote);
      await addActivity({ at: Date.now(), networkId: SOL.id, kind: "send", asset: symbol, amount: amountState(amount).txt, to: quote.to, hash: s, from: solAddress(phrase, index) });

      try { await waitSol(s, { maxMs: 90_000 }); } catch (w) { if ((w as Error).message !== "ERR_PENDING") throw w; }
      setSig(s);
    } catch (e) { setErr(friendly(e)); setQuote(null); }
    setBusy(false);
  }
  if (sig)
    return (
      <div className="page stack">
        <div className="empty"><div className="ic" style={{ color: "var(--good)" }}><Check size={28} /></div>{t.sent}</div>
        <a className="btn ghost block" href={`${SOL.explorer}/tx/${sig}`} target="_blank" rel="noreferrer"><ExternalLink size={16} />{t.viewTx}</a>
        <SaveOffer rc={rc} />
        <button className="btn primary block" onClick={done}>{t.toActivity}</button>
      </div>
    );
  if (quote)
    return (
      <div className="page stack">
        <h1>{t.reviewTitle}</h1>
        <div className="list" style={{ padding: "4px 14px" }}>
          <div className="kv"><span>{t.amount}</span><b className="num">{amountState(amount).txt} {symbol}</b></div>
          {token && <div className="kv"><span>{t.asset}</span><span className="row" style={{ gap: 6 }}>{coinName(token.symbol, token.name, token.verified)}{!token.verified && <span className="badge warn">{t.unverified}</span>}</span></div>}
          {ns.status === "ok" && <div className="kv"><span>{t.nameLabel}</span><span className="row" style={{ gap: 6 }}><BadgeCheck size={14} />{ns.hit.name}</span></div>}
          <ToReview rc={rc} />
          <div className="kv"><span>{toAddrLabel(t, rc)}</span><span className="mono" style={{ fontSize: 12, wordBreak: "break-all" }}>{quote.to}</span></div>
          <div className="kv"><span>{t.network}</span><span className="row" style={{ gap: 6 }}><NetworkDot id="solana" />{SOL.name}</span></div>
          <div className="kv"><span>{t.fee}</span><span className="num">{formatUnitsStr(quote.feeLamports, 9)} SOL</span></div>
        </div>
        {quote.createsAccount && <div className="note info"><Globe size={16} />{fill(t.solAtaNote, { amt: formatUnitsStr(solRent.ata, 9) })}</div>}
        <AlikeWarn rc={rc} />
        <div className="note warn"><TriangleAlert size={16} />{t.irreversible}</div>
        {err && <div className="err">{err}</div>}
        <button className="btn primary block" onClick={confirm} disabled={busy || rc.blocked}>{busy ? t.sending : t.confirmSend}</button>
        <button className="btn ghost block" onClick={() => setQuote(null)} disabled={busy}>{t.edit}</button>
      </div>
    );
  return (
    <div className="page stack">
      <h1>{t.sendOn} {SOL.name}</h1>
      <label className="field">{t.asset}
        <select className="input" value={assetKey} onChange={(e) => setAssetKey(e.target.value)}>
          <option value="native">SOL — Solana</option>
          {tokens.map((x) => <option key={x.address} value={x.address}>{x.symbol} — {x.verified ? coinName(x.symbol, x.name, true) : `${x.name || x.symbol} (${t.unverified})`}</option>)}
        </select>
      </label>
      <ToField rc={rc} to={to} setTo={setTo} label={t.recipientOrName} placeholder="… / sunrise.madar" onScan={(r) => {

        let key = "native";
        if (r.token) { const tk = tokens.find((x) => x.address === r.token); if (!tk) return t.scanTokenUnknown; key = tk.address; }
        setAssetKey(key); setTo(r.to); if (r.amount) setAmount(r.amount);
        return null;
      }} />
      <NameLine st={ns} want="solana" />
      <AlikeWarn rc={rc} check />
      <label className="field">{t.amount}<input className="input num" inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
      <AmountNote amount={amount} />
      <PctRow key={assetKey} getMax={() => solSpendable(phrase, index, token)} decimals={token ? token.decimals : 9} onPick={setAmount} />
      {token && <div className="faint">{fill(t.needGas, { sym: "SOL" })}</div>}
      {err && <div className="err">{err}</div>}
      <button className="btn primary block" disabled={busy || !solDest || !amount || amountState(amount).bad || rc.blocked} onClick={review}>{busy ? t.calculating : t.review}</button>
    </div>
  );
}

export function TronSend({ phrase, index, settings, pre, done, gasHelp }: { phrase: string; index: number; settings: Settings; pre?: string; done: () => void; gasHelp?: GasWays }) {
  const { t } = useT();
  const tokens = TRON.tokens;
  const [assetKey, setAssetKey] = useState<string>(pre && (pre === "native" || tokens.some((x) => x.address === pre)) ? pre : "native");
  const token = tokens.find((x) => x.address === assetKey);
  const [to, setTo] = useState(""), [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<TronQuote | null>(null);
  const [busy, setBusy] = useState(false), [err, setErr] = useState(""), [txid, setTxid] = useState<string | null>(null), [slow, setSlow] = useState(false);
  const [trxShort, setTrxShort] = useState(false);
  const symbol = token ? token.symbol : TRON.symbol;
  const rc = useRecipient(phrase, settings, index, "tron", to, to.trim() || null);
  const trx = (sun: bigint) => amt(formatUnitsStr(sun < 0n ? 0n : sun, 6), 6);
  const ltr = (s: string) => `⁦${s}⁩`;
  const friendly = (e: unknown) => {
    const x = e as { message?: string; need?: bigint; have?: bigint };
    const m = x?.message ?? String(e);
    if (m === "ERR_TRX_FEE") return fill(t.tronFeeShort, { n: ltr(trx(x.need ?? 0n)), h: ltr(trx(x.have ?? 0n)) });
    const map: Record<string, string> = {
      ERR_ADDRESS: t.errTronAddress, ERR_AMOUNT: t.errAmount, ERR_ZERO: t.errZero, ERR_FUNDS: t.errFunds, ERR_SELF: t.errSelf, ERR_PROGRAM: t.errContract,
      ERR_TRON_CALL: t.errTronCall, ERR_TRON_BUILD: t.errTronBuild, ERR_FEE_HIGH: t.errTronFeeHigh, ERR_UNSAFE: t.swapUnsafe, ERR_BUSY: t.busyWait, ERR_CHAIN: t.swapFailed,
    };
    if (map[m]) return map[m];
    if (/fetch|network|HTTP|timeout|abort/i.test(m)) return t.errNet;
    return t.errGeneric;
  };
  async function review() {
    setBusy(true); setErr(""); setTrxShort(false); void touch();
    try { setQuote(await quoteTronSend(phrase, index, to, amountState(amount).txt, token)); } catch (e) { setErr(friendly(e)); setTrxShort((e as Error)?.message === "ERR_TRX_FEE"); }
    setBusy(false);
  }
  async function confirm() {
    if (!quote || rc.blocked) return;
    setBusy(true); setErr(""); void touch();
    try {
      const id = await sendTron(phrase, index, quote);
      await addActivity({ at: Date.now(), networkId: TRON.id, kind: "send", asset: symbol, amount: formatUnitsStr(quote.amount, 6), to: quote.to, hash: id, from: tronAddress(phrase, index) });

      try { await waitTron(id, { maxMs: 60_000 }); } catch (w) { if ((w as Error).message !== "ERR_PENDING") throw w; setSlow(true); }
      setTxid(id);
    } catch (e) { setErr(friendly(e)); setTrxShort((e as Error)?.message === "ERR_TRX_FEE"); setQuote(null); }
    setBusy(false);
  }
  if (txid)
    return (
      <div className="page stack">
        <div className="empty"><div className="ic" style={{ color: "var(--good)" }}><Check size={28} /></div>{t.sent}</div>
        {slow && <div className="note info"><Globe size={16} />{t.swapPending}</div>}
        <a className="btn ghost block" href={tronTxUrl(txid)} target="_blank" rel="noreferrer"><ExternalLink size={16} />{t.viewTx}</a>
        <SaveOffer rc={rc} />
        <button className="btn primary block" onClick={done}>{t.toActivity}</button>
      </div>
    );
  if (quote)
    return (
      <div className="page stack">
        <h1>{t.reviewTitle}</h1>
        <div className="list" style={{ padding: "4px 14px" }}>
          <div className="kv"><span>{t.amount}</span><b className="num" dir="ltr">{amt(formatUnitsStr(quote.amount, 6), 6)} {symbol}</b></div>
          {token && <div className="kv"><span>{t.asset}</span><span className="row" style={{ gap: 6 }}>{coinName(token.symbol, token.name, true)} · TRC20</span></div>}
          <ToReview rc={rc} />
          <div className="kv"><span>{toAddrLabel(t, rc)}</span><span className="mono" style={{ fontSize: 12, wordBreak: "break-all" }}>{quote.to}</span></div>
          <div className="kv"><span>{t.network}</span><span className="row" style={{ gap: 6 }}><NetworkDot id={TRON.id} />TRON (TRC20)</span></div>
          <div className="kv"><span>{t.tronFeeRow}</span><span className="num" dir="ltr">{quote.fee === 0n ? <bdi dir="auto">{t.tronFeeFree}</bdi> : `≈ ${trx(quote.fee)} TRX`}</span></div>
          <div className="kv"><span>{t.tronNeedRow}</span><span>{fillNodes(t.tronNeedVal, { n: `${trx(quote.need)} TRX`, h: `${trx(quote.have)} TRX` })}</span></div>
          {!token && <div className="kv"><span>{t.total}</span><b className="num" dir="ltr">{trx(quote.amount + quote.fee)} TRX</b></div>}
        </div>
        {token && <div className="note soft"><Globe size={16} /><span>{fill(t.tronFeeEnergy, { e: quote.energy.toLocaleString("en-US") })}</span></div>}
        {!token && quote.burnsBandwidth && !quote.newAccount && <div className="note soft"><Globe size={16} /><span>{t.tronFeeBandwidth}</span></div>}
        {quote.newAccount && <div className="note info"><Globe size={16} /><span>{t.tronNewAccount}</span></div>}
        <AlikeWarn rc={rc} />
        <div className="note warn"><TriangleAlert size={16} />{t.irreversible}</div>
        {err && <div className="err">{err}</div>}
        <button className="btn primary block" onClick={confirm} disabled={busy || rc.blocked}>{busy ? t.sending : t.confirmSend}</button>
        <button className="btn ghost block" onClick={() => setQuote(null)} disabled={busy}>{t.edit}</button>
      </div>
    );
  return (
    <div className="page stack">
      <h1>{t.sendOn} {TRON.name}</h1>
      <label className="field">{t.asset}
        <select className="input" value={assetKey} onChange={(e) => setAssetKey(e.target.value)}>
          <option value="native">TRX — Tron</option>
          {tokens.map((x) => <option key={x.address} value={x.address}>{x.symbol} (TRC20) — {coinName(x.symbol, x.name, true)}</option>)}
        </select>
      </label>
      <ToField rc={rc} to={to} setTo={setTo} label={t.recipient} placeholder="T…" setAmount={setAmount} />
      <AlikeWarn rc={rc} check />
      <label className="field">{t.amount} ({symbol})<input className="input num" inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
      <AmountNote amount={amount} />
      <PctRow key={assetKey} getMax={() => tronSpendable(phrase, index, token)} decimals={6} onPick={setAmount} />
      <div className="faint">{token ? t.tronFeeNote : t.tronFeeBandwidth}</div>
      {err && <div className="err">{err}</div>}
      {}
      {trxShort && <GasHelp sym="TRX" netName="Tron" address={tronAddress(phrase, index)} ways={{ swap: gasHelp?.swap, p2p: gasHelp?.p2p }} />}
      <button className="btn primary block" disabled={busy || !to.trim() || !amount || amountState(amount).bad || rc.blocked} onClick={review}>{busy ? t.calculating : t.review}</button>
    </div>
  );
}

export const iso = (s: string) => `⁦${s}⁩`;

export function UtxoSend({ coin, phrase, index, settings, done }: { coin: "dogecoin" | "litecoin"; phrase: string; index: number; settings: Settings; done: () => void }) {
  const { t } = useT();
  const c = coin === "dogecoin" ? DOGE : LTC;
  const from = useMemo(() => utxoAddress(c, phrase, index), [c, phrase, index]);
  const [to, setTo] = useState(""), [amount, setAmount] = useState("");
  const rc = useRecipient(phrase, settings, index, c.family, to, to.trim() || null);
  const [fees, setFees] = useState<UtxoFees | null>(null), [speed, setSpeed] = useState<keyof UtxoFees>("normal");
  const [quote, setQuote] = useState<UtxoQuote | null>(null);
  const [busy, setBusy] = useState(false), [err, setErr] = useState(""), [result, setResult] = useState<{ txid: string; state: "sent" | "unknown" } | null>(null);

  const [prev, setPrev] = useState<NonNullable<ReturnType<typeof utxoSignedOf>> | null>(null), [prevOk, setPrevOk] = useState(false), [prevNote, setPrevNote] = useState("");

  const [old3For, setOld3For] = useState("");

  const fallback = c.id === "dogecoin" ? 50_000 : 10;
  useEffect(() => { void utxoFees(c).then(setFees).catch(() => setFees(null)); }, [c]);
  useEffect(() => {
    let live = true;
    void (async () => {
      const p = utxoSignedOf(await getPending(c.id, from).catch(() => null));
      if (!p) return;
      const st = await utxoTxStatus(c, p.txid).catch(() => null);
      if (!live) return;
      if (st) { await clearPending(c.id, from, p.txid); return; }
      setPrev(p);
    })();
    return () => { live = false; };
  }, [c, from]);
  const rate = fees ? fees[speed] : fallback;

  const ownTxids = async () => (await getActivity()).filter((a) => a.networkId === c.id && (a.kind === "send" || a.kind === "swap") && a.from === from).map((a) => a.hash);
  const amtSym = (v: bigint) => iso(`${formatUtxo(v)} ${c.symbol}`);
  const friendly = (e: unknown) => {
    const x = e as { message?: string; waiting?: bigint; skipped?: bigint };
    const m = x?.message ?? String(e);
    if (m === "ERR_FUNDS") return [t.errFunds, x.waiting ? fill(t.utxoWaiting, { w: iso(formatUtxo(x.waiting)), sym: c.symbol }) : "", x.skipped ? fill(t.utxoMweb, { s: iso(formatUtxo(x.skipped)), sym: c.symbol }) : ""].filter(Boolean).join(" ");
    const map: Record<string, string> = {
      ERR_ADDRESS: c.id === "dogecoin" ? t.errDogeAddress : t.errLtcAddress, ERR_AMOUNT: t.errAmount, ERR_ZERO: t.errZero, ERR_SELF: t.errSelf,
      ERR_DUST: fill(t.errCoinDust, { n: c.name, d: formatUtxo(c.dust), sym: c.symbol }), ERR_PROVIDER: t.errProvider, ERR_UNSAFE: t.swapUnsafe, ERR_FEE_HIGH: t.errCoinFeeHigh,
      ERR_BROADCAST: t.errBroadcast, ERR_BUSY: t.busyWait,
    };
    if (map[m]) return map[m];
    if (/fetch|network|Failed|HTTP|timeout|abort/i.test(m)) return t.errNet;
    return t.errGeneric;
  };
  const old3 = isLegacyLtcP2sh(c, to);
  const old3Ok = ltcOld3Ok(c, to, old3For);
  async function review() {
    if (!old3Ok || (prev && !prevOk)) return;
    setBusy(true); setErr(""); void touch();
    try { setQuote(await quoteUtxoSend(c, phrase, index, to, amountState(amount).txt, rate, await ownTxids())); } catch (e) { setErr(friendly(e)); }
    setBusy(false);
  }
  async function rebroadcast() {
    if (!prev) return;

    if (prev.memo && Date.now() - prev.at > 30 * 60_000) { setPrevNote(t.thorNoRebroadcast); return; }
    setBusy(true); setPrevNote("");
    try {
      if ((await broadcastUtxo(c, prev.hex, prev.txid)) === "sent") { await clearPending(c.id, from, prev.txid); setPrev(null); setPrevNote(t.rebroadcastDone); }
      else setPrevNote(t.utxoUnknown);
    } catch { setPrevNote(t.rebroadcastNo); }
    setBusy(false);
  }
  async function confirm() {
    if (!quote || rc.blocked || busy) return;
    if (!ltcOld3Ok(c, quote.to, old3For)) return;
    setBusy(true); setErr(""); void touch();
    let signed: { hex: string; txid: string };
    try { signed = signUtxoPayment(c, phrase, index, quote); } catch (e) { setErr(friendly(e)); setQuote(null); setBusy(false); return; }

    const at = Date.now();
    try {
      await setPending({ ...utxoPendingOf(c, quote, signed), at });
      await addActivity({ at, networkId: c.id, kind: "send", asset: c.symbol, amount: formatUtxo(quote.amount), to: quote.to, hash: signed.txid, from: quote.from });
    } catch { await clearPending(c.id, quote.from, signed.txid).catch(() => {}); setErr(t.errGeneric); setBusy(false); return; }
    let state: "sent" | "unknown" = "unknown";
    try { state = await broadcastUtxo(c, signed.hex, signed.txid); }
    catch (e) {
      if ((e as Error)?.message === "ERR_BROADCAST") {
        await clearPending(c.id, quote.from, signed.txid).catch(() => {}); await removeActivity(signed.txid).catch(() => {});
        setErr(friendly(e)); setQuote(null); setBusy(false); return;
      }
    }
    if (state === "sent") await clearPending(c.id, quote.from, signed.txid).catch(() => {});
    setResult({ txid: signed.txid, state });
    setBusy(false);
  }
  const SPEEDS: [keyof UtxoFees, string][] = [["slow", t.feeSlow], ["normal", t.feeNormal], ["fast", t.feeFast]];
  if (result)
    return (
      <div className="page stack">
        {result.state === "sent"
          ? <div className="empty"><div className="ic" style={{ color: "var(--good)" }}><Check size={28} /></div>{t.sent}</div>
          : <div className="note info"><Globe size={16} /><span>{t.utxoUnknown}</span></div>}
        <a className="btn ghost block" href={utxoTxUrl(c, result.txid)} target="_blank" rel="noreferrer"><ExternalLink size={16} />{t.viewTx}</a>
        {result.state === "sent" && <SaveOffer rc={rc} />}
        <button className="btn primary block" onClick={done}>{t.toActivity}</button>
      </div>
    );
  if (quote)
    return (
      <div className="page stack">
        <h1>{t.reviewTitle}</h1>
        <div className="list" style={{ padding: "4px 14px" }}>
          <div className="kv"><span>{t.amount}</span><b className="num" dir="ltr">{formatUtxo(quote.amount)} {c.symbol}</b></div>
          <ToReview rc={rc} />
          <div className="kv"><span>{toAddrLabel(t, rc)}</span><span className="mono" style={{ fontSize: 12, wordBreak: "break-all" }}>{quote.to}</span></div>
          <div className="kv"><span>{t.network}</span><span className="row" style={{ gap: 6 }}><NetworkDot id={c.id} />{c.name}</span></div>
          <div className="kv"><span>{t.btcFee}</span><span className="num" dir="ltr">{formatUtxo(quote.fee)} {c.symbol} · {rateLabel(c, quote.feeRate)}</span></div>
          <div className="kv"><span>{t.total}</span><b className="num" dir="ltr">{formatUtxo(quote.amount + quote.fee)} {c.symbol}</b></div>
        </div>
        {feeShareHigh(quote.fee, quote.amount) && <div className="note warn"><TriangleAlert size={16} /><span>{fill(t.feeShareWarn, { f: amtSym(quote.fee), p: feePct(quote.fee, quote.amount) })}</span></div>}
        {quote.waiting > 0n && <div className="note soft"><Info size={15} /><span>{fill(t.utxoWaiting, { w: iso(formatUtxo(quote.waiting)), sym: c.symbol })}</span></div>}
        {quote.skipped > 0n && <div className="note soft"><Info size={15} /><span>{fill(t.utxoMweb, { s: iso(formatUtxo(quote.skipped)), sym: c.symbol })}</span></div>}
        {isLegacyLtcP2sh(c, quote.to) && <div className="note warn"><TriangleAlert size={16} />{t.ltcOld3}</div>}
        <AlikeWarn rc={rc} />
        <div className="note warn"><TriangleAlert size={16} />{t.irreversible}</div>
        {err && <div className="err">{err}</div>}
        <button className="btn primary block" onClick={confirm} disabled={busy || rc.blocked}>{busy ? t.sending : t.confirmSend}</button>
        <button className="btn ghost block" onClick={() => setQuote(null)} disabled={busy}>{t.edit}</button>
      </div>
    );
  return (
    <div className="page stack">
      <h1>{t.sendOn} {c.name}</h1>
      {prev && (
        <div className="sheet" style={{ gap: 8 }}>
          <b className="row" style={{ gap: 6 }}><TriangleAlert size={16} />{t.pendingTitle}</b>
          <span>{fill(t.utxoPendingWarn, { a: iso(formatUtxo(prev.amount)), sym: c.symbol })}</span>
          <a className="btn ghost block" href={utxoTxUrl(c, prev.txid)} target="_blank" rel="noreferrer"><ExternalLink size={16} />{t.viewTx}</a>
          <button className="btn ghost block" disabled={busy} onClick={() => void rebroadcast()}>{t.rebroadcast}</button>
          <label className="check"><input type="checkbox" checked={prevOk} onChange={(e) => setPrevOk(e.target.checked)} />{t.pendingOverride}</label>
        </div>
      )}
      {prevNote && <div className="note soft"><Info size={15} /><span>{prevNote}</span></div>}
      <ToField rc={rc} to={to} setTo={setTo} label={t.recipient} placeholder={c.id === "dogecoin" ? "D…" : "ltc1…"} setAmount={setAmount} />
      {old3 && <div className="note warn"><TriangleAlert size={16} />{t.ltcOld3}</div>}
      {old3 && <label className="check"><input type="checkbox" checked={old3Ok} onChange={(e) => setOld3For(e.target.checked ? to.trim() : "")} />{t.ltcOld3Ok}</label>}
      <AlikeWarn rc={rc} check />
      <label className="field">{t.amount} ({c.symbol})<input className="input num" inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
      <AmountNote amount={amount} />
      <PctRow key={c.id} getMax={async () => utxoSpendable(c, phrase, index, rate, await ownTxids())} decimals={8} onPick={setAmount} />
      <div className="field">{t.feeSpeedPlain}
        <div className="seg" style={{ alignSelf: "flex-start" }}>
          {SPEEDS.map(([k, label]) => <button key={k} className={speed === k ? "on" : ""} onClick={() => setSpeed(k)}>{label}</button>)}
        </div>
        <span className="faint" dir="ltr" style={{ textAlign: "start" }}>{rateLabel(c, rate)}</span>
        <span className="faint">{c.id === "dogecoin" ? t.dogeFeeNote : t.ltcFeeNote}</span>
      </div>
      {err && <div className="err">{err}</div>}
      <button className="btn primary block" disabled={busy || !to.trim() || !amount || amountState(amount).bad || rc.blocked || !old3Ok || (!!prev && !prevOk)} onClick={review}>{busy ? t.calculating : t.review}</button>
    </div>
  );
}

export function AdaSend({ phrase, index, settings, done }: { phrase: string; index: number; settings: Settings; done: () => void }) {
  const { t } = useT();
  const from = useMemo(() => adaAddress(phrase, index), [phrase, index]);
  const [to, setTo] = useState(""), [amount, setAmount] = useState("");
  const rc = useRecipient(phrase, settings, index, "ada", to, to.trim() || null);
  const [quote, setQuote] = useState<AdaQuote | null>(null);
  const [busy, setBusy] = useState(false), [err, setErr] = useState(""), [result, setResult] = useState<{ hash: string; state: "sent" | "unknown" } | null>(null);
  const [prev, setPrev] = useState<NonNullable<ReturnType<typeof adaSignedOf>> | null>(null), [prevOk, setPrevOk] = useState(false);
  useEffect(() => {
    let live = true;
    void (async () => {
      const p = adaSignedOf(await getPending(ADA.id, from).catch(() => null));
      if (!p) return;
      const st = await adaPaymentState(p).catch(() => "waiting" as const);
      if (!live) return;
      if (st === "ok") { await clearPending(ADA.id, from, p.hash); return; }
      if (st === "dropped") { await clearPending(ADA.id, from, p.hash); await removeActivity(p.hash).catch(() => {}); return; }
      setPrev(p);
    })();
    return () => { live = false; };
  }, [from]);
  const busyIns = prev?.ins ?? [];
  const amtSym = (v: bigint) => iso(`${formatAda(v)} ADA`);
  const friendly = (e: unknown) => {
    const x = e as { message?: string; max?: bigint; min?: bigint; keep?: bigint };
    const m = x?.message ?? String(e);
    if (m === "ERR_FUNDS") return [t.errFunds, x.max ? fill(t.adaMax, { m: iso(formatAda(x.max)) }) : ""].filter(Boolean).join(" ");
    if (m === "ERR_ADA_MIN") return fill(t.errAdaMin, { m: iso(formatAda(x.min ?? 0n)) });
    if (m === "ERR_ADA_CHANGE") return fill(t.errAdaChange, { m: iso(formatAda(x.max ?? 0n)), k: iso(formatAda(x.keep ?? 0n)) });
    const map: Record<string, string> = {
      ERR_ADDRESS: t.errAdaAddress, ERR_AMOUNT: t.errAmount, ERR_ZERO: t.errZero, ERR_SELF: t.errSelf, ERR_ADA_INPUTS: t.errAdaInputs, ERR_ADA_SCRIPT: t.errAdaScript, ERR_ADA_TIME: t.errAdaTime,
      ERR_PROVIDER: t.errProvider, ERR_UNSAFE: t.swapUnsafe, ERR_FEE_HIGH: t.errCoinFeeHigh, ERR_BROADCAST: t.errBroadcast, ERR_BUSY: t.busyWait,
    };
    if (map[m]) return map[m];
    if (/fetch|network|Failed|HTTP|timeout|abort/i.test(m)) return t.errNet;
    return t.errGeneric;
  };
  async function review() {
    if (prev && !prevOk) return;
    setBusy(true); setErr(""); void touch();
    try { setQuote(await quoteAdaSend(phrase, index, to, amountState(amount).txt, busyIns)); } catch (e) { setErr(friendly(e)); }
    setBusy(false);
  }

  const [prevNote, setPrevNote] = useState("");
  async function rebroadcast() {
    if (!prev) return;
    setBusy(true); setPrevNote("");
    try { setPrevNote((await submitAda(prev.cbor, prev.hash)) === "sent" ? t.rebroadcastDone : t.utxoUnknown); }
    catch (e) { setPrevNote((e as { notSent?: boolean })?.notSent ? t.busyWait : t.rebroadcastNo); }
    setBusy(false);
  }
  async function confirm() {
    if (!quote || rc.blocked || busy) return;
    setBusy(true); setErr(""); void touch();
    let signed: { hash: string; cbor: string };
    try { signed = signAdaPayment(phrase, index, quote); } catch (e) { setErr(friendly(e)); setQuote(null); setBusy(false); return; }

    const at = Date.now();
    try {
      await setPending({ ...adaPendingOf(quote, signed), at });
      await addActivity({ at, networkId: ADA.id, kind: "send", asset: "ADA", amount: formatAda(quote.amount), to: quote.to, hash: signed.hash, from: quote.from });
    } catch { await clearPending(ADA.id, quote.from, signed.hash).catch(() => {}); setErr(t.errGeneric); setBusy(false); return; }
    let state: "sent" | "unknown" = "unknown";
    try { state = await submitAda(signed.cbor, signed.hash); }
    catch (e) {
      const x = e as { message?: string; notSent?: boolean };
      if (x?.message === "ERR_BROADCAST" || (x?.message === "ERR_BUSY" && x.notSent)) {
        await clearPending(ADA.id, quote.from, signed.hash).catch(() => {}); await removeActivity(signed.hash).catch(() => {});
        setErr(friendly(e)); setQuote(null); setBusy(false); return;
      }
    }

    setResult({ hash: signed.hash, state });
    setBusy(false);
  }
  if (result)
    return (
      <div className="page stack">
        {result.state === "sent"
          ? <div className="empty"><div className="ic" style={{ color: "var(--good)" }}><Check size={28} /></div>{t.sent}</div>
          : <div className="note info"><Globe size={16} /><span>{t.utxoUnknown}</span></div>}
        <a className="btn ghost block" href={adaTxUrl(result.hash)} target="_blank" rel="noreferrer"><ExternalLink size={16} />{t.viewTx}</a>
        {result.state === "sent" && <SaveOffer rc={rc} />}
        <button className="btn primary block" onClick={done}>{t.toActivity}</button>
      </div>
    );
  if (quote)
    return (
      <div className="page stack">
        <h1>{t.reviewTitle}</h1>
        <div className="list" style={{ padding: "4px 14px" }}>
          <div className="kv"><span>{t.amount}</span><b className="num" dir="ltr">{formatAda(quote.amount)} ADA</b></div>
          <ToReview rc={rc} />
          <div className="kv"><span>{toAddrLabel(t, rc)}</span><span className="mono" style={{ fontSize: 12, wordBreak: "break-all" }}>{quote.to}</span></div>
          <div className="kv"><span>{t.network}</span><span className="row" style={{ gap: 6 }}><NetworkDot id={ADA.id} />{ADA.name}</span></div>
          <div className="kv"><span>{t.btcFee}</span><span className="num" dir="ltr">{formatAda(quote.fee)} ADA</span></div>
          <div className="kv"><span>{t.total}</span><b className="num" dir="ltr">{formatAda(quote.amount + quote.fee)} ADA</b></div>
        </div>
        {feeShareHigh(quote.fee, quote.amount) && <div className="note warn"><TriangleAlert size={16} /><span>{fill(t.feeShareWarn, { f: amtSym(quote.fee), p: feePct(quote.fee, quote.amount) })}</span></div>}
        {quote.keptAssets > 0 && <div className="note soft"><Info size={15} /><span>{t.adaTokensKept}</span></div>}
        <AlikeWarn rc={rc} />
        <div className="note warn"><TriangleAlert size={16} />{t.irreversible}</div>
        {err && <div className="err">{err}</div>}
        <button className="btn primary block" onClick={confirm} disabled={busy || rc.blocked}>{busy ? t.sending : t.confirmSend}</button>
        <button className="btn ghost block" onClick={() => setQuote(null)} disabled={busy}>{t.edit}</button>
      </div>
    );
  return (
    <div className="page stack">
      <h1>{t.sendOn} {ADA.name}</h1>
      {prev && (
        <div className="sheet" style={{ gap: 8 }}>
          <b className="row" style={{ gap: 6 }}><TriangleAlert size={16} />{t.pendingTitle}</b>
          <span>{fill(t.utxoPendingWarn, { a: iso(formatAda(prev.amount)), sym: "ADA" })}</span>
          <a className="btn ghost block" href={adaTxUrl(prev.hash)} target="_blank" rel="noreferrer"><ExternalLink size={16} />{t.viewTx}</a>
          <button className="btn ghost block" disabled={busy} onClick={() => void rebroadcast()}>{t.rebroadcast}</button>
          <label className="check"><input type="checkbox" checked={prevOk} onChange={(e) => setPrevOk(e.target.checked)} />{t.pendingOverride}</label>
        </div>
      )}
      {prevNote && <div className="note soft"><Info size={15} /><span>{prevNote}</span></div>}
      <ToField rc={rc} to={to} setTo={setTo} label={t.recipient} placeholder="addr1…" setAmount={setAmount} />
      <AlikeWarn rc={rc} check />
      <label className="field">{t.amount} (ADA)<input className="input num" inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
      <AmountNote amount={amount} />
      <PctRow getMax={() => adaSpendable(phrase, index, busyIns, to.trim() || undefined)} decimals={6} onPick={setAmount} />
      <span className="faint">{t.adaFeeNote}</span>
      {err && <div className="err">{err}</div>}
      <button className="btn primary block" disabled={busy || !to.trim() || !amount || amountState(amount).bad || rc.blocked || (!!prev && !prevOk)} onClick={review}>{busy ? t.calculating : t.review}</button>
    </div>
  );
}

function xrpClassicOf(input: string): string | null {
  const v = input.trim();
  if (!v) return null;
  if (isXrpClassic(v)) return v;
  try { return decodeXAddress(v).address; } catch { return v; }
}

type XrpTrack = { s: XrpSigned; at: number; end: XrpEnd | null; mine: boolean };

export function XrpSend({ phrase, index, settings, done }: { phrase: string; index: number; settings: Settings; done: () => void }) {
  const { t } = useT();
  const from = useMemo(() => xrpAddress(phrase, index), [phrase, index]);
  const [to, setTo] = useState(""), [tag, setTag] = useState(""), [amount, setAmount] = useState("");
  const dest = xrpClassicOf(to);
  const rc = useRecipient(phrase, settings, index, "xrp", to, dest);
  const xTag = useMemo(() => { try { return /^X/.test(to.trim()) ? decodeXAddress(to.trim()).tag : null; } catch { return null; } }, [to]);
  const isX = /^X/.test(to.trim());
  const [quote, setQuote] = useState<XrpQuote | null>(null);
  const [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const [track, setTrack] = useState<XrpTrack | null | undefined>(undefined), [prevNote, setPrevNote] = useState("");
  const [overOk, setOverOk] = useState(false), [past, setPast] = useState<string | null>(null);

  const [tagOk, setTagOk] = useState(false);
  const xrp = (d: bigint) => formatXrp(d < 0n ? 0n : d);
  const friendly = (e: unknown) => {
    const x = e as { message?: string; need?: bigint; max?: bigint; reserve?: bigint; code?: string };
    const m = x?.message ?? String(e);
    if (m === "ERR_XRP_ACTIVATE") return fill(t.errXrpActivate, { r: iso(xrp(x.need ?? 0n)) });
    if (m === "ERR_XRP_INACTIVE") return fill(t.errXrpInactive, { r: iso(xrp(x.need ?? 0n)) });
    if (m === "ERR_FUNDS" && x.reserve != null) return fill(t.errXrpFunds, { m: iso(xrp(x.max ?? 0n)), r: iso(xrp(x.reserve)) });
    const map: Record<string, string> = {
      ERR_ADDRESS: t.errXrpAddress, ERR_TESTNET: t.errXrpTestnet, ERR_TAG: t.errXrpTag, ERR_TAG_CONFLICT: t.errXrpTagConflict, ERR_TAG_REQUIRED: t.errXrpTagRequired,
      ERR_XRP_DISALLOWED: t.errXrpDisallowed, ERR_DEPOSIT_AUTH: t.errXrpDepositAuth, ERR_HOSTS: t.errXrpHosts, ERR_FEE_HIGH: t.errXrpFeeHigh,
      ERR_AMOUNT: t.errAmount, ERR_ZERO: t.errZero, ERR_FUNDS: t.errFunds, ERR_SELF: t.errSelf, ERR_UNSAFE: t.swapUnsafe, ERR_BUSY: t.busyWait, ERR_XRPL: t.errProvider,
    };
    if (map[m]) return map[m];
    if (/fetch|network|HTTP|timeout|abort|tooBusy|slowDown/i.test(m)) return t.errNet;
    return t.errGeneric;
  };

  async function settle(s: XrpSigned, end: XrpEnd): Promise<boolean> {
    if (end.state !== "ok" && end.state !== "failed" && end.state !== "dropped") return false;
    await clearPending(XRP.id, s.from, s.hash);
    if (end.state === "dropped") await removeActivity(s.hash);
    return true;
  }

  async function follow(s: XrpSigned, at: number, mine: boolean, maxMs: number) {
    setTrack({ s, at, end: null, mine });
    const end = await waitXrp(s, { maxMs });
    const fin = await settle(s, end).catch(() => false);
    if (!mine && fin) {
      setTrack(null);
      setPrevNote(end.state === "dropped" ? fill(t.xrpPrevDropped, { a: iso(formatXrp(s.amount)) }) : end.state === "failed" ? fill(t.errXrpChain, { c: end.code }) : "");
      return;
    }
    setTrack({ s, at, end, mine });
  }
  useEffect(() => {
    let live = true;
    void (async () => {
      const p = await getPending(XRP.id, from).catch(() => null);
      const s = xrpSignedOf(p);
      if (!live) return;
      if (!s || !p) { setTrack(null); return; }
      await follow(s, p.at, false, 0);
    })();
    return () => { live = false; };
  }, [from]);
  async function review() {
    setBusy(true); setErr(""); setTagOk(false); void touch();
    try { setQuote(await quoteXrpSend(phrase, index, to, isX ? "" : tag, amountState(amount).txt)); } catch (e) { setErr(friendly(e)); }
    setBusy(false);
  }
  const askTag = !!quote && xrpAskTag(quote, rc.ownIdx);
  async function confirm() {
    if (!quote || rc.blocked || busy || (askTag && !tagOk) || track) return;
    setBusy(true); setErr(""); void touch();

    const p = await getPending(XRP.id, from).catch(() => null), open = xrpSignedOf(p);
    if (open && p && xrpBlocked(open.hash, past)) { setQuote(null); setBusy(false); await follow(open, p.at, false, 0); return; }
    let s: XrpSigned;
    try { s = await signXrpSend(phrase, index, quote); } catch (e) { setErr(friendly(e)); setQuote(null); setBusy(false); return; }

    const at = Date.now();
    try {
      await setPending({ ...xrpPendingOf(s), at });
      await addActivity({ at, networkId: XRP.id, kind: "send", asset: "XRP", amount: formatXrp(s.amount), to: s.to, hash: s.hash, from: s.from });
    } catch { await clearPending(XRP.id, s.from, s.hash).catch(() => {}); setErr(t.errGeneric); setBusy(false); return; }
    setTrack({ s, at, end: null, mine: true });
    const r = await submitXrp(s);
    if (r.state === "refused") {
      await clearPending(XRP.id, s.from, s.hash).catch(() => {}); await removeActivity(s.hash).catch(() => {});
      setTrack(null); setQuote(null); setErr(fill(t.errXrpRefused, { c: r.code ?? "" })); setBusy(false); return;
    }
    await follow(s, at, true, 60_000);
    setBusy(false);
  }
  async function again(resubmit: boolean) {
    if (!track || busy) return;
    setBusy(true); setPrevNote("");
    if (resubmit) await submitXrp(track.s);
    await follow(track.s, track.at, track.mine, resubmit ? 20_000 : 0);
    setBusy(false);
  }
  const explorer = (h: string) => <a className="btn ghost block" href={xrpTxUrl(h)} target="_blank" rel="noreferrer"><ExternalLink size={16} />{t.viewTx}</a>;
  if (track && track.mine) {
    const e = track.end;
    return (
      <div className="page stack">
        {!e && <div className="empty">{t.sending}</div>}
        {e?.state === "ok" && <div className="empty"><div className="ic" style={{ color: "var(--good)" }}><Check size={28} /></div>{t.sent}</div>}
        {e?.state === "failed" && <div className="err">{fill(t.errXrpChain, { c: e.code })}</div>}
        {e?.state === "dropped" && <div className="err">{t.errXrpDropped}</div>}
        {e?.state === "check" && <div className="note info"><Globe size={16} /><span>{fill(t.xrpCheckNote, { c: e.code ?? "" })}</span></div>}
        {e?.state === "pending" && <div className="note info"><Globe size={16} /><span>{t.xrpPendingNote}</span></div>}
        {e?.state !== "dropped" && explorer(track.s.hash)}
        {(e?.state === "check" || e?.state === "pending") && <button className="btn ghost block" disabled={busy} onClick={() => void again(false)}>{t.checkAgain}</button>}
        {e?.state === "ok" && <SaveOffer rc={rc} />}
        {e?.state === "dropped"
          ? <button className="btn primary block" onClick={() => { setTrack(null); setQuote(null); }}>{t.edit}</button>
          : e && <button className="btn primary block" onClick={done}>{t.toActivity}</button>}
      </div>
    );
  }
  if (track) {
    const e = track.end, canOver = canGoPast(track.at);
    return (
      <div className="page stack">
        <h1>{t.sendOn} {XRP.name}</h1>
        <div className="sheet" style={{ gap: 8 }}>
          <b className="row" style={{ gap: 6 }}><TriangleAlert size={16} />{t.pendingTitle}</b>
          <span>{fill(t.xrpPendingBlock, { a: iso(formatXrp(track.s.amount)), to: iso(short(track.s.to)) })}</span>
          {e?.state === "check" && <span>{fill(t.xrpCheckNote, { c: e.code ?? "" })}</span>}
          {explorer(track.s.hash)}
          <button className="btn ghost block" disabled={busy || !e} onClick={() => void again(false)}>{busy || !e ? t.pendingChecking : t.checkAgain}</button>
          <button className="btn ghost block" disabled={busy || !e} onClick={() => void again(true)}>{t.resubmitSame}</button>
          <span className="faint">{t.resubmitNote}</span>
          {canOver && e && <label className="check"><input type="checkbox" checked={overOk} onChange={(ev) => setOverOk(ev.target.checked)} />{t.pendingOverride}</label>}
          {canOver && e && <button className="btn ghost block" disabled={!overOk || busy} onClick={() => { setPast(track.s.hash); setTrack(null); setOverOk(false); }}>{t.pendingContinue}</button>}
        </div>
      </div>
    );
  }
  if (quote)
    return (
      <div className="page stack">
        <h1>{t.reviewTitle}</h1>
        <div className="list" style={{ padding: "4px 14px" }}>
          <div className="kv"><span>{t.amount}</span><b className="num" dir="ltr">{formatXrp(quote.amount)} XRP</b></div>
          <ToReview rc={rc} />
          <div className="kv"><span>{toAddrLabel(t, rc)}</span><span className="mono" style={{ fontSize: 12, wordBreak: "break-all" }}>{quote.to}</span></div>
          <div className="kv"><span>{t.xrpTagRow}</span><b className="num" dir="ltr">{quote.tag != null ? String(quote.tag) : <bdi dir="auto">{t.xrpTagNone}</bdi>}</b></div>
          <div className="kv"><span>{t.network}</span><span className="row" style={{ gap: 6 }}><NetworkDot id={XRP.id} />{XRP.name}</span></div>
          <div className="kv"><span>{t.btcFee}</span><span className="num" dir="ltr">{formatXrp(quote.fee)} XRP</span></div>
          <div className="kv"><span>{t.xrpReserveRow}</span><span className="num" dir="ltr">{formatXrp(quote.reserve)} XRP</span></div>
          <div className="kv"><span>{t.total}</span><b className="num" dir="ltr">{formatXrp(quote.amount + quote.fee)} XRP</b></div>
        </div>
        {quote.newAccount && <div className="note info"><Globe size={16} /><span>{fill(t.xrpNewAccount, { r: iso(xrp(quote.reserveBase)) })}</span></div>}
        {feeShareHigh(quote.fee, quote.amount) && <div className="note warn"><TriangleAlert size={16} /><span>{fill(t.feeShareWarn, { f: iso(`${formatXrp(quote.fee)} XRP`), p: feePct(quote.fee, quote.amount) })}</span></div>}
        {askTag && <div className="note warn"><TriangleAlert size={16} /><span>{t.xrpNoTagQ}</span></div>}
        {askTag && <label className="check"><input type="checkbox" checked={tagOk} onChange={(e) => setTagOk(e.target.checked)} />{t.xrpNoTagOk}</label>}
        <AlikeWarn rc={rc} />
        <div className="note warn"><TriangleAlert size={16} />{t.irreversible}</div>
        {err && <div className="err">{err}</div>}
        <button className="btn primary block" onClick={confirm} disabled={busy || rc.blocked || (askTag && !tagOk)}>{busy ? t.sending : t.confirmSend}</button>
        <button className="btn ghost block" onClick={() => setQuote(null)} disabled={busy}>{t.edit}</button>
      </div>
    );
  return (
    <div className="page stack">
      <h1>{t.sendOn} {XRP.name}</h1>
      {prevNote && <div className="note soft"><Info size={15} /><span>{prevNote}</span></div>}
      <ToField rc={rc} to={to} setTo={setTo} label={t.recipient} placeholder="r… / X…" setAmount={setAmount} />
      <AlikeWarn rc={rc} check />
      <label className="field">{t.xrpTagLabel}
        <input className="input num" inputMode="numeric" dir="ltr" placeholder={t.xrpTagPh} value={isX ? (xTag != null ? String(xTag) : "") : tag} disabled={isX} onChange={(e) => setTag(e.target.value)} />
        <span className="faint">{isX && xTag != null ? fill(t.xrpTagFromAddr, { t: String(xTag) }) : t.xrpTagHint}</span>
      </label>
      <label className="field">{t.amount} (XRP)<input className="input num" inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
      <AmountNote amount={amount} />
      <PctRow getMax={() => xrpSpendable(phrase, index)} decimals={6} onPick={setAmount} />
      <div className="faint">{t.xrpFeeNote}</div>
      {track === undefined && <div className="faint">{t.pendingChecking}</div>}
      {err && <div className="err">{err}</div>}
      <button className="btn primary block" disabled={busy || track === undefined || !to.trim() || !amount || amountState(amount).bad || rc.blocked} onClick={review}>{busy ? t.calculating : t.review}</button>
    </div>
  );
}

export interface GasWays { swap?: () => void; p2p?: () => void }
export function GasHelp({ sym, netName, address, ways }: { sym: string; netName: string; address: string; ways?: GasWays }) {
  const { t } = useT();
  const [copied, setCopied] = useState(false);
  return (
    <div className="sheet" style={{ gap: 8 }}>
      <b className="row" style={{ gap: 6 }}><Fuel size={16} />{fill(t.gasHowTitle, { sym })}</b>
      {ways?.swap && <button className="btn primary block" onClick={ways.swap}>{fill(t.gasFromOther, { sym })}</button>}
      {ways?.p2p && <button className="btn ghost block" onClick={ways.p2p}><Users size={16} />{fill(t.gasBuy, { sym })}</button>}
      <button className="btn ghost block" onClick={() => { void navigator.clipboard.writeText(address); setCopied(true); }}><Copy size={16} />{copied ? t.copied : fill(t.gasAsk, { sym, net: netName })}</button>
    </div>
  );
}

export function TonSend({ phrase, index, settings, pre, done }: { phrase: string; index: number; settings: Settings; pre?: string; done: () => void }) {
  const { t } = useT();
  const [asset, setAsset] = useState<"TON" | "USDT">(pre && pre !== "native" ? "USDT" : "TON");
  const decimals = asset === "TON" ? 9 : 6;
  const [to, setTo] = useState(""), [amount, setAmount] = useState(""), [comment, setComment] = useState("");
  const [quote, setQuote] = useState<TonQuote | null>(null);
  const [busy, setBusy] = useState(false), [err, setErr] = useState(""), [sent, setSent] = useState<{ wallet: string; seqno: number } | null>(null), [slow, setSlow] = useState(false);
  const rc = useRecipient(phrase, settings, index, "ton", to, to.trim() || null);
  const tonTxt = (n: bigint) => amt(formatUnitsStr(n < 0n ? 0n : n, 9), 9);
  const friendly = (e: unknown) => {
    const x = e as { message?: string; need?: bigint; have?: bigint };
    const m = x?.message ?? String(e);
    if (m === "ERR_GAS") return fill(t.tonGasShort, { n: tonTxt(x.need ?? 0n), h: tonTxt(x.have ?? 0n) });
    const map: Record<string, string> = { ERR_ADDRESS: t.errTonAddress, ERR_ZERO: t.errZero, ERR_FUNDS: t.errFunds, ERR_AMOUNT: t.errAmount, ERR_TON_COMMENT: t.errTonComment, ERR_TON_FAILED: t.tonFailed, ERR_TON_JETTON: t.errNet, ERR_TON_EXPIRED: t.tonExpired, busy: t.busyWait };
    if (map[m]) return map[m];
    if (/fetch|network|HTTP|timeout|abort/i.test(m)) return t.errNet;
    return t.errGeneric;
  };

  const applyScan = (r: ScanResult): string | null => {
    let a: "TON" | "USDT" = "TON";
    if (r.token) { if (!sameTonAddress(r.token, TON_USDT)) return t.scanTokenUnknown; a = "USDT"; }
    let v = r.amount ?? "";
    if (r.raw) { try { v = formatUnitsStr(BigInt(r.raw), a === "TON" ? 9 : 6); } catch { return t.scanAmountBad; } }
    setAsset(a); setTo(r.to); setComment(r.memo ?? ""); setAmount(v);
    return null;
  };
  async function review() {
    setBusy(true); setErr(""); void touch();
    try {
      const a = amountState(amount);
      if (a.bad) throw new Error("ERR_AMOUNT");
      const { quoteTonSend } = await import("../core/ton");
      setQuote(await quoteTonSend(phrase, index, { to, amount: parseUnitsStr(a.txt, decimals), asset, comment }));
    } catch (e) { setErr(friendly(e)); }
    setBusy(false);
  }
  async function confirm() {
    if (!quote || rc.blocked) return;
    setBusy(true); setErr(""); void touch();
    try {
      const { sendTon, tonSendState } = await import("../core/ton");
      const r = await sendTon(phrase, index, quote);
      await addActivity({ at: Date.now(), networkId: TON.id, kind: "send", asset, amount: formatUnitsStr(quote.amount, decimals), to: to.trim(), hash: r.hash, from: tonAddress(phrase, index) });

      let st: Awaited<ReturnType<typeof tonSendState>> = "pending";
      for (let i = 0; i < 18 && st === "pending"; i++) { await new Promise((res) => setTimeout(res, 5000)); st = await tonSendState(r.wallet, r.hash, r.timeout).catch(() => "pending" as const); }
      if (st === "failed" || st === "expired") {
        await removeActivity(r.hash);
        setQuote(null);
        throw new Error(st === "failed" ? "ERR_TON_FAILED" : "ERR_TON_EXPIRED");
      }
      setSlow(st !== "done");
      setSent({ wallet: r.wallet, seqno: r.seqno });
    } catch (e) { setErr(friendly(e)); setQuote(null); }
    setBusy(false);
  }
  if (sent)
    return (
      <div className="page stack">
        <div className="empty"><div className="ic" style={{ color: "var(--good)" }}><Check size={28} /></div>{t.sent}</div>
        {slow && <div className="note info"><Globe size={16} />{t.swapPending}</div>}
        <a className="btn ghost block" href={`${TON.explorer}/${sent.wallet}`} target="_blank" rel="noreferrer"><ExternalLink size={16} />{t.viewTx}</a>
        <SaveOffer rc={rc} />
        <button className="btn primary block" onClick={done}>{t.toActivity}</button>
      </div>
    );
  if (quote)
    return (
      <div className="page stack">
        <h1>{t.reviewTitle}</h1>
        <div className="list" style={{ padding: "4px 14px" }}>
          <div className="kv"><span>{t.amount}</span><b className="num" dir="ltr">{amt(formatUnitsStr(quote.amount, decimals), decimals)} {asset}</b></div>
          <ToReview rc={rc} />
          <div className="kv"><span>{toAddrLabel(t, rc)}</span><span className="mono" style={{ fontSize: 12, wordBreak: "break-all" }}>{to.trim()}</span></div>
          {quote.comment && <div className="kv"><span>{t.tonComment}</span><span dir="auto" style={{ wordBreak: "break-all" }}>{quote.comment}</span></div>}
          <div className="kv"><span>{t.network}</span><span className="row" style={{ gap: 6 }}><NetworkDot id={TON.id} />TON</span></div>
          <div className="kv"><span>{t.tonFeeRow}</span><span className="num">{asset === "TON" ? t.tonFeeTon : t.tonFeeJetton}</span></div>
        </div>
        {asset === "TON" && !quote.bounce && <div className="note soft"><Globe size={16} /><span>{t.tonNewAccount}</span></div>}
        <AlikeWarn rc={rc} />
        <div className="note warn"><TriangleAlert size={16} />{t.irreversible}</div>
        {err && <div className="err">{err}</div>}
        <button className="btn primary block" onClick={confirm} disabled={busy || rc.blocked}>{busy ? t.sending : t.confirmSend}</button>
        <button className="btn ghost block" onClick={() => setQuote(null)} disabled={busy}>{t.edit}</button>
      </div>
    );
  return (
    <div className="page stack">
      <h1>{t.sendOn} {TON.name}</h1>
      <label className="field">{t.asset}
        <select className="input" value={asset} onChange={(e) => { setAsset(e.target.value as "TON" | "USDT"); setAmount(""); }}>
          <option value="TON">TON — Toncoin</option>
          <option value="USDT">USDT (TON) — Tether USD</option>
        </select>
      </label>
      <ToField rc={rc} to={to} setTo={setTo} label={t.recipient} placeholder="UQ… / EQ…" onScan={applyScan} />
      <AlikeWarn rc={rc} check />
      <label className="field">{t.amount} ({asset})<input className="input num" inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
      <AmountNote amount={amount} />
      <PctRow key={asset} getMax={async () => { const b = await tonBalances(tonAddress(phrase, index)); return asset === "TON" ? (b.nano > TON_SEND_RESERVE ? b.nano - TON_SEND_RESERVE : 0n) : b.usdt; }} decimals={decimals} onPick={setAmount} />
      <label className="field">{t.tonComment}<input className="input" maxLength={120} spellCheck={false} value={comment} onChange={(e) => setComment(e.target.value)} /></label>
      <div className="faint">{t.tonCommentHint}</div>
      <div className="faint">{t.tonFeeNote}</div>
      {err && <div className="err">{err}</div>}
      <button className="btn primary block" disabled={busy || !to.trim() || !amount || amountState(amount).bad || rc.blocked} onClick={review}>{busy ? t.calculating : t.review}</button>
    </div>
  );
}

const TON_SEND_RESERVE = 10_000_000n;
