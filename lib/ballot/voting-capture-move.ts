import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import type { EvidenceStore } from "../control-plane/evidence/store.ts";
import { holdRawCapture, rawCaptureKey } from "../civic-data/raw-capture-vault.ts";
import type { VotingRawCapture } from "./voting-sites-data-plane.ts";

/** Move an old candidate's captures before its inline bytes are removed. */
export async function moveVotingCaptures(vault: EvidenceStore, captures: readonly unknown[]): Promise<VotingRawCapture[]> {
  return Promise.all(captures.map(async value => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("VOTING_CAPTURE_INVALID");
    const row = value as Record<string, unknown>;
    if (typeof row.url !== "string" || typeof row.contentType !== "string" ||
        typeof row.rawHash !== "string" || !/^[a-f0-9]{64}$/.test(row.rawHash) ||
        !Number.isSafeInteger(row.byteLength) || (row.byteLength as number) < 0) throw new Error("VOTING_CAPTURE_INVALID");
    const { savedDocument, ...metadata } = row;
    if (savedDocument === undefined) {
      if (row.vaultKey !== rawCaptureKey(row.rawHash)) throw new Error("VOTING_CAPTURE_VAULT_MISSING");
      const held = await vault.head(row.vaultKey as string);
      if (!held || held.contentHash !== `sha256-${row.rawHash}` || held.byteLength !== row.byteLength) throw new Error("VOTING_CAPTURE_VAULT_MISSING");
      return metadata as unknown as VotingRawCapture;
    }
    if (!savedDocument || typeof savedDocument !== "object" || Array.isArray(savedDocument) ||
        (savedDocument as Record<string, unknown>).encoding !== "gzip-base64" ||
        typeof (savedDocument as Record<string, unknown>).body !== "string") throw new Error("VOTING_CAPTURE_INVALID");
    const bytes = gunzipSync(Buffer.from((savedDocument as {body: string}).body, "base64"));
    if (bytes.length !== row.byteLength || createHash("sha256").update(bytes).digest("hex") !== row.rawHash)
      throw new Error("VOTING_CAPTURE_FINGERPRINT_MISMATCH");
    const ref = await holdRawCapture(vault, "voting-sites", bytes, row.contentType);
    return { ...metadata, ...ref } as unknown as VotingRawCapture;
  }));
}
