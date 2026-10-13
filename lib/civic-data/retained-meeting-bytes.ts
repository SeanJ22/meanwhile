/** @freshness-reads-here: stamps only the successful fetch whose bytes were just read; replays keep the original time. */
import { createHash } from "node:crypto";
import type { RoutineCandidate } from "./types.ts";
import type { MeetingsSnapshot } from "../meetings/snapshot.ts";

export interface RetainedSourceResponse {
  readonly source: string; readonly requestedUrl: string; readonly finalUrl: string;
  readonly httpStatus: number; readonly rawHash: string; readonly byteCount: number;
  readonly bytes: Uint8Array; readonly retrievedAt: string;
}
export type RetainedMeetingCandidate = RoutineCandidate & {
  readonly retainedSourceResponses?: readonly (Omit<RetainedSourceResponse, "bytes"> & { readonly base64: string })[];
};

export async function retainMeetingFetchBytes<T>(operation: () => Promise<T>, source: string, acceptUrl: (url: string) => boolean) {
  const originalFetch = globalThis.fetch; const responses: RetainedSourceResponse[] = []; const refusals: string[] = [];
  let retainedBytes = 0;
  const observingFetch = (async (input, init) => {
    const requestedUrl = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const response = await originalFetch(input, init);
    const finalUrl = response.url || requestedUrl;
    if (response.ok && acceptUrl(finalUrl)) {
      const bytes = new Uint8Array(await response.clone().arrayBuffer());
      if (retainedBytes + bytes.length <= 16 * 1024 * 1024) {
        responses.push({ source, requestedUrl, finalUrl, httpStatus: response.status,
          rawHash: createHash("sha256").update(bytes).digest("hex"), byteCount: bytes.length,
          bytes, retrievedAt: new Date().toISOString() });
        retainedBytes += bytes.length;
      } else refusals.push(`RESEARCH_CAPTURE_BOUND_EXCEEDED:${finalUrl}`);
    }
    return response;
  }) as typeof fetch;
  globalThis.fetch = observingFetch;
  try { return { value: await operation(), responses, refusals }; }
  finally { globalThis.fetch = originalFetch; }
}

export function retainMeetingCandidateEvidence(candidate: RoutineCandidate, snapshot: MeetingsSnapshot, responses: readonly RetainedSourceResponse[]): RetainedMeetingCandidate {
  const traced = snapshot.sources.flatMap(report => report.acquisitions ?? []);
  const retainedSourceResponses = responses.filter(response => traced.some(evidence => evidence.source === response.source &&
    evidence.requestedUrl === response.requestedUrl && evidence.finalUrl === response.finalUrl && evidence.rawHash === response.rawHash &&
    evidence.byteCount === response.byteCount && evidence.httpStatus === response.httpStatus)).map(({ bytes, ...metadata }) =>
      ({ ...metadata, base64: Buffer.from(bytes).toString("base64") }));
  return retainedSourceResponses.length ? { ...candidate, retainedSourceResponses } : candidate;
}

