import type { EvidenceStore } from "../control-plane/evidence/store.ts";
import { vaultCapture } from "../facts/capture.ts";
import { normalizeText } from "../facts/check.ts";
import { publishMeetingFacts, sittingOnPage, type MeetingFactsReport } from "../facts/meeting-facts.ts";
import { meetingEntityId } from "../facts/meeting-read.ts";
import type { Clocks, FactDb, Query } from "../facts/publish.ts";
import type { Meeting } from "../sources/types.ts";
import type { RetainedSourceResponse } from "./retained-meeting-bytes.ts";
import { savedText } from "../facts/source-copy.ts";
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

/** Publication and continuation share the same exact source selection and fact checks. */
export async function publishCapturedMeetingFacts(input: {
  readonly facts: FactDb & { readonly query: Query }; readonly meetings: readonly Meeting[];
  readonly captures: readonly WorkerPublicationCapture[]; readonly producedBy: string; readonly clocks: Clocks; readonly now: Date;
  readonly geocodeAttempts?: ReadonlyMap<string,readonly PinGeocodeAttempt[]>;
  readonly deadlineMs?: number; readonly onMeetingComplete?: (meeting: Meeting) => Promise<void>;
}): Promise<MeetingFactsReport & { readonly complete: boolean }> {
  const { captures } = input;
  const tally = { live: 0, confirmed: 0, held: 0, blanks: 0 };
  if (!captures.length) return { ...tally, complete: input.meetings.length === 0 };
  // The bytes were read after the pass began; checking them against its start would refuse every fresh read.
  const now = new Date(Math.max(input.now.getTime(), ...captures.map(capture => Date.parse(capture.observedAt)).filter(Number.isFinite)));
  const canceledHeld = new Set((await input.facts.query(`SELECT entity_id FROM fact WHERE entity_id=ANY($1::text[]) AND field='status' AND status='live'`,
    [input.meetings.map(meeting => meetingEntityId(meeting.id))])).map(row => String(row.entity_id)));
  for (const meeting of input.meetings) {
    if (Date.now() >= (input.deadlineMs ?? Infinity)) return { ...tally, complete: false };
    const title = normalizeText(meeting.title);
    const states = (capture: WorkerPublicationCapture) => normalizeText(savedText(capture)).includes(title);
    const calendarCaptures=captures.filter(c=>new URL(c.evidence.canonicalUrl).hostname!=="geocoding.geo.census.gov");
    if(!calendarCaptures.length)return { ...tally, complete: false };
    const capture = calendarCaptures.find(c => states(c) && sittingOnPage(savedText(c), meeting)) ?? calendarCaptures.find(states) ?? calendarCaptures[0]!;
    const pinCapture=captures.find(c=>c.evidence.canonicalUrl===meeting.mapPin?.coordinateSourceUrl);
    const report = await publishMeetingFacts(input.facts, { meeting, capture,pinCapture,
      geocodeAttempts:input.geocodeAttempts?.get(meeting.id),producedBy: input.producedBy,
      canceledHeld: canceledHeld.has(meetingEntityId(meeting.id)) }, input.clocks, now);
    tally.live += report.live; tally.confirmed += report.confirmed; tally.held += report.held; tally.blanks += report.blanks;
    await input.onMeetingComplete?.(meeting);
  }
  return { ...tally, complete: true };
}
