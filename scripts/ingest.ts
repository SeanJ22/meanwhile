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
  CONCLUDED_LOOKBACK_DAYS,
  UPCOMING_HORIZON_DAYS,
} from "../lib/meetings/constants.ts";
import {
  attributionSummary,
  resolveMeetingBodies,
} from "../lib/meetings/attribution.ts";
import { carryForward } from "../lib/meetings/carry-forward.ts";
import {
  readSnapshot,
  writeSnapshot,
  type MeetingsSnapshot,
} from "../lib/meetings/snapshot.ts";
import { makeApptegySource } from "../lib/sources/apptegy/index.ts";
import { makeCivicPlusSource } from "../lib/sources/civicplus/index.ts";
import { CompositeSource } from "../lib/sources/composite/index.ts";
import {
  SCHEDULED_REFRESH_TIMEOUT_MS,
  buildCompositeSource,
} from "../lib/sources/composite/wiring.ts";
import { makeDiligentSource } from "../lib/sources/diligent/index.ts";
import { makeIqm2Source } from "../lib/sources/iqm2/index.ts";
import { makeRevizeSource } from "../lib/sources/revize/index.ts";
import { legistarSource } from "../lib/sources/legistar/index.ts";
import { makeOnBaseSource } from "../lib/sources/onbase/index.ts";
import { mockSource } from "../lib/sources/mock/index.ts";
import registryJson from "../lib/registry/registry.json" with { type: "json" };
import { SOURCE_WIRING, wiringForTypes } from "../lib/registry/source-wiring.ts";
import type { Registry } from "../lib/registry/types.ts";
import type { Meeting, MeetingSource } from "../lib/sources/types.ts";

/*
 * The committed registry, read the same way lib/registry/server.ts reads it:
 * a build output whose JSON widens to string where the type wants a union.
 * Cast once, here, rather than at each use.
 */
const REGISTRY = registryJson as unknown as Registry;

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
  // F22: the batch budget, not the reader's. See SCHEDULED_REFRESH_TIMEOUT_MS.
  composite: () =>
    buildCompositeSource({
      timeoutMs: SCHEDULED_REFRESH_TIMEOUT_MS,
    }) as unknown as MeetingSource<never>,
};

/** How many agenda documents one ingest run will fetch. Politeness, not coverage. */
const AGENDA_RETRIEVAL_CAP = 8;

/**
 * A meeting's document URL: its own agenda link, or — for a scheduled
 * meeting with none — the body's curated notice page (4c). The notice a
 * board posts on its own site is the content a reader needs while the
 * vendor portal's agenda is still unpublished.
 */
function documentUrlFor(meeting: Meeting): string | null {
  if (meeting.agendaUrl) return meeting.agendaUrl;
  if (meeting.status !== "SCHEDULED") return null;
  const wired = SOURCE_WIRING.find(
    (row) => row.noticeUrl && row.ocdId !== null && row.ocdId === meeting.ocdId,
  );
  return wired?.noticeUrl ?? null;
}

async function retrieveAgendas(meetings: Meeting[]) {
  const withAgenda = meetings.filter((m) => documentUrlFor(m));
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
      const url = documentUrlFor(meeting);
      const doc = await retrieveAgendaDocument(
        meeting,
        url && url !== meeting.agendaUrl ? { urlOverride: url } : {},
      );
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
  //
  // The window is stated (M58, 2026-08-15). It used to be omitted, which read
  // as "give me everything" and meant something else entirely to any adapter
  // whose upstream defaults to upcoming-only: Apptegy quietly returned the
  // future alone, so Vail and Rockaway Township's school board could never
  // show a concluded meeting and nothing in the run said so. The window is
  // the app's own cascade window, so the snapshot holds exactly what a reader
  // can be shown and no more.
  const now = Date.now();
  const raw = await source.fetch({
    lat: 39.5,
    lng: -98.35,
    radiusKm: 5000,
    startsAfter: new Date(
      now - CONCLUDED_LOOKBACK_DAYS * 86_400_000,
    ).toISOString(),
    startsBefore: new Date(
      now + UPCOMING_HORIZON_DAYS * 86_400_000,
    ).toISOString(),
  });

  const meetings: Meeting[] = resolveAttribution(source.normalize(raw));
  const result = await source.upsert(meetings);

  console.log(`${source.name}: ${raw.length} fetched, ${meetings.length} normalized`);
  console.log(`  inserted ${result.inserted}, updated ${result.updated}`);

  if (source instanceof CompositeSource && source.lastReport) {
    for (const child of source.lastReport.children) {
      const d = child.drops;
      console.log(
        child.ok
          ? `  ${child.source}: ${child.fetched} fetched, ${child.normalized} normalized, ` +
              `drops: ${d.unknownVenue} unknownVenue / ${d.unplaceableInTime} unplaceableInTime / ` +
              `${d.notConfigured} notConfigured` +
              // D18: `placeless` is no longer a drop — those meetings are KEPT,
              // with no place and no pin. Printing it under "drops" would say
              // the opposite of what the run did.
              `, kept online: ${d.placeless}`
          : // F22: the two kinds of nothing, told apart in the line a human
            // reads. A wall names the rung it stopped at and costs the run
            // nothing; a JOB failure is our code and turns the run red.
            `  ${child.source}: ${child.failure === "JOB" ? "JOB FAILURE" : "WALLED"} — ${child.error}`,
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

/**
 * Name the bodies an adapter's agenda segmentation could only describe (D19).
 *
 * The adapters are pure and the registry is a file, so segmentation happens
 * where the agenda is and NAMING happens here, once, where the registry is
 * already loaded. Every row arrives UNRESOLVED with its published heading
 * intact; this upgrades the ones the registry can account for and leaves the
 * rest exactly as they are — `bodyId: null`, `ocdId: null`, never the host's.
 *
 * The counts are printed with their denominator, because an unresolved
 * segment is a WORK ITEM: it is usually a special district reachable through
 * a county feed that this repo holds no division for, which is the whole
 * reason D19 exists, and a number nobody prints is a number nobody chases.
 */
function resolveAttribution(meetings: Meeting[]): Meeting[] {
  const withAgenda = meetings.filter((m) => m.actingBodies !== undefined);
  if (withAgenda.length === 0) {
    console.log(
      `attribution: 0 of ${meetings.length} meetings had their agenda items read — ` +
        "no source in this run publishes them, so nothing is claimed about who acted",
    );
    return meetings;
  }

  const divisionLabels = new Map(
    REGISTRY.divisions.map((d) => [d.ocdId, d.label] as const),
  );
  const resolved = meetings.map((m) =>
    m.actingBodies === undefined
      ? m
      : {
          ...m,
          actingBodies: resolveMeetingBodies(
            m.actingBodies,
            REGISTRY.bodies,
            divisionLabels,
            m.ocdId,
          ),
        },
  );

  const rows = resolved.flatMap((m) => m.actingBodies ?? []);
  const summary = attributionSummary(rows);
  console.log(
    `attribution: ${withAgenda.length} of ${meetings.length} meetings had their agenda ` +
      `items read, producing ${rows.length} acting-body row(s) — ` +
      `${summary.host} host, ${summary.resolved} resolved, ${summary.unresolved} unresolved ` +
      `(${summary.itemsUnattributed} item(s) attributed to nobody, which is the honest answer ` +
      "and a work item, never the host)",
  );
  for (const row of rows.filter((r) => r.attribution === "UNRESOLVED")) {
    console.log(`  unresolved: "${row.evidence}" — ${row.itemCount} item(s)`);
  }
  return resolved;
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
 * that did not; the coverage notice attributes the gap to the bodies served,
 * and `carryForward` (lib/meetings/carry-forward.ts — the refresh corollary)
 * keeps those bodies' last known sittings on screen rather than blanking them.
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

  const now = new Date();
  const { meetings: served, carried } = carryForward(
    report.children,
    meetings,
    previous,
    now,
  );

  const meetingIds = new Set(served.map((m) => m.id));
  // Both numbers, stated (hotfix-0817). `fresh` is what this run retrieved and
  // `carried` is what it could not — counted off the marks the rows actually
  // carry, never off the difference between two other numbers, because a
  // count derived from an assumption stops being true when the assumption
  // grows a new case. `validateSnapshot` refuses the file if they disagree.
  const carriedRows = served.filter((m) => m.carried).length;
  const snapshot: MeetingsSnapshot = {
    formatVersion: 1,
    generatedAt: now.toISOString(),
    counts: {
      // `meetings` is this run's own normalized output, not a subtraction.
      fresh: meetings.length,
      carried: carriedRows,
      total: served.length,
    },
    sources: report.children.map((c) => ({
      source: c.source,
      ok: c.ok,
      error: c.error,
      ...(c.ok ? {} : { failure: c.failure ?? "WALL" }),
      // The rung travels with its ladder, or it travels as an unmarked number
      // that a later session has to go back and mark (RULING 17).
      ...(typeof c.walledAtRung === "number"
        ? {
            walledAtRung: c.walledAtRung,
            rungProvenance: c.rungProvenance ?? ("CANONICAL" as const),
          }
        : {}),
      fetched: c.fetched,
      normalized: c.normalized,
      drops: c.drops,
      ...(c.unreachableOcdIds && c.unreachableOcdIds.length > 0
        ? { unreachableOcdIds: c.unreachableOcdIds }
        : {}),
      ...(carried.has(c.source) ? { carriedForward: carried.get(c.source) } : {}),
    })),
    meetings: served,
    // Every stored version for a meeting still on the calendar window, plus
    // the versions a CARRIED meeting already had — a carried sitting that
    // lost its agenda would be a second, quieter kind of emptying.
    agendaDocuments: [
      ...served.flatMap((m) => agendaDocumentStore.versionsFor(m.id)),
      ...(previous?.agendaDocuments ?? []),
    ].filter(
      (doc, i, all) =>
        meetingIds.has(doc.meetingId) &&
        all.findIndex((d) => d.id === doc.id) === i,
    ),
  };

  const path = writeSnapshot(snapshot);
  const failedNames = snapshot.sources.filter((s) => !s.ok).map((s) => s.source);
  const carriedTotal = [...carried.values()].reduce((a, b) => a + b, 0);
  console.log(
    `snapshot written: ${path}\n` +
      `  ${snapshot.meetings.length} meetings from ${okCount}/${snapshot.sources.length} sources, ` +
      `${snapshot.agendaDocuments.length} agenda document version(s)` +
      (failedNames.length > 0 ? `, failed: ${failedNames.join(", ")}` : ""),
  );
  // Stated with its denominator, always — a deliberate zero must not read as
  // a failure and a real carry must not read as a fresh retrieval.
  console.log(
    carriedTotal > 0
      ? `  ${carriedTotal} meeting(s) CARRIED FORWARD from ${previous?.generatedAt} for ` +
          `${[...carried.entries()].map(([s, n]) => `${s}:${n}`).join(", ")} — ` +
          "their sources were unreachable this run; nothing about them claims to be freshly checked"
      : "  0 meetings carried forward — every source that serves a body was reachable",
  );
  // The reconciliation, printed where the job's log will show it (hotfix-0817): the
  // two numbers this file counts and the one it states, side by side.
  console.log(
    `  counts: ${snapshot.counts.fresh} fresh + ${snapshot.counts.carried} carried = ` +
      `${snapshot.counts.total} total`,
  );

  /**
   * THE RUN SUMMARY, printed every time, with every denominator (F22 item 2,
   * 2026-08-20).
   *
   * Four numbers and they are not interchangeable: how many sources this run
   * ASKED, how many it READ, how many were WALLED, and how many rows it
   * WROTE. Stated unconditionally, because a line that only appears when
   * something is wrong makes a healthy run unreadable and a zero ambiguous —
   * the same discipline the carried-forward count already follows.
   *
   * The exit status below reflects the SECOND condition only. A walled vendor
   * does not turn this run red: ten healthy sources must still commit their
   * fresh data, which is exactly what did not happen between 2026-08-18 and
   * 2026-08-20. What does turn it red is our own code breaking, and a run
   * that read nothing at all — a job failure wearing a wall's clothes.
   */
  const walled = snapshot.sources.filter((s) => !s.ok && s.failure !== "JOB");
  const jobFailed = snapshot.sources.filter((s) => !s.ok && s.failure === "JOB");
  console.log(
    `  RUN SUMMARY: ${snapshot.sources.length} source(s) attempted, ` +
      `${okCount} read, ${walled.length} walled, ${jobFailed.length} job-failed, ` +
      `${snapshot.meetings.length} row(s) written` +
      (walled.length > 0
        ? `\n  WALLED (named, skipped, rows carried; the run continues): ` +
          walled
            .map(
              (s) =>
                `${s.source} [stopped at ladder rung ` +
                `${typeof s.walledAtRung === "number" ? s.walledAtRung : "unrecorded"}] — ${s.error}`,
            )
            .join("; ")
        : ""),
  );

  if (jobFailed.length > 0) {
    console.error(
      `refresh FAILED: ${jobFailed.length} source(s) failed for a job reason, not a wall — ` +
        jobFailed.map((s) => `${s.source}: ${s.error}`).join("; "),
    );
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
