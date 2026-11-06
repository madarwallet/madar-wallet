import { useEffect, useMemo, useState } from "react";
import { erc20Abi, parseUnits, type Address, type Hex } from "viem";
import { activeNetworks, type Network } from "../core/chains";
import { publicClient } from "../core/chainops";
import { evmAddress } from "../core/account";
import { amountChars } from "../core/amount";
import { formatUnitsStr } from "../core/solbase";
import { evmAllowance, evmApprove, EVM_NATIVE, feeBps } from "../core/swap";
import { isForeignCopy } from "../core/picker";
import type { Settings } from "../core/store";
import {
  allowanceNeed, buyAmountFor, cancelOrders, checkOrder, COW_RELAYER, cowNet, DAY, dropOrder, fillsNow, limitFeeReceiver, loadOrders, makeOrder, orderState, parsePrice,
  placeOrder, saveOrder, sellAmountFor, splitFee, VALID_DAYS, type OrderState, type PlacedOrder,
} from "../core/limit";
import { fill, useT } from "./i18n";

interface Side { token: string; decimals: number; symbol: string }
interface Market { n: Network; coin: Side; dollar: Side }

export function limitMarkets(nets: readonly Network[], coin: string, dollar: string, side: "buy" | "sell"): Market[] {
  const out: Market[] = [];
  for (const n of nets) {
    if (!cowNet(n.id)) continue;
    const d = n.tokens.find((t) => t.symbol === dollar && t.verified);
    if (!d) continue;
    const own = n.native.symbol === coin;
    const tok = n.tokens.find((t) => t.symbol === coin && t.verified && !isForeignCopy({ netId: n.id, symbol: t.symbol, native: false }));
    if (side === "sell" && !tok) continue;
    if (side === "buy" && !own && !tok) continue;
    const c: Side = tok ? { token: tok.address, decimals: tok.decimals, symbol: coin } : { token: EVM_NATIVE, decimals: n.chain.nativeCurrency.decimals, symbol: coin };
    out.push({ n, coin: c, dollar: { token: d.address, decimals: d.decimals, symbol: dollar } });
  }
  return out;
}

async function balanceOf(n: Network, token: string, owner: string): Promise<bigint> {
  if (token.toLowerCase() === EVM_NATIVE.toLowerCase()) return publicClient(n).getBalance({ address: owner as Address });
  return (await publicClient(n).readContract({ address: token as Address, abi: erc20Abi, functionName: "balanceOf", args: [owner as Address] })) as bigint;
}

export function LimitOrder({ phrase, settings, coin, side, dollar, market }: { phrase: string; settings: Settings; coin: string; side: "buy" | "sell"; dollar: string; market: number | null }) {
  const { t } = useT();
  const idx = settings.accountIndex;
  const me = evmAddress(phrase, idx);
  const markets = useMemo(() => limitMarkets(activeNetworks(settings), coin, dollar, side), [settings, coin, dollar, side]);
  const [netId, setNetId] = useState<string>("");
  const [bal, setBal] = useState<Record<string, bigint>>({});
  const [amount, setAmount] = useState("");
  const [price, setPrice] = useState("");
  const [days, setDays] = useState<number>(7);
  const [busy, setBusy] = useState<"" | "approve" | "sign">("");
  const [msg, setMsg] = useState<{ kind: "ok" | "warn"; text: string } | null>(null);
  const [orders, setOrders] = useState<(PlacedOrder & { state?: OrderState })[]>([]);

  useEffect(() => {
    let live = true;
    setBal({});
    (async () => {
      const got: Record<string, bigint> = {};
      for (const m of markets) {
        const s = side === "buy" ? m.dollar : m.coin;
        got[m.n.id] = await balanceOf(m.n, s.token, me).catch(() => 0n);
      }
      if (!live) return;
      setBal(got);
      const best = [...markets].sort((a, b) => { const x = got[a.n.id] ?? 0n, y = got[b.n.id] ?? 0n; return y > x ? 1 : y < x ? -1 : 0; })[0];
      setNetId((cur) => (markets.some((m) => m.n.id === cur) ? cur : best?.n.id ?? ""));
    })();
    return () => { live = false; };
  }, [markets, me, side]);
  useEffect(() => { if (market && !price) setPrice(String(Number(market.toPrecision(5)))); }, [market]); // eslint-disable-line react-hooks/exhaustive-deps

  async function refresh() {
    const now = Math.floor(Date.now() / 1000);
    const mine = (await loadOrders()).filter((o) => o.owner.toLowerCase() === me.toLowerCase());
    setOrders(mine);
    const nets = activeNetworks(settings);
    const out: (PlacedOrder & { state?: OrderState })[] = [];
    for (const o of mine) {
      const n = nets.find((x) => x.id === o.netId);
      let state: OrderState = o.validTo < now ? "expired" : "unknown";
      if (n) state = await orderState(n, o.uid).then((s) => s.state, () => state);

      if (state !== "open" && state !== "unknown" && o.validTo < now - 7 * DAY) { await dropOrder(o.uid); continue; }
      out.push({ ...o, state });
    }
    setOrders(out);
  }
  useEffect(() => { void refresh(); }, [me]); // eslint-disable-line react-hooks/exhaustive-deps

  const m = markets.find((x) => x.n.id === netId) ?? null;
  if (!markets.length) return <div className="note">{fill(side === "buy" ? t.lmNoBuy : t.lmNoSell, { c: coin, d: dollar })}</div>;

  const pay = m ? (side === "buy" ? m.dollar : m.coin) : null;
  const get = m ? (side === "buy" ? m.coin : m.dollar) : null;
  const p = parsePrice(price);
  let sellAmount: bigint | null = null;
  try { if (pay && /^\d+(\.\d+)?$/.test(amount)) sellAmount = parseUnits(amount, pay.decimals); } catch { sellAmount = null; }

  const split = sellAmount && sellAmount > 0n ? splitFee(sellAmount, me) : null;
  const outFor = (x: bigint) => (!m || !p ? null : side === "buy" ? buyAmountFor(x, m.dollar.decimals, p, m.coin.decimals) : sellAmountFor(x, m.coin.decimals, p, m.dollar.decimals));
  const buyAmount = split && split.main > 0n ? outFor(split.main) : null;
  const feeBuy = split && split.fee > 0n ? outFor(split.fee) : null;
  const have = m ? bal[m.n.id] : undefined;
  const short = sellAmount != null && have != null && sellAmount > have;
  const now = p ? fillsNow(side, p, market) : false;

  async function submit() {
    if (!m || !pay || !get || !sellAmount || !split || !buyAmount || !p || short) return;
    setMsg(null);
    try {
      const nowS = Math.floor(Date.now() / 1000);
      const validTo = nowS + days * DAY;
      const o = makeOrder({ sellToken: pay.token, buyToken: get.token, sellAmount: split.main, buyAmount, me, validTo });
      checkOrder(o, { me, sellToken: pay.token, buyToken: get.token, sellAmount: split.main, buyAmount, now: nowS });
      const feeTo = limitFeeReceiver(m.n.id, get.token);
      const fo = feeBuy ? makeOrder({ sellToken: pay.token, buyToken: get.token, sellAmount: split.fee, buyAmount: feeBuy, me, validTo, receiver: feeTo }) : null;
      if (fo && feeBuy) checkOrder(fo, { me, sellToken: pay.token, buyToken: get.token, sellAmount: split.fee, buyAmount: feeBuy, now: nowS, receiver: feeTo });
      const need = allowanceNeed(await loadOrders(), m.n.id, me, pay.token, sellAmount, nowS);
      const cur = await evmAllowance(m.n, phrase, idx, pay.token, COW_RELAYER);
      if (cur < need) { setBusy("approve"); await evmApprove(m.n, phrase, idx, pay.token, need, cur, COW_RELAYER); }
      setBusy("sign");
      const uid = await placeOrder(m.n, phrase, idx, o);
      const base = { uid, netId: m.n.id, owner: me, sellToken: pay.token, buyToken: get.token, sellAmount: String(split.main), buyAmount: String(buyAmount), validTo, side, coin, dollar, at: Date.now() };
      await saveOrder(base);
      if (fo) { const feeUid = await placeOrder(m.n, phrase, idx, fo).catch(() => null); if (feeUid) await saveOrder({ ...base, feeUid, feeSell: String(split.fee) }); }
      setMsg({ kind: "ok", text: t.lmPlaced });
      setAmount("");
      void refresh();
    } catch (e) {
      const x = e as { why?: string; message?: string };
      const why = x.why === "InsufficientBalance" ? t.lmErrBalance : x.why === "InsufficientAllowance" ? t.lmErrAllowance : x.message === "ERR_FEE_HIGH" ? t.lmErrGas
        : /insufficient funds/i.test(String(x.message)) ? fill(t.lmErrGasCoin, { c: m.n.native.symbol }) : fill(t.lmErr, { why: x.why ?? x.message ?? "" });
      setMsg({ kind: "warn", text: why });
    } finally { setBusy(""); }
  }

  async function cancel(o: PlacedOrder) {
    const n = activeNetworks(settings).find((x) => x.id === o.netId);
    if (!n) return;
    try { await cancelOrders(n, phrase, idx, o.feeUid ? [o.uid as Hex, o.feeUid] : [o.uid as Hex]); void refresh(); } catch (e) { setMsg({ kind: "warn", text: fill(t.lmErr, { why: (e as { why?: string }).why ?? (e as Error).message }) }); }
  }

  const STATE: Record<OrderState, string> = { open: t.lmOpen, filled: t.lmFilled, cancelled: t.lmCancelled, expired: t.lmExpired, unknown: "…" };
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="note">{side === "buy" ? fill(t.lmBuyNote, { c: coin }) : fill(t.lmSellNote, { c: coin })}</div>
      {markets.length > 1 && (
        <label className="stack" style={{ gap: 4 }}><span className="faint">{t.lmNet}</span>
          <select className="input" value={netId} onChange={(e) => setNetId(e.target.value)}>
            {markets.map((x) => <option key={x.n.id} value={x.n.id}>{x.n.name}{bal[x.n.id] != null ? ` — ${formatUnitsStr(bal[x.n.id], side === "buy" ? x.dollar.decimals : x.coin.decimals)} ${side === "buy" ? dollar : coin}` : ""}</option>)}
          </select>
        </label>
      )}
      <label className="stack" style={{ gap: 4 }}>
        <span className="between faint"><span>{side === "buy" ? fill(t.lmPay, { d: dollar }) : fill(t.lmSellAmt, { c: coin })}</span>
          {have != null && pay && <button className="linkbtn" onClick={() => setAmount(formatUnitsStr(have, pay.decimals))}>{t.lmBal} {formatUnitsStr(have, pay.decimals)}</button>}</span>
        <input className="input num" inputMode="decimal" dir="ltr" value={amount} onChange={(e) => setAmount(amountChars(e.target.value))} placeholder="0" />
      </label>
      <label className="stack" style={{ gap: 4 }}>
        <span className="between faint"><span>{fill(side === "buy" ? t.lmPriceBuy : t.lmPriceSell, { c: coin })}</span>{market ? <span>{t.lmMarket} {Number(market.toPrecision(6))} $</span> : null}</span>
        <input className="input num" inputMode="decimal" dir="ltr" value={price} onChange={(e) => setPrice(amountChars(e.target.value))} placeholder="0" />
      </label>
      <div className="stack" style={{ gap: 4 }}>
        <span className="faint">{t.lmValid}</span>
        <div className="chips" role="tablist" aria-label={t.lmValid} style={{ margin: 0 }}>
          {VALID_DAYS.map((d) => <button key={d} role="tab" aria-selected={days === d} className={days === d ? "on" : ""} onClick={() => setDays(d)}>{d === 1 ? t.lmD1 : d === 7 ? t.lmD7 : t.lmD30}</button>)}
        </div>
      </div>
      {buyAmount != null && get && <div className="note">{fill(t.lmGetAtLeast, { a: formatUnitsStr(buyAmount, get.decimals), s: get.symbol })}{split && split.fee > 0n && pay ? <><br />{fill(t.lmFeeLine, { p: String(feeBps() / 100), a: formatUnitsStr(split.fee, pay.decimals), s: pay.symbol })}</> : null}</div>}
      {short && <div className="note warn">{t.lmErrBalance}</div>}
      {now && <div className="note warn">{t.lmNow}</div>}
      {msg && <div className={"note" + (msg.kind === "warn" ? " warn" : "")}>{msg.text}</div>}
      <button className="btn primary block" disabled={!buyAmount || short || !!busy} onClick={() => void submit()}>
        {busy === "approve" ? fill(t.lmApproving, { c: pay?.symbol ?? "" }) : busy === "sign" ? t.lmSigning : side === "buy" ? fill(t.lmPlaceBuy, { c: coin }) : fill(t.lmPlaceSell, { c: coin })}
      </button>
      <div className="faint" style={{ fontSize: 11.5 }}>{t.lmTerms}</div>
      {orders.length > 0 && (
        <div className="stack" style={{ gap: 6 }}>
          <b>{t.lmMine}</b>
          {orders.map((o) => {
            const n = activeNetworks(settings).find((x) => x.id === o.netId);
            const dec = (tok: string) => (tok.toLowerCase() === EVM_NATIVE.toLowerCase() ? 18 : n?.tokens.find((x) => x.address.toLowerCase() === tok.toLowerCase())?.decimals ?? 18);
            const paid = formatUnitsStr(BigInt(o.sellAmount), dec(o.sellToken)), got = formatUnitsStr(BigInt(o.buyAmount), dec(o.buyToken));
            return (
              <div key={o.uid} className="rowi" style={{ alignItems: "center" }}>
                <span className="grow">
                  <span className="t1" style={{ display: "block" }}>{o.side === "buy" ? fill(t.lmRowBuy, { c: o.coin, a: got }) : fill(t.lmRowSell, { c: o.coin, a: paid })}</span>
                  <span className="t2" style={{ display: "block" }}>{o.side === "buy" ? `${paid} ${o.dollar}` : `${got} ${o.dollar}`} · {n?.name ?? o.netId} · {STATE[o.state ?? "unknown"]}</span>
                </span>
                {o.state === "open" && <button className="linkbtn" onClick={() => void cancel(o)}>{t.lmCancel}</button>}
                {o.state && o.state !== "open" && o.state !== "unknown" && <button className="linkbtn" onClick={() => void dropOrder(o.uid).then(refresh)}>{t.lmHide}</button>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
