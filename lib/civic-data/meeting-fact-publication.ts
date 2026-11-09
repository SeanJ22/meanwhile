import type { EvidenceStore } from "../control-plane/evidence/store.ts";
import { vaultCapture } from "../facts/capture.ts";
import { normalizeText } from "../facts/check.ts";
import { publishMeetingFacts, sittingOnPage, type MeetingFactsReport } from "../facts/meeting-facts.ts";
import type { Clocks, FactDb, Query } from "../facts/publish.ts";
import type { Meeting } from "../sources/types.ts";
import type { RetainedSourceResponse } from "./retained-meeting-bytes.ts";
import type { WorkerPublicationCapture } from "./worker-roster-publication.ts";
import type { PinGeocodeAttempt } from "../meetings/publish-pins.ts";

/** The sittings a door just read become facts on the bytes it read, each copy saved to the vault first. */
export async function publishReadMeetingFacts(input: {
  readonly facts: FactDb & { readonly query: Query }; readonly vault: EvidenceStore;
  readonly meetings: readonly Meeting[]; readonly responses: readonly RetainedSourceResponse[];
  readonly producedBy: string; readonly clocks: Clocks; readonly now: Date;
  readonly geocodeAttempts?: ReadonlyMap<string,readonly PinGeocodeAttempt[]>;
}): Promise<MeetingFactsReport & { readonly unsaved: readonly string[] }> {
  const captures: WorkerPublicationCapture[] = [], unsaved: string[] = [];
  for (const response of input.responses) {
    const saved = await vaultCapture({ vault: input.vault, url: response.finalUrl, bytes: response.bytes, httpStatus: response.httpStatus,
      contentType: response.contentType, retrievedAt: response.retrievedAt });
    if ("error" in saved) unsaved.push(`${response.finalUrl}: ${saved.error}`);
    else captures.push(saved.capture);
  }
  return { ...await publishCapturedMeetingFacts({ ...input, captures }), unsaved };
}

/** The reader fact database holds four connections, so independent meetings publish four at a time. */
export const MEETING_FACT_CONCURRENCY = 4;

/** Publication and continuation share the same exact source selection and fact checks; `onProgress` gets the leading finished count after each window. */
export async function publishCapturedMeetingFacts(input: {
  readonly facts: FactDb & { readonly query: Query }; readonly meetings: readonly Meeting[];
  readonly captures: readonly WorkerPublicationCapture[]; readonly producedBy: string; readonly clocks: Clocks; readonly now: Date;
  readonly geocodeAttempts?: ReadonlyMap<string,readonly PinGeocodeAttempt[]>;
  readonly deadlineMs?: number; readonly onProgress?: (leadingDone: number) => Promise<void>;
}): Promise<MeetingFactsReport & { readonly complete: boolean }> {
  const { captures } = input;
  const tally = { live: 0, confirmed: 0, held: 0, blanks: 0 };
  if (!captures.length) return { ...tally, complete: input.meetings.length === 0 };
  // The bytes were read after the pass began; checking them against its start would refuse every fresh read.
  const now = new Date(Math.max(input.now.getTime(), ...captures.map(capture => Date.parse(capture.observedAt)).filter(Number.isFinite)));
  const calendarCaptures=captures.filter(c=>new URL(c.evidence.canonicalUrl).hostname!=="geocoding.geo.census.gov");
  if(input.meetings.length&&!calendarCaptures.length)return { ...tally, complete: false };
  const publish = async (meeting: Meeting) => {
    if (Date.now() >= (input.deadlineMs ?? Infinity)) return null;
    const title = normalizeText(meeting.title);
    const states = (capture: WorkerPublicationCapture) => normalizeText(capture.evidence.text).includes(title);
    const capture = calendarCaptures.find(c => states(c) && sittingOnPage(c.evidence.text, meeting)) ?? calendarCaptures.find(states) ?? calendarCaptures[0]!;
    const pinCapture=captures.find(c=>c.evidence.canonicalUrl===meeting.mapPin?.coordinateSourceUrl);
    return publishMeetingFacts(input.facts, { meeting, capture,pinCapture,
      geocodeAttempts:input.geocodeAttempts?.get(meeting.id),producedBy: input.producedBy }, input.clocks, now);
  };
  for (let at = 0; at < input.meetings.length; at += MEETING_FACT_CONCURRENCY) {
    const window = await Promise.allSettled(input.meetings.slice(at, at + MEETING_FACT_CONCURRENCY).map(publish));
    for (const result of window) if (result.status === "fulfilled" && result.value) for (const key of ["live", "confirmed", "held", "blanks"] as const) tally[key] += result.value[key];
    // Only a prefix of finished meetings counts as progress; the first unfinished one is where a resume starts.
    const unfinished = window.findIndex(result => result.status !== "fulfilled" || !result.value);
    if (unfinished !== 0) await input.onProgress?.(at + (unfinished < 0 ? window.length : unfinished));
    for (const result of window) if (result.status === "rejected") throw result.reason;
    if (unfinished >= 0) return { ...tally, complete: false };
  }
  return { ...tally, complete: true };
}
