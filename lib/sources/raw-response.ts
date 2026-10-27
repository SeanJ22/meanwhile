import { holdRawCapture, type RawCaptureRef } from "../civic-data/raw-capture-vault.ts";
import type { EvidenceStore } from "../control-plane/evidence/store.ts";

const captures = new WeakMap<Response, Promise<RawCaptureRef>>();

export class RawCaptureFailure extends Error {
  constructor(cause: unknown) { super("RAW_CAPTURE_SAVE_FAILED", { cause }); this.name = "RawCaptureFailure"; }
}

/** Save the exact response as its consumer reads it. A cancelled or truncated body is never a capture. */
export function vaultSourceResponse(response: Response, vault: EvidenceStore, sourceId: string): Response {
  if (!response.ok || !response.body || captures.has(response)) return response;
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let length = 0;
  let resolve!: (capture: RawCaptureRef) => void, reject!: (error: unknown) => void;
  const captured = new Promise<RawCaptureRef>((yes, no) => { resolve = yes; reject = no; });
  void captured.catch(() => {});
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await reader.read();
        if (!chunk.done) { chunks.push(chunk.value); length += chunk.value.byteLength; controller.enqueue(chunk.value); return; }
        const declared = response.headers.get("content-length");
        if (!response.headers.get("content-encoding") && declared !== null && /^\d+$/.test(declared) && Number(declared) !== length)
          throw new Error("SOURCE_RESPONSE_INCOMPLETE:content length mismatch");
        const bytes = new Uint8Array(length); let offset = 0;
        for (const part of chunks) { bytes.set(part, offset); offset += part.byteLength; }
        chunks.length = 0;
        let capture: RawCaptureRef;
        try { capture = await holdRawCapture(vault, sourceId, bytes, response.headers.get("content-type") ?? "application/octet-stream"); }
        catch (error) { throw new RawCaptureFailure(error); }
        resolve(capture);
        controller.close(); reader.releaseLock();
      } catch (error) { chunks.length = 0; reject(error); controller.error(error); await reader.cancel().catch(() => {}); }
    },
    async cancel(reason) { chunks.length = 0; reject(reason ?? new Error("SOURCE_RESPONSE_INCOMPLETE:cancelled")); await reader.cancel(reason); },
  });
  const held = new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
  for (const key of ["url", "redirected", "type"] as const) Object.defineProperty(held, key, { value: response[key] });
  captures.set(held, captured);
  return held;
}

export function rawResponseCapture(response: Response): Promise<RawCaptureRef> | null {
  return captures.get(response) ?? null;
}
