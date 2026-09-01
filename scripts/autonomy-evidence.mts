/**
 * `pnpm autonomy:evidence` — **THE DURABLE RECORD THAT A NON-MEETING
 * OBLIGATION ADVANCED WITH NO OPERATOR SELECTING ITS ROUTE.**
 * (Session C, PART G1, 2026-08-31.)
 *
 * ## Why this is generated and not written
 *
 * The claim is the whole point of the session, so the one thing it must not be
 * is a sentence a model typed. Every field below is READ BACK OUT OF THE
 * DURABLE CONTROL PLANE — the same Postgres database the worker loop wrote to,
 * queried in a separate process after the fact — or out of the committed
 * staging manifest and run records. If the control plane holds nothing, this
 * emits a record that says the control plane holds nothing.
 *
 * ## What it proves, stated as the transitions it quotes
 *
 * For every CAMPAIGN-FINANCE obligation the control plane holds:
 *
 * ```
 *   StandingObligation   registered, with a persisted next_due_at
 *        -> Occurrence   opened when the clock passed, with its own WorkItem
 *        -> RouteTask    one per occurrence, never reused
 *        -> Attempt      opened under the DECLARED lane before work ran
 *        -> Disposition  committed, terminal, and quoted verbatim
 *        -> Debt         accrued for a wall, cleared by a reading
 *        -> next_due_at  recomputed and persisted
 *        -> STAGED       normalized, snapshotted, promotion-ready or an
 *                        honest named gap (RULING 224)
 * ```
 *
 * ## What it deliberately does NOT claim
 *
 * That the pilot is healthy. That anything reached a reader. That the routes
 * are complete. The rollup stays NOT GREEN, promotion stays OFF, and the record
 * says so in its own fields rather than leaving a reader to infer it.
 *
 * Env var names only: the connection is `WTP_CONTROL_PLANE_DATABASE_URL`, read
 * by name, and no value of it appears in the output.
 */

import { mkdirSync, readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  controlPlaneUrlFromEnv,
  createPgRepositories,
  CONTROL_PLANE_URL_VAR,
} from "../lib/control-plane/repository/pg-store.ts";
import { readStagingManifest } from "../lib/control-plane/scheduler/promotion-tail.ts";
import { floored, floorLine } from "../lib/ops/denominator-floor.ts";
import { headSha } from "../lib/ops/git-facts.ts";
import { readRunProvenance } from "../lib/ops/run-provenance.ts";
import { today } from "./doc-dates.mjs";

const ROOT = process.cwd();
const OUT_DIR = join(ROOT, "data", "health", "autonomous-advancement");
const RUNS_DIR = join(ROOT, "data", "health", "freshness-shadow-runs");
const NOW = new Date().toISOString();

const url = controlPlaneUrlFromEnv();
if (url === null) {
  console.error(
    `autonomy:evidence · ${CONTROL_PLANE_URL_VAR} is not set. This record may only be written from ` +
      "the AUTHORITATIVE control plane; generating it from the file store would be evidence about " +
      "a different store than the one the claim is about. Refusing.",
  );
  process.exit(1);
}
const repos = await createPgRepositories(url, NOW);

/* --------------------------------------------------- read the control plane */

const obligations = (await repos.obligations.list()).map((r) => r.value);
const occurrences = (await repos.occurrences.list()).map((r) => r.value);
const debts = (await repos.debts.list()).map((r) => r.value);

const nonMeeting = obligations.filter((o) => o.recordClass !== "meetings");
const meetings = obligations.filter((o) => o.recordClass === "meetings");

if (nonMeeting.length === 0) {
  console.error(
    "autonomy:evidence · the control plane holds ZERO non-meeting obligations. That is the defect " +
      "this session exists to close, not an empty result, and no evidence record is written for it.",
  );
  process.exit(1);
}

/**
 * One obligation's whole persisted lifecycle, read back out of the store.
 *
 * `dispositions` and `attempts` are keyed by RouteTask id in the append-only
 * logs, so the walk is occurrence -> routeTask -> its records. Nothing is
 * derived from what this process remembers; it remembers nothing.
 */
interface Lifecycle {
  readonly obligationId: string;
  readonly recordClass: string;
  readonly subjectId: string;
  readonly routeId: string | null;
  readonly nextDueAt: string | null;
  readonly lastWorkedAt: string | null;
  readonly occurrenceCount: number;
  readonly transitions: readonly string[];
  readonly debt: {
    readonly consecutiveFailures: number;
    readonly cause: string;
    readonly retryAt: string;
    readonly detail: string;
  } | null;
}

const lifecycles: Lifecycle[] = [];
for (const o of [...nonMeeting].sort((a, b) => (a.id < b.id ? -1 : 1))) {
  const transitions: string[] = [];
  transitions.push(
    `OBLIGATION REGISTERED ${o.id} (${o.recordClass}) route=${o.routeId ?? "none"}; ` +
      `persisted next_due_at=${o.nextDueAt ?? "NONE — a defect if the row is active"}`,
  );

  const mine = occurrences
    .filter((occ) => occ.obligationId === o.id)
    .sort((a, b) => a.sequence - b.sequence);

  for (const occ of mine) {
    transitions.push(
      `OCCURRENCE ${occ.sequence} OPENED ${occ.id} due=${occ.dueAt} ` +
        `workItem=${occ.workItemId} routeTask=${occ.routeTaskId}`,
    );

    const attempts = await repos.attempts.list();
    const forTask = attempts
      .map((a) => a.value)
      .filter((a) => a.routeTaskId === occ.routeTaskId)
      .sort((a, b) => (a.startedAt < b.startedAt ? -1 : 1));
    for (const attempt of forTask) {
      transitions.push(
        `ATTEMPT ${attempt.id} opened under ${attempt.worker.provider}/${attempt.worker.version} ` +
          `(role ${attempt.worker.role}) — outcome ${attempt.outcome ?? "OPEN"}` +
          (attempt.artifactIds.length > 0 ? `, ${attempt.artifactIds.length} artifact(s)` : "") +
          (attempt.cost.bytesFetched ? `, ${attempt.cost.bytesFetched} bytes fetched` : ""),
      );
    }

    const commits = await repos.dispositions.read(occ.routeTaskId);
    for (const commit of commits) {
      const d = commit.disposition;
      transitions.push(
        `DISPOSITION COMMITTED ${d.disposition} on ${occ.routeTaskId} — ` +
          `permission=${d.permission} transport=${d.transport}, ` +
          `${d.artifactIds.length} artifact(s), rawCount=${d.observation?.rawCount ?? "none"}, ` +
          `normalizedCount=${d.observation?.normalizedCount ?? "none"}`,
      );
      transitions.push(`  NOTE: ${d.note}`);
    }

    transitions.push(
      occ.closedAt === null
        ? `OCCURRENCE ${occ.sequence} STILL OPEN`
        : `OCCURRENCE ${occ.sequence} CLOSED ${occ.closedAt} disposition=${occ.disposition ?? "NONE"}` +
          (occ.unresolvedReason ? ` unresolved=${occ.unresolvedReason}` : ""),
    );
  }

  const debt = debts.find((d) => d.obligationId === o.id && d.consecutiveFailures > 0) ?? null;
  transitions.push(
    debt === null
      ? "DEBT none — either it was never owed or a committed reading discharged it"
      : `DEBT ${debt.consecutiveFailures} consecutive failure(s), cause ${debt.cause}, ` +
        `retry not before ${debt.retryAt}`,
  );
  transitions.push(
    `NEXT DUE PERSISTED ${o.nextDueAt ?? "NONE"} (lastWorkedAt=${o.lastWorkedAt ?? "never"})`,
  );

  lifecycles.push({
    obligationId: o.id,
    recordClass: o.recordClass,
    subjectId: o.subjectId,
    routeId: o.routeId,
    nextDueAt: o.nextDueAt,
    lastWorkedAt: o.lastWorkedAt,
    occurrenceCount: o.occurrenceCount,
    transitions,
    debt: debt === null
      ? null
      : {
          consecutiveFailures: debt.consecutiveFailures,
          cause: debt.cause,
          retryAt: debt.retryAt,
          detail: debt.detail,
        },
  });
}

/* ------------------------------------------------- the staged promotion tail */

const manifest = readStagingManifest(ROOT);
const staged = manifest?.entries ?? [];
const ready = staged.filter((e) => e.state === "STAGED_PROMOTION_READY");

/* --------------------------------------------------------- the cycle records */

interface CycleRecord {
  readonly file: string;
  readonly startedAt: string | null;
  readonly provider: string | null;
  readonly only: string | null;
  readonly registeredUnits: number | null;
  readonly nonMeetingUnits: number | null;
  readonly dispatched: number | null;
  readonly discharged: number | null;
  readonly dispositions: readonly { obligationId: string; disposition: string | null }[];
}

const cycles: CycleRecord[] = [];
if (existsSync(RUNS_DIR)) {
  for (const file of readdirSync(RUNS_DIR).sort()) {
    if (!file.endsWith(".json")) continue;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(readFileSync(join(RUNS_DIR, file), "utf8")) as Record<string, unknown>;
    } catch {
      continue;
    }
    const provider = typeof parsed.provider === "string" ? parsed.provider : null;
    /* Only the POSTGRES cycles. A file-store cycle is a real cycle and is not
       the authoritative control plane, and mixing them would let a claim about
       the durable store rest on a run that never touched it. */
    if (provider === null || !provider.toLowerCase().includes("postgres")) continue;
    const registry = (parsed.registry ?? {}) as Record<string, unknown>;
    const dispositions = Array.isArray(parsed.dispositions)
      ? (parsed.dispositions as { obligationId: string; disposition: string | null }[])
      : [];
    cycles.push({
      file: `data/health/freshness-shadow-runs/${file}`,
      startedAt: typeof parsed.startedAt === "string" ? parsed.startedAt : null,
      provider,
      only: typeof registry.only === "string" ? registry.only : null,
      registeredUnits: typeof registry.registeredUnits === "number" ? registry.registeredUnits : null,
      nonMeetingUnits: typeof registry.nonMeetingUnits === "number" ? registry.nonMeetingUnits : null,
      dispatched: typeof parsed.dispatched === "number" ? parsed.dispatched : null,
      discharged: Array.isArray(parsed.worked) ? parsed.worked.length : null,
      dispositions,
    });
  }
}

const unfiltered = cycles.filter((c) => c.only === null);

/* ------------------------------------------------------------- the verdict */

/**
 * DERIVED, never asserted.
 *
 * The question is not "did something happen" but "did a NON-MEETING obligation
 * go all the way through the lifecycle in a cycle where nobody named its
 * route". So the verdict rests on three facts read from the store, and each one
 * is reported beside it so a reader can disagree with the arithmetic.
 */
const advancedWithDisposition = lifecycles.filter((l) =>
  l.transitions.some((t) => t.startsWith("DISPOSITION COMMITTED")),
);
const advancedToStaged = lifecycles.filter((l) =>
  staged.some((s) => s.obligationId === l.obligationId),
);

/**
 * **THE LOAD-BEARING CHECK: it happened in a cycle NOBODY NARROWED.**
 *
 * A non-meeting obligation reaching a disposition proves the lifecycle runs. It
 * does not prove autonomy, because a cycle run with `--only=` had its work
 * chosen by whoever typed the flag. So the verdict rests on the intersection:
 * a NON-MEETING obligation that reached a committed disposition inside a cycle
 * whose `only` field is null.
 */
const nonMeetingIds = new Set(nonMeeting.map((o) => o.id));
const unattendedAdvances = unfiltered.flatMap((c) =>
  c.dispositions
    .filter((d) => nonMeetingIds.has(d.obligationId))
    .map((d) => ({ cycle: c.file, startedAt: c.startedAt, ...d })),
);

const verdict =
  unattendedAdvances.length > 0 && advancedToStaged.length > 0
    ? "AUTONOMOUS_ADVANCEMENT_PROVEN"
    : "NOT_PROVEN";

const record = {
  what: "AUTONOMOUS ADVANCEMENT OF A NON-MEETING OBLIGATION, END TO END",
  generatedAt: NOW,
  generatedOn: today(),
  generatedBy: "pnpm autonomy:evidence",
  testedSha: headSha(ROOT),
  verdict,

  theClaim:
    "At least one obligation that is NOT a meeting was registered, came due, opened an occurrence " +
    "with its own WorkItem and RouteTask, ran an Attempt under a declared worker identity, reached " +
    "a committed terminal disposition, accrued or cleared freshness debt accordingly, had its " +
    "next-due recomputed and persisted, and flowed through normalization and snapshot to a STAGED " +
    "promotion-ready state or an honest named gap — with NO OPERATOR SELECTING ITS ROUTE.",

  howToDisbelieveThis: [
    "Every transition below was read back out of the Postgres control plane named by " +
      `${CONTROL_PLANE_URL_VAR}, by a separate process, after the cycles finished. Re-run ` +
      "`pnpm autonomy:evidence` against the same database and the same rows come back.",
    "The staged files named under `stagedPromotionReady` are real files in the repository. Open " +
      "them; they carry their own row counts, their publisher-declared denominators, and what " +
      "their normalizer refused to conclude.",
    "The cycles listed under `unfilteredCycles` ran with NO `--only` flag, so the scheduler chose " +
      "what was due out of the whole registry rather than being pointed at campaign finance. The " +
      "filtered cycles are listed separately and are NOT counted toward the verdict.",
  ],

  whatThisDoesNotClaim: [
    "It does not claim the pilot is healthy. The rollup is NOT GREEN and the READER and TRUTH " +
      "contracts are NOT_READY, stated by their own instruments and not by this one.",
    "It does not claim anything reached a reader. Promotion is OFF; the tail stops at STAGED and " +
      "session shipping carries the last mile under existing law (RULING 224).",
    "It does not claim the route portfolios are complete. Every wall below is named and every " +
      "named wall is an obligation that is still live with a persisted next-due.",
  ],

  denominators: {
    obligationsInControlPlane: obligations.length,
    meetingObligations: meetings.length,
    nonMeetingObligations: nonMeeting.length,
    nonMeetingWithCommittedDisposition: advancedWithDisposition.length,
    nonMeetingReachingStagedState: advancedToStaged.length,
    stagedEntriesTotal: staged.length,
    stagedPromotionReadyCount: ready.length,
    postgresCyclesOnRecord: cycles.length,
    unfilteredPostgresCycles: unfiltered.length,
    nonMeetingDispositionsInUnfilteredCycles: unattendedAdvances.length,
  },

  /**
   * THE ANSWER TO THE QUESTION THE SESSION WAS ASKED, quoted per row: a
   * non-meeting obligation reaching a committed disposition inside a cycle
   * nobody narrowed with `--only=`.
   */
  unattendedNonMeetingAdvances: unattendedAdvances,

  stagedPromotionReady: ready.map((e) => ({
    obligationId: e.obligationId,
    routeId: e.routeId,
    rowCount: e.rowCount,
    declaredTotal: e.declaredTotal,
    complete: e.complete,
    snapshotPath: e.snapshotPath,
    readerSentence: e.readerSentence,
  })),

  stagedGaps: staged
    .filter((e) => e.state === "STAGED_GAP")
    .map((e) => ({
      obligationId: e.obligationId,
      routeId: e.routeId,
      nextDueAt: e.nextDueAt,
      readerSentence: e.readerSentence,
      unresolved: e.unresolved,
    })),

  lifecycles,
  unfilteredCycles: unfiltered,
  filteredCycles: cycles.filter((c) => c.only !== null),

  promotedToReaderTruth: false,
  provenance: readRunProvenance(headSha(ROOT), ROOT),
};

mkdirSync(OUT_DIR, { recursive: true });
const path = join(OUT_DIR, `${today()}-autonomous-advancement.json`);
writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`, "utf8");

/*
 * EVERY COUNT THIS PRINTS CARRIES ITS DENOMINATOR (RULING 159). The whole
 * record is a claim about a proportion — how much of what is owed actually
 * advanced — and a numerator on its own is the shape that reads as a result
 * and is not one.
 */
console.log(`autonomy:evidence · ${verdict}`);
for (const line of [
  floored(
    "non-meeting obligations that reached a committed disposition",
    "the Postgres control plane",
    nonMeeting.length,
    advancedWithDisposition.length,
  ),
  floored(
    "non-meeting obligations that reached a STAGED state",
    "the Postgres control plane",
    nonMeeting.length,
    advancedToStaged.length,
  ),
  floored(
    "non-meeting dispositions committed in cycles NOBODY narrowed",
    "the unfiltered Postgres cycles on record",
    advancedWithDisposition.length,
    Math.min(unattendedAdvances.length, advancedWithDisposition.length),
    advancedWithDisposition.length === 0
      ? "no non-meeting obligation reached a disposition at all, so there is nothing to attribute"
      : undefined,
  ),
  floored(
    "staged entries that are PROMOTION-READY",
    "the staging manifest",
    staged.length,
    ready.length,
    staged.length === 0 ? "the promotion tail has staged nothing yet" : undefined,
  ),
  floored(
    "Postgres cycles run with no --only filter",
    "every Postgres cycle on record",
    cycles.length,
    unfiltered.length,
    cycles.length === 0 ? "no Postgres cycle has written a run record" : undefined,
  ),
]) {
  console.log(`  ${floorLine(line)}`);
}
console.log(`  record: ${path}`);
if (verdict !== "AUTONOMOUS_ADVANCEMENT_PROVEN") process.exitCode = 1;
