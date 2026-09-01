/**
 * `pnpm ask:model-compare` — **THE ASK MODEL COMPARISON, MEASURED.**
 * (Session C, lane H2, 2026-08-31.)
 *
 * ## What this settles, and why NOT_MEASURED was not allowed to stand
 *
 * `lib/ask/model-economics.ts` wrote the rule down — *switch only if every
 * question holds; one model for all Ask traffic* — and reported the comparison
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

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { AskIntent, AskTemporal } from "../lib/ask/intent.ts";
import type { EvidenceGap, EvidencePack, EvidenceRecord, EvidenceSubject } from "../lib/ask/evidence.ts";
import { canonicalBodyIdentity } from "../lib/ask/body-identity.ts";
import { sourceLinks } from "../lib/ask/host.ts";
import { interpretWithoutModel } from "../lib/ask/interpret.ts";
import { snapshotEntities } from "../lib/ask/inventory.ts";
import {
  callUsd,
  shownPromptDigest,
  synthesizeForComparison,
  type ComparisonOutcome,
} from "../lib/ask/model-comparison.ts";
import {
  ASK_CHALLENGER_MODEL,
  ASK_INCUMBENT_MODEL,
  ASK_MODEL_RATES,
  challengerQuestionsNotHolding,
  switchVerdict,
  type QuestionRun,
} from "../lib/ask/model-economics.ts";
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

import { today } from "./doc-dates.mjs";

const DEFAULT_BASE = "http://localhost:3000";
const BASE = (process.env.SHOOT_BASE_URL ?? DEFAULT_BASE).replace(/\/$/, "");
const ROOT = process.cwd();
const RUNS_DIR = join(ROOT, "data", "health", "ask-model-compare-runs");

/* ── refusal 1: the target must be local (RULING 125) ────────────────────── */

{
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

if (!process.env.ANTHROPIC_API_KEY) {
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
  const outcome: ComparisonOutcome = await synthesizeForComparison(pack, model);
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
    usd: callUsd(model, outcome.usage, outcome.outputTokens),
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
    const incumbent = await runArm(pack, ASK_INCUMBENT_MODEL, bodies, expectation);
    const challenger = await runArm(pack, ASK_CHALLENGER_MODEL, bodies, expectation);
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

  const comparable = rows.filter(
    (r) => r.packsIdentical && r.incumbent.ranCount > 0 && r.challenger.ranCount > 0,
  );
  const incumbentRuns: QuestionRun[] = comparable.map((r) => ({
    questionId: r.questionId,
    model: ASK_INCUMBENT_MODEL,
    held: held(r.incumbent),
    ms: r.incumbent.msMean,
    usd: r.incumbent.usdTotal,
  }));
  const challengerRuns: QuestionRun[] = comparable.map((r) => ({
    questionId: r.questionId,
    model: ASK_CHALLENGER_MODEL,
    held: held(r.challenger),
    ms: r.challenger.msMean,
    usd: r.challenger.usdTotal,
  }));
  const verdict = switchVerdict(
    incumbentRuns,
    challengerRuns,
    `${comparable.length} of ${templates.length} canonical question(s) reached the synthesis ` +
      "contract on both arms",
  );

  /* ------------------------------------------------------------- report -- */

  console.log(
    `ask:model-compare · ${BASE} · sha ${headSha()?.slice(0, 8) ?? "unknown"} · ` +
      `${ASK_INCUMBENT_MODEL} vs ${ASK_CHALLENGER_MODEL}`,
  );
  console.log(
    `  DENOMINATOR: ${templates.length} canonical question(s); ${rows.length} row(s) rendered; ` +
      `${comparable.length} compared on both arms.`,
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
      const label = arm.model === ASK_INCUMBENT_MODEL ? "incumbent " : "challenger";
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

  /*
   * **THE DECISION IS THE OWNER'S CRITERION, AND IT IS ABSOLUTE.**
   *
   * The derived `switchVerdict` is relative — it blocks a switch only on
   * DEGRADATION — and on this data the two rules can disagree. Both are
   * printed, the conflict is named rather than resolved by whichever ran last,
   * and the DECISION line is taken on the author's directive (RULING 185,
   * precedence 1). See `challengerQuestionsNotHolding`.
   */
  const notHolding = challengerQuestionsNotHolding(challengerRuns);
  const criterionMet = comparable.length > 0 && notHolding.length === 0;
  console.log("");
  console.log(
    `  THE OWNER'S CRITERION — every required question holds on ${ASK_CHALLENGER_MODEL}: ` +
      (criterionMet ? "MET" : "NOT MET"),
  );
  if (!notHolding.length && comparable.length === 0) {
    console.log("    nothing was compared, so nothing held; an empty sweep is never a switch.");
  }
  if (notHolding.length > 0) {
    console.log(`    did not hold on the challenger: ${notHolding.join(", ")}`);
  }
  console.log(
    `  DECISION: ${criterionMet ? `SWITCH to ${ASK_CHALLENGER_MODEL}` : `RETAIN ${ASK_INCUMBENT_MODEL}`}`,
  );

  console.log(`\n  DERIVED (relative, degradation-only) VERDICT: ${verdict.kind}`);
  if (verdict.kind === "HOLD") {
    console.log(`    degraded: ${verdict.degraded.join(", ")}`);
    console.log(`    the incumbent ${ASK_INCUMBENT_MODEL} is retained.`);
  }
  if (verdict.kind === "NOT_MEASURED") {
    console.log(`    unmeasured: ${verdict.unmeasured.join(", ") || "(none named)"}`);
    console.log(`    why: ${verdict.why}`);
  }
  if (verdict.kind === "SWITCH") {
    console.log(
      `    every one of the ${verdict.questions} compared question(s) held on ` +
        `${verdict.to}; the switch rule's condition is met over that denominator.`,
    );
  }

  /* ---------------------------------------------------------- the record - */

  mkdirSync(RUNS_DIR, { recursive: true });
  const recordPath = join(RUNS_DIR, `${today()}-${Date.now()}.json`);
  writeFileSync(
    recordPath,
    `${JSON.stringify(
      {
        baseUrl: BASE,
        testedSha: headSha(),
        startedAt,
        finishedAt: new Date().toISOString(),
        incumbentModel: ASK_INCUMBENT_MODEL,
        challengerModel: ASK_CHALLENGER_MODEL,
        rates: ASK_MODEL_RATES,
        cachePolicy:
          "DISABLED on both arms: no cache_control marker is sent, so neither arm reads or " +
          "writes a prefix. Cold input tokens are the only basis both models can share, and a " +
          "comparison run may not write into production's prefixes.",
        passesPerArm: PASSES,
        corpusRows: templates.length,
        renderedRows: rows.length,
        comparedRows: comparable.length,
        voided,
        /* The author's criterion, absolute, and the decision taken on it. */
        challengerQuestionsNotHolding: notHolding,
        ownerCriterionMet: criterionMet,
        decision: criterionMet ? `SWITCH:${ASK_CHALLENGER_MODEL}` : `RETAIN:${ASK_INCUMBENT_MODEL}`,
        /* The relative derivation, reported beside it and never in place of it. */
        verdict,
        rows,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  console.log(`\n  run record: ${recordPath}`);
}

main().catch((error) => {
  console.error(
    `ask:model-compare · FAILED: ${error instanceof Error ? error.stack : String(error)}`,
  );
  process.exit(1);
});
