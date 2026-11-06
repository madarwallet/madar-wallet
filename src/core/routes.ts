export interface RouteOpt<Q> { id: string; name: string; out: bigint; min: bigint; secs: number | null; q: Q }

export function rankRoutes<Q>(list: readonly RouteOpt<Q>[]): RouteOpt<Q>[] {
  return list
    .map((r, i) => ({ r, i }))
    .sort((a, b) => {
      if (a.r.out !== b.r.out) return a.r.out > b.r.out ? -1 : 1;
      const sa = a.r.secs ?? Infinity, sb = b.r.secs ?? Infinity;
      if (sa !== sb) return sa < sb ? -1 : 1;
      return a.i - b.i;
    })
    .map((x) => x.r);
}

export function chooseRoute<Q>(ranked: readonly RouteOpt<Q>[], picked: string | null | undefined): RouteOpt<Q> | null {
  return (picked ? ranked.find((r) => r.id === picked) : undefined) ?? ranked[0] ?? null;
}

export function shortfallBps<Q>(route: RouteOpt<Q>, best: RouteOpt<Q>): number | null {
  if (best.out <= 0n) return null;
  if (route.out >= best.out) return 0;
  return Number(((best.out - route.out) * 10000n) / best.out);
}
