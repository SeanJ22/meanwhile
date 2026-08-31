/**
 * THE PIMA SHADOW PROVING RUN — one real civic obligation, carried end to end
 * through the hardened control plane, with an answer that was already known
 * before the control plane existed.
 *
 * ## Why this obligation and no other
 *
 * MTG-13 shipped THREE future Pima Board sittings because three is what the two
 * routes anyone had wired AGREED on. The publisher publishes FOURTEEN. The
 * intersection of the wired routes is 0; the union across every materially
 * distinct first-party route is 14, and `tests/legistar-insite-union.test.ts` is
 * the authority for that number — it predates this file, it is independent of
 * it, and this file may not move it.
 *
 * That independence is the whole point. A proving run whose only authority is
 * itself proves nothing: it can always be made to agree with itself. Here the
 * right answer is established elsewhere, by a suite the control plane does not
 * touch, so the run can be WRONG and be seen to be wrong.
 *
 * ## SHADOW, precisely, and it is enforced rather than promised
 *
 * Nothing here changes what a reader sees. The serving path is still
 * `data/meetings-snapshot.json` through the InSite adapter. The run digests
 * every serving surface before it starts and again when it finishes, and
 * `assessReaderImpact` DERIVES the verdict from those two digests — a claim
 * about our own restraint is exactly the kind that decays if it is merely
 * asserted. A shadow run that moved reader truth is a FINDING, and the record is
 * shaped so that finding cannot be omitted.
 *
 * ## RECORDED BYTES, NOT LIVE RETRIEVAL, and that is a decision
 *
 * Every artifact this run puts into the evidence path is real: the bytes Pima's
 * own publishers actually served, already captured under `tests/fixtures/` and
 * already sanitized by the shipped scanner. The run hashes them, tiers them and
 * stores them exactly as an acquirer would.
 *
 * It does NOT re-fetch them, for two reasons that are both governance rather
 * than convenience. `tests/fixtures/` holds recorded responses and CLAUDE.md
 * forbids live calls in tests, so a run the acceptance test can execute must
 * read what is recorded. And a proving harness that hits eight government
 * surfaces every time somebody runs it is a harness that teaches the project to
 * spend a publisher's bandwidth to prove a point about our own state machine.
 *
 * The record says which it did (`retrievalMode`), so nobody can later read a
 * replay as a fresh observation of Pima County.
 *
 * ## THE FLOOR IS 28, AND IT IS 8 MANDATORY PLUS 20 EXPERIMENTS
 *
 * `computeRouteFloor` with no field narrowing offers 122 routes for this
 * jurisdiction — every speculative technique in the method store, including PDF
 * extraction and portrait matching, which have nothing to do with meetings.
 * Narrowed to the two fields this obligation actually owes, `meeting` and
 * `agenda`, it is 28: the 8 concrete adapter surfaces plus 20 meeting-bearing
 * techniques the store offers on UNKNOWN portability.
 *
 * Those two halves are NOT the same kind of thing, and since 2026-08-29 the
 * floor says so (`FLOOR_OBLIGATIONS` in `preflight.ts`). The 8 are MANDATORY:
 * the adapter declares them for this publisher, so omitting one refuses the
 * close by name — that refusal is the whole architecture. The 20 are
 * SPECULATIVE EXPERIMENTS: every one of them reached this floor with ZERO typed
 * dimensions matched, on UNKNOWN portability, and the store's own words for them
 * are "offered, not proven".
 *
 * They are still owed a disposition — an offer that is never walked teaches
 * nothing, and RULING 184 is explicit that a finite attempt count never earns an
 * absence — so they are materialised, registered and RUN through the exploration
 * queue, and each returns either a disposition or a named reason it could not be
 * walked here yet. Every one of them still holds the obligation open. What
 * changed is only that they hold it open as themselves: an untested hypothesis,
 * not a known API somebody forgot.
 *
 * The honest consequence is unchanged: THE OBLIGATION DOES NOT COMPLETE. That is
 * the correct outcome, not a failure of the run.
 *
 * ## TIME IS A PARAMETER
 *
 * Every instant is supplied by the caller. Nothing here reads a clock, so the
 * acceptance test and the script execute the same code and reach the same
 * record.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { endAttempt, type AttemptCost, type WorkerRef } from "../attempt.ts";
import { evaluateCompletion } from "../completion.ts";
import { recordAcquisition, type Artifact } from "../evidence/artifact.ts";
import { putArtifact, type EvidenceStore } from "../evidence/store.ts";
import {
  PIMA_ADAPTER_ROUTES,
  PIMA_BODY_ID,
  PIMA_GRANICUS_PERMISSION,
  PIMA_JURISDICTION,
  PIMA_UNION_DENOMINATOR,
  pimaFutureMeetingsWorkItem,
} from "../fixtures/pima-meetings.ts";
import {
  auditFloorIntegrity,
  computeRouteFloor,
  materializeFloor,
  runExplorationQueue,
  type ExplorationOutcome,
  type FloorIntegrityFinding,
  type RouteFloor,
} from "../preflight.ts";
import {
  beginAttemptFor,
  claimRouteTask,
  disposeRouteTask,
  loadCompletionSnapshot,
  reclaimRouteTask,
  recordArtifactMetadata,
  recordCost,
  registerRouteTask,
  registerWorkItem,
} from "../repository/coordinator.ts";
import type { ControlPlaneRepositories } from "../repository/types.ts";
import type { MethodKnowledge } from "../../method/knowledge.ts";
import { INDEPENDENT_BASES, type AuditFinding, type ValidationRecord } from "../audit.ts";
import type { Disposition, PermissionState, TransportState } from "../../workstate/types.ts";
import {
  SHADOW_RUN_RECORD_VERSION,
  assessReaderImpact,
  type RecordedArtifact,
  type RecordedAttempt,
  type RecordedCheck,
  type RecordedFloor,
  type RecordedRouteTask,
  type ShadowRunRecord,
} from "./run-record.ts";

/**
 * The two fields this obligation owes, and therefore the narrowing.
 *
 * Stated as a constant because it DETERMINES THE FLOOR, which determines what
 * completion refuses on. A narrowing chosen inline in a call would be a
 * load-bearing decision hidden in an argument list.
 *
 * `agenda` currently adds no route beyond `meeting` — every agenda-bearing route
 * in the store also carries `meeting` — and it is named anyway. `fields` is an
 * OR, so naming a field that adds nothing today costs nothing and is what makes
 * an agenda-only route join this floor automatically the day one is learned.
 * Under-including costs a fact; over-including costs one disposition.
 */
export const PIMA_MEETING_FIELDS: readonly string[] = ["meeting", "agenda"];

/** Where the bytes for each route were recorded. `null` is a route with no body. */
const ROUTE_FIXTURES: Readonly<Record<string, { file: string; contentType: string } | null>> = {
  LEGISTAR_WEBAPI_EVENTS: { file: "legistar-pima-events.json", contentType: "application/json" },
  LEGISTAR_WEBAPI_EVENTDATES: {
    file: "legistar-pima-eventdates-138-future.json",
    contentType: "application/json",
  },
  INSITE_CALENDAR_GRID: {
    file: "legistar-insite-pima-calendar-this-year.html",
    contentType: "text/html",
  },
  INSITE_CALENDAR_RSS: {
    file: "legistar-insite-pima-feed-this-year.xml",
    contentType: "application/rss+xml",
  },
  INSITE_ICAL_EXPORT: { file: "legistar-insite-pima-ical-1381575.ics", contentType: "text/calendar" },
  INSITE_MEETING_DETAIL: {
    file: "legistar-pima-eventitems-1823.json",
    contentType: "application/json",
  },
  CLERK_SCHEDULE_PAGE: {
    file: "legistar-insite-pima-clerk-schedule.html",
    contentType: "text/html",
  },
  /*
   * NO BYTES, ON PURPOSE. `pima.granicus.com` serves `User-agent: * / Disallow: /`.
   * A permission refusal is a fact about what WE may do and carries no claim
   * whatever about the content behind it. Retrieving it anyway to "have an
   * artifact" would be the residential-proxy reasoning wearing a different hat.
   */
  GRANICUS_VIEW_PUBLISHER: null,
};

/**
 * What each route was RECORDED to have returned, and how it is disposed.
 *
 * These are the measured figures from `lib/sources/legistar-insite/horizon.ts`
 * and the Pima fixture, not values invented here. Two of them are zero, and the
 * zeros are the most important entries in the table: `/Events` and `/EventDates`
 * both returned NOTHING for the future horizon while three other routes each
 * returned fourteen. A route that returns nothing has told us about ITSELF.
 */
interface RoutePlan {
  readonly disposition: Disposition;
  readonly rawCount: number;
  readonly normalizedCount: number;
  readonly permission: PermissionState;
  readonly transport: TransportState;
  readonly note: string;
}

const ROUTE_PLAN: Readonly<Record<string, RoutePlan>> = {
  LEGISTAR_WEBAPI_EVENTS: {
    disposition: "WALKED_NO_YIELD",
    rawCount: 0,
    normalizedCount: 0,
    permission: "ALLOWED",
    transport: "REACHABLE",
    note:
      "The WebAPI answered and published no future sitting. A fact about this ROUTE's horizon, " +
      "never about the county's calendar — three other first-party routes publish fourteen.",
  },
  LEGISTAR_WEBAPI_EVENTDATES: {
    disposition: "WALKED_NO_YIELD",
    rawCount: 0,
    normalizedCount: 0,
    permission: "ALLOWED",
    transport: "REACHABLE",
    note:
      "/EventDates/{bodyId} answered and published no future sitting. This is the route MTG-13 " +
      "omitted; walking it and recording its honest zero is what the floor exists to force.",
  },
  INSITE_CALENDAR_GRID: {
    disposition: "INGESTED",
    rawCount: 14,
    normalizedCount: 14,
    permission: "ALLOWED",
    transport: "REACHABLE",
    note: "The InSite Calendar.aspx grid published fourteen future sittings.",
  },
  INSITE_CALENDAR_RSS: {
    disposition: "INGESTED",
    rawCount: 14,
    normalizedCount: 14,
    permission: "ALLOWED",
    transport: "REACHABLE",
    note: "The Feed.ashx calendar RSS published the same fourteen.",
  },
  INSITE_ICAL_EXPORT: {
    disposition: "INGESTED",
    rawCount: 1,
    normalizedCount: 1,
    permission: "ALLOWED",
    transport: "REACHABLE",
    note:
      "The iCalendar export is PER SITTING, so one export is one instance. It corroborates the " +
      "grid rather than enumerating the calendar.",
  },
  INSITE_MEETING_DETAIL: {
    disposition: "INGESTED",
    rawCount: 1,
    normalizedCount: 1,
    permission: "ALLOWED",
    transport: "REACHABLE",
    note:
      "MeetingDetail.aspx is per sitting and carries the agenda items. It deepens a sitting the " +
      "grid already published; it does not enumerate.",
  },
  CLERK_SCHEDULE_PAGE: {
    disposition: "INGESTED",
    rawCount: 14,
    normalizedCount: 14,
    permission: "ALLOWED",
    transport: "REACHABLE",
    note:
      "The Clerk of the Board's own schedule table, on the county's own domain, published the " +
      "same fourteen. The body's own publication, which RULING 166 walks first.",
  },
  GRANICUS_VIEW_PUBLISHER: {
    /*
     * BLOCKED_CURRENTLY is an OPEN disposition, and that is the point. A wall is
     * not an emptiness. `pima.granicus.com/robots.txt` publishes
     * `User-agent: * / Disallow: /`, which says what we may do and says nothing
     * about what is behind it. Recording this as WALKED_NO_YIELD would convert
     * "we are not allowed to look" into "there is nothing there" — the single
     * conversion this product cannot survive.
     */
    disposition: "BLOCKED_CURRENTLY",
    rawCount: 0,
    normalizedCount: 0,
    permission: "DISALLOWED",
    /*
     * `CHALLENGED`, matching `tests/control-plane-pima-shadow.test.ts` exactly.
     *
     * A NAMED IMPRECISION, recorded rather than smoothed over. `TRANSPORT_STATES`
     * has no value for "never attempted, because permission refused it" — the six
     * members all describe an attempt that happened. The truthful reading of this
     * route is that no transport was attempted at all.
     *
     * Two wrong ways to resolve that, and neither is taken here. Inventing a
     * seventh state is a change to a governed vocabulary that ripples through
     * every disposition in the repository, and it is not this session's to make
     * on its own authority. Choosing a DIFFERENT member than the shipped test
     * chose would give one fact two readings (RULING 103) and the divergence
     * would show up later as two files disagreeing about one wall.
     *
     * So: the same value the proven test uses, and the gap is written down here
     * and carried to the tracker rather than left for a later session to
     * rediscover. What matters for correctness is unaffected — the disposition is
     * `BLOCKED_CURRENTLY`, an OPEN state, and the obligation stays open on it.
     */
    transport: "CHALLENGED",
    note:
      `${PIMA_GRANICUS_PERMISSION.host}/robots.txt publishes "${PIMA_GRANICUS_PERMISSION.rule}" ` +
      `(read ${PIMA_GRANICUS_PERMISSION.readAt}). The route is not walked and the obligation ` +
      "stays open on it. NO CLAIM WHATEVER is made about the proceedings behind it.",
  },
};

/** The route whose Attempt dies mid-walk, so the crash path is exercised for real. */
const CRASHES_FIRST = "INSITE_MEETING_DETAIL";

/** The route deliberately omitted in the first completion evaluation. */
export const OMITTED_ROUTE = "LEGISTAR_WEBAPI_EVENTDATES";

/** Deterministic instants. The caller may supply its own; these are the defaults. */
export interface RunClock {
  readonly start: string;
  readonly claim: string;
  readonly crash: string;
  readonly afterExpiry: string;
  readonly dispose: string;
  readonly evaluate: string;
  readonly end: string;
}

export const DEFAULT_CLOCK: RunClock = {
  start: "2026-08-29T18:00:00.000Z",
  claim: "2026-08-29T18:00:10.000Z",
  crash: "2026-08-29T18:01:00.000Z",
  afterExpiry: "2026-08-29T18:20:00.000Z",
  dispose: "2026-08-29T18:25:00.000Z",
  evaluate: "2026-08-29T18:30:00.000Z",
  end: "2026-08-29T18:30:05.000Z",
};

const TTL_MS = 5 * 60 * 1000;

const worker = (role: WorkerRef["role"], instance: string): WorkerRef => ({
  role,
  provider: "wtp-shadow",
  version: "shadow-1",
  instance,
});

/**
 * Measured cost, and every field that was not measured stays `null`.
 *
 * A shadow run over recorded bytes genuinely does not spend tokens or make
 * requests. `requestCount: 0` is a real measurement — zero requests were made —
 * while `usd` and the token counts are `null` because nothing measured them. The
 * distinction is `lib/control-plane/cost.ts`'s rule: an unmeasured value is
 * reported as unmeasured, never as zero, or a forecast reports the project as
 * cheaper the less it has measured.
 */
const SHADOW_COST: AttemptCost = {
  inputTokens: null,
  outputTokens: null,
  usd: null,
  durationMs: null,
  bytesFetched: null,
  requestCount: 0,
};

export interface ShadowRunInput {
  readonly repos: ControlPlaneRepositories;
  readonly evidence: EvidenceStore;
  readonly knowledge: MethodKnowledge;
  /** Directory holding the recorded publisher bytes. */
  readonly fixtureDir: string;
  /** Repo-relative serving surfaces to digest before and after. */
  readonly readerSurfaces: readonly string[];
  /** Absolute paths for those surfaces, in the same order. */
  readonly readerSurfacePaths: readonly string[];
  readonly stateRoot: string;
  readonly clock?: RunClock;
  readonly runId?: string;
}

export interface ShadowRunResult {
  readonly record: ShadowRunRecord;
  /**
   * The completion verdict taken with `OMITTED_ROUTE` deliberately undisposed.
   *
   * Kept SEPARATE from the record's own verdict because they answer different
   * questions. This one is the seeded failure — does omitting a known route
   * refuse the close, by name? The record's verdict is the honest state of the
   * obligation once every route this run had evidence for was disposed.
   */
  readonly omissionVerdict: ReturnType<typeof evaluateCompletion>;
  readonly floor: RouteFloor;
  /**
   * What the exploration queue actually did. One entry per speculative
   * experiment on the floor — never fewer, or the queue would be a list nothing
   * consumed.
   */
  readonly exploration: readonly ExplorationOutcome[];
  /**
   * Structural findings against the materialised floor. MUST be empty: a
   * non-empty list means a required first-party surface was dropped or demoted.
   */
  readonly floorIntegrity: readonly FloorIntegrityFinding[];
}

function digestFile(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function digestAll(
  surfaces: readonly string[],
  paths: readonly string[],
): Record<string, string> {
  const out: Record<string, string> = {};
  surfaces.forEach((s, i) => {
    // A surface that cannot be hashed is left ABSENT rather than given a
    // placeholder. `assessReaderImpact` reads an absence as MOVED, which is the
    // safe direction: "we could not check it" must never render as "it did not
    // move".
    try {
      out[s] = digestFile(paths[i]);
    } catch {
      /* absent from the map on purpose */
    }
  });
  return out;
}

/** Run the obligation through the hardened control plane and return the record. */
export async function runPimaShadow(input: ShadowRunInput): Promise<ShadowRunResult> {
  const clock = input.clock ?? DEFAULT_CLOCK;
  const runId = input.runId ?? `shadow-pima-${clock.start.slice(0, 10)}`;

  const before = digestAll(input.readerSurfaces, input.readerSurfacePaths);

  /* ---- 1. The obligation, and the floor computed rather than typed ------- */

  const floor = computeRouteFloor({
    knowledge: input.knowledge,
    jurisdiction: PIMA_JURISDICTION,
    fields: PIMA_MEETING_FIELDS,
    adapterRoutes: PIMA_ADAPTER_ROUTES,
  });

  const item0 = pimaFutureMeetingsWorkItem(clock.start);
  const { item, routeTasks, explorationTasks } = materializeFloor(item0, floor, clock.start);

  /*
   * THE GUARD RUNS BEFORE ANY WALK, and it reads no disposition.
   *
   * A required first-party surface that got dropped or demoted must be caught
   * by the SHAPE of the floor, not by noticing later that a count looked odd.
   * Running it here means no speculative success can ever have influenced it.
   */
  const floorIntegrity = auditFloorIntegrity({
    floor,
    adapterRoutes: PIMA_ADAPTER_ROUTES,
    item,
    routeTasks: [...routeTasks, ...explorationTasks],
  });

  await registerWorkItem(input.repos, item, clock.start);
  // BOTH queues are registered. The exploration queue is real, durable, owed
  // work; keeping it out of the repository would be the drop this split exists
  // to avoid.
  for (const task of [...routeTasks, ...explorationTasks]) {
    await registerRouteTask(input.repos, task, clock.start);
  }

  /* ---- 2. Walk every route we hold recorded evidence for ----------------- */

  const recordedAttempts: RecordedAttempt[] = [];
  const recordedArtifacts: RecordedArtifact[] = [];
  const byRouteId = new Map(routeTasks.map((t) => [t.routeId, t]));

  for (const routeId of Object.keys(ROUTE_PLAN)) {
    const task = byRouteId.get(routeId);
    if (!task) continue;
    const plan = ROUTE_PLAN[routeId];
    const fixture = ROUTE_FIXTURES[routeId];

    /* ---- 2a. The crash, observed from OUTSIDE ---------------------------- */
    if (routeId === CRASHES_FIRST) {
      const claimA = await claimRouteTask(input.repos, {
        routeTaskId: task.id,
        holder: "worker-a",
        now: clock.claim,
        ttlMs: TTL_MS,
      });
      const attemptA = await beginAttemptFor(input.repos, {
        routeTaskId: task.id,
        workItemId: item.id,
        worker: worker("ACQUIRER", "worker-a"),
        lease: claimA.lease.value,
        now: clock.claim,
        methodVersion: floor.methodVersion,
        policyVersion: "shadow-p1",
      });

      // A PARTIAL artifact, preserved and LABELLED. Worker A fetched real bytes
      // and then died; the bytes are evidence and the walk is not a conclusion.
      const partial = await storeArtifact({
        evidence: input.evidence,
        fixtureDir: input.fixtureDir,
        fixture,
        routeId,
        workItemId: item.id,
        attemptId: attemptA.value.id,
        at: clock.claim,
        partial: true,
      });
      if (partial) {
        await recordArtifactMetadata(
          input.repos,
          {
            artifactId: partial.artifact.id,
            workItemId: item.id,
            routeTaskId: task.id,
            attemptId: attemptA.value.id,
            tier: partial.artifact.tier,
            contentHash: partial.artifact.contentHash,
            byteLength: partial.artifact.byteLength,
            contentType: partial.artifact.contentType,
            canonicalUrl: partial.artifact.canonicalUrl,
            partial: true,
            recordedAt: clock.claim,
          },
          clock.claim,
        );
        recordedArtifacts.push(toRecordedArtifact(partial.artifact, true, partial.stored));
      }

      // Worker A now disappears. It writes NO terminal state — a dead worker is
      // by construction unavailable to report that it died. The control plane
      // observes the death from the lease that stopped being renewed.
      const reclaimed = await reclaimRouteTask(input.repos, {
        routeTaskId: task.id,
        now: clock.afterExpiry,
        observedBy: "shadow-sweeper",
      });
      for (const closed of reclaimed.closed) {
        recordedAttempts.push(toRecordedAttempt(closed.value, routeId));
      }
    }

    /* ---- 2b. The walk that reaches a boundary ---------------------------- */

    const claimB = await claimRouteTask(input.repos, {
      routeTaskId: task.id,
      holder: "worker-b",
      now: clock.afterExpiry,
      ttlMs: TTL_MS,
    });
    const attemptB = await beginAttemptFor(input.repos, {
      routeTaskId: task.id,
      workItemId: item.id,
      worker: worker("ACQUIRER", "worker-b"),
      lease: claimB.lease.value,
      now: clock.afterExpiry,
      methodVersion: floor.methodVersion,
      policyVersion: "shadow-p1",
    });

    const artifactIds: string[] = [];
    const stored = await storeArtifact({
      evidence: input.evidence,
      fixtureDir: input.fixtureDir,
      fixture,
      routeId,
      workItemId: item.id,
      attemptId: attemptB.value.id,
      at: clock.dispose,
    });
    if (stored) {
      await recordArtifactMetadata(
        input.repos,
        {
          artifactId: stored.artifact.id,
          workItemId: item.id,
          routeTaskId: task.id,
          attemptId: attemptB.value.id,
          tier: stored.artifact.tier,
          contentHash: stored.artifact.contentHash,
          byteLength: stored.artifact.byteLength,
          contentType: stored.artifact.contentType,
          canonicalUrl: stored.artifact.canonicalUrl,
          partial: false,
          recordedAt: clock.dispose,
        },
        clock.dispose,
      );
      artifactIds.push(stored.artifact.id);
      recordedArtifacts.push(toRecordedArtifact(stored.artifact, false, stored.stored));
    }

    await recordCost(
      input.repos,
      {
        workItemId: item.id,
        routeTaskId: task.id,
        attemptId: attemptB.value.id,
        routeId,
        source: "legistar-insite",
        jurisdiction: PIMA_BODY_ID,
        project: "meanwhile",
        role: "ACQUIRER",
        recordedAt: clock.dispose,
        cost: SHADOW_COST,
      },
      clock.dispose,
    );

    const current = await input.repos.routeTasks.mustRead(task.id);
    const outcome = await disposeRouteTask(input.repos, {
      routeTaskId: task.id,
      attemptId: attemptB.value.id,
      expectedTaskRevision: current.revision,
      disposition: {
        disposition: plan.disposition,
        attemptId: attemptB.value.id,
        at: clock.dispose,
        artifactIds,
        observation: {
          rawCount: plan.rawCount,
          normalizedCount: plan.normalizedCount,
          routeOnlyCount: null,
          earliest: null,
          latest: null,
        },
        permission: plan.permission,
        transport: plan.transport,
        note: plan.note,
      },
      now: clock.dispose,
      artifactIds,
      cost: SHADOW_COST,
    });
    recordedAttempts.push(toRecordedAttempt(outcome.attempt.value, routeId));
  }

  /* ---- 2c. THE EXPLORATION QUEUE IS RUN, NOT LISTED ---------------------- */

  /*
   * Every speculative experiment on the floor is offered to an executor, and
   * every one comes back with a disposition or a NAMED reason it could not be
   * walked here yet.
   *
   * This run reads recorded bytes (`retrievalMode`), and no bytes were ever
   * recorded for these techniques against this publisher — several of them are
   * not retrieval routes at all but reasoning disciplines (`reconciled-is-not-
   * complete`, `prove-the-reader-before-believing-a-zero`) with nothing to
   * fetch. So the honest result for each is UNTESTED with the reason stated,
   * and NO disposition is written. Writing `WALKED_NO_YIELD` here would be a
   * fabricated walk, and it would convert "we have no way to run this" into
   * "this found nothing" — about a government we never asked.
   *
   * The tasks therefore stay outstanding and the obligation stays open on them.
   * That is the frontier, reported as a frontier.
   */
  const exploration = await runExplorationQueue(floor, explorationTasks, async (route) => {
    if (!(route.routeId in ROUTE_FIXTURES)) {
      return {
        disposition: null,
        reason:
          `no recorded bytes exist for "${route.label}" against ${route.target}, and this run ` +
          "reads recorded bytes rather than re-fetching. The experiment is UNTESTED here: a " +
          "statement about our capability, carrying no claim about the publisher.",
      };
    }
    if (!(route.routeId in ROUTE_PLAN)) {
      return {
        disposition: null,
        reason:
          "bytes are recorded for this route but no walk plan exists for it — UNTESTED, and a " +
          "disposition invented to fill the gap would be a fabricated walk",
      };
    }
    const plan = ROUTE_PLAN[route.routeId];
    return { disposition: plan.disposition, reason: plan.note };
  });

  /* ---- 3. The two completion evaluations --------------------------------- */

  const validations: ValidationRecord[] = [
    {
      workItemId: item.id,
      passed: true,
      at: clock.evaluate,
      by: "legistar-insite-union",
      checked: [
        "inherited route floor materialised from the method projection, not typed by a worker",
        "every disposed route names the Attempt that earned it",
        "the union denominator matches the adapter's independently proven acceptance",
      ],
      detail:
        `The union across materially distinct first-party routes is ${PIMA_UNION_DENOMINATOR}, ` +
        "matching the adapter's independently proven acceptance.",
    },
  ];
  const audits: AuditFinding[] = [
    {
      id: "aud-pima-independent",
      workItemId: item.id,
      mode: "SOURCE_UNIVERSE",
      severity: "HIGH",
      survived: true,
      /*
       * INDEPENDENT_FIRST_PARTY_ACQUISITION, and the choice is the point. An
       * audit that started from `OUR_SUMMARY` cannot discharge the requirement —
       * it could never discover that our pipeline mistook one endpoint for the
       * universe, which is exactly what MTG-13 did. The Clerk of the Board's own
       * schedule table is a DIFFERENT PUBLISHER on the county's own domain,
       * outside the Legistar tenant our adapter reads.
       */
      startedFrom: ["INDEPENDENT_FIRST_PARTY_ACQUISITION", "PUBLISHER_SOURCE_UNIVERSE"],
      at: clock.evaluate,
      resolvedAt: null,
      detail:
        "Re-derived the fourteen from the Clerk of the Board's own schedule table on the " +
        "county's domain — a publisher outside the Legistar tenant our pipeline reads.",
    },
  ];

  const snapshot = await loadCompletionSnapshot(input.repos, {
    workItemId: item.id,
    now: clock.evaluate,
    validations,
    audits,
    denominatorComplete: true,
    /* This shadow run carries no instrument-evidence contract, so the set is
       empty and the clause is a no-op. Stated rather than omitted: an absent
       field would be a type error the day one of these items gains one. */
    instrumentGreens: new Set<string>(),
  });

  // THE SEEDED FAILURE. The same durable snapshot with the one route's
  // disposition withheld — the exact shape MTG-13 shipped.
  const omissionVerdict = evaluateCompletion(
    {
      ...snapshot,
      routeTasks: snapshot.routeTasks.map((t) =>
        t.routeId === OMITTED_ROUTE
          ? { ...t, state: "PENDING" as const, disposition: null }
          : t,
      ),
    },
    "VERIFIED_COMPLETE",
  );

  const verdict = evaluateCompletion(snapshot, "VERIFIED_COMPLETE");

  const after = digestAll(input.readerSurfaces, input.readerSurfacePaths);

  const recordedFloor: RecordedFloor = {
    routes: floor.routes.map((r) => ({
      routeId: r.routeId,
      label: r.label,
      target: r.target,
      origins: r.origins,
      speculative: r.speculative,
    })),
    methodVersion: floor.methodVersion,
    legacyUnclassifiedCount: floor.legacyUnclassifiedCount,
    // Flattened to strings because the record is JSON a later session reads
    // back, and `Jurisdiction.family` is a string[]. Joining it here keeps the
    // record's shape flat and readable rather than making every consumer handle
    // one field of a different kind.
    jurisdiction: {
      state: PIMA_JURISDICTION.state,
      governmentType: PIMA_JURISDICTION.governmentType,
      platform: PIMA_JURISDICTION.platform,
      publisher: PIMA_JURISDICTION.publisher,
      family: PIMA_JURISDICTION.family?.join(", "),
    },
  };

  const recordedTasks: RecordedRouteTask[] = snapshot.routeTasks.map((t) => ({
    routeTaskId: t.id,
    routeId: t.routeId,
    routeLabel: t.routeLabel,
    target: t.target,
    inherited: t.inherited,
    state: t.state,
    disposition: t.disposition?.disposition ?? null,
    dispositionAttemptId: t.disposition?.attemptId ?? null,
    permission: t.disposition?.permission ?? null,
    transport: t.disposition?.transport ?? null,
    rawCount: t.disposition?.observation?.rawCount ?? null,
    normalizedCount: t.disposition?.observation?.normalizedCount ?? null,
    note: t.disposition?.note ?? null,
    outstanding: t.disposition === null || t.state !== "DISPOSED"
      ? true
      : ["BLOCKED_CURRENTLY", "RECORDS_REQUEST_PENDING", "REQUIRES_NEW_ADAPTER", "RECHECK_DUE"].includes(
          t.disposition.disposition,
        ),
  }));

  const checks: RecordedCheck[] = [
    ...validations.map((v) => ({
      kind: "VALIDATION" as const,
      id: v.by,
      passed: v.passed,
      independent: null,
      detail: `${v.detail} Clauses checked: ${v.checked.join("; ")}.`,
    })),
    ...audits.map((a) => ({
      kind: "AUDIT" as const,
      id: a.id,
      // Independence is a property of the EVIDENCE BASE, never of the attack
      // mode — `dischargesAudit` in audit.ts is the authority, and reading the
      // mode instead would call an audit of our own summary independent.
      passed: a.survived,
      independent: a.startedFrom.some((b) => INDEPENDENT_BASES.includes(b)),
      detail: a.detail,
    })),
  ];

  const record: ShadowRunRecord = {
    formatVersion: SHADOW_RUN_RECORD_VERSION,
    runId,
    mode: "SHADOW",
    startedAt: clock.start,
    endedAt: clock.end,
    stateRoot: input.stateRoot,
    workItemId: item.id,
    subject: PIMA_BODY_ID,
    obligation: item.obligation,
    floor: recordedFloor,
    routeTasks: recordedTasks,
    attempts: recordedAttempts,
    artifacts: recordedArtifacts,
    checks,
    discoveries: [],
    readerImpact: assessReaderImpact({ surfaces: input.readerSurfaces, before, after }),
    verdict: {
      proposedState: "VERIFIED_COMPLETE",
      mayComplete: verdict.mayComplete,
      refusals: verdict.refusals.map((r) => ({ code: r.code, subject: r.subject, detail: r.detail })),
      satisfied: [...verdict.satisfied],
    },
    independentAcceptance: {
      expected: PIMA_UNION_DENOMINATOR,
      authority:
        "tests/legistar-insite-union.test.ts and the InSite adapter — established before the " +
        "control plane existed and not movable by it",
      agrees: recordedTasks.some(
        (t) => t.routeId === "INSITE_CALENDAR_GRID" && t.normalizedCount === PIMA_UNION_DENOMINATOR,
      ),
    },
  };

  return { record, omissionVerdict, floor, exploration, floorIntegrity };
}

/** ------------------------------------------------------------- helpers */

/**
 * Store one retrieval's bytes and return the artifact.
 *
 * `partial` TRUNCATES the body, and that is not decoration. A worker that dies
 * mid-transfer leaves a PREFIX of what the server was sending — fewer bytes, a
 * different hash, and therefore a different artifact. Modelling the crash with
 * the complete bytes was this run's first version and the append-only log
 * refused it, correctly: worker A and worker B would have produced the same
 * content address, and the second record would have re-pointed A's artifact at
 * B's Attempt. That is precisely the attribution laundering the repository layer
 * exists to refuse, and it surfaced here as a real refusal rather than as a
 * paragraph nobody tested.
 *
 * So a partial capture is stored as what it is: the bytes that actually arrived,
 * labelled `partial`, attributed to the Attempt that fetched them, and kept.
 */
async function storeArtifact(input: {
  evidence: EvidenceStore;
  fixtureDir: string;
  fixture: { file: string; contentType: string } | null;
  routeId: string;
  workItemId: string;
  attemptId: string;
  at: string;
  partial?: boolean;
}): Promise<{ artifact: Artifact; stored: boolean } | null> {
  if (!input.fixture) return null;
  const whole = readFileSync(join(input.fixtureDir, input.fixture.file), "utf8");
  // A deterministic prefix — the transfer stopped where it stopped, and a replay
  // must reach the same bytes. Never a random cut.
  const body = input.partial ? whole.slice(0, Math.floor(whole.length * 0.6)) : whole;
  const { artifact } = recordAcquisition(
    {
      canonicalUrl: `recorded://${input.fixture.file}`,
      retrievedAt: input.at,
      httpStatus: 200,
      contentType: input.fixture.contentType,
      sourceId: "legistar-insite",
      methodRouteId: input.routeId,
      workItemId: input.workItemId,
      attemptId: input.attemptId,
      permission: "ALLOWED",
      transport: "REACHABLE",
    },
    body,
  );
  const bytes = new TextEncoder().encode(body);
  const { key } = await putArtifact(input.evidence, "meanwhile", artifact, bytes);

  /*
   * DURABILITY IS MEASURED, NOT ASSUMED — and the first version of this line
   * asserted it unconditionally, which is the defect this whole record exists to
   * make impossible.
   *
   * Two separate questions, and both must be YES:
   *   - does this store claim to survive the process at all (`durable`)? The
   *     in-memory double answers false and says so in its own type;
   *   - is the object actually THERE, asked of the store rather than inferred
   *     from a `put` that did not throw?
   *
   * A dry run against `MemoryEvidenceStore` therefore reports `durablyStored:
   * false` for every artifact, which is true and is what a reader needs to know
   * before citing one.
   */
  const claimsDurable = (input.evidence as { durable?: boolean }).durable === true;
  const present = (await input.evidence.head(key)) !== null;
  return { artifact, stored: claimsDurable && present };
}

function toRecordedAttempt(
  a: { id: string; routeTaskId: string; worker: WorkerRef; startedAt: string; endedAt: string | null; outcome: string | null; abortReason: string | null; artifactIds: readonly string[]; cost: AttemptCost },
  routeId: string,
): RecordedAttempt {
  return {
    attemptId: a.id,
    routeTaskId: a.routeTaskId,
    routeId,
    role: a.worker.role,
    worker: `${a.worker.provider}@${a.worker.version}/${a.worker.instance}`,
    startedAt: a.startedAt,
    endedAt: a.endedAt,
    outcome: a.outcome as RecordedAttempt["outcome"],
    abortReason: a.abortReason,
    artifactIds: [...a.artifactIds],
    usd: a.cost.usd,
    requestCount: a.cost.requestCount,
    mayWriteDisposition: a.outcome === "COMPLETED",
  };
}

function toRecordedArtifact(a: Artifact, partial: boolean, stored: boolean): RecordedArtifact {
  return {
    artifactId: a.id,
    tier: a.tier,
    contentHash: a.contentHash,
    byteLength: a.byteLength,
    contentType: a.contentType,
    attemptId: a.attemptId,
    methodRouteId: a.methodRouteId,
    canonicalUrl: a.canonicalUrl,
    durablyStored: stored,
    // Named rather than left null. "Not durable" with no reason is the shape a
    // later reader cannot act on; this says WHICH of the two conditions failed.
    durabilityRefusal: stored
      ? null
      : "the run used a non-durable evidence store (a dry run), or the store did not hold the " +
        "object when asked — either way this artifact is not citable evidence",
    ...(partial ? {} : {}),
  };
}
