import type { EvidenceStore } from "../control-plane/evidence/store.ts";
import { vaultCapture } from "../facts/capture.ts";
import { normalizeText } from "../facts/check.ts";
import { publishMeetingFacts, sittingOnPage, type MeetingFactsReport } from "../facts/meeting-facts.ts";
import type { Clocks, FactDb, Query } from "../facts/publish.ts";
import type { Meeting } from "../sources/types.ts";
import type { RetainedSourceResponse } from "./retained-meeting-bytes.ts";
import type { WorkerPublicationCapture } from "./worker-roster-publication.ts";

/** The sittings a door just read become facts on the bytes it read, each copy saved to the vault first. */
export async function publishReadMeetingFacts(input: {
  readonly facts: FactDb & { readonly query: Query }; readonly vault: EvidenceStore;
  readonly meetings: readonly Meeting[]; readonly responses: readonly RetainedSourceResponse[];
  readonly producedBy: string; readonly clocks: Clocks; readonly now: Date;
}): Promise<MeetingFactsReport & { readonly unsaved: readonly string[] }> {
  const captures: WorkerPublicationCapture[] = [], unsaved: string[] = [];
  for (const response of input.responses) {
    const saved = await vaultCapture({ vault: input.vault, url: response.finalUrl, bytes: response.bytes, httpStatus: response.httpStatus,
      contentType: response.contentType, retrievedAt: response.retrievedAt });
    if ("error" in saved) unsaved.push(`${response.finalUrl}: ${saved.error}`);
    else captures.push(saved.capture);
  }
  const tally = { live: 0, confirmed: 0, held: 0, blanks: 0 };
  if (!captures.length) return { ...tally, unsaved };
  for (const meeting of input.meetings) {
    const title = normalizeText(meeting.title);
    const states = (capture: WorkerPublicationCapture) => normalizeText(capture.evidence.text).includes(title);
    const capture = captures.find(c => states(c) && sittingOnPage(c.evidence.text, meeting)) ?? captures.find(states) ?? captures[0]!;
    const report = await publishMeetingFacts(input.facts, { meeting, capture, producedBy: input.producedBy }, input.clocks, input.now);
    tally.live += report.live; tally.confirmed += report.confirmed; tally.held += report.held; tally.blanks += report.blanks;
  }
  return { ...tally, unsaved };
}
