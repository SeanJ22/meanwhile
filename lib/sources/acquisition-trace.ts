import { createHash } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";

export interface SourceAcquisitionEvidence {
  readonly source: string;
  readonly requestedUrl: string;
  readonly finalUrl: string;
  readonly httpStatus: number;
  readonly rawHash: string;
  readonly byteCount: number;
}

type RunForSource = <T>(source: string, operation: () => Promise<T>) => Promise<T>;

const sourceContext = new AsyncLocalStorage<{ source: string; evidence: SourceAcquisitionEvidence[] }>();

/** Record the exact acquired bytes while the calling child source is in scope. */
export function recordAcquiredResponse(input: {
  readonly requestedUrl: string;
  readonly finalUrl: string;
  readonly httpStatus: number;
} & ({ readonly bytes: Uint8Array } | { readonly rawHash: string; readonly byteCount: number })): void {
  const context = sourceContext.getStore();
  if (!context) return;
  const evidence: SourceAcquisitionEvidence = {
    source: context.source,
    requestedUrl: input.requestedUrl,
    finalUrl: input.finalUrl,
    httpStatus: input.httpStatus,
    rawHash: "bytes" in input ? createHash("sha256").update(input.bytes).digest("hex") : input.rawHash,
    byteCount: "bytes" in input ? input.bytes.byteLength : input.byteCount,
  };
  if (!context.evidence.some((row) =>
    row.source === evidence.source &&
    row.requestedUrl === evidence.requestedUrl &&
    row.finalUrl === evidence.finalUrl &&
    row.rawHash === evidence.rawHash
  )) context.evidence.push(evidence);
}

export async function captureSourceAcquisitions<T>(
  operation: (runForSource: RunForSource) => Promise<T>,
): Promise<{ readonly value: T; readonly evidence: readonly SourceAcquisitionEvidence[] }> {
  const evidence: SourceAcquisitionEvidence[] = [];
  const runForSource: RunForSource = (source, child) => sourceContext.run({ source, evidence }, child);
  const value = await operation(runForSource);
  return { value, evidence };
}
