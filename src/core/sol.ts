import {
  AccountRole, address, appendTransactionMessageInstructions, createKeyPairSignerFromPrivateKeyBytes, createTransactionMessage, getBase64EncodedWireTransaction,
  getSignatureFromTransaction, pipe, setTransactionMessageFeePayerSigner, setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners, type Address, type Instruction,
} from "@solana/kit";
import { getTransferSolInstruction } from "@solana-program/system";
import { findAssociatedTokenPda, getCloseAccountInstruction, getCreateAssociatedTokenIdempotentInstruction, getTransferCheckedInstruction, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import type { Token } from "./chains";
import { accountInfo, ataRent, destProblem, isOnCurve, isSolAddress, minAccount, parseUnitsStr, rpc, SIGNATURE_FEE, SOL, solAddress, solBalances, solSecret, WSOL_MINT } from "./solbase";
export * from "./solbase";
import { buildSwiftIxs, checkMayanQuote, swiftRandomKey, type MayanQuote, type MayanRequest } from "./mayan";
const secretFor = solSecret;

export interface SolQuote {
  kind: "sol" | "token";
  to: string;
  amount: bigint;
  token?: Token;
  createsAccount: boolean;
  feeLamports: bigint;
}

export async function quoteSolSend(phrase: string, index: number, to: string, amountStr: string, token?: Token): Promise<SolQuote> {
  const dest = to.trim();
  if (!isSolAddress(dest)) throw new Error("ERR_ADDRESS");
  const from = solAddress(phrase, index);
  if (dest === from) throw new Error("ERR_SELF");
  const amount = parseUnitsStr(amountStr, token ? token.decimals : SOL.decimals);
  if (amount <= 0n) throw new Error("ERR_ZERO");
  const [destInfo, bal] = await Promise.all([accountInfo(dest), solBalances(from, token ? [token.address] : [])]);
  const problem = destProblem(destInfo);
  if (problem) throw new Error(problem);
  if (!token) {
    const min = await minAccount();
    if (!destInfo && amount < min) throw new Error("ERR_SOL_MIN");
    const rest = bal.lamports - amount - SIGNATURE_FEE;
    if (rest < 0n) throw new Error("ERR_FUNDS");
    if (rest > 0n && rest < min) throw new Error("ERR_SOL_REST");
    return { kind: "sol", to: dest, amount, createsAccount: false, feeLamports: SIGNATURE_FEE };
  }

  if (!isOnCurve(dest)) throw new Error("ERR_OFF_CURVE");
  const have = bal.tokens.get(token.address) ?? 0n;
  if (have < amount) throw new Error("ERR_FUNDS");
  const [dstAta] = await findAssociatedTokenPda({ owner: address(dest), mint: address(token.address), tokenProgram: TOKEN_PROGRAM_ADDRESS });
  const createsAccount = !(await accountInfo(dstAta));
  const feeLamports = SIGNATURE_FEE + (createsAccount ? await ataRent() : 0n);
  if (bal.lamports < feeLamports) throw new Error("ERR_GAS");
  return { kind: "token", to: dest, amount, token, createsAccount, feeLamports };
}

export async function sendSol(phrase: string, index: number, q: SolQuote): Promise<string> {
  const signer = await createKeyPairSignerFromPrivateKeyBytes(secretFor(phrase, index));
  const ixs: Instruction[] = [];
  if (q.kind === "sol") {
    ixs.push(getTransferSolInstruction({ source: signer, destination: address(q.to), amount: q.amount }));
  } else {
    const mint = address(q.token!.address) as Address;
    const [srcAta] = await findAssociatedTokenPda({ owner: signer.address, mint, tokenProgram: TOKEN_PROGRAM_ADDRESS });
    const [dstAta] = await findAssociatedTokenPda({ owner: address(q.to), mint, tokenProgram: TOKEN_PROGRAM_ADDRESS });
    if (q.createsAccount) ixs.push(getCreateAssociatedTokenIdempotentInstruction({ payer: signer, ata: dstAta, owner: address(q.to), mint }));
    ixs.push(getTransferCheckedInstruction({ source: srcAta, mint, destination: dstAta, authority: signer, amount: q.amount, decimals: q.token!.decimals }));
  }
  const { value: bh } = await rpc<{ value: { blockhash: string; lastValidBlockHeight: number } }>("getLatestBlockhash", [{ commitment: "confirmed" }]);
  const msg = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(signer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: bh.blockhash as never, lastValidBlockHeight: BigInt(bh.lastValidBlockHeight) }, m),
    (m) => appendTransactionMessageInstructions(ixs, m),
  );
  const tx = await signTransactionMessageWithSigners(msg);
  const wire = getBase64EncodedWireTransaction(tx);
  await rpc<string>("sendTransaction", [wire, { encoding: "base64", preflightCommitment: "confirmed", maxRetries: 3 }]);
  return getSignatureFromTransaction(tx);
}

export async function solSpendable(phrase: string, index: number, token?: { address: string }, reserve = 0n): Promise<bigint> {
  const b = await solBalances(solAddress(phrase, index), token ? [token.address] : []);
  if (token) return b.tokens.get(token.address) ?? 0n;
  const left = b.lamports - SIGNATURE_FEE - reserve;
  return left > 0n ? left : 0n;
}

export async function hasTokenAccount(phrase: string, index: number, mint: string): Promise<boolean> {
  const [ata] = await findAssociatedTokenPda({ owner: address(solAddress(phrase, index)), mint: address(mint), tokenProgram: TOKEN_PROGRAM_ADDRESS });
  return (await accountInfo(ata)) != null;
}

export async function unwrapWsol(phrase: string, index: number): Promise<string> {
  const signer = await createKeyPairSignerFromPrivateKeyBytes(secretFor(phrase, index));
  const mint = address(WSOL_MINT);
  const [ata] = await findAssociatedTokenPda({ owner: signer.address, mint, tokenProgram: TOKEN_PROGRAM_ADDRESS });
  const bal = await solBalances(signer.address);
  if (bal.lamports < SIGNATURE_FEE) throw new Error("ERR_GAS");
  return signAndSend(signer, [
    getCloseAccountInstruction({ account: ata, destination: signer.address, owner: signer }),
    getCreateAssociatedTokenIdempotentInstruction({ payer: signer, ata, owner: signer.address, mint }),
  ]);
}

async function signAndSend(signer: Awaited<ReturnType<typeof createKeyPairSignerFromPrivateKeyBytes>>, ixs: Instruction[]): Promise<string> {
  const { value: bh } = await rpc<{ value: { blockhash: string; lastValidBlockHeight: number } }>("getLatestBlockhash", [{ commitment: "confirmed" }]);
  const msg = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(signer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: bh.blockhash as never, lastValidBlockHeight: BigInt(bh.lastValidBlockHeight) }, m),
    (m) => appendTransactionMessageInstructions(ixs, m),
  );
  const tx = await signTransactionMessageWithSigners(msg);
  await rpc<string>("sendTransaction", [getBase64EncodedWireTransaction(tx), { encoding: "base64", preflightCommitment: "confirmed", maxRetries: 3 }]);
  return getSignatureFromTransaction(tx);
}

export async function openTokenAccount(phrase: string, index: number, mint: string): Promise<string> {
  const signer = await createKeyPairSignerFromPrivateKeyBytes(secretFor(phrase, index));
  const [bal, rent] = await Promise.all([solBalances(signer.address), ataRent()]);
  if (bal.lamports < rent + SIGNATURE_FEE) throw new Error("ERR_GAS");
  const [ata] = await findAssociatedTokenPda({ owner: signer.address, mint: address(mint), tokenProgram: TOKEN_PROGRAM_ADDRESS });
  return signAndSend(signer, [getCreateAssociatedTokenIdempotentInstruction({ payer: signer, ata, owner: signer.address, mint: address(mint) })]);
}

export const MAYAN_SOL_NEEDED = 3_500_000n;
export async function sendMayanSwift(phrase: string, index: number, q: MayanQuote, r: MayanRequest): Promise<string> {
  const signer = await createKeyPairSignerFromPrivateKeyBytes(secretFor(phrase, index));
  if (signer.address !== r.trader) throw new Error("ERR_UNSAFE");
  checkMayanQuote(q, r);
  const { lamports } = await solBalances(r.trader);
  if (lamports < MAYAN_SOL_NEEDED) throw new Error("ERR_SOL_GAS");
  const { ixs } = buildSwiftIxs(q, r, swiftRandomKey(q));
  const kitIxs: Instruction[] = ixs.map((ix) => ({
    programAddress: address(ix.program),
    accounts: ix.keys.map(([a, isSigner, w]) => isSigner
      ? { address: signer.address, role: w ? AccountRole.WRITABLE_SIGNER : AccountRole.READONLY_SIGNER, signer }
      : { address: address(a), role: w ? AccountRole.WRITABLE : AccountRole.READONLY }),
    data: ix.data,
  }));
  const { value: bh } = await rpc<{ value: { blockhash: string; lastValidBlockHeight: number } }>("getLatestBlockhash", [{ commitment: "confirmed" }]);
  const msg = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(signer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: bh.blockhash as never, lastValidBlockHeight: BigInt(bh.lastValidBlockHeight) }, m),
    (m) => appendTransactionMessageInstructions(kitIxs, m),
  );
  const tx = await signTransactionMessageWithSigners(msg);
  await rpc<string>("sendTransaction", [getBase64EncodedWireTransaction(tx), { encoding: "base64", preflightCommitment: "confirmed", maxRetries: 3 }]);
  return getSignatureFromTransaction(tx);
}
