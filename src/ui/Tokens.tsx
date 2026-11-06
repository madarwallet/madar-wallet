import { BadgeCheck, Check, ShieldAlert, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { NETWORKS, networkById, type Network, type Token } from "../core/chains";
import { ataRent, solRent, formatUnitsStr, isSolAddress, readSolMint, hasTokenAccount, openTokenAccount, unwrapWsol, SOL, solAddress, solBalances, WSOL_MINT } from "../core/sol";
import { readTokenInfo } from "../core/chainops";
import { touch, type CustomToken, type Settings } from "../core/store";
import { coinName } from "../core/coins";
import { fill, useT } from "./i18n";
import { TokenIcon } from "./icons";
import type { Update } from "./common";

type TokenSource = {
  id: string; name: string; tokens: readonly Token[]; defaultTokens: readonly string[]; placeholder: string;
  isAddr: (a: string) => boolean; lookup: (a: string) => Promise<{ address: string; symbol: string; name: string; decimals: number }>;
};
export const evmSource = (n: Network): TokenSource => ({ id: n.id, name: n.name, tokens: n.tokens, defaultTokens: n.defaultTokens, placeholder: "0x…", isAddr: (a) => /^0x[0-9a-fA-F]{40}$/.test(a), lookup: (a) => readTokenInfo(n, a) });
export const solSource: TokenSource = { id: SOL.id, name: SOL.name, tokens: SOL.tokens, defaultTokens: SOL.defaultTokens, placeholder: "EPjF…", isAddr: isSolAddress, lookup: readSolMint };

function Tokens({ net, settings, update, say, sol }: { net: TokenSource; settings: Settings; update: Update; say: (m: string) => void; sol?: { phrase: string; index: number } }) {
  const { t } = useT();
  const on = settings.enabledTokens[net.id] ?? net.tokens.filter((x) => net.defaultTokens.includes(x.symbol)).map((x) => x.address.toLowerCase());
  const toggle = (addr: string) => {
    const a = addr.toLowerCase();
    void update({ enabledTokens: { ...settings.enabledTokens, [net.id]: on.includes(a) ? on.filter((x) => x !== a) : [...on, a] } });
  };
  const mine = settings.customTokens.filter((c) => c.networkId === net.id);
  const [addr, setAddr] = useState(""), [found, setFound] = useState<CustomToken | null>(null), [ok, setOk] = useState(false), [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  async function lookup() {
    setErr(""); setFound(null); setOk(false);
    const a = addr.trim();
    const known = net.tokens.find((x) => x.address.toLowerCase() === a.toLowerCase());
    if (known) { if (!on.includes(a.toLowerCase())) toggle(a); setAddr(""); say(t.alreadyVerified); return; }
    if (mine.some((c) => c.address.toLowerCase() === a.toLowerCase())) { setErr(t.alreadyAdded); return; }
    setBusy(true);
    try {
      const info = await net.lookup(a);
      setFound({ networkId: net.id, address: info.address as `0x${string}`, symbol: info.symbol, name: info.name, decimals: info.decimals });
    } catch { setErr(fill(t.notToken, { net: net.name })); }
    setBusy(false);
  }
  return (
    <div className="page">
      <h1>{t.manageTokens}</h1>
      <div className="group"><div className="gt">{fill(t.verifiedTokens, { net: net.name })}</div>
        <div className="list">
          {net.tokens.map((x) => (
            <button key={x.address} className="setrow" onClick={() => toggle(x.address)}>
              <TokenIcon symbol={x.symbol} size={30} />
              <span className="grow"><span className="row" style={{ gap: 6 }}>{coinName(x.symbol, x.name, true)}<BadgeCheck size={14} color="var(--accent-ink)" /></span><span className="faint">{x.symbol}</span></span>
              <span className={"switch" + (on.includes(x.address.toLowerCase()) ? " on" : "")} />
            </button>
          ))}
        </div>
      </div>

      {mine.length > 0 && (
        <div className="group"><div className="gt">{t.myTokens}</div>
          <div className="list">
            {mine.map((c) => (
              <div key={c.address} className="setrow">
                <TokenIcon symbol={c.symbol} size={30} />
                <span className="grow"><span className="row" style={{ gap: 6 }}>{c.name || c.symbol}<span className="badge warn">{t.unverified}</span></span><span className="faint mono">{c.symbol} · {c.address.slice(0, 8)}…{c.address.slice(-6)}</span></span>
                <button className="iconbtn" title={t.remove} onClick={() => update({ customTokens: settings.customTokens.filter((x) => !(x.networkId === net.id && x.address === c.address)) })}><Trash2 size={15} /></button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="group"><div className="gt">{t.addToken}</div>
        <div className="sheet" style={{ marginTop: 0 }}>
          <label className="field">{fill(t.contractAddress, { net: net.name })}
            <input className="input mono" placeholder={net.placeholder} value={addr} onChange={(e) => { setAddr(e.target.value); setFound(null); setErr(""); }} spellCheck={false} />
          </label>
          {!found && <button className="btn ghost block" disabled={busy || !net.isAddr(addr.trim())} onClick={lookup}>{busy ? t.calculating : t.lookup}</button>}
          {err && <div className="err">{err}</div>}
          {found && (
            <>
              <div className="rowi" style={{ padding: 0, border: 0 }}>
                <TokenIcon symbol={found.symbol} size={32} />
                <div className="grow"><div className="t1">{found.name || found.symbol} <span className="badge warn">{t.unverified}</span></div><div className="t2">{found.symbol} · {t.decimalsLabel} {found.decimals}</div></div>
              </div>
              <div className="note warn"><ShieldAlert size={16} />{t.customWarn}</div>
              <label className="check"><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} />{t.understand}</label>
              <button className="btn primary block" disabled={!ok} onClick={() => { void update({ customTokens: [...settings.customTokens, found] }); setFound(null); setAddr(""); setOk(false); say(t.done); }}>{t.add}</button>
            </>
          )}
        </div>
      </div>
      {sol && <WsolAccount key={sol.index} phrase={sol.phrase} index={sol.index} say={say} />}
    </div>
  );
}

function WsolAccount({ phrase, index, say }: { phrase: string; index: number; say: (m: string) => void }) {
  const { t } = useT();
  const [has, setHas] = useState<boolean | null>(null), [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const [held, setHeld] = useState<bigint>(0n), [tick, setTick] = useState(0);
  const [, setRentRead] = useState(0n);
  useEffect(() => {
    void ataRent().then(setRentRead);
    void hasTokenAccount(phrase, index, WSOL_MINT).then(setHas).catch(() => setHas(null));
    void solBalances(solAddress(phrase, index), [WSOL_MINT]).then((b) => setHeld(b.tokens.get(WSOL_MINT) ?? 0n)).catch(() => {});
  }, [phrase, index, tick]);
  async function unwrap() {
    setBusy(true); setErr(""); void touch();
    try {
      await unwrapWsol(phrase, index);
      for (let i = 0; i < 15; i++) { await new Promise((r) => setTimeout(r, 2000)); const b = await solBalances(solAddress(phrase, index), [WSOL_MINT]).catch(() => null); if (b && (b.tokens.get(WSOL_MINT) ?? 0n) === 0n) break; }
      setTick((x) => x + 1); say(t.done);
    } catch (e) { setErr((e as Error).message === "ERR_GAS" ? fill(t.wsolNeed, { amt: formatUnitsStr(solRent.ata + 5000n, 9) }) : t.errNet); }
    setBusy(false);
  }
  async function open() {
    setBusy(true); setErr(""); void touch();
    try {
      await openTokenAccount(phrase, index, WSOL_MINT);
      for (let i = 0; i < 15 && !(await hasTokenAccount(phrase, index, WSOL_MINT).catch(() => false)); i++) await new Promise((r) => setTimeout(r, 2000));
      setHas(await hasTokenAccount(phrase, index, WSOL_MINT));
    } catch (e) { setErr((e as Error).message === "ERR_GAS" ? fill(t.wsolNeed, { amt: formatUnitsStr(solRent.ata + 5000n, 9) }) : t.errNet); }
    setBusy(false);
  }
  return (
    <div className="group"><div className="gt">{t.wsolTitle}</div>
      <div className="sheet stack" style={{ marginTop: 0 }}>
        <div className="faint">{fill(t.wsolHint, { amt: formatUnitsStr(solRent.ata, 9) })}</div>
        {has === true && <div className="note info"><Check size={16} />{t.wsolReady}</div>}
        {has === true && held > 0n && (
          <>
            <div className="kv"><span>{t.wsolHeld}</span><b className="num">{formatUnitsStr(held, 9)} wSOL</b></div>
            <button className="btn primary block" disabled={busy} onClick={unwrap}>{busy ? t.calculating : t.wsolUnwrap}</button>
          </>
        )}
        {has === false && <button className="btn ghost block" disabled={busy} onClick={open}>{busy ? t.calculating : t.wsolOpen}</button>}
        {err && <div className="err">{err}</div>}
      </div>
    </div>
  );
}

export function TokensFor({ netId, settings, update, say, sol }: { netId: string; settings: Settings; update: Update; say: (m: string) => void; sol?: { phrase: string; index: number } }) {
  return <Tokens net={netId === SOL.id ? solSource : evmSource(networkById(netId) ?? NETWORKS[0])} settings={settings} update={update} say={say} sol={sol} />;
}
