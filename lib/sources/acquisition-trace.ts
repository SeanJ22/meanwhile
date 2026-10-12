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

export interface AcquiredResponse {
  readonly requestedUrl: string;
  readonly finalUrl: string;
  readonly httpStatus: number;
  readonly bytes: Uint8Array;
}

const sourceContext = new AsyncLocalStorage<{ source: string; evidence: SourceAcquisitionEvidence[] }>();
const observers = new AsyncLocalStorage<readonly ((response: AcquiredResponse) => void)[]>();

export function observeAcquiredResponses<T>(observer: (response: AcquiredResponse) => void, operation: () => Promise<T>): Promise<T> {
  return observers.run([...(observers.getStore() ?? []), observer], operation);
}

/** Record the exact acquired bytes while the calling child source is in scope. */
export function recordAcquiredResponse(input: AcquiredResponse): void {
  for (const observer of observers.getStore() ?? []) observer(input);
  const context = sourceContext.getStore();
  if (!context) return;
  const { source, evidence: activeEvidence } = context;
  const evidence: SourceAcquisitionEvidence = {
    source,
    requestedUrl: input.requestedUrl,
    finalUrl: input.finalUrl,
    httpStatus: input.httpStatus,
    rawHash: createHash("sha256").update(input.bytes).digest("hex"),
    byteCount: input.bytes.byteLength,
  };
  if (!activeEvidence.some((row) =>
    row.source === evidence.source &&
    row.requestedUrl === evidence.requestedUrl &&
    row.finalUrl === evidence.finalUrl &&
    row.rawHash === evidence.rawHash
  )) activeEvidence.push(evidence);
}

/** Completed source reads stay attributed to their own batch and child. */
export async function captureSourceAcquisitions<T>(
  operation: (runForSource: RunForSource) => Promise<T>,
): Promise<{ readonly value: T; readonly evidence: readonly SourceAcquisitionEvidence[] }> {
  const evidence: SourceAcquisitionEvidence[] = [];
  const runForSource: RunForSource = (source, child) => sourceContext.run({ source, evidence }, child);
  const value = await operation(runForSource);
  return { value, evidence: [...evidence] };
}
