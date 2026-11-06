import { useState } from "react";

const LOGO_FILES = import.meta.glob("./logos/*.{svg,jpg,png,webp}", { eager: true, query: "?url", import: "default" }) as Record<string, string>;
const logo = (name: string) => LOGO_FILES[`./logos/${name}.svg`] ?? LOGO_FILES[`./logos/${name}.jpg`] ?? LOGO_FILES[`./logos/${name}.png`] ?? LOGO_FILES[`./logos/${name}.webp`];
const TOKEN_ALIAS: Record<string, string> = { "USDC.e": "USDC", WETH: "ETH", "WETH.e": "ETH", "DAI.e": "DAI", "LINK.e": "LINK", BTCB: "BTC", "BTC.b": "BTC" };
const Logo = ({ src, size }: { src: string; size: number }) => <img src={src} width={size} height={size} alt="" aria-hidden="true" draggable={false} style={{ borderRadius: "50%", flex: "none", display: "block" }} />;

const COLORS: Record<string, string> = {
  USDC: "#2775CA", USDT: "#26A17B", DAI: "#F5AC37", "DAI.e": "#F5AC37", ETH: "#627EEA", WETH: "#627EEA", "WETH.e": "#627EEA", POL: "#8247E5", BNB: "#F3BA2F",
  WBTC: "#F7931A", cbBTC: "#0052FF", BTCB: "#F7931A", "BTC.b": "#F7931A", LINK: "#2A5ADA", "LINK.e": "#2A5ADA", UNI: "#FF007A", AAVE: "#B6509E",
  CAKE: "#D1884F", ARB: "#28A0F0", OP: "#FF0420", AVAX: "#E84142", BTC: "#F7931A", SOL: "#9945FF", JUP: "#2A9D8F", RAY: "#5AC4BE", PYTH: "#7142CF", JTO: "#1C1C1C", TRX: "#EB0029",
};
const GLYPH: Record<string, string> = { BTC: "₿", SOL: "◎", JUP: "J", RAY: "R", PYTH: "P", JTO: "J", USDT: "₮", DAI: "◈", "DAI.e": "◈", WBTC: "₿", cbBTC: "₿", BTCB: "₿", "BTC.b": "₿", LINK: "⬡", UNI: "U", AAVE: "A", CAKE: "C", ARB: "A", OP: "OP", AVAX: "A" };
const NET_COLORS: Record<string, string> = { bitcoin: "#F7931A", solana: "#9945FF", base: "#0052FF", ethereum: "#627EEA", polygon: "#8247E5", bsc: "#F3BA2F", arbitrum: "#28A0F0", optimism: "#FF0420", avalanche: "#E84142", tron: "#EB0029" };

const MARKS: Record<string, { bg: string; g: string; ink?: string }> = {
  linea: { bg: "#61DFFF", g: "L", ink: "#121212" }, zksync: { bg: "#1755F4", g: "zk" }, scroll: { bg: "#FF684B", g: "Sc" }, unichain: { bg: "#F50DB4", g: "U" },
  sonic: { bg: "#FE9A4C", g: "S", ink: "#0B1D3A" }, mantle: { bg: "#65B3AE", g: "M", ink: "#0B0B0B" }, gnosis: { bg: "#3E6957", g: "G" }, celo: { bg: "#FCFF52", g: "C", ink: "#000" },
  berachain: { bg: "#8B5A2B", g: "B" }, opbnb: { bg: "#F3BA2F", g: "op", ink: "#181A20" }, blast: { bg: "#FCFC03", g: "BL", ink: "#000" },
};
const TOKEN_MARKS: Record<string, { bg: string; g: string; ink?: string }> = {
  S: MARKS.sonic, MNT: MARKS.mantle, xDAI: { bg: "#3E6957", g: "◈" }, CELO: MARKS.celo, BERA: MARKS.berachain, USDB: { bg: "#FCFC03", g: "$", ink: "#000" },
};
function Letter({ m, size }: { m: { bg: string; g: string; ink?: string }; size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" style={{ flex: "none" }}>
      <circle cx="16" cy="16" r="16" fill={m.bg} />
      <text x="16" y={m.g.length > 1 ? "20.5" : "21.5"} textAnchor="middle" fontSize={m.g.length > 1 ? "12" : "15"} fontWeight="700" fill={m.ink ?? "#fff"} fontFamily="Arial">{m.g}</text>
    </svg>
  );
}

function Diamond() {
  return <path d="M16 5l6.5 11L16 20l-6.5-4zM16 21.5l6.5-4L16 27l-6.5-9.5z" fill="#fff" />;
}

function Tri() {
  return <path d="M8.5 9.5l15.5 3.2-9.2 11.8zM11.4 11.2l3.6 9.5 5.9-7.6z" fill="#fff" fillRule="evenodd" />;
}
function Bnb() {
  return <path d="M16 7l3 3-3 3-3-3zM10 13l3 3-3 3-3-3zM22 13l3 3-3 3-3-3zM16 19l3 3-3 3-3-3zM16 13.5l2.5 2.5-2.5 2.5-2.5-2.5z" fill="#fff" />;
}

export function TokenIcon({ symbol, size = 36, img, known = true }: { symbol: string; size?: number; img?: string | null; known?: boolean }) {
  if (!known) return img ? <Remote src={img} size={size} symbol={symbol} /> : <Plain symbol={symbol} size={size} />;
  const src = logo("tok-" + (TOKEN_ALIAS[symbol] ?? symbol));
  if (src) return <Logo src={src} size={size} />;

  if (img && !Object.prototype.hasOwnProperty.call(TOKEN_MARKS, symbol) && !COLORS[symbol]) return <Remote src={img} size={size} symbol={symbol} />;
  if (Object.prototype.hasOwnProperty.call(TOKEN_MARKS, symbol)) return <Letter m={TOKEN_MARKS[symbol]} size={size} />;
  const c = COLORS[symbol];
  if (!c || GLYPH[symbol]) {
    const g = GLYPH[symbol] ?? (symbol.replace(/[^A-Za-z0-9]/g, "").slice(0, 3).toUpperCase() || "?");
    return (
      <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
        <circle cx="16" cy="16" r="16" fill={c ?? "#5f6b82"} />
        <text x="16" y={g.length > 2 ? "19.5" : "21"} textAnchor="middle" fontSize={g.length > 2 ? "9" : g.length > 1 ? "11" : "15"} fontWeight="700" fill="#fff" fontFamily="Arial">{g}</text>
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="16" fill={c} />
      {symbol === "ETH" || symbol === "WETH" || symbol === "WETH.e" ? <Diamond /> : symbol === "BNB" ? <Bnb /> : symbol === "TRX" ? <Tri /> : symbol === "USDC" ? (
        <>
          <circle cx="16" cy="16" r="9.5" fill="none" stroke="#fff" strokeWidth="1.6" />
          <text x="16" y="20.5" textAnchor="middle" fontSize="13" fontWeight="700" fill="#fff" fontFamily="Arial">$</text>
        </>
      ) : (
        <path d="M11 12.5l5-2.9 5 2.9v5.8l-5 2.9-5-2.9z" fill="none" stroke="#fff" strokeWidth="2" />
      )}
    </svg>
  );
}

function Plain({ symbol, size, c }: { symbol: string; size: number; c?: string }) {
  const g = symbol.replace(/[^A-Za-z0-9]/g, "").slice(0, 3).toUpperCase() || "?";
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" style={{ flex: "none" }}>
      <circle cx="16" cy="16" r="16" fill={c ?? "#5f6b82"} />
      <text x="16" y={g.length > 2 ? "19.5" : "21"} textAnchor="middle" fontSize={g.length > 2 ? "9" : g.length > 1 ? "11" : "15"} fontWeight="700" fill="#fff" fontFamily="Arial">{g}</text>
    </svg>
  );
}
function Remote({ src, size, symbol }: { src: string; size: number; symbol: string }) {
  const [bad, setBad] = useState<string | null>(null);
  if (bad === src) return <Plain symbol={symbol} size={size} />;
  return <img src={src} width={size} height={size} alt="" aria-hidden="true" draggable={false} referrerPolicy="no-referrer" loading="lazy" decoding="async" onError={() => setBad(src)} style={{ borderRadius: "50%", flex: "none", display: "block", objectFit: "cover" }} />;
}

export function NetworkDot({ id, size = 18 }: { id: string; size?: number }) {
  const src = logo("net-" + id);
  if (src) return <Logo src={src} size={size} />;
  if (Object.prototype.hasOwnProperty.call(MARKS, id)) return <Letter m={MARKS[id]} size={size} />;
  const c = NET_COLORS[id] ?? "#8f939c";
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="16" fill={c} />
      {id === "solana" ? <text x="16" y="21.5" textAnchor="middle" fontSize="15" fontWeight="700" fill="#fff" fontFamily="Arial">◎</text> : id === "bitcoin" ? <text x="16" y="22" textAnchor="middle" fontSize="17" fontWeight="700" fill="#fff" fontFamily="Arial">₿</text> : id === "base" ? <rect x="8" y="14" width="16" height="4" rx="2" fill="#fff" /> : id === "ethereum" ? <Diamond /> : id === "bsc" ? <Bnb /> : id === "arbitrum" ? <text x="16" y="21" textAnchor="middle" fontSize="13" fontWeight="700" fill="#fff" fontFamily="Arial">A</text> : id === "optimism" ? <text x="16" y="20.5" textAnchor="middle" fontSize="10" fontWeight="700" fill="#fff" fontFamily="Arial">OP</text> : id === "avalanche" ? <path d="M16 8l8 15h-5l-3-5.5-3 5.5H8z" fill="#fff" /> : id === "tron" ? <Tri /> : (
        <path d="M11 12.5l5-2.9 5 2.9v5.8l-5 2.9-5-2.9z" fill="none" stroke="#fff" strokeWidth="2.4" />
      )}
    </svg>
  );
}

export function Avatar({ address, size = 34 }: { address: string; size?: number }) {
  const h1 = parseInt(address.slice(2, 8), 16) % 360, h2 = (h1 + 40 + (parseInt(address.slice(8, 12), 16) % 140)) % 360;
  const id = "g" + address.slice(2, 10);
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" style={{ borderRadius: "50%", flex: "none" }}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={`hsl(${h1} 80% 55%)`} />
          <stop offset="1" stopColor={`hsl(${h2} 80% 45%)`} />
        </linearGradient>
      </defs>
      <circle cx="16" cy="16" r="16" fill={`url(#${id})`} />
      <circle cx={10 + (parseInt(address.slice(12, 14), 16) % 12)} cy={10 + (parseInt(address.slice(14, 16), 16) % 12)} r="6" fill="rgba(255,255,255,.28)" />
    </svg>
  );
}

export function MadarName({ name, className }: { name: string; className?: string }) {
  const base = name.endsWith(".madar") ? name.slice(0, -".madar".length) : name;
  return <bdi dir="ltr" className={"mname" + (className ? ` ${className}` : "")}><span>{base}</span><span className="tld">.madar</span></bdi>;
}
