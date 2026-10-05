/**
 * `pnpm reader:suite` — the reader-contract evaluation harness (WS-CONTRACT).
 *
 * ## What this ran as before, and why it had to be rebuilt (A.1 WI1–WI3)
 *
 * The Session A harness opened a browser, navigated to the base URL, read
 * `document.body.innerText`, and tested `domText.includes(expectation.text)`.
 * It never typed a question, never pressed a button, never waited for an
 * answer, and never looked at one. A page carrying the expected words
 * ANYWHERE went green while the Ask engine could have returned a fallback, the
 * wrong government, or nothing at all.
 *
 * It also never called the universe check that Session A wrote — and the only
 * denominator vocabulary that could have reached it for the governing-body
 * layer was the registry the instances are generated FROM, which agrees with
 * itself over any universe. And it computed RED verdicts that created no
 * obligation anywhere.
 *
 * Three instruments that looked enforced and were not. What runs now:
 *
 * ```
 *   1. LOAD          the owner corpus; zero questions is an AWAITING state
 *   2. GENERATE      instances against the registry, retiring expired ones
 *   3. CHECK         the universe against a denominator INDEPENDENT OF THE
 *                    GENERATED REGISTRY — before any scoring, and a
 *                    disagreement is a coverage defect that produces a typed
 *                    diagnostic WorkItem
 *
 * The precision in step 3 is Session B's (WI1.9), and it is not pedantry. The
 * denominator is independent of `registry.json`, so it catches a GENERATOR
 * REGRESSION — NH232, where a rebuild silently dropped 731 promoted bodies. It
 * is NOT independent of the project's accumulated enumeration knowledge, and
 * therefore **cannot catch a body nobody ever discovered**: such a body is
 * absent from the instances, absent from the evidence stores, and absent from
 * every term of the comparison. The hand-authored adversarial questions are
 * what covers that, which is why they are load-bearing rather than a
 * supplement to this check.
 *   4. ASK           each active instance, through the product's own Ask
 *                    interaction, exactly as a reader would
 *   5. EVALUATE      the RENDERED ANSWER against a typed proposition
 *   6. DIAGNOSE      every RED into a failure class and a persisted WorkItem
 *   7. CLOSE         every diagnostic this run's greens actually satisfy
 *   8. RECORD        one canonical run record, with every count derived
 * ```
 *
 * THE TARGET is the local build by default. A non-local `SHOOT_BASE_URL` is read
 * as `PRODUCTION_RENDER` with every write route aborted in the browser (FE-01),
 * mirrored from `walk-all.mts`; every record this script writes says which it
 * was.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { createFileRepositories } from "../lib/control-plane/repository/file-store.ts";
import type { WorkItem } from "../lib/control-plane/work-item.ts";
import { evaluateAnswer } from "../lib/health/ask-evaluation.ts";
import { containsCommit, headSha } from "../lib/ops/git-facts.ts";
import { readRunProvenance, type RunProvenance } from "../lib/ops/run-provenance.ts";
import { loadJsonArray } from "../lib/health/json-store.ts";
import {
  bodyDenominatorFor,
  divisionIndexFor,
  loadBodyEnumerationEvidence,
} from "../lib/health/body-denominator.ts";
import {
  closeSatisfiedDiagnostics,
  persistDiagnostics,
  readerDiagnostic,
} from "../lib/health/diagnostics.ts";
import { floorLine, floored } from "../lib/ops/denominator-floor.ts";
import { nextRunRecordPath } from "../lib/health/run-records.ts";
import {
  activeInstances,
  assertDenominatorIsIndependent,
  checkInstanceUniverse,
  coverageInstanceId,
  generateInstances,
  loadZipBodyUniverses,
  retireExpiredInstances,
  type CoverageDefect,
  type EvaluationTarget,
  type FailureClass,
  type InstanceResult,
  type ReaderQuestionInstance,
  type ReaderQuestionTemplate,
} from "../lib/health/reader-question.ts";
import { EVERYDAY_ZIPS } from "../lib/routing/everyday.ts";

import { askAndRead, openAskAt } from "./ask-harness.mts";
import { isLocalBase } from "../lib/ops/live-write-guard.ts";
import { launchGuarded } from "./browser.mts";
import { today } from "./doc-dates.mjs";

const AWAITING = "0 questions loaded — awaiting owner corpus";

const DEFAULT_BASE = "http://localhost:3000";
const BASE = (process.env.SHOOT_BASE_URL ?? DEFAULT_BASE).replace(/\/$/, "");

try {
  new URL(BASE);
} catch {
  console.error(`reader:suite · SHOOT_BASE_URL is not a URL: ${BASE}`);
  process.exit(1);
}
/** FE-01: a non-local target is read with every write route aborted in the browser. */
const LIVE_TARGET = !isLocalBase(BASE);
if (LIVE_TARGET) {
  console.log(
    `reader:suite · live target ${BASE}: write routes are aborted in the browser (FE-01), ` +
      "so a question that needs Ask cannot be answered on this run.",
  );
}

/** LOCAL by the refusal above. Kept as the typed value so the record says which. */
const TARGET: EvaluationTarget = LIVE_TARGET ? "PRODUCTION_RENDER" : "LOCAL_RENDER";

const ROOT = process.cwd();
const CORPUS_PATH = join(ROOT, "data", "health", "reader-questions.json");
const RUNS_DIR = join(ROOT, "data", "health", "reader-suite-runs");
const CONTROL_PLANE_ROOT = join(ROOT, "data", "control-plane", "pilot-health");

/** The tree this run measured, through the shared helper (RULING 103). */
const TESTED_SHA = headSha();

interface HarnessReach {
  readonly reached: boolean;
  readonly status: number | null;
  readonly title: string | null;
  readonly wall: string | null;
}

/** The canonical run record. Every field the contracts and the ledger read. */
interface RunRecord {
  readonly target: EvaluationTarget;
  readonly targetNote: string;
  readonly baseUrl: string;
  readonly runId: string;
  readonly testedSha: string | null;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly corpusTemplates: number;
  readonly instancesGenerated: number;
  readonly instancesActive: number;
  readonly instancesEvaluated: number;
  readonly evaluatedGreen: number;
  readonly evaluatedRed: number;
  readonly notEvaluable: number;
  readonly denominatorCheck: DenominatorCheck;
  readonly results: readonly InstanceResult[];
  readonly greenInstanceIds: readonly string[];
  readonly diagnostics: {
    readonly created: readonly string[];
    readonly existing: readonly string[];
    readonly closed: readonly string[];
  };
  readonly harness: HarnessReach;
  readonly corpusState: string | null;
  readonly provenance: RunProvenance;
}

/** What the independent universe check found, per ZIP, before any scoring. */
interface DenominatorCheck {
  readonly ran: boolean;
  /** Named when the check could not run. A missing denominator is never a pass. */
  readonly missingEvidence: string | null;
  readonly sources: readonly string[];
  readonly defects: readonly CoverageDefect[];
  /** ZIPs whose instances are NOT_EVALUABLE because no denominator exists. */
  readonly notEvaluableZips: readonly string[];
}

/**
 * The owner corpus, or null when the file is absent. Empty is loaded-empty.
 *
 * Through the shared reader (RULING 103): this and `control-set.mts` held the
 * same eleven lines, and the interesting behaviour in them is a REFUSAL.
 */
function loadCorpus(): ReaderQuestionTemplate[] | null {
  return loadJsonArray<ReaderQuestionTemplate>(CORPUS_PATH, "question templates");
}

async function main(): Promise<void> {
  const startedAt = new Date().toISOString();
  const templates = loadCorpus() ?? [];
  const corpusTemplates = templates.length;

  let generated: ReaderQuestionInstance[] = [];
  let universes: Awaited<ReturnType<typeof loadZipBodyUniverses>> = [];
  if (corpusTemplates > 0) {
    universes = await loadZipBodyUniverses(EVERYDAY_ZIPS, ROOT);
    generated = retireExpiredInstances(
      generateInstances(templates, universes, startedAt),
      startedAt,
    );
  }
  const active = activeInstances(generated);

  /*
   * ------------------------------------------------------------------
   * THE UNIVERSE CHECK RUNS BEFORE ANY SCORING. (WI2.)
   *
   * Order is the whole point. A corpus scored first and checked second can
   * report 100% green and then mention, underneath, that the universe was
   * wrong — and the green is what gets read. Checking first means a coverage
   * defect is a fact about the run rather than a footnote on it.
   * ------------------------------------------------------------------
   */
  const evidence = loadBodyEnumerationEvidence(ROOT);
  const defects: CoverageDefect[] = [];
  const notEvaluableZips: string[] = [];
  /*
   * **A DIAGNOSTIC THAT CANNOT BE CLOSED IS A DIAGNOSTIC THAT NEVER ENDS.**
   * (Session B WI1.6.)
   *
   * A coverage defect creates a WorkItem under the synthetic instance id
   * `coverage:<zip>:<layer>`, and `greenInstanceIds` was built from question
   * results alone — where that id can never appear, because no question
   * carries it. So a repaired denominator left the item open forever: the
   * defect was gone, the run was clean, and nothing in the run could say so.
   * An immortal diagnostic is worse than none, because a queue that only grows
   * stops being read.
   *
   * The clean pass is therefore RECORDED as a green for that synthetic id,
   * on the same terms as any other: only for a zip/layer whose denominator
   * actually resolved and actually agreed on THIS run. A zip that went
   * NOT_EVALUABLE for want of evidence produces no green — not knowing is not
   * the same as checking and finding nothing wrong, and closing an obligation
   * on the first is how an absence gets asserted.
   */
  const coverageGreenIds: string[] = [];
  if (corpusTemplates > 0) {
    const index = divisionIndexFor(ROOT);
    for (const universe of universes) {
      const denominator = bodyDenominatorFor(
        universe.zip,
        index[universe.zip] ?? universe.divisionIds,
        evidence,
      );
      if (denominator === null) {
        /* No independent denominator for this level at this ZIP. The instances
           are NOT green and NOT scored — they are NOT_EVALUABLE with the
           missing evidence NAMED, which is the honest third state. */
        notEvaluableZips.push(universe.zip);
        continue;
      }
      assertDenominatorIsIndependent(denominator);
      const defect = checkInstanceUniverse(generated, denominator);
      if (defect !== null) defects.push(defect);
      else coverageGreenIds.push(coverageInstanceId(universe.zip, denominator.layer));
    }
  }
  const denominatorCheck: DenominatorCheck = {
    ran: corpusTemplates > 0 && evidence.bodies !== null,
    missingEvidence: evidence.missing,
    sources: evidence.sources,
    defects,
    notEvaluableZips,
  };

  const browser = await launchGuarded({ label: "reader-suite", headless: true, blockWrites: LIVE_TARGET });
  let harness: HarnessReach;
  const results: InstanceResult[] = [];
  const diagnosticItems: WorkItem[] = [];

  try {
    const page = await browser.page();
    try {
      const response = await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 30_000 });
      harness = {
        reached: true,
        status: response ? response.status() : null,
        title: await page.title(),
        wall: null,
      };
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error))
        .replace(/\u001b\[[0-9;]*m/g, "")
        .trim();
      harness = {
        reached: false,
        status: null,
        title: null,
        wall: `the harness could not reach ${BASE}: ${message}`,
      };
    }
    await page.close();

    if (harness.reached && active.length > 0) {
      const templateById = new Map(templates.map((t) => [t.id, t]));
      const zips = [...new Set(active.map((i) => i.zip))];
      for (const zip of zips) {
        /* One seeded page per ZIP, and every question of that ZIP is asked on
           it in turn. Grouping by page is the cost saving; the answers are
           still one-per-submission because `askAndRead` will not accept the
           previous answer as this question's settled result. */
        const askPage = await openAskAt(browser, BASE, zip);
        for (const instance of active.filter((i) => i.zip === zip)) {
          if (notEvaluableZips.includes(zip)) {
            results.push({
              instanceId: instance.id,
              questionText: instance.questionText,
              verdict: {
                kind: "NOT_EVALUABLE",
                detail:
                  `no independent governing-body denominator exists for zip ${zip}: ` +
                  `${evidence.missing ?? "the enumeration evidence could not be established"}. ` +
                  "Never green, never silently scored.",
              },
            });
            continue;
          }
          const observation = await askAndRead(askPage, instance.questionText);
          const evaluated = evaluateAnswer(
            observation.answer,
            templateById.get(instance.templateId)?.expectation ?? null,
            /* The instance's own canonical subject, so a VALUE or LIST answer
               about the wrong government is an identity failure rather than a
               green. The generator already bound this id; nothing here
               re-derives it. (Session B WI1.1.) */
            { subjectBodyId: instance.subjectBodyId },
          );
          /* A wall is reported as a wall. It rides on the detail so the run
             record says the harness ran out of time rather than implying the
             product answered wrongly. */
          const verdict =
            observation.wall !== null && evaluated.verdict.kind === "RED"
              ? {
                  kind: "RED" as const,
                  detail: `${evaluated.verdict.detail} — ${observation.wall}`,
                }
              : evaluated.verdict;
          results.push({
            instanceId: instance.id,
            questionText: instance.questionText,
            verdict,
            /*
             * THE DIAGNOSED CLASS TRAVELS WITH THE RESULT. (2026-08-31.)
             *
             * It was recorded on the diagnostic WorkItem and dropped from the
             * run record, so the durable evidence said a question was RED and
             * not what KIND of failure it was. A later reader could not check
             * the diagnosis without opening the control plane — and a wrong
             * class is exactly what needed checking: every NO_EVIDENCE was
             * classed `acquisition` until 2026-08-31, including the ones where
             * nothing bound and nothing was searched.
             */
            failureClass: evaluated.failureClass,
          });
          if (verdict.kind === "RED" && evaluated.failureClass !== null) {
            diagnosticItems.push(
              readerDiagnostic(
                instance,
                evaluated.failureClass as FailureClass,
                verdict.detail,
                TESTED_SHA,
                startedAt,
              ),
            );
          }
        }
        await askPage.close();
      }
    }
  } finally {
    await browser.close();
  }

  /*
   * A coverage defect is a defect. It produces a typed diagnostic WorkItem of
   * its own, against the ZIP, so that a universe disagreement cannot be a
   * printed observation nobody owes anything about.
   */
  for (const defect of defects) {
    diagnosticItems.push(
      readerDiagnostic(
        {
          id: coverageInstanceId(defect.zip, defect.layer),
          templateId: "coverage-check",
          questionClass: "HAND_AUTHORED_ADVERSARIAL",
          zip: defect.zip,
          subjectBodyId: null,
          questionText: `Does the reader-question universe for ${defect.zip} cover every enumerated governing body?`,
          window: { notBefore: null, notAfter: null },
          status: { state: "ACTIVE" },
        },
        "linkage",
        defect.detail,
        TESTED_SHA,
        startedAt,
      ),
    );
  }

  const greenInstanceIds = [
    ...results.filter((r) => r.verdict.kind === "GREEN").map((r) => r.instanceId),
    /* The synthetic coverage ids whose denominator check passed on this run.
       Without these the closer has no id to match a coverage diagnostic
       against and the item is unclosable by construction. (WI1.6.) */
    ...coverageGreenIds,
  ];

  const repos = await createFileRepositories(CONTROL_PLANE_ROOT);
  const persisted = await persistDiagnostics(repos, diagnosticItems, startedAt);
  const closure = await closeSatisfiedDiagnostics(
    repos,
    { instrument: "READER_SUITE", testedSha: TESTED_SHA, greenInstanceIds },
    containsCommit,
    startedAt,
  );

  /* QUESTION greens only. `greenInstanceIds` also carries the synthetic
     coverage ids, which are closure evidence and not answered questions —
     counting them here would inflate the reader score with the instrument's
     own bookkeeping. */
  const evaluatedGreen = results.filter((r) => r.verdict.kind === "GREEN").length;
  const evaluatedRed = results.filter((r) => r.verdict.kind === "RED").length;
  const notEvaluable = results.filter((r) => r.verdict.kind === "NOT_EVALUABLE").length;

  const record: RunRecord = {
    target: TARGET,
    targetNote: LIVE_TARGET
      ? `PRODUCTION_RENDER: ${BASE}, read with every write route aborted in the browser (FE-01); ` +
        `${browser.writesBlocked.count} write request(s) aborted`
      : "LOCAL_RENDER: the local production build",
    baseUrl: BASE,
    runId: browser.runId,
    testedSha: TESTED_SHA,
    startedAt,
    finishedAt: new Date().toISOString(),
    corpusTemplates,
    instancesGenerated: generated.length,
    instancesActive: active.length,
    instancesEvaluated: results.length,
    evaluatedGreen,
    evaluatedRed,
    notEvaluable,
    denominatorCheck,
    results,
    greenInstanceIds,
    diagnostics: {
      created: persisted.created,
      existing: persisted.existing,
      closed: closure.closed,
    },
    harness,
    corpusState: corpusTemplates === 0 ? AWAITING : null,
    /* WHO RAN THIS. The proof class of anything this run proves is derived
       from here and nowhere else. (Session B WI1.8.) */
    provenance: readRunProvenance(TESTED_SHA),
  };
  const recordPath = nextRunRecordPath(RUNS_DIR, today());
  writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");

  /* ------------------------------------------------------------ report --- */

  console.log(
    `reader:suite · target ${record.target} · ${BASE} · run ${record.runId} · ` +
      `sha ${TESTED_SHA?.slice(0, 8) ?? "unknown"}`,
  );
  if (harness.reached) {
    console.log(
      `  harness reached the base URL: status ${harness.status ?? "unknown"}, ` +
        `title ${JSON.stringify(harness.title ?? "")}`,
    );
  } else {
    console.log(`  BOUNDARY · ${harness.wall}`);
    console.log(
      "  This is a failed retrieval with the wall named — not an empty success. " +
        "Start the local build (pnpm build; pnpm start) and re-run.",
    );
  }

  console.log(
    `\n  DENOMINATOR CHECK (before scoring): ${
      denominatorCheck.ran ? "ran" : "did not run"
    } · evidence ${denominatorCheck.sources.join(", ") || "none"}`,
  );
  if (denominatorCheck.missingEvidence) {
    console.log(`    MISSING EVIDENCE · ${denominatorCheck.missingEvidence}`);
  }
  console.log(`    ${defects.length} coverage defect(s)`);
  for (const defect of defects) console.log(`      × ${defect.detail}`);
  if (notEvaluableZips.length > 0) {
    console.log(
      `    ${notEvaluableZips.length} zip(s) NOT_EVALUABLE for want of a denominator: ` +
        notEvaluableZips.join(", "),
    );
  }

  if (corpusTemplates === 0) {
    console.log(`\n  ${AWAITING}`);
  } else {
    console.log(
      `\n  ${corpusTemplates} question template(s) loaded · ${generated.length} instance(s) ` +
        `generated · ${active.length} active`,
    );
    const evaluated = floored(
      "instances evaluated",
      "the active reader-question universe",
      active.length,
      results.length,
      active.length === 0
        ? "every generated instance is retired; nothing is active to evaluate"
        : undefined,
    );
    console.log(`  ${floorLine(evaluated)}`);
    console.log(
      `  ${evaluatedGreen} green · ${evaluatedRed} red · ${notEvaluable} not evaluable`,
    );
    for (const result of results) {
      console.log(`    ${result.verdict.kind} · ${result.instanceId} · ${result.questionText}`);
      if (result.verdict.kind !== "GREEN") console.log(`        ${result.verdict.detail}`);
    }
  }

  console.log(
    `\n  DIAGNOSTICS: ${persisted.created.length} created · ${persisted.existing.length} ` +
      `already open · ${closure.closed.length} closed by this run's greens`,
  );
  for (const id of persisted.created) console.log(`    + ${id}`);
  for (const id of closure.closed) console.log(`    - ${id} (closed)`);
  console.log(`  control plane: ${repos.describe()}`);
  console.log(`  run record: ${recordPath}`);
}

main().catch((error) => {
  console.error(`reader:suite · FAILED: ${error instanceof Error ? error.stack : String(error)}`);
  process.exit(1);
});
