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

import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
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
  requiredEvidenceKind,
  validateVisualAcceptanceCheck,
  type VisualAcceptanceCheck,
} from "../lib/health/visual-acceptance.ts";
import {
  assertionFits,
  evaluateDomAssertion,
  rowSelectorFor,
  type DomAssertion,
  type DomObservation,
} from "../lib/health/dom-evaluation.ts";
import {
  evaluateClipping,
  evaluateOverlap,
  evaluatePosition,
  evaluateProminence,
  evaluateReadingOrder,
  evaluateSpacing,
  evaluateVisibility,
  type ElementBox,
  type ExpectedRegion,
  type ImageVerdict,
} from "../lib/health/visual-evaluation.ts";

import { isLocalBase } from "../lib/ops/live-write-guard.ts";
import { launchGuarded } from "./browser.mts";
import { today } from "./doc-dates.mjs";
import { decodePng } from "./png.mts";

const DEFAULT_BASE = "http://localhost:3000";
const BASE = (process.env.SHOOT_BASE_URL ?? DEFAULT_BASE).replace(/\/$/, "");

try {
  new URL(BASE);
} catch {
  console.error(`visual:suite · SHOOT_BASE_URL is not a URL: ${BASE}`);
  process.exit(1);
}
/** FE-01: a non-local target is read with every write route aborted in the browser. */
const LIVE_TARGET = !isLocalBase(BASE);
if (LIVE_TARGET) {
  console.log(`visual:suite · live target ${BASE}: write routes are aborted in the browser (FE-01).`);
}
/** Write requests the browser aborted, kept for the run record after it closes. */
let writesBlocked: { count: number; paths: string[] } = { count: 0, paths: [] };

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
  /**
   * The SECOND element, for the properties that are relationships.
   * (Session B WI1.7.) `overlap` and `spacing` are claims about a pair, and a
   * check that binds one selector cannot state either — so a check for those
   * properties without `against` is NOT_EVALUABLE with the missing binding
   * named, never a red against the product.
   */
  readonly against?: string;
  /** The declared order, for `responsive_hierarchy`. Two or more selectors. */
  readonly order?: readonly string[];
  /** Where `position` expects the element, in device-independent pixels. */
  readonly expectedRegion?: ExpectedRegion;
  /** The gap `spacing` expects between `selector` and `against`, in px. */
  readonly expectedGapPx?: number;
  /** Per-check slack, where the property takes one. Defaults live in the evaluator. */
  readonly tolerancePx?: number;
  /**
   * What a DOM-certifiable check CLAIMS. Required on every check whose
   * property is DOM-certifiable, refused on every check whose property is not.
   * (Part C, 2026-08-31 — see `lib/health/dom-evaluation.ts`.)
   */
  readonly assertion?: DomAssertion;
  /**
   * Reader steps the surface needs before the subject exists.
   *
   * Some claims are about a panel that only appears once a reader has done
   * something — typed a question, opened a door. The steps are the READER's
   * own interaction, driven through the page, and a step whose selector is not
   * there makes the check NOT_EVALUABLE naming the step rather than scoring
   * the product on a surface it never reached.
   */
  readonly setup?: readonly CheckSetupStep[];
}

type CheckSetupStep =
  | { readonly kind: "CLICK"; readonly selector: string }
  | { readonly kind: "FILL"; readonly selector: string; readonly text: string }
  | { readonly kind: "PRESS"; readonly selector: string; readonly key: string }
  | { readonly kind: "WAIT_FOR"; readonly selector: string; readonly timeoutMs?: number };

interface CheckResult {
  readonly checkId: string;
  readonly property: string;
  readonly verdict: "GREEN" | "RED" | "NOT_EVALUABLE";
  readonly detail: string;
  readonly capturePath: string | null;
  /**
   * WHICH KIND OF EVIDENCE ANSWERED THIS. Recorded per result rather than
   * inferred by a reader of the record: the property→evidence rule is the
   * load-bearing rule of this whole artifact type, and a record that does not
   * say which side answered cannot be audited against it.
   */
  readonly evidenceKind: "DOM_EVALUATED" | "IMAGE_EVALUATED" | "NONE";
  /** The raw DOM observation a DOM verdict was read from. Null for image checks. */
  readonly observation: DomObservation | null;
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
  for (const binding of bindings) {
    const { check } = binding;
    const problems = validateVisualAcceptanceCheck(check);
    /*
     * **AND THE BINDING IS VALIDATED TOO, NOT ONLY THE OWNER'S CHECK.**
     * (Part C, 2026-08-31.)
     *
     * `validateVisualAcceptanceCheck` guards the OWNER's artifact — property,
     * evidence kind, viewport, expectation. It knows nothing about the
     * harness's side of the binding, and the harness's side is where a check
     * silently stops asserting anything: a DOM-certifiable property with no
     * assertion would run, find its element, and have nothing to say about it.
     */
    if (requiredEvidenceKind(check.property) === "DOM_EVALUATED") {
      if (!binding.assertion) {
        problems.push(
          `property "${check.property}" is DOM-certifiable and this check carries no ` +
            "`assertion`. A check that names a selector and states no claim about what it " +
            "finds is a check that cannot fail, which is not a check.",
        );
      } else {
        const misfit = assertionFits(check.property, binding.assertion);
        if (misfit) problems.push(misfit);
      }
    } else if (binding.assertion) {
      problems.push(
        `property "${check.property}" requires IMAGE_EVALUATED evidence and this check also ` +
          "carries a DOM `assertion`. Two evidence paths on one check is how the DOM shortcut " +
          "gets taken by accident; the assertion is refused rather than ignored.",
      );
    }
    if (!binding.selector.trim()) {
      problems.push("the binding carries no selector, so nothing on the page is being asked");
    }
    if (problems.length > 0) {
      console.error(`visual:suite · REFUSED — check ${check.id}: ${problems.join("; ")}`);
      process.exit(1);
    }
    assertValidVisualAcceptanceCheck(check);
  }

  /*
   * **A RUN THAT LOADED NOTHING IS A FAILED RUN.** (Part C, 2026-08-31.)
   *
   * This exited 0 on an empty store and printed a friendly line about awaiting
   * owner captures. The record it wrote said `checksLoaded: 0`, and thirteen
   * sweep rows were closed against `vac:` ids while that was the last thing
   * this instrument had ever recorded — which is RULING 159 exactly: a
   * denominator of zero is an ERROR, and a green that was never measured is
   * the shape this repository names more often than any other.
   *
   * A store with nothing in it is now a failure of the SUITE, stated as one,
   * with a non-zero exit. It is refused BEFORE the browser opens so the
   * refusal cannot be mistaken for a product finding.
   */
  if (bindings.length === 0) {
    const emptyRecord = {
      baseUrl: BASE,
      testedSha: TESTED_SHA,
      startedAt,
      finishedAt: new Date().toISOString(),
      runVerdict: "FAILED" as const,
      failureReasons: [
        `${CHECKS_PATH} holds no visual acceptance check, so this run measured nothing. ` +
          "A denominator of zero is an error, never a pass (RULING 159).",
      ],
      checksLoaded: 0,
      evaluatedGreen: 0,
      evaluatedRed: 0,
      notEvaluable: 0,
      results: [] as CheckResult[],
      diagnostics: { created: [], existing: [], closed: [] },
    };
    const emptyPath = nextRunRecordPath(RUNS_DIR, today());
    writeFileSync(emptyPath, `${JSON.stringify(emptyRecord, null, 2)}\n`, "utf8");
    console.error(
      `\nvisual:suite · FAILED — 0 visual acceptance checks loaded from ${CHECKS_PATH}.\n\n` +
        "  A suite that loads no checks measures nothing, and a run that measures nothing\n" +
        "  may not exit green: every `vac:` id a sweep cites resolves against this store,\n" +
        "  and an empty store is why thirteen rows sat in CHECK DEBT.\n\n" +
        `  run record: ${emptyPath}\n`,
    );
    process.exit(1);
  }

  const results: CheckResult[] = [];
  const diagnostics: WorkItem[] = [];

  if (bindings.length > 0) {
    const browser = await launchGuarded({ label: "visual-suite", headless: true, blockWrites: LIVE_TARGET });
    try {
      for (const binding of bindings) {
        const { check, selector } = binding;
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
        /*
         * THE READER'S OWN STEPS, DRIVEN BEFORE ANYTHING IS OBSERVED.
         *
         * A claim about an answer panel is a claim about a surface that only
         * exists once a reader has asked something. Supplying the panel would
         * be the harness certifying its own fixture, so the steps drive the
         * page's real controls and a step that cannot run stops the check with
         * the step named.
         */
        let setupFailure: string | null = null;
        for (const step of binding.setup ?? []) {
          try {
            if (step.kind === "CLICK") {
              await page.click(step.selector, { timeout: 15_000 });
            } else if (step.kind === "FILL") {
              await page.fill(step.selector, step.text, { timeout: 15_000 });
            } else if (step.kind === "PRESS") {
              await page.press(step.selector, step.key, { timeout: 15_000 });
            } else {
              await page.waitForSelector(step.selector, {
                timeout: step.timeoutMs ?? 30_000,
              });
            }
          } catch (error) {
            setupFailure =
              `the reader step ${step.kind} on ${JSON.stringify(step.selector)} could not run ` +
              `on ${check.surface} at zip ${check.zip}: ` +
              `${error instanceof Error ? error.message.split("\n")[0] : String(error)}. ` +
              "The surface this check is about was never reached, so nothing here is a " +
              "verdict about the product.";
            break;
          }
        }
        if (setupFailure !== null) {
          results.push({
            checkId: check.id,
            property: check.property,
            verdict: "NOT_EVALUABLE",
            detail: setupFailure,
            capturePath: null,
            evidenceKind: "NONE",
            observation: null,
          });
          await page.close();
          await context.close();
          continue;
        }

        await page.waitForSelector(selector, { timeout: 20_000 }).catch(() => null);

        /*
         * The capture is EVIDENCE on every check, and on an image check it is
         * also the measurement. It is written before the branch so a reader of
         * the record can look at the surface a DOM verdict was read from too.
         */
        /*
         * **THE CAPTURE PATH IS SANITISED, AND THEN THE FILE IS VERIFIED TO
         * EXIST.** (Part C, 2026-08-31. Measured, on the first real run.)
         *
         * This was `${check.id}-${today()}.png`, and every check id in this
         * store begins `vac:`. On Windows a colon in a path is the NTFS
         * ALTERNATE DATA STREAM separator: the write "succeeded", the run
         * record named thirteen capture paths, and what was actually on disk
         * was one zero-byte file called `vac` carrying thirteen hidden
         * streams. Not one capture was readable, and nothing said so.
         *
         * A record that cites evidence which does not exist is the exact
         * defect this whole Part was opened to close, arriving inside the
         * instrument built to close it. So the name is sanitised, and the file
         * is then STAT'd — a capture path is recorded only when a non-empty
         * file is actually there, and otherwise the result carries null and
         * the reason rather than a path a reader cannot open.
         */
        const captureFile = `${check.id.replace(/[^A-Za-z0-9._-]+/g, "-")}-${today()}.png`;
        const intendedCapture = join(RUNS_DIR, captureFile);
        const shot = await page.screenshot({ path: intendedCapture });
        let capturePath: string | null = intendedCapture;
        try {
          if (statSync(intendedCapture).size === 0) capturePath = null;
        } catch {
          capturePath = null;
        }
        if (capturePath === null) {
          console.error(
            `visual:suite · ${check.id}: the capture was not written to ${intendedCapture}. ` +
              "The verdict below still stands on the DOM observation; the IMAGE evidence for it " +
              "does not exist and is recorded as absent rather than as a path.",
          );
        }

        /* ── THE DOM SIDE ───────────────────────────────────────────────── */
        if (requiredEvidenceKind(check.property) === "DOM_EVALUATED") {
          /*
           * `binding.assertion` is non-null here: the load-time refusal above
           * exits the process for a DOM-certifiable property without one.
           */
          const assertion = binding.assertion as DomAssertion;
          const rowSelector = rowSelectorFor(assertion);
          /*
           * ONE QUESTION, ONE RENDER. Everything the verdict needs is read in
           * a single evaluate, so no part of it can describe a page that has
           * moved on since another part was read.
           *
           * `innerText`, never `textContent`: textContent has no separators,
           * so a phrase spanning two elements concatenates into one token and
           * a match that should fire never does.
           */
          const observation = (await page.evaluate(
            `(function () {
              var sel = ${JSON.stringify(selector)};
              var rowSel = ${JSON.stringify(rowSelector)};
              var all = document.querySelectorAll(sel);
              var first = all[0] || null;
              var attrs = {};
              if (first) {
                for (var i = 0; i < first.attributes.length; i += 1) {
                  attrs[first.attributes[i].name.toLowerCase()] = first.attributes[i].value;
                }
              }
              var text = null;
              if (first) {
                var raw = first.innerText;
                if (raw === undefined || raw === null) raw = first.textContent || "";
                text = String(raw).replace(/\\s+/g, " ").trim();
              }
              var href = null;
              if (first && typeof first.href === "string") href = first.href;
              var detailsOpen = null;
              if (first && first.tagName === "DETAILS") detailsOpen = first.open === true;
              if (first && first.tagName === "SUMMARY" && first.parentElement
                  && first.parentElement.tagName === "DETAILS") {
                detailsOpen = first.parentElement.open === true;
              }
              return {
                selector: sel,
                matchCount: all.length,
                text: text,
                attributes: attrs,
                href: href,
                rowCount: rowSel ? document.querySelectorAll(rowSel).length : null,
                detailsOpen: detailsOpen
              };
            })()`,
          )) as DomObservation;

          const domVerdict = evaluateDomAssertion(observation, assertion);
          results.push({
            checkId: check.id,
            property: check.property,
            verdict: domVerdict.verdict,
            detail: domVerdict.detail,
            capturePath,
            evidenceKind: "DOM_EVALUATED",
            observation,
          });
          if (domVerdict.verdict === "RED") {
            diagnostics.push(
              visualDiagnostic(check, "rendering", domVerdict.detail, TESTED_SHA, startedAt),
            );
          }
          await page.close();
          await context.close();
          continue;
        }

        /* ── THE IMAGE SIDE ─────────────────────────────────────────────── */
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
            capturePath,
            evidenceKind: "NONE",
            observation: null,
          });
          await page.close();
          await context.close();
          continue;
        }

        const png = decodePng(shot);

        /*
         * **EACH PROPERTY IS EVALUATED BY SOMETHING CAPABLE OF PROVING IT.**
         * (Session B WI1.7.)
         *
         * `visual_prominence` and `image_level` used to run the VISIBILITY
         * test, so "this element stands out" was certified by "something is
         * painted in this box" — true of every element the product renders.
         * And overlap, position, spacing and responsive hierarchy fell to a
         * default that scored the harness's own gap as a product RED.
         *
         * Now: a real evaluator per property, and where a check does not carry
         * what its property needs — a second element, an expected region, a
         * declared order — the result is NOT_EVALUABLE with the missing
         * binding NAMED. Never GREEN, and never a red blaming the product for
         * a check that did not say enough to be answered.
         */
        const boxFor = async (sel: string): Promise<ElementBox | null> =>
          (await page.evaluate(
            `(function () {
              var el = document.querySelector(${JSON.stringify(sel)});
              if (!el) return null;
              var r = el.getBoundingClientRect();
              return { x: r.x, y: r.y, width: r.width, height: r.height };
            })()`,
          )) as ElementBox | null;

        let verdict: ImageVerdict | null = null;
        let notEvaluable: string | null = null;

        switch (check.property) {
          case "clipping":
            verdict = evaluateClipping(png, box);
            break;
          case "visibility":
          case "image_level":
            verdict = evaluateVisibility(png, box);
            break;
          case "visual_prominence":
            verdict = evaluateProminence(png, box);
            break;
          case "overlap":
          case "spacing": {
            if (!binding.against) {
              notEvaluable =
                `property "${check.property}" is a relationship between two elements and this ` +
                "check binds one selector. It needs `against`. A pair property cannot be read " +
                "from a single box, so this is a gap in the CHECK, named, and not a verdict " +
                "about the product.";
              break;
            }
            const other = await boxFor(binding.against);
            if (other === null) {
              notEvaluable =
                `the harness could not find the second element ${binding.against} on ` +
                `${check.surface} at zip ${check.zip}; a pair property with one element ` +
                "present is an unanswered observation, never a passing check.";
              break;
            }
            if (check.property === "overlap") {
              verdict = evaluateOverlap(png, box, other);
            } else if (binding.expectedGapPx === undefined) {
              notEvaluable =
                "a spacing check states what the gap should be; this one carries no " +
                "`expectedGapPx`, so there is no expectation to measure against.";
            } else {
              verdict = evaluateSpacing(
                png,
                box,
                other,
                binding.expectedGapPx,
                1,
                binding.tolerancePx,
              );
            }
            break;
          }
          case "position": {
            if (!binding.expectedRegion) {
              notEvaluable =
                "a position check states where the element belongs; this one carries no " +
                "`expectedRegion`, and an unstated expectation cannot be met or missed.";
              break;
            }
            verdict = evaluatePosition(
              png,
              box,
              binding.expectedRegion,
              1,
              binding.tolerancePx,
            );
            break;
          }
          case "responsive_hierarchy": {
            const order = binding.order ?? [];
            if (order.length < 2) {
              notEvaluable =
                "a responsive-hierarchy check states the order it expects; this one binds " +
                `${order.length} selector(s) in \`order\`, and one element has no hierarchy.`;
              break;
            }
            const resolved: { label: string; box: ElementBox }[] = [];
            const unfound: string[] = [];
            for (const sel of order) {
              const b = await boxFor(sel);
              if (b === null) unfound.push(sel);
              else resolved.push({ label: sel, box: b });
            }
            if (unfound.length > 0) {
              notEvaluable =
                `the harness could not find ${unfound.length} of ${order.length} ordered ` +
                `element(s): ${unfound.join(", ")}. A hierarchy missing a member is an ` +
                "unanswered observation.";
              break;
            }
            verdict = evaluateReadingOrder(png, resolved);
            break;
          }
          default:
            notEvaluable =
              `no image evaluator is implemented for property "${check.property}". That is a ` +
              "gap in this harness, stated as one — NOT_EVALUABLE, because a harness gap is " +
              "not evidence about the product either way.";
        }

        if (verdict === null) {
          results.push({
            checkId: check.id,
            property: check.property,
            verdict: "NOT_EVALUABLE",
            detail: notEvaluable ?? "the property could not be evaluated and no reason was given",
            capturePath,
            evidenceKind: "NONE",
            observation: null,
          });
        } else {
          results.push({
            checkId: check.id,
            property: check.property,
            verdict: verdict.passed ? "GREEN" : "RED",
            detail: verdict.detail,
            capturePath,
            evidenceKind: "IMAGE_EVALUATED",
            observation: null,
          });
          if (!verdict.passed) {
            diagnostics.push(
              visualDiagnostic(check, "rendering", verdict.detail, TESTED_SHA, startedAt),
            );
          }
        }
        await page.close();
        await context.close();
      }
    } finally {
      writesBlocked = { count: browser.writesBlocked.count, paths: [...browser.writesBlocked.paths].sort() };
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

  const red = results.filter((r) => r.verdict === "RED");
  const unevaluable = results.filter((r) => r.verdict === "NOT_EVALUABLE");

  /*
   * **THE RUN'S OWN VERDICT, DERIVED FROM THE RESULTS AND WRITTEN DOWN.**
   * (Part C, 2026-08-31.)
   *
   * Three ways this run is not a pass, and each is named separately because
   * they mean different things and a reader must not have to guess which:
   *
   *   checksLoaded 0    the instrument measured nothing (refused above)
   *   a RED             a claim the owner accepted is no longer true
   *   a NOT_EVALUABLE   the check exists and asserts nothing yet
   *
   * The third is the one that used to pass quietly, and it is why thirteen
   * sweep rows cited instruments that were never going to answer. A check that
   * cannot be evaluated is carrying the same weight as no check at all, so the
   * run says so out loud and exits non-zero.
   */
  const failureReasons: string[] = [];
  if (red.length > 0) {
    failureReasons.push(
      `${red.length} of ${bindings.length} check(s) went RED: ${red
        .map((r) => r.checkId)
        .join(", ")}. Each is a claim the owner accepted that the surface no longer meets.`,
    );
  }
  if (unevaluable.length > 0) {
    failureReasons.push(
      `${unevaluable.length} of ${bindings.length} check(s) are NOT_EVALUABLE: ${unevaluable
        .map((r) => r.checkId)
        .join(", ")}. A check that cannot be evaluated proves nothing, and a row closed ` +
        "against one is closed against nothing.",
    );
  }

  const record = {
    baseUrl: BASE,
    liveTarget: LIVE_TARGET,
    writesBlocked,
    testedSha: TESTED_SHA,
    startedAt,
    finishedAt: new Date().toISOString(),
    runVerdict: failureReasons.length === 0 ? ("PASSED" as const) : ("FAILED" as const),
    failureReasons,
    checksLoaded: bindings.length,
    evaluatedGreen: greens.length,
    evaluatedRed: red.length,
    notEvaluable: unevaluable.length,
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
    console.log(`  ${r.verdict} · ${r.checkId} (${r.property}, ${r.evidenceKind})`);
    console.log(`      ${r.detail}`);
    if (r.capturePath) console.log(`      capture: ${r.capturePath}`);
  }
  /*
   * RULING 159: the green count is stated on the loaded population, so an
   * empty store reports COULD NOT ASSERT rather than a measured zero green.
   * (An empty store no longer reaches here at all — it is refused above.)
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

  if (failureReasons.length > 0) {
    console.error(`\nvisual:suite · FAILED — ${failureReasons.length} reason(s):`);
    for (const reason of failureReasons) console.error(`  · ${reason}`);
    process.exit(1);
  }
  console.log(
    `\nvisual:suite · PASSED — ${greens.length} of ${bindings.length} check(s) green, ` +
      "0 red, 0 not evaluable.",
  );
}

main().catch((error) => {
  console.error(`visual:suite · FAILED: ${error instanceof Error ? error.stack : String(error)}`);
  process.exit(1);
});
