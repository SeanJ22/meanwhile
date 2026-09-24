/**
 * **A MEETING ITS PUBLISHER RE-ISSUES UNDER A NEW ID SHOWS ONCE.** (2026-09-24.)
 *
 * The defect, measured in production at 2026-09-24T06:46Z (read-only): Tucson
 * Unified's Diligent partition served its Audit Committee's 16 September
 * 14:30 sitting twice. The portal had re-issued the sitting as meeting 501.
 * The partition writer still held meeting 495, which the portal no longer
 * listed, as a carried row (`UNEXPLAINED_DISAPPEARANCE`), because nothing named
 * 501 as its successor. A reader saw two rows for one meeting, and every count
 * stated for the body included both.
 *
 * The rule (`reissuesSitting` in lib/sources/event-identity.ts, applied by
 * `reconcileSuccessfulMeetingPartition` in scripts/ingest.ts and re-run by the
 * promotion door in lib/civic-data/validate.ts): a row that would be carried
 * yields to a fresh row of the same partition that is the same sitting (the
 * same body id, the same body key from both the body name and the title, the
 * same local date and minute in the same zone) and leaves with removal evidence
 * `SUPERSEDED_BY_OCCURRENCE_IDENTITY` naming that row. With no such twin it is
 * carried exactly as before.
 *
 * No live calls. Meetings 495 and 501 are the two production rows as measured,
 * field for field where the measurement stated them; every other field is what
 * the Diligent adapter writes from the partition's own wiring row, and 501's
 * place, which the measurement did not state, is not claimed. The neighbouring
 * TUSD sittings are rows of the recorded portal read in
 * tests/fixtures/tusd-govboard/diligent-tusd-portal-rows.json.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { MEETING_PARTITION_CONTRACTS } from "../lib/civic-data/meeting-partitions.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import type { RoutineRemovalEvidence } from "../lib/civic-data/types.ts";
import { readMeetingsProjection, snapshotCounts, type MeetingsSnapshot } from "../lib/meetings/snapshot.ts";
import type { ChildRunReport } from "../lib/sources/composite/index.ts";
import type { Meeting } from "../lib/sources/types.ts";
import {
  promoteMeetingPartition,
  promoteMeetingPartitions,
  reconcileSuccessfulMeetingPartition,
} from "../scripts/ingest.ts";

const TUSD = MEETING_PARTITION_CONTRACTS.find((partition) =>
  partition.meetingSource === "diligent" &&
  partition.bodyId === "ocd-division/country:us/state:az/school_district:tucson_unified_district#board",
)!;

/** The portal's own permalink pattern (`serviceBase` + `meetingPath` on the wiring row). */
const PORTAL = "https://tusd1-schooldesk.community.diligentoneplatform.com/Portal/MeetingInformation.aspx?Org=Cal&Id=";

/** The last read whose answer listed meeting 495. */
const LAST_LISTED_495 = "2026-09-08T21:40:32.007Z";
/** The 06:45Z read: 501 fresh, 495 carried beside it. The version measured at 06:46Z. */
const MEASURED_READ = "2026-09-24T06:45:00.000Z";
/**
 * The partition's next read, which again lists the sitting once, as 501. (The
 * store refuses an event stamped in its future, so every instant here is past.)
 */
const NEXT_READ = "2026-09-24T07:00:00.000Z";

const SITTING_STARTS = "2026-09-16T14:30:00-07:00";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/** Meeting 495 exactly as the measured version held it. */
const CARRIED_495: Meeting = {
  id: "diligent:tusd1:495",
  ocdId: TUSD.ocdId,
  bodyId: TUSD.bodyId,
  bodyName: "AGENDA FOR AUDIT COMMITTEE MEETING",
  title: "AGENDA FOR AUDIT COMMITTEE MEETING - Sep 16 2026",
  startsAt: SITTING_STARTS,
  timeZone: "America/Phoenix",
  location: null,
  online: { label: "Via Zoom Webinar", joinUrl: null },
  agendaUrl: null,
  jurisdiction: TUSD.wiring.jurisdiction,
  status: "SCHEDULED",
  provenance: {
    sourceUrl: `${PORTAL}495`,
    sourceOrg: TUSD.wiring.publishingOrg,
    collectedAt: LAST_LISTED_495,
    verifiedAt: null,
  },
  carried: { reason: "UNEXPLAINED_DISAPPEARANCE", source: "diligent", lastFreshAt: LAST_LISTED_495 },
};

/** Meeting 501: the same sitting, re-issued by the portal, as a read at `collectedAt` produces it. */
function fresh501(collectedAt: string, over: Partial<Meeting> = {}): Meeting {
  return {
    id: "diligent:tusd1:501",
    ocdId: TUSD.ocdId,
    bodyId: TUSD.bodyId,
    bodyName: "Audit Committee Meeting Agenda",
    title: "Audit Committee Meeting Agenda - Sep 16 2026",
    startsAt: SITTING_STARTS,
    timeZone: "America/Phoenix",
    location: null,
    agendaUrl: `${PORTAL}501`,
    jurisdiction: TUSD.wiring.jurisdiction,
    status: "CONCLUDED",
    provenance: { sourceUrl: `${PORTAL}501`, sourceOrg: TUSD.wiring.publishingOrg, collectedAt, verifiedAt: null },
    ...over,
  };
}

/** Recorded portal row 502: the Bond Oversight Committee, 17 September 13:00, at Duffy. */
function bondOversight502(collectedAt: string): Meeting {
  return {
    id: "diligent:tusd1:502",
    ocdId: TUSD.ocdId,
    bodyId: TUSD.bodyId,
    bodyName: "Bond Oversight Committee Meeting Agenda",
    title: "Bond Oversight Committee Meeting Agenda - Sep 17 2026",
    startsAt: "2026-09-17T13:00:00-07:00",
    timeZone: "America/Phoenix",
    location: {
      name: "Duffy Community Center, Multipurpose Room",
      address: "5145 E. 5th Street, Tucson, AZ 85711",
      lat: 32.228998,
      lng: -110.883029,
    },
    agendaUrl: `${PORTAL}502`,
    jurisdiction: TUSD.wiring.jurisdiction,
    status: "CONCLUDED",
    provenance: { sourceUrl: `${PORTAL}502`, sourceOrg: TUSD.wiring.publishingOrg, collectedAt, verifiedAt: null },
  };
}

/** Another committee of the same board at the very minute of the Audit Committee sitting. */
function budgetAdvisoryAtSameMinute(collectedAt: string): Meeting {
  return {
    ...fresh501(collectedAt),
    id: "diligent:tusd1:506",
    bodyName: "Budget Advisory Committee Meeting Agenda",
    title: "Budget Advisory Committee Meeting Agenda - Sep 16 2026",
    agendaUrl: `${PORTAL}506`,
    provenance: { sourceUrl: `${PORTAL}506`, sourceOrg: TUSD.wiring.publishingOrg, collectedAt, verifiedAt: null },
  };
}

/** One authenticated answer from the portal's meetings service, with exact-byte evidence. */
function answered(at: string, rows: number): ChildRunReport {
  const service = TUSD.wiring.config.serviceBase!;
  const bytes = `diligent tusd1 MeetingsService answer read at ${at}`;
  return {
    source: "diligent",
    ok: true,
    error: null,
    fetched: rows,
    normalized: rows,
    drops: { placeless: 0, unknownVenue: 0, unplaceableInTime: 0, notConfigured: 0 },
    acquisitions: [{
      source: "diligent",
      requestedUrl: service,
      finalUrl: service,
      httpStatus: 200,
      rawHash: sha256(bytes),
      byteCount: Buffer.byteLength(bytes),
    }],
  };
}

/** A partition snapshot of `meetings` as its writer states it, carried rows counted. */
function partitionSnapshot(at: string, meetings: readonly Meeting[]): MeetingsSnapshot {
  const fresh = meetings.filter((row) => !row.carried).length;
  const carried = meetings.length - fresh;
  return {
    formatVersion: 1,
    generatedAt: at,
    counts: snapshotCounts([...meetings], 0),
    sources: [{
      ...answered(at, fresh),
      error: null,
      ...(carried > 0 ? { carriedForward: carried } : {}),
    }],
    meetings: [...meetings],
    agendaDocuments: [],
  };
}

/** Promote `meetings` through the real door as the partition's LKG, and return what was promoted. */
async function seed(store: MemoryRoutineDataStore, at: string, meetings: readonly Meeting[]) {
  const snapshot = partitionSnapshot(at, meetings);
  const seeded = await promoteMeetingPartition(store, TUSD, snapshot);
  assert.equal(seeded.outcome.candidate.state, "PROMOTED", seeded.outcome.candidate.failureDetail ?? "");
  return { snapshot, versionId: seeded.outcome.promoted!.versionId };
}

/** The version production served at 06:46Z. */
const seedMeasuredVersion = (store: MemoryRoutineDataStore) =>
  seed(store, MEASURED_READ, [fresh501(MEASURED_READ), CARRIED_495]);

async function readerRows(store: MemoryRoutineDataStore, now: string): Promise<MeetingsSnapshot> {
  const read = await readMeetingsProjection({ store, bypassCache: true, allowUnconfiguredBootstrap: false, now });
  assert.equal(read.kind, "PROMOTED");
  return (read as { value: MeetingsSnapshot }).value;
}

const atTheSitting = (snapshot: MeetingsSnapshot) =>
  snapshot.meetings
    .filter((row) => row.bodyId === TUSD.bodyId && Date.parse(row.startsAt) === Date.parse(SITTING_STARTS))
    .map(({ id }) => id)
    .sort();

/** The reconciliation alone, for the rule's boundaries: `prior` rows against `fresh` rows. */
function reconcile(prior: readonly Meeting[], fresh: readonly Meeting[], sourceName = "diligent") {
  return reconcileSuccessfulMeetingPartition({
    sourceName,
    generatedAt: NEXT_READ,
    freshMeetings: fresh,
    freshAgendaDocuments: [],
    previous: {
      formatVersion: 1,
      generatedAt: MEASURED_READ,
      counts: snapshotCounts([...prior], 0),
      sources: [],
      meetings: [...prior],
      agendaDocuments: [],
    },
  });
}

/* ── (a) the recorded case ───────────────────────────────────────────────── */

test("CARRIED-SUPERSEDE · (a) Tucson Unified's re-issued Audit Committee sitting: carried 495 yields to fresh 501, and a reader sees one meeting", async () => {
  assert.ok(TUSD, "the Tucson Unified Diligent partition is registered");
  assert.equal(
    TUSD.scope,
    "source:diligent:body:ocd-division%2Fcountry%3Aus%2Fstate%3Aaz%2Fschool_district%3Atucson_unified_district%23board",
  );
  assert.equal(`${TUSD.wiring.config.serviceBase}${TUSD.wiring.config.meetingPath}`, PORTAL);
  assert.equal(TUSD.wiring.timeZone, "America/Phoenix");

  const store = new MemoryRoutineDataStore();
  await seedMeasuredVersion(store);
  // The defect as measured: the Reader composition held the one sitting twice.
  assert.deepEqual(atTheSitting(await readerRows(store, MEASURED_READ)), ["diligent:tusd1:495", "diligent:tusd1:501"]);

  const [next] = await promoteMeetingPartitions({
    store,
    partitions: [TUSD],
    meetings: [fresh501(NEXT_READ)],
    agendaDocuments: [],
    reports: [answered(NEXT_READ, 1)],
    generatedAt: NEXT_READ,
  });
  assert.equal(next?.outcome.candidate.state, "PROMOTED", next?.outcome.candidate.failureDetail ?? "");
  const payload = next!.outcome.promoted!.payload as MeetingsSnapshot;
  assert.deepEqual(payload.meetings.map(({ id }) => id), ["diligent:tusd1:501"], "the next version has only 501");
  assert.equal(payload.meetings[0]!.carried, undefined);
  assert.deepEqual([payload.counts.fresh, payload.counts.carried, payload.counts.total], [1, 0, 1]);

  const changeSet = next!.outcome.candidate.candidate.changeSet!;
  assert.deepEqual(changeSet.removed.map(({ key }) => key), ["meeting:diligent:tusd1:495"]);
  assert.deepEqual(changeSet.added, []);
  assert.deepEqual(changeSet.changed, [], "501 is the record it was; only its read stamp moved");
  assert.deepEqual(next!.candidate.removalEvidence, [{
    key: "meeting:diligent:tusd1:495",
    code: "SUPERSEDED_BY_OCCURRENCE_IDENTITY",
    successorKey: "meeting:diligent:tusd1:501",
    priorStartsAt: SITTING_STARTS,
  }]);
  assert.equal(
    changeSet.held.some(({ code }) => code === "MEETING_UNEXPLAINED_DISAPPEARANCE_RETAINED"),
    false,
    "nothing is retained as an unexplained disappearance",
  );

  // On the reader's path: one row for the sitting, and the stated count is the rows.
  const composed = await readerRows(store, NEXT_READ);
  assert.deepEqual(atTheSitting(composed), ["diligent:tusd1:501"]);
  assert.equal(composed.counts.total, composed.meetings.length);
});

/* ── (b) no twin, no change ──────────────────────────────────────────────── */

test("CARRIED-SUPERSEDE · (b) a carried row with no fresh twin stays carried, with its reason and its last-listed instant", async () => {
  const store = new MemoryRoutineDataStore();
  const { versionId } = await seed(store, MEASURED_READ, [bondOversight502(MEASURED_READ), CARRIED_495]);

  // The portal answers again and lists another committee's sitting, not this one.
  const [next] = await promoteMeetingPartitions({
    store,
    partitions: [TUSD],
    meetings: [bondOversight502(NEXT_READ)],
    agendaDocuments: [],
    reports: [answered(NEXT_READ, 1)],
    generatedAt: NEXT_READ,
  });
  assert.equal(next?.outcome.candidate.state, "PROMOTED", next?.outcome.candidate.failureDetail ?? "");
  const payload = next!.outcome.promoted!.payload as MeetingsSnapshot;
  assert.deepEqual(payload.meetings.map(({ id }) => id).sort(), ["diligent:tusd1:495", "diligent:tusd1:502"]);
  assert.deepEqual(
    payload.meetings.find(({ id }) => id === CARRIED_495.id)?.carried,
    { source: "diligent", lastFreshAt: LAST_LISTED_495, reason: "UNEXPLAINED_DISAPPEARANCE" },
  );
  assert.deepEqual([payload.counts.fresh, payload.counts.carried, payload.counts.total], [1, 1, 2]);
  const changeSet = next!.outcome.candidate.candidate.changeSet!;
  assert.deepEqual(changeSet.removed, []);
  assert.deepEqual(next!.candidate.removalEvidence ?? [], []);
  assert.deepEqual(
    changeSet.held.filter(({ code }) => code === "MEETING_UNEXPLAINED_DISAPPEARANCE_RETAINED").map(({ key }) => key),
    ["meeting:diligent:tusd1:495"],
  );
  assert.notEqual(next!.outcome.promoted!.versionId, versionId);
});

/* ── (c) the same body at another time ───────────────────────────────────── */

test("CARRIED-SUPERSEDE · (c) the same normalized body at another local time is another sitting: both are kept", () => {
  const carriedAs = (row: Meeting) => ({ ...row, carried: CARRIED_495.carried });
  const cases: readonly { label: string; prior: Meeting; fresh: Meeting }[] = [
    {
      label: "one minute later",
      prior: CARRIED_495,
      fresh: fresh501(NEXT_READ, { startsAt: "2026-09-16T14:31:00-07:00" }),
    },
    {
      label: "the same day, another hour",
      prior: CARRIED_495,
      fresh: fresh501(NEXT_READ, { startsAt: "2026-09-16T16:30:00-07:00" }),
    },
    {
      // A date-only listing's midnight is an ordering artifact, never a time.
      label: "two date-only listings of the same day",
      prior: carriedAs({ ...CARRIED_495, startsAt: "2026-09-16T00:00:00-07:00", startPrecision: "DAY" }),
      fresh: fresh501(NEXT_READ, { startsAt: "2026-09-16T00:00:00-07:00", startPrecision: "DAY" }),
    },
    {
      // 14:30 on each row's own clock, but in two zones: an hour apart.
      label: "the same wall clock in another zone",
      prior: CARRIED_495,
      fresh: fresh501(NEXT_READ, { startsAt: "2026-09-16T14:30:00-06:00", timeZone: "America/Denver" }),
    },
  ];
  for (const { label, prior, fresh } of cases) {
    const reconciled = reconcile([prior], [fresh]);
    assert.deepEqual(reconciled.removalEvidence, [], `${label}: nothing is removed`);
    assert.deepEqual(reconciled.carriedMeetingIds, [prior.id], `${label}: the prior row is carried`);
    assert.deepEqual(reconciled.meetings.map(({ id }) => id).sort(), [prior.id, fresh.id].sort(), label);
    assert.deepEqual(
      reconciled.meetings.find(({ id }) => id === prior.id)?.carried,
      { source: "diligent", lastFreshAt: LAST_LISTED_495, reason: "UNEXPLAINED_DISAPPEARANCE" },
      label,
    );
  }
});

/* ── (d) another body at the same time ───────────────────────────────────── */

test("CARRIED-SUPERSEDE · (d) another body at the same minute is another sitting: both are kept, on every source", () => {
  // Another committee of the same board, same minute.
  const budget = budgetAdvisoryAtSameMinute(NEXT_READ);
  // Another registry body, in the same words, same minute.
  const elsewhere = fresh501(NEXT_READ, { id: "diligent:tusd1:507", bodyId: `${TUSD.bodyId}-elsewhere` });

  // A feed that gives every row one body name and names each committee only in
  // its title (the iCalendar adapter writes the wiring row's body name).
  const ical = MEETING_PARTITION_CONTRACTS.find((partition) => partition.meetingSource === "ical")!;
  const town = ical.wiring.config.bodyName ?? ical.wiring.publishingOrg;
  const townSitting = (uid: string, title: string, carried?: Meeting["carried"]): Meeting => ({
    id: `ical:${ical.wiring.config.slug}:${uid}`,
    ocdId: ical.ocdId,
    bodyId: ical.bodyId,
    bodyName: town,
    title,
    startsAt: "2026-10-06T19:00:00-04:00",
    timeZone: "America/New_York",
    location: null,
    agendaUrl: null,
    jurisdiction: ical.wiring.jurisdiction,
    status: "SCHEDULED",
    provenance: { sourceUrl: ical.wiring.config.feedUrl ?? "", sourceOrg: ical.wiring.publishingOrg, collectedAt: MEASURED_READ, verifiedAt: null },
    ...(carried ? { carried } : {}),
  });
  const planning = townSitting("planning-board@example", "Planning Board", {
    source: "ical",
    lastFreshAt: MEASURED_READ,
    reason: "UNEXPLAINED_DISAPPEARANCE",
  });
  const conservation = townSitting("conservation-commission@example", "Conservation Commission");

  for (const { label, prior, fresh, sourceName } of [
    { label: "another committee of the board", prior: CARRIED_495, fresh: budget, sourceName: "diligent" },
    { label: "another registry body", prior: CARRIED_495, fresh: elsewhere, sourceName: "diligent" },
    { label: "one body name, two committees by title", prior: planning, fresh: conservation, sourceName: "ical" },
  ]) {
    const reconciled = reconcile([prior], [fresh], sourceName);
    assert.deepEqual(reconciled.removalEvidence, [], `${label}: nothing is removed`);
    assert.deepEqual(reconciled.carriedMeetingIds, [prior.id], `${label}: the prior row is carried`);
    assert.deepEqual(reconciled.meetings.map(({ id }) => id).sort(), [prior.id, fresh.id].sort(), label);
  }
});

/* ── (e) the promotion door ──────────────────────────────────────────────── */

test("CARRIED-SUPERSEDE · (e) the promotion door re-derives the re-issue claim: the honest one promotes, a forged one is refused", async () => {
  const honest: RoutineRemovalEvidence = {
    key: "meeting:diligent:tusd1:495",
    code: "SUPERSEDED_BY_OCCURRENCE_IDENTITY",
    successorKey: "meeting:diligent:tusd1:501",
    priorStartsAt: SITTING_STARTS,
  };

  const forged: readonly { label: string; meetings: readonly Meeting[]; evidence: RoutineRemovalEvidence }[] = [
    {
      label: "a successor of another committee at the same minute",
      meetings: [fresh501(NEXT_READ), budgetAdvisoryAtSameMinute(NEXT_READ)],
      evidence: { ...honest, successorKey: "meeting:diligent:tusd1:506" },
    },
    {
      label: "a successor one minute later",
      meetings: [fresh501(NEXT_READ, { startsAt: "2026-09-16T14:31:00-07:00" })],
      evidence: honest,
    },
    {
      label: "a successor that is itself carried",
      meetings: [
        { ...fresh501(MEASURED_READ), carried: { source: "diligent", lastFreshAt: MEASURED_READ, reason: "UNEXPLAINED_DISAPPEARANCE" } },
        bondOversight502(NEXT_READ),
      ],
      evidence: honest,
    },
    {
      label: "a key this candidate does not hold",
      meetings: [fresh501(NEXT_READ)],
      evidence: { ...honest, successorKey: "meeting:diligent:tusd1:999" },
    },
    {
      label: "a start the removed record never had",
      meetings: [fresh501(NEXT_READ)],
      evidence: { ...honest, priorStartsAt: "2026-09-16T14:31:00-07:00" },
    },
  ];
  for (const { label, meetings, evidence } of forged) {
    const store = new MemoryRoutineDataStore();
    const { versionId } = await seedMeasuredVersion(store);
    const refused = await promoteMeetingPartition(store, TUSD, partitionSnapshot(NEXT_READ, meetings), [], [evidence]);
    assert.equal(refused.outcome.candidate.state, "HORIZON_UNRESOLVED", label);
    assert.equal(refused.outcome.candidate.failureCode, "REMOVAL_EVIDENCE_MISMATCH", label);
    assert.equal((await store.readPromotion("MEETING", TUSD.scope))?.versionId, versionId, `${label} moved the pointer`);
  }

  // The honest claim is exactly what the reconciliation writes, and the door accepts it.
  const store = new MemoryRoutineDataStore();
  const { snapshot: measured } = await seedMeasuredVersion(store);
  const reconciled = reconcileSuccessfulMeetingPartition({
    sourceName: TUSD.meetingSource,
    generatedAt: NEXT_READ,
    freshMeetings: [fresh501(NEXT_READ)],
    freshAgendaDocuments: [],
    previous: measured,
  });
  assert.deepEqual(reconciled.removalEvidence, [honest]);
  const accepted = await promoteMeetingPartition(store, TUSD, partitionSnapshot(NEXT_READ, reconciled.meetings), [], reconciled.removalEvidence);
  assert.equal(accepted.outcome.candidate.state, "PROMOTED", accepted.outcome.candidate.failureDetail ?? "");
  assert.equal(accepted.outcome.candidate.receipt?.checks.find(({ check }) => check === "COMPLETENESS_HORIZON_VALIDITY")?.verdict, "PASS");
  assert.deepEqual(accepted.outcome.candidate.candidate.changeSet?.removed.map(({ key }) => key), ["meeting:diligent:tusd1:495"]);
});
