/** @freshness-reads-here: stamps only the successful fetch whose bytes were just read; replays keep the original time. */
import { createHash } from "node:crypto";
import type { RoutineCandidate } from "./types.ts";
import type { MeetingsSnapshot } from "../meetings/snapshot.ts";
import { observeAcquiredResponses } from "../sources/acquisition-trace.ts";

export interface RetainedSourceResponse {
  readonly source: string; readonly requestedUrl: string; readonly finalUrl: string;
  readonly httpStatus: number; readonly rawHash: string; readonly byteCount: number;
  readonly bytes: Uint8Array; readonly retrievedAt: string; readonly contentType: string;
}
type TracedFetch = Pick<RetainedSourceResponse, "requestedUrl" | "finalUrl" | "httpStatus" | "rawHash" | "byteCount">;
export type RetainedMeetingCandidate = RoutineCandidate & {
  readonly retainedSourceResponses?: readonly (Omit<RetainedSourceResponse, "bytes"> & { readonly base64: string })[];
};

const RETAINED_BYTES_LIMIT = 16 * 1024 * 1024;

function responseRetainer() {
  const responses: RetainedSourceResponse[] = [], refusals: string[] = [];
  let retainedBytes = 0;
  const keep = (requestedUrl: string, finalUrl: string, httpStatus: number, bytes: Uint8Array, contentType: string) => {
    if (httpStatus < 200 || httpStatus > 299 || !finalUrl.startsWith("https://")) return;
    const rawHash = createHash("sha256").update(bytes).digest("hex");
    if (responses.some(row => row.requestedUrl === requestedUrl && row.finalUrl === finalUrl && row.rawHash === rawHash)) return;
    if (retainedBytes + bytes.length > RETAINED_BYTES_LIMIT) { refusals.push(`RESEARCH_CAPTURE_BOUND_EXCEEDED:${finalUrl}`); return; }
    responses.push({ source: "", requestedUrl, finalUrl, httpStatus, rawHash, byteCount: bytes.length,
      bytes, retrievedAt: new Date().toISOString(), contentType });
    retainedBytes += bytes.length;
  };
  return { responses, refusals, keep };
}

/** A fetch that keeps every successful HTTPS response it makes, so the facts a read yields cite the exact bytes. */
export function retainingFetch(base: typeof fetch) {
  const { responses, refusals, keep } = responseRetainer();
  const fetch = (async (input, init) => {
    const requestedUrl = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const response = await base(input, init);
    if (response.ok) keep(requestedUrl, response.url || requestedUrl, response.status,
      new Uint8Array(await response.clone().arrayBuffer()), response.headers.get("content-type") ?? "");
    return response;
  }) as typeof globalThis.fetch;
  return { fetch, responses, refusals };
}

/** Keeps the bytes every source read acquires while the operation runs, whichever transport carried them. */
export async function retainMeetingFetchBytes<T>(operation: () => Promise<T>) {
  const { responses, refusals, keep } = responseRetainer();
  const value = await observeAcquiredResponses(({ requestedUrl, finalUrl, httpStatus, bytes, contentType }) =>
    keep(requestedUrl, finalUrl, httpStatus, bytes, contentType ?? ""), operation);
  return { value, responses, refusals };
}

/** The retained responses one source's read traced, named for that source. */
export function tracedResponses(sources: readonly { readonly source: string; readonly acquisitions?: readonly TracedFetch[] }[],
  responses: readonly RetainedSourceResponse[]): RetainedSourceResponse[] {
  const traced = sources.flatMap(report => (report.acquisitions ?? []).map(evidence => ({ ...evidence, source: report.source })));
  return responses.flatMap(response => {
    const evidence = traced.find(row => row.requestedUrl === response.requestedUrl && row.finalUrl === response.finalUrl &&
      row.rawHash === response.rawHash && row.byteCount === response.byteCount && row.httpStatus === response.httpStatus);
    return evidence ? [{ ...response, source: evidence.source }] : [];
  });
}

export function retainMeetingCandidateEvidence(candidate: RoutineCandidate, snapshot: MeetingsSnapshot, responses: readonly RetainedSourceResponse[]): RetainedMeetingCandidate {
  const retainedSourceResponses = tracedResponses(snapshot.sources, responses).map(({ bytes, ...metadata }) => ({ ...metadata, base64: Buffer.from(bytes).toString("base64") }));
  return retainedSourceResponses.length ? { ...candidate, retainedSourceResponses } : candidate;
}
