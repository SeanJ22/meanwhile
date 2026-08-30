/**
 * `pnpm reader:suite` — the reader-contract evaluation harness (WS-CONTRACT).
 *
 * Loads the owner question corpus from `data/health/reader-questions.json`,
 * instantiates it against the registry for the four pilot ZIPs, and evaluates
 * every active instance against the RENDERED DOM in a real guarded browser —
 * never a source grep, never a database query: the contract is about what a
 * reader can learn from the surface, and only the surface can answer that.
 *
 * With no corpus loaded the run still proves the harness: the browser opens,
 * the base URL is reached (or the wall is named), and the run record states
 * `0 questions loaded — awaiting owner corpus` — an explicit awaiting state,
 * exit 0, never a silent pass and never a manufactured failure.
 *
 * THE TARGET IS LOCAL — RULING 125, mirrored from `walk-all.mts`: a non-local
 * `SHOOT_BASE_URL` is refused. `PRODUCTION_RENDER` exists in the run-record
 * type and is currently unreachable from this harness by construction; every
 * record this script writes says so.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { floorLine, floored } from "../lib/ops/denominator-floor.ts";
import { nextRunRecordPath } from "../lib/health/run-records.ts";
import {
  activeInstances,
  generateInstances,
  loadZipBodyUniverses,
  retireExpiredInstances,
  type EvaluationTarget,
  type InstanceResult,
  type ReaderQuestionInstance,
  type ReaderQuestionTemplate,
} from "../lib/health/reader-question.ts";
import { EVERYDAY_ZIPS } from "../lib/routing/everyday.ts";

import { launchGuarded, seedZip } from "./browser.mts";
import { today } from "./doc-dates.mjs";

const AWAITING = "0 questions loaded — awaiting owner corpus";

const DEFAULT_BASE = "http://localhost:3000";
const BASE = (process.env.SHOOT_BASE_URL ?? DEFAULT_BASE).replace(/\/$/, "");

{
  let host: string;
  try {
    host = new URL(BASE).hostname;
  } catch {
    console.error(`reader:suite · SHOOT_BASE_URL is not a URL: ${BASE}`);
    process.exit(1);
  }
  const local = host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
  if (!local) {
    console.error(
      [
        "",
        `reader:suite · REFUSED — the target is ${host}, which is not a local build.`,
        "",
        "  RULING 125: every walk and check runs against the LOCAL production build.",
        "  Production is the delivery truck, not the test bench, and every",
        "  /api/meetings GET writes a row to the sold search log.",
        "",
        "  PRODUCTION_RENDER exists in the run-record type; it is unreachable from",
        "  this harness by construction.",
        "",
      ].join("\n"),
    );
    process.exit(1);
  }
}

/** LOCAL by the refusal above. Kept as the typed value so the record says which. */
const TARGET: EvaluationTarget = "LOCAL_RENDER";

const ROOT = process.cwd();
const CORPUS_PATH = join(ROOT, "data", "health", "reader-questions.json");
const RUNS_DIR = join(ROOT, "data", "health", "reader-suite-runs");

interface HarnessReach {
  readonly reached: boolean;
  /** HTTP status of the base URL, when a response arrived. */
  readonly status: number | null;
  readonly title: string | null;
  /** The wall, named, when the server was not reachable. */
  readonly wall: string | null;
}

interface RunRecord {
  readonly target: EvaluationTarget;
  readonly targetNote: string;
  readonly baseUrl: string;
  readonly runId: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly questionsLoaded: number;
  readonly instancesGenerated: number;
  readonly instancesActive: number;
  readonly instancesEvaluated: number;
  readonly results: readonly InstanceResult[];
  readonly harness: HarnessReach;
  readonly corpusState: string | null;
}

/** The owner corpus, or null when the file is absent. Empty is loaded-empty. */
function loadCorpus(): ReaderQuestionTemplate[] | null {
  if (!existsSync(CORPUS_PATH)) return null;
  const text = readFileSync(CORPUS_PATH, "utf8");
  const parsed = JSON.parse(text) as unknown;
  if (!Array.isArray(parsed)) {
    // A file that exists but is not a template array is a wall, not an empty
    // corpus: refuse loudly rather than reading it as zero questions.
    throw new Error(`${CORPUS_PATH} exists but is not an array of question templates`);
  }
  return parsed as ReaderQuestionTemplate[];
}

/** Pure evaluation of one instance against extracted DOM text. */
function evaluateAgainstDom(
  instance: ReaderQuestionInstance,
  template: ReaderQuestionTemplate | undefined,
  domText: string,
): InstanceResult {
  if (!template?.expectation) {
    return {
      instanceId: instance.id,
      questionText: instance.questionText,
      verdict: {
        kind: "NOT_EVALUABLE",
        detail: "the owner corpus states no expectation for this template; recorded, never green",
      },
    };
  }
  const found = domText.includes(template.expectation.text);
  return {
    instanceId: instance.id,
    questionText: instance.questionText,
    verdict: found
      ? { kind: "GREEN" }
      : {
          kind: "RED",
          detail: `rendered DOM does not contain ${JSON.stringify(template.expectation.text)}`,
        },
  };
}

async function main(): Promise<void> {
  const startedAt = new Date().toISOString();
  const templates = loadCorpus() ?? [];
  const questionsLoaded = templates.length;

  // Instances exist only when questions do; the zero state still proves reach.
  let generated: ReaderQuestionInstance[] = [];
  if (questionsLoaded > 0) {
    const universes = await loadZipBodyUniverses(EVERYDAY_ZIPS, ROOT);
    generated = retireExpiredInstances(
      generateInstances(templates, universes, startedAt),
      startedAt,
    );
  }
  const active = activeInstances(generated);

  const browser = await launchGuarded({ label: "reader-suite", headless: true });
  let harness: HarnessReach;
  const results: InstanceResult[] = [];
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
      // Playwright decorates its message with an ANSI-styled call log; the
      // record keeps the words and drops the terminal styling.
      const message = (error instanceof Error ? error.message : String(error))
        // eslint-disable-next-line no-control-regex
        .replace(/\u001b\[[0-9;]*m/g, "")
        .trim();
      harness = {
        reached: false,
        status: null,
        title: null,
        wall: `the harness could not reach ${BASE}: ${message}`,
      };
    }

    if (harness.reached && active.length > 0) {
      const templateById = new Map(templates.map((t) => [t.id, t]));
      const zips = [...new Set(active.map((i) => i.zip))];
      for (const zip of zips) {
        // One seeded page per ZIP; every instance of the ZIP evaluates against
        // the same rendered DOM extraction.
        const zipPage = await browser.page();
        await seedZip(zipPage, zip);
        await zipPage.goto(BASE, { waitUntil: "networkidle", timeout: 60_000 });
        // Expression-shaped: tsx's esbuild transform rewrites named functions
        // through a __name helper the page does not have.
        const domText = (await zipPage.evaluate("document.body.innerText")) as string;
        await zipPage.close();
        for (const instance of active.filter((i) => i.zip === zip)) {
          results.push(evaluateAgainstDom(instance, templateById.get(instance.templateId), domText));
        }
      }
    }
  } finally {
    await browser.close();
  }

  const record: RunRecord = {
    target: TARGET,
    targetNote:
      "LOCAL_RENDER by construction: non-local targets are refused (RULING 125), so " +
      "PRODUCTION_RENDER is defined in the type and currently unreachable from this harness",
    baseUrl: BASE,
    runId: browser.runId,
    startedAt,
    finishedAt: new Date().toISOString(),
    questionsLoaded,
    instancesGenerated: generated.length,
    instancesActive: active.length,
    instancesEvaluated: results.length,
    results,
    harness,
    corpusState: questionsLoaded === 0 ? AWAITING : null,
  };
  const recordPath = nextRunRecordPath(RUNS_DIR, today());
  writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`);

  console.log(`reader:suite · target ${record.target} · ${BASE} · run ${record.runId}`);
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
  if (questionsLoaded === 0) {
    console.log(`  ${AWAITING}`);
  } else {
    console.log(
      `  ${questionsLoaded} question template(s) loaded · ${generated.length} instance(s) ` +
        `generated · ${active.length} active`,
    );
    // RULING 159: the evaluated count is floored on the active universe — an
    // empty population never prints as a measured zero, and a partial
    // evaluation shows its denominator.
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
    // Stated N equals rendered rows: the matched count above is results.length
    // and the rows below are results, one line each.
    for (const result of results) {
      console.log(`    ${result.verdict.kind} · ${result.instanceId} · ${result.questionText}`);
    }
  }
  console.log(`  run record: ${recordPath}`);
}

main().catch((error) => {
  console.error(`reader:suite · FAILED: ${error instanceof Error ? error.stack : String(error)}`);
  process.exit(1);
});
