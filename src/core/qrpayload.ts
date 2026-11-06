import { cosmosById, isCosmosAddress } from "./cosmosbase";
import { isDotAddress } from "./dotbase";
export type ScanFamily = "evm" | "btc" | "sol" | "tron" | "doge" | "ltc" | "xrp" | "ton" | "ada" | "near" | "sui" | "aptos" | "atom" | "osmo" | "tia" | "dot";
export interface ScanResult {
  to: string;

  amount?: string;

  raw?: string;
  scheme?: string;

  token?: string;

  chainId?: number;

  memo?: string;
}

export interface ScanRefused { refused: "reference" | "function" | "amount" | "req" }
export const isRefused = (r: ScanResult | ScanRefused | null): r is ScanRefused => !!r && "refused" in r;

const MAX = 2048;
const DEC = /^\d{1,20}(\.\d{1,18})?$/;
const SOL_ADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const HIDDEN = /[\u0000-\u001f\u007f؜​-‏‪-‮⁠-⁩﻿]/;

export function eip681Int(v: string): bigint | null {
  const m = /^(\d{1,78})(?:\.(\d{1,78}))?(?:[eE]\+?(\d{1,2}))?$/.exec(v);
  if (!m) return null;
  const exp = Number(m[3] ?? 0), frac = (m[2] ?? "").replace(/0+$/, "");
  if (frac.length > exp) return null;
  const n = BigInt(m[1] + frac + "0".repeat(exp - frac.length));
  return n < 2n ** 256n ? n : null;
}

export function parseScan(raw: unknown, family: ScanFamily): ScanResult | ScanRefused | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  if (!text || text.length > MAX || HIDDEN.test(text)) return null;
  const m = /^([a-z][a-z0-9+.-]{1,20}):(.*)$/i.exec(text);
  if (!m) return plain(text, family);
  const scheme = m[1].toLowerCase(), rest = m[2];
  const qi = rest.indexOf("?");
  const pathPart = qi < 0 ? rest : rest.slice(0, qi), query = qi < 0 ? "" : rest.slice(qi + 1);
  const q = new URLSearchParams(query);
  const keys = [...q.keys()].map((k) => k.toLowerCase());
  if (keys.length !== new Set(keys).size) return null;
  if ((family === "btc" && scheme === "bitcoin") || (family === "doge" && scheme === "dogecoin") || (family === "ltc" && scheme === "litecoin")) {
    const to = pathPart.replace(/^\/\//, "");
    const p = plain(to, family);
    if (!p) return null;
    if (keys.some((k) => k.startsWith("req-"))) return { refused: "req" };
    const amount = q.get("amount");
    if (amount != null && !DEC.test(amount)) return { refused: "amount" };
    return { to: p.to, scheme, ...(amount ? { amount } : {}) };
  }
  if (family === "sol" && scheme === "solana") {
    const to = pathPart.replace(/^\/\//, "");
    if (!plain(to, family)) return null;
    if (q.has("reference") || q.has("memo")) return { refused: "reference" };
    const amount = q.get("amount"), token = q.get("spl-token");
    if (amount != null && !DEC.test(amount)) return { refused: "amount" };
    if (token != null && !SOL_ADDR.test(token)) return null;
    return { to, scheme, ...(amount ? { amount } : {}), ...(token ? { token } : {}) };
  }

  if (family === "ton" && scheme === "ton") {
    const tm = /^\/\/transfer\/([^/?#]{1,80})$/.exec(pathPart);
    if (!tm || !plain(tm[1], family)) return null;
    if (q.has("bin") || q.has("init")) return { refused: "function" };
    const amount = q.get("amount"), text = q.get("text"), jetton = q.get("jetton");
    if (amount != null && !/^\d{1,20}$/.test(amount)) return { refused: "amount" };
    if (text != null && [...text].length > 120) return { refused: "reference" };
    if (jetton != null && !plain(jetton, family)) return null;
    return { to: tm[1], scheme, ...(amount ? { raw: amount } : {}), ...(text ? { memo: text } : {}), ...(jetton ? { token: jetton } : {}) };
  }
  if (family === "ada" && scheme === "web+cardano") {
    const p = plain(pathPart.replace(/^\/\//, ""), family);
    if (!p) return null;
    if (keys.some((k) => k !== "amount")) return { refused: "req" };
    const amount = q.get("amount");
    if (amount != null && !/^\d{1,11}(\.\d{1,6})?$/.test(amount)) return { refused: "amount" };
    return { to: p.to, scheme, ...(amount ? { amount } : {}) };
  }
  if (family === "evm" && scheme === "ethereum") {
    const pm = /^(?:pay-)?(0x[0-9a-fA-F]{40})(?:@(\d{1,12}))?(?:\/([A-Za-z0-9_]{1,40}))?$/.exec(pathPart);
    if (!pm) return null;
    const target = pm[1], chainId = pm[2] ? Number(pm[2]) : undefined, fn = pm[3];
    if (chainId !== undefined && chainId <= 0) return null;
    const chain = chainId !== undefined ? { chainId } : {};
    if (!fn) {
      const v = q.get("value");
      const n = v == null ? null : eip681Int(v);
      if (v != null && n == null) return { refused: "amount" };
      return { to: target, scheme, ...chain, ...(n != null && n > 0n ? { raw: n.toString() } : {}) };
    }
    if (fn !== "transfer") return { refused: "function" };
    const to = q.get("address") ?? "";
    if (!/^0x[0-9a-fA-F]{40}$/.test(to)) return null;
    const u = q.get("uint256");
    const n = u == null ? null : eip681Int(u);
    if (u != null && n == null) return { refused: "amount" };
    const v = q.get("value");
    if (v != null && eip681Int(v) !== 0n) return { refused: "function" };
    return { to, scheme, token: target, ...chain, ...(n != null && n > 0n ? { raw: n.toString() } : {}) };
  }
  return null;
}

function plain(a: string, family: ScanFamily): ScanResult | null {
  const s = a.trim();
  if (family === "evm" && /^0x[0-9a-fA-F]{40}$/.test(s)) return { to: s };
  if (family === "evm" && /^[a-z0-9-]{1,63}\.madar$/i.test(s)) return { to: s.toLowerCase() };
  if (family === "btc" && /^(bc1[02-9ac-hj-np-z]{8,87}|BC1[02-9AC-HJ-NP-Z]{8,87}|[13][1-9A-HJ-NP-Za-km-z]{25,34})$/.test(s)) return { to: /^BC1/.test(s) ? s.toLowerCase() : s };
  if (family === "sol" && SOL_ADDR.test(s)) return { to: s };
  if (family === "tron" && /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(s)) return { to: s };
  if (family === "doge" && /^[DA9][1-9A-HJ-NP-Za-km-z]{25,34}$/.test(s)) return { to: s };
  if (family === "ltc" && /^(ltc1[02-9ac-hj-np-z]{8,87}|LTC1[02-9AC-HJ-NP-Z]{8,87}|[LM3][1-9A-HJ-NP-Za-km-z]{25,34})$/.test(s)) return { to: /^LTC1/.test(s) ? s.toLowerCase() : s };
  if (family === "xrp" && /^(r[1-9A-HJ-NP-Za-km-z]{24,34}|X[1-9A-HJ-NP-Za-km-z]{44,50})$/.test(s)) return { to: s };
  if (family === "ada" && /^(addr1[02-9ac-hj-np-z]{50,120}|ADDR1[02-9AC-HJ-NP-Z]{50,120})$/.test(s)) return { to: s.toLowerCase() };
  if (family === "ton" && (/^[EUek]Q[A-Za-z0-9_+/-]{46}$/.test(s) || /^-?[01]:[0-9a-fA-F]{64}$/.test(s))) return { to: s };
  if ((family === "sui" || family === "aptos") && /^0x[0-9a-fA-F]{64}$/.test(s)) return { to: s.toLowerCase() };
  if (family === "dot" && isDotAddress(s)) return { to: s };
  const cos = family === "atom" ? "cosmoshub" : family === "osmo" ? "osmosis" : family === "tia" ? "celestia" : null;
  if (cos && (s === s.toLowerCase() || s === s.toUpperCase()) && isCosmosAddress(cosmosById(cos)!, s.toLowerCase())) return { to: s.toLowerCase() };
  if (family === "near" && /^[0-9a-fA-F]{64}$/.test(s)) return { to: s.toLowerCase() };
  if (family === "near" && s.length >= 2 && s.length <= 64 && !/^0x[0-9a-f]{40}$/.test(s) && /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/.test(s)) return { to: s };
  return null;
}
