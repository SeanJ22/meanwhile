/** @freshness-reads-here: stamps only the successful fetch whose bytes were just read; replays keep the original time. */
import { runWithSourceFetch } from "../sources/fetch-source.ts";
import type { RoutineCandidate } from "./types.ts";
import type { MeetingsSnapshot } from "../meetings/snapshot.ts";

export interface RetainedSourceResponse {
  readonly source: string; readonly requestedUrl: string; readonly finalUrl: string;
  readonly httpStatus: number; readonly checkStatus?: number; readonly rawHash: string; readonly byteCount: number;
  readonly bytes: Uint8Array; readonly retrievedAt: string; readonly contentType: string;
}
type TracedFetch = Pick<RetainedSourceResponse, "requestedUrl" | "finalUrl" | "httpStatus" | "rawHash" | "byteCount">;
export type RetainedMeetingCandidate = RoutineCandidate & {
  readonly retainedSourceResponses?: readonly (Omit<RetainedSourceResponse, "bytes"> & { readonly base64: string })[];
};

export async function retainMeetingFetchBytes<T>(operation: () => Promise<T>) {
  const responses: RetainedSourceResponse[] = [];
  const value = await runWithSourceFetch({ onResponse: response => {
    if (response.responseStatus < 200 || response.responseStatus >= 300) return;
    if (responses.some(held => held.requestedUrl === response.requestedUrl && held.rawHash === response.rawHash)) return;
    responses.push({ ...response, source: "", httpStatus: response.responseStatus, checkStatus: response.httpStatus });
  } }, operation);
  return { value, responses };
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
