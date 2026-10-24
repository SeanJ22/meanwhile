/** @freshness-reads-here: stamps only the successful fetch whose bytes were just read; replays keep the original time. */
import { createHash } from "node:crypto";
import type { RoutineCandidate } from "./types.ts";
import type { MeetingsSnapshot } from "../meetings/snapshot.ts";

export interface RetainedSourceResponse {
  readonly source: string; readonly requestedUrl: string; readonly finalUrl: string;
  readonly httpStatus: number; readonly rawHash: string; readonly byteCount: number;
  readonly bytes: Uint8Array; readonly retrievedAt: string; readonly contentType: string;
}
type TracedFetch = Pick<RetainedSourceResponse, "requestedUrl" | "finalUrl" | "httpStatus" | "rawHash" | "byteCount">;
export type RetainedMeetingCandidate = RoutineCandidate & {
  readonly retainedSourceResponses?: readonly (Omit<RetainedSourceResponse, "bytes"> & { readonly base64: string })[];
};

/** A fetch that keeps every successful HTTPS response it makes, so the facts a read yields cite the exact bytes. */
export function retainingFetch(base: typeof fetch, now: () => string = () => new Date().toISOString()) {
  const responses: RetainedSourceResponse[] = [], refusals: string[] = [];
  let retainedBytes = 0;
  const fetch = (async (input, init) => {
    const requestedUrl = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const response = await base(input, init);
    const finalUrl = response.url || requestedUrl;
    if (response.ok && finalUrl.startsWith("https://")) {
      const bytes = new Uint8Array(await response.clone().arrayBuffer());
      if (retainedBytes + bytes.length <= 16 * 1024 * 1024) {
        responses.push({ source: "", requestedUrl, finalUrl, httpStatus: response.status,
          rawHash: createHash("sha256").update(bytes).digest("hex"), byteCount: bytes.length,
          bytes, retrievedAt: now(), contentType: response.headers.get("content-type") ?? "" });
        retainedBytes += bytes.length;
      } else refusals.push(`RESEARCH_CAPTURE_BOUND_EXCEEDED:${finalUrl}`);
    }
    return response;
  }) as typeof globalThis.fetch;
  return { fetch, responses, refusals };
}

export async function retainMeetingFetchBytes<T>(operation: () => Promise<T>, now?: () => string) {
  const originalFetch = globalThis.fetch, retaining = retainingFetch(originalFetch, now);
  globalThis.fetch = retaining.fetch;
  try { return { value: await operation(), responses: retaining.responses, refusals: retaining.refusals }; }
  finally { globalThis.fetch = originalFetch; }
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
  const pointUrls=new Set(snapshot.meetings.flatMap(meeting=>meeting.mapPin?.coordinateSourceUrl??[]));
  const references=responses.filter(response=>pointUrls.has(response.finalUrl)&&new URL(response.finalUrl).hostname==="geocoding.geo.census.gov");
  const owned=new Map([...tracedResponses(snapshot.sources,responses),...references].map(response=>[`${response.finalUrl}:${response.rawHash}`,response]));
  const retainedSourceResponses = [...owned.values()].map(({ bytes, ...metadata }) => ({ ...metadata, base64: Buffer.from(bytes).toString("base64") }));
  return retainedSourceResponses.length ? { ...candidate, retainedSourceResponses } : candidate;
}
