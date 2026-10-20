import { createHash } from "node:crypto";
import { mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EvidenceStore } from "../control-plane/evidence/store.ts";
import type { LockManager } from "../control-plane/repository/types.ts";
import { holdRawCaptureFile, restoreRawCaptureFile, type RawCaptureRef } from "../civic-data/raw-capture-vault.ts";
import { readPublisherBody, requestPublisher, sourceAcquisitionFailure } from "../civic-data/source-acquisition-error.ts";
import { checkKnownSourceRetry, recordKnownSourceRetry, resolveKnownReleaseCache, withKnownReleaseLock } from "../sources/known-release.ts";

const SOURCE = "congress-directory-project";
const MAX_BYTES = 16 * 1024 * 1024;
export interface CongressSourceFile {
  readonly path: string;
  readonly requestedUrl: string;
  readonly finalUrl: string;
  readonly httpStatus: number;
  readonly retrievedAt: string;
  readonly raw: RawCaptureRef;
  dispose(): Promise<void>;
}
type SavedFile = Omit<CongressSourceFile, "path" | "dispose">;

/** Commit-pinned files are immutable. Every state reuses the shared capture and streams it into its own temporary file. */
export async function acquireCongressSourceFile(input: {
  readonly url: string; readonly vault: EvidenceStore; readonly signal: AbortSignal;
  readonly fetchImpl?: typeof fetch;
  readonly locks?: LockManager;
}): Promise<CongressSourceFile> {
  if (!/^https:\/\/raw\.githubusercontent\.com\/unitedstates\/congress-legislators\/[a-f0-9]{40}\/[a-z-]+\.yaml$/.test(input.url)) throw new Error("CONGRESS_SOURCE_NOT_COMMIT_PINNED");
  const directory = await mkdtemp(join(tmpdir(), "meanwhile-congress-source-"));
  const path = join(directory, "source.yaml");
  const dispose = () => rm(directory, { recursive: true, force: true });
  const key = `project/freshness/source/${SOURCE}/files/${createHash("sha256").update(input.url).digest("hex")}/manifest.json`;
  try {
    const { locks } = await resolveKnownReleaseCache({ store: input.vault, locks: input.locks });
    const saved = await withKnownReleaseLock(locks, `congress-file:${key}`, input.signal, async (): Promise<SavedFile> => {
      const object = await input.vault.get(key);
      if (object) {
        const held = JSON.parse(new TextDecoder().decode(object.bytes)) as SavedFile;
        if (held.requestedUrl !== input.url || held.finalUrl !== input.url || held.httpStatus !== 200 || !held.raw?.chunked || !Number.isFinite(Date.parse(held.retrievedAt))) throw new Error("CONGRESS_SOURCE_INDEX_INVALID");
        await restoreRawCaptureFile(input.vault, held.raw, path);
        return held;
      }
      const at = new Date().toISOString();
      await checkKnownSourceRetry(input.vault, SOURCE, input.url, at);
      const response = await requestPublisher("Congress directory", () => (input.fetchImpl ?? fetch)(input.url, {
        signal: input.signal, headers: { accept: "text/plain", "user-agent": "Meanwhile civic-data collector" }, redirect: "follow" }));
      if (response.status !== 200 || response.url && response.url !== input.url) {
        await response.body?.cancel().catch(() => {});
        await recordKnownSourceRetry(input.vault, SOURCE, input.url, response, at);
        throw sourceAcquisitionFailure("PUBLISHER_RESPONSE_REFUSED", `Congress directory returned HTTP ${response.status} or left its pinned source`);
      }
      const reader = response.body?.getReader();
      if (!reader) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "Congress directory returned an empty response");
      const length = response.headers.get("content-length"), encoded = response.headers.get("content-encoding");
      const declared = length && /^\d+$/.test(length) ? Number(length) : null;
      if (declared !== null && (!Number.isSafeInteger(declared) || declared > MAX_BYTES)) {
        await reader.cancel().catch(() => {}); reader.releaseLock();
        throw sourceAcquisitionFailure("PUBLISHER_RESPONSE_REFUSED", "Congress source declared byte bound exceeded");
      }
      const file = await open(path, "w"); let total = 0;
      try {
        for (;;) {
          input.signal.throwIfAborted();
          const part = await readPublisherBody("Congress directory", () => reader.read());
          if (part.done) break;
          total += part.value.byteLength;
          if (total > MAX_BYTES) throw sourceAcquisitionFailure("PUBLISHER_RESPONSE_REFUSED", "Congress source byte bound exceeded");
          let offset = 0;
          while (offset < part.value.byteLength) {
            const written = await file.write(part.value, offset, part.value.byteLength - offset);
            if (!written.bytesWritten) throw new Error("CONGRESS_SOURCE_FILE_WRITE_FAILED");
            offset += written.bytesWritten;
          }
        }
      } finally { await file.close(); await reader.cancel().catch(() => {}); reader.releaseLock(); }
      if (!total) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "Congress directory returned an empty source");
      if ((!encoded || encoded === "identity") && declared !== null && declared !== total)
        throw sourceAcquisitionFailure("PUBLISHER_RESPONSE_REFUSED", "Congress source content length mismatch");
      const raw = await holdRawCaptureFile(input.vault, SOURCE, path, "text/plain");
      const held: SavedFile = { requestedUrl: input.url, finalUrl: input.url, httpStatus: 200, retrievedAt: at, raw };
      const bytes = new TextEncoder().encode(JSON.stringify(held)), digest = createHash("sha256").update(bytes).digest("hex");
      await input.vault.put(key, bytes, { contentType: "application/json", contentHash: `sha256-${digest}`, byteLength: bytes.byteLength, objectClass: "IMMUTABLE_BODY" });
      return held;
    });
    return { ...saved, path, dispose };
  } catch (error) { await dispose(); throw error; }
}
