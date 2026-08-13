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
import { makeApptegySource } from "../lib/sources/apptegy/index.ts";
import { makeCivicPlusSource } from "../lib/sources/civicplus/index.ts";
import { CompositeSource } from "../lib/sources/composite/index.ts";
import { buildCompositeSource } from "../lib/sources/composite/wiring.ts";
import { makeDiligentSource } from "../lib/sources/diligent/index.ts";
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
  composite: () => buildCompositeSource() as unknown as MeetingSource<never>,
};

/** How many agenda documents one ingest run will fetch. Politeness, not coverage. */
const AGENDA_RETRIEVAL_CAP = 8;

async function retrieveAgendas(meetings: Meeting[]) {
  const withAgenda = meetings.filter((m) => m.agendaUrl);
  const capped = withAgenda.slice(0, AGENDA_RETRIEVAL_CAP);
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
    await retrieveAgendas(meetings);
  } else {
    const dropped = raw.length - meetings.length;
    if (dropped > 0) {
      console.warn(`  ${dropped} record(s) dropped — unplaceable in time or space`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
