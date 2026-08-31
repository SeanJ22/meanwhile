/**
 * `pnpm visual:suite` — the visual-acceptance harness. (A.1 WI4, 2026-08-30.)
 *
 * ## What did not exist
 *
 * `lib/health/visual-acceptance.ts` shipped in Session A with the load-bearing
 * rule: a property that is inherently visual requires `IMAGE_EVALUATED`
 * evidence — a captured render actually evaluated AS AN IMAGE — and
 * `validateVisualAcceptanceCheck` refuses the DOM shortcut mechanically.
 *
 * Nothing loaded a check. `reader-suite.mts` never read the store, never
 * captured a viewport, never decoded an image, and never emitted a visual
 * failure. The rule was enforced against a population of zero, which is the
 * same shape as every other finding this session repairs: a contract that
 * appears enforced and is not.
 *
 * ## What runs
 *
 * ```
 *   1. LOAD      data/health/visual-checks.json, validating every check
 *   2. REFUSE    any check whose evidence kind cannot certify its property
 *   3. CAPTURE   the check's own bound viewport, at its own ZIP
 *   4. EVALUATE  the decoded PIXELS, never the selector that found the box
 *   5. DIAGNOSE  every RED into a persisted typed diagnostic WorkItem (WI3)
 *   6. RECORD    one canonical run record
 * ```
 *
 * THE TARGET IS LOCAL — RULING 125, as every other harness here.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { createFileRepositories } from "../lib/control-plane/repository/file-store.ts";
import type { WorkItem } from "../lib/control-plane/work-item.ts";
import {
  closeSatisfiedDiagnostics,
  persistDiagnostics,
  visualDiagnostic,
} from "../lib/health/diagnostics.ts";
import { floorLine, floored } from "../lib/ops/denominator-floor.ts";
import { containsCommit, headSha } from "../lib/ops/git-facts.ts";
import { nextRunRecordPath } from "../lib/health/run-records.ts";
import {
  assertValidVisualAcceptanceCheck,
  validateVisualAcceptanceCheck,
  type VisualAcceptanceCheck,
} from "../lib/health/visual-acceptance.ts";
import {
  evaluateClipping,
  evaluateVisibility,
  type ElementBox,
  type ImageVerdict,
} from "../lib/health/visual-evaluation.ts";

import { launchGuarded } from "./browser.mts";
import { today } from "./doc-dates.mjs";
import { decodePng } from "./png.mts";

const DEFAULT_BASE = "http://localhost:3000";
const BASE = (process.env.SHOOT_BASE_URL ?? DEFAULT_BASE).replace(/\/$/, "");

{
  let host: string;
  try {
    host = new URL(BASE).hostname;
  } catch {
    console.error(`visual:suite · SHOOT_BASE_URL is not a URL: ${BASE}`);
    process.exit(1);
  }
  const local = host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
  if (!local) {
    console.error(
      `\nvisual:suite · REFUSED — the target is ${host}, which is not a local build.\n\n` +
        "  RULING 125: every walk and check runs against the LOCAL production build.\n",
    );
    process.exit(1);
  }
}

const ROOT = process.cwd();
const CHECKS_PATH = join(ROOT, "data", "health", "visual-checks.json");
const RUNS_DIR = join(ROOT, "data", "health", "visual-suite-runs");
const CONTROL_PLANE_ROOT = join(ROOT, "data", "control-plane", "pilot-health");

/** The tree this run measured, through the shared helper (RULING 103). */
const TESTED_SHA = headSha();

/**
 * A check plus the selector the capture aims at.
 *
 * The selector is stored beside the check rather than inside it because
 * `VisualAcceptanceCheck` is the OWNER's artifact — a surface, a viewport and
 * an expectation — and a CSS selector is an implementation detail of how this
 * harness finds the thing. Putting one in the owner's type would make every
 * check stale the next time a class name changed.
 */
interface CheckBinding {
  readonly check: VisualAcceptanceCheck;
  readonly selector: string;
}

interface CheckResult {
  readonly checkId: string;
  readonly property: string;
  readonly verdict: "GREEN" | "RED" | "NOT_EVALUABLE";
  readonly detail: string;
  readonly capturePath: string | null;
}

function loadChecks(): CheckBinding[] {
  if (!existsSync(CHECKS_PATH)) return [];
  const parsed = JSON.parse(readFileSync(CHECKS_PATH, "utf8")) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error(`${CHECKS_PATH} exists but is not an array of visual acceptance checks`);
  }
  return parsed as CheckBinding[];
}

async function main(): Promise<void> {
  const startedAt = new Date().toISOString();
  const bindings = loadChecks();

  console.log(
    `visual:suite · ${BASE} · sha ${TESTED_SHA?.slice(0, 8) ?? "unknown"} · ` +
      `${bindings.length} check(s) loaded`,
  );

  /*
   * THE EVIDENCE-KIND RULE, APPLIED BEFORE ANYTHING RUNS. A check whose
   * declared evidence cannot certify its property is refused here rather than
   * evaluated and reported — running it would produce a number that looks like
   * a measurement of a thing it cannot measure.
   */
  for (const { check } of bindings) {
    const problems = validateVisualAcceptanceCheck(check);
    if (problems.length > 0) {
      console.error(`visual:suite · REFUSED — check ${check.id}: ${problems.join("; ")}`);
      process.exit(1);
    }
    assertValidVisualAcceptanceCheck(check);
  }

  const results: CheckResult[] = [];
  const diagnostics: WorkItem[] = [];

  if (bindings.length > 0) {
    const browser = await launchGuarded({ label: "visual-suite", headless: true });
    try {
      for (const { check, selector } of bindings) {
        const context = await browser.context({
          viewport: { width: check.viewport.width, height: check.viewport.height },
          deviceScaleFactor: 1,
          reducedMotion: "reduce",
        });
        await context.addInitScript(
          ({ zip }) => {
            try {
              sessionStorage.setItem(
                "wtp.approximate_location",
                JSON.stringify({ zip, savedAt: new Date().toISOString() }),
              );
              localStorage.setItem("wtp.tutorial_seen", "1");
            } catch {
              /* defaults are fine */
            }
          },
          { zip: check.zip },
        );
        const page = await context.newPage();
        await page.goto(`${BASE}${check.surface}`, {
          waitUntil: "domcontentloaded",
          timeout: 90_000,
        });
        await page.waitForSelector(selector, { timeout: 20_000 }).catch(() => null);

        const box = (await page.evaluate(
          `(function () {
            var el = document.querySelector(${JSON.stringify(selector)});
            if (!el) return null;
            var r = el.getBoundingClientRect();
            return { x: r.x, y: r.y, width: r.width, height: r.height };
          })()`,
        )) as ElementBox | null;

        if (box === null) {
          results.push({
            checkId: check.id,
            property: check.property,
            verdict: "NOT_EVALUABLE",
            detail:
              `the harness could not find ${selector} on ${check.surface} at zip ${check.zip}. ` +
              "A check whose subject is not on the page is a failed observation with the wall " +
              "named, never a passing check.",
            capturePath: null,
          });
          await page.close();
          await context.close();
          continue;
        }

        /*
         * The capture is the EVIDENCE. It is written to disk and named in the
         * result so a reader of the record can look at the same pixels the
         * verdict was read from.
         */
        const capturePath = join(RUNS_DIR, `${check.id}-${today()}.png`);
        const shot = await page.screenshot({ path: capturePath });
        const png = decodePng(shot);

        let verdict: ImageVerdict;
        switch (check.property) {
          case "clipping":
            verdict = evaluateClipping(png, box);
            break;
          case "visibility":
          case "visual_prominence":
          case "image_level":
            verdict = evaluateVisibility(png, box);
            break;
          default:
            verdict = {
              passed: false,
              detail:
                `no image evaluator is implemented for property "${check.property}". That is a ` +
                "gap in this harness, stated as one — it is never a passing check.",
            };
        }

        results.push({
          checkId: check.id,
          property: check.property,
          verdict: verdict.passed ? "GREEN" : "RED",
          detail: verdict.detail,
          capturePath,
        });
        if (!verdict.passed) {
          diagnostics.push(visualDiagnostic(check, "rendering", verdict.detail, TESTED_SHA, startedAt));
        }
        await page.close();
        await context.close();
      }
    } finally {
      await browser.close();
    }
  }

  const greens = results.filter((r) => r.verdict === "GREEN").map((r) => r.checkId);
  const repos = await createFileRepositories(CONTROL_PLANE_ROOT);
  const persisted = await persistDiagnostics(repos, diagnostics, startedAt);
  const closure = await closeSatisfiedDiagnostics(
    repos,
    { instrument: "VISUAL_SUITE", testedSha: TESTED_SHA, greenInstanceIds: greens },
    containsCommit,
    startedAt,
  );

  const record = {
    baseUrl: BASE,
    testedSha: TESTED_SHA,
    startedAt,
    finishedAt: new Date().toISOString(),
    checksLoaded: bindings.length,
    evaluatedGreen: greens.length,
    evaluatedRed: results.filter((r) => r.verdict === "RED").length,
    notEvaluable: results.filter((r) => r.verdict === "NOT_EVALUABLE").length,
    results,
    diagnostics: {
      created: persisted.created,
      existing: persisted.existing,
      closed: closure.closed,
    },
  };
  const recordPath = nextRunRecordPath(RUNS_DIR, today());
  writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");

  for (const r of results) {
    console.log(`  ${r.verdict} · ${r.checkId} (${r.property})`);
    console.log(`      ${r.detail}`);
    if (r.capturePath) console.log(`      capture: ${r.capturePath}`);
  }
  if (bindings.length === 0) {
    console.log(
      "  0 visual acceptance checks loaded — awaiting owner captures. The inbox at " +
        "owner-intake/defect-inbox/ is where an annotated screenshot becomes one.",
    );
  }
  /*
   * RULING 159: the green count is stated on the loaded population, so an
   * empty store reports COULD NOT ASSERT rather than a measured zero green.
   */
  console.log(
    `  ${floorLine(
      floored(
        "checks green",
        "the loaded visual acceptance checks",
        bindings.length,
        greens.length,
        bindings.length === 0 ? "no visual acceptance check is loaded" : undefined,
      ),
    )}`,
  );
  console.log(
    `  DIAGNOSTICS: ${persisted.created.length} created · ${persisted.existing.length} ` +
      `already open · ${closure.closed.length} closed`,
  );
  console.log(`  run record: ${recordPath}`);
}

main().catch((error) => {
  console.error(`visual:suite · FAILED: ${error instanceof Error ? error.stack : String(error)}`);
  process.exit(1);
});
