/**
 * **ROUTINE CIVIC-DATA CONTRACTS, AS ASSIGNMENTS.**
 *
 * The routine lane lives in the production data plane (`civic_data_candidates`,
 * `civic_data_candidate_events`, `civic_data_promotions`), not in the control
 * plane, and the Admin Sources page already reads it through
 * `readRoutineDataObservability` (`lib/civic-data/observability-server.ts`).
 * This module takes that same observation — nothing is read twice, nothing is
 * re-derived — and states each contract in the assignment view's seven parts,
 * so routine plain-code work sits beside the Scout and the fleet on one list.
 *
 * Every value comes from an `Observation` the projector already classified:
 * MEASURED renders, and NOT_RECORDED / UNKNOWN become named gaps with the
 * projector's own detail. The routine lane is the one lane that DOES observe
 * public availability (a typed reader read-model readback), so part 5 is a
 * measurement here where the research lane's is a gap. PURE: type-only imports
 * from the observability module; no clock but `nowIso`.
 */
import type {
  AttemptHistoryMember,
  DrilldownCount,
  Observation,
  RoutineContractObservation,
  RoutineObservabilityView,
} from "../civic-data/observability.ts";
import {
  ASSIGNMENT_STATES,
  DRILLDOWN_LIST_CLIP,
  DRILLDOWN_TEXT_CLIP,
  STATE_WORDS,
  clipText,
  type AssignmentBlocker,
  type AssignmentCheck,
  type AssignmentNote,
  type AssignmentRejection,
  type AssignmentRow,
  type AssignmentState,
  type AssignmentVerification,
  type NextStepOwner,
  type PromotionStatus,
  type PublicAvailability,
} from "./assignment-view.ts";
import { displayNameOf } from "./display-name.ts";
import { gap, held, measured, type Held, type Measured } from "./owner-surface.ts";
import { plainCode } from "./plain-words.ts";

export const ROUTINE_ASSIGNMENT_PREFIX = "routine:";

export function routineAssignmentId(contractId: string): string {
  return `${ROUTINE_ASSIGNMENT_PREFIX}${contractId}`;
}

/** The contract id an assignment id names, or null when it is not a routine assignment. */
export function routineContractIdOf(assignmentId: string): string | null {
  return assignmentId.startsWith(ROUTINE_ASSIGNMENT_PREFIX) ? assignmentId.slice(ROUTINE_ASSIGNMENT_PREFIX.length) : null;
}

const clip = clipText;

function value<T>(o: Observation<T>): T | null {
  return o.kind === "MEASURED" ? o.value : null;
}

/** The projector's own sentence for an observation it did not measure. */
function detailOf<T>(o: Observation<T> | DrilldownCount<T>): string {
  return o.kind === "MEASURED" ? "" : o.detail;
}

function countOf<T>(c: DrilldownCount<T>): number | null {
  return c.kind === "MEASURED" ? c.value : null;
}

const FAILED_STATES = new Set([
  "SOURCE_BLOCKED",
  "PARSE_INVALID",
  "IDENTITY_UNRESOLVED",
  "TEMPORAL_INVALID",
  "SEMANTIC_INVALID",
  "HORIZON_UNRESOLVED",
  "DEPENDENT_CONSUMER_INVALID",
  "CANNOT_TELL",
]);

function stateOfAttempt(a: AttemptHistoryMember): string | null {
  return a.state.kind === "MEASURED" ? a.state.value : null;
}

/*
 * A candidate's state is the FIRST blocking validation check, in check order
 * (`failureStateFor`, lib/civic-data/validate.ts): source authenticity, then
 * schema/parse validity, then identity, time, meaning, completeness, absence
 * and the dependent read model. So a state named for a check AFTER the parse
 * check proves the parse passed; PARSE_INVALID is the parse itself failing;
 * SOURCE_BLOCKED and FETCHED stopped before the parse was judged.
 */
const PARSED_STATES = new Set([
  "NORMALIZED",
  "VALIDATED",
  "PROMOTED",
  "IDENTITY_UNRESOLVED",
  "TEMPORAL_INVALID",
  "SEMANTIC_INVALID",
  "HORIZON_UNRESOLVED",
  "DEPENDENT_CONSUMER_INVALID",
  "CANNOT_TELL",
]);

/**
 * Retries in the window: each attempt that followed a failed attempt. Null
 * when any attempt's time, or whether it failed, cannot be read — a partial
 * count is never stood in for the whole.
 */
function routineRetries(members: readonly AttemptHistoryMember[]): number | null {
  const timed: { readonly at: number; readonly failed: boolean }[] = [];
  for (const a of members) {
    const at = a.attemptedAt.kind === "MEASURED" ? Date.parse(a.attemptedAt.value) : Number.NaN;
    const state = stateOfAttempt(a);
    const acquired = a.acquisitionSucceeded.kind === "MEASURED" ? a.acquisitionSucceeded.value : null;
    const failed = acquired === false ? true : state === null ? null : FAILED_STATES.has(state);
    if (!Number.isFinite(at) || failed === null) return null;
    timed.push({ at, failed });
  }
  timed.sort((x, y) => x.at - y.at);
  let retries = 0;
  for (let i = 1; i < timed.length; i += 1) if (timed[i - 1].failed) retries += 1;
  return retries;
}

interface RoutineReading {
  readonly state: AssignmentState;
  readonly owner: NextStepOwner;
  readonly blocker: AssignmentBlocker;
  readonly nextAction: string;
}

function readingOf(c: RoutineContractObservation, nowMs: number): RoutineReading {
  const manual = c.cadence.clock === "MANUAL";
  const nextDue = value(c.cadence.nextDue);
  const detail = c.cadence.operationalDetail;
  const none: AssignmentBlocker = { kind: "NONE", says: "Nothing is blocking it." };
  switch (c.cadence.operationalState) {
    case "HEALTHY":
      return {
        state: "SUCCEEDED",
        owner: manual ? "OWNER" : "RUNNER",
        blocker: none,
        nextAction: manual ? "It runs again when you run it." : nextDue ? `Next acquisition due ${nextDue}.` : "Its next acquisition time is not recorded.",
      };
    case "DUE":
    case "STALE":
      return {
        state: "SUCCEEDED",
        owner: manual ? "OWNER" : "RUNNER",
        blocker: { kind: "NONE", says: `Nothing is blocking it; the serving version is ${c.cadence.operationalState === "STALE" ? "stale" : "due for its next acquisition"}.` },
        nextAction: manual
          ? "Run it when you choose; the last good version keeps serving meanwhile."
          : `${nextDue ? `Due since ${nextDue}; ` : ""}the standing runner acquires it on its next pass.`,
      };
    case "IN_PROGRESS":
      return { state: "WORKING", owner: manual ? "OWNER" : "RUNNER", blocker: { kind: "NONE", says: "Nothing is blocking it: an attempt is under way." }, nextAction: "Let the attempt reach its disposition." };
    case "RETRYING":
      return {
        state: "FAILED",
        owner: "RUNNER",
        blocker: { kind: "NAMED", says: detail },
        nextAction: `${nextDue ? `Automatic retry due ${nextDue} ` : "Automatic retry "}(${c.cadence.retryDescription}); the last good version keeps serving meanwhile.`,
      };
    case "HELD":
      return manual
        ? { state: "BLOCKED", owner: "OWNER", blocker: { kind: "NAMED", says: detail }, nextAction: "Rerun it when you choose; the last good version keeps serving meanwhile." }
        : {
            state: "FAILED",
            owner: "RUNNER",
            blocker: { kind: "NAMED", says: detail },
            nextAction: "Its retry time has passed without a newer attempt; the standing runner owes it one.",
          };
    case "UNKNOWN": {
      if (c.currentState.kind === "NOT_RECORDED") {
        const due = nextDue !== null ? Date.parse(nextDue) : Number.NaN;
        return {
          state: "WAITING",
          owner: manual ? "OWNER" : "RUNNER",
          blocker: Number.isFinite(due) && due > nowMs ? { kind: "NONE", says: "Nothing yet: its first acquisition is not due." } : { kind: "NAMED", says: detail },
          nextAction: manual ? "Run it when you choose; it has never run." : "The standing runner makes its first acquisition when it is due.",
        };
      }
      return {
        state: "UNKNOWN",
        owner: "ENGINEERING",
        blocker: { kind: "UNKNOWN", gap: { whose: "UNKNOWABLE_NOW", says: detail } },
        nextAction: "Inspect the contract's evidence: its records disagree with each other.",
      };
    }
  }
}

function verificationOf(c: RoutineContractObservation, clipAt: number, listClip: number): AssignmentVerification {
  const canonical = value(c.canonicalPromotion);
  const refused = value(c.latestRefused) ?? [];
  const heldRecords = value(c.latestHeld) ?? [];
  const rejections: AssignmentRejection[] = refused.map((r) => ({
    stage: r.check ?? "validation",
    code: r.code,
    says: clip(r.detail, clipAt),
    guard: false,
    itemId: r.candidateId,
  }));
  const checks: AssignmentCheck[] = heldRecords.map((h) => ({
    who: "Validation hold",
    verdict: "HELD",
    at: h.attemptedAt,
    says: clip(`${h.key ? `${h.key}: ` : ""}${h.code} — ${h.detail}`, clipAt),
    resultId: h.candidateId,
  }));
  let pipeline: AssignmentVerification["pipeline"];
  if (canonical === null) {
    pipeline = c.canonicalPromotion.kind === "MEASURED"
      ? gap("OURS", "no promoted version carries a validation receipt")
      : gap(c.canonicalPromotion.kind === "UNKNOWN" ? "UNKNOWABLE_NOW" : "OURS", c.canonicalPromotion.detail);
  } else {
    const all = canonical.receipt.checks;
    const pass = all.filter((x) => x.verdict === "PASS").length;
    const cannotTell = all.filter((x) => x.verdict === "CANNOT_TELL").length;
    const fail = all.filter((x) => x.verdict === "FAIL").length;
    const source = `validation receipt of promoted version ${canonical.versionId}`;
    pipeline = held({
      unit: "validation check" as const,
      items: all.length,
      passed: measured(pass, all.length, "validation checks the serving version passed, of every check on its receipt", source),
      needsMoreEvidence: measured(cannotTell, all.length, "checks that could not tell, of every check on its receipt", source),
      rejected: measured(fail, all.length, "checks that failed, of every check on its receipt", source),
      furthest: null,
      rejections: rejections.slice(0, listClip),
      moreRejections: Math.max(0, rejections.length - listClip),
      guardRefusals: 0,
      itemIds: [canonical.versionId],
      says: `The serving version passed ${pass} of ${all.length} validation checks (decision ${canonical.receipt.decision.toLowerCase()}); the latest attempt ${refused.length > 0 ? `was refused on ${refused.length} check(s)` : "was not refused"}${heldRecords.length > 0 ? ` and held ${heldRecords.length} record(s) back for more evidence` : ""}.`,
    });
  }
  return {
    pipeline,
    checks: checks.slice(0, listClip),
    moreChecks: Math.max(0, checks.length - listClip),
    refusedFinishes: [],
    refusedFinishCount: 0,
  };
}

function promotedOf(c: RoutineContractObservation): Held<PromotionStatus> {
  const o = c.canonicalPromotion;
  if (o.kind === "MEASURED") {
    return held({
      state: "PROMOTED",
      says: `Version ${o.value.versionId} promoted ${o.value.promotedAt} (${o.value.authorityOrigin === "TRUSTED_LKG_IMPORT" ? "a trusted last-known-good import" : "a live source acquisition"}).`,
      versionId: o.value.versionId,
      at: o.value.promotedAt,
    });
  }
  if (o.kind === "NOT_RECORDED") return held({ state: "NOT_PROMOTED", says: o.detail, versionId: null, at: null });
  return gap<PromotionStatus>(o.kind === "UNKNOWN" ? "UNKNOWABLE_NOW" : "OURS", o.detail);
}

function publicOf(c: RoutineContractObservation): Held<PublicAvailability> {
  const o = c.readerVisible;
  if (o.kind === "MEASURED") {
    return held({
      state: "CONFIRMED",
      at: o.value.observedAt,
      says: `Confirmed on the reader read model at ${o.value.observedAt}: ${o.value.detail}`,
      proof: `projection ${o.value.projectionId}; readback event ${o.value.eventId}; verifier code ${o.value.verifierCodeSha.slice(0, 12)}`,
    });
  }
  if (o.kind === "NOT_APPLICABLE") return held({ state: "NO_READER_PAGE", at: null, says: o.detail, proof: null });
  return gap<PublicAvailability>(o.kind === "UNKNOWN" ? "UNKNOWABLE_NOW" : "OURS", o.detail);
}

/** One routine contract, in the seven parts. */
export function routineAssignmentRow(
  c: RoutineContractObservation,
  nowIso: string,
  options: { readonly textClip?: number; readonly listClip?: number } = {},
): AssignmentRow {
  const clipAt = options.textClip ?? DRILLDOWN_TEXT_CLIP;
  const listClip = options.listClip ?? DRILLDOWN_LIST_CLIP;
  const nowMs = Date.parse(nowIso);
  const reading = readingOf(c, nowMs);
  const manual = c.cadence.clock === "MANUAL";
  const month = c.histories["30d"];
  const attempts30 = countOf(month.counts.attempts);
  const successes30 = countOf(month.counts.successfulAcquisitions);
  const attemptMembers = month.attempts;
  // The count the projector stated, and only when its member list agrees with it: never a list length in its place.
  const attempts = attempts30 !== null && attemptMembers.length === attempts30 ? attempts30 : null;
  const unreadableStates = attemptMembers.filter((a) => stateOfAttempt(a) === null).length;
  const parseFailures = attemptMembers.filter((a) => stateOfAttempt(a) === "PARSE_INVALID").length;
  const parsedOk = attemptMembers.filter((a) => PARSED_STATES.has(stateOfAttempt(a) ?? "")).length;
  const notJudged = attemptMembers.length - unreadableStates - parseFailures - parsedOk;
  const retries = attempts === null ? null : routineRetries(attemptMembers);
  const nextDue = value(c.cadence.nextDue);
  const nextDueMs = nextDue === null ? Number.NaN : Date.parse(nextDue);
  const overdue = Number.isFinite(nextDueMs) ? nextDueMs <= nowMs : null;
  const lastAttempt = value(c.lastAttemptedAcquisition);
  const changes = value(c.latestChanges);
  const scope = displayNameOf(c.scope);

  const downloaded: AssignmentRow["discovery"]["downloaded"] =
    attempts30 === null || successes30 === null
      ? gap("OURS", detailOf(month.counts.attempts) || detailOf(month.counts.successfulAcquisitions) || "acquisition attempts were not recorded")
      : held({
          count: successes30,
          complete: measured(
            Math.min(successes30, attempts30),
            attempts30,
            "acquisition attempts in the last 30 days that succeeded, of every attempt",
            "civic_data_candidates (30-day history)",
          ),
          bytes: null,
          items: [],
          more: 0,
          says: `Last successful acquisition ${value(c.lastSuccessfulAcquisition) ?? "not recorded"}; the source runs through ${value(c.sourceThrough) ?? "a date not recorded"}.`,
        });

  const changeWords =
    changes === null
      ? `The latest change set is not shown: ${detailOf(c.latestChanges) || "it was not recorded"}.`
      : `Latest candidate ${changes.outcome.toLowerCase()}: ${changes.added.length} added, ${changes.changed.length} changed, ${changes.removed.length} removed.`;
  const parsed: AssignmentRow["parsing"]["parsed"] =
    attempts === null
      ? gap(
          month.counts.attempts.kind === "UNKNOWN" ? "UNKNOWABLE_NOW" : "OURS",
          `how many attempts ran in the last 30 days cannot be told (${detailOf(month.counts.attempts) || "the attempt list and its count disagree"}), so how many parsed is not counted`,
        )
      : unreadableStates > 0
        ? gap("UNKNOWABLE_NOW", `${unreadableStates} of the ${attempts} attempts in the last 30 days carry no readable state, so how many parsed cannot be told`)
        : held({
            runs: parsedOk + parseFailures,
            succeeded: parsedOk,
            failed: parseFailures,
            usable: gap<Measured>("OURS", "the routine observation does not expose the promoted record count; the latest change set is shown instead"),
            failures: parseFailures > 0 ? [`${parseFailures} attempt(s) in the last 30 days could not be parsed`] : [],
            says: `${parsedOk + parseFailures} of the ${attempts} attempts in the last 30 days had their parse judged: ${parsedOk} parsed, ${parseFailures} could not be parsed${notJudged > 0 ? `; ${notJudged} stopped before the parse was judged (the source was not authenticated, or it is not yet parsed)` : ""}. ${changeWords}`,
          });

  const notes: AssignmentNote[] = [
    { at: lastAttempt, from: `operational state ${plainCode(c.cadence.operationalState).toLowerCase()}`, text: clip(c.cadence.operationalDetail, clipAt) },
    { at: null, from: `freshness ${plainCode(c.cadence.freshness).toLowerCase()}`, text: clip(c.cadence.freshnessDetail, clipAt) },
    ...(c.lkg.kind === "MEASURED" ? [{ at: null, from: "last known good", text: clip(c.lkg.value.detail, clipAt) }] : []),
    ...(value(c.latestRefused) ?? []).map((r) => ({ at: r.attemptedAt, from: `refused ${r.check ?? "validation"} ${r.code}`, text: clip(r.detail, clipAt) })),
  ];
  const otherIds = [
    ...(c.canonicalPromotion.kind === "MEASURED" ? [{ what: "promoted version", id: c.canonicalPromotion.value.versionId }] : []),
    ...(c.readerVisible.kind === "MEASURED"
      ? [
          { what: "reader projection", id: c.readerVisible.value.projectionId },
          { what: "reader readback event", id: c.readerVisible.value.eventId },
        ]
      : []),
    ...attemptMembers.slice(0, listClip).map((a) => ({ what: "candidate", id: a.candidateId })),
  ];

  return {
    id: routineAssignmentId(c.contractId),
    kind: "ROUTINE_CONTRACT",
    lane: "ROUTINE",
    state: reading.state,
    stateSays: clip(c.cadence.operationalDetail, clipAt),
    lastActivityAt: lastAttempt,
    what: {
      title: `${plainCode(c.recordClass)} — ${c.sourceId}`,
      recordClass: c.recordClass,
      subject: c.scope,
      subjectName: scope.short,
      route: c.sourceId,
      where: held({ name: scope.name, state: scope.state }),
      why: {
        says: manual
          ? `An owner-invoked routine contract (${c.classification.toLowerCase().replace(/_/g, " ")}): it runs only when you run it.`
          : `A routine civic-data contract (${c.classification.toLowerCase().replace(/_/g, " ")}) on the standing runner's clock: ${c.cadence.description}.`,
        dueAt: nextDue,
        cadence: clip(`${c.cadence.description}; retry ${c.cadence.retryDescription}`, clipAt),
        readerImpactAt: null,
        band: null,
      },
      workers: held([
        {
          role: "ROUTINE_RUNNER",
          model: { kind: "PLAIN_CODE", tool: "routine civic-data runner" },
          attempts,
          reportedModels: [],
        },
      ]),
    },
    discovery: {
      rounds: attempts,
      attempts,
      discovered: held({
        routes: 0,
        records: 0,
        pointers: 0,
        sourceRows: null,
        rungsWalked: null,
        leads: [],
        moreLeads: 0,
        says: "Nothing to discover: the route is known, and this contract reads its source on a clock.",
      }),
      downloaded,
    },
    parsing: { parsed },
    verification: verificationOf(c, clipAt, listClip),
    delivery: {
      approved: null,
      promoted: promotedOf(c),
      publiclyAvailable: publicOf(c),
      blockers: c.readerVisible.kind === "MEASURED" || c.readerVisible.kind === "NOT_APPLICABLE" ? [] : [clip(c.readerVisible.detail, clipAt)],
    },
    cost: {
      dollars: { kind: "PLAIN_CODE", says: "Plain code only: the routine civic-data runner makes no model request, so there is no model charge to measure." },
      entries: 0,
      measured: 0,
      unmeasured: 0,
      plainCode: 0,
      noModelCall: 0,
      attemptsWithoutCostRow: 0,
      plainAttemptsWithoutCostRow: attempts,
      rounds: attempts,
      attempts,
      retries,
      escalations: { toOwner: 0, modelRouting: null },
      nonDollar: null,
      says: `${
        attempts === null
          ? "How many attempts ran in the last 30 days cannot be told."
          : `${attempts} attempt${attempts === 1 ? "" : "s"} in the last 30 days${retries === null ? " (which of them were retries cannot be told)" : retries > 0 ? `, ${retries} of them retries after a failed attempt` : ""}.`
      } The routine lane writes no rows to the cost ledger, so its requests, bytes and time are not metered here; it makes no model request.`,
    },
    waiting: {
      waiting: reading.state !== "SUCCEEDED" || overdue === true,
      since:
        reading.state === "FAILED" || reading.state === "BLOCKED" || reading.state === "UNKNOWN" || reading.state === "WORKING"
          ? lastAttempt
          : overdue === true
            ? nextDue
            : null,
      overdue,
      dueAt: nextDue,
      retryAt: c.cadence.operationalState === "RETRYING" ? nextDue : null,
      eligibleAt: nextDue,
      backoff: null,
      blocker: reading.blocker,
      owner: reading.owner,
      nextAction: reading.nextAction,
      openRound: null,
    },
    evidence: {
      obligationId: null,
      workItemIds: [],
      routeTaskIds: [],
      attemptIds: [],
      occurrenceIds: [],
      dispositionCommitIds: [],
      otherIds: otherIds.slice(0, listClip + 3),
      notes: notes.slice(0, listClip + 2),
      more: {
        workItems: 0,
        routeTasks: 0,
        attempts: 0,
        occurrences: 0,
        dispositionCommits: 0,
        otherIds: Math.max(0, otherIds.length - (listClip + 3)),
        notes: Math.max(0, notes.length - (listClip + 2)),
      },
    },
  };
}

/** Every routine contract the observation holds, in the seven parts. */
export function routineAssignmentRows(
  view: RoutineObservabilityView,
  nowIso: string,
  options: { readonly textClip?: number; readonly listClip?: number } = {},
): AssignmentRow[] {
  return view.contracts.map((c) => routineAssignmentRow(c, nowIso, options)).sort((a, b) => a.id.localeCompare(b.id));
}

/** The routine rows by state, each out of every routine contract read. */
export function routineStateCounts(rows: readonly AssignmentRow[]): readonly { readonly state: AssignmentState; readonly count: Measured }[] {
  return ASSIGNMENT_STATES.map((state) => ({
    state,
    count: measured(
      rows.filter((r) => r.state === state).length,
      rows.length,
      `routine contracts whose state is ${STATE_WORDS[state].label.toLowerCase()}, of every routine contract read`,
      "readRoutineDataObservability (production data plane), read live",
    ),
  }));
}
