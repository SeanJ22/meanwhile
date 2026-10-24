import { createHash } from "node:crypto";
import type { RetainedSourceResponse } from "../../lib/civic-data/retained-meeting-bytes.ts";
import type { SourceAcquisitionEvidence } from "../../lib/sources/acquisition-trace.ts";

const replayedResponses = new WeakSet<Response>();
/** Counters exclude the saved response itself, including when its consumer reads only part of it. */
export function isRetainedSourceReplayResponse(response: Response): boolean { return replayedResponses.has(response); }

export function validateRetainedSourceResponse(initial: RetainedSourceResponse): void {
  if (initial.byteCount !== initial.bytes.byteLength || createHash("sha256").update(initial.bytes).digest("hex") !== initial.rawHash ||
    !Number.isFinite(Date.parse(initial.retrievedAt)) || initial.httpStatus < 200 || initial.httpStatus >= 300 ||
    ![initial.requestedUrl, initial.finalUrl].every(value => {
      try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password; } catch { return false; }
    })) throw new Error("INGEST_INITIAL_RESPONSE_INVALID");
}

export function replayedObservationAt(initial: RetainedSourceResponse | undefined, evidence: readonly SourceAcquisitionEvidence[], fallback: string): string {
  return initial && evidence.some(row => row.requestedUrl === initial.requestedUrl && row.finalUrl === initial.finalUrl && row.rawHash === initial.rawHash)
    ? initial.retrievedAt : fallback;
}

export function restoreRetainedResponse(initial: RetainedSourceResponse | undefined, response: RetainedSourceResponse): RetainedSourceResponse {
  return initial && response.requestedUrl === initial.requestedUrl && response.finalUrl === initial.finalUrl && response.rawHash === initial.rawHash
    ? { ...initial, source: response.source } : response;
}

/** A source child owns fetch for its pass. Reuse one exact GET, then let its usual transport acquire all other evidence. */
export async function withRetainedSourceResponse<T>(initial: RetainedSourceResponse | undefined, operation: () => Promise<T>): Promise<{ value: T; reused: boolean }> {
  if (initial) validateRetainedSourceResponse(initial);
  const original = globalThis.fetch;
  let reused = false;
  if (initial) globalThis.fetch = (async (input, init) => {
    const requested = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    if (!reused && method.toUpperCase() === "GET" && requested === initial.requestedUrl) {
      reused = true;
      const response = new Response(new Uint8Array(initial.bytes), { status: initial.httpStatus, headers: { "content-type": initial.contentType } });
      Object.defineProperty(response, "url", { value: initial.finalUrl });
      replayedResponses.add(response);
      return response;
    }
    return original(input, init);
  }) as typeof fetch;
  try { return { value: await operation(), reused }; }
  finally { globalThis.fetch = original; }
}
