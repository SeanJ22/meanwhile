// @freshness-reads-here
import { processRegisteredRoutineCandidate, type PromotionOutcome } from "../lib/civic-data/promotion.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { ZERO_RELEASE_EVENTS } from "../lib/civic-data/release.ts";
import type { RoutineRunnerReceipt } from "../lib/civic-data/runner-receipt.ts";
import { PostgresRoutineDataStore, type RoutineDataStore } from "../lib/civic-data/store.ts";
import { floored, floorLine } from "../lib/ops/denominator-floor.ts";
import { runStamp, stampFromRead } from "../lib/ops/freshness.ts";
import { isDirectModuleExecution } from "../lib/ops/main-module.ts";
import { installNeonRequestDeadline } from "../lib/ops/neon-request-deadline.ts";
import { mergeSnapshot } from "../lib/outcomes/ingest.ts";
import {
  MESA_OUTCOME_TENANT,
  legistarMinutesOutcomesCandidate,
  type OutcomeTenant,
} from "../lib/outcomes/data-plane.ts";
import { readPromotedCivicData } from "../lib/civic-data/read-model.ts";
import { inSiteTenantsFromWiring } from "../lib/sources/legistar-insite/tenant-registry.ts";
import { loadOutcomePartitionForDoor } from "../lib/doors/outcome-door-load.ts";
import { ensureMeetingDoors } from "../lib/doors/meeting-doors.ts";
import {
  applyMinutesApprovals,
  concludedSittingRows,
  minutesDocumentCheck,
  failedMinutesReadFor,
  failedMinutesSitting,
  insiteMeetingId,
  isHeldFailedExtraction,
  minutesLinkFor,
  minutesRefreshDecision,
  minutesSitting,
  notYetPublishedSitting,
  readMinutesDocument,
  sittingAfterRead,
  type MinutesDocumentIdentity,
} from "../lib/outcomes/minutes-ingest.ts";
import { readDoorOutcomeProjection } from "../lib/outcomes/store.ts";
import type { OutcomeSnapshot, PersistedSittingOutcomes } from "../lib/outcomes/types.ts";
import { rollingOutcomeWindow, type OutcomeWindow } from "../lib/outcomes/window.ts";
import { captureSourceAcquisitions, type SourceAcquisitionEvidence } from "../lib/sources/acquisition-trace.ts";
import {
  dateRangePostback,
  gridPagePostback,
  parseCalendarRows,
  parseGridNoRecords,
  parseGridPageTargets,
  parseGridPager,
  renderedRange,
  type InSiteCalendarRow,
  type InSiteRange,
} from "../lib/sources/legistar-insite/calendar.ts";
import { INSITE_SPACING_MS, InSiteSession } from "../lib/sources/legistar-insite/http.ts";
import { findTenant, type InSiteTenant } from "../lib/sources/legistar-insite/tenant-registry.ts";

/** Minutes follow a sitting by weeks (Mesa's council: about four); the window reaches back this far. */
export const MINUTES_ROUTINE_WINDOW_DAYS = 120;
/** The InSite adapter's own page budget per range (lib/sources/legistar-insite/index.ts MAX_GRID_PAGES). */
const MAX_GRID_PAGES = 6;

export interface MinutesIngestArgs {
  readonly slug: string;
  /** The door whose minutes outcomes this run reads; null for Mesa's own contract. */
  readonly door: string | null;
  readonly from: string | null;
  readonly to: string | null;
  readonly dryRun: boolean;
  readonly force: boolean;
  readonly promote: boolean;
}

export function parseMinutesIngestArgs(argv: readonly string[]): MinutesIngestArgs {
  const read = (flag: string): string | null => {
    const at = argv.indexOf(flag);
    return at >= 0 && at + 1 < argv.length ? String(argv[at + 1]) : null;
  };
  return {
    slug: read("--slug") ?? MESA_OUTCOME_TENANT.slug,
    door: read("--door"),
    from: read("--from"),
    to: read("--to"),
    dryRun: argv.includes("--dry-run"),
    force: argv.includes("--force"),
    promote: argv.includes("--promote"),
  };
}

/** Today in the body's zone back MINUTES_ROUTINE_WINDOW_DAYS; `--from`/`--to` override. */
export function minutesOutcomeWindow(
  args: Pick<MinutesIngestArgs, "from" | "to">,
  timeZone: string,
  at: Date,
): OutcomeWindow {
  return rollingOutcomeWindow(args, timeZone, at, MINUTES_ROUTINE_WINDOW_DAYS, "MINUTES_OUTCOME_WINDOW_INVALID");
}

/** The grid ranges that cover the window: this year, and last year when the window reaches into it. */
export function rangesForWindow(window: { readonly from: string; readonly to: string }): InSiteRange[] {
  return window.from.slice(0, 4) < window.to.slice(0, 4) ? ["This Year", "Last Year"] : ["This Year"];
}

/** A candidate's source-through never precedes the pointer it extends. */
export function minutesSourceThrough(prior: string | null, observed: string): string {
  if (prior === null || prior === "") return observed;
  const laterInstant = Date.parse(observed) > Date.parse(prior);
  return laterInstant && observed > prior ? observed : prior;
}

export function minutesRunnerReceiptLine(outcome: PromotionOutcome, source?: string): string {
  return "RCD_RECEIPT=" + JSON.stringify({
    source: "mesa-legistar-minutes-outcomes",
    ...(source === undefined || source === "mesa-legistar-minutes-outcomes" ? {} : { source }),
    candidateId: outcome.candidate.candidate.id,
    acquisitionSucceeded: outcome.candidate.acquisitionSucceeded,
    state: outcome.candidate.state,
    decision: outcome.candidate.receipt?.decision ?? null,
    promotedVersion: outcome.promoted?.versionId ?? null,
    lastKnownGoodVersion: outcome.candidate.lastKnownGoodVersion,
    structuralReleaseContract: ZERO_RELEASE_EVENTS,
  } satisfies RoutineRunnerReceipt);
}

const EMPTY: OutcomeSnapshot = { generatedOn: "UNKNOWN", generatedAt: "UNKNOWN", tenants: [], sittings: [] };

async function currentProjection(store: RoutineDataStore, outcome: OutcomeTenant): Promise<{ readonly snapshot: OutcomeSnapshot; readonly sourceThrough: string | null }> {
  // Mesa's own pointer keeps its reader; a door's outcomes are read from the door's own scope.
  const read = outcome.contractId === MESA_OUTCOME_TENANT.contractId
    ? await readDoorOutcomeProjection(outcome.scope, { store, bypassCache: true })
    : await readPromotedCivicData<OutcomeSnapshot>(outcome.recordClass, outcome.scope, { store, bypassCache: true });
  if (read.kind === "PROMOTED") return { snapshot: read.value, sourceThrough: read.metadata.sourceThrough };
  if (read.kind === "NOT_RECORDED") return { snapshot: EMPTY, sourceThrough: null };
  if (read.kind === "BOOTSTRAP") throw new Error("MINUTES_OUTCOME_PRODUCTION_BOOTSTRAP_FORBIDDEN");
  throw new Error(`MINUTES_OUTCOME_STORE_UNREACHABLE:${read.code}:${read.detail}`);
}

export interface MinutesIngestInput {
  readonly store: RoutineDataStore;
  readonly tenant: InSiteTenant;
  readonly args: MinutesIngestArgs;
  readonly window: { readonly from: string; readonly to: string };
  /** The outcome tenant this run extends; Mesa's own unless a door names another. */
  readonly outcomeTenant?: OutcomeTenant;
  /** The observation clock; production reads the wall clock after each read returns. */
  readonly now?: () => string;
  readonly log?: (line: string) => void;
  /** Pacing between portal requests. The vendor's `Crawl-delay: 2` in production. */
  readonly spacingMs?: number;
}

export interface MinutesIngestResult {
  readonly receiptLine: string | null;
  readonly exitCode: 0 | 2;
  readonly promotedSittings: number;
  readonly refusedSittings: readonly string[];
  readonly documentsRead: number;
  readonly notYetPublished: number;
  readonly skippedUnchanged: number;
  /** Held failed extractions whose document a cheap check found unchanged (or could not check): not downloaded. */
  readonly heldFailedExtractions: number;
}

/** The calendar grid, every range and page the window needs, as rows. */
async function readCalendar(session: InSiteSession, calendarUrl: string, ranges: readonly InSiteRange[], log: (line: string) => void): Promise<{ readonly rows: InSiteCalendarRow[]; readonly gridRendered: boolean }> {
  const rows: InSiteCalendarRow[] = [];
  let latest = (await session.get(calendarUrl, "text/html,application/xhtml+xml")).text;
  let gridRendered = parseCalendarRows(latest).length > 0 || parseGridNoRecords(latest);
  rows.push(...parseCalendarRows(latest));
  for (const range of ranges) {
    if (renderedRange(latest) !== range) {
      latest = (await session.postForm(calendarUrl, dateRangePostback(latest, range))).text;
      // A postback that did not take answers 200 with the page it already had.
      if (renderedRange(latest) !== range) {
        log(`  ${range}: the portal rendered ${JSON.stringify(renderedRange(latest))}; that range was not read`);
        continue;
      }
    }
    const found = parseCalendarRows(latest);
    gridRendered ||= found.length > 0 || parseGridNoRecords(latest);
    rows.push(...found);
    const pager = parseGridPager(latest);
    if (pager && pager.pageCount > 1) {
      let page = latest;
      for (let index = 2; index <= Math.min(pager.pageCount, MAX_GRID_PAGES); index++) {
        const target = parseGridPageTargets(page).get(index);
        if (!target) break;
        page = (await session.postForm(calendarUrl, gridPagePostback(page, target))).text;
        const walked = parseGridPager(page);
        if (!walked || walked.page !== index) break;
        rows.push(...parseCalendarRows(page));
      }
      latest = page;
    }
  }
  return { rows, gridRendered };
}

/** One bounded routine pass over one tenant's concluded sittings. */
export async function runInSiteMinutesOutcomeIngest(input: MinutesIngestInput): Promise<MinutesIngestResult> {
  const { store, tenant, args, window } = input;
  const outcomeTenant = input.outcomeTenant ?? MESA_OUTCOME_TENANT;
  const now = input.now ?? (() => new Date().toISOString());
  const log = input.log ?? ((line: string) => console.log(line));
  const writes = args.promote && !args.dryRun;
  const spacingMs = input.spacingMs ?? INSITE_SPACING_MS;
  // Late-bound, so every read goes through the acquisition trace installed for it.
  const session = new InSiteSession({ fetchImpl: (url, init) => globalThis.fetch(url, init), spacingMs });
  const calendarUrl = `https://${tenant.host}/Calendar.aspx`;
  const refusedSittings: string[] = [];
  let promotedSittings = 0;
  let documentsRead = 0;
  let notYetPublished = 0;
  let skippedUnchanged = 0;
  let heldFailedExtractions = 0;

  const current = await currentProjection(store, outcomeTenant);
  let snapshot = current.snapshot;
  let sourceThrough = current.sourceThrough;
  const held = new Map(snapshot.sittings.map((sitting) => [sitting.meetingId, sitting]));

  const persist = (candidate: {
    readonly snapshot: OutcomeSnapshot;
    readonly acquisitions: readonly SourceAcquisitionEvidence[];
    readonly retrievedAt: string;
    readonly sourceThrough: string;
    readonly failureDetail?: string;
  }): Promise<PromotionOutcome> => processRegisteredRoutineCandidate(
    store,
    outcomeTenant.contractId,
    legistarMinutesOutcomesCandidate(candidate, outcomeTenant),
    candidate.retrievedAt,
  );
  const settle = (last: PromotionOutcome): MinutesIngestResult => ({
    receiptLine: minutesRunnerReceiptLine(last, outcomeTenant.contractId),
    exitCode: last.promoted ? 0 : 2,
    promotedSittings,
    refusedSittings,
    documentsRead,
    notYetPublished,
    skippedUnchanged,
    heldFailedExtractions,
  });

  const attemptedAt = now();
  let calendarEvidence: readonly SourceAcquisitionEvidence[] = [];
  let calendar: { readonly rows: InSiteCalendarRow[]; readonly gridRendered: boolean };
  try {
    const captured = await captureSourceAcquisitions((runForSource) =>
      runForSource(outcomeTenant.sourceId, () => readCalendar(session, calendarUrl, rangesForWindow(window), log)),
    );
    calendar = captured.value;
    calendarEvidence = captured.evidence;
  } catch (error) {
    if (!writes) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    log(`${tenant.slug}: calendar acquisition failed — ${detail}`);
    return settle(await persist({ snapshot, acquisitions: [], retrievedAt: attemptedAt, sourceThrough: minutesSourceThrough(sourceThrough, attemptedAt), failureDetail: `${tenant.host} calendar acquisition failed: ${detail}` }));
  }
  const calendarAt = now();

  const sittings = concludedSittingRows(calendar.rows, tenant, window, new Date(calendarAt));
  const population = floored(
    `concluded ${tenant.bodyName} sittings for ${tenant.slug}`,
    `${calendarUrl} grid rows ${window.from}..${window.to}`,
    calendar.rows.length,
    sittings.length,
    calendar.rows.length === 0 ? "the calendar grid returned no rows; this establishes no fact about the body" : undefined,
  );
  log(`${tenant.slug}: ${sittings.length} concluded sitting(s) ${window.from}..${window.to}\n${floorLine(population)}`);

  if (!calendar.gridRendered || sittings.length === 0) {
    const detail = !calendar.gridRendered
      ? `The ${tenant.host} calendar grid did not render; a zero-row read is a failed extraction and no governmental absence is inferred.`
      : `The ${tenant.host} calendar grid named no concluded ${tenant.bodyName} sitting in ${window.from}..${window.to}; no governmental absence is inferred.`;
    if (!writes) throw new Error(`MINUTES_OUTCOME_ZERO_SITTINGS: ${detail}`);
    log(`MINUTES_OUTCOME_ZERO_SITTINGS: ${detail}`);
    return settle(await persist({ snapshot, acquisitions: calendarEvidence, retrievedAt: calendarAt, sourceThrough: minutesSourceThrough(sourceThrough, calendarAt), failureDetail: detail }));
  }

  let last: PromotionOutcome | null = null;
  /** Rows recorded "not yet published" this pass, folded into the next candidate written. */
  let pending: PersistedSittingOutcomes[] = [];
  const base = { tenant, calendarUrl };

  for (const row of sittings) {
    const meetingId = insiteMeetingId(tenant.slug, row.insiteId!);
    const link = minutesLinkFor(row, tenant.host);
    const heldSitting = held.get(meetingId);
    let decision: { readonly walk: boolean; readonly reason: string; readonly check?: MinutesDocumentIdentity } = args.force && link !== null
      ? ({ walk: true, reason: "FORCED" } as const)
      : minutesRefreshDecision(link, heldSitting, new Date(calendarAt));

    if (link === null) {
      if (heldSitting === undefined) {
        notYetPublished += 1;
        pending.push(notYetPublishedSitting({ ...base, row, observedAt: calendarAt }));
        log(`  ${meetingId} ${row.date} ${row.bodyName}: minutes not yet published ("${row.minutes.status || "empty cell"}")`);
      } else {
        if (decision.reason === "STILL_NOT_PUBLISHED") notYetPublished += 1;
        else skippedUnchanged += 1;
        if (decision.reason === "LINK_WITHDRAWN_KEPT") {
          log(`  ${meetingId}: the portal no longer links the minutes we hold; the held record is kept, not reversed`);
        }
      }
      continue;
    }

    if (!decision.walk && decision.check) {
      const failedExtraction = decision.reason === "FAILED_DOCUMENT_CHECK";
      if (!writes) {
        log(`  would check ${meetingId} ${link.url} before reading it again — held failed extraction`);
        skippedUnchanged += 1;
        continue;
      }
      const head = await session.head(link.url, link.format === "PDF" ? "application/pdf" : "text/html,application/xhtml+xml");
      const checked = minutesDocumentCheck(decision.check, head);
      log(`  ${meetingId} ${row.date} ${row.bodyName}: held failed extraction — ${checked.reason} (${checked.detail})`);
      if (!checked.walk && (failedExtraction || checked.reason === "DOCUMENT_UNCHANGED" &&
          (decision.check.etag !== null || decision.check.lastModified !== null))) {
        if (failedExtraction) heldFailedExtractions += 1;
        skippedUnchanged += 1;
        continue;
      }
      decision = { ...checked, walk: true };
    }
    if (!decision.walk) {
      skippedUnchanged += 1;
      continue;
    }
    if (!writes) {
      log(`  would read ${meetingId} ${link.url} — ${decision.reason}`);
      documentsRead += 1;
      continue;
    }

    const read = await captureSourceAcquisitions((runForSource) =>
      runForSource(outcomeTenant.sourceId, async () => {
        try {
          const fetched = await session.getBytes(link.url, link.format === "PDF" ? "application/pdf" : "text/html,application/xhtml+xml");
          return {
            bytes: fetched.bytes,
            response: { contentType: fetched.contentType, etag: fetched.etag, lastModified: fetched.lastModified },
            error: null as string | null,
          };
        } catch (error) {
          return { bytes: null, response: null, error: error instanceof Error ? error.message : String(error) };
        }
      }),
    );
    documentsRead += 1;
    const observedAt = now();
    let persisted: PersistedSittingOutcomes;
    if (read.value.bytes === null || read.value.response === null) {
      persisted = failedMinutesSitting({ ...base, row, observedAt, link, error: read.value.error ?? "unknown failure" });
    } else {
      const document = await readMinutesDocument(link, read.value.bytes);
      const readOn = stampFromRead({ source: link.url, ok: true, bytes: document.byteCount, on: runStamp(new Date(observedAt)) });
      const parsed = minutesSitting({ ...base, row, observedAt, document, readOn }).sitting;
      const fresh = parsed.minutesDocument ? { ...parsed, minutesDocument: { ...parsed.minutesDocument,
        ...read.value.response, readAt: observedAt } } : parsed;
      // A failure on the bytes is held with their identity; over verified minutes, beside them.
      persisted = sittingAfterRead(heldSitting, fresh, failedMinutesReadFor(fresh, document, read.value.response, observedAt));
    }
    const proposed = applyMinutesApprovals(mergeSnapshot(snapshot, [...pending, persisted], {
      generatedOn: observedAt.slice(0, 10),
      generatedAt: observedAt,
    }));
    // A failed request is retried soon; a held failed extraction is a named result that promotes.
    const failed = persisted.extraction === "REQUEST_FAILED" || (persisted.extraction === "ZERO_ROWS_FAILED" && !isHeldFailedExtraction(persisted));
    const outcome = await persist({
      snapshot: proposed,
      acquisitions: [...calendarEvidence, ...read.evidence],
      retrievedAt: observedAt,
      sourceThrough: minutesSourceThrough(sourceThrough, observedAt),
      ...(failed ? { failureDetail: `Sitting ${meetingId} minutes read failed: ${persisted.extractionNote}` } : {}),
    });
    last = outcome;
    if (outcome.promoted) {
      snapshot = proposed;
      sourceThrough = outcome.candidate.candidate.temporal.sourceThrough;
      held.set(meetingId, persisted);
      for (const sitting of pending) held.set(sitting.meetingId, sitting);
      pending = [];
      promotedSittings += 1;
    } else {
      refusedSittings.push(`${meetingId} (${outcome.candidate.failureCode ?? outcome.candidate.state})`);
    }
    log(
      `  ${meetingId} ${row.date} ${row.bodyName} (${decision.reason}): ${persisted.extraction}, ` +
        `${persisted.outcomes.length} recorded action(s), ${persisted.minutesDocument?.approval.state ?? "no document"} — ` +
        `${outcome.promoted ? "PROMOTED" : `HELD ${outcome.candidate.failureCode ?? outcome.candidate.state}`}`,
    );
  }

  if (!writes) {
    return { receiptLine: null, exitCode: 0, promotedSittings, refusedSittings, documentsRead, notYetPublished, skippedUnchanged, heldFailedExtractions };
  }

  if (pending.length > 0) {
    // Sittings first seen without minutes: recorded as the publisher's state.
    const observedAt = now();
    const proposed = applyMinutesApprovals(mergeSnapshot(snapshot, pending, { generatedOn: observedAt.slice(0, 10), generatedAt: observedAt }));
    const outcome = await persist({ snapshot: proposed, acquisitions: calendarEvidence, retrievedAt: observedAt, sourceThrough: minutesSourceThrough(sourceThrough, calendarAt) });
    if (outcome.promoted) {
      snapshot = proposed;
      sourceThrough = outcome.candidate.candidate.temporal.sourceThrough;
      pending = [];
    }
    last = outcome;
    log(`  ${proposed.sittings.filter((sitting) => sitting.extraction === "NOT_YET_PUBLISHED").length} sitting(s) recorded as minutes not yet published — ${outcome.promoted ? "PROMOTED" : `HELD ${outcome.candidate.failureCode ?? outcome.candidate.state}`}`);
  } else if (last === null) {
    // Every concluded sitting is held and unchanged: one validated no-change receipt.
    const observedAt = now();
    last = await persist({ snapshot, acquisitions: calendarEvidence, retrievedAt: observedAt, sourceThrough: minutesSourceThrough(sourceThrough, calendarAt) });
    log(`  no-change receipt: ${last.promoted ? "PROMOTED" : `HELD ${last.candidate.failureCode ?? last.candidate.state}`}`);
  }
  if (refusedSittings.length > 0 && last.promoted) {
    const observedAt = now();
    last = await persist({
      snapshot,
      acquisitions: calendarEvidence,
      retrievedAt: observedAt,
      sourceThrough: sourceThrough ?? calendarAt,
      failureDetail:
        `${refusedSittings.length} ${tenant.slug} minutes read(s) were refused in this run: ${refusedSittings.join("; ")}. ` +
        "Every sitting that validated is live in the canonical pointer; the refused sittings stay due for the next attempt.",
    });
    log(`  run held: ${refusedSittings.length} refused sitting(s) recorded against the moved pointer`);
  }
  return settle(last);
}

async function main(): Promise<void> {
  const args = parseMinutesIngestArgs(process.argv.slice(2));
  // Any other portal is read through the door that names it; Mesa's own contract serves only Mesa.
  if (args.door === null && args.slug !== MESA_OUTCOME_TENANT.slug) {
    throw new Error("MINUTES_OUTCOME_CONTRACT_SCOPE_MISMATCH: another portal's minutes are read through its own door (--door).");
  }
  if (!args.promote && !args.dryRun) throw new Error("MINUTES_OUTCOME_PROMOTION_REQUIRED: use --promote, or --dry-run for a read-only plan.");
  if (args.promote && args.dryRun) throw new Error("MINUTES_OUTCOME_MODE_AMBIGUOUS: --promote writes and --dry-run never does; pass exactly one.");
  installNeonRequestDeadline();
  if (args.promote) prepareProductionCivicDataWrite();
  let outcomeTenant: OutcomeTenant = MESA_OUTCOME_TENANT;
  let tenant: InSiteTenant | undefined;
  if (args.door !== null) {
    const partition = await loadOutcomePartitionForDoor(args.door);
    if (partition.kind !== "legistar-insite" || partition.tenant.slug !== args.slug) {
      throw new Error(`OUTCOME_DOOR_MISMATCH: ${args.door} is not the InSite door of ${args.slug}.`);
    }
    outcomeTenant = partition.tenant;
    tenant = inSiteTenantsFromWiring([partition.wiring])[0];
  } else {
    // Mesa's own contract: its tenant is read off the published meeting doors.
    const doors = await ensureMeetingDoors({ state: "AZ" });
    if (!doors.ready) throw new Error(`MEETING_DOORS_UNREADABLE: ${doors.reason}`);
    tenant = findTenant(args.slug);
  }
  if (!tenant) throw new Error("MINUTES_OUTCOME_TENANT_NOT_WIRED");
  const run = await runInSiteMinutesOutcomeIngest({
    store: new PostgresRoutineDataStore(),
    tenant,
    outcomeTenant,
    args,
    window: minutesOutcomeWindow(args, tenant.timeZone, new Date()),
  });
  if (run.receiptLine !== null) console.log(run.receiptLine);
  process.exitCode = run.exitCode;
}

if (isDirectModuleExecution(import.meta.url)) await main();
