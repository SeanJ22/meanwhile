/**
 * Run one source adapter locally.
 *
 *   pnpm ingest mock
 *   pnpm ingest composite
 *
 * Adapters are looked up by directory name under lib/sources/. Adding a
 * source means adding a directory and wiring rows, never editing this file's
 * logic — only the map below gains an entry.
 *
 * `composite` additionally prints the per-child report (fetched, normalized,
 * drops split by reason, failures) and retrieves agenda documents for the
 * meetings that carry one — capped and serialized, with unchanged documents
 * skipped by content hash.
 */

import {
  agendaDocumentStore,
  retrieveAgendaDocument,
} from "../lib/meetings/agenda-documents.ts";
import {
  readSnapshot,
  writeSnapshot,
  type MeetingsSnapshot,
} from "../lib/meetings/snapshot.ts";
import { makeApptegySource } from "../lib/sources/apptegy/index.ts";
import { makeCivicPlusSource } from "../lib/sources/civicplus/index.ts";
import { CompositeSource } from "../lib/sources/composite/index.ts";
import { buildCompositeSource } from "../lib/sources/composite/wiring.ts";
import { makeDiligentSource } from "../lib/sources/diligent/index.ts";
import { makeIqm2Source } from "../lib/sources/iqm2/index.ts";
import { makeRevizeSource } from "../lib/sources/revize/index.ts";
import { legistarSource } from "../lib/sources/legistar/index.ts";
import { makeOnBaseSource } from "../lib/sources/onbase/index.ts";
import { mockSource } from "../lib/sources/mock/index.ts";
import { wiringForTypes } from "../lib/registry/source-wiring.ts";
import type { Meeting, MeetingSource } from "../lib/sources/types.ts";

const SOURCES: Record<string, () => MeetingSource<never>> = {
  mock: () => mockSource as unknown as MeetingSource<never>,
  // Everything below hits the network. Serialized and paced — see
  // lib/sources/http.ts and lib/sources/legistar/client.ts.
  legistar: () => legistarSource as unknown as MeetingSource<never>,
  civicplus: () =>
    makeCivicPlusSource(wiringForTypes(["CIVICPLUS"])) as unknown as MeetingSource<never>,
  onbase: () =>
    makeOnBaseSource(wiringForTypes(["ONBASE"])) as unknown as MeetingSource<never>,
  apptegy: () =>
    makeApptegySource(wiringForTypes(["APPTEGY"])) as unknown as MeetingSource<never>,
  diligent: () =>
    makeDiligentSource(wiringForTypes(["DILIGENT", "CIVICWEB"])) as unknown as MeetingSource<never>,
  iqm2: () =>
    makeIqm2Source(wiringForTypes(["IQM2"])) as unknown as MeetingSource<never>,
  revize: () =>
    makeRevizeSource(wiringForTypes(["REVIZE"])) as unknown as MeetingSource<never>,
  composite: () => buildCompositeSource() as unknown as MeetingSource<never>,
};

/** How many agenda documents one ingest run will fetch. Politeness, not coverage. */
const AGENDA_RETRIEVAL_CAP = 8;

async function retrieveAgendas(meetings: Meeting[]) {
  const withAgenda = meetings.filter((m) => m.agendaUrl);
  // Meetings with no stored document yet go first: the cap is politeness per
  // run, and the store is seeded from the previous snapshot, so over repeated
  // refreshes every agenda gets retrieved before any gets re-checked.
  const prioritized = [...withAgenda].sort((a, b) => {
    const aHas = agendaDocumentStore.latestFor(a.id) ? 1 : 0;
    const bHas = agendaDocumentStore.latestFor(b.id) ? 1 : 0;
    return aHas - bHas;
  });
  const capped = prioritized.slice(0, AGENDA_RETRIEVAL_CAP);
  let stored = 0;
  let revised = 0;
  let unchanged = 0;
  let failed = 0;

  for (const meeting of capped) {
    try {
      const doc = await retrieveAgendaDocument(meeting);
      if (!doc) continue;
      if (doc.extraction === "failed") {
        console.warn(
          `  agenda extraction failed for ${meeting.id}: ${doc.extractionNote}`,
        );
      }
      const result = agendaDocumentStore.append(doc);
      if (!result.stored) unchanged++;
      else {
        stored++;
        if (result.revised) revised++;
      }
    } catch (error) {
      failed++;
      console.warn(`  agenda fetch failed for ${meeting.id}: ${error}`);
    }
  }

  console.log(
    `agenda documents: ${withAgenda.length} linked, ${capped.length} fetched ` +
      `(cap ${AGENDA_RETRIEVAL_CAP}), ${stored} stored, ${revised} revisions, ` +
      `${unchanged} unchanged, ${failed} failed`,
  );
}

async function main() {
  const name = process.argv[2];

  if (!name || !(name in SOURCES)) {
    console.error(
      `Usage: pnpm ingest <source>\nKnown sources: ${Object.keys(SOURCES).join(", ")}`,
    );
    process.exitCode = 1;
    return;
  }

  const source = SOURCES[name]();

  // Continental US, wide enough to sweep everything the adapter has.
  const raw = await source.fetch({
    lat: 39.5,
    lng: -98.35,
    radiusKm: 5000,
  });

  const meetings: Meeting[] = source.normalize(raw);
  const result = await source.upsert(meetings);

  console.log(`${source.name}: ${raw.length} fetched, ${meetings.length} normalized`);
  console.log(`  inserted ${result.inserted}, updated ${result.updated}`);

  if (source instanceof CompositeSource && source.lastReport) {
    for (const child of source.lastReport.children) {
      const d = child.drops;
      console.log(
        child.ok
          ? `  ${child.source}: ${child.fetched} fetched, ${child.normalized} normalized, ` +
              `drops: ${d.unknownVenue} unknownVenue / ${d.placeless} placeless / ` +
              `${d.unplaceableInTime} unplaceableInTime / ${d.notConfigured} notConfigured`
          : `  ${child.source}: FAILED — ${child.error}`,
      );
    }

    // Seed the document store from the previous snapshot before retrieving,
    // so append-only semantics hold *across* refreshes: an unchanged agenda
    // is recognized by hash, a revised one is appended beside its prior
    // version rather than replacing it.
    const previous = readPreviousSnapshot();
    if (previous) {
      for (const doc of previous.agendaDocuments) agendaDocumentStore.append(doc);
    }

    await retrieveAgendas(meetings);
    writeMeetingsSnapshot(source, meetings, previous);
  } else {
    const dropped = raw.length - meetings.length;
    if (dropped > 0) {
      console.warn(`  ${dropped} record(s) dropped — unplaceable in time or space`);
    }
  }
}

function readPreviousSnapshot(): MeetingsSnapshot | null {
  try {
    return readSnapshot();
  } catch (error) {
    // A corrupt previous snapshot must not block a refresh that would replace
    // it — but it is said out loud, never absorbed.
    console.warn(`previous snapshot unreadable, refreshing from scratch: ${error}`);
    return null;
  }
}

/**
 * Write the committed snapshot the production app reads.
 *
 * A refresh where every source failed keeps the previous snapshot — the site
 * serves stale-but-honest data and its "last checked" line says how stale.
 * A partial failure writes the sources that succeeded and records the ones
 * that did not; the coverage notice attributes the gap to the bodies served.
 */
function writeMeetingsSnapshot(
  source: CompositeSource,
  meetings: Meeting[],
  previous: MeetingsSnapshot | null,
) {
  const report = source.lastReport;
  if (!report) {
    console.error("snapshot NOT written: composite produced no run report");
    process.exitCode = 1;
    return;
  }

  const okCount = report.children.filter((c) => c.ok).length;
  if (okCount === 0) {
    console.error(
      `snapshot NOT written: all ${report.children.length} sources failed — ` +
        (previous
          ? `keeping the previous snapshot from ${previous.generatedAt}`
          : "and no previous snapshot exists"),
    );
    process.exitCode = 1;
    return;
  }

  const meetingIds = new Set(meetings.map((m) => m.id));
  const snapshot: MeetingsSnapshot = {
    formatVersion: 1,
    generatedAt: new Date().toISOString(),
    sources: report.children.map((c) => ({
      source: c.source,
      ok: c.ok,
      error: c.error,
      fetched: c.fetched,
      normalized: c.normalized,
      drops: c.drops,
    })),
    meetings,
    // Every stored version for every meeting still on the calendar window —
    // append-only history survives the refresh; documents whose meetings have
    // aged out of the window go with them.
    agendaDocuments: meetings.flatMap((m) =>
      agendaDocumentStore.versionsFor(m.id),
    ).filter((doc) => meetingIds.has(doc.meetingId)),
  };

  const path = writeSnapshot(snapshot);
  const failedNames = snapshot.sources.filter((s) => !s.ok).map((s) => s.source);
  console.log(
    `snapshot written: ${path}\n` +
      `  ${snapshot.meetings.length} meetings from ${okCount}/${snapshot.sources.length} sources, ` +
      `${snapshot.agendaDocuments.length} agenda document version(s)` +
      (failedNames.length > 0 ? `, failed: ${failedNames.join(", ")}` : ""),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
