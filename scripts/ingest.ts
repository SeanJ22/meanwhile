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
import { agendaItems } from "../lib/routing/agenda-search.ts";
import {
  EXIT_NOTHING_WRITTEN,
  EXIT_WRITTEN_WITH_JOB_FAILURES,
} from "../lib/meetings/refresh-exit.ts";
import {
  readSnapshot,
  snapshotCounts,
  writeSnapshot,
  type MeetingsSnapshot,
} from "../lib/meetings/snapshot.ts";
import { makeApptegySource } from "../lib/sources/apptegy/index.ts";
import { makeCivicPlusSource } from "../lib/sources/civicplus/index.ts";
import {
  CompositeSource,
  collapseDuplicateSittings,
} from "../lib/sources/composite/index.ts";
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
  /*
   * **THE NOTICE PAGE BELONGS TO A BODY, NOT TO A DIVISION** (NH Hunt 4,
   * 2026-08-21).
   *
   * This used to take the FIRST wiring row on the meeting's division that
   * carried a notice URL. That was harmless while one division had one wired
   * body and became a wrong document the moment a division had two: adding the
   * Lake Todd Village District to Newbury's division attached Lake Todd's
   * notice page to the Town of Newbury's own meetings, and the ingest went and
   * fetched it for them. A collapsing join, exactly the D40 shape — one key
   * standing in for many rows.
   *
   * So the body is matched first, by the name the wiring itself publishes. The
   * division-wide fallback survives, because a town whose boards all share one
   * calendar page is the common case and it is correct — but only when every
   * notice URL on that division AGREES. Where they disagree, there is no
   * single right answer and this returns nothing rather than picking one.
   */
  const onDivision = SOURCE_WIRING.filter(
    (row) => row.noticeUrl && row.ocdId !== null && row.ocdId === meeting.ocdId,
  );
  if (onDivision.length === 0) return null;
  const forBody = onDivision.find(
    (row) => (row.config.bodyName ?? row.publishingOrg) === meeting.bodyName,
  );
  if (forBody) return forBody.noticeUrl ?? null;
  const distinct = new Set(onDivision.map((row) => row.noticeUrl));
  return distinct.size === 1 ? (onDivision[0].noticeUrl ?? null) : null;
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
  /* Documents refused as landing pages — stated, never silently dropped. */
  let landingPages = 0;
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
      /*
       * **A LANDING PAGE IS NOT AN AGENDA, AND THE CORPUS PROVES IT 56 TIMES
       * OUT OF 56.** (2026-08-27.)
       *
       * Measured across the committed snapshot: of 198 agenda documents, 56
       * share a URL with another meeting, and NOT ONE of those 56 yields a
       * single agenda item. Of the 142 documents on a URL of their own, 67
       * (47%) do. The shared class has never once given a reader an agenda —
       * it inflates `documentsHeld`, and it is what put the Town of
       * Bradford's calendar on fourteen Newbury meetings.
       *
       * The producers are two: an adapter setting `agendaUrl` to a portal
       * ROOT (Vail's Highbond, Tucson Unified's board page), and the
       * division-wide notice-URL fallback in `documentUrlFor` (Bradford's and
       * Warner's town calendars). Both end at the same place — the body's own
       * meetings page, stored as though it were one sitting's agenda.
       *
       * So the rule is drawn where the evidence is, and no wider: a document
       * is refused when it BOTH extracts no agenda item AND is already stored
       * against a different meeting. A genuine shared agenda — two bodies
       * meeting jointly under one document — yields items and is kept. The
       * meeting keeps its own `agendaUrl` either way, so the reader can still
       * follow the link; we simply stop calling it an agenda we hold.
       */
      const alreadyOnAnotherMeeting = agendaDocumentStore.isUrlOnAnotherMeeting(
        doc.documentUrl,
        doc.meetingId,
      );
      if (alreadyOnAnotherMeeting && agendaItems(doc.text).length === 0) {
        landingPages++;
        continue;
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
      `${unchanged} unchanged, ${landingPages} landing page(s) refused, ${failed} failed`,
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
      /*
       * **A CARRIED-FORWARD DOCUMENT IS RE-CHECKED, BECAUSE A WIRING ERROR
       * OTHERWISE BECOMES PERMANENT.** (2026-08-27.)
       *
       * Seeding the store from the previous snapshot is what makes append-only
       * semantics hold across refreshes, and it also means a document attached
       * under a wiring error survives every later run — the wiring is corrected,
       * the ingest never looks again, and the wrong document is carried forever.
       *
       * That is not hypothetical. On 2026-08-21 fourteen NEWBURY meetings were
       * given `bradfordnh.gov/pages/calendar` — the Town of BRADFORD's own
       * calendar, which names Bradford Town Hall and Bradford's boards and does
       * not mention Newbury anywhere — some carrying `sourceOrg: "Newbury
       * Conservation Commission"`. Newbury's wiring rows carry no notice URL at
       * all today, so the error is already fixed at the source and the data
       * still says otherwise.
       *
       * The test applied here is the one that cannot be wrong: **a document
       * attached to meetings of MORE THAN ONE GOVERNMENT is nobody's agenda.**
       * One page cannot be two governments' agenda under any circumstances, so
       * dropping it loses nothing true. A page shared across sittings of ONE
       * body is a landing page and is a separate question (NH255) — it is left
       * alone here, because it is at least that body's own page.
       *
       * Dropped rather than kept-and-flagged: the store is append-only, so a
       * row that stays gets re-appended by every later run.
       */
      const govOf = new Map(previous.meetings.map((m) => [m.id, m.ocdId ?? null]));
      const govsByUrl = new Map<string, Set<string>>();
      for (const doc of previous.agendaDocuments) {
        const gov = govOf.get(doc.meetingId);
        if (!gov) continue;
        const set = govsByUrl.get(doc.documentUrl) ?? new Set<string>();
        set.add(gov);
        govsByUrl.set(doc.documentUrl, set);
      }

      let carried = 0;
      let refused = 0;
      const refusedUrls = new Set<string>();
      for (const doc of previous.agendaDocuments) {
        if ((govsByUrl.get(doc.documentUrl)?.size ?? 0) > 1) {
          refused++;
          refusedUrls.add(doc.documentUrl);
          continue;
        }
        agendaDocumentStore.append(doc);
        carried++;
      }
      console.log(
        `  agenda documents carried forward: ${carried} of ${previous.agendaDocuments.length}`,
      );
      if (refused > 0) {
        console.warn(
          `  ${refused} REFUSED — attached to meetings of more than one government, ` +
            `so they are nobody's agenda: ${[...refusedUrls].join(", ")}`,
        );
      }
    }

    await retrieveAgendas(meetings);
    writeMeetingsSnapshot(source, meetings, previous);
    forceJobFailureIfDispatchedProof();
  } else {
    const dropped = raw.length - meetings.length;
    if (dropped > 0) {
      console.warn(`  ${dropped} record(s) dropped — unplaceable in time or space`);
    }
  }
}

/**
 * THE NH31 PROOF HARNESS — dispatch-only, data-free, and loud. (2026-08-21.)
 *
 * NH31's fix has two halves that only exist in the seam between this script
 * and its workflow: the ingest must exit 2 rather than 1 when a snapshot was
 * written despite a job failure, and the workflow must carry that run all the
 * way to its commit before failing it. Neither half is exercised by a healthy
 * run, and the unhealthy run that would exercise them arrives when a vendor
 * breaks — which is to say, when nobody is watching and it is too late to
 * discover the handling was wrong.
 *
 * The two-consecutive detector in job-watch.yml has the same problem one
 * layer up. RULING 56 says a scheduled job that fails twice opens a Needs
 * Sean row. Proving that meant waiting for two real failures in a row.
 *
 * So a run can be asked to fail on purpose. What this does NOT do is as
 * important as what it does:
 *
 *   - It runs only on a workflow_dispatch. The workflow passes
 *     WTP_INGEST_DISPATCHED, and a scheduled run passes "false", so the cron
 *     path cannot reach this however the other variable is set.
 *   - It changes NO data. It runs AFTER the snapshot is written and never
 *     touches it, the sources array, the meetings, or the document store. The
 *     file on disk after a forced run is byte-identical to the file after the
 *     same run unforced.
 *   - It fabricates no source and records no failure anywhere durable. The
 *     failure exists in this process's exit code and in the log line below,
 *     and nowhere else. Nothing downstream can mistake it for a real vendor
 *     failure, because there is nothing downstream to mistake.
 *   - It says what it is, in the log, in the words a reader of that log
 *     needs. A synthetic failure that looked like a real one would be worse
 *     than no proof at all.
 *
 * The fabrication prohibition in the transparency mandate is about claims
 * that reach a reader or a record. This reaches neither; it is a test input
 * to our own scheduler, declared as one on every line it prints.
 */
function forceJobFailureIfDispatchedProof(): void {
  const asked = process.env.WTP_INGEST_FORCE_JOB_FAILURE === "true";
  if (!asked) return;

  if (process.env.WTP_INGEST_DISPATCHED !== "true") {
    console.error(
      "WTP_INGEST_FORCE_JOB_FAILURE was set on a run that is NOT a " +
        "workflow_dispatch. Refusing it: this input exists to prove the " +
        "scheduler's failure handling on demand, and a scheduled run that " +
        "could trip it would be an alarm nobody could trust. Ignored; the " +
        "run's real exit code stands.",
    );
    return;
  }

  console.error("");
  console.error("=== SYNTHETIC JOB FAILURE (NH31 PROOF HARNESS) ===");
  console.error(
    "This failure is FORCED by WTP_INGEST_FORCE_JOB_FAILURE on a dispatched " +
      "run. No vendor failed. No source failed. The snapshot written above is " +
      "unchanged by this and is exactly what an unforced run would have " +
      "produced.",
  );
  console.error(
    `Exiting ${EXIT_WRITTEN_WITH_JOB_FAILURES} so the workflow carries this run through its ` +
      "gate and its commit and THEN reports it failed — which is the NH31 " +
      "fix, and the thing being proved.",
  );
  console.error("=== END SYNTHETIC JOB FAILURE ===");
  console.error("");
  process.exitCode = EXIT_WRITTEN_WITH_JOB_FAILURES;
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
    process.exitCode = EXIT_NOTHING_WRITTEN;
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
    process.exitCode = EXIT_NOTHING_WRITTEN;
    return;
  }

  const now = new Date();
  const { meetings: served, carried } = carryForward(
    report.children,
    meetings,
    previous,
    now,
  );

  /*
   * **THE MERGE RUNS AGAIN AFTER CARRY-FORWARD, BECAUSE CARRY-FORWARD CAN PUT
   * A DUPLICATE BACK.** (NH Hunt, 2026-08-20.)
   *
   * The composite collapses cross-source duplicates at merge time, and then
   * this runs: a source that was refused THIS run has its last known rows
   * restored from the previous snapshot — rows the merge never saw. Newbury's
   * Conservation Commission proved it in one refresh. Its `schedulepage` route
   * was refused, three of its sittings were carried forward, and the `ical`
   * route had freshly produced the same three. Nine duplicates were collapsed
   * and three walked back in behind them, onto the reader's page.
   *
   * Same function, same key, and the informativeness ordering already prefers
   * a fresh row over a carried one at equal detail — so a carried row survives
   * only when it carries an agenda the fresh row does not, which is the
   * correct outcome and not an accident.
   */
  const afterCarry = collapseDuplicateSittings(served);
  const finalRows = afterCarry.rows;

  const meetingIds = new Set(finalRows.map((m) => m.id));
  // Both numbers, stated (hotfix-0817). `fresh` is what this run retrieved and
  // `carried` is what it could not — counted off the marks the rows actually
  // carry, never off the difference between two other numbers, because a
  // count derived from an assumption stops being true when the assumption
  // grows a new case. `validateSnapshot` refuses the file if they disagree.
  //
  // The carried/fresh/total three moved into `snapshotCounts` (NJ Hunt 3 item
  // 1b) so all three read off `finalRows` and cannot be pointed at a different
  // array. `collapsedTotal` stays here: it is the one number the survivors
  // cannot yield, being a count of rows that are no longer among them.
  const freshDroppedAfterCarry = afterCarry.dropped.filter((m) => !m.carried).length;
  const collapsedTotal = report.duplicateSittingsCollapsed + freshDroppedAfterCarry;
  const snapshot: MeetingsSnapshot = {
    formatVersion: 1,
    generatedAt: now.toISOString(),
    /*
     * ONE array in, four counts out (NJ Hunt 3 item 1b, 2026-08-22).
     *
     * This was an inline object, and `total` was `served.length` — the array
     * from BEFORE `collapseDuplicateSittings` on the line above — while
     * `meetings:` below is written from `finalRows`, the array after it. Equal
     * on every run where that pass drops nothing, which is almost every run.
     * Refresh #43 was the first where carry-forward put duplicates back: six
     * rows collapsed, and `reconcileCounts` refused the snapshot on `states
     * 461 total meetings but holds 455`. The refusal was correct. The
     * arithmetic handed to it was not.
     *
     * `snapshotCounts` takes only the rows that go into the file, so `total`
     * and `fresh` cannot be measured against a different array again. The
     * merge count is still passed in — it is the one number that cannot be
     * recovered from the survivors, which is exactly why it has to be stated.
     */
    counts: snapshotCounts(finalRows, collapsedTotal),
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
      /*
       * Recounted off the rows that SURVIVED the second merge, not off what
       * carry-forward set out to restore. `validateSnapshot` asserts this
       * equals the marks actually in the file, and a carried row the merge
       * then dropped as a duplicate would have made the two disagree.
       */
      ...(carried.has(c.source)
        ? {
            carriedForward: finalRows.filter((m) => m.carried?.source === c.source)
              .length,
          }
        : {}),
    })),
    meetings: finalRows,
    // Every stored version for a meeting still on the calendar window, plus
    // the versions a CARRIED meeting already had — a carried sitting that
    // lost its agenda would be a second, quieter kind of emptying.
    agendaDocuments: [
      ...finalRows.flatMap((m) => agendaDocumentStore.versionsFor(m.id)),
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
    /*
     * NH31 (2026-08-21) — A SINGLE SOURCE'S JOB FAILURE MAY NOT THROW AWAY
     * EVERY OTHER SOURCE'S WORK.
     *
     * This used to be exit 1, which is the same code the two paths above use
     * for "no snapshot was written at all". The caller could not tell them
     * apart, so the workflow treated both as a dead run and stopped before
     * its commit step — with a perfectly good snapshot sitting on disk. Run
     * 32485680324 is the shape in one line: 10 of 11 sources read, 330 rows
     * WRITTEN, one source job-failed, and nothing committed.
     *
     * That is survivable at eleven sources and arithmetically fatal at
     * national volume. The per-source job-failure rate implied by 14 failed
     * runs of 37 over eight days is 1 - 0.622^(1/11) = 0.042, and
     * (1 - 0.042)^5000 = 3e-94. A refresh that commits only when every one
     * of five thousand sources is healthy never commits again, and the
     * corpus stops growing while every run stays honestly red.
     *
     * So the two outcomes get two codes. EXIT_NOTHING_WRITTEN keeps its
     * meaning — do not commit, there is nothing to commit. This one says the
     * opposite: the snapshot IS on disk, it IS better than what is committed,
     * and the caller must commit it and THEN go red. The run still fails, a
     * human is still told, and the named source is still named. What changes
     * is that the good data survives the bad source, which is the
     * per-body-isolation rule (CLAUDE.md, the refresh corollary) applied one
     * layer up: there it was one host's refusal emptying another host's
     * bodies, here it is one source's broken parser discarding ten sources'
     * fresh rows.
     *
     * RULING 12 is unchanged and is the reason this stays red at all: a JOB
     * failure is our stopwatch running out, not a wall, and it may never be
     * compiled into a skip. Committing the survivors is not skipping it.
     */
    console.error(
      `  PARTIAL PROGRESS IS ON DISK AND MUST BE COMMITTED: ` +
        `${snapshot.meetings.length} row(s) from ${okCount} of ` +
        `${snapshot.sources.length} source(s) were written before this failure. ` +
        `Exiting ${EXIT_WRITTEN_WITH_JOB_FAILURES} (not ${EXIT_NOTHING_WRITTEN}) so the caller ` +
        `commits them and then reports this run as failed (NH31).`,
    );
    process.exitCode = EXIT_WRITTEN_WITH_JOB_FAILURES;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
