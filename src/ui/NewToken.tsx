import { useEffect, useMemo, useState } from "react";
import { evmAddress } from "../core/account";
import { networkById } from "../core/chains";
import { addPatch, detect, detectNets, ignoreKey, ignoreToken, loadIgnored, offers, type Found } from "../core/detect";
import { formatUnitsStr, SOL, solAddress } from "../core/solbase";
import type { Settings } from "../core/store";
import { fill, useT } from "./i18n";
import { TokenIcon } from "./icons";
import { amt, fillNodes, money, type Update } from "./common";

export function NewTokenCard({ phrase, settings, update, tick, say }: { phrase: string; settings: Settings; update: Update; tick: number; say: (m: string) => void }) {
  const { t } = useT();
  const idx = settings.accountIndex, net = settings.networkId;
  const onKey = (settings.networksOn ?? []).join(",");
  const nets = useMemo(() => { const all = detectNets(settings); return net === "all" ? all : all.includes(net) ? [net] : []; }, [net, onKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const owners = useMemo(() => {
    const evm = evmAddress(phrase, idx), sol = nets.includes(SOL.id) ? solAddress(phrase, idx) : "";
    return Object.fromEntries(nets.map((id) => [id, id === SOL.id ? sol : evm])) as Record<string, string>;
  }, [phrase, idx, nets]);
  const [found, setFound] = useState<Record<string, Found[]>>({});
  const [ignored, setIgnored] = useState<Set<string> | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    void loadIgnored().then((s) => { if (live) setIgnored(s); });
    return () => { live = false; };
  }, []);
  useEffect(() => {
    let live = true;

    for (const id of nets) if (owners[id]) detect(id, owners[id], settings, tick > 0).then((list) => { if (live) setFound((f) => ({ ...f, [id]: list })); }, () => {});
    return () => { live = false; };
  }, [nets, owners, tick, settings.currency]); // eslint-disable-line react-hooks/exhaustive-deps

  const list = useMemo(() => (ignored ? offers(Object.values(found).flat(), settings, ignored, owners) : []), [found, ignored, settings, owners]);
  const f = list[0];
  if (!f) return null;
  const netName = f.networkId === SOL.id ? SOL.name : networkById(f.networkId)?.name ?? f.networkId;
  const amount = formatUnitsStr(BigInt(f.raw), f.decimals);
  const value = f.price != null ? Number(amount) * f.price : null;
  const hide = settings.hideBalances;
  const vars = { sym: f.symbol, amt: hide ? "••••" : `${amt(amount, f.decimals)} ${f.symbol}`, val: hide ? "••••" : money(value, settings.currency), net: netName };
  const add = async () => {
    const p = addPatch(settings, f);
    if (!p) return;
    setBusy(true);
    try { await update(p); say(fill(t.ntAdded, { sym: f.symbol })); } finally { setBusy(false); }
  };
  const skip = () => {
    const k = ignoreKey(f.networkId, owners[f.networkId], f.address);
    setIgnored((s) => new Set([...(s ?? []), k]));
    void ignoreToken(k).catch(() => {});
  };
  return (
    <div className="newtok" role="status" aria-live="polite">
      <TokenIcon symbol={f.symbol} size={36} />
      <div className="grow">
        <div className="nt-title">{fillNodes(t.ntTitle, { sym: vars.sym })}</div>
        <div className="nt-line">{fillNodes(value != null ? t.ntLine : t.ntLineNoPrice, vars)}</div>
        <div className="nt-ask">{f.verified ? t.ntAskVerified : t.ntAskUnverified}</div>
        <div className="nt-btns">
          <button className="btn primary sm" disabled={busy} onClick={() => void add()}>{t.ntAdd}</button>
          <button className="btn ghost sm" disabled={busy} onClick={skip}>{t.ntIgnore}</button>
        </div>
      </div>
    </div>
  );
}
