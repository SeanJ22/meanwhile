import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import type { EvidenceStore } from "../control-plane/evidence/store.ts";
import type { FederalMoneyCapture } from "./model.ts";

const context = new AsyncLocalStorage<EvidenceStore>();
export const FEDERAL_MONEY_CAPTURE_BYTES = 8 * 1024 * 1024;
export function federalMoneyVault(): EvidenceStore {
  const vault = context.getStore();
  if (!vault) throw new Error("Federal evidence requires an acquisition vault context.");
  return vault;
}
export function withFederalMoneyVault<T>(vault: EvidenceStore, work: () => Promise<T>): Promise<T> {
  return context.run(vault, work);
}
export async function saveFederalMoneyCapture(input: {
  url: string; body: string; retrievedAt: string; publicationDate: string | null;
  format?: "csv" | "json"; archiveId?: string;
}, vault = federalMoneyVault()): Promise<FederalMoneyCapture> {
  const bytes = Buffer.from(input.body);
  if (bytes.length > FEDERAL_MONEY_CAPTURE_BYTES) throw new Error("Federal source evidence chunk exceeds the bounded capture size.");
  const rawHash = createHash("sha256").update(bytes).digest("hex");
  const vaultKey = `project/meanwhile/source/federal-money/${rawHash}`;
  const format = input.format ?? (/^[\s\uFEFF]*[\[{]/.test(input.body) ? "json" : "csv");
  await vault.put(vaultKey, bytes, { contentType: format === "json" ? "application/json" : "text/csv",
    contentHash: `sha256-${rawHash}`, byteLength: bytes.length });
  return { url: input.url, rawHash, vaultKey, byteLength: bytes.length, format,
    retrievedAt: input.retrievedAt, publicationDate: input.publicationDate,
    ...(input.archiveId ? { archiveId: input.archiveId } : {}) };
}
export async function readFederalMoneyCapture(capture: FederalMoneyCapture, vault = federalMoneyVault()): Promise<string> {
  if (!Number.isInteger(capture.byteLength) || capture.byteLength < 0 || capture.byteLength > FEDERAL_MONEY_CAPTURE_BYTES ||
      !/^[a-f0-9]{64}$/.test(capture.rawHash) || capture.vaultKey !== `project/meanwhile/source/federal-money/${capture.rawHash}`)
    throw new Error("Federal source evidence reference is invalid.");
  const stored = await vault.get(capture.vaultKey);
  if (!stored || stored.bytes.length !== capture.byteLength || createHash("sha256").update(stored.bytes).digest("hex") !== capture.rawHash)
    throw new Error("Federal source evidence is missing or differs from its content hash.");
  return Buffer.from(stored.bytes).toString("utf8");
}
