import { generateMnemonic, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { mnemonicToAccount, privateKeyToAccount } from "viem/accounts";
import { importedKey, isImportedIndex } from "./imported";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

export const newPhrase = () => generateMnemonic(wordlist, 128);

export const normalizePhrase = (s: string) => s.trim().toLowerCase().split(/\s+/).join(" ");

export const isValidPhrase = (s: string) => validateMnemonic(normalizePhrase(s), wordlist);

export function evmAccount(phrase: string, index = 0) {
  if (isImportedIndex(index)) {
    const k = importedKey(index);
    if (!k) throw new Error("ERR_LOCKED");
    return privateKeyToAccount(k);
  }
  return mnemonicToAccount(normalizePhrase(phrase), { addressIndex: index });
}

const ADDR = new Map<string, string>();
const phraseTag = (phrase: string) => bytesToHex(sha256(new TextEncoder().encode(normalizePhrase(phrase))));
export function memoAddress(kind: string, phrase: string, index: number, derive: () => string): string {

  if (kind !== "evm" && isImportedIndex(index)) return "";

  if (isImportedIndex(index)) return derive();
  const k = `${kind}|${index}|${phraseTag(phrase)}`;
  let a = ADDR.get(k);
  if (a === undefined) { a = derive(); if (ADDR.size >= 64) ADDR.clear(); ADDR.set(k, a); }
  return a;
}

export function forgetAddresses(): void {
  ADDR.clear();
}

export const evmAddress = (phrase: string, index = 0): `0x${string}` => memoAddress("evm", phrase, index, () => evmAccount(phrase, index).address) as `0x${string}`;
