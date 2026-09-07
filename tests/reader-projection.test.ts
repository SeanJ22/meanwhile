import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { parseLegistarEvents, PARSER_VERSION } from "../lib/control-plane/workers/parser.ts";
import type { LegacyCivicExtractionContract, ParserWorkerInput } from "../lib/control-plane/workers/types.ts";
import type { ArtifactRecord } from "../lib/control-plane/repository/types.ts";
import { contentHash } from "../lib/control-plane/ids.ts";
import { bridgeMeetingFacts, type MeetingFact } from "../lib/control-plane/promotion/meeting-facts.ts";
import { projectFactToReader, projectionLines, proposeSnapshot, readerRendering } from "../lib/control-plane/promotion/reader-projection.ts";
import { readSnapshot, validateSnapshot } from "../lib/meetings/snapshot.ts";
import { formatMeetingTime } from "../lib/map/format.ts";

/**
 * **PRDY-4 — THE CANONICAL READER PROJECTION, ON REAL DATA.** (2026-09-06.)
 *
 * The committed `data/meetings-snapshot.json` already serves 17 of the 18 Pima
 * sittings in the held capture. Projecting the bridged facts over the real
 * snapshot must therefore change nothing the Reader already says about them
 * — the strongest real-data proof that the projection IS the adapter's own
 * meeting — and must add the one sitting the snapshot lacks through the
 * Reader's own validator.
 */

const TEXT = readFileSync(new URL("./fixtures/legistar-pima-events.json", import.meta.url), "utf8");
const NOW = "2026-09-06T12:00:00.000Z";
const CONTRACT: LegacyCivicExtractionContract = {
  recordClass: "LEGISTAR_EVENTS", schemaVersion: 1, subjectId: "ocd-division/country:us/state:az/county:pima#governing",
  sourceBodyId: 138, sourceBodyName: "Board of Supervisors", publisherSlug: "pima",
  requiredFields: ["EventId", "EventBodyId", "EventBodyName", "EventDate"],
  completenessScope: "The 18 Event rows in the already-held capture.", expectedSourceDate: null,
};

function facts(): readonly MeetingFact[] {
  const art: ArtifactRecord = { artifactId: "ar-pima", workItemId: "wi", routeTaskId: null, attemptId: "at-1", tier: "A1" as never, contentHash: contentHash(TEXT),
    byteLength: Buffer.byteLength(TEXT), contentType: "application/json", canonicalUrl: "https://webapi.legistar.com/v1/pima/events", partial: false, recordedAt: "2026-09-05T18:00:00.000Z" };
  const input: ParserWorkerInput = { attemptId: "at-p", worker: { role: "PARSER", provider: "d", version: PARSER_VERSION, instance: "p-1" },
    evidence: { artifactId: art.artifactId, contentHash: art.contentHash, text: TEXT, acquiredByAttemptId: "at-1", canonicalUrl: art.canonicalUrl, retrievedAt: art.recordedAt, sourceId: "legistar", methodRouteId: "r" }, contract: CONTRACT };
  const parser = { id: "wr-p", attemptId: "at-p", result: parseLegistarEvents(input), completion: { completedTask: { workerTask: { contract: CONTRACT } } } } as never;
  const bridge = bridgeMeetingFacts({ parser, validator: null, auditor: null, artifact: art, text: TEXT, now: NOW });
  assert.deepEqual(bridge.refusals, []);
  return bridge.facts;
}

test("PRDY-4: over the real committed snapshot, the 17 held Pima sittings project UNCHANGED (fact equals the Reader's own row) and the 18th is ADDED through validateSnapshot", () => {
  const current = readSnapshot(process.cwd());
  assert.ok(current, "the committed snapshot is present");
  const all = facts();
  const times = all.filter((f) => f.recordClass === "meeting-times");
  const held = times.filter((f) => current.meetings.some((m) => m.id === f.meetingId));
  assert.ok(held.length >= 10 && held.length < 18, `the committed snapshot serves ${held.length} of the 18 held sittings (its window rolls)`);
  const differing = held.map((f) => projectFactToReader(f, current)).filter((c) => c.kind !== "UNCHANGED" && c.changedFields.some((k) => k !== "provenance" && k !== "status"));
  assert.deepEqual(differing.map((c) => `${c.meetingId}: ${c.changedFields.join(",")}`), [], "no civic field differs between the bridged fact and what the Reader already serves");
  const notHeld = times.filter((f) => !current.meetings.some((m) => m.id === f.meetingId));
  const missing = notHeld[0];
  const change = projectFactToReader(missing, current);
  assert.equal(change.kind, "ADD");
  assert.equal(change.before, null);

  const proposal = proposeSnapshot(current, all, NOW);
  assert.deepEqual(proposal.validation, { ok: true }, "the Reader's own validator accepts the proposed snapshot");
  assert.deepEqual(proposal.sourcesAdded, [], "legistar is already an accounted source");
  assert.equal(proposal.snapshot.meetings.length, current.meetings.length + notHeld.length);
  assert.equal(proposal.snapshot.counts.total, current.counts.total + notHeld.length);
  assert.equal(proposal.snapshot.counts.fresh + proposal.snapshot.counts.carried, proposal.snapshot.counts.total);
  assert.equal(proposal.changes.length, 36);
  assert.equal(proposal.changes.filter((c) => c.kind === "ADD").length, notHeld.length, "each new sitting is one ADD; its agenda fact layers onto the projected row, so it is not a second ADD");
  assert.doesNotThrow(() => validateSnapshot(proposal.snapshot));
  const projected = proposal.snapshot.meetings.find((m) => m.id === missing.meetingId)!;
  assert.equal(projected.agendaUrl, (all.find((f) => f.recordClass === "agendas" && f.meetingId === missing.meetingId) as Extract<MeetingFact, { recordClass: "agendas" }>).agenda.documentUrl);
  assert.equal(readFileSync("data/meetings-snapshot.json", "utf8").includes(missing.meetingId), false, "the committed reader snapshot is untouched by a proposal");

  const rendering = readerRendering(change);
  assert.equal(rendering.time, formatMeetingTime(missing.meeting), "the rendering is the Reader's own formatter");
  assert.equal(rendering.body, "Board of Supervisors");
  assert.equal(rendering.jurisdiction, "Pima County, AZ");
  assert.equal(rendering.agenda, "LINK");
  assert.deepEqual(rendering.missing, []);
  const line = projectionLines(proposal)[0];
  assert.ok(line.includes(`36 change(s): ${notHeld.length} add, 0 replace, ${36 - notHeld.length} unchanged; validateSnapshot accepts`), line);
});

test("PRDY-4: a moved sitting is a REPLACE naming the changed fields; an online sitting renders its label and never a pin; a missing agenda is OUR gap unless the publisher's slot was observed empty", () => {
  const current = readSnapshot(process.cwd())!;
  const all = facts();
  const study = all.find((f) => f.recordClass === "meeting-times" && current.meetings.some((m) => m.id === f.meetingId))!;
  const moved: MeetingFact = { ...study, factKey: `${study.meetingId}@2026-05-12T14:00:00-07:00`, time: { ...study.time, startsAt: "2026-05-12T14:00:00-07:00" }, meeting: { ...study.meeting, startsAt: "2026-05-12T14:00:00-07:00" } };
  const change = projectFactToReader(moved, current);
  assert.equal(change.kind, "REPLACE");
  assert.ok(change.changedFields.includes("startsAt"), change.changedFields.join(","));

  const online = all.find((f) => f.recordClass === "meeting-times" && f.meetingId === "legistar:pima:1848")!;
  const rendered = readerRendering(projectFactToReader(online, current));
  assert.equal(rendered.where, "online: Virtual Meeting (no join link published)");

  const noAgenda: MeetingFact = { ...study, meeting: { ...study.meeting, agendaUrl: null } };
  assert.equal(readerRendering(projectFactToReader(noAgenda, null)).agenda, "NOT_CARRIED_OUR_GAP");
  const slotEmpty: MeetingFact = { ...study, meeting: { ...study.meeting, agendaUrl: null, agendaSlotObservedEmpty: true } };
  assert.equal(readerRendering(projectFactToReader(slotEmpty, null)).agenda, "PUBLISHER_SLOT_EMPTY");

  const broken = proposeSnapshot({ ...current, sources: [] }, [study], NOW);
  assert.equal(broken.validation.ok, false, "a proposal the Reader's validator refuses says so instead of throwing");
});
