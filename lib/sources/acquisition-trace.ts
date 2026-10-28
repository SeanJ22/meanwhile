import { createHash } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { trackSourceTransport } from "./host-transport.ts";
import { rawCaptureVault } from "../civic-data/raw-capture-remote.ts";
import { vaultSourceResponse } from "./raw-response.ts";

export interface SourceAcquisitionEvidence {
  readonly source: string;
  readonly requestedUrl: string;
  readonly finalUrl: string;
  readonly httpStatus: number;
  readonly rawHash: string;
  readonly byteCount: number;
}

type RunForSource = <T>(source: string, operation: () => Promise<T>) => Promise<T>;

const sourceContext = new AsyncLocalStorage<string>();
let activeEvidence: SourceAcquisitionEvidence[] | null = null;

function urlOf(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/** Record the exact acquired bytes while the calling child source is in scope. */
export function recordAcquiredResponse(input: {
  readonly requestedUrl: string;
  readonly finalUrl: string;
  readonly httpStatus: number;
  readonly bytes: Uint8Array;
}): void {
  const source = sourceContext.getStore();
  if (!source || activeEvidence === null) return;
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

/** A request our own infrastructure makes while a source is in scope (the evidence vault) is not that source's acquisition. */
export function outsideSourceAcquisition<T>(operation: () => T): T {
  return sourceContext.exit(operation);
}

/**
 * Capture every successful fetch performed by a batch composite acquisition.
 * AsyncLocalStorage keeps concurrently fetched children attributed to the
 * child that initiated them. The global fetch replacement exists only for the
 * duration of this explicit batch call and is always restored.
 */
export async function captureSourceAcquisitions<T>(
  operation: (runForSource: RunForSource) => Promise<T>,
): Promise<{ readonly value: T; readonly evidence: readonly SourceAcquisitionEvidence[] }> {
  if (activeEvidence !== null) throw new Error("SOURCE_ACQUISITION_TRACE_ALREADY_ACTIVE");
  const originalFetch = globalThis.fetch;
  const evidence: SourceAcquisitionEvidence[] = [];
  activeEvidence = evidence;
  globalThis.fetch = trackSourceTransport((async (input, init) => {
    let response = await originalFetch(input, init);
    if (sourceContext.getStore() && response.ok) {
      if (process.env.WTP_VAULT_PROVIDER === "netlify")
        response = vaultSourceResponse(response, rawCaptureVault(), sourceContext.getStore()!);
      const bytes = new Uint8Array(await response.clone().arrayBuffer());
      recordAcquiredResponse({
        requestedUrl: urlOf(input),
        finalUrl: response.url || urlOf(input),
        httpStatus: response.status,
        bytes,
      });
    }
    return response;
  }) as typeof fetch, originalFetch);
  const runForSource: RunForSource = (source, child) => sourceContext.run(source, child);
  try {
    const value = await operation(runForSource);
    return { value, evidence: [...evidence] };
  } finally {
    globalThis.fetch = originalFetch;
    activeEvidence = null;
  }
}
