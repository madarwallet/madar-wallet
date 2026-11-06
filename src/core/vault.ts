import { scryptAsync } from "@noble/hashes/scrypt.js";

export interface Vault {
  v: 1;
  kdf: { name: "scrypt"; N: number; r: number; p: number; salt: string };
  iv: string;
  ct: string;
}

export const KDF_PARAMS = { N: 2 ** 16, r: 8, p: 1 };
export const MIN_PASSWORD_LENGTH = 8;

const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function deriveKey(password: string, salt: Uint8Array, p: { N: number; r: number; p: number }): Promise<CryptoKey> {
  const raw = await scryptAsync(new TextEncoder().encode(password.normalize("NFKC")), salt, { ...p, dkLen: 32 });
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptPhrase(phrase: string, password: string, params = KDF_PARAMS): Promise<Vault> {
  if (password.length < MIN_PASSWORD_LENGTH) throw new Error("password too short");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, params);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(phrase)));
  return { v: 1, kdf: { name: "scrypt", ...params, salt: b64(salt) }, iv: b64(iv), ct: b64(ct) };
}

export async function decryptPhrase(vault: Vault, password: string): Promise<string> {
  const key = await deriveKey(password, unb64(vault.kdf.salt), vault.kdf);
  try {
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(vault.iv) }, key, unb64(vault.ct));
    return new TextDecoder().decode(pt);
  } catch {
    throw new Error("wrong password");
  }
}
