/** @freshness-reads-here: stamps only the successful fetch whose bytes were just read; replays keep the original time. */
import { createHash } from "node:crypto";
import { trackSourceTransport } from "../sources/host-transport.ts";
import type { RoutineCandidate } from "./types.ts";
import type { MeetingsSnapshot } from "../meetings/snapshot.ts";
import type { Meeting } from "../sources/types.ts";
import type { EvidenceStore } from "../control-plane/evidence/store.ts";
import { holdRawCapture, rawCaptureKey } from "./raw-capture-vault.ts";

export interface RetainedSourceResponse {
  readonly source: string; readonly requestedUrl: string; readonly finalUrl: string;
  readonly httpStatus: number; readonly rawHash: string; readonly byteCount: number;
  readonly bytes: Uint8Array; readonly retrievedAt: string; readonly contentType: string;
  readonly request?: { readonly method: string; readonly body?: string; readonly headers?: Readonly<Record<string, string>> };
}
type TracedFetch = Pick<RetainedSourceResponse, "requestedUrl" | "finalUrl" | "httpStatus" | "rawHash" | "byteCount">;

/** Parsing a saved continuation is a new parse, never a new provider observation. */
export function bindMeetingSourceObservations(meetings: readonly Meeting[], responses: readonly RetainedSourceResponse[]): Meeting[] {
  const oldest=responses.map(page=>page.retrievedAt).sort()[0];
  if (!oldest) return [...meetings];
  return meetings.map(meeting=>{
    if (meeting.carried) return meeting;
    const own=responses.find(page=>page.requestedUrl===meeting.provenance.sourceUrl||page.finalUrl===meeting.provenance.sourceUrl);
    return {...meeting,provenance:{...meeting.provenance,collectedAt:own?.retrievedAt??oldest},fieldSources:meeting.fieldSources&&Object.fromEntries(
      Object.entries(meeting.fieldSources).map(([field,source])=>{
        const captured=responses.find(page=>page.requestedUrl===source.sourceUrl||page.finalUrl===source.sourceUrl);
        return [field,source.sourceOrg!=="Sean"?{...source,collectedAt:captured?.retrievedAt??oldest}:source];
      }))};
  });
}
export type RetainedMeetingCandidate = RoutineCandidate & {
  readonly retainedSourceResponses?: readonly (Omit<RetainedSourceResponse, "bytes"> & { readonly base64: string })[];
};

/** Move owned or legacy response bytes to the single fingerprint-filed source copy. */
export async function holdMeetingResponses(vault:EvidenceStore,responses:readonly unknown[]):Promise<readonly unknown[]> {
  return Promise.all(responses.map(async value=>{
    if(!value || typeof value!=="object" || Array.isArray(value))throw new Error("MEETING_CAPTURE_INVALID");
    const row=value as Record<string,unknown>,{base64,...metadata}=row;
    if(typeof row.rawHash!=="string" || !/^[a-f0-9]{64}$/.test(row.rawHash) ||
      !Number.isSafeInteger(row.byteCount) || (row.byteCount as number)<0)throw new Error("MEETING_CAPTURE_INVALID");
    if(base64===undefined){
      if(row.vaultKey!==rawCaptureKey(row.rawHash))throw new Error("MEETING_CAPTURE_VAULT_MISSING");
      const held=await vault.head(row.vaultKey as string);
      if(!held || held.contentHash!==`sha256-${row.rawHash}` || held.byteLength!==row.byteCount)throw new Error("MEETING_CAPTURE_VAULT_MISSING");
      return metadata;
    }
    if(typeof base64!=="string")throw new Error("MEETING_CAPTURE_INVALID");
    const bytes=Buffer.from(base64,"base64");
    if(bytes.length!==row.byteCount || createHash("sha256").update(bytes).digest("hex")!==row.rawHash)
      throw new Error("MEETING_CAPTURE_FINGERPRINT_MISMATCH");
    const ref=await holdRawCapture(vault,"meeting-source",bytes,typeof row.contentType==="string"?row.contentType:"application/octet-stream");
    return {...metadata,vaultKey:ref.vaultKey};
  }));
}

/** A fetch that keeps every successful HTTPS response it makes, so the facts a read yields cite the exact bytes. */
export function retainingFetch(base: typeof fetch, now: () => string = () => new Date().toISOString()) {
  const responses: RetainedSourceResponse[] = [], refusals: string[] = [];
  let retainedBytes = 0;
  const fetch = trackSourceTransport((async (input, init) => {
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
  }) as typeof globalThis.fetch, base);
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
