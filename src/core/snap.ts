const PREFIX = "snap:";
const INDEX = "snapIndex";
const MAX_ENTRIES = 60;

export interface Snap<T> { at: number; v: T }

export async function readSnap<T>(key: string): Promise<Snap<T> | null> {
  try {
    const r = await chrome.storage.local.get(PREFIX + key);
    const s = r?.[PREFIX + key] as Snap<T> | undefined;
    return s && typeof s.at === "number" && "v" in s ? s : null;
  } catch { return null; }
}

let writing: Promise<void> = Promise.resolve();

export function writeSnap<T>(key: string, v: T, at = Date.now()): Promise<void> {
  writing = writing.then(async () => {
    try {
      const idx = (((await chrome.storage.local.get(INDEX))?.[INDEX]) as Record<string, number> | undefined) ?? {};
      idx[key] = at;
      const keys = Object.keys(idx).sort((a, b) => idx[b] - idx[a]);
      const drop = keys.slice(MAX_ENTRIES);
      for (const k of drop) delete idx[k];
      await chrome.storage.local.set({ [PREFIX + key]: { at, v }, [INDEX]: idx });
      if (drop.length) await chrome.storage.local.remove(drop.map((k) => PREFIX + k));
    } catch {  }
  });
  return writing;
}

export const bigToStr = (b: bigint) => b.toString();
export const strToBig = (s: unknown): bigint => { try { return typeof s === "string" && /^-?\d+$/.test(s) ? BigInt(s) : 0n; } catch { return 0n; } };
