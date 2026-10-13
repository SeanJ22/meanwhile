/** @freshness-reads-here: stamps only the successful fetch whose bytes were just read; replays keep the original time. */
import { createHash } from "node:crypto";
import type { RoutineCandidate } from "./types.ts";
import type { MeetingsSnapshot } from "../meetings/snapshot.ts";

export interface RetainedSourceResponse {
  readonly source: string; readonly requestedUrl: string; readonly finalUrl: string;
  readonly httpStatus: number; readonly rawHash: string; readonly byteCount: number;
  readonly bytes: Uint8Array; readonly retrievedAt: string; readonly contentType: string;
}
export type RetainedMeetingCandidate = RoutineCandidate & {
  readonly retainedSourceResponses?: readonly (Omit<RetainedSourceResponse, "bytes"> & { readonly base64: string })[];
};

/** Every successful HTTPS response a read made, kept so the facts it yields cite the exact bytes. */
export async function retainMeetingFetchBytes<T>(operation: () => Promise<T>) {
  const originalFetch = globalThis.fetch; const responses: RetainedSourceResponse[] = []; const refusals: string[] = [];
  let retainedBytes = 0;
  const observingFetch = (async (input, init) => {
    const requestedUrl = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const response = await originalFetch(input, init);
    const finalUrl = response.url || requestedUrl;
    if (response.ok && finalUrl.startsWith("https://")) {
      const bytes = new Uint8Array(await response.clone().arrayBuffer());
      if (retainedBytes + bytes.length <= 16 * 1024 * 1024) {
        responses.push({ source: "", requestedUrl, finalUrl, httpStatus: response.status,
          rawHash: createHash("sha256").update(bytes).digest("hex"), byteCount: bytes.length,
          bytes, retrievedAt: new Date().toISOString(), contentType: response.headers.get("content-type") ?? "" });
        retainedBytes += bytes.length;
      } else refusals.push(`RESEARCH_CAPTURE_BOUND_EXCEEDED:${finalUrl}`);
    }
    return response;
  }) as typeof fetch;
  globalThis.fetch = observingFetch;
  try { return { value: await operation(), responses, refusals }; }
  finally { globalThis.fetch = originalFetch; }
}

/** The retained responses one source's read traced, named for that source. */
export function tracedResponses(snapshot: Pick<MeetingsSnapshot, "sources">, responses: readonly RetainedSourceResponse[]): RetainedSourceResponse[] {
  const traced = snapshot.sources.flatMap(report => (report.acquisitions ?? []).map(evidence => ({ ...evidence, source: report.source })));
  return responses.flatMap(response => {
    const evidence = traced.find(row => row.requestedUrl === response.requestedUrl && row.finalUrl === response.finalUrl &&
      row.rawHash === response.rawHash && row.byteCount === response.byteCount && row.httpStatus === response.httpStatus);
    return evidence ? [{ ...response, source: evidence.source }] : [];
  });
}

export function retainMeetingCandidateEvidence(candidate: RoutineCandidate, snapshot: MeetingsSnapshot, responses: readonly RetainedSourceResponse[]): RetainedMeetingCandidate {
  const retainedSourceResponses = tracedResponses(snapshot, responses).map(({ bytes, ...metadata }) => ({ ...metadata, base64: Buffer.from(bytes).toString("base64") }));
  return retainedSourceResponses.length ? { ...candidate, retainedSourceResponses } : candidate;
}
