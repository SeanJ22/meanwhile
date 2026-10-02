/**
 * `pnpm ask:model-compare` — **THE ASK MODEL COMPARISON, MEASURED.**
 * (Session C, lane H2, 2026-08-31.)
 *
 * ## What this settles, and why NOT_MEASURED was not allowed to stand
 *
 * `lib/ask/model-economics.ts` wrote the rule down — *switch only if every
 * question holds* — and reported the comparison
 * itself as `NOT_MEASURED`. That module's own header says what that means:
 *
 * > NOT_MEASURED means the comparison is still owed — the obligation stays
 * > live, exactly as a blocked route never closes a record obligation.
 *
 * The owner ruled that it is not terminal. So this script runs it.
 *
 * ## The shape, and every step of it is a refusal to guess
 *
 * ```
 *   the canonical corpus            data/health/reader-questions.json, 7 rows
 *   the evidence pack               built by the PRODUCT, per question, on a
 *                                   LOCAL PRODUCTION BUILD (RULING 125)
 *   one pack, two arms              incumbent and challenger, same pack,
 *                                   proven by digest and not by assertion
 *   the grader                      lib/ask/validate.ts for GROUNDING,
 *                                   lib/health/ask-evaluation.ts for the
 *                                   owner's typed proposition
 *   the verdict                     switchVerdict(), DERIVED from the runs
 * ```
 *
 * **The evidence pack is the product's own.** Nothing here retrieves records,
 * resolves a subject or names a gap: the route does all of that, and the pack
 * is reconstructed from the answer payload it returns — the same records, the
 * same gaps, the same subject, the same denominators, the same intent and
 * tense off the trace. Rebuilding retrieval in a harness would compare two
 * models on evidence the product does not produce.
 *
 * **The two arms get the identical pack, and that is CHECKED.** One pack
 * object, two calls, and `shownPromptDigest` over the rendered system prompt,
 * context payload and question payload for each arm. A row whose digests
 * differ is VOID and reported as void — the constraint's own words: *if the
 * packs differ the comparison is void.*
 *
 * **The grader is the repository's, not this script's.** `validateAnswer` is
 * the same function the production route runs, given the same known-subject
 * universe the route builds — so an invented source URL fails here exactly as
 * it fails a reader's request, and prose naming a different known government
 * fails mechanically (NH288). `evaluateAnswer` is the reader contract's own
 * typed evaluator. Nothing is judged by eye.
 *
 * **The cache is disabled on both arms**, and `lib/ask/model-comparison.ts`
 * holds the three reasons. The short one: a cache read prices a model by
 * arrival order rather than by rate, and the two columns have to be on one
 * basis. Cold is the only basis both can share.
 *
 * ## The refusals
 *
 * Both are inherited from `scripts/ask-cache-probe.mts` because they are the
 * same boundaries: a non-local target is refused (RULING 125), and a missing
 * `ANTHROPIC_API_KEY` is a WALL — a fact about this machine, named, never a
 * result about a model. A run that reaches zero rows is a FAILED run and exits
 * non-zero; it is never an empty success.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { AskIntent, AskTemporal } from "../lib/ask/intent.ts";
import type { EvidenceGap, EvidencePack, EvidenceRecord, EvidenceSubject } from "../lib/ask/evidence.ts";
import { canonicalBodyIdentity } from "../lib/ask/body-identity.ts";
import { sourceLinks } from "../lib/ask/host.ts";
import { interpretWithoutModel } from "../lib/ask/interpret.ts";
import { snapshotEntities } from "../lib/ask/inventory.ts";
import {
  callUsd,
  comparabilityFailure,
  shownPromptDigest,
  synthesizeForComparison,
  type ComparisonOutcome,
} from "../lib/ask/model-comparison.ts";
import {
  ASK_CHALLENGER_MODEL,
  ASK_INCUMBENT_MODEL,
  ASK_MODEL_RATES,
  challengerQuestionsNotHolding,
  relativeNonRegressionAnalysis,
  switchVerdict,
  type QuestionRun,
  type SwitchVerdict,
} from "../lib/ask/model-economics.ts";
import { ASK_EFFORT_LEVELS, resolveAskEffort, type AskEffort } from "../lib/ask/model.ts";
import { modelRefusal } from "../lib/models.ts";
import { batchEnabledFor } from "../lib/control-plane/model-batch.ts";
import { validateAnswer, type KnownSubjectName } from "../lib/ask/validate.ts";
import {
  evaluateAnswer,
  type ReaderExpectation,
  type RenderedAnswer,
} from "../lib/health/ask-evaluation.ts";
import { divisionIndexFor } from "../lib/health/body-denominator.ts";
import { loadJsonArray } from "../lib/health/json-store.ts";
import { readSnapshot } from "../lib/meetings/snapshot.ts";
import { headSha } from "../lib/ops/git-facts.ts";
import { refreshRegistryRuntimeFromPromoted } from "../lib/registry/runtime-read-model.ts";

import { today } from "./doc-dates.mjs";

const DEFAULT_BASE = "http://localhost:3000";
const BASE = (process.env.SHOOT_BASE_URL ?? DEFAULT_BASE).replace(/\/$/, "");
const ROOT = process.cwd();
const RUNS_DIR = join(ROOT, "data", "health", "ask-model-compare-runs");

/**
 * **`--regenerate <record>` — RE-DERIVE THE VERDICT FROM RECORDED RUNS.**
 * (RULING 230, RULING 92, RULING 102, 2026-09-01.)
 *
 * The 2026-08-31 record was written by the generator this script used to be,
 * and it carries a verdict RULING 230 supersedes. **A generated artifact is
 * never hand-edited (RULING 92), and fixing a generator is not finished until
 * its output is regenerated and diffed (RULING 102)** — so the fix is a second
 * ENTRY POINT into the same derivation, not an editor.
 *
 * This mode reads an existing record's `rows` — the raw per-pass arm results,
 * which are the MEASUREMENT and are not re-derived — and re-runs every derived
 * field over them: the comparable set, the two `QuestionRun` lists, the
 * canonical `switchVerdict`, the relative diagnostic, and the decision. It
 * makes NO network call and grades nothing again, so it cannot invent a
 * measurement; it can only recompute what the measurement implies under the
 * current rule.
 *
 *   pnpm ask:model-compare --regenerate data/health/ask-model-compare-runs/<f>.json
 */
const REGENERATE = (() => {
  const argv = process.argv.slice(2);
  const at = argv.indexOf("--regenerate");
  if (at === -1) return null;
  const path = argv[at + 1];
  if (!path) {
    console.error("ask:model-compare · --regenerate needs the path of a run record");
    process.exit(1);
  }
  return path;
})();

/**
 * **THE TWO ARMS, NAMEABLE.** (ITEM K §6, 2026-09-01.)
 *
 * They defaulted to `ASK_INCUMBENT_MODEL` and `ASK_CHALLENGER_MODEL` and still
 * do. The flags exist because a comparison harness whose arms are compile-time
 * constants can only ever measure one comparison, and the moment a switch
 * LANDS those two constants stop naming two different models — the harness
 * would then run the incumbent against itself and report a verdict on a
 * degenerate run rather than refusing it.
 *
 * §6 requires the incumbent measured on the current request shape and the
 * challenger measured on the same shape, in one run, per question. Naming the
 * arms is what lets that run happen on either side of the switch landing.
 *
 *   pnpm ask:model-compare --incumbent claude-opus-5 --challenger claude-opus-5-5
 *
 * With no flags the arms are those two constants. Since 2026-09-23 that is Opus
 * 5 against Opus 5.5, the comparison still owed; `ASK_CHALLENGER_MODEL` says
 * why. Arms that resolve to one model are refused by name below.
 *
 * The chosen arms are written into the run record, so a later reader never has
 * to infer which two models a record compared from what the constants say
 * today.
 */
function argValue(flag: string): string | null {
  const argv = process.argv.slice(2);
  const at = argv.indexOf(flag);
  if (at === -1) return null;
  const value = argv[at + 1];
  if (!value) {
    console.error(`ask:model-compare · ${flag} needs a model id`);
    process.exit(1);
  }
  return value;
}

const INCUMBENT_ARM = argValue("--incumbent") ?? ASK_INCUMBENT_MODEL;
const CHALLENGER_ARM = argValue("--challenger") ?? ASK_CHALLENGER_MODEL;

/**
 * **`--effort <level>` — THE EFFORT SWEEP'S ONE VARIABLE.** (ITEM K §4.)
 *
 * Applied to BOTH arms, so a sweep row varies effort and nothing else. Absent,
 * the request is built with the resolved production effort — which is what
 * every ordinary run must measure, so the default behaviour is untouched.
 *
 * Effort defaults to `high` server-side when the field is omitted and thinking
 * tokens bill at the OUTPUT rate, so the levels are not a quality dial with a
 * free bottom end: each one has to be measured for what it costs as well as
 * for what it answers. The brief's rule is the reason this flag exists rather
 * than a chosen constant — *do not pick one on reasoning alone.*
 */
const SWEEP_EFFORT = (() => {
  const raw = argValue("--effort");
  if (raw === null) return undefined;
  if (!(ASK_EFFORT_LEVELS as readonly string[]).includes(raw)) {
    console.error(
      `ask:model-compare · --effort ${raw} is not one of ${ASK_EFFORT_LEVELS.join(", ")}`,
    );
    process.exit(1);
  }
  return raw as AskEffort;
})();

/**
 * **`--no-record` — measure without writing a run record.**
 *
 * A sweep is a diagnostic over one variable, not a switch decision, and every
 * sweep level writing a `data/health/ask-model-compare-runs/` record would
 * bury the one record that IS the decision under four that are not. The
 * console output is the sweep's evidence; the switch record is written by the
 * ordinary run.
 */
const NO_RECORD = process.argv.slice(2).includes("--no-record");

/**
 * **THE BATCH FLAG.** (2026-09-06.) `WTP_ASK_COMPARE_BATCH=1` routes every arm
 * through the Message Batches API at half price and waits for the batch to
 * end; anything else keeps the synchronous transport. The lane is registered
 * in `lib/control-plane/model-batch.ts`; activation is the owner's decision
 * (RULING 277), which is why the default is off and the run record says
 * which route ran.
 */
const COMPARE_BATCH = batchEnabledFor("ask-model-comparison");
// Explicit command-line arms still make new paid requests. Historical run
// records retain old IDs; a new run cannot send the replaced Sonnet 5 tier.
if (!REGENERATE) {
  for (const model of [INCUMBENT_ARM, CHALLENGER_ARM]) {
    const refusal = modelRefusal(model);
    if (refusal) {
      console.error(`ask:model-compare REFUSED - ${refusal}`);
      process.exit(1);
    }
  }
}
if (COMPARE_BATCH) console.log("ask:model-compare · BATCH route ON (WTP_ASK_COMPARE_BATCH): every arm goes through /v1/messages/batches at half price and waits for the batch to end");

/* A run whose arms are the same model measures nothing and would print a
   verdict about a comparison that did not happen. Refused by name. */
if (!REGENERATE && INCUMBENT_ARM === CHALLENGER_ARM) {
  console.error(
    [
      "",
      `ask:model-compare · REFUSED — both arms are ${INCUMBENT_ARM}.`,
      "",
      "  A model compared against itself is not a comparison, and a verdict derived from one",
      "  would read as a result about two models. Name the arms:",
      "",
      "    pnpm ask:model-compare --incumbent <model> --challenger <model>",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

/* ── refusal 1: the target must be local (RULING 125) ────────────────────── */

if (!REGENERATE) {
  let host: string;
  try {
    host = new URL(BASE).hostname;
  } catch {
    console.error(`ask:model-compare · SHOOT_BASE_URL is not a URL: ${BASE}`);
    process.exit(1);
  }
  const local = host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
  if (!local) {
    console.error(
      [
        "",
        `ask:model-compare · REFUSED — the target is ${host}, which is not a local build.`,
        "",
        "  RULING 125: every walk and check runs against the LOCAL production build.",
        "",
      ].join("\n"),
    );
    process.exit(1);
  }
}

/* ── refusal 2: no credential is a WALL, never a result ──────────────────── */

if (!REGENERATE && !process.env.ANTHROPIC_API_KEY) {
  console.error(
    [
      "",
      "ask:model-compare · BOUNDARY — ANTHROPIC_API_KEY is not set in this environment.",
      "",
      "  Neither arm can reach the synthesis contract, so every question would report",
      "  UNAVAILABLE and the comparison would read as a result about the models. It is a",
      "  fact about this machine.",
      "",
      "  This is a failed measurement with the wall named — not a HOLD and not a SWITCH.",
      "  Set the variable (the NAME only ever appears here; no value is read, logged or",
      "  written by this script) and re-run.",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

/* ── the corpus ──────────────────────────────────────────────────────────── */

interface QuestionTemplate {
  readonly id: string;
  readonly questionClass: string;
  readonly templateText: string;
  readonly applicability: { readonly kind: string; readonly zips?: readonly string[] };
  readonly expectation?: ReaderExpectation;
}

/* ── the pack, as the PRODUCT built it ───────────────────────────────────── */

interface AskReply {
  mode: string;
  subject: EvidenceSubject | null;
  answer: string | null;
  records: EvidenceRecord[];
  gaps: EvidenceGap[];
  denominators: Record<string, number>;
  trace?: {
    interpretation?: { intent?: AskIntent; temporal?: AskTemporal; ran?: boolean };
    synthesis?: { ran?: boolean; why?: string; model?: string; ms?: number };
    validation?: { ran?: boolean; passed?: boolean; failed?: string[] };
  };
}

/**
 * The reader's own request, made against the local production build.
 *
 * `origin` is set because the route refuses a cross-origin submission and a
 * harness that skipped the check would exercise a path readers do not.
 * `x-wtp-synthetic-run` is required of every automated request to a running
 * build: an undeclared one counts as reader signal in a store the business
 * sells from.
 */
async function askProduct(question: string, ocdIds: readonly string[]): Promise<AskReply> {
  const response = await fetch(`${BASE}/api/ask/grounded`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: BASE,
      "x-wtp-synthetic-run": `ask-model-compare-${today()}`,
      "cache-control": "no-cache",
    },
    body: JSON.stringify({ question, ocdIds: [...ocdIds], today: today() }),
  });
  if (!response.ok) throw new Error(`/api/ask/grounded answered HTTP ${response.status}`);
  return (await response.json()) as AskReply;
}

/**
 * The pack the route built, rebuilt from what it returned.
 *
 * Every field is the route's own. Two of them need the route's own rule
 * applied rather than a value read straight off the wire, and both are
 * reproduced from the route's source rather than guessed:
 *
 * - **intent**, when the interpretation rung fell back: the route then calls
 *   `interpretWithoutModel(question)`, so this calls the same function.
 * - **intent**, when the topic sweep fired: the route sets `UNKNOWN` to
 *   `AGENDA_TOPIC` AFTER writing the trace, so the trace can read `UNKNOWN`
 *   where the pack said `AGENDA_TOPIC`. The sweep's own denominator key is the
 *   mechanical tell, and the route's condition is copied exactly.
 *
 * Anything this cannot reconstruct is a REFUSAL, not a default — see the
 * caller.
 */
function rebuildPack(question: string, reply: AskReply): EvidencePack {
  const traced = reply.trace?.interpretation ?? {};
  const deterministic = interpretWithoutModel(question);
  let intent: AskIntent = traced.intent ?? deterministic.intent;
  const temporal: AskTemporal = traced.temporal ?? deterministic.temporal;
  if (intent === "UNKNOWN" && reply.denominators?.agendasSweptForTopic !== undefined) {
    intent = "AGENDA_TOPIC";
  }
  return {
    question,
    intent,
    temporal,
    subject: reply.subject ?? null,
    records: reply.records ?? [],
    gaps: reply.gaps ?? [],
    denominators: reply.denominators ?? {},
    today: today(),
  };
}

/**
 * What the Ask panel WOULD render, given this pack and this prose.
 *
 * Mirrored from `components/ask/ask-box.tsx` clause for clause, because the
 * reader-contract evaluator judges what a reader can read and nothing else:
 * record lines render only when there is NO prose, each gap renders its own
 * attribution, and the source count is one per PUBLISHER rather than one per
 * link. Reproducing the panel's rules is what makes an evaluation of this
 * comparison an evaluation of the product.
 */
function renderedFor(pack: EvidencePack, answer: string | null, passed: boolean): RenderedAnswer {
  return {
    mode: answer !== null && passed ? "GROUNDED_CLAUDE" : "REJECTED_FELL_BACK",
    subjectId: pack.subject?.id ?? null,
    subjectName: pack.subject?.name ?? null,
    answerText: answer !== null && passed ? answer : null,
    recordTexts:
      answer !== null && passed
        ? []
        : pack.records.filter((r) => r.kind !== "CONTACT").slice(0, 8).map((r) => r.text),
    gapAttributions: pack.gaps.map((g) => g.whose),
    gapStatements: pack.gaps.map((g) => g.statement),
    sourceCount: sourceLinks(pack.records).length,
    panelAbsent: false,
  };
}

/* ── one arm ─────────────────────────────────────────────────────────────── */

interface ArmResult {
  readonly model: string;
  readonly digest: string;
  readonly ran: boolean;
  readonly why: string | null;
  readonly answer: string | null;
  readonly citedUrls: readonly string[];
  /** GROUNDING: the production validator, with the production subject universe. */
  readonly groundingPassed: boolean | null;
  readonly groundingFailed: readonly string[];
  readonly groundingChecked: readonly string[];
  /** CORRECTNESS: the owner's typed proposition, where the corpus states one. */
  readonly correctness: "GREEN" | "RED" | "NOT_EVALUABLE" | null;
  readonly correctnessDetail: string | null;
  readonly ms: number | null;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly cacheReadInputTokens: number | null;
  readonly cacheCreationInputTokens: number | null;
  readonly usd: number | null;
}

async function runArmOnce(
  pack: EvidencePack,
  model: string,
  bodies: readonly KnownSubjectName[],
  expectation: ReaderExpectation | null,
): Promise<ArmResult> {
  const digest = shownPromptDigest(pack);
  const outcome: ComparisonOutcome = await synthesizeForComparison(pack, model, {
    effort: SWEEP_EFFORT,
    /* The batch route (2026-09-06): OFF unless WTP_ASK_COMPARE_BATCH says otherwise; RULING 277 keeps activation the owner's. */
    batch: COMPARE_BATCH,
  });
  if (outcome.kind !== "WROTE") {
    return {
      model,
      digest,
      ran: false,
      why: outcome.detail ? `${outcome.why}: ${outcome.detail}` : outcome.why,
      answer: null,
      citedUrls: [],
      groundingPassed: null,
      groundingFailed: [],
      groundingChecked: [],
      correctness: null,
      correctnessDetail: null,
      ms: outcome.ms,
      inputTokens: null,
      outputTokens: null,
      cacheReadInputTokens: null,
      cacheCreationInputTokens: null,
      usd: null,
    };
  }

  const verdict = validateAnswer(outcome.answer, outcome.citedUrls, pack, bodies);
  const passed = verdict.kind === "PASSED";
  const evaluated = evaluateAnswer(
    renderedFor(pack, outcome.answer, passed),
    expectation,
    { subjectBodyId: pack.subject?.id ?? null },
  );

  return {
    model,
    digest,
    ran: true,
    why: null,
    answer: outcome.answer,
    citedUrls: outcome.citedUrls,
    groundingPassed: passed,
    groundingFailed: verdict.kind === "FAILED" ? verdict.failed : [],
    groundingChecked: verdict.checked,
    correctness: evaluated.verdict.kind,
    correctnessDetail:
      evaluated.verdict.kind === "GREEN" ? null : (evaluated.verdict.detail ?? null),
    ms: outcome.ms,
    inputTokens: outcome.usage.inputTokens,
    outputTokens: outcome.outputTokens,
    cacheReadInputTokens: outcome.usage.cacheReadInputTokens,
    cacheCreationInputTokens: outcome.usage.cacheCreationInputTokens,
    usd: callUsd(model, outcome.usage, outcome.outputTokens, outcome.batch),
  };
}

/**
 * **ONE DRAW IS NOT A MEASUREMENT.** (Found on the 2026-08-31 run, and it is
 * the reason this parameter exists.)
 *
 * The first two runs of this comparison disagreed with each other. On Q3 the
 * challenger failed the ASK-19 length budget at 804 characters on one pass and
 * passed at 415 on the next; the incumbent failed at 761 and then at 759. A
 * synthesis rung is a sampled generator, the length budget is a threshold, and
 * a comparison that draws once per model reports which side of the threshold
 * two samples happened to land on. Reported as "the model holds", that is a
 * claim about a model made out of a coin flip.
 *
 * So each arm is run `passes` times over the SAME pack, and an arm HOLDS a
 * question only when EVERY pass held. That is the conservative direction on
 * purpose: *correct first, fast second.* A model that fails one pass in three
 * fails a question this product may never be wrong about, and averaging the
 * three would let two right answers pay for a wrong one — exactly what the
 * switch rule's own header refuses.
 *
 * The default is 3 rather than 1 for the same reason. `ASK_COMPARE_PASSES`
 * raises it; nothing lowers it below 1, and 1 is recorded in the run record so
 * a later reader can see the sample size the verdict rests on.
 */
const PASSES = (() => {
  const raw = Number(process.env.ASK_COMPARE_PASSES ?? "3");
  return Number.isInteger(raw) && raw >= 1 ? raw : 3;
})();

/** Every pass of one arm on one question, plus what the passes agree on. */
interface ArmSummary {
  readonly model: string;
  readonly passes: readonly ArmResult[];
  /** How many passes ran at all, and how many of those held. */
  readonly ranCount: number;
  readonly heldCount: number;
  /** Distinct digests across the passes. One means every pass saw one prompt. */
  readonly digests: readonly string[];
  readonly usdTotal: number | null;
  readonly inputTokens: number | null;
  readonly outputTokensMean: number | null;
  readonly msMean: number | null;
}

async function runArm(
  pack: EvidencePack,
  model: string,
  bodies: readonly KnownSubjectName[],
  expectation: ReaderExpectation | null,
): Promise<ArmSummary> {
  const passes: ArmResult[] = [];
  for (let i = 0; i < PASSES; i += 1) {
    passes.push(await runArmOnce(pack, model, bodies, expectation));
  }
  const ran = passes.filter((p) => p.ran);
  const usd = ran.map((p) => p.usd).filter((v): v is number => v !== null);
  const out = ran.map((p) => p.outputTokens).filter((v): v is number => v !== null);
  const ms = ran.map((p) => p.ms).filter((v): v is number => v !== null);
  const mean = (xs: number[]) => (xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  return {
    model,
    passes,
    ranCount: ran.length,
    heldCount: passes.filter((p) => heldOnce(p) === true).length,
    digests: [...new Set(passes.map((p) => p.digest))],
    usdTotal: usd.length > 0 ? usd.reduce((a, b) => a + b, 0) : null,
    /* Input tokens are a property of the PACK and are identical across passes;
       a mean would imply a spread that does not exist. */
    inputTokens: ran[0]?.inputTokens ?? null,
    outputTokensMean: mean(out),
    msMean: mean(ms),
  };
}

/**
 * Did this arm hold the question across EVERY pass?
 *
 * `null` when no pass ran — neither a pass nor a failure, and `switchVerdict`
 * is three-valued precisely so an unmeasured question cannot be counted as
 * either. A partial — some passes ran, some did not — is a FAILURE rather than
 * a null: a model that could not be made to answer on one draw has not held
 * the question, and treating that as unmeasured would let an intermittent
 * failure buy itself an open obligation instead of a verdict.
 */
function held(arm: ArmSummary): boolean | null {
  if (arm.ranCount === 0) return null;
  return arm.ranCount === arm.passes.length && arm.heldCount === arm.passes.length;
}

/**
 * Did this arm HOLD on this question?
 *
 * Two axes, and both must be affirmative. Grounding is checkable on every
 * question and is the one that matters — a claim that does not trace to the
 * pack is the failure this product cannot survive. Correctness is checkable
 * only where the owner stated a typed proposition; `NOT_EVALUABLE` is neither
 * a pass nor a fail on that axis, and it is REPORTED rather than folded away.
 *
 * `null` means the arm never ran, which is neither. `switchVerdict` refuses to
 * treat a null as either a pass or a failure, which is the whole reason it is
 * a three-valued field.
 */
function heldOnce(arm: ArmResult): boolean | null {
  if (!arm.ran) return null;
  if (arm.groundingPassed !== true) return false;
  if (arm.correctness === "RED") return false;
  return true;
}

/* ── the run ─────────────────────────────────────────────────────────────── */

interface Row {
  readonly questionId: string;
  readonly zip: string;
  readonly question: string;
  readonly packMode: string;
  readonly packRecords: number;
  readonly packGaps: number;
  readonly packSources: number;
  readonly packSubjectId: string | null;
  readonly packSubjectName: string | null;
  readonly packDigest: string;
  readonly packsIdentical: boolean;
  readonly productionAnswerMode: string;
  readonly incumbent: ArmSummary;
  readonly challenger: ArmSummary;
}

/* ── the derivation, in ONE place, called by both entry points ───────────── */

/**
 * **THE DIAGNOSTICS THIS COMPARISON MEASURED THAT ARE NOT MODEL RESULTS.**
 * (2026-08-31 run; carried forward under RULING 230 without re-measuring.)
 *
 * They are in the RECORD rather than only in a report because the record is
 * what the next session reads. A question that fails identically on both arms
 * is a fact about the PIPELINE, and filing it as a model result is how a
 * budget defect gets mistaken for a model that cannot answer.
 */
const CARRIED_DIAGNOSTICS = [
  {
    id: "Q5-budget-defect",
    finding:
      "Q5 fails IDENTICALLY on both arms: an 18-record pack cannot fit the ASK-19 700-character " +
      "budget. This is a BUDGET DEFECT and belongs on the frontier — it is not a model result, " +
      "and under RULING 230 it still blocks the switch because the question does not hold.",
  },
  {
    id: "Q3-challenger-advantage",
    finding:
      "Q3: the challenger was GREEN 3/3 where the incumbent was RED 3/3, at 2.5–3.2x cheaper. " +
      "Recorded for a RE-RUN once Q5's budget defect is fixed; it does not by itself move the " +
      "verdict, because RULING 230 is absolute over every required question.",
  },
] as const;

interface Derived {
  readonly comparedRows: number;
  /** Every row that could NOT be compared, each with the reason it could not. */
  readonly droppedRows: readonly { questionId: string; why: string }[];
  readonly incumbentRuns: QuestionRun[];
  readonly challengerRuns: QuestionRun[];
  readonly verdict: SwitchVerdict;
  readonly decision: string;
  readonly challengerQuestionsNotHolding: readonly string[];
  readonly relativeNonRegression: ReturnType<typeof relativeNonRegressionAnalysis>;
}

/** Why this row could not be compared, or null. Delegates to the shared rule. */
const notComparable = (r: Row): string | null =>
  comparabilityFailure({
    packsIdentical: r.packsIdentical,
    incumbentRanCount: r.incumbent.ranCount,
    challengerRanCount: r.challenger.ranCount,
    incumbentModel: INCUMBENT_ARM,
    challengerModel: CHALLENGER_ARM,
  });

/**
 * Every derived field, from the rows and nothing else.
 *
 * **`decision` is a RENDERING of `verdict`, not a second rule.** That is the
 * whole of RULING 230 expressed in code: the machine-readable verdict and the
 * human decision cannot disagree because there is only one derivation and the
 * second field is written from the first.
 */
function derive(rows: readonly Row[], why: string): Derived {
  /*
   * **A ROW THAT COULD NOT BE COMPARED IS CARRIED AS UNMEASURED, NEVER
   * DROPPED.** (Repaired 2026-09-01, found by ITEM K's own effort sweep and
   * reported rather than worked around.)
   *
   * This used to `filter` the incomparable rows out and hand `switchVerdict`
   * only what survived. `switchVerdict` refuses a verdict when a run carries
   * `held: null` and refuses an empty set — both correct, and both blind to a
   * question that never reached it at all. So the DENOMINATOR SHRANK IN
   * SILENCE: the `xhigh` sweep emitted `SWITCH` over three surviving rows and
   * `max` over ONE, and the record reported `questions: 1` as though a
   * single-question sweep had been the plan.
   *
   * That is the shape this repository refuses everywhere else. A zero-row
   * extraction is a FAILED extraction, not an empty document (RULING 100); a
   * finite attempt count never earns an absence (RULING 170); and our failure
   * to measure is never evidence about the thing we failed to measure. A
   * filter turned all three into a clean sweep.
   *
   * The repair uses the guard that already exists rather than adding a second
   * one: an incomparable row enters both arms with `held: null`, and
   * `switchVerdict`'s `unmeasured` branch — the one RULING 230 put there —
   * fires on its own. `droppedRows` then states the denominator in the record,
   * so a reader of the artifact sees what was not compared and why, instead of
   * inferring it from a count that looks complete.
   */
  const dropped = rows
    .map((r) => ({ questionId: r.questionId, why: notComparable(r) }))
    .filter((d): d is { questionId: string; why: string } => d.why !== null);
  const droppedIds = new Set(dropped.map((d) => d.questionId));

  const incumbentRuns: QuestionRun[] = rows.map((r) => ({
    questionId: r.questionId,
    model: INCUMBENT_ARM,
    held: droppedIds.has(r.questionId) ? null : held(r.incumbent),
    ms: r.incumbent.msMean,
    usd: r.incumbent.usdTotal,
  }));
  const challengerRuns: QuestionRun[] = rows.map((r) => ({
    questionId: r.questionId,
    model: CHALLENGER_ARM,
    held: droppedIds.has(r.questionId) ? null : held(r.challenger),
    ms: r.challenger.msMean,
    usd: r.challenger.usdTotal,
  }));
  const verdict = switchVerdict(incumbentRuns, challengerRuns, why);
  return {
    comparedRows: rows.length - dropped.length,
    droppedRows: dropped,
    incumbentRuns,
    challengerRuns,
    verdict,
    decision:
      verdict.kind === "SWITCH"
        ? `SWITCH:${CHALLENGER_ARM}`
        : `RETAIN:${INCUMBENT_ARM}`,
    challengerQuestionsNotHolding: challengerQuestionsNotHolding(challengerRuns),
    relativeNonRegression: relativeNonRegressionAnalysis(incumbentRuns, challengerRuns),
  };
}

/** The decision, printed from the ONE verdict. */
function reportDecision(derived: Derived): void {
  const { verdict, relativeNonRegression: rel } = derived;
  console.log("");
  console.log(
    "  RULING 230 — SWITCH only if EVERY required question is measured and holds. " +
      "ONE canonical verdict; no second function may emit one.",
  );
  console.log(`  VERDICT: ${verdict.kind}`);
  if (verdict.kind === "HOLD") {
    console.log(`    did not hold on the challenger: ${verdict.notHolding.join(", ")}`);
  }
  if (verdict.kind === "NOT_MEASURED") {
    console.log(`    unmeasured: ${verdict.unmeasured.join(", ") || "(none named)"}`);
    console.log(`    why: ${verdict.why}`);
  }
  if (verdict.kind === "SWITCH") {
    console.log(
      `    every one of the ${verdict.questions} required question(s) was measured and held ` +
        `on ${verdict.to}.`,
    );
  }
  console.log(`  DECISION: ${derived.decision}`);
  /*
   * THE DENOMINATOR IS PRINTED WHETHER OR NOT IT IS WHOLE. A sweep that
   * compared three of seven questions and said nothing about the other four is
   * how `SWITCH over one row` came to look like a result.
   */
  console.log(
    `  DENOMINATOR: ${derived.comparedRows} of ${derived.comparedRows + derived.droppedRows.length} ` +
      `question(s) were actually compared.`,
  );
  for (const d of derived.droppedRows) {
    console.log(`    NOT COMPARED — ${d.questionId}: ${d.why}`);
  }

  console.log("");
  console.log(`  DIAGNOSTIC — relative non-regression (NOT a switch verdict): ${rel.kind}`);
  if (rel.degraded.length > 0) console.log(`    degraded vs the incumbent: ${rel.degraded.join(", ")}`);
  if (rel.bothArmsFailed.length > 0) {
    console.log(
      `    failed on BOTH arms (a pipeline fact, not a model result): ${rel.bothArmsFailed.join(", ")}`,
    );
  }
  if (rel.unmeasured.length > 0) console.log(`    unmeasured: ${rel.unmeasured.join(", ")}`);
  for (const d of CARRIED_DIAGNOSTICS) console.log(`    ${d.id}: ${d.finding}`);
}

interface RecordMeta {
  readonly baseUrl: string;
  readonly testedSha: string | null;
  readonly startedAt: string;
  readonly passesPerArm: number;
  readonly corpusRows: number;
  readonly voided: readonly string[];
  readonly regeneratedFrom?: string;
}

function writeRunRecord(meta: RecordMeta, rows: readonly Row[], derived: Derived): string {
  /* A sweep measures one variable and decides nothing; it does not get a
     decision record. The console output is its evidence. */
  if (NO_RECORD) return "(--no-record: no run record written)";
  mkdirSync(RUNS_DIR, { recursive: true });
  const recordPath = join(RUNS_DIR, `${today()}-${Date.now()}.json`);
  writeFileSync(
    recordPath,
    `${JSON.stringify(
      {
        baseUrl: meta.baseUrl,
        testedSha: meta.testedSha,
        startedAt: meta.startedAt,
        finishedAt: new Date().toISOString(),
        ...(meta.regeneratedFrom ? { regeneratedFrom: meta.regeneratedFrom } : {}),
        incumbentModel: INCUMBENT_ARM,
        challengerModel: CHALLENGER_ARM,
        /* ITEM K: the arms are nameable per run, so the record states the two it
           actually measured rather than leaving a later reader to infer them
           from what the constants say on the day they read it. */
        armsNamedOnCommandLine: INCUMBENT_ARM !== ASK_INCUMBENT_MODEL || CHALLENGER_ARM !== ASK_CHALLENGER_MODEL,
        effort: SWEEP_EFFORT ?? resolveAskEffort(),
        rates: ASK_MODEL_RATES,
        cachePolicy:
          "DISABLED on both arms: no cache_control marker is sent, so neither arm reads or " +
          "writes a prefix. Cold input tokens are the only basis both models can share, and a " +
          "comparison run may not write into production's prefixes.",
        switchRule:
          "RULING 230 (2026-09-01): SWITCH only if EVERY required challenger question is " +
          "measured AND holds; any required question measured and not held -> HOLD; any " +
          "required question unmeasured -> NOT_MEASURED. `decision` is rendered FROM `verdict` " +
          "and cannot disagree with it.",
        passesPerArm: meta.passesPerArm,
        corpusRows: meta.corpusRows,
        renderedRows: rows.length,
        comparedRows: derived.comparedRows,
        /* The denominator, stated. A row that could not be compared is named
           here with its reason, so no reader has to infer it from a count. */
        droppedRows: derived.droppedRows,
        voided: meta.voided,
        challengerQuestionsNotHolding: derived.challengerQuestionsNotHolding,
        /* The canonical verdict, and the decision RENDERED from it. */
        verdict: derived.verdict,
        decision: derived.decision,
        /* Diagnostics. Neither of these is a switching verdict. */
        relativeNonRegression: derived.relativeNonRegression,
        carriedDiagnostics: CARRIED_DIAGNOSTICS,
        rows,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  return recordPath;
}

/* ── entry point 2: regenerate from a recorded run ───────────────────────── */

function regenerate(path: string): void {
  const prior = JSON.parse(readFileSync(path, "utf8")) as {
    baseUrl?: string;
    testedSha?: string | null;
    startedAt?: string;
    passesPerArm?: number;
    corpusRows?: number;
    voided?: string[];
    rows?: Row[];
    verdict?: { kind?: string };
    decision?: string;
  };
  const rows = prior.rows ?? [];
  /* A zero-row regeneration is a FAILED regeneration, never an empty one. */
  if (rows.length === 0) {
    console.error(`ask:model-compare · FAILED — ${path} carries no rows to re-derive from.`);
    process.exit(1);
  }

  /**
   * **THE ARMS COME FROM THE ROWS, AND A DISAGREEMENT IS REFUSED.**
   * (Found 2026-09-01 by running this path after the switch landed.)
   *
   * `INCUMBENT_ARM` and `CHALLENGER_ARM` default to the CURRENT constants, and
   * ITEM K swapped those constants the moment Sonnet 5 became the incumbent.
   * Regenerating a record written before the switch therefore re-labelled a
   * real measurement with today's roles: a run whose rows say
   * `incumbent: claude-opus-5` came back stamped
   * `incumbentModel: claude-sonnet-5`, `challengerModel: claude-opus-5`, and
   * `decision: RETAIN:claude-sonnet-5`. **The arms were swapped against the
   * very rows the record was re-derived from** — an artifact asserting a
   * comparison that never happened.
   *
   * Lane 3 fixed the same class of bug one field over: `SwitchVerdict.to` names
   * the arm that was ACTUALLY MEASURED, read off the runs, precisely so a
   * verdict cannot recommend a model nothing was measured about. `decision`,
   * `incumbentModel` and `challengerModel` were still rendering from the
   * constants.
   *
   * So the rows are the authority, and where they disagree with the arms this
   * process is running under, the regeneration is REFUSED with the exact
   * command that would be correct. It is not silently corrected either: the
   * flags exist, and guessing which of two models the operator meant is how a
   * false record gets written a second time.
   */
  const rowIncumbent = rows[0]?.incumbent?.model;
  const rowChallenger = rows[0]?.challenger?.model;
  if (
    (rowIncumbent && rowIncumbent !== INCUMBENT_ARM) ||
    (rowChallenger && rowChallenger !== CHALLENGER_ARM)
  ) {
    console.error(
      `ask:model-compare · REFUSED — ${path} recorded ` +
        `incumbent ${rowIncumbent} against challenger ${rowChallenger}, but this ` +
        `process is running incumbent ${INCUMBENT_ARM} against challenger ` +
        `${CHALLENGER_ARM}.\n` +
        `  Re-deriving under swapped arms would stamp a real measurement with the ` +
        `wrong roles and assert a comparison that never happened.\n` +
        `  Name the arms the record actually holds:\n` +
        `    pnpm ask:model-compare --regenerate ${path.replace(/\\/g, "/")} ` +
        `--incumbent ${rowIncumbent} --challenger ${rowChallenger}`,
    );
    process.exit(1);
  }

  const derived = derive(
    rows,
    `${rows.length} row(s) recorded on the ${prior.startedAt ?? "unknown"} run`,
  );
  console.log(`ask:model-compare · REGENERATED from ${path}`);
  console.log(
    `  the measurement is unchanged — ${rows.length} row(s), ${derived.comparedRows} compared; ` +
      "nothing was re-graded and no network call was made.",
  );
  console.log(
    `  prior record said verdict ${prior.verdict?.kind ?? "?"} / decision ${prior.decision ?? "?"}`,
  );
  reportDecision(derived);
  const written = writeRunRecord(
    {
      baseUrl: prior.baseUrl ?? "unknown",
      testedSha: prior.testedSha ?? null,
      startedAt: prior.startedAt ?? new Date().toISOString(),
      passesPerArm: prior.passesPerArm ?? 0,
      corpusRows: prior.corpusRows ?? rows.length,
      voided: prior.voided ?? [],
      regeneratedFrom: path.replace(/\\/g, "/"),
    },
    rows,
    derived,
  );
  console.log(`\n  run record: ${written}`);
}

async function main(): Promise<void> {
  const startedAt = new Date().toISOString();
  const templates =
    loadJsonArray<QuestionTemplate>(
      join(ROOT, "data", "health", "reader-questions.json"),
      "question templates",
    ) ?? [];

  if (templates.length === 0) {
    console.error("ask:model-compare · BOUNDARY — the reader-question corpus is empty.");
    process.exit(1);
  }

  /*
   * The known-subject universe, built exactly as `app/api/ask/grounded` builds
   * it, so `subject-not-substituted` has the same governments to refuse. An
   * empty universe would make that check honestly check nothing, and a
   * comparison graded by a weaker validator than production's would report a
   * grounding pass production would not give.
   */
  const snapshot = readSnapshot();
  if (!snapshot) {
    console.error("ask:model-compare · BOUNDARY — the meetings snapshot is not readable.");
    process.exit(1);
  }

  // Since 092b8089 the registry-runtime projection is read once, asynchronously, and every
  // synchronous caller (canonicalBodyIdentity below) throws STORE_UNREACHABLE until it is primed.
  await refreshRegistryRuntimeFromPromoted({ bypassCache: true });

  const bodies: KnownSubjectName[] = snapshotEntities(
    snapshot.meetings as { bodyId?: string | null; ocdId: string | null }[],
    (bodyId) => canonicalBodyIdentity(bodyId),
  ).map((entity) => ({ id: entity.id, name: entity.name }));

  const index = divisionIndexFor(ROOT);
  const rows: Row[] = [];
  const voided: string[] = [];

  for (const template of templates) {
    const zip = template.applicability.zips?.[0];
    if (!zip) {
      voided.push(`${template.id}: the corpus row names no ZIP, so no reader context exists`);
      continue;
    }
    const divisionIds = index[zip] ?? [];
    if (divisionIds.length === 0) {
      voided.push(`${template.id}: ZIP ${zip} resolves to no divisions in this checkout`);
      continue;
    }

    const reply = await askProduct(template.templateText, divisionIds);
    const pack = rebuildPack(template.templateText, reply);
    const expectation = template.expectation ?? null;

    /*
     * ONE PACK, TWO ARMS. The same object, and the digest of what each arm was
     * SHOWN is compared afterwards — because the constraint is about what
     * reached the model, and a shared variable is an argument about the code
     * rather than a measurement of the request.
     */
    const incumbent = await runArm(pack, INCUMBENT_ARM, bodies, expectation);
    const challenger = await runArm(pack, CHALLENGER_ARM, bodies, expectation);
    /* Every pass of both arms must have been shown ONE prompt. Two digests
       anywhere across the passes voids the question. */
    const digests = [...new Set([...incumbent.digests, ...challenger.digests])];
    const packsIdentical = digests.length === 1;
    if (!packsIdentical) {
      voided.push(
        `${template.id}: the arms were shown ${digests.length} DIFFERENT prompts ` +
          `(${digests.map((d) => d.slice(0, 12)).join(", ")}) — the comparison for this ` +
          "question is VOID",
      );
    }

    rows.push({
      questionId: template.id,
      zip,
      question: template.templateText,
      packMode: reply.mode,
      packRecords: pack.records.length,
      packGaps: pack.gaps.length,
      packSources: sourceLinks(pack.records).length,
      packSubjectId: pack.subject?.id ?? null,
      packSubjectName: pack.subject?.name ?? null,
      packDigest: incumbent.digests[0] ?? "",
      packsIdentical,
      productionAnswerMode: reply.mode,
      incumbent,
      challenger,
    });
  }

  /* A zero-row run is a FAILED run, never an empty one. */
  if (rows.length === 0) {
    console.error(
      `ask:model-compare · FAILED — ${templates.length} corpus row(s) and 0 comparison rows.`,
    );
    for (const line of voided) console.error(`    ${line}`);
    process.exit(1);
  }

  /* ------------------------------------------------------------ verdict -- */

  const derived = derive(
    rows,
    `${rows.filter((r) => r.packsIdentical && r.incumbent.ranCount > 0 && r.challenger.ranCount > 0).length} of ` +
      `${templates.length} canonical question(s) reached the synthesis contract on both arms`,
  );
  const comparable = derived.comparedRows;

  /* ------------------------------------------------------------- report -- */

  console.log(
    `ask:model-compare · ${BASE} · sha ${headSha()?.slice(0, 8) ?? "unknown"} · ` +
      `${INCUMBENT_ARM} vs ${CHALLENGER_ARM}`,
  );
  console.log(
    `  DENOMINATOR: ${templates.length} canonical question(s); ${rows.length} row(s) rendered; ` +
      `${comparable} compared on both arms.`,
  );
  console.log("  Caches DISABLED on both arms — cold input tokens, one basis for both columns.");
  console.log(
    `  ${PASSES} pass(es) per arm per question. An arm HOLDS a question only when EVERY ` +
      "pass held; one draw is not a measurement.",
  );

  for (const row of rows) {
    console.log("");
    console.log(`  ${row.questionId} · ZIP ${row.zip} · ${row.question}`);
    console.log(
      `    evidence: ${row.packRecords} record(s), ${row.packGaps} named gap(s), ` +
        `${row.packSources} publisher(s); subject ${row.packSubjectName ?? "NONE BOUND"}; ` +
        `the product answered in mode ${row.productionAnswerMode}`,
    );
    console.log(`    same pack on both arms: ${row.packsIdentical ? "YES" : "NO — VOID"}`);
    for (const arm of [row.incumbent, row.challenger]) {
      const label = arm.model === INCUMBENT_ARM ? "incumbent " : "challenger";
      if (arm.ranCount === 0) {
        console.log(
          `    ${label} ${arm.model}: DID NOT RUN on any of ${arm.passes.length} pass(es) — ` +
            `${arm.passes[0]?.why ?? "unknown"}`,
        );
        continue;
      }
      console.log(
        `    ${label} ${arm.model}: HELD ${arm.heldCount}/${arm.passes.length} pass(es)` +
          ` · ${arm.inputTokens} in (identical every pass) / ${arm.outputTokensMean?.toFixed(0)} out mean` +
          ` · cache 0r/0w` +
          ` · $${arm.usdTotal?.toFixed(5)} over ${arm.passes.length} pass(es)` +
          ` · ${arm.msMean?.toFixed(0)}ms mean`,
      );
      /* Every pass is printed. A summary that hides the pass that failed is
         the averaging this comparison refuses. */
      arm.passes.forEach((p, i) => {
        if (!p.ran) {
          console.log(`      pass ${i + 1}: DID NOT RUN — ${p.why}`);
          return;
        }
        console.log(
          `      pass ${i + 1}: grounding ${p.groundingPassed ? "PASSED" : "FAILED"}` +
            (p.groundingFailed.length > 0 ? ` [${p.groundingFailed.join(", ")}]` : "") +
            ` · correctness ${p.correctness} · ${p.outputTokens} out · ${p.ms}ms`,
        );
        console.log(`        answer: ${JSON.stringify(p.answer)}`);
        if (p.correctnessDetail) console.log(`        why: ${p.correctnessDetail}`);
      });
    }
  }

  if (voided.length > 0) {
    console.log("\n  VOID / NOT COMPARED:");
    for (const line of voided) console.log(`    ${line}`);
  }

  reportDecision(derived);

  /* ---------------------------------------------------------- the record - */

  const recordPath = writeRunRecord(
    {
      baseUrl: BASE,
      testedSha: headSha(),
      startedAt,
      passesPerArm: PASSES,
      corpusRows: templates.length,
      voided,
    },
    rows,
    derived,
  );
  console.log(`\n  run record: ${recordPath}`);
}

if (REGENERATE) {
  try {
    regenerate(REGENERATE);
  } catch (error) {
    console.error(
      `ask:model-compare · FAILED: ${error instanceof Error ? error.stack : String(error)}`,
    );
    process.exit(1);
  }
} else {
  main().catch((error) => {
    console.error(
      `ask:model-compare · FAILED: ${error instanceof Error ? error.stack : String(error)}`,
    );
    process.exit(1);
  });
}
