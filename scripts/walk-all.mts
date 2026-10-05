/**
 * `pnpm walk:all` — the regression net.
 *
 *   pnpm build && pnpm start   # in another shell — the LOCAL production build
 *   pnpm walk:all              # against http://localhost:3000
 *
 * `SHOOT_BASE_URL` points it at the live site instead. Writes are aborted in
 * the browser on any non-local target (FE-01); the reasoning is at the `BASE`
 * declaration below.
 *
 * ## Why this exists
 *
 * Every session before this one wrote its own walk, and every walk checked
 * only the surfaces that session had touched. So a win shipped in one session
 * and broken in the next died silently: nothing owned it. Kearsarge's fifteen
 * sittings, verified in the truth session, were gone before anyone looked;
 * `/about-area` had been 500ing at every zip; the reader's own picks had
 * vanished off the ballot page. Three real regressions, none of them caught,
 * because no walk was responsible for a claim once its session ended.
 *
 * This is that owner. Every check below is a claim some prior session
 * SHIPPED, re-expressed as an assertion a machine can make against
 * production, and tagged with the session that shipped it. A failure here is
 * not "a check failed" — it is a **named regression**, and the summary prints
 * it as one, with the session that is being undone.
 *
 * ## The standing rule (CLAUDE.md)
 *
 * Every session ends by running this against production. A prior win that
 * fails is a regression named in the standing report. New walks APPEND — the
 * suite only grows, and a check is removed only when the author retires the
 * claim behind it.
 *
 * ## What is deliberately NOT here, and why
 *
 * The prior walks that TAP A REACTION or FIRE A LOG EVENT are excluded whole:
 * `tester-walk-0814b`, `-0814d` and the reaction half of `-0815`. Those write
 * real rows to the production store, and a suite that runs every session
 * would manufacture reader signal on every run — the exact thing
 * `CLAUDE.md`'s probe-naming rule exists to keep visible. Their read-only
 * halves (the disclosure gate's WORDING, the honest-refusal line, the
 * controls being reachable) are carried here; their write halves stay in
 * those scripts, run by hand when the write path itself is what changed.
 * `EXCLUDED` at the bottom prints that list every run, so the gap is stated
 * rather than implied.
 *
 * The screenshot passes (`pnpm pairs`, `pnpm shoot`) are also not here. They
 * are a different instrument: this one is behavioural, and a human rules on
 * pixels.
 *
 * ## Probe rows
 *
 * A GET to `/api/meetings` writes a SEARCH row to the production search log
 * (`app/api/meetings/route.ts` calls `logSearchEvent`) — so the map settling
 * on a zip writes one, and so does every direct probe here. This walk COUNTS
 * them and prints the total, because the standing order says every row a
 * session creates against production is named in its report. No reaction is
 * ever tapped and no ask is ever submitted.
 */
// `mkdirSync`/`readdirSync` left with the hand-rolled run-record sequencer
// they belonged to; `nextRunRecordPath` owns both now.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  outcomeFor,
  type QuarantineFile,
} from "../lib/ops/flake-quarantine.ts";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

import { neon } from "@neondatabase/serverless";
import { config as loadEnv } from "dotenv";
import { type Page } from "playwright";

import { makeRunId, syntheticRunHeaders } from "../lib/db/run-marker.ts";
import { nextRunRecordPath } from "../lib/health/run-records.ts";
import { today as phoenixDay } from "./doc-dates.mjs";
import { PRODUCT_NAME } from "../lib/brand.ts";
import {
  CONCLUDED_LOOKBACK_DAYS,
  UPCOMING_HORIZON_DAYS,
} from "../lib/meetings/constants.ts";
import { internalSourceIds } from "../lib/meetings/source-labels.ts";
import { ASK_PILL_EXAMPLES } from "../lib/routing/ask-pill-labels.ts";
import { mojibakePattern } from "../lib/text/mojibake.ts";
import { readRunProvenance } from "../lib/ops/run-provenance.ts";
/*
 * The W6H3 frame statistics come from the SAME module `pnpm measure:flyin`
 * uses. A permanent check and the instrument it was derived from computing
 * "median fps" two different ways is how a green walk and a red measurement end
 * up both being true about one build.
 */
import {
  busyPct,
  cpuTicks,
  frameGaps,
  GPU_ARGS,
  hostCondition,
  isSoftwareRenderer,
  judgeNormalized,
  judgeSoftware,
  LONG_FRAME_MS,
  NORMALIZED_FLOOR,
  READ_RENDERER,
  SOFTWARE_JANK_CEILING,
  SOFTWARE_NORMALIZED_FLOOR,
  summariseArm,
  type ArmSummary,
} from "../lib/ops/flyin-normalized.ts";
import { decodePng, patchStats, regionChange } from "./png.mts";
import { launchGuarded, type GuardedBrowser } from "./browser.mts";

import { PUBLIC_SITE_ORIGIN } from "../lib/ops/origins.ts";
import { isLocalBase } from "../lib/ops/live-write-guard.ts";
import { askRunHash } from "../lib/db/ask-signal.ts";

/**
 * THE TARGET: A LOCAL BUILD BY DEFAULT, THE LIVE SITE WHEN ASKED (FE-01).
 *
 * RULING 125 (2026-08-24) refused every non-local target, because a walk of
 * production wrote rows into stores this product sells. Current rulings §6
 * require looking at the live page, so the refusal is gone and the reason for
 * it is handled at the source instead: a live target opens its browser with
 * `blockWrites`, which aborts every write route (`/api/log`, `/api/events`,
 * `/api/reactions`, `/api/feedback`, `/api/ask`, Send) before it leaves the
 * browser. The search log is written only through `/api/log` since PDC-9, so
 * a live walk leaves no search-log or Ask row, and the census at the end of
 * this file checks exactly that against production.
 *
 *   SHOOT_BASE_URL=<the live origin, PUBLIC_SITE_ORIGIN> pnpm walk:all
 */
const DEFAULT_BASE = "http://localhost:3000";
const BASE = (process.env.SHOOT_BASE_URL ?? DEFAULT_BASE).replace(/\/$/, "");

try {
  new URL(BASE);
} catch {
  console.error(`walk:all · SHOOT_BASE_URL is not a URL: ${BASE}`);
  process.exit(1);
}
/** True when this run reads a site other than the machine running it. */
const LIVE_TARGET = !isLocalBase(BASE);
if (LIVE_TARGET) {
  console.log(`walk:all · live target ${BASE}: write routes are aborted in the browser (FE-01).`);
}

/** The four zips that are the product (state.md §9), plus the refusal zip. */
const ZIPS = {
  tucson: { zip: "85701", lat: 32.21696, lng: -110.971 },
  vail: { zip: "85641", lat: 32.04903, lng: -110.62291 },
  rockaway: { zip: "07866", lat: 40.95499, lng: -74.48801 },
  newbury: { zip: "03255", lat: 43.31403, lng: -72.02455 },
} as const;
const FOUR = [ZIPS.tucson, ZIPS.vail, ZIPS.rockaway, ZIPS.newbury];

const PHONE = { width: 390, height: 844 };

// ── The ledger ─────────────────────────────────────────────────────────────

interface Failure {
  session: string;
  name: string;
  evidence: string;
}

const failures: Failure[] = [];
let passed = 0;

/**
 * Every check that actually RAN, by the session that shipped it.
 *
 * ITEM 1c (g6, 2026-08-17). The suite's count did not reconcile across two
 * sessions: g5 reported 133 before its work, retired 4 and added 7, and
 * reported 134 — which is arithmetic that does not close — and h then took
 * 134 as given and grew it to 135.
 *
 * The enumeration found no lost check. What it found was that **the starting
 * number was wrong**: the count at g5's parent commit was 131, not 133, and
 * 131 - 4 + 7 = 134 closes exactly. 131 is also the number g4's own report
 * recorded ("Green locally: 131 of 131"). A single mis-transcribed integer
 * propagated through two sessions and a merge and looked, from the far end,
 * exactly like two checks silently dying.
 *
 * The count is data-dependent — several checks live inside per-zip loops and
 * eleven more come off the `MEETING_FLOORS` table — so it can never be
 * derived by reading the file, which is why it was being copied by hand. So
 * the suite prints its own census: no session has to transcribe a number
 * again, and a session that adds checks can diff its own run against the
 * previous one instead of trusting a sentence in a report.
 */
const census = new Map<string, number>();

/**
 * Every check that ran, BY IDENTITY — and the reason integers were not enough.
 *
 * The census above fixed one half of the counting problem: no session has to
 * transcribe a total. It did not fix the other half. A session still compares
 * its run to the previous one by SUBTRACTING — "148 last time, 152 now, so I
 * added four" — and that subtraction is blind in the way that matters: a run
 * that loses three checks and gains seven reports +4, identical to a run that
 * simply gained four. The failure the suite exists to catch is a check dying
 * quietly, and integer arithmetic is exactly the instrument that cannot see it.
 *
 * So the run emits its check identities as a SET, `docs/walk-checks.txt`, and
 * diffs itself against the committed one. What prints is what a session
 * actually needs to say: these were added, these are GONE. A removal is loud
 * even when the total went up.
 *
 * Names are stable by construction — the interpolated parts are zips and body
 * names from committed tables, never a measured value, which belongs in the
 * `evidence` argument. A name that carried a measurement would churn the diff
 * on every run and teach everyone to ignore it.
 */
const identities: string[] = [];
const CHECKS_FILE = join(process.cwd(), "docs", "walk-checks.txt");

/**
 * One assertion, owned by the session that shipped the claim.
 *
 * `session` is not decoration: a failure prints as "the win <session> shipped
 * is undone", which is the sentence the standing report needs and the one a
 * bare check name cannot produce.
 */
/**
 * **THE QUARANTINE LIST (`NH176`, 2026-08-25).**
 *
 * A check that has been shown to FAIL AND THEN PASS on an unchanged build is
 * flaky, and a suite that fails one arbitrary check per run teaches a session
 * to skim past the real one. Quarantined checks still RUN and still print —
 * they are tracked and hunted, never deleted and never counted passing.
 *
 * Detection is rerun-based and lives in `pnpm flake:sweep`; this file is only
 * the committed verdict, so a run cannot quarantine anything on its own.
 */
const QUARANTINE: QuarantineFile | null = (() => {
  try {
    return JSON.parse(
      readFileSync(join(process.cwd(), "docs", "walk-flakes.json"), "utf8"),
    ) as QuarantineFile;
  } catch {
    return null;
  }
})();
const quarantined: string[] = [];

/**
 * **PER-CHECK WALL TIME — measure before you optimise (WI7, 2026-08-30).**
 *
 * The standing walk had one timing instrument: `elapsed()`, a running total
 * printed on every line. A total tells a session the suite is slow and tells
 * it nothing about WHERE, so every previous attempt to speed this up would
 * have been a guess, and a guess that removes the wrong wait removes
 * measurement rather than cost.
 *
 * What is attributed to a check is the wall time from the END of the previous
 * check to this one — the assertion plus everything done to make it possible
 * (the page load, the zip seed, the wait). That is deliberate: the assertions
 * themselves are microseconds and the setup is the whole cost, so attributing
 * setup to the check that needed it is what points at the real expense.
 *
 * The first check of the run carries the harness start-up, which is a true
 * cost of the run and belongs to something.
 */
interface CheckDuration {
  readonly identity: string;
  readonly ms: number;
  /**
   * What this check actually reported. Recorded alongside the time because
   * the status ledger resolves a capability's named walk identity to an
   * OUTCOME, and a run record holding only wall times could say a check ran
   * without saying whether it passed — which is the shape of every status
   * surface this session is repairing.
   */
  outcome: "PASS" | "FAIL" | "QUARANTINED";
}
const durations: CheckDuration[] = [];
let lastCheckEndedAt = Date.now();
function recordCheckDuration(identity: string): CheckDuration {
  const now = Date.now();
  const row: CheckDuration = { identity, ms: now - lastCheckEndedAt, outcome: "PASS" };
  durations.push(row);
  lastCheckEndedAt = now;
  return row;
}


function check(session: string, name: string, ok: boolean, evidence = ""): boolean {
  census.set(session, (census.get(session) ?? 0) + 1);
  const identity = `[${session}] ${name}`;
  identities.push(identity);
  const durationRow = recordCheckDuration(identity);

  /*
   * FOUR outcomes, four different facts, and none may wear another's clothes
   * (RULING 24). `outcomeFor` is what makes "never counted passing" true
   * rather than promised: the only way to get PASS out of it is to have
   * passed.
   */
  const outcome = outcomeFor(QUARANTINE, identity, ok);
  durationRow.outcome = outcome;
  if (outcome === "PASS") passed += 1;
  else if (outcome === "FAIL") failures.push({ session, name, evidence });
  else quarantined.push(`${identity}${evidence ? ` — ${evidence}` : ""}`);

  const mark = outcome === "PASS" ? "ok  " : outcome === "FAIL" ? "FAIL" : "QUAR";
  console.log(`  ${mark} ${elapsed()} ${identity}${evidence ? ` — ${evidence}` : ""}`);
  return ok;
}

/*
 * ## PROGRESS IS PRINTED, BECAUSE SILENCE WAS AMBIGUOUS (`NH196`, 2026-08-25)
 *
 * A prior session ran this against a live local build, saw ZERO BYTES for
 * twenty minutes, and killed it under RULING 146's five-silent-minutes rule.
 * It could not tell a hang from buffering, and neither could anything else:
 * the run emitted nothing until it finished, so a healthy slow run and a dead
 * one were byte-identical.
 *
 * Determined 2026-08-25: **it was never a hang.** The header prints within
 * seconds under `tsx`, `pnpm`, `pnpm -s` and `corepack pnpm -s` alike — the
 * silence was the harness holding a foreground command's output until exit.
 * That is a real problem anyway, because it makes the five-minute rule
 * unusable on the one instrument every session is required to run.
 *
 * So every line now carries ELAPSED SECONDS, and a HEARTBEAT fires whenever a
 * single check has been running longer than the threshold. A reader — human or
 * harness — can now tell "slow" from "stopped" by looking, which is the whole
 * of what was missing.
 */
const STARTED_AT = Date.now();
function elapsed(): string {
  const s = Math.round((Date.now() - STARTED_AT) / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

const HEARTBEAT_MS = 30_000;
let lastLineAt = Date.now();
const heartbeat = setInterval(() => {
  const quiet = Math.round((Date.now() - lastLineAt) / 1000);
  if (quiet * 1000 >= HEARTBEAT_MS) {
    console.log(
      `  ..  ${elapsed()} still working — ${quiet}s since the last check ` +
        `(${passed} passed, ${failures.length} failed, ${blocked.length} could not run so far)`,
    );
  }
}, HEARTBEAT_MS);
heartbeat.unref();

const rawLog = console.log.bind(console);
console.log = ((...args: unknown[]) => {
  lastLineAt = Date.now();
  rawLog(...(args as []));
}) as typeof console.log;

/**
 * A check that could not RUN is not a check that failed.
 *
 * `walk-0815g` learned this the hard way: an unreachable meetings service
 * reported through `check` looks identical to "the Zoning Board is missing
 * from production", which is a different and much more alarming claim. A
 * blocked check throws with what blocked it; the suite records it separately.
 */
const blocked: string[] = [];
/**
 * Every identity that DECLARED it could not run (g10, 2026-08-17).
 *
 * Kept beside `blocked` rather than parsed back out of it: a check name and a
 * reason are both free text and both contain em-dashes, so splitting the
 * formatted line would truncate exactly the names that need matching.
 */
const declinedIdentities: string[] = [];

function cannotRun(session: string, name: string, why: string): void {
  blocked.push(`[${session}] ${name} — ${why}`);
  declinedIdentities.push(`[${session}] ${name}`);
  console.log(`  ??  [${session}] ${name} — COULD NOT RUN: ${why}`);
}

function section(title: string): void {
  console.log(`\n${title}`);
}

/* ── R49: wait for an OUTCOME, never for a duration ────────────────────────── */

/**
 * Poll until `settled()` is true, and return whether it ever was.
 *
 * R49 (2026-08-18, g14/g16) — THE CLASS THIS REPLACES. A fixed wait followed
 * by a single read cannot tell GONE from NOT YET, and it reports the first
 * when it means the second. It produced FOUR FALSE REGRESSION REPORTS in one
 * session against a build with nothing wrong with it: the pin floor (R47), the
 * ask refusal (A07), the A02 digest, and the classifier route — each a working
 * surface reported as broken because the walk looked at a moment rather than
 * at an outcome.
 *
 * THE CEILING STILL READS. `until` returning false is not itself a failure and
 * never short-circuits an assertion: the caller reads anyway and the check
 * fails on the truth. A genuine absence must still fail — the point is that a
 * SLOW surface must not.
 *
 * The poll interval below is the one legitimate use of a duration in this
 * file: it is how often the question gets asked, not how long the answer is
 * assumed to take.
 */
/**
 * **EVERY WAIT THAT RAN OUT, COUNTED.** (Session B, W3.7, 2026-08-30.)
 *
 * A.1's `appSettled` waited on a selector today's DOM never produces. The wait
 * could not be satisfied, spent its full timeout every call, returned false —
 * and **nothing read the false**. Removing it took the walk from 1463.4s to
 * 321.2s at identical coverage.
 *
 * `pnpm walk:wait-audit` establishes that no wait now names a selector the
 * product cannot produce. It also establishes the other half, which is not
 * fixed by that: **25 of 26 call sites discard the boolean**, so an
 * unsatisfiable wait would still be a silent nineteen minutes.
 *
 * Converting 25 call sites to hard failures would turn every slow surface into
 * a red walk, which is the behaviour the ceiling was written to avoid — the
 * doc block above is explicit that `until` returning false is not itself a
 * failure. So the fix is not to make a miss FAIL; it is to make a miss
 * IMPOSSIBLE TO MISS. Every timeout is counted here and reported in the run
 * record, where a wait that never settles shows up as a number instead of as
 * wall time nobody attributes.
 */
const waitTimeouts: { label: string; ms: number }[] = [];

async function until(
  page: Page,
  settled: () => Promise<boolean>,
  ms = 15_000,
  step = 150,
  label = "until",
): Promise<boolean> {
  const deadline = Date.now() + ms;
  for (;;) {
    try {
      if (await settled()) return true;
    } catch {
      // A detached element or a navigation mid-poll is a NOT YET, not an answer.
    }
    if (Date.now() >= deadline) {
      waitTimeouts.push({ label, ms });
      return false;
    }
    // R49 POLL INTERVAL — a duration by definition, and the only kind this
    // file keeps.
    await page.waitForTimeout(step);
  }
}

/** `until` for a selector existing, which is most of what this suite waits on. */
async function untilPresent(page: Page, selector: string, ms = 15_000): Promise<boolean> {
  /* The SELECTOR is the label, so a timeout in the run record names the thing
     that never appeared rather than saying "a wait timed out somewhere". */
  return until(page, async () => (await page.locator(selector).count()) > 0, ms, 150, selector);
}

/**
 * `until` for a subtree that has STOPPED CHANGING — `NH121`, 2026-08-24.
 *
 * ## The defect this closes, and it is an instrument defect
 *
 * The meetings-panel check waited on `.al-overlay-count` and then read the
 * whole panel in the same tick. **The header renders before the list body's
 * footer does**, so the read caught the panel mid-render: it saw the stated
 * total, it saw seven group headings summing 200, and it saw NO `Show N more`
 * button — because the button had not been painted yet.
 *
 * That produced `NH121`: *03255 states 201 and its groups add to 200*, reported
 * as a NAMED REGRESSION for a day, with the 200-row page limit explicitly ruled
 * out on the strength of the missing button. **The button was never missing.**
 * Re-measured on the local production build on 2026-08-24 with a settle before
 * the read, the same panel renders `Show 1 more (1 hidden)`, and 200 + 1 = 201
 * reconciles exactly.
 *
 * The product was correct the whole time. The clip was stated, the arithmetic
 * was honest, and the instrument was reading a half-painted panel and
 * reporting a defect in the product.
 *
 * ## Why a settle rather than a longer fixed wait
 *
 * A fixed wait is a guess that gets shorter as machines get faster and longer
 * as pages get heavier, and it fails silently in both directions. This asks the
 * question the check actually has: *has this subtree finished changing?* Two
 * consecutive identical measurements of its markup length, `quietMs` apart.
 */
async function untilSettled(
  page: Page,
  selector: string,
  quietMs = 400,
  ms = 15_000,
): Promise<boolean> {
  const started = Date.now();
  let last = -1;
  while (Date.now() - started < ms) {
    const size = (await page.evaluate(
      `(() => { const el = document.querySelector(${JSON.stringify(selector)}); return el ? el.innerHTML.length : -1; })()`,
    )) as number;
    if (size >= 0 && size === last) return true;
    last = size;
    /*
     * A plain timer, deliberately NOT `page.waitForTimeout`. This is the POLL
     * INTERVAL of an event-driven check, not a fixed wait followed by a single
     * read — and `tests/walk-waits.test.ts` counts the latter, which is the
     * class that filed four false regressions in one session. Putting a poll
     * interval into that ledger would inflate the number the ledger exists to
     * drive down.
     */
    await new Promise<void>((resolve) => setTimeout(resolve, quietMs));
  }
  return false;
}

/** `until` for the page's text containing something. */
async function untilText(page: Page, re: RegExp, ms = 15_000): Promise<boolean> {
  return until(page, async () => re.test(await page.evaluate("document.body.innerText")), ms);
}

/**
 * `until` for an element being PRESENT AND HYDRATED — R52, confirmed g18.
 *
 * ## The defect this closes
 *
 * `untilPresent` waits for a selector to exist. On a server-rendered page that
 * is satisfied by markup, and markup is not a handler. A click landing between
 * "the button is on the page" and "React has wired it" does nothing at all,
 * and the surface it should raise never appears — which reads exactly like a
 * broken feature. g17 diagnosed it; g18 measured it and then proved it at the
 * source.
 *
 * MEASURED: 30 fresh-context trials of the ballot pick against production
 * (`scripts/r52-pick-rate.mts`). 29 first clicks raised the running ballot; ONE
 * did not and the second click on the same button did — the R52 shape exactly,
 * a rate of 3.3%. With g17's own 1 of 4 that is 2 of 34.
 *
 * PROVEN AT THE SOURCE, which is what makes it a diagnosis rather than a
 * plausible story. The served HTML of `/ballot?zip=85701` was fetched with no
 * JavaScript at all and searched for the walk's own selectors: `.ballot-measure`,
 * `<main>`, and the pick locator itself — `.reaction-box[data-kind="pick"]
 * .reaction-choice` — are ALL in it. The button the walk clicks is fully
 * rendered and completely dead before hydration.
 *
 * ## Why this is one site and not sixteen
 *
 * The same fetch was run against `/`, where `appSettled` gates every map
 * check: `.coverage-notice` and `.state-focus-layer` are BOTH ABSENT from the
 * served HTML. They are created by client code, so waiting for them already
 * proves React is running. That is why the map gates have never flaked, and it
 * is why the class here is "a gate satisfiable by server markup that precedes
 * an interaction" rather than "every gate". Swept across the suite, that is
 * ONE site: the ballot pick. The finding is the scope, and the scope is
 * evidence, not inspection.
 *
 * ## How hydration is detected
 *
 * React attaches its fiber and props to the DOM node itself when it hydrates
 * that node. Their presence is the signal — not a timer, not a Next internal,
 * and not a guess about how long hydration takes on a cold phone.
 */
/**
 * The pick box own choices — the ballot-builder, not the reaction sensor
 * sharing its styling. Named once because the R52 gate and the click must
 * address the SAME element: a gate on a broader selector is how a click came
 * to land on something the gate had never waited for.
 */
const PICK_CHOICE = '.reaction-box[data-kind="pick"] .reaction-choice';

async function untilInteractive(page: Page, selector: string, ms = 15_000): Promise<boolean> {
  const expr = `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    return Object.keys(el).some(
      (k) => k.startsWith("__reactFiber$") || k.startsWith("__reactProps$"),
    );
  })()`;
  return until(page, async () => Boolean(await page.evaluate(expr)), ms);
}

/**
 * The app has FINISHED ARRIVING at a seeded zip.
 *
 * THE FIRST VERSION OF THIS WAS WRONG AND THE WALK SAID SO. It settled on
 * "`.coverage-notice` OR a `canvas`", and a canvas exists almost the instant
 * MapLibre mounts — so every page was read while the app was still resolving,
 * and thirteen working checks printed as NAMED REGRESSIONS: four governors
 * missing from who-governs, four state focuses reading "none", Kearsarge and
 * Newbury absent, and two pin floors at zero. That is R49's own defect wearing
 * the other face: an outcome wait on the WRONG outcome is no better than a
 * duration, and it fails faster.
 *
 * So the outcome is both halves of what the reader sees at a zip: the
 * who-governs card, which only renders once the division resolve has returned
 * the governor and the bodies, AND the state focus layer, which only mounts
 * once the map has been told which state the reader is in. Those are the two
 * things the nine-second sleep was really buying.
 *
 * Returning false is not a failure and is not reported as one — the caller
 * reads anyway at the ceiling, so a genuine absence still fails on the truth.
 */
/**
 * **THE CONDITION WAS DEAD, AND IT HAD BECOME A TWENTY-SECOND SLEEP.**
 * (A.1 WI7, 2026-08-30.)
 *
 * `.coverage-notice` is not in the rendered DOM any more. Measured on the
 * local production build at all four pilot zips, at the phone viewport
 * `openAt` uses: **no element carries any class containing "coverage".** The
 * who-governs card renders in the sidebar now, under its own heading, and the
 * coverage line is a `.stat-missing` paragraph inside it.
 *
 * So the `&&` above could never be true, `until` ran to its full ceiling on
 * every single call, and **the return value was discarded** — which is what
 * made it silent. The comment above described an outcome wait. The behaviour
 * was a blind twenty-second pause, which this file's own R49 note calls the
 * exact defect it exists to prevent.
 *
 * (The line above deliberately says that in words. Spelling the call out
 * literally would put a new fixed-wait token in this file, and the R49 sweep
 * greps raw text — so documenting the defect would register as committing it.)
 *
 * The cost, measured rather than estimated: of the 2026-08-30 baseline run's
 * 1463.4s over 390 checks, **61 checks accounted for 1365.3s — 93.3% of the
 * total** — and each of them was a page open or reload paying the full 20s.
 * The other 322 checks together cost about 41s.
 *
 * ## What replaces it, and why these signals
 *
 * The header this replaces is RIGHT about what to wait for and its warning is
 * kept: settling on "a canvas exists" once produced thirteen false regressions,
 * because a canvas appears the instant MapLibre mounts and long before the
 * division resolve returns. An outcome wait on the WRONG outcome is no better
 * than a duration and it fails faster.
 *
 * So the outcome is still both halves of what a reader sees at a zip, named
 * against the DOM as it renders TODAY and each verified to arrive only after
 * the work it stands for:
 *
 * ```
 *   the state focus layer          mounts once the map knows the state
 *   the who-governs card           renders once the division resolve returned
 *   a meetings count               renders once the meetings query returned
 * ```
 *
 * Measured first-appearance across the four pilot zips: 311-1860ms, 451-1955ms
 * and 196-1737ms. The old ceiling of 20s stays exactly where it was — it is a
 * WALL, not a target, and nothing here shortens what the suite waits FOR.
 *
 * A short quiescence follows, for `untilSettled`'s reason (`NH121`): the
 * header renders before the body's footer does, and a read in the same tick as
 * the last signal catches a half-painted panel.
 *
 * **The result is returned AND used.** `openAt` reports a page that never
 * settled, so this can never quietly become a sleep again.
 */
async function appSettled(page: Page, ms = 20_000): Promise<boolean> {
  const ready = await until(
    page,
    async () =>
      (await page.locator(".state-focus-layer").count()) > 0 &&
      Boolean(
        await page.evaluate(
          /*
           * ESCAPE-FREE ON PURPOSE. A backslash class inside an `evaluate`
           * template is this repository's own recorded trap: the escapes
           * survive or are eaten depending on how the file was written, the
           * regex still COMPILES either way, and it silently matches
           * something else. `[0-9]` needs no backslash, so there is nothing
           * to lose in transit.
           */
          `(function () {
            var t = document.body.innerText || "";
            if (t.indexOf("Who governs here") === -1) return false;
            var i = t.indexOf("meetings");
            if (i === -1) return false;
            return /[0-9]/.test(t.slice(Math.max(0, i - 12), i));
          })()`,
        ),
      ),
    ms,
  );
  if (!ready) return false;
  /*
   * NH121's settle, scoped to the shell. Two consecutive identical readings of
   * the rendered text length, 400ms apart, so a check never reads a subtree
   * that is still painting. Bounded separately so a page that keeps animating
   * cannot extend the wait indefinitely.
   */
  await untilSettled(page, "body", 400, 4_000);
  return true;
}

// ── Probe accounting, and the run's own identity (C05) ─────────────────────

/**
 * This run declares itself, at write time, from its own environment.
 *
 * C05 (2026-08-17): every row this walk creates in production's `search_log`
 * is ours, and nothing sold may contain it. The runner cannot mark the row —
 * the route writes it, on Netlify — so the runner says who it is in a header
 * and the route records the declaration. Never a user-agent guess, never a
 * heuristic applied afterwards.
 *
 * `WTP_RUN_ID` from CI when it is set, so a CI run keeps its own identity;
 * otherwise a local id stamped with this run's start. Both are SYNTHETIC.
 */
const RUN_ID =
  process.env.WTP_RUN_ID?.trim() ||
  makeRunId(process.env.CI ? "walk-all-ci" : "walk-all-local", new Date().toISOString());
const RUN_HEADERS = syntheticRunHeaders({ ...process.env, WTP_RUN_ID: RUN_ID });

/**
 * The SHA this walk actually tested.
 *
 * Recorded rather than assumed: a run record that says only "the walk passed"
 * cannot be read later against the release it was supposed to prove, and a
 * check run on an older tree than the deploy is a check about a different
 * product. `pnpm status:ledger` reads this field.
 */
const TESTED_SHA: string | null = (() => {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    /* No git, or a tree that is not a checkout. Named as unknown, never
       invented — a fabricated SHA would misattribute every later reading. */
    return null;
  }
})();

let searchLogRows = 0;
let askRows = 0;

function countProbe(url: string): void {
  if (url.includes("/api/meetings")) searchLogRows += 1;
  if (url.includes("/api/ask") || url.includes("/api/log")) askRows += 1;
}

// ── HTTP helpers (no browser — fast, and most claims are server-rendered) ──

interface Fetched {
  status: number;
  text: string;
}

async function get(path: string): Promise<Fetched> {
  const url = `${BASE}${path}`;
  countProbe(url);
  const response = await fetch(url, {
    headers: {
      "User-Agent": "we-the-people walk:all (regression net)",
      ...RUN_HEADERS,
    },
  });
  return { status: response.status, text: await response.text() };
}

async function getJson<T>(path: string): Promise<T | null> {
  const url = `${BASE}${path}`;
  countProbe(url);
  const response = await fetch(url, {
    headers: { accept: "application/json", ...RUN_HEADERS },
  });
  if (!response.ok) return null;
  return (await response.json()) as T;
}

// ── Browser helpers ────────────────────────────────────────────────────────

/**
 * A page with the zip already resolved, the way a mid-session reader has it.
 *
 * The location is SESSION-scoped (6f, 2026-08-15) and lives in
 * `sessionStorage` under `wtp.approximate_location`, so seeding it is how a
 * walk skips eleven seconds of typing without pretending to be a state the
 * app does not have. The tutorial flag is seeded too: the first-run tour is
 * its own check, not a thing every other check has to dismiss.
 */
async function openAt(browser: GuardedBrowser, zip: string): Promise<Page> {
  const context = await browser.context({
    // C05: the browser declares this run synthetic too. The page's own
    // /api/meetings fetches write search-log rows exactly like the direct
    // probes do, and they are the bulk of what a walk creates.
    extraHTTPHeaders: RUN_HEADERS,
    viewport: PHONE,
    deviceScaleFactor: 2,
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
        localStorage.setItem("wtp.recent_zips", JSON.stringify([zip, "03255"]));
      } catch {
        // Defaults are fine — the walk just types the zip instead.
      }
    },
    { zip },
  );
  const page = await context.newPage();
  page.on("response", (r) => countProbe(r.url()));
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 90_000 });
  /*
   * R49: the app has RENDERED, rather than nine seconds have passed. The
   * seeded zip makes the who-governs card the first surface; the map canvas
   * is the fallback for a zip that renders no card. Neither arriving inside
   * the ceiling leaves the page exactly where the old fixed wait left it, so
   * a genuine failure still fails on the read below rather than here.
   */
  /*
   * **THE RESULT IS READ.** (A.1 WI7.) This was a bare call with the boolean
   * discarded, which is what let a dead condition run to its full 20s ceiling
   * on every page open, for an unknown number of sessions, without anything
   * saying so. A page that never settled is now PRINTED, so the next session
   * inherits the fact rather than the silence.
   */
  if (!(await appSettled(page))) {
    console.log(
      `  ..  ${elapsed()} the app did not report settled at ${zip} within the ceiling — ` +
        "reading anyway, so a genuine absence still fails on the truth below",
    );
  }
  return page;
}

/**
 * A DESKTOP context, for the checks whose subject only exists at that width.
 *
 * The suite runs at phone size by default and that is right for most of it —
 * the tester's own passes were on a phone. But g4 item 14 is a claim about
 * the desktop RAIL, and item 5 is a claim about dragging the middle of a map
 * that a phone's overlays cover. Running those at 390px reported "could not
 * run" four times over, which is honest and useless: the check has to be able
 * to reach its subject before its result means anything.
 */
async function openWideAt(browser: GuardedBrowser, zip: string): Promise<Page> {
  const context = await browser.context({
    // C05: same declaration on the wide viewport.
    extraHTTPHeaders: RUN_HEADERS,
    viewport: { width: 1280, height: 900 },
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
        localStorage.setItem("wtp.recent_zips", JSON.stringify([zip, "03255"]));
      } catch {
        // Defaults are fine — the walk just types the zip instead.
      }
    },
    { zip },
  );
  const page = await context.newPage();
  page.on("response", (r) => countProbe(r.url()));
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 90_000 });
  /*
   * R49: the app has RENDERED, rather than nine seconds have passed. The
   * seeded zip makes the who-governs card the first surface; the map canvas
   * is the fallback for a zip that renders no card. Neither arriving inside
   * the ceiling leaves the page exactly where the old fixed wait left it, so
   * a genuine failure still fails on the read below rather than here.
   */
  /*
   * **THE RESULT IS READ.** (A.1 WI7.) This was a bare call with the boolean
   * discarded, which is what let a dead condition run to its full 20s ceiling
   * on every page open, for an unknown number of sessions, without anything
   * saying so. A page that never settled is now PRINTED, so the next session
   * inherits the fact rather than the silence.
   */
  if (!(await appSettled(page))) {
    console.log(
      `  ..  ${elapsed()} the app did not report settled at ${zip} within the ceiling — ` +
        "reading anyway, so a genuine absence still fails on the truth below",
    );
  }
  return page;
}

async function bodyText(page: Page): Promise<string> {
  return page.locator("body").innerText();
}

const browser = await launchGuarded({ label: "walk-all", blockWrites: LIVE_TARGET });

console.log(`walk:all — ${BASE}\n${new Array(60).fill("─").join("")}`);

// ═══════════════════════════════════════════════════════════════════════════
// A. The doors that must open at all — server-rendered, HTTP only.
// ═══════════════════════════════════════════════════════════════════════════

section("A. Top-level doors (0817, 0818, g3)");

/*
 * PROMPT C ITEM 1c (2026-08-20) — the deploy identifier AND the code SHA.
 *
 * Prompt B's report named two identifiers for one deploy: the merge that
 * produced the code (`3bc8834`) and the commit production was serving
 * (`1268657`). Both are git SHAs, the second contains the first, and the
 * report said neither of those things — so a reader could not tell whether
 * the deploy had landed, lagged, or drifted. `/api/build` already answers it:
 * `commit` is the code SHA the bundle was built from and `deployId` is
 * Netlify's own identifier for the deploy serving the request. Two names for
 * two different facts, and the pair is what makes the answer checkable.
 *
 * This asserts BOTH are real values. `unknown` is what the route returns when
 * the build-time variable was absent, and that has happened before — the
 * route's own header records a stretch of `"commit":"unknown"` caused by
 * assuming Next inlines `process.env` into server code. An endpoint that
 * answers "unknown" is not a broken endpoint, but a session verifying its own
 * ship against one is verifying nothing, and that is what this catches.
 */
{
  const build = await get("/api/build");
  check("promptC", "/api/build answers", build.status === 200, `HTTP ${build.status}`);
  if (build.status === 200) {
    let body: {
      commit?: string;
      commitShort?: string;
      deployId?: string;
      branch?: string;
    } = {};
    try {
      body = JSON.parse(build.text) as typeof body;
    } catch {
      body = {};
    }
    const commit = body.commit ?? "unknown";
    const deployId = body.deployId ?? "unknown";
    /*
     * THESE THREE ARE PRODUCTION-ONLY QUESTIONS, and RULING 125 made every walk
     * local — so they must report CANNOT RUN rather than FAIL.
     *
     * `commit` and `deployId` come from Netlify's build environment. A local
     * `next start` has no such environment and answers "unknown", which is the
     * CORRECT answer for a local build rather than a defect in the endpoint.
     * Left as failures they would report three NAMED REGRESSIONS on every local
     * walk from now on — an alarm that is wrong on every quiet day is an alarm
     * nobody reads (RULING 115), and it would be an alarm this session's own
     * ruling created.
     *
     * The distinction the walk already draws for the sold-store check is the
     * same one: a check that cannot reach its subject is UNKNOWN, never
     * negative (RULING 24). The live SHA is answered by `pnpm deploy:live`,
     * from Netlify's deploy record, with zero requests to the site.
     */
    const localTarget = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/.test(BASE);
    if (localTarget) {
      for (const label of [
        "/api/build states the code SHA",
        "/api/build states the deploy identifier",
        "/api/build's two identifiers are distinct facts, not one repeated",
      ]) {
        cannotRun(
          "promptC",
          label,
          "this run targeted a local build, which has no Netlify build environment — " +
            "ask `pnpm deploy:live` instead, which reads the deploy record with zero site traffic",
        );
      }
    } else {
      check(
        "promptC",
        "/api/build states the code SHA",
        /^[0-9a-f]{40}$/.test(commit),
        `commit=${commit}`,
      );
      check(
        "promptC",
        "/api/build states the deploy identifier",
        deployId !== "unknown" && deployId.length > 0,
        `deployId=${deployId}`,
      );
      check(
        "promptC",
        "/api/build's two identifiers are distinct facts, not one repeated",
        commit !== deployId,
        `commit=${body.commitShort ?? "?"} deployId=${deployId}`,
      );
    }
  }
}


for (const { zip } of FOUR) {
  const area = await get(`/about-area?zip=${zip}`);
  check(
    "0817",
    `/about-area answers at ${zip}`,
    area.status === 200,
    `HTTP ${area.status}`,
  );
  if (area.status === 200) {
    check(
      "0817",
      `/about-area renders its facts at ${zip}`,
      /basics of living here/.test(area.text) && /marijuana/i.test(area.text),
      area.text.includes("haven&#x27;t written this up")
        ? "rendered the no-coverage gap instead of the facts"
        : "",
    );
    check(
      "0817",
      `/about-area cites every answer at ${zip}`,
      /Department|Secretary|Division|Commission/.test(area.text),
    );
  }

  const ballot = await get(`/ballot?zip=${zip}`);
  check("0817", `/ballot answers at ${zip}`, ballot.status === 200, `HTTP ${ballot.status}`);
  if (ballot.status === 200) {
    check("0817", `/ballot renders contests at ${zip}`, /vote for/i.test(ballot.text));
    check(
      "0817",
      `/ballot carries the office explainer at ${zip}`,
      /Powers defined in/.test(ballot.text),
    );

    /*
     * **RULING 59 (2026-08-21) — THE CLAIM THIS CHECK GUARDED IS RETIRED, AND
     * THE CHECK NOW GUARDS ITS ABSENCE.**
     *
     * Prompt B item 7.6 shipped this as "every zip surface states its tier",
     * asserting a `data-coverage-note` attribute was PRESENT. The reasoning
     * was that a thin page with no explanation reads as a quiet town. It was
     * good reasoning and it produced a sentence that could not stay true.
     *
     * NH Hunt 4's first merge began rendering Lake Todd Village District's
     * meetings while the coverage note on the same page still counted Lake
     * Todd among eighteen districts "we have not worked out". The note was a
     * claim about data that changes underneath it; nothing automated could
     * tell a correct render from a stale note about that render, and this
     * check was green throughout.
     *
     * The claim was retired — the page says one thing about
     * completeness, COLLECTION_NOTE, and nothing else. The walk rule says a
     * check leaves this suite only when the author retires the claim behind
     * it, and that has now happened; so rather than deleting the check and
     * losing a slot, it inverts. What it asserts is that the coverage note
     * has not come back, which is how RULING 42's per-card marker is guarded
     * one section below, and for the same reason: a deleted reader surface
     * comes back the way it went out, as somebody reinstating a component
     * that used to be mandated.
     */
    check(
      "promptB",
      `/ballot renders no coverage note at ${zip} (RULING 59)`,
      !/data-coverage-note=/.test(ballot.text),
      "the coverage note is rendering again — RULING 59 deleted it, because a " +
        "sentence counting what has not been worked out goes false the moment " +
        "the work is done and no test can see it",
    );

    /*
     * **RULING 42 (Prompt E item 3, 2026-08-20) — THE DISCLOSURE MOVED FROM
     * THE CARD TO THE PAGE, AND BOTH HALVES OF THAT ARE ASSERTED.**
     *
     * Two checks, because the ruling has two halves and either can come undone
     * on its own. The first: the page-level disclosure is PRESENT — a
     * disclosure that quietly stops rendering leaves a page of uneven cards
     * with nothing saying why, which is the coverage-honesty exception the
     * reader-friction rule protects. The second: the per-card marker has NOT
     * come back — a card-level completeness label is a badge on the
     * least-resourced person in a race, and it comes back the way it went in,
     * as somebody reinstating a constant this file's law used to mandate.
     *
     * `tests/no-suppression.test.ts` catches a reintroduction at the BUILD.
     * This catches it on the DEPLOY, which is where both previous display
     * defects were actually found — by the author opening the site.
     *
     * The attribute is checked rather than the prose for the first, because
     * the prose is meant to be rewritable; the SENTENCE is checked for the
     * second, because that exact sentence is the thing that must never render.
     */
    check(
      "promptE",
      `/ballot carries the page-level collection disclosure at ${zip}`,
      /data-collection-note/.test(ballot.text) ||
        !/vote for/i.test(ballot.text),
      "the page renders candidate contests and says nothing about what a " +
        "short card means — RULING 42's disclosure is missing",
    );
    check(
      "promptE",
      `/ballot carries no per-card completeness marker at ${zip}`,
      !/haven't found much about this candidate/i.test(ballot.text),
      "a per-card completeness marker is back on the ballot — RULING 42 " +
        "deleted it, and it lands on exactly the least-resourced candidate",
    );

    /*
     * **RULING 26 (Prompt D item 1, 2026-08-20) RETIRED PROMPT B ITEM 7.5 AND
     * THIS CHECK WITH IT.**
     *
     * The claim behind it was that a contest withholding its candidate cards
     * must say why. There is no longer any circumstance in which a contest
     * withholds its cards: everything the product holds about a candidate
     * renders, and collection state never governs display. A check leaves this
     * suite only when the author retires the claim behind it, and that is what
     * happened here, recorded in `docs/rulings.md`. Its
     * replacement is `tests/no-suppression.test.ts`, which fails the BUILD if
     * a suppression path is reintroduced, rather than catching it in
     * production after a reader has already met a blank contest.
     */
    /*
     * **F01 11.2 (2026-08-19) RETIRED 0814c's claim and this check with it.**
     *
     * 0814c required the ballot page to carry the device-only sentence. In the
     * shipped result it read as contradicting itself, so it was removed and a
     * "How we handle data" link at the bottom carries the explanation instead.
     *
     * The identity changes with the claim, deliberately: a check whose subject
     * was retired must not keep answering under the old name, and the
     * suite's own diff will report `0814c … device-only sentence` as GONE with
     * this one added, which is the honest record of what happened.
     *
     * Both underlying facts are still true and the check still proves the
     * reader can reach them — the link is what carries the explanation now,
     * and the transparency page it points at is asserted below by its own
     * long-standing checks.
     */
    check(
      "F01",
      `/ballot links the data-handling page instead of the retired sentence at ${zip}`,
      /How we handle data/.test(ballot.text) &&
        !/saved on this device only/i.test(ballot.text),
      /saved on this device only/i.test(ballot.text)
        ? "the retired sentence is back on the page"
        : "link present, sentence gone",
    );
    check(
      "0817",
      `/ballot links "Moving here?" at ${zip}`,
      /Moving here\?/.test(ballot.text),
    );
    // g3 item 7 superseded 3d's shared label. The two asks on this page are
    // differently consequential — one is a private note, one joins an
    // anonymous aggregate that is sold — and they must not read alike.
    check(
      "g3",
      `/ballot names the pick as a ballot-building action at ${zip}`,
      /Your pick for this race/.test(ballot.text),
    );
    check(
      "g3",
      `/ballot's picks disclosure quotes wording that is on the page at ${zip}`,
      !/&ldquo;What do you think\?&rdquo; picks/.test(ballot.text),
    );
    /*
     * RULING 7C (g17): the fifth provision kind reaches the reader, and the
     * widened SUNSET label does not. Kinds are the reaction bucketing, so a
     * page still reading "When it starts and ends" would be collecting two
     * different questions into one bucket in front of a reader.
     *
     * Arizona only: 07866 and 03255 carry no decomposed measure, so the
     * absence of the label there is correct rather than a regression, and a
     * check that fired at every zip would be reporting one.
     */
    if (zip.startsWith("85")) {
      check(
        "g17",
        `/ballot renders the fifth provision kind at ${zip}`,
        /When it starts</.test(ballot.text),
      );
      check(
        "g17",
        `/ballot no longer renders the widened SUNSET label at ${zip}`,
        !/When it starts and ends/.test(ballot.text),
      );
    }
  }
}

const transparency = await get("/transparency");
check("0815e", "/transparency answers", transparency.status === 200, `HTTP ${transparency.status}`);
check(
  "0815e",
  "/transparency states the photo rule's FOUR doors",
  /four doors|door 4|last resort/i.test(transparency.text),
);
check(
  "0815e",
  "/transparency discloses the classifier and keeps the no-generation guarantee",
  /classif/i.test(transparency.text),
);

// ═══════════════════════════════════════════════════════════════════════════
// B. The data the reader's answers are made of — API level.
// ═══════════════════════════════════════════════════════════════════════════

section("B. The data behind the answers (0815c, 0815g, f, 0816)");

interface MeetingsPayload {
  meetings: Array<{
    id: string;
    bodyName: string;
    ocdId: string | null;
    status: string;
    location: { name: string };
    /** hotfix-0817: present exactly when the last refresh could not reach this row. */
    carried?: { source: string; lastFreshAt: string };
  }>;
  tier: string;
  coverage: { bodies: Array<{ name: string | null; ocdId: string | null }> } | null;
  snapshot: {
    generatedAt: string;
    failed: Array<{ source: string }>;
    /** hotfix-0817: the rows this snapshot holds that its own run never retrieved. */
    carried?: { count: number; lastFreshAt: string | null };
  } | null;
}

/**
 * The meeting counts that prior sessions SHIPPED, per zip.
 *
 * These are floors, not equalities: a real refresh adds sittings and a passing
 * calendar year removes them, so an equality would fail for a reason that is
 * the product working. A floor catches the thing that actually happens — a
 * source going dark and a previously-full calendar emptying.
 */
/**
 * **A floor counted over a moving window drifts by construction** — and the
 * fix is to stop writing an integer down (F01-continued item 3.1, 2026-08-19).
 *
 * The f session verified fifteen Kearsarge sittings and wrote `15`. On
 * 2026-08-19 the walk reported 14 and called it a regression. The snapshot
 * still held all fifteen; the oldest row (2026-05-21) had reached the
 * ninety-day back edge of the SERVING WINDOW and stopped being served. F01
 * diagnosed that correctly and then wrote `14` — which is the same defect
 * one day later, and it would have gone red again on 2026-09-02 when
 * 2026-06-04 aged out, and again, and again.
 *
 * So the expectation is COMPUTED, from the snapshot the deploy is serving and
 * the server's own window constants, every run:
 *
 *   SCHEDULED rows in [now, now + UPCOMING_HORIZON_DAYS]
 *   + CONCLUDED/CANCELED rows in [now - CONCLUDED_LOOKBACK_DAYS, now + horizon]
 *
 * mirrored from `lib/meetings/query.ts`. The check then fails for exactly one
 * reason: a row the snapshot holds and the window admits did not reach the
 * reader. Ageing out is no longer a failure because it is no longer a
 * surprise — it is in the expectation.
 *
 * **The staleness guard is the other half.** This reads the snapshot on disk
 * while the check reads the deploy, and the refresh cron commits a new
 * snapshot to `main` every six hours. If the two `generatedAt` stamps differ,
 * the walk has no idea what the deploy is serving — so it reports COULD NOT
 * RUN with the two stamps named, never a red. An unreachable comparison is
 * not a missing feature.
 */
const LOCAL_SNAPSHOT: {
  generatedAt?: string;
  meetings?: Array<{ id: string; bodyName: string; startsAt: string; status: string }>;
} = existsSync(join(process.cwd(), "data", "meetings-snapshot.json"))
  ? JSON.parse(readFileSync(join(process.cwd(), "data", "meetings-snapshot.json"), "utf8"))
  : {};

/** What the serving window admits for one body, from the snapshot on disk. */
function servedExpectation(match: RegExp, now: number): number {
  const horizonMs = UPCOMING_HORIZON_DAYS * 86_400_000;
  const lookbackMs = CONCLUDED_LOOKBACK_DAYS * 86_400_000;
  let n = 0;
  for (const m of LOCAL_SNAPSHOT.meetings ?? []) {
    if (!match.test(m.id)) continue;
    const t = Date.parse(m.startsAt);
    if (!Number.isFinite(t)) continue;
    if (m.status === "SCHEDULED") {
      if (t >= now && t <= now + horizonMs) n += 1;
    } else if (m.status === "CONCLUDED" || m.status === "CANCELED") {
      if (t >= now - lookbackMs && t < now + horizonMs) n += 1;
    }
  }
  return n;
}

const MEETING_FLOORS: Array<{
  session: string;
  zip: string;
  lat: number;
  lng: number;
  total: number;
  bodies: number;
  named: Array<{ session: string; match: RegExp; least: number; label: string }>;
}> = [
  {
    session: "0815c",
    ...ZIPS.newbury,
    total: 26,
    bodies: 4,
    named: [
      {
        /*
         * **The number is no longer written down** (F01-continued item 3.1,
         * 2026-08-19). See `servedExpectation` above for why.
         *
         * History, kept because it is the argument: the f session verified
         * fifteen Kearsarge sittings and wrote `15`. On 2026-08-19 the walk
         * reported 14 of 68 and named a regression. There was none — the
         * snapshot held all fifteen and the sitting of 2026-05-21 had reached
         * the ninety-day back edge of the serving window. F01 diagnosed that
         * and wrote `14`, which is the same bug with a fresher number: it
         * would have gone red again on 2026-09-02, and again in October.
         *
         * `least` is now the DURABLE half of the claim — Kearsarge's sittings
         * are on the board, plural — and the precise half is computed against
         * the window every run. Together they are strictly stronger than the
         * old fifteen: `least` catches the rows vanishing from the data, and
         * the computed expectation catches any row the window admits failing
         * to reach the reader.
         */
        session: "f",
        match: /kearsarge/i,
        least: 2,
        label: "Kearsarge Regional School District's sittings",
      },
      {
        session: "0815f",
        match: /zoning-board/i,
        least: 1,
        label: "Newbury's Zoning Board of Adjustment",
      },
    ],
  },
  {
    session: "0815c",
    ...ZIPS.rockaway,
    total: 20,
    bodies: 3,
    named: [
      {
        session: "0815c",
        match: /morris-hills|mhrd/i,
        least: 1,
        label: "Morris Hills Regional's board",
      },
    ],
  },
  { session: "0818", ...ZIPS.tucson, total: 30, bodies: 4, named: [] },
  { session: "0818", ...ZIPS.vail, total: 3, bodies: 1, named: [] },
];

for (const floor of MEETING_FLOORS) {
  const payload = await getJson<MeetingsPayload>(
    `/api/meetings?lat=${floor.lat}&lng=${floor.lng}&zip=${floor.zip}`,
  );
  if (!payload) {
    cannotRun("0815c", `meetings at ${floor.zip}`, "/api/meetings did not answer");
    continue;
  }
  const bodies = new Set(payload.meetings.map((m) => m.bodyName));
  check(
    floor.session,
    `${floor.zip}: the meeting count holds`,
    payload.meetings.length >= floor.total,
    `${payload.meetings.length} meetings, floor ${floor.total} — bodies: ${[...bodies].join(", ") || "none"}`,
  );
  check(
    floor.session,
    `${floor.zip}: the number of bodies with sittings holds`,
    bodies.size >= floor.bodies,
    `${bodies.size} of ${floor.bodies}`,
  );
  for (const named of floor.named) {
    const hits = payload.meetings.filter((m) => named.match.test(m.id));
    // F01-continued item 3.1. `least` is now a FLOOR ON THE CLAIM ("plural and
    // specific"), not a transcription of one day's window. The window-derived
    // expectation is the number that actually decides the check.
    const servedStamp = payload.snapshot?.generatedAt ?? null;
    const localStamp = LOCAL_SNAPSHOT.generatedAt ?? null;
    if (!servedStamp || !localStamp || servedStamp !== localStamp) {
      cannotRun(
        named.session,
        `${floor.zip}: ${named.label} against the window`,
        `the deploy's snapshot (${servedStamp ?? "unstated"}) is not the one on disk ` +
          `(${localStamp ?? "unstated"}) — nothing here can be compared`,
      );
      check(
        named.session,
        `${floor.zip}: ${named.label}`,
        hits.length >= named.least,
        `${hits.length} row(s) of ${payload.meetings.length}, claim floor ${named.least}`,
      );
      continue;
    }
    const expected = servedExpectation(named.match, Date.now());
    check(
      named.session,
      `${floor.zip}: ${named.label}`,
      hits.length >= Math.max(named.least, expected),
      `${hits.length} row(s) of ${payload.meetings.length}; the window admits ${expected} ` +
        `of the snapshot's rows, claim floor ${named.least}`,
    );
  }

  // The refresh corollary (g3): a source failing must never EMPTY a surface
  // that was full. A failed source is allowed — it is reported honestly — but
  // the bodies it serves must still be carrying their last known sittings.
  const failed = payload.snapshot?.failed ?? [];
  if (failed.length > 0) {
    console.log(
      `      (snapshot reports ${failed.length} failed source(s): ${failed
        .map((f) => f.source)
        .join(", ")} — the counts above are what the reader actually gets)`,
    );
  }
}

interface VotesPayload {
  keyVotes?: unknown[];
  votes?: unknown[];
}
// `member` is REQUIRED — the route answers 400 without it. The first version
// of this check called `/api/votes` bare, read the error body's absent
// `keyVotes`, and reported the key-votes surface as gone. That is a walk
// missing its aim, not a regression, and it is exactly the confusion
// `cannotRun` exists to prevent; the fix is the parameter, not a softer floor.
const votes = await getJson<VotesPayload>("/api/votes?member=congress:K000377");
if (!votes) {
  cannotRun("0816", "the key-votes surface", "/api/votes did not answer for a known member");
} else {
  check(
    "0816",
    "the key-votes surface still has its votes",
    Array.isArray(votes.keyVotes) && votes.keyVotes.length >= 36,
    `${votes.keyVotes?.length ?? "no"} keyVotes`,
  );
  check(
    "0815c",
    "a senator's roll-call record still resolves",
    Array.isArray(votes.votes) && votes.votes.length >= 20,
    `${votes.votes?.length ?? "no"} votes`,
  );
}

// D40 — three officials must render three DIFFERENT campaigns' books. The
// production bug was one campaign's filings served for all three, and the
// cache key was the cause; distinct keys must still produce distinct results.
interface FundingPayload {
  kind?: string;
  data?: { fecCandidateId?: string; name?: string; totals?: { receipts?: number } };
}
// The target is the app-side id — `congress:<bioguide>` for a federal member
// (`FundingCandidate.targetKeys`). Three real, different people; the D40 bug
// served ONE campaign's books for all three, so the assertion is that the
// three answers name three different FEC candidate ids.
const FUNDING_TARGETS = [
  "congress:K000377", // Mark Kelly
  "congress:G000574", // Ruben Gallego
  "congress:G000606", // Adelita Grijalva
];
const books: Array<{ target: string; id: string; name: string }> = [];
for (const target of FUNDING_TARGETS) {
  const payload = await getJson<FundingPayload>(
    `/api/funding/${encodeURIComponent(target)}`,
  );
  if (!payload) {
    cannotRun("0819", `funding for ${target}`, "/api/funding did not answer");
    continue;
  }
  books.push({
    target,
    id: payload.data?.fecCandidateId ?? "none",
    name: payload.data?.name ?? "none",
  });
}
if (books.length >= 2) {
  const ids = new Set(books.map((b) => b.id));
  check(
    "0819",
    "D40: distinct officials render distinct campaign books",
    ids.size === books.length && !ids.has("none"),
    books.map((b) => `${b.target}→${b.id} (${b.name})`).join(" · "),
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// C. The map surfaces — a real browser, phone width, as a stranger.
// ═══════════════════════════════════════════════════════════════════════════

section("C. The map, who-governs, and the footnotes (0814c, 0815, e, g3)");

for (const { zip } of FOUR) {
  const page = await openAt(browser, zip);
  /*
   * **THE WHO-GOVERNS CARD IS OPENED RATHER THAN ASSUMED (WGH-8, 2026-08-25).**
   *
   * Every check in this section reads `document.body.innerText` and asserts
   * something the CARD says — the governor, the Local/State/Federal grouping,
   * Kearsarge Regional, Newbury's no-mayor fact. All of them worked because
   * arriving at a zip auto-expanded the card.
   *
   * The rule is now that exactly one of the rail and the card is up,
   * and `08-53-15` specifies that arrival gets the rail with Who Governs
   * Here beneath it as a pill. So the card has to be REACHED, and the walk
   * reaches it the way a reader does: by clicking the pill.
   *
   * Not a weakening of any check. Every assertion below is unchanged and still
   * fails if the card stops saying what it says — what changed is that the
   * walk now performs the click that used to happen by itself.
   */
  const wghPill = page.locator(".notice-fab").first();
  if (await wghPill.isVisible().catch(() => false)) {
    await wghPill.click();
    await until(page, async () => (await page.locator(".coverage-notice").count()) > 0, 8_000);
  }
  const text = await bodyText(page);

  check("0814c", `${zip}: the map answers with something about this place`, text.length > 200);

  /*
   * **`VF02` — a broken basemap was invisible to every instrument.**
   * (NJ Hunt 6, 2026-08-22.)
   *
   * NJ Hunt 5's captures showed *Basemap unavailable* on production while 371
   * walk checks and every DOM assertion were content. The cause was that
   * `tilesFailed` had no way back to false: one transient tile or glyph error
   * latched the notice for the rest of the session, over a map that was
   * drawing perfectly by the time anything looked at it.
   *
   * This is the instrument that would have caught it, and it deliberately
   * checks the RENDERED NOTICE rather than the tile requests. Whether a
   * request failed is our business; whether the reader is being TOLD the map
   * is broken is theirs, and that is the claim on screen.
   */
  const basemapNotice = await page.evaluate(
    () => document.body.innerText.includes("Basemap unavailable"),
  );
  check(
    "njhunt6",
    `${zip}: the reader is not told the basemap is unavailable`,
    !basemapNotice,
    basemapNotice ? "the notice is on screen — VF02 has regressed" : "",
  );

  /*
   * And the other half, because the notice being absent is not the same as the
   * map drawing. A basemap that silently fails to the plain ground colour shows
   * no notice at all — which is the render-default rule pointed at a map.
   */
  /*
   * The map mounts in an effect and its style arrives over the network, so the
   * handle is not there the moment the who-governs card is. Waiting for it is
   * the difference between a check that runs and a check that reports CANNOT
   * RUN at three zips out of four — honest, and useless.
   */
  await page
    .waitForFunction(
      () =>
        ((window as unknown as { __wtpMap?: { getStyle?: () => { layers?: unknown[] } } }).__wtpMap
          ?.getStyle?.()
          ?.layers?.length ?? 0) > 0,
      undefined,
      { timeout: 25_000 },
    )
    .catch(() => undefined);
  const styleLayers = await page.evaluate(() => {
    const w = window as unknown as { __wtpMap?: { getStyle?: () => { layers?: unknown[] } } };
    return w.__wtpMap?.getStyle?.()?.layers?.length ?? -1;
  });
  if (styleLayers < 0) {
    cannotRun(
      "njhunt6",
      `${zip}: the basemap style has real layers`,
      "the page exposes no map handle to read a layer count from — a check that CANNOT RUN, " +
        "reported apart from one that failed (RULING 24)",
    );
  } else {
    check(
      "njhunt6",
      `${zip}: the basemap style has real layers`,
      styleLayers > 1,
      `${styleLayers} layer(s); the plain-ground fallback has 1`,
    );
  }

  // M60 — the mojibake sweep. It has recurred often enough to be permanent.
  //
  // The pattern comes from `lib/text/mojibake.ts` rather than being written
  // here. Two reasons, and the second is the one that matters: it is the
  // detector the repo already tests against real production sequences, and a
  // hand-rolled copy would have to spell the byte sequences out — which trips
  // `tests/mojibake.test.ts`, whose whole job is to find those bytes in
  // committed text. The first draft of this walk did exactly that and failed
  // the suite for detecting itself.
  const mojibake = text.match(mojibakePattern()) ?? [];
  check("0815", `${zip}: no mojibake in the rendered text`, mojibake.length === 0, mojibake.slice(0, 4).join(" "));

  // M48/2c — the three tiers, and FEDERAL is the label.
  check(
    "0814c",
    `${zip}: who-governs is grouped Local / State / Federal`,
    /Local/.test(text) && /State/.test(text) && /Federal/.test(text),
  );
  check("0814c", `${zip}: "Federal" is the label, never "National"`, !/\bNational\b/.test(text));

  // B11 — the governor is a first-class attachment on who-governs.
  check("0814c", `${zip}: the state's governor is on who-governs`, /Governor/.test(text));

  // M57 — the sidebar counters, and DISTRICTS never spends the dash on a switch.
  check("0815", `${zip}: no counter renders the couldn't-check dash`, !/\bOFFICIALS\s*—\b/.test(text));

  // g3 item 4 (M94) — each distinct footnote once per body, identical
  // footnotes across bodies collapsed to once per panel with the bodies named.
  const notices = await page.evaluate(() => {
    const out: string[] = [];
    for (const p of document.querySelectorAll(".coverage-notice p")) {
      const t = (p.textContent ?? "").replace(/\s+/g, " ").trim();
      if (t) out.push(t);
    }
    return out;
  });
  const normalized = notices.map((n) =>
    n.replace(/^[^—]*—\s*/, "").replace(/\s+/g, " ").trim(),
  );
  const repeated = normalized.filter(
    (n, i) => n.length > 30 && normalized.indexOf(n) !== i,
  );
  check(
    "g3",
    `${zip}: no footnote repeats in the who-governs panel`,
    repeated.length === 0,
    repeated.length ? `${repeated.length} repeat(s): "${repeated[0].slice(0, 64)}…"` : "",
  );

  /*
   * ITEM 1a (g6, 2026-08-17) — ONE DENOMINATOR, asserted in the DOM.
   *
   * Production at 85701 read "4 bodies govern the area around 85701" above a
   * disclosure reading "Why these 5?" above 5 rows. Three numbers, one list,
   * on the surface whose entire job is telling a stranger who governs them.
   *
   * All three are parsed out of the rendered page — the prose number, the
   * disclosure link's number, and the actual `<li>` count — and asserted
   * equal. Parsing the rendered thing is the point: the two definitions each
   * looked right in isolation, and only the screen showed them disagreeing.
   */
  const denominators = await page.evaluate(`(() => {
    const card = document.querySelector(".coverage-notice");
    if (!card) return { reason: "no who-governs card" };

    const flat = (card.textContent || "").replace(/\\s+/g, " ");
    // "N bodies govern the area around 85701" / "One body governs the area"
    // / "We track the calendars of M of the N bodies that govern the area".
    let prose = null;
    const ofThe = flat.match(/of the (\\d+) bodies that govern the area/);
    const govern = flat.match(/(\\d+) bodies govern the area/);
    const one = /One body governs the area/.test(flat);
    if (ofThe) prose = Number(ofThe[1]);
    else if (govern) prose = Number(govern[1]);
    else if (one) prose = 1;

    // The disclosure link: "Why these N?"
    let link = null;
    for (const s of card.querySelectorAll("summary")) {
      const m = (s.textContent || "").match(/Why these (\\d+)\\?/);
      if (m) link = Number(m[1]);
    }

    // The rendered rows, off an explicit hook rather than a Tailwind class —
    // a class is a styling decision, and the next design pass would have
    // disarmed this guard without anyone noticing.
    const rows = card.querySelectorAll("li[data-governing-row]").length;
    return { prose, link, rows, sample: flat.slice(0, 160) };
  })()`) as { reason?: string; prose?: number | null; link?: number | null; rows?: number | null; sample?: string };

  if (denominators.reason) {
    cannotRun("g6", `${zip}: who-governs states one number for one list`, denominators.reason);
  } else {
    const { prose, link, rows } = denominators;
    const all = [prose, link, rows];
    if (all.some((n) => n === null || n === undefined)) {
      cannotRun(
        "g6",
        `${zip}: who-governs states one number for one list`,
        `could not parse all three: prose=${prose} link=${link} rows=${rows} — "${denominators.sample}"`,
      );
    } else {
      check(
        "g6",
        `${zip}: who-governs states one number for one list`,
        prose === link && link === rows,
        `prose ${prose}, disclosure link ${link}, rendered rows ${rows}`,
      );
    }
  }

  // A09/A10 — the ask box is on the card, and its beat never claims thought.
  check("0819", `${zip}: the ask box is on the who-governs card`, /ask/i.test(text));
  check(
    "0814b",
    `${zip}: no deliberation label anywhere on the map`,
    !/\b(Thinking|Pondering|Analyzing|Reasoning)\b/.test(text),
  );

  // M53 — one state's facts never bleed into another's.
  //
  // Scoped to the CARD, not the document. The welcome overlay's shortcut
  // buttons name every covered place ("Tucson, AZ") and stay in the DOM after
  // the zip resolves, so a document-wide regex reports Arizona contamination
  // on a clean New Hampshire card. The claim M53 shipped is about the answer,
  // and the answer is the card.
  if (zip === "03255") {
    const cardText = await page
      .locator(".coverage-notice")
      .innerText()
      .catch(() => "");
    check(
      "0814e",
      "03255: zero Arizona references on the New Hampshire card",
      cardText.length > 0 && !/Arizona|Tucson|Pima/i.test(cardText),
      cardText.length === 0
        ? "the who-governs card did not render"
        : (cardText.match(/Arizona|Tucson|Pima/i) ?? []).join(" "),
    );
    check("0814c", "03255: Kearsarge Regional is named on who-governs", /Kearsarge/.test(text));
    check(
      "0818",
      "03255: Newbury's no-mayor fact renders",
      /isn.t a city — it has no mayor|no mayor/.test(text),
    );
  }
  if (zip === "07866") {
    // The mayor-reachability pair moved OUT of this shared page loop — see
    // section I. It needs a page nobody else has touched.
    check("0819", "07866: no shouting surnames", !/\bROACH\b/.test(text));
  }

  /*
   * g3 item 6 — more viewport must never mean fewer pins.
   *
   * The zoom-out goes through `__wtpZoomOut`, which issues the camera move
   * WITH an `originalEvent` so it takes the same settle path a reader's
   * gesture does. Playwright's own `mouse.wheel` was tried first and does not
   * work here: at 390 wide the who-governs card covers the middle of the
   * viewport, the wheel lands on the card, and the map never moves.
   *
   * **The zoom is asserted before the pin counts are.** The first version of
   * this check printed a cheerful "11 → 11 → 11" while the map had not moved
   * an inch — a green check for an experiment that never ran, which is worse
   * than a red one, and the same shape as the empty-success failures this
   * repo keeps finding. A flat count only means something once the camera is
   * known to have changed.
   */
  const zooms: number[] = [];
  const counts: number[] = [];
  /** R47: the lowest pin count held at any instant during each settle. */
  const floors: number[] = [];
  for (let step = 0; step < 3; step++) {
    const state = await page.evaluate(() => {
      const w = window as unknown as {
        __wtpPinCount?: () => number;
        __wtpZoom?: () => number;
      };
      return {
        pins: typeof w.__wtpPinCount === "function" ? w.__wtpPinCount() : -1,
        zoom: typeof w.__wtpZoom === "function" ? w.__wtpZoom() : Number.NaN,
      };
    });
    counts.push(state.pins);
    zooms.push(state.zoom);
    if (step < 2) {
      await page.evaluate(() =>
        (window as unknown as { __wtpZoomOut?: (by?: number) => void }).__wtpZoomOut?.(2),
      );
      /*
       * R47 (g14) — SAMPLED THROUGH THE SETTLE, not once at the end of it.
       *
       * This wait used to be a blind `waitForTimeout`. That is what made the
       * pin wipe look like a race: the map emptied for 200–500 ms while its
       * next answer was in flight, and a single sample after a fixed wait
       * landed inside that window on some runs and not others. The suite
       * reported the same build red and then green minutes apart, and the
       * row it opened called it intermittent. It was not — the DEFECT was
       * deterministic and the INSTRUMENT was intermittent.
       *
       * So the wait is now forty samples instead of one, and the floor it
       * records is the lowest pin count the map held at any instant between
       * this zoom and the next. That is what makes a single green run
       * sufficient for this class: the check no longer has to be lucky about
       * when it looks, because it looks the whole time. `pnpm probe:r47`
       * carries the same instrument at higher resolution for diagnosis.
       */
      let floor = Number.POSITIVE_INFINITY;
      const until = Date.now() + 4000;
      while (Date.now() < until) {
        const pins = await page.evaluate(() => {
          const w = window as unknown as { __wtpPinCount?: () => number };
          return typeof w.__wtpPinCount === "function" ? w.__wtpPinCount() : -1;
        });
        if (pins >= 0 && pins < floor) floor = pins;
        // R49 SAMPLING INTERVAL: this loop is the fix R49 was opened for. It
        // samples CONTINUOUSLY for the lowest pin count rather than reading
        // once after a duration - the read that turned a 200-500ms dip into
        // "reproduced 1 of 2 runs, a race" when it was 4 of 4.
        await page.waitForTimeout(100);
      }
      floors.push(Number.isFinite(floor) ? floor : -1);
    }
  }

  /*
   * g3 item 10 (M91) — the state rises out of the map, at every zoom.
   *
   * Measured at the LAST zoom step, which is the far end of the test: zoomed
   * ALL THE WAY OUT, Arizona still reads raised and everything else still
   * reads muted and slightly blurred. A check that only looked at
   * neighbourhood scale would pass on a treatment that vanishes when the
   * state's border comes into view, which is the case that matters.
   */
  const focus = await page.evaluate(() => {
    const scrim = document.querySelector(".state-focus-scrim");
    const clip = document.querySelector(".state-focus-art clipPath path");
    return {
      scrim: Boolean(scrim),
      filter: scrim ? getComputedStyle(scrim).backdropFilter : "none",
      // The clip has to hold the map rect AND the state's rings; a rect
      // alone would mute everything, state included.
      subpaths: (clip?.getAttribute("d") ?? "").split("M").length - 1,
    };
  });
  check(
    "g3",
    `${zip}: the state focus holds when zoomed out`,
    focus.scrim &&
      /blur\(/.test(focus.filter) &&
      /saturate\(/.test(focus.filter) &&
      focus.subpaths >= 2,
    `scrim ${focus.scrim ? "present" : "MISSING"}, filter "${focus.filter}", ${focus.subpaths} clip subpath(s)`,
  );

  const zoomed =
    zooms.every((z) => Number.isFinite(z)) && zooms[2] < zooms[0] - 1;
  if (!zoomed) {
    cannotRun(
      "g3",
      `${zip}: pin monotonicity`,
      `the map did not zoom out (zooms ${zooms.join(" → ")}) — the check never ran`,
    );
  } else if (counts.some((c) => c < 0)) {
    cannotRun("g3", `${zip}: pin monotonicity`, "the map exposes no pin-count probe");
  } else {
    check(
      "g3",
      `${zip}: zooming out never removes pins`,
      counts[1] >= counts[0] && counts[2] >= counts[1],
      `pins ${counts.join(" → ")} across zooms ${zooms.map((z) => z.toFixed(1)).join(" → ")}`,
    );

    /*
     * R47 (g14) — and never empties on the way there either.
     *
     * g3's check above compares the SETTLED counts at each zoom tier, so a
     * map that drops every pin and puts them all back between two samples
     * passes it while a reader watching sees the map blank. This asserts the
     * floor instead: the lowest count held at ANY instant across the settle,
     * at every zoom tier the walk reaches.
     *
     * A zero floor is the defect whether the pins come back or not. That is
     * CLAUDE.md's refresh corollary applied to the render — a retrieval in
     * flight may not be shown as an absence — and it is why this is its own
     * check rather than a tightening of g3's: they are two different claims,
     * and folding them together would let one hide behind the other.
     */
    if (floors.some((f) => f < 0)) {
      cannotRun("g14", `${zip}: pin floor`, "the map exposes no pin-count probe mid-settle");
    } else {
      check(
        "g14",
        `${zip}: the map never empties while a wider view loads`,
        floors.every((f) => f > 0),
        `floor ${floors.join(" → ")} across the settles (40 samples each, 100ms apart) — ` +
          "sampled throughout rather than once, so a single green run is sufficient here",
      );
    }
  }

  await page.context().close();
}

// ═══════════════════════════════════════════════════════════════════════════
// D. The ballot page — picks, names, the scale.
// ═══════════════════════════════════════════════════════════════════════════

section("D. The ballot page (0814c, D53, g3)");

{
  const context = await browser.context({
    // C05: this run is ours, declared at write time.
    extraHTTPHeaders: RUN_HEADERS,
    viewport: PHONE,
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  page.on("response", (r) => countProbe(r.url()));
  await page.goto(`${BASE}/ballot?zip=85701`, {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });
  /*
   * R49 gave this a real gate instead of a 3.5s sleep; R52 (g18) gave it the
   * RIGHT one. `untilPresent(page, "[data-pick], .ballot-measure, main")` is
   * satisfied by server markup — all three of those are in the HTML before a
   * line of JavaScript runs — so it let a click land on a rendered, dead
   * button once in thirty. The gate now waits on the ELEMENT THE CHECK ACTUALLY
   * CLICKS, and waits for it to be hydrated rather than merely present.
   */
  await untilInteractive(page, PICK_CHOICE, 12_000);

  // M49/M50 — a pick renders the reader's running ballot.
  //
  // The selector is the pick BOX's own choices (`data-kind="pick"`), which is
  // what distinguishes the ballot-builder from the reaction sensor sharing
  // the same `.reaction-box` styling. An earlier draft looked for a
  // `[data-pick-choice]` attribute this walk had invented and the product
  // never had, and reported the round trip as un-runnable at every zip.
  const pickButtons = page.locator(PICK_CHOICE);
  const pickCount = await pickButtons.count();
  if (pickCount === 0) {
    cannotRun(
      "0814c",
      "85701: your-picks round trip",
      "no pick control on the page",
    );
  } else {
    /*
     * R52 (g17): THIS CHECK FAILED ONCE IN THREE PRODUCTION RUNS, on identical
     * code against an identical deploy, and the retry below is a DIAGNOSIS
     * rather than a way to make it green.
     *
     * The readiness gate above waits for `[data-pick], .ballot-measure, main`
     * to be PRESENT. Presence is server-rendered markup; it is not a React
     * handler being attached. A click that lands between those two moments
     * does nothing at all, and the surface it should raise never appears —
     * which reads exactly like a broken feature. That is R49's own defect one
     * layer over: the wait before the ACTION was on the wrong outcome.
     *
     * So the click is retried once, and WHICH ATTEMPT WORKED IS THE EVIDENCE.
     * A first-attempt miss is recorded in the check's evidence even when the
     * check passes, because a walk that silently retried until it was happy
     * would be hiding a real hydration delay a reader also waits through. Two
     * misses is a genuine regression and still fails.
     */
    await pickButtons.first().click();
    // R49: wait for the surface this check is about, and read anyway at the
    // ceiling so a real absence still fails.
    let raised = await untilText(page, /my picks/i, 10_000);
    let attempts = 1;
    if (!raised) {
      await pickButtons.first().click();
      raised = await untilText(page, /my picks/i, 10_000);
      attempts = 2;
    }
    const after = await bodyText(page);
    const present = /my picks/i.test(after);
    check(
      "0814c",
      "85701: a pick raises the reader's running ballot",
      present,
      present
        ? attempts === 1
          ? ""
          : "R52: the FIRST click raised nothing and the second did — the button was " +
            "almost certainly not hydrated yet. Passing, and saying so."
        : "no My picks surface after two picks, 10s apart — this is the feature, not the timing",
    );
    await pickButtons.first().click();
    // R49: the pick is undone, rather than 400ms have passed. Nothing is read
    // after this — it exists so the next section starts from a clean ballot.
    await untilText(page, /my picks/i, 8_000).then(async (still) =>
      still ? until(page, async () => !/my picks/i.test(await bodyText(page)), 8_000) : true,
    );
  }

  // g3 item 7 — candidate names on the ballot open their large battlecards.
  const nameLinks = await page.locator("[data-candidate-card]").count();
  check(
    "g3",
    "85701: candidate names open their large battlecards",
    nameLinks > 0,
    `${nameLinks} name link(s)`,
  );

  /*
   * g3 item 7 — the five-point scale reads as three groups, not one centre.
   *
   * THE SURFACE MOVED AND THE CLAIM DID NOT (F01-continued session 2 item 12,
   * 2026-08-19). `.scale-sep` lives on the FUNDING reaction control, and item
   * 12 moved the funding block off the inline ballot row and into the
   * battlecard. This check counted separators on the page and, the first time
   * it ran against the new build, reported 0 and printed g3's win as UNDONE.
   *
   * It was not undone — the check was looking where the content used to be.
   * The walk's own rule is that a check leaves this suite only when the
   * author retires the claim behind it, so the check FOLLOWS the surface: it
   * opens a battlecard first, which is the one tap a reader now makes, and
   * fails as loudly as before if the groups are not there.
   *
   * Counted on the page as well, so the two are told apart: separators on the
   * row would mean the funding block came back inline.
   */
  const inlineSeparators = await page.locator(".scale-sep").count();
  /*
   * WHICH card, and the first fix got this wrong too.
   *
   * The five-point scale is the FUNDING control, and funding renders only on
   * a FEDERAL contest. On 85701 the first fifteen pills are statewide Arizona
   * offices — governor, attorney general, treasurer — and the funding block
   * starts at the sixteenth, Adelita Grijalva (US House 7), whose card holds
   * 4 separators. Opening the FIRST card and reporting 0 was the check
   * looking in the wrong place twice over.
   *
   * Measured before this was written rather than guessed: all 20 cards on
   * 85701 were opened and read, and exactly one class of them carries the
   * block. So the check walks until it finds a card WITH funding, up to a
   * stated cap, and names the denominator if it never does.
   */
  const pillCount = await page.locator("[data-battlecard-pill]").count();
  const CARDS = Math.min(20, pillCount);
  let separators = 0;
  let searched = 0;
  for (let i = 0; i < CARDS; i++) {
    await page.locator("[data-battlecard-pill]").nth(i).scrollIntoViewIfNeeded();
    await page.locator("[data-battlecard-pill]").nth(i).click();
    const up = await page
      .locator("[data-candidate-battlecard]")
      .waitFor({ state: "visible", timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    searched = i + 1;
    if (up) {
      /*
       * THE SURFACE MOVED A SECOND TIME (BC-1, 2026-08-23), and the claim still
       * did not. Item 12 moved the funding block off the row and into the card;
       * BC-1 then gave the card a FIXED SET OF SEVEN DROP-DOWNS, so the block
       * now sits inside a collapsed "Campaign money" section. A collapsed
       * `CardSection` does not render its children at all, so `.scale-sep`
       * is not merely hidden — it is absent from the DOM until the section is
       * opened, and the first run after BC-1 shipped reported 0 and printed
       * g3's win as UNDONE for the second time in this check's life.
       *
       * It was not undone either time. The check follows the surface again: it
       * opens the section, which is the one extra tap a reader now makes.
       */
      const money = page.locator("[data-battlecard-body] button:has-text('Campaign money')");
      if (await money.count()) {
        await money.first().click().catch(() => {});
        await page.locator(".scale-sep").first().waitFor({ state: "attached", timeout: 4_000 }).catch(() => {});
      }
      separators = await page.locator(".scale-sep").count();
    }
    if (separators > 0) break;
    await page.keyboard.press("Escape");
    await page
      .locator("[data-candidate-battlecard]")
      .waitFor({ state: "detached", timeout: 5_000 })
      .catch(() => {});
  }
  check(
    "g3",
    "85701: the five-point scale carries its group separators",
    separators > 0,
    `${separators} separator(s), found on card ${searched} of ${CARDS} opened, ` +
      `${inlineSeparators} on the row (item 12 moved the funding block into the ` +
      "card; the claim is unchanged and only the place to look moved)",
  );

  await context.close();
}

// ═══════════════════════════════════════════════════════════════════════════
// E. The sources vocabulary and the officials' facts.
// ═══════════════════════════════════════════════════════════════════════════

section("E. Sources and officials (g3 items 5, 8, 9)");

{
  const page = await openAt(browser, "85701");

  /*
   * WGH-8 (2026-08-25): the who-governs card no longer opens itself, so the
   * row this clicks is behind the pill. Clicked the way a reader would.
   */
  const wghPill = page.locator(".notice-fab").first();
  if (await wghPill.isVisible().catch(() => false)) {
    await wghPill.click();
    await until(page, async () => (await page.locator(".coverage-notice").count()) > 0, 8_000);
  }

  // g3 item 5 — a read from the body's own official source IS verified.
  const opened = await page
    .locator('.coverage-notice button:has-text("Kelly")')
    .first()
    .click()
    .then(() => true)
    .catch(() => false);
  if (!opened) {
    /*
     * **R58: ALL THREE identities declare.** This block owned three and
     * declared one before falling through, so two reported NOTHING — which
     * R58 catches and calls a silent check. The shape was always here; WGH-8
     * exposed it by making the row genuinely absent for the first time.
     */
    for (const identity of [
      "the sources tab's vocabulary",
      "an official-source read never says 'Verified: not yet'",
      "the large card carries no duplicate 'How to reach them' accordion",
    ]) {
      cannotRun("g3", identity, "no official row on the who-governs card");
    }
  } else {
    // R49: the popup card is on the page, rather than 900ms have passed.
    await untilPresent(page, ".popup-card", 10_000);
    const more = page.locator('.popup-card button:has-text("More")');
    if (await more.count()) {
      await more.first().click();
      // R49: the large card is open, rather than 1.2s have passed.
      await untilPresent(page, ".account-modal-body", 10_000);
    }
    const card = await page.locator(".account-modal-body, .popup-card").first().innerText();
    check(
      "g3",
      "an official-source read never says 'Verified: not yet'",
      !/Verified:\s*not yet/i.test(card),
      (card.match(/Verified:[^\n]*/) ?? [""])[0],
    );
    // g3 item 9 — the contact pills are the contact surface; no duplicate
    // accordion carrying the same facts.
    check(
      "g3",
      "the large card carries no duplicate 'How to reach them' accordion",
      !/How to reach them/i.test(card),
    );
  }

  await page.context().close();
}

// ═══════════════════════════════════════════════════════════════════════════
// F. The map answers to the reader, and the panels stop shouting (g4).
// ═══════════════════════════════════════════════════════════════════════════

section("F. The reader's map and the folded panels (g4 items 1-5, 9, 11, 14, 15)");

{
  /*
   * The zip hop, both directions (g4 item 1).
   *
   * The mask used to be bound to the last activation that SUCCEEDED rather
   * than to where the reader is, so changing an NH zip to an AZ zip flew to
   * Arizona and left New Hampshire raised. Every hop asserts the newly active
   * state is the one the map says is focused; a hop that ends on the previous
   * state is the defect returning.
   */
  const hops: Array<[string, string]> = [
    ["03255", "ocd-division/country:us/state:nh"],
    ["85701", "ocd-division/country:us/state:az"],
    ["07866", "ocd-division/country:us/state:nj"],
    ["03255", "ocd-division/country:us/state:nh"],
  ];

  for (const [index, [zip, expected]] of hops.entries()) {
    /*
     * THE HOP'S OWN NAME (g9 item 4, 2026-08-17).
     *
     * 03255 appears twice in this journey — first, and again at the end to
     * prove the raised state comes BACK after two other states. That return
     * is the whole point of the fourth hop and it is a different claim from
     * the first, but both hops emitted three checks under identical names, so
     * the identity set collapsed six checks into three and the diff could not
     * have seen one of them die. The distinguishing fact is the journey
     * position, so that is what the name carries — not a measured value,
     * which would churn the diff on every run.
     */
    const hop = `hop ${index + 1} of ${hops.length}${
      index === hops.length - 1 ? ", returning" : ""
    }`;
    /*
     * A FRESH CONTEXT per hop.
     *
     * The first version wrote `sessionStorage` and reloaded — but `openAt`
     * installs an init script that rewrites the location on EVERY navigation,
     * so the reload put 03255 straight back and the walk reported New
     * Hampshire raised while sitting at 85701. It was measuring its own
     * fixture, and on a build where the defect was fixed it would have
     * reported the defect anyway.
     */
    const page = await openAt(browser, zip);

    const probe = (await page.evaluate(
      () =>
        (
          window as unknown as { __wtpMapProbe?: () => Record<string, unknown> }
        ).__wtpMapProbe?.() ?? null,
    )) as {
      focusOcdId: string | null;
      districtLayers: string[];
      districtFilterStates: (string | null)[];
      customSources: string[];
    } | null;

    if (!probe) {
      cannotRun("g4", `${zip} (${hop}): the map probe`, "no __wtpMapProbe on the page");
      await page.context().close();
      continue;
    }

    check(
      "g4",
      `${zip} (${hop}): the raised state is the state the reader is in`,
      probe.focusOcdId === expected,
      `focus ${probe.focusOcdId ?? "none"}, wanted ${expected}`,
    );

    // g4 item 3 — no other state's boundaries, ever.
    const want = expected.slice(-2).toUpperCase();
    const foreign = probe.districtFilterStates.filter(
      (abbr) => abbr !== null && abbr !== want,
    );
    check(
      "g4",
      `${zip} (${hop}): only the active state draws district boundaries`,
      foreign.length === 0,
      `${probe.districtLayers.length} layer(s); foreign filters ${JSON.stringify(foreign)}`,
    );

    /*
     * RETIRED, not regressed: g4 item 4's "the current zip is shaded".
     *
     * Zip shading left the product in g5 — the zip chooses
     * the active state and centres the camera, and draws nothing. The claim
     * behind the check is gone, so the check goes with it, which is the only
     * ground on which this suite ever loses a check. Its replacement asserts
     * the opposite and is the g5 line below.
     */
    check(
      "g5",
      `${zip} (${hop}): the zip draws nothing on the map`,
      !probe.customSources.some((id) => id.includes("zip-shade")),
      `custom sources ${JSON.stringify(probe.customSources)}`,
    );

    await page.context().close();
  }
}

{
  /*
   * g4 item 5 — the map stops dragging the reader back.
   *
   * The defect: free panning glided back to the STARTING
   * POINT, which is a reframe rather than inertia: the 2.8 s auto-frame flew
   * the camera to a box built around the zip's own centroid. Pan by hand,
   * wait past the timer, and the camera must not have moved.
   */
  const page = await openWideAt(browser, "85701");
  const centreNow = async () =>
    (await page.evaluate(
      () =>
        (
          window as unknown as {
            __wtpMapProbe?: () => { centre: { lat: number; lng: number } };
          }
        ).__wtpMapProbe?.().centre ?? null,
    )) as { lat: number; lng: number } | null;

  const before = await centreNow();
  const box = await page.locator(".maplibregl-canvas").first().boundingBox();

  if (!before || !box) {
    cannotRun(
      "g4",
      "the pan-and-wait check",
      before ? "no map canvas to drag" : "no __wtpMapProbe on the page",
    );
  } else {
    /*
     * DRAG FROM A POINT THE MAP CAN ACTUALLY RECEIVE (g18, correction 5).
     *
     * This check reported "the drag did not move the camera" in g17 and was
     * recorded as could-not-run with no cause. The cause, reproduced under the
     * walk's own seeding at 1280×900: `document.elementFromPoint` at the
     * canvas centre returns `DIV.coverage-notice … pointer-events-auto`. The
     * who-governs notice sits over the middle of the map, so `mouse.down()`
     * landed on the panel, MapLibre never saw the gesture, and the camera was
     * byte-identical before and after.
     *
     * That is g3's lesson exactly — a gesture that landed on an overlay and
     * never moved the map — and the `cannotRun` below was the check behaving
     * correctly: it refused to report a result for an experiment that had not
     * run. What was missing was a drag origin chosen against the page rather
     * than assumed from the geometry.
     *
     * So the origin is now the first candidate point the PAGE ITSELF says is
     * the canvas. Fixed offsets would rot the moment an overlay moves; asking
     * `elementFromPoint` cannot. If no candidate is clear the check still
     * reports could-not-run rather than dragging somewhere useless.
     */
    const origin = (await page.evaluate(`(() => {
      const b = ${JSON.stringify({ x: box.x, y: box.y, w: box.width, h: box.height })};
      const pts = [
        [b.x + b.w / 2, b.y + b.h / 2],
        [b.x + b.w / 2, b.y + b.h * 0.22],
        [b.x + b.w * 0.25, b.y + b.h * 0.3],
        [b.x + b.w * 0.75, b.y + b.h * 0.3],
        [b.x + b.w * 0.25, b.y + b.h * 0.7],
        [b.x + b.w * 0.75, b.y + b.h * 0.7],
      ];
      for (const [x, y] of pts) {
        const el = document.elementFromPoint(x, y);
        if (el && el.tagName === "CANVAS") return { x, y };
      }
      return null;
    })()`)) as { x: number; y: number } | null;

    if (!origin) {
      cannotRun(
        "g4",
        "the pan-and-wait check",
        "every candidate drag origin is covered by an overlay — no point on the canvas is reachable",
      );
    } else {
    await page.mouse.move(origin.x, origin.y);
    await page.mouse.down();
    await page.mouse.move(origin.x - 160, origin.y - 90, { steps: 12 });
    await page.mouse.up();
    /* R49: the camera has MOVED, rather than 1.2s have passed. The check below
     * needs a drag that took effect, and polling for it is the difference
     * between "the drag did nothing" and "the drag had not landed yet". */
    await until(
      page,
      async () => {
        const now = await centreNow();
        return now !== null && before !== null && (Math.abs(now.lat - before.lat) > 1e-6 || Math.abs(now.lng - before.lng) > 1e-6);
      },
      8_000,
    );

    const panned = await centreNow();
    // The experiment has to have RUN before its result means anything — g3's
    // lesson about a green check for a gesture that landed on an overlay and
    // never moved the map at all.
    const moved =
      panned !== null &&
      (Math.abs(panned.lat - before.lat) > 1e-4 ||
        Math.abs(panned.lng - before.lng) > 1e-4);

    if (!moved || !panned) {
      cannotRun("g4", "the pan-and-wait check", "the drag did not move the camera");
    } else {
      /* R49 DURATION, DELIBERATE: this waits for a timer NOT to fire. The
       * check is that the camera does not auto-frame after a manual pan, and
       * the only honest way to assert a non-event is to outlast it - a 2800ms
       * timer plus a 1400ms flight. There is no outcome to poll for; the
       * outcome is silence. */
      await page.waitForTimeout(5000);
      const after = await centreNow();
      const drift = after
        ? Math.abs(after.lat - panned.lat) + Math.abs(after.lng - panned.lng)
        : 99;
      check(
        "g4",
        "85701: the camera stays where the reader put it",
        drift < 1e-3,
        `drift ${drift.toFixed(5)} degrees after four seconds`,
      );
    }
    }
  }

  await page.context().close();
}

{
  const page = await openWideAt(browser, "85701");

  // g4 item 14 — Filters opens COLLAPSED, and holds radius and districts.
  const filtersOpen = await page
    .locator(".filters-title[aria-expanded='true']")
    .count();
  check("g4", "85701: Filters renders collapsed", filtersOpen === 0);

  const railVisible = await page
    .locator(".sidebar-scroll")
    .isVisible()
    .catch(() => false);
  if (!railVisible) {
    cannotRun(
      "g4",
      "85701: the rail's control placement",
      "the rail is closed at this width",
    );
  }
  const railText = railVisible
    ? await page.locator(".sidebar-scroll").innerText()
    : "";
  check(
    "g4",
    "85701: Near me stays outside Filters",
    /Near me/i.test(railText),
    "Near me is on the rail",
  );
  check(
    "g4",
    "85701: Limit radius and Show districts moved inside Filters",
    !/Limit radius/i.test(railText) && !/Show districts/i.test(railText),
    railText.replace(/\s+/g, " ").slice(0, 120),
  );

  /*
   * Opening Filters is a CLICK, and a click that cannot land is reported as
   * "could not run" rather than thrown.
   *
   * The rail is a drawer below the desktop breakpoint and the walk runs at
   * more than one width; a hidden control there is the sidebar behaving, not
   * a regression. Throwing would have taken the whole suite down with it —
   * which is the opposite of what a regression net is for.
   */
  const filtersButton = page.locator(".filters-title").first();
  const canOpen = await filtersButton.isVisible().catch(() => false);
  if (!canOpen) {
    cannotRun(
      "g4",
      "85701: opening Filters",
      "the Filters control is not visible at this width (the rail is a drawer)",
    );
  } else {
    await filtersButton.click();
    // R49: the rail is on the page, rather than 500ms have passed.
    await untilPresent(page, ".sidebar-scroll", 8_000);
    const opened = await page.locator(".sidebar-scroll").innerText();
    check(
      "g4",
      "85701: opening Filters reveals radius and districts",
      /Limit radius/i.test(opened) && /Show districts/i.test(opened),
    );
    check(
      "g4",
      "85701: District types is collapsed inside Filters",
      (await page.locator(".filter-group-toggle[aria-expanded='false']").count()) > 0,
    );
  }

  /*
   * g4 item 15 — the moving-here line, exactly.
   *
   * Asserted against the BALLOT page's server-rendered HTML rather than the
   * map's DOM. The line lives on both surfaces, but on the map it is inside
   * the who-governs card, which is collapsed to its bubble at some widths and
   * after some interactions — so reading it off the map measured whether the
   * card happened to be open, and reported "(absent)" for a string that was
   * shipped and correct. The ballot page renders it unconditionally.
   */
  const ballotHtml = (await get("/ballot?zip=85701")).text;
  check(
    "g4",
    "the moving-here line reads exactly",
    /Moving here\? Know the basics/.test(ballotHtml) &&
      !/Taxes, schools, registering/.test(ballotHtml),
    /Taxes, schools, registering/.test(ballotHtml)
      ? "the long form is still on the page"
      : "exact",
  );

  await page.context().close();
}

{
  /*
   * g4 item 11 — the meetings panel opens fully collapsed.
   *
   * The design: grouped-and-collapsed is right, auto-expanded is wrong.
   */
  const page = await openWideAt(browser, "85701");
  const listButton = page.locator('button:has-text("meetings")').first();
  if ((await listButton.count()) === 0) {
    cannotRun("g4", "the meetings panel", "no control opens the list at 85701");
  } else {
    const canOpenList = await listButton.isVisible().catch(() => false);
    if (!canOpenList) {
      cannotRun("g4", "the meetings panel", "the list control is not visible at this width");
    } else {
    await listButton.click();
    // R49: the list has groups, rather than 900ms have passed.
    await untilPresent(page, ".al-group-head", 10_000);
    const groups = await page.locator(".al-group-head").count();
    const expanded = await page
      .locator(".al-group-head[aria-expanded='true']")
      .count();
    if (groups === 0) {
      cannotRun("g4", "the meetings panel's groups", "no groups rendered");
    } else {
      check(
        "g4",
        "85701: the meetings panel opens with every group collapsed",
        expanded === 0,
        `${expanded} of ${groups} group(s) open`,
      );
    }
    }
  }
  await page.context().close();
}


// ═══════════════════════════════════════════════════════════════════════════
// g5 — the active-state model, and the panel that would not paint.
// ═══════════════════════════════════════════════════════════════════════════

{
  /*
   * g5 item 1 — THE ACTIVE STATE'S INTERIOR IS CRISP.
   *
   * The claim in one assertion, at the zoom it failed at. The scrim's clip
   * path was the state's rings at full projected extent — about 16,800 ×
   * 20,000 px at z11 — and Chromium DROPS a clip that large rather than
   * applying it, so the scrim painted over the whole map and the reader
   * standing in the middle of Arizona saw no crisp pixel anywhere.
   *
   * Sampled at a real place FAR FROM THE ENTERED ZIP, because near the centre
   * there is nothing to compare and the shipped defect was invisible to any
   * check that looked there. `pnpm measure:focus` is the full pass across
   * three zooms, two zips and both themes; this is the one line of it that
   * has to hold on every deploy.
   */
  const page = await openWideAt(browser, "85701");
  const probe = await page.evaluate(
    () =>
      (
        window as unknown as {
          __wtpProject?: (p: [number, number]) => { x: number; y: number };
        }
      ).__wtpProject?.([-110.98, 32.3]) ?? null,
  );
  if (!probe) {
    cannotRun("g5", "85701: the active state's interior is crisp", "no __wtpProject");
  } else {
    const canvas = page.locator("canvas.maplibregl-canvas");
    const on = decodePng(await canvas.screenshot());
    await page.evaluate(() => {
      const el = document.querySelector(".state-focus-layer") as HTMLElement | null;
      if (el) el.style.visibility = "hidden";
    });
    /* R49 DURATION, DELIBERATE: a repaint after hiding a layer. The DOM
     * already says the layer is hidden; what this waits for is the compositor,
     * which fires no event a page can poll. */
    await page.waitForTimeout(500);
    const off = decodePng(await canvas.screenshot());
    const x = Math.round(probe.x);
    const y = Math.round(probe.y);
    const delta = Math.abs(
      patchStats(on, x, y, 8).luma - patchStats(off, x, y, 8).luma,
    );
    check(
      "g5",
      "85701: north Tucson renders crisp, not muted, at city zoom",
      delta <= 2.5,
      `north Tucson at (${x},${y}), effect on vs off delta ${delta.toFixed(2)} <= 2.5`,
    );
  }
  await page.context().close();
}

{
  /*
   * g5 item 2 — THE MEETINGS PANEL PAINTS WITHOUT BEING TOUCHED.
   *
   * The mouse never moves: the panel is opened with a DOM `click()` issued
   * from inside the page, because a pointer move is the thing that repaired
   * the defect and a walk that hovers cannot see it. Measured on PIXELS — the
   * DOM was never wrong, and a guard that read it would have passed on every
   * broken build.
   *
   * `pnpm measure:panels` is the full pass at four zips, two viewports and
   * repeated for the intermittency; this is the claim that has to hold.
   */
  const page = await openAt(browser, "85701");
  const menu = page.locator('button[aria-label="Open menu"]');
  if (await menu.count()) {
    await menu.first().evaluate((el: HTMLElement) => el.click());
    // R49: the drawer is on the page, rather than 800ms have passed.
    await untilPresent(page, ".sidebar-scroll, [data-ask-pill]", 8_000);
  }
  // The frame BEFORE the panel opens. Every paint claim below is measured
  // against it, so no absolute threshold has to know what the basemap looks
  // like underneath the panel.
  const closedFrame = decodePng(await page.screenshot());
  const opened = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll("button, [role=button]"));
    for (const c of cards) {
      const text = c.textContent ?? "";
      if (/meetings/i.test(text) && /\d/.test(text)) {
        (c as HTMLElement).click();
        return true;
      }
    }
    return false;
  });
  if (!opened) {
    cannotRun("g5", "85701: the meetings panel paints on first render", "no meetings door");
  } else {
    // R49: the panel's own count element is present, rather than 1.6s have
    // passed. The paint assertions below still read whatever is there.
    await untilPresent(page, ".al-overlay-count", 10_000);
    const shape = await page.evaluate(() => {
      const header = document.querySelector(".al-overlay-count");
      const heads = Array.from(document.querySelectorAll(".al-group-head"));
      const counts: number[] = [];
      for (const h of heads) {
        const n = Number((h.querySelector(".al-group-count")?.textContent ?? "").trim());
        if (Number.isFinite(n)) counts.push(n);
      }
      const body = document.querySelector(".al-overlay-body");
      return {
        stated: Number((header?.textContent ?? "").replace(/[^\d]/g, "")),
        groups: heads.length,
        sum: counts.reduce((a, b) => a + b, 0),
        rect: body ? body.getBoundingClientRect().toJSON() : null,
      };
    });
    const png = decodePng(await page.screenshot());
    let change = 0;
    if (shape.rect && shape.rect.width > 8) {
      /*
       * The body's own rectangle, against the frame taken before the panel
       * opened — see png.mts#regionChange for why this replaced a
       * "does this patch carry detail" test.
       *
       * That test read a standard deviation of 2.6 on a good build against a
       * threshold of 1, because a group header is mostly empty ground with a
       * short label on the left. Device pixel ratio alone flipped it: this
       * check reported a NAMED REGRESSION against a build that
       * `pnpm measure:panels` had just passed 30 of 30 on the same
       * production deploy. A guard that fails a build its own sibling passes
       * is measuring the wrong thing.
       *
       * The walk's phone context runs at deviceScaleFactor 2, so a CSS rect
       * is half the pixels the screenshot is measured in.
       */
      change = regionChange(closedFrame, png, {
        x: shape.rect.x * 2,
        y: shape.rect.y * 2,
        width: shape.rect.width * 2,
        height: shape.rect.height * 2,
      });
    }
    check(
      "g5",
      "85701: the meetings panel body paints on first render, no pointer",
      shape.groups > 0 && change >= 6,
      `${shape.groups} group header(s), the body's pixels moved ${change.toFixed(1)} from the frame before it opened (>= 6)`,
    );
    check(
      "g5",
      "85701: the panel's group counts sum to the stated count",
      shape.stated > 0 && shape.sum === shape.stated,
      `groups sum ${shape.sum}, header states ${shape.stated}`,
    );
  }
  await page.context().close();
}

// ═══════════════════════════════════════════════════════════════════════════
// ITEM 1d (g6, 2026-08-17) — the meetings count, all four places, all four
// zips, one run.
//
// g5 measured group headers summing to 78 and never named the header count it
// compared against; an earlier frame of the author's read 86. Production now
// reads 78 in all three places, so the 86 is a different moment rather than a
// live defect — but "confirmed by reading one number in one place" is how a
// stated-N defect survives, so this closes it mechanically and permanently.
//
// Four numbers per zip: the sidebar counter, the map chip, the panel's header
// and the sum of its group counts. The chip is `sm:` and up, so on a phone
// viewport it is legitimately absent — absent is reported as absent, never as
// a zero and never as a pass.
// ═══════════════════════════════════════════════════════════════════════════
section("G. The meetings count agrees with itself (g6 item 1d)");

for (const { zip } of FOUR) {
 for (const wide of [false, true]) {
  // The chip lives at `sm:` and up, so the phone pass legitimately cannot see
  // it and the desktop pass is where the FOURTH number comes from. Both run:
  // dropping the phone would drop the viewport the defect was reported on,
  // and dropping the desktop would leave the chip permanently unchecked.
  const page = wide ? await openWideAt(browser, zip) : await openAt(browser, zip);
  const where = `${zip}${wide ? " (desktop)" : " (phone)"}`;
  // R49: openAt/openWideAt now return on a RENDERED page, so the numbers this
  // reads are there or genuinely absent. No further duration is owed.

  const numbers = await page.evaluate(`(() => {
    const readInt = (el) => {
      if (!el) return null;
      const n = Number((el.textContent || "").replace(/[^0-9]/g, ""));
      return Number.isFinite(n) ? n : null;
    };
    const sidebarEl = document.querySelector('[data-stat="meetings"] .num');
    const chipEl = document.querySelector("[data-meeting-count]");
    const sidebar = readInt(sidebarEl);
    const chip = chipEl ? Number(chipEl.getAttribute("data-meeting-count")) : null;
    const chipVisible = chipEl ? chipEl.getClientRects().length > 0 : false;

    // Open the meetings door, then read the panel.
    let opened = false;
    const door = document.querySelector('[data-stat="meetings"]');
    if (door) { door.click(); opened = true; }
    return { sidebar, chip, chipVisible, opened };
  })()`) as {
    sidebar: number | null;
    chip: number | null;
    chipVisible: boolean;
    opened: boolean;
  };

  if (!numbers.opened) {
    cannotRun("g6", `${where}: the meetings count agrees with itself`, "no meetings door on the sidebar");
    await page.context().close();
    continue;
  }
  // R49: the panel's count element is present, rather than 1.4s have passed.
  await untilPresent(page, ".al-overlay-count", 10_000);
  /*
   * NH121 (2026-08-24): and the panel has STOPPED CHANGING. The header paints
   * before the list's footer, so reading in the same tick saw the total, saw
   * the group counts, and missed the `Show N more` button that reconciles
   * them — which was reported as a product defect for a day.
   */
  await untilSettled(page, ".al-panel", 400, 10_000);

  const panel = await page.evaluate(`(() => {
    const header = document.querySelector(".al-overlay-count");
    if (!header) return { reason: "the meetings panel did not open" };
    const counts = [];
    for (const h of document.querySelectorAll(".al-group-head")) {
      const n = Number((h.querySelector(".al-group-count")?.textContent || "").trim());
      if (Number.isFinite(n)) counts.push(n);
    }
    /*
     * **THE PANEL PAGES AT 200, SO THE CLIP BELONGS IN THE ARITHMETIC.**
     * (NH121, 2026-08-24.)
     *
     * The list renders the first 200 and states what it is holding back —
     * Show N more (N hidden) — so above 200 the group counts and the header
     * legitimately differ, and a check that did not read the hidden count
     * would report a NAMED REGRESSION over a surface telling the truth.
     *
     * **THIS IS NOT THE EXPLANATION FOR THE 03255 FAILURE OF 2026-08-24**, and
     * saying so matters more than the code. That panel states 201, sums 200
     * across 7 groups, and renders NO more-button at all — measured, not
     * assumed — so the one missing row is NOT a paging clip and is not yet
     * understood. NH121 carries it. This block was written while that failure
     * was being diagnosed; it is correct on its own terms and it fixed nothing.
     *
     * A clip that is NOT stated still fails, which is the half that matters.
     */
    const more = document.querySelector(".al-more");
    /*
     * NH121's ACTUAL CAUSE — A REGEX ESCAPE EATEN BY A TEMPLATE LITERAL.
     * (2026-08-24. The timing theory that preceded it was wrong, and
     * docs/state.md records it as wrong.)
     *
     * This whole evaluate is a TEMPLATE LITERAL, so the page never received
     * what the source appears to say. A backslash before a parenthesis is not a
     * recognised escape in a template literal, so it collapses to a bare
     * parenthesis, and the page compiled the escaped parens as a CAPTURE GROUP.
     * The regex still matched "Show 1 more (1 hidden)" — which is why nothing
     * threw and nothing looked wrong — but the groups shifted by one, so index
     * 1 held "1 hidden" rather than "1", and Number of that is NaN.
     *
     * NaN then poisoned the check silently: 200 + NaN is NaN, so the equality
     * failed; and NaN > 0 is FALSE, so the report took the no-clip branch and
     * printed "group counts sum 200 across 7 group(s)" as though the panel had
     * rendered no clip at all. It renders one at t=0 — measured nine times from
     * 0ms to 9s, always present.
     *
     * So this stood as a NAMED REGRESSION against the product for a day and the
     * product was correct throughout.
     *
     * THE FIX IS TO STOP PUTTING A REGEX INSIDE A TEMPLATE LITERAL. indexOf and
     * a digits-only strip cannot lose an escape. The previous version was
     * clever and wrong, and this one is dull and right.
     */
    const moreText = more ? (more.textContent || "") : "";
    const open = moreText.lastIndexOf("(");
    const hiddenDigits = open >= 0 ? moreText.slice(open + 1).replace(/[^0-9]/g, "") : "";
    const hidden = hiddenDigits.length > 0 ? Number(hiddenDigits) : 0;
    return {
      stated: Number((header.textContent || "").replace(/[^0-9]/g, "")),
      groups: counts.length,
      sum: counts.reduce((a, b) => a + b, 0),
      hidden: Number.isFinite(hidden) ? hidden : 0,
      /* The raw text, so a future mismatch is diagnosable from the report. */
      moreText,
      clipStated: Boolean(more),
    };
  })()`) as {
    reason?: string;
    stated?: number;
    groups?: number;
    sum?: number;
    hidden?: number;
    /* The clip button's raw text, so a future mismatch is diagnosable from the
     * report rather than requiring a session to re-derive it. */
    moreText?: string;
    clipStated?: boolean;
  };

  if (panel.reason) {
    cannotRun("g6", `${where}: the meetings count agrees with itself`, panel.reason);
    await page.context().close();
    continue;
  }

  // The chip is hidden below the `sm` breakpoint by design. Hidden is stated,
  // not silently treated as agreement and not counted as a failure.
  const chipNote = numbers.chipVisible
    ? `chip ${numbers.chip}`
    : `chip not rendered at this width (sm: and up only)`;
  /*
   * The RENDERED rows plus what the panel says it is hiding must equal the
   * total every other surface states. That is the same reconciliation the
   * two-numbers rule asks a REPORT for, asked of a screen.
   */
  const hidden = panel.hidden ?? 0;
  const rendered = (panel.sum ?? 0) + hidden;
  const comparable = [numbers.sidebar, panel.stated, rendered].concat(
    numbers.chipVisible ? [numbers.chip] : [],
  );
  const allEqual = comparable.every((n) => n !== null && n === comparable[0]);
  // A clip that is NOT stated is still a failure: an unexplained short list is
  // the thing this check exists to catch.
  const clipHonest = hidden === 0 || panel.clipStated === true;
  const clipNote =
    hidden > 0
      ? `, group counts sum ${panel.sum} + ${hidden} the panel SAYS it is hiding = ${rendered}`
      : `, group counts sum ${panel.sum} across ${panel.groups} group(s)`;

  check(
    "g6",
    `${where}: the meetings count agrees with itself`,
    allEqual && clipHonest && (panel.stated ?? 0) >= 0,
    `sidebar ${numbers.sidebar}, ${chipNote}, panel header ${panel.stated}${clipNote}`,
  );

  await page.context().close();
 }
}

// ═══════════════════════════════════════════════════════════════════════════
// The summary.
// ═══════════════════════════════════════════════════════════════════════════


// ── Section G ─────────────────────────────────────────────────────────────

section("H. The frozen denominator (h item 1)");

/**
 * The one claim h shipped that production can be asked about.
 *
 * h enumerated 03255 against the 2022 Census of Governments and froze the
 * answer: THREE units govern this point — Merrimack County, the Town of
 * Newbury, and Kearsarge Regional School District. That number comes from
 * OUTSIDE our own records, which is the whole reason it is worth pinning:
 * if production ever renders a different governing count at 03255, either a
 * body was added without the denominator moving or the denominator moved
 * without anyone saying so, and both are the failure CLAUDE.md names.
 *
 * It is deliberately pinned to the UNIT count rather than the body count.
 * The body denominator is UNENUMERABLE today (HUNT02) — the Census has one row
 * for the Town of Newbury and the product renders five of its boards — so a
 * check against a body count would be pinning our own registry to itself,
 * which is exactly the self-defining denominator this check exists to
 * refuse.
 */
{
  /*
   * **THE DENOMINATOR IS GOVERNMENTS; THE THING COUNTED HAD TO BECOME
   * DIVISIONS.** (Corrected 2026-08-20, NH Hunt. The h session's CLAIM is
   * unchanged and this check keeps its name and its attribution.)
   *
   * The claim is that the three governments the 2022 Census of Governments
   * names at 03255 are the three we render. It was measured by counting
   * GOVERNING BODIES, which is the same number only while every government has
   * exactly one — and RULING 9 says in terms that Census counts GOVERNMENTS,
   * the product renders BODIES, and a body count may never be sourced from a
   * government count.
   *
   * Merrimack County is the first government here to have two. Its Board of
   * Commissioners is its executive; its DELEGATION — every state
   * representative elected from the county, sitting together — is its
   * legislative body, and it votes the county budget. Both are governing
   * bodies of one government, and calling the delegation advisory or a
   * commission to keep an arithmetic identity would be a false label on a
   * reader's screen about how a county is governed.
   *
   * So the count is distinct DIVISIONS carrying a governing body, and both
   * numbers are printed, because a surface that can collect one and render
   * another states them as a pair.
   */
  const payload = await getJson<{
    coverage: {
      counts: { governing: { total: number } };
      bodies?: { ocdId: string | null; bodyClass: string }[];
    } | null;
  }>("/api/meetings?lat=43.31403&lng=-72.02455");

  if (!payload) {
    cannotRun("h", "03255: the governing count matches the frozen external denominator", "/api/meetings did not answer");
  } else {
    const bodies = payload.coverage?.bodies ?? [];
    const governingBodies = bodies.filter((b) => b.bodyClass === "GOVERNING");
    const governments = new Set(
      governingBodies.map((b) => b.ocdId ?? "(no division)"),
    );
    // The pre-correction figure, kept so a run that loses the body list still
    // measures something rather than silently passing on an empty set.
    const statedTotal = payload.coverage?.counts.governing.total ?? -1;
    check(
      "h",
      "03255: the governing count matches the frozen external denominator",
      governments.size === 3 && governingBodies.length >= 3,
      `production renders ${governingBodies.length} governing body/bodies across ` +
        `${governments.size} government(s) (API's own governing total: ${statedTotal}); ` +
        "the 2022 Census of Governments says 3 governments — Merrimack County, " +
        "Newbury town, Kearsarge Regional SD",
    );
  }
}


// ═══════════════════════════════════════════════════════════════════════════
// ITEM 6 (g6, 2026-08-17) — the mayor is still reachable after leaving the
// who-governs panel.
//
// This REPLACES `[0818] 07866: the mayor line renders`, which asserted /Mayor/
// on the who-governs card. That check leaves the suite the only way a check
// ever may: **the claim behind it was retired.** Keeping it would now
// assert a defect. What was worth guarding was never the row — it was that a
// reader at 07866 can still reach their mayor.
//
// **It runs on its own fresh page, and that is the point.** The first version
// lived inside the shared per-zip loop in section C, after a dozen other
// checks had already opened and closed things on that page, and it failed
// against a production build where the office was demonstrably present: the
// "Representation" button it clicked belonged to whatever surface an earlier
// check had left open, not to the card this check had just opened. A guard
// that reports a regression against a working build is worse than no guard.
//
// So every query below is scoped to the dialog this check opened —
// `[role="dialog"]`, its own `[role="tablist"]`, its own `[role="tabpanel"]` —
// and nothing is read off `document.body`.
//
// The distance is also recorded, because it is item 6's real cost: the mayor
// moved from zero clicks (a row on who-governs) to two (row → card →
// Representation). The old placement is gone; the price is stated
// rather than implied.
// ═══════════════════════════════════════════════════════════════════════════
section("I. The mayor after item 6 (g6)");

{
  const page = await openAt(browser, "07866");
  // R49: openAt returns on a rendered page; the who-governs card below is
  // read directly, and a genuine absence still fails there.

  const onPanel = await page.evaluate(`(() => {
    const card = document.querySelector(".coverage-notice");
    if (!card) return null;
    return /Mayor/.test(card.textContent || "");
  })()`) as boolean | null;

  if (onPanel === null) {
    cannotRun("g6", "07866: the Mayor row is gone from the who-governs panel", "no who-governs card");
    cannotRun("g6", "07866: the mayor is reachable from who-governs", "no who-governs card");
  } else {
    check(
      "g6",
      "07866: the Mayor row is gone from the who-governs panel",
      onPanel === false,
      `who-governs text contains "Mayor": ${onPanel}`,
    );

    const opened = await page.evaluate(`(() => {
      const card = document.querySelector(".coverage-notice");
      for (const b of card.querySelectorAll("li[data-governing-row] button")) {
        if (/Rockaway township/i.test(b.textContent || "")) { b.click(); return true; }
      }
      return false;
    })()`) as boolean;

    if (!opened) {
      cannotRun("g6", "07866: the mayor is reachable from who-governs", "no Rockaway township row to open");
    } else {
      // R49: the opened card is present, rather than 2.5s have passed.
      await untilPresent(page, ".account-modal, .popup-card", 12_000);
      /*
       * TWO GRAMMARS, because M136 (g13, 2026-08-18) gave BODY cards
       * collapsible sections while district and meeting cards kept their
       * tabs. This check went COULD-NOT-RUN the moment the body card stopped
       * having a Representation tab — a check that stops running is the
       * quietest way for a claim to die, so it is taught the new shape here
       * rather than left reporting an honest nothing.
       *
       * The CLAIM is unchanged and is still two clicks from the panel: row →
       * card → open the seats. Only the second click's affordance moved, and
       * the evidence line below says which one answered.
       */
      const opened2 = await page.evaluate(`(() => {
        const dlg = document.querySelector('[role="dialog"]');
        if (!dlg) return "no dialog";
        for (const b of dlg.querySelectorAll('[role="tablist"] button')) {
          if (/representation/i.test(b.textContent || "")) { b.click(); return "tab"; }
        }
        for (const b of dlg.querySelectorAll("button")) {
          if (/who sits on it/i.test(b.textContent || "")) { b.click(); return "section"; }
        }
        return "neither a Representation tab nor a Who-sits-on-it section in the dialog";
      })()`) as string;

      if (opened2 !== "tab" && opened2 !== "section") {
        cannotRun("g6", "07866: the mayor is reachable from who-governs", opened2);
      } else {
        // R49: the opened surface is present, rather than 1.8s have passed.
        await untilPresent(page, "[role=tabpanel], .account-modal-body", 10_000);
        // Scope to the tab panel where there is one, and to the whole dialog
        // body where the section grammar is in play — never to the document,
        // which would let anything else on the page answer for this card.
        const inPanel = await page.evaluate(`(() => {
          const dlg = document.querySelector('[role="dialog"]');
          const panel =
            (dlg && dlg.querySelector('[role="tabpanel"]')) ||
            (dlg && dlg.querySelector('.account-modal-body')) ||
            dlg;
          const t = (panel && panel.textContent) || "";
          return { mayor: /Mayor/.test(t), jackson: /Joseph Jackson/.test(t), chars: t.length };
        })()`) as { mayor: boolean; jackson: boolean; chars: number };

        check(
          "g6",
          "07866: the mayor is reachable from who-governs",
          inPanel.mayor && inPanel.jackson,
          `two clicks from the panel (row → card → ${opened2}): the office renders ${inPanel.mayor}, ` +
            `the holder renders ${inPanel.jackson}, over ${inPanel.chars} chars`,
        );
      }
    }
  }
  await page.context().close();
}

// ═══════════════════════════════════════════════════════════════════════════
// hotfix-0817 — a carried row never inherits the snapshot's freshness.
// ═══════════════════════════════════════════════════════════════════════════

section("J. Carried rows state their own freshness (hotfix-0817 item 2)");

/*
 * The defect: the footer says "LAST CHECKED 6 hours ago", which is true of the
 * snapshot and FALSE of the rows carried forward out of the previous one
 * because a source refused. At 03255 those rows are Kearsarge's and Newbury's
 * — the calendars whose host refuses the CI runner's egress — and a reader
 * looking at one had no way to know they were looking at something we could
 * not reach.
 *
 * THIS CHECK CANNOT ALWAYS RUN, and that is not a defect in it. Carried rows
 * exist only when a source was unreachable on the refresh that wrote the
 * committed snapshot. When every source was reachable there is nothing to
 * assert, and the honest report is that it could not run, named, with the
 * reason — never a pass it did not earn. It is never retired for being unable
 * to run: the condition it guards is exactly the condition it cannot rehearse.
 */
{
  const payload = await getJson<MeetingsPayload>(
    `/api/meetings?lat=${ZIPS.newbury.lat}&lng=${ZIPS.newbury.lng}&zip=03255`,
  );
  const NAME = "03255: no carried row is claimed to be as fresh as the snapshot";
  if (!payload) {
    cannotRun("hotfix-0817", NAME, "/api/meetings did not answer");
  } else {
    const carriedRows = payload.meetings.filter((m) => m.carried);
    const meta = payload.snapshot?.carried ?? null;
    const generatedAt = payload.snapshot?.generatedAt ?? null;

    // The fresh rows are unaffected — asserted whether or not anything was
    // carried, because marks smeared across rows that WERE retrieved is the
    // mirror-image failure: a working calendar wearing a staleness it does
    // not have. A mark is only legitimate on a row whose source reported a
    // gap, so any other marked row fails this.
    const withGaps = new Set((payload.snapshot?.failed ?? []).map((f) => f.source));
    const misplaced = carriedRows.filter((m) => !withGaps.has(m.carried!.source));
    check(
      "hotfix-0817",
      "03255: only rows from a source that reported a gap carry a mark",
      misplaced.length === 0,
      `${carriedRows.length} marked of ${payload.meetings.length} row(s); sources reporting a gap: ` +
        `${[...withGaps].join(", ") || "none"}${misplaced.length > 0 ? `; misplaced: ${misplaced.map((m) => m.id).join(", ")}` : ""}`,
    );

    if (carriedRows.length === 0) {
      /*
       * ALL THREE report, not just the first (g10, 2026-08-17).
       *
       * Only `NAME` used to be named here, and the other two live inside the
       * `else` below — so when a refresh reached every source they did not
       * report CANNOT-RUN, they simply ceased to exist. The identity diff saw
       * "GONE 3" against a run where one was accounted for and two were not,
       * which is precisely the shape the diff exists to catch: a check dying
       * quietly inside the suite that was supposed to notice.
       *
       * Found by this session's own refresh, which reached every source and
       * carried nothing forward — a strictly better snapshot that made two
       * checks vanish. A condition a check cannot rehearse is still a check;
       * it says so by name.
       */
      /*
       * ── g20, 2026-08-19: THEY ASSERT THE HEALTHY STATE NOW ──────────────
       *
       * These three used to report CANNOT-RUN whenever the refresh reached
       * every source, which is the healthiest possible outcome. g19's run
       * therefore showed 306 passed and 3 could-not-run, and the identity
       * diff read "GONE 3" — a suite shrinking because the product got
       * better. Coverage that falls away in good weather is coverage that is
       * missing on the day the weather turns.
       *
       * So the zero-carried branch now CHECKS rather than abstains, and what
       * it checks is stronger than what it replaced: no rows are carried AND
       * no source serving this zip reported a gap. Those two must agree. A
       * source that failed while nothing was carried forward would be
       * carry-forward silently not carrying — the exact defect the
       * refresh corollary exists to prevent, and the old CANNOT-RUN could
       * not see it because it never looked.
       */
      const gapSources = [...withGaps];
      const evidence =
        `the snapshot generated ${generatedAt ?? "unknown"} carries 0 rows of ` +
        `${payload.meetings.length} at this zip, and ${gapSources.length} source(s) reported a gap` +
        `${gapSources.length > 0 ? ` (${gapSources.join(", ")})` : ""}`;
      check(
        "hotfix-0817",
        NAME,
        gapSources.length === 0,
        `${evidence} — with nothing carried, no row can claim the snapshot's freshness; ` +
          "a source reporting a gap while nothing is carried would be carry-forward not carrying",
      );
      check(
        "hotfix-0817",
        "03255: each carried row's stated timestamp is the one the snapshot records",
        gapSources.length === 0,
        `${evidence} — vacuously true over zero carried rows, and the condition that ` +
          "would make it non-vacuous (a refused source) is asserted absent rather than assumed",
      );
      check(
        "hotfix-0817",
        "03255: the footer does not speak for the carried rows",
        gapSources.length === 0 && meta === null,
        `${evidence}; snapshot.carried is ${meta === null ? "null" : JSON.stringify(meta)} — ` +
          "no carried rows and no carried metadata, which is what a fully-reached refresh looks like",
      );
    } else {
      // 1. Every carried row names its origin and an instant, and that instant
      //    is OLDER than the snapshot's own — a carried row that claims to be
      //    as new as the run that never reached it is the defect itself.
      const older = carriedRows.filter(
        (m) =>
          Number.isFinite(Date.parse(m.carried!.lastFreshAt)) &&
          generatedAt !== null &&
          Date.parse(m.carried!.lastFreshAt) < Date.parse(generatedAt),
      );
      check(
        "hotfix-0817",
        NAME,
        older.length === carriedRows.length,
        `${older.length} of ${carriedRows.length} carried row(s) state an instant strictly older ` +
          `than the snapshot's ${generatedAt}`,
      );

      // 2. The snapshot's own record and the rows agree. The count is a
      //    whole-file number and this zip is a slice of it, so the slice must
      //    not exceed it and every row's stamp must be one the file records.
      //
      // The file's stated instant is the OLDEST of the carried rows on a
      // single shared day, so two things have to hold: it is on that day, and
      // it is no NEWER than any row it speaks for. An instant newer than some
      // row would be the footer claiming a freshness that row never had —
      // which is the defect one layer down from the one this section exists
      // for, and it is how the first version of this check failed.
      const day = meta?.lastFreshAt?.slice(0, 10) ?? null;
      const stated = meta?.lastFreshAt ? Date.parse(meta.lastFreshAt) : null;
      const newerThanARow =
        stated === null
          ? []
          : carriedRows.filter((m) => Date.parse(m.carried!.lastFreshAt) < stated);
      check(
        "hotfix-0817",
        "03255: each carried row's stated timestamp is the one the snapshot records",
        meta !== null &&
          carriedRows.length <= meta.count &&
          (meta.lastFreshAt === null ||
            (carriedRows.every((m) => m.carried!.lastFreshAt.slice(0, 10) === day) &&
              newerThanARow.length === 0)),
        `${carriedRows.length} carried here of ${meta?.count ?? "?"} in the snapshot; ` +
          `file says ${meta?.lastFreshAt ?? "the rows disagree, each states its own"}` +
          (newerThanARow.length > 0
            ? `; ${newerThanARow.length} row(s) older than the stated instant`
            : ""),
      );

      // 3. And the reader is told. The footer must state the carried count
      //    rather than letting one age speak for every row, and the row's own
      //    card must carry its own stamp.
      const page = await openAt(browser, "03255");
      const footer = await page.evaluate(`(() => {
        const el = [...document.querySelectorAll("p")].find((p) =>
          /Last checked/i.test(p.textContent || ""));
        return el ? (el.textContent || "").replace(/\\s+/g, " ") : null;
      })()`) as string | null;
      if (footer === null) {
        cannotRun("hotfix-0817", "03255: the footer does not speak for the carried rows", "no last-checked line on the page");
      } else {
        check(
          "hotfix-0817",
          "03255: the footer does not speak for the carried rows",
          /older than that/i.test(footer),
          `footer reads "${footer.slice(0, 160)}"`,
        );
      }
      await page.context().close();
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// K. No internal key reaches a reader (g8)
// ═══════════════════════════════════════════════════════════════════════════

section("K. Reader surfaces speak plain language (g8)");

/*
 * `schedulepage`, `civicplus`, `iqm2`, `clerksboards` — adapter ids. Right in
 * the wiring, wrong in front of a person, and `/api/meetings` ships them to
 * the client in three places (`sources[].source`, every meeting `id`, and
 * `carried.source`), so the value is permanently one interpolation away from a
 * surface.
 *
 * Read off PRODUCTION rather than off the source, because that is where the
 * claim lives. `tests/source-labels.test.ts` reads the components; this reads
 * what a reader is actually served. The API's own JSON is deliberately NOT
 * checked — it is a wire format, not a reader surface, and asserting on it
 * would either fail forever or force the ids out of the place they belong.
 */
{
  const ids = internalSourceIds();
  for (const { zip } of FOUR) {
    for (const [surface, path] of [
      ["the map's server HTML", `/?zip=${zip}`],
      ["/about-area", `/about-area?zip=${zip}`],
      ["/ballot", `/ballot?zip=${zip}`],
    ] as const) {
      const res = await get(path);
      if (res.status !== 200) {
        cannotRun("g8", `${zip}: no internal source id on ${surface}`, `HTTP ${res.status}`);
        continue;
      }
      /*
       * **A SOURCE URL IS NOT A LEAKED ADAPTER ID** (2026-08-27).
       *
       * This scanned the raw response, so `\bcivicplus\b` matched inside
       * `https://content.civicplus.com/...` and `\blegistar\b` inside
       * `https://pima.legistar.com/LegislationDetail.aspx?ID=21690`. Both are
       * CITATIONS — Pima County's own document CDN and its legislative portal,
       * carried because the ballot corpus's absences must cite the record that
       * settled them. The guard was reporting the transparency rules working.
       *
       * It had been red on `main` since PR #210 added those citations, and it
       * is a FALSE POSITIVE rather than a defect: with URLs removed, not one
       * adapter id remains anywhere in the served HTML at any of the four zips.
       *
       * So URLs are stripped before scanning and nothing else changes. The
       * thing this guard exists to catch — an adapter id interpolated into
       * text a reader reads, which `/api/meetings` ships to the client in
       * three places — is caught exactly as before, and `PLANTED` below proves
       * it on every run rather than promising it.
       */
      const readerText = res.text.replace(/https?:\/\/[^\s"'<>)]+/g, " ");
      const found = ids.filter((id) => new RegExp(`\\b${id}\\b`).test(readerText));
      check(
        "g8",
        `${zip}: no internal source id on ${surface}`,
        found.length === 0,
        found.length > 0 ? `found: ${found.join(", ")}` : `${ids.length} id(s) checked`,
      );

      // B01 interim: the product wears one name, and the old one is gone from
      // every surface a reader is served. A rename that half-lands is worse
      // than one that never started — two names read as two products.
      check(
        "g8",
        `${zip}: ${surface} carries the current product name, not the old one`,
        res.text.includes(PRODUCT_NAME) && !/We[ ]the[ ]People/i.test(res.text),
        res.text.includes(PRODUCT_NAME)
          ? /We[ ]the[ ]People/i.test(res.text)
            ? "both names are on the page"
            : `"${PRODUCT_NAME}" present`
          : `"${PRODUCT_NAME}" is not on the page at all`,
      );
    }
  }

  /*
   * **PLANTED: the URL strip did not blind the guard.**
   *
   * Narrowing a check is exactly where a check quietly stops checking, so the
   * narrowing is exercised on every run. A page carrying an adapter id in
   * READER TEXT must still be caught, and the same id inside a source URL must
   * still be ignored — the two halves together are the whole rule.
   */
  const strip = (t: string) => t.replace(/https?:\/\/[^\s"'<>)]+/g, " ");
  const leak = strip('<p>Sourced from legistar</p>');
  const citation = strip(
    '<a href="https://pima.legistar.com/LegislationDetail.aspx?ID=21690">Pima County</a>',
  );
  check(
    "g8",
    "PLANTED: an adapter id in reader text is still caught, a source URL is not",
    /\blegistar\b/.test(leak) && !/\blegistar\b/.test(citation),
    /\blegistar\b/.test(leak)
      ? /\blegistar\b/.test(citation)
        ? "a source URL still trips the guard — the false positive is back"
        : "reader text caught, source URL ignored"
      : "THE GUARD IS BLIND — an adapter id in reader text no longer trips it",
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// g9 — one Phone pill (R39) and the address that left the product (R40).
// ═══════════════════════════════════════════════════════════════════════════

section("L. Contact surfaces (g9: R39 the phone pill, R40 the address)");

{
  /*
   * R39. Jeanne Shaheen's card rendered seven stacked phone rows; 531 of the
   * 1,157 officeholder records carry more than one number, so this is a
   * class-wide claim checked at its loudest instance. Its own fresh page,
   * because the per-zip loop's page has been clicked through by a dozen
   * checks and a bare querySelector would find whatever they left open.
   */
  const page = await openAt(browser, "03255");

  const opened = (await page.evaluate(`(() => {
    const card = document.querySelector(".coverage-notice");
    if (!card) return false;
    for (const b of card.querySelectorAll("button")) {
      if (/Shaheen/i.test(b.textContent || "")) { b.click(); return true; }
    }
    return false;
  })()`)) as boolean;

  if (!opened) {
    cannotRun("g9", "03255: Shaheen renders ONE Phone pill", "no Shaheen row on who-governs");
    cannotRun("g9", "03255: the phone chooser lists every recorded number", "no Shaheen row");
  } else {
    /* R49: the row has POPULATED, not merely mounted. Waiting for the
     * container alone read it while it still held four pills and no Phone,
     * and printed a NAMED REGRESSION against a working card - the same
     * mistake the app-settled helper made one level up, and the reason both
     * now wait for the thing being asserted rather than its parent. Reading
     * anyway at the ceiling keeps a genuine 0 or 2 a real failure. */
    await until(
      page,
      async () =>
        (await page.locator(".contact-pill-row").count()) > 0 &&
        /Phone/.test(await page.locator(".contact-pill-row").first().innerText()),
      15_000,
    );
    const pills = (await page.evaluate(`(() => {
      const row = document.querySelector(".contact-pill-row");
      if (!row) return null;
      const p = [...row.querySelectorAll(".contact-pill")];
      return {
        total: p.length,
        phonePills: p.filter((x) => x.tagName === "BUTTON" && /Phone/.test(x.textContent || "")).length,
        showingANumber: p.filter((x) => /\\d{3}[).\\- ]\\s?\\d{3}[-. ]\\d{4}/.test(x.textContent || "")).length,
      };
    })()`)) as { total: number; phonePills: number; showingANumber: number } | null;

    if (!pills) {
      cannotRun("g9", "03255: Shaheen renders ONE Phone pill", "no contact pill row on the card");
      cannotRun("g9", "03255: the phone chooser lists every recorded number", "no contact pill row");
    } else {
      check(
        "g9",
        "03255: Shaheen renders ONE Phone pill",
        pills.phonePills === 1 && pills.showingANumber === 0,
        `${pills.phonePills} Phone pill(s), ${pills.showingANumber} pill(s) showing a number, ` +
          `${pills.total} pill(s) total`,
      );

      await page.evaluate(`(() => {
        for (const p of document.querySelectorAll("button.contact-pill")) {
          if (/Phone/.test(p.textContent || "")) { p.click(); return; }
        }
      })()`);
      // R49: the chooser is on the page, rather than 700ms have passed.
      await untilPresent(page, "[role=dialog] a[href^='tel:'], .contact-chooser", 8_000);

      // The chooser's rows against the RECORDED count, read from the same
      // route the card reads. A modal with the wrong number of rows is the
      // stated-N-equals-rendered-rows rule failing where a reader dials.
      const modal = (await page.evaluate(`(async () => {
        const overlay = document.querySelector(".phone-modal-overlay");
        if (!overlay) return null;
        const rows = [...overlay.querySelectorAll(".phone-modal-row")];
        const r = await fetch("/api/directory?member=congress:S001181");
        const recorded = r.ok
          ? new Set(((await r.json()).districtOffices || []).map((o) => o.phone).filter(Boolean)).size
          : null;
        return {
          rows: rows.length,
          tel: rows.filter((x) => (x.getAttribute("href") || "").startsWith("tel:")).length,
          labelled: rows.filter((x) => ((x.querySelector(".phone-modal-row-label") || {}).textContent || "").trim()).length,
          recorded,
          overCard: Number(getComputedStyle(overlay).zIndex) > 1300,
        };
      })()`)) as {
        rows: number;
        tel: number;
        labelled: number;
        recorded: number | null;
        overCard: boolean;
      } | null;

      if (!modal) {
        cannotRun("g9", "03255: the phone chooser lists every recorded number", "the pill opened nothing");
      } else if (modal.recorded === null) {
        cannotRun("g9", "03255: the phone chooser lists every recorded number", "the directory route did not answer");
      } else {
        check(
          "g9",
          "03255: the phone chooser lists every recorded number",
          modal.rows === modal.recorded + 1 &&
            modal.tel === modal.rows &&
            modal.labelled === modal.rows &&
            modal.overCard,
          `${modal.rows} row(s) against ${modal.recorded} recorded district number(s) + 1 Washington; ` +
            `${modal.tel} are tel: links, ${modal.labelled} carry an office label; over the card ${modal.overCard}`,
        );
      }
    }
  }
  await page.context().close();
}

{
  /*
   * R40. The author's personal address left the product. This is the
   * class-wide form of it: not "the sidebar no longer shows it" but "no
   * surface a reader is served carries it at all", checked in the SERVED
   * HTML rather than in rendered text, because a string in an attribute or a
   * script payload is just as reachable and does not show up in innerText.
   */
  const ADDRESS = ["seanj22", "gmail.com"].join("@");
  for (const [surface, path] of [
    ["the map", "/?zip=03255"],
    ["/transparency", "/transparency"],
    ["/feedback", "/feedback"],
  ] as const) {
    const res = await get(path);
    if (res.status !== 200) {
      cannotRun("g9", `${surface}: carries no personal email address`, `HTTP ${res.status}`);
      continue;
    }
    check(
      "g9",
      `${surface}: carries no personal email address`,
      !res.text.includes(ADDRESS) && !/href="mailto:/.test(res.text),
      res.text.includes(ADDRESS)
        ? "the address is in the served HTML"
        : /href="mailto:/.test(res.text)
          ? "a mailto: link is in the served HTML"
          : "neither the address nor a mailto: link",
    );
  }

  // The replacement exists and is in-app, and its disclosure shipped with it.
  const map = await get("/?zip=03255");
  if (map.status !== 200) {
    cannotRun("g9", "the sidebar offers the in-app feedback route", `HTTP ${map.status}`);
  } else {
    check(
      "g9",
      "the sidebar offers the in-app feedback route",
      /href="\/feedback"/.test(map.text),
      /href="\/feedback"/.test(map.text) ? "/feedback is linked" : "no link to /feedback",
    );
  }
  const transparency = await get("/transparency");
  if (transparency.status !== 200) {
    cannotRun("g9", "/transparency discloses the feedback store", `HTTP ${transparency.status}`);
  } else {
    check(
      "g9",
      "/transparency discloses the feedback store",
      /feedback form/i.test(transparency.text) &&
        /aggregated or licensed/i.test(transparency.text),
      `names the form ${/feedback form/i.test(transparency.text)}, ` +
        `states never-licensed ${/aggregated or licensed/i.test(transparency.text)}`,
    );
  }
  const form = await get("/feedback");
  if (form.status !== 200) {
    cannotRun("g9", "/feedback serves the form and says what happens to it", `HTTP ${form.status}`);
  } else {
    /*
     * g11: the "cannot write back" half of this check MOVED rather than being
     * dropped. R41 shipped the optional reply field, so the flat promise is
     * now true only of a blank submission and the page says which case the
     * reader is in. The check still asserts a claim about replies is made —
     * it just asserts the CURRENT one, and the g9 identity stays on the
     * surviving half so a real regression in the form still prints as g9's.
     */
    check(
      "g9",
      "/feedback serves the form and says what happens to it",
      /data-feedback-input/.test(form.text) &&
        /only write back if you fill in the optional email box/i.test(form.text),
      `input present ${/data-feedback-input/.test(form.text)}, ` +
        `states when a reply is possible ` +
        `${/only write back if you fill in the optional email box/i.test(form.text)}`,
    );
    /*
     * R41 (g11, 2026-08-17, option A). The READ half of the row's
     * walk checks — the write half writes real feedback rows and lives in
     * scripts/walk-r41.mts, named in EXCLUDED below.
     *
     * What is asserted here is that the field ships, that it ships OPTIONAL,
     * and that the message body's scrub promise survived the change. The
     * third matters most: R41's whole risk is that the one deliberate
     * exception to T09 widens, and a page that stopped saying the message is
     * scrubbed would be the first visible sign of it.
     */
    check(
      "g11",
      "/feedback ships the optional reply field",
      /data-feedback-reply/.test(form.text),
      `field present ${/data-feedback-reply/.test(form.text)}`,
    );
    check(
      "g11",
      "the reply field is labelled optional and required by nothing",
      /Your email — optional/.test(form.text) && !/data-feedback-reply[^>]*\srequired/.test(form.text),
      `label present ${/Your email — optional/.test(form.text)}, ` +
        `not marked required ${!/data-feedback-reply[^>]*\srequired/.test(form.text)}`,
    );
    check(
      "g11",
      "the message body is still promised the T09 scrub",
      /an address left in the message itself is removed/i.test(form.text),
      `scrub promise present ${/an address left in the message itself is removed/i.test(form.text)}`,
    );
  }
  const transparencyAgain = await get("/transparency");
  if (transparencyAgain.status !== 200) {
    cannotRun("g11", "/transparency discloses the optional reply address", `HTTP ${transparencyAgain.status}`);
  } else {
    // The coupling rule: the field and its disclosure ship together, and the
    // disclosure states what the address is NEVER used for, not only what it is.
    check(
      "g11",
      "/transparency discloses the optional reply address",
      /one optional box for your email address/i.test(transparencyAgain.text) &&
        /never added to a mailing list/i.test(transparencyAgain.text),
      `names the field ${/one optional box for your email address/i.test(transparencyAgain.text)}, ` +
        `states the limits ${/never added to a mailing list/i.test(transparencyAgain.text)}`,
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// g9 / M19 — overlapping pins fan out, and dismissal returns them.
// ═══════════════════════════════════════════════════════════════════════════

section("M. Overlapping pins are each reachable (g9: M19, the author's ruling)");

{
  /*
   * The claim: two pins sitting on top of each other are BOTH tappable.
   *
   * The walk cannot guess which pins collide — that depends on zoom, data and
   * viewport — so it asks the map, through the same projection and the same
   * collision rule the click path uses. Then it FORCES a collision by zooming
   * out, because a build where nothing happens to overlap would otherwise
   * report green on a check that never ran, which is the g3 lesson.
   *
   * Its own page, and no selection is made: the first press on a stacked pin
   * fans and selects nothing, which is precisely the behaviour under test, so
   * this check opens no popup and writes no MEETING_OPENED row.
   *
   * DESKTOP width, for g4 item 5's reason: at 390px the who-governs card
   * covers the middle of the map, so a press aimed at a pin lands on an
   * overlay and the check reports a working fan as a broken one. That is not
   * a hypothetical — the first run of this check FAILED exactly that way, 4
   * pins in the stack and 0 fanned, because the press never reached a pin.
   */
  const page = await openWideAt(browser, "85701");

  type SpiderProbe = {
    visible: number;
    groups: string[][];
    fanned: string[];
    boxes: Record<string, { x: number; y: number }>;
  };
  const probe = async () =>
    (await page.evaluate(
      `(window.__wtpSpiderProbe ? window.__wtpSpiderProbe() : null)`,
    )) as SpiderProbe | null;

  let reading = await probe();
  if (!reading) {
    cannotRun("g9", "85701: overlapping pins fan out when pressed", "no __wtpSpiderProbe");
    cannotRun("g9", "85701: dismissing the fan returns every pin", "no __wtpSpiderProbe");
  } else {
    // Zoom out until something collides, or give up and say so. Each step is
    // a real gesture through the settle path, like a reader's wheel.
    for (let step = 0; step < 5 && reading.groups.length === 0; step++) {
      await page.evaluate(`window.__wtpZoomOut && window.__wtpZoomOut(1.5)`);
      /* R49 DURATION, DELIBERATE: a MAP SETTLE before a GEOMETRY read. The camera
       * animates, and the probe below measures pin positions - polling for "it
       * changed" would return mid-flight, which is precisely the wrong moment for a
       * geometry assertion. The duration is the settle, not a guess at latency. */
      await page.waitForTimeout(1600);
      reading = (await probe())!;
    }

    if (reading.groups.length === 0) {
      cannotRun(
        "g9",
        "85701: overlapping pins fan out when pressed",
        `no two of the ${reading.visible} visible pins overlap even after zooming out — ` +
          `nothing to fan, so the claim could not be exercised`,
      );
      cannotRun("g9", "85701: dismissing the fan returns every pin", "no collision to dismiss");
    } else {
      /*
       * g13, 2026-08-18 — these two checks are made to RUN.
       *
       * They had settled into permanent `cannotRun`, which is the state this
       * suite is least able to notice: it prints, it is honest, and it proves
       * nothing, run after run. The cause was that the check took
       * `groups[0]` — whichever stack the probe happened to list first — and
       * at 85701 that one sits under the who-governs card, so every run
       * reported "covered by ..." and stopped.
       *
       * A stack is not special. Any member of any stack fans the whole stack,
       * so the fix is to ASK WHICH STACK IS REACHABLE rather than to hope the
       * first one is: every group, and every pin within a group, until one
       * lands on a pin. The overlay is never named or worked around, so this
       * does not rot the day the card moves or a new one appears.
       *
       * Only if no stack anywhere is reachable does it fall back to closing
       * the open card and asking again — the brief's other option, kept as
       * the second rung rather than the first because closing a card is a
       * state change and scanning is not. Which rung ran is printed in the
       * evidence, so a green line always says how it was earned.
       */
      const whatIsAt = async (p: { x: number; y: number }) =>
        (await page.evaluate(
          `(() => {
            const el = document.elementFromPoint(${p.x}, ${p.y});
            if (!el) return "nothing";
            const pin = el.closest(".wtp-pin");
            return pin ? "pin" : (el.className || el.tagName || "unknown").toString().slice(0, 60);
          })()`,
        )) as string;

      type Landing = { group: string[]; at: { x: number; y: number } };
      const findLanding = async (
        r: SpiderProbe,
      ): Promise<{ landing: Landing | null; blockedBy: string[] }> => {
        const blockedBy: string[] = [];
        for (const group of r.groups) {
          for (const key of group) {
            const at = r.boxes[key];
            if (!at) continue;
            const under = await whatIsAt(at);
            if (under === "pin") return { landing: { group, at }, blockedBy };
            blockedBy.push(under);
          }
        }
        return { landing: null, blockedBy };
      };

      let { landing, blockedBy } = await findLanding(reading);
      let via = `a stack clear of every overlay (${reading.groups.length} stack(s) offered)`;

      if (!landing) {
        // Second rung: close whatever card is open and ask again.
        await page.evaluate(
          `(() => {
            document
              .querySelectorAll('.popup-card button[aria-label="Close"]')
              .forEach((b) => b.click());
            return true;
          })()`,
        );
        /* R49 DURATION, DELIBERATE: a MAP SETTLE before a GEOMETRY read. The camera
         * animates, and the probe below measures pin positions - polling for "it
         * changed" would return mid-flight, which is precisely the wrong moment for a
         * geometry assertion. The duration is the settle, not a guess at latency. */
        await page.waitForTimeout(700);
        reading = (await probe())!;
        ({ landing, blockedBy } = await findLanding(reading));
        via = `the open card closed first (${reading.groups.length} stack(s) offered)`;
      }

      if (!landing) {
        const covers = [...new Set(blockedBy)].join(", ") || "no stack had a box";
        cannotRun(
          "g9",
          "85701: overlapping pins fan out when pressed",
          `no stack anywhere is reachable, even with the card closed — covered by: ${covers}`,
        );
        cannotRun(
          "g9",
          "85701: dismissing the fan returns every pin",
          "the fan could not be opened, so there was nothing to dismiss",
        );
      } else {
        const group = landing.group;
        const at = landing.at;
        const before = { ...reading.boxes };
        {
          /*
           * A REAL PRESS, at the stack's own coordinates.
           *
           * Deliberately the mouse rather than an injected hook: the defect
           * being fixed IS pointer interception, so a walk that bypassed the
           * pointer would be testing everything except the thing that broke.
           * Whichever pin is on top receives it, which is fine — any member of
           * a stack fans the whole stack, and "whichever is on top" is exactly
           * what a reader gets.
           */
          await page.mouse.click(at.x, at.y);
          /* R49 DURATION, DELIBERATE: a MAP SETTLE before a GEOMETRY read. The camera
           * animates, and the probe below measures pin positions - polling for "it
           * changed" would return mid-flight, which is precisely the wrong moment for a
           * geometry assertion. The duration is the settle, not a guess at latency. */
          await page.waitForTimeout(900);

          const fannedReading = (await probe())!;
          const separated = (() => {
            const pts = group
              .map((k) => fannedReading.boxes[k])
              .filter(Boolean) as { x: number; y: number }[];
            if (pts.length < 2) return false;
            for (let i = 0; i < pts.length; i++) {
              for (let j = i + 1; j < pts.length; j++) {
                if (Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y) < 28) return false;
              }
            }
            return true;
          })();

          const fanned = check(
            "g9",
            "85701: overlapping pins fan out when pressed",
            fannedReading.fanned.length === group.length && separated,
            `${group.length} pin(s) in the stack; ${fannedReading.fanned.length} fanned; ` +
              `every pair now clears 28px: ${separated}; pressed via ${via}`,
          );

          /*
           * The dismissal check is GATED on the fan having happened.
           *
           * Ungated it passes trivially when nothing ever fanned — 0 still
           * fanned, every pin within 2px of where it started, all true and
           * all meaningless. The first run of this check did exactly that
           * beside its own failing sibling, which is the empty-success shape
           * one line away from the failure it was hiding.
           */
          if (!fanned) {
            cannotRun(
              "g9",
              "85701: dismissing the fan returns every pin",
              "the fan did not open, so a dismissal proves nothing",
            );
          } else {
            // Escape, the explicit control beside the map-press gesture.
            await page.keyboard.press("Escape");
            /* R49 DURATION, DELIBERATE: a MAP SETTLE before a GEOMETRY read. The camera
             * animates, and the probe below measures pin positions - polling for "it
             * changed" would return mid-flight, which is precisely the wrong moment for a
             * geometry assertion. The duration is the settle, not a guess at latency. */
            await page.waitForTimeout(700);
            const returned = (await probe())!;
            const backWhereTheyWere = group.every((k) => {
              const a = before[k];
              const b = returned.boxes[k];
              if (!a || !b) return false;
              return Math.hypot(a.x - b.x, a.y - b.y) < 2;
            });
            check(
              "g9",
              "85701: dismissing the fan returns every pin",
              returned.fanned.length === 0 && backWhereTheyWere,
              `${returned.fanned.length} still fanned; every pin back within 2px: ${backWhereTheyWere}; ` +
                `pressed via ${via}`,
            );
          }
        }
      }
    }
  }
  await page.context().close();
}

// ═══════════════════════════════════════════════════════════════════════════
// Section G10 (2026-08-17) — the two data rows this session shipped, asked of
// production rather than of the tree they were written in.
// ═══════════════════════════════════════════════════════════════════════════

section("G10. Online meetings, and agenda attribution");

/**
 * D18 — a meeting held online is REACHABLE and is NEVER A PIN.
 *
 * The defect these pin: twelve real public meetings were dropped at normalize
 * because the map could not carry them, and the drop was counted honestly in
 * a log nobody reads. What has to stay true is a conjunction, and it is
 * checked as one — a build that kept them and pinned them would be worse than
 * the drop, because a pin on a building nobody is going to sends a reader
 * across town.
 *
 * Tucson, where the twelve live: three Pima County Board of Supervisors
 * sittings, six TUSD committee meetings, three Pima Community College Finance
 * and Audit Committee meetings. The floor is 1 rather than 12 on purpose —
 * these are real calendars and a body may simply not meet online this
 * fortnight, so pinning the exact number would fail for a reason that is not
 * a regression. Zero is the regression.
 */
{
  const payload = await getJson<{
    meetings: {
      id: string;
      location: unknown;
      online?: { label: string; joinUrl: string | null };
    }[];
  }>("/api/meetings?lat=32.2226&lng=-110.9747&radiusKm=25");

  if (!payload) {
    cannotRun("g10", "85701: meetings held online are reachable", "/api/meetings did not answer");
  } else {
    const online = payload.meetings.filter((m) => m.location === null);
    check(
      "g10",
      "85701: meetings held online are reachable at all",
      online.length > 0,
      `${online.length} of ${payload.meetings.length} meetings have no physical place; ` +
        "before D18 every one of them was dropped at normalize",
    );

    // Absent is not empty, one layer up: a null location with no online
    // block is a meeting nobody can attend and nothing may serve one.
    const mute = online.filter((m) => !m.online?.label);
    check(
      "g10",
      "85701: every online meeting says how it is held",
      online.length > 0 && mute.length === 0,
      mute.length === 0
        ? `all ${online.length} carry the body's published location string`
        : `${mute.length} carry no label: ${mute.map((m) => m.id).join(", ")}`,
    );

    // And the other half of the conjunction: no coordinates were invented for
    // them anywhere on the way through.
    const placed = online.filter(
      (m) => m.location !== null && m.location !== undefined,
    );
    check(
      "g10",
      "85701: no online meeting was given a place",
      placed.length === 0,
      placed.length === 0
        ? "none of them carry a location"
        : `${placed.length} were placed: ${placed.map((m) => m.id).join(", ")}`,
    );
  }
}

/**
 * D19 — the agenda attribution reaches production, and never names the host.
 *
 * The rule is enforced at the snapshot write boundary, which means a build
 * that broke it could not have been written; this asks the SERVED payload
 * anyway, because the boundary and the wire are two different places and this
 * suite exists to catch the second one dying quietly.
 *
 * The unresolved rows are the interesting half: seven distinct special
 * districts sitting inside a county feed that exposes four bodies. Each one
 * must carry its published heading and NO division — attributing them to Pima
 * County is the exact misattribution D19 exists to prevent.
 */
{
  const payload = await getJson<{
    meetings: {
      id: string;
      ocdId: string | null;
      actingBodies?: {
        attribution: string;
        bodyId: string | null;
        ocdId: string | null;
        evidence: string;
      }[];
    }[];
  }>("/api/meetings?lat=32.2226&lng=-110.9747&radiusKm=25");

  if (!payload) {
    cannotRun("g10", "85701: agenda attribution is served", "/api/meetings did not answer");
  } else {
    const withRows = payload.meetings.filter((m) => m.actingBodies !== undefined);
    const rows = withRows.flatMap((m) => m.actingBodies ?? []);
    check(
      "g10",
      "85701: agenda attribution reaches the served payload",
      rows.length > 0,
      `${withRows.length} of ${payload.meetings.length} meetings carry acting-body rows, ` +
        `${rows.length} row(s) in total`,
    );

    const unresolved = rows.filter((r) => r.attribution === "UNRESOLVED");
    const smuggled = unresolved.filter((r) => r.bodyId !== null || r.ocdId !== null);
    check(
      "g10",
      "85701: an unresolved heading is attributed to NOTHING, never to the host",
      rows.length > 0 && smuggled.length === 0,
      smuggled.length === 0
        ? `${unresolved.length} unresolved segment(s), none carrying a body or a division`
        : `${smuggled.length} attributed: ${smuggled.map((r) => r.evidence).join(", ")}`,
    );

    const mute = rows.filter((r) => !r.evidence);
    check(
      "g10",
      "85701: every acting-body row quotes the heading it was read from",
      rows.length > 0 && mute.length === 0,
      mute.length === 0
        ? "every row can be checked against the published agenda"
        : `${mute.length} row(s) assert an attribution with no evidence`,
    );

    // Typography is not a government. "PAGE BREAK" opened a segment on the
    // first live run and cut an item off the district actually acting.
    const typography = rows.filter(
      (r) => /^page\s*break$/i.test(r.evidence.trim()) || !/\p{L}/u.test(r.evidence),
    );
    check(
      "g10",
      "85701: no acting body was read off a layout marker",
      typography.length === 0,
      typography.length === 0
        ? "no PAGE BREAK, rule or signature line opened a segment"
        : `${typography.length}: ${typography.map((r) => JSON.stringify(r.evidence)).join(", ")}`,
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// H. g12 — the interface consolidates, and the ask box gets its brain.
//
// Four rules and one ruling, each with the check its own spec demands.
//
// * **4e** wants a count of RENDERED INSTANCES, not the presence of one
//   selector — "exactly one, in the expected place, in all four states, at
//   four zips and both viewports". The four states are the four the rule
//   enumerates: WGH open, sidebar open, both closed, and a battlecard open.
// * **4f** wants the rail's top on screen and its bottom reachable at
//   390×844 with the longest content, and no dead space below the last row.
// * **The matcher ruling** wants five questions asked against production: the
//   weather question, a strong-keyword question, an exact name, a
//   classifier-routed question, and an honest refusal.
//
// The five questions are asked by TYPING and reading what renders. None of
// them submits a reaction and none writes a feedback row; an ask DOES write
// one identifier-free QUESTION_ASKED row per submission, which is counted and
// named in the probe accounting below like every other row this walk creates.
// ═══════════════════════════════════════════════════════════════════════════

section("H. The one cluster, the bounded rail, and the matcher (g12)");

/** Count what the page actually painted, not what the code intended. */
async function clusterCensus(page: Page) {
  return page.evaluate(() => ({
    clusters: document.querySelectorAll("[data-pill-cluster]").length,
    placement:
      document
        .querySelector("[data-pill-cluster]")
        ?.getAttribute("data-pill-cluster") ?? null,
    inputs: document.querySelectorAll("[data-ask-box]").length,
    pills: document.querySelectorAll("[data-ask-pill]").length,
    pillText:
      (document.querySelector("[data-ask-pill] span") as HTMLElement | null)
        ?.innerText ?? "",
    ballotDoors: document.querySelectorAll(
      ".sidebar-ballot-entry, .coverage-notice-ballot, .ballot-pill-main",
    ).length,
  }));
}

for (const { zip } of FOUR) {
  for (const wide of [false, true]) {
    const label = wide ? "desktop" : "390px";
    const page = wide ? await openWideAt(browser, zip) : await openAt(browser, zip);
    try {
      /*
       * STATE 1 — WGH open.
       *
       * **THE CARD NO LONGER SHOWS ITSELF (WGH-8, 2026-08-25).** This comment
       * used to read "the card shows itself once per resolved area", and that
       * was true: arriving at a zip auto-expanded it. The rule is now
       * that exactly ONE of the rail and the card is up, and the annotated
       * `08-53-15` specifies which one arrival gets — the rail, full height,
       * with Who Governs Here sitting beneath it as its pill.
       *
       * So this state has to be REACHED rather than assumed. The walk clicks
       * the pill, which is also the reader's own route to it (RULING 153).
       *
       * The checks below are unchanged and still assert exactly what they did:
       * one cluster, at the top of WGH, one ballot door, a concrete example on
       * the Ask pill. What changed is the two lines that get there.
       */
      const wghPill = page.locator(".notice-fab").first();
      if (await wghPill.isVisible().catch(() => false)) {
        await wghPill.click();
        await until(page, async () => (await page.locator(".coverage-notice").count()) > 0, 8_000);
      }
      const wgh = await clusterCensus(page);
      check(
        "g12",
        `4e: exactly one pill cluster at ${zip} ${label}, WGH open`,
        wgh.clusters === 1,
        `${wgh.clusters} rendered, placement=${wgh.placement}`,
      );
      check(
        "g12",
        `4e: the cluster is at the top of WGH at ${zip} ${label}`,
        wgh.placement === "wgh",
        `placement=${wgh.placement}`,
      );
      check(
        "g12",
        `4b: exactly one ballot door on screen at ${zip} ${label}`,
        wgh.ballotDoors === 1,
        `${wgh.ballotDoors} doors`,
      );
      // F01 8.3 (2026-08-19) retired "pothole" as the pill’s lead example.
      // The CHECK is G07’s and is unchanged: the pill must
      // still name a concrete example rather than a bare verb. The examples it
      // reads come from ASK_PILL_EXAMPLES so the walk and the label cannot
      // drift apart the way a hard-coded /pothole/ just did.
      check(
        "g12",
        `G07: the Ask pill names a concrete example at ${zip} ${label}`,
        ASK_PILL_EXAMPLES.some((ex) =>
          new RegExp(ex, "i").test(wgh.pillText ?? ""),
        ),
        `label=${JSON.stringify(wgh.pillText)} examples=${ASK_PILL_EXAMPLES.join("|")}`,
      );

      /*
       * STATE 2 — sidebar on screen. 4c makes this close WGH, which is what
       * makes 4e's placement unambiguous rather than a preference.
       *
       * The two viewports get there DIFFERENTLY and the first cut of this
       * check did not know it: at 390px the rail is a drawer behind the
       * hamburger, but at desktop the rail is already on screen and the
       * hamburger is hidden by CSS — `locator.click` on it threw "Element is
       * not visible" and took the whole run down. At desktop the thing that
       * has to happen is the OTHER half of 4c: minimize the who-governs card,
       * and the cluster moves to the rail on its own.
       */
      const toggle = page.locator(".sidebar-toggle").first();
      if (await toggle.isVisible()) {
        await toggle.click();
      } else {
        await page
          .locator(".coverage-notice button[aria-label^='Minimize']")
          .first()
          .click();
      }
      // R49: the who-governs card is GONE, which is what minimizing it means
      // and what the very next check asserts.
      await until(page, async () => (await page.locator(".coverage-notice").count()) === 0, 8_000);
      const rail = await clusterCensus(page);
      check(
        "g12",
        `4e: exactly one pill cluster at ${zip} ${label}, sidebar open`,
        rail.clusters === 1,
        `${rail.clusters} rendered, placement=${rail.placement}`,
      );
      check(
        "g12",
        `4c: opening the rail closed the who-governs card at ${zip} ${label}`,
        (await page.locator(".coverage-notice").count()) === 0,
      );

      // M119 — one input, and it is inside the cluster's expansion.
      if ((await page.locator("[data-ask-panel]").count()) === 0) {
        await page.locator("[data-ask-pill]").first().click();
        // R49: the ask panel is open, rather than 500ms have passed.
        await untilPresent(page, "[data-ask-panel]", 8_000);
      }
      const opened = await clusterCensus(page);
      check(
        "g12",
        `M119: exactly one text input in the shell at ${zip} ${label}`,
        opened.inputs === 1,
        `${opened.inputs} inputs`,
      );

      // 4f — the rail is a card, bounded, with both ends reachable and the
      // longest content it can hold. The digest is the longest content.
      if (!wide) {
        const input = page.locator("[data-ask-box]").first();
        await input.fill("whats going on where i live");
        await page
          .locator("[data-ask-panel] button", { hasText: "Ask" })
          .first()
          .click();
        /* R49 DURATION, DELIBERATE: the geometry measured below is of the rail
         * holding its LONGEST content, and the answer streams in. Polling for
         * "the answer arrived" would measure the rail mid-growth, which is the
         * wrong moment for a bounds check. */
        await page.waitForTimeout(4500);
        /*
         * MEASURE THE RIGHT THING. The first cut of this computed the gap
         * from the scroller's CURRENT scroll position and reported −850px —
         * a number with no meaning that nonetheless passed a `<= 24` test,
         * which is precisely the measurement that can pass while wrong.
         *
         * Dead space is only a question at the END of the scroll, so the
         * scroller is driven there first and the gap is read after. A
         * positive result is empty space below the last row with nothing
         * left to scroll to; that is what 4f forbids.
         */
        const geometry = await page.evaluate(() => {
          const rail = document.querySelector(".sidebar") as HTMLElement | null;
          const scroll = rail?.querySelector(
            ".sidebar-scroll",
          ) as HTMLElement | null;
          if (!rail || !scroll) return null;
          scroll.scrollTop = scroll.scrollHeight;
          const r = rail.getBoundingClientRect();
          const s = scroll.getBoundingClientRect();
          const last = scroll.lastElementChild as HTMLElement | null;
          return {
            top: Math.round(r.top),
            bottom: Math.round(r.bottom),
            vh: window.innerHeight,
            scrollable: scroll.scrollHeight > scroll.clientHeight + 1,
            dead: last
              ? Math.round(s.bottom - last.getBoundingClientRect().bottom)
              : 0,
          };
        });
        check(
          "g12",
          `4f: the rail's top is on screen at ${zip} 390px, longest content`,
          geometry !== null && geometry.top >= 0,
          geometry ? `top=${geometry.top}` : "the rail was not found",
        );
        check(
          "g12",
          `4f: the rail's bottom is reachable at ${zip} 390px, longest content`,
          geometry !== null && geometry.bottom <= geometry.vh,
          geometry ? `bottom=${geometry.bottom} vh=${geometry.vh}` : "",
        );
        check(
          "g12",
          `4f: no dead space below the rail's last row at ${zip} 390px`,
          geometry !== null && geometry.dead <= 24,
          geometry
            ? `${geometry.dead}px below the last row, scrolled to the end (scrollable=${geometry.scrollable})`
            : "",
        );

        /*
         * A02 renders, with its denominators. Stated N equals rendered rows.
         *
         * WAITED FOR, not read on arrival (g14, 2026-08-18). This read the DOM
         * once, at whatever moment the preceding geometry checks happened to
         * finish, with no wait of its own — so whether the digest was there
         * depended entirely on how long those checks had taken. It passed the
         * whole suite on one run and failed at 85701 and 85641 on the next,
         * same build, twenty minutes apart, printing "no digest rendered"
         * about a digest that renders.
         *
         * Third member of the same class this session, after the map's pin
         * floor (R47) and the ask box's refusal (A07): a fixed or accidental
         * wait plus a single read cannot tell GONE from NOT YET, and reports
         * the first when it means the second.
         */
        let digest = "";
        {
          const deadline = Date.now() + 20_000;
          while (Date.now() < deadline) {
            digest = await page.evaluate(() => {
              const d = document.querySelector("[data-ask-digest]");
              return d ? (d as HTMLElement).innerText : "";
            });
            if (digest.trim().length > 0) break;
            // R49 POLL INTERVAL: how often the question is asked, not how long the
            // answer is assumed to take. The loop exits on the OUTCOME.
            await page.waitForTimeout(250);
          }
        }
        check(
          "g12",
          `A02: the digest renders its three blocks at ${zip}`,
          /Coming up/i.test(digest) &&
            /Recently decided/i.test(digest) &&
            /Who represents you/i.test(digest),
          digest ? "" : "no digest rendered",
        );
        check(
          "g12",
          `A02: every digest block states a count or a named gap at ${zip}`,
          /Showing \d+ of \d+\./.test(digest) || /we hold nothing|no meeting we hold|have not sourced/i.test(digest),
        );

        // ── The matcher ruling's five questions, against production ────────
        /*
         * R47's lesson, applied to the ask box (g14, 2026-08-18).
         *
         * This used to sleep a fixed 4500 ms and read ONCE. The classifier is
         * a network round trip whose latency varies a lot — measured against
         * production at 3.1s, 3.2s, 3.2s and 8.4s across the four zips — so a
         * single read at 4.5s catches whichever zip happened to be slow that
         * run and reports a WORKING refusal as a NAMED REGRESSION. It did
         * exactly that, at 85701 and 07866, while a probe minutes later found
         * those two fast and 85641 slow instead. The behaviour never varied;
         * only which zip lost the race did.
         *
         * So it waits for an OUTCOME rather than for a duration: poll until
         * the panel says something — a refusal or an answer — and only then
         * read. This does NOT wait until the check passes. A refusal and an
         * answer are both outcomes and the caller still decides which was
         * required; if neither arrives inside the ceiling, the read happens
         * anyway and the check fails on the truth.
         */
        /*
         * EVERY QUESTION GETS A FRESH PAGE (g14, 2026-08-18).
         *
         * Five questions were asked in a row on ONE page, and the previous
         * answer is still on screen when the next is submitted. Two weaker
         * fixes were tried first and both failed against production, which is
         * why this one is worth its cost:
         *
         *   - "wait until an outcome is present" latched onto the PREVIOUS
         *     question's outcome and read while the panel was being cleared,
         *     printing `settled in 2089ms` about a question a fresh-page probe
         *     measured refusing at 8.2s.
         *   - "wait until the panel TEXT changed and an outcome is present"
         *     failed too, and for an obvious reason once seen: the typed
         *     question is INSIDE the panel, so the text changes the instant
         *     the input is filled, while the old answer is still rendered.
         *     That produced `settled in 262ms`.
         *
         * There is no reliable way to tell a stale outcome from a new one on
         * a page that already has one, so the page stops already having one.
         * This is the repo's own standing note about the per-zip loop — its
         * page has been clicked through by a dozen checks, so a bare
         * querySelector finds whatever an earlier one left behind — applied
         * rather than worked around. It costs one reload per question.
         */
        const ask = async (question: string) => {
          await page.reload({ waitUntil: "domcontentloaded", timeout: 90_000 });
          // R49: the reloaded app has rendered, rather than 6s have passed.
          await appSettled(page);
          if ((await page.locator("[data-ask-panel]").count()) === 0) {
            await page.locator("[data-ask-pill]").first().click();
            // R49: the ask panel is open, rather than 600ms have passed.
            await untilPresent(page, "[data-ask-panel]", 8_000);
          }
          const input = page.locator("[data-ask-box]").first();

          await input.fill(question);
          await page
            .locator("[data-ask-panel] button", { hasText: "Ask" })
            .first()
            .click();

          /*
           * The ceiling is 30s and the WAIT ITSELF is reported, because a
           * failure here has two very different causes and the evidence line
           * has to say which. "Waited the whole ceiling and nothing rendered"
           * is a slow or dead classifier; "settled in 3s and said neither" is
           * a behaviour change. Walk 3 printed `answered=false refusal=false`
           * with no way to tell them apart, which is the same ambiguity this
           * whole class keeps producing one level up.
           */
          const started = Date.now();
          let settledAt: number | null = null;
          while (Date.now() - started < 30_000) {
            const settled = await page.evaluate(() => {
              const panel = document.querySelector(
                "[data-ask-panel]",
              ) as HTMLElement | null;
              return (
                Boolean(document.querySelector("[data-ask-refusal]")) ||
                Boolean(document.querySelector("[data-ask-destination]")) ||
                /the answer/i.test(panel?.innerText ?? "")
              );
            });
            if (settled) {
              settledAt = Date.now() - started;
              break;
            }
            // R49 POLL INTERVAL: how often the question is asked, not how long the
            // answer is assumed to take. The loop exits on the OUTCOME.
            await page.waitForTimeout(250);
          }
          const waited =
            settledAt === null
              ? `TIMED OUT after ${Date.now() - started}ms with nothing rendered`
              : `settled in ${settledAt}ms`;

          const read = await page.evaluate(() => ({
            refusal: Boolean(document.querySelector("[data-ask-refusal]")),
            destination:
              document
                .querySelector("[data-ask-destination]")
                ?.getAttribute("data-ask-destination") ?? null,
            /*
             * CASE-INSENSITIVE, and the reason is worth a line: the answer's
             * eyebrow is `t-eyebrow`, which uppercases in CSS, and
             * `innerText` returns the RENDERED text. A case-sensitive
             * /The answer/ found nothing and reported two real, working
             * answers as failures on the first production run.
             */
            answered: /the answer/i.test(
              (document.querySelector("[data-ask-panel]") as HTMLElement)
                ?.innerText ?? "",
            ),
          }));

          return { ...read, waited };
        };

        // 1. THE PROVING CASE. It may route somewhere honest — the classifier
        //    is allowed to redirect it — but it must never be answered with a
        //    lecture on who runs elections off the single word "election".
        const weather = await ask("what will the weather be like on election day");
        check(
          "g12",
          `the matcher ruling: the weather question is not keyword-routed at ${zip}`,
          weather.refusal || !weather.answered,
          `refusal=${weather.refusal} answered=${weather.answered} destination=${weather.destination} — ${weather.waited}`,
        );

        // 2. A STRONG keyword question — two distinct hits — still answers.
        const strong = await ask("there is a pothole on my street");
        check(
          "g12",
          `the matcher ruling: a strong keyword question answers at ${zip}`,
          strong.answered,
          `answered=${strong.answered} — ${strong.waited}`,
        );

        // 3. AN EXACT NAME navigates rather than asking. The name is read off
        //    the page's own autocomplete, so the check cannot go stale
        //    against a body this zip does not have.
        await input.fill("");
        // R49: the autocomplete has cleared, then has rows for the new text.
        await until(page, async () => (await page.locator(".search-ac-item").count()) === 0, 6_000);
        // This corpus has fourteen meetings with the same displayed title.
        // The exact-name contract refuses that ambiguity; use its unique body.
        const exactBody = zip === "85701" ? "Board of Supervisors" : null;
        await input.fill(exactBody ?? "Board");
        await untilPresent(page, ".search-ac-item", 8_000);
        const offered = await page.evaluate(
          (bodyName) => {
            const rows = Array.from(document.querySelectorAll(".search-ac-item"));
            const row = bodyName ? rows.find((entry) =>
              entry.querySelector(".search-ac-type")?.textContent?.trim() === "Body" &&
              entry.querySelector(".search-ac-name")?.textContent?.trim() === bodyName
            ) : rows[0];
            return (row?.querySelector(".search-ac-name") as HTMLElement | null)?.innerText ?? "";
          },
          exactBody,
        );
        if (offered) {
          await input.fill(offered);
          await page
            .locator("[data-ask-panel] button", { hasText: "Ask" })
            .first()
            .click();
          /* R49 DURATION, DELIBERATE: this check asserts an ABSENCE — that an
           * exact name navigates and asks nothing, so neither a refusal nor a
           * digest renders. Polling for a thing that must not appear would
           * return instantly and prove nothing; outlasting it is the assertion. */
          await page.waitForTimeout(2500);
          const named = await page.evaluate(() => ({
            refusal: Boolean(document.querySelector("[data-ask-refusal]")),
            digest: Boolean(document.querySelector("[data-ask-digest]")),
            bodyOpened: Boolean(document.querySelector(".account-modal")),
          }));
          check(
            "g12",
            `the matcher ruling: an exact name navigates and asks nothing at ${zip}`,
            !named.refusal && !named.digest && (!exactBody || named.bodyOpened),
            `offered=${JSON.stringify(offered)}`,
          );
        } else {
          cannotRun(
            "g12",
            `the matcher ruling: an exact name navigates and asks nothing at ${zip}`,
            "the autocomplete offered no unambiguous name for this scenario",
          );
        }

        // 4. A CLASSIFIER-ROUTED question: one keyword hit, which the keyword
        //    layer now declines. Whatever comes back must be honest — either
        //    the classifier found the drawer, or the refusal is stated.
        /*
         * A DESTINATION COUNTS, and leaving it out is why this printed a
         * NAMED REGRESSION at 85641 across three consecutive walks (g14,
         * 2026-08-18).
         *
         * The condition tested `answered || refusal` while the comment above
         * it names THREE honest outcomes — "the classifier found the drawer,
         * or the refusal is stated". Finding the drawer IS a destination, and
         * check 1 fifteen lines up already treats `destination` as a first
         * class outcome. So a zip where the classifier routes "my water bill"
         * somewhere real failed a check whose own prose says it should pass.
         *
         * CORRECTED, because the evidence first cited for this clause did not
         * survive the next fix. It was added after 85641 failed three walks
         * running and printed `destination=meetings` — which looked like a
         * zip where the classifier routes rather than refuses. Once every
         * question got its own FRESH PAGE, that destination stopped appearing
         * at all: it was the stale panel from the previous question, not a
         * routing decision. On fresh pages the weak match answers or refuses
         * at all four zips and this branch is not currently exercised.
         *
         * It stays anyway, on the check's own documented intent rather than
         * on that reading — the comment above names three honest outcomes and
         * check 1 already treats `destination` as one, so a zip that genuinely
         * routes should pass. The destination is printed either way, so
         * nobody has to take this paragraph's word for it.
         */
        const classified = await ask("my water bill");
        check(
          "g12",
          `the matcher ruling: a weak match is answered by the classifier or refused honestly at ${zip}`,
          classified.answered || classified.refusal || classified.destination !== null,
          `answered=${classified.answered} refusal=${classified.refusal} ` +
            `destination=${classified.destination} — ${classified.waited}`,
        );

        // 5. AN HONEST REFUSAL, with the destinations offered.
        const nonsense = await ask("qwertyuiop asdfghjkl zxcvbnm");
        check(
          "g12",
          `A07: an unroutable question refuses and offers the destinations at ${zip}`,
          nonsense.refusal && !nonsense.answered,
          `refusal=${nonsense.refusal} answered=${nonsense.answered} — ${nonsense.waited}`,
        );
      }
    } finally {
      await page.context().close();
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Section M136 (g13, 2026-08-18) — the body battlecard's seven sections.
// ═══════════════════════════════════════════════════════════════════════════

section("M136. Body battlecards reach person-card depth (g13)");

{
  /*
   * The row's own done-test, verbatim: Pima (county), Tucson (municipal) and
   * Tucson Unified (school) each render EVERY applicable section, with either
   * content or an honest line.
   *
   * The assertion is deliberately on the SET of section headers rather than on
   * their contents. A card that hid its empty sections would still look
   * plausible section-by-section while quietly making a well-covered body's
   * card taller than a thin one's — the layout asymmetry that the
   * equal-effort rule exists to catch. So the check is: all six headers, on
   * all three bodies, whatever is inside them.
   *
   * Its own page per body, with its own `openAt` — a page a dozen earlier
   * checks have clicked through would let an already-open card answer for the
   * one this check meant to open.
   */
  const SECTIONS = [
    "What this body does",
    "Who sits on it",
    "Meetings",
    "Contact",
    "Where it governs",
    "Sources",
  ];

  const BODIES = [
    { label: "Pima", zip: "85701", what: "county" },
    { label: "Tucson", zip: "85701", what: "municipal" },
    { label: "Tucson Unified", zip: "85701", what: "school" },
  ];

  for (const body of BODIES) {
    const page = await openAt(browser, body.zip);
    try {
      /*
       * WGH-8 (2026-08-25): the card no longer opens itself on arrival, so the
       * row this looks for is behind the pill. Clicked the way a reader would.
       */
      const pill = page.locator(".notice-fab").first();
      if (await pill.isVisible().catch(() => false)) {
        await pill.click();
        await until(page, async () => (await page.locator(".coverage-notice").count()) > 0, 8_000);
      }
      /*
       * **WGH-18 (2026-08-30) — SCOPED TO THE GOVERNING LIST.**
       *
       * This was `.coverage-notice button:has-text(...)`, which was unambiguous
       * only because the panel had one button list. The See-the-rest disclosure
       * added a second — collapsed, so its rows are NOT VISIBLE — and this
       * selector started resolving to "Pima County/Tucson Women's Commission"
       * and timing out on a click that could never land.
       *
       * The governing rows have carried `data-governing-row` since ITEM 1a,
       * added for exactly this reason: a walk that finds a row by its text and
       * its container is a walk that breaks the next time the container grows a
       * second list. It is scoped now.
       */
const row = page
        .locator(`.coverage-notice [data-governing-row] button:has-text("${body.label}")`)
        .first();
      if ((await row.count()) === 0) {
        /*
         * **R58: BOTH checks declare, not just the first.** This block owns two
         * identities and declared only one before `continue`, so the second
         * reported NOTHING — which R58 catches and calls a silent check. The
         * shape was always here; WGH-8 exposed it by making the row genuinely
         * absent for the first time.
         */
        for (const identity of [
          `M136: ${body.label} (${body.what}) renders every section`,
          `M136: ${body.label}'s card renders no internal identifier`,
        ]) {
          cannotRun("g13", identity, `no who-governs row named "${body.label}" at ${body.zip}`);
        }
        continue;
      }
      await row.click();
      // R49: the card is open, rather than 1.2s have passed.
      await untilPresent(page, ".account-modal", 10_000);

      const card = page.locator(".account-modal").first();
      if ((await card.count()) === 0) {
        // R58: both identities, for the reason above.
        for (const identity of [
          `M136: ${body.label} (${body.what}) renders every section`,
          `M136: ${body.label}'s card renders no internal identifier`,
        ]) {
          cannotRun("g13", identity, "the row opened no battlecard");
        }
        continue;
      }
      const text = await card.innerText();

      const missing = SECTIONS.filter((s) => !text.includes(s));
      check(
        "g13",
        `M136: ${body.label} (${body.what}) renders every section`,
        missing.length === 0,
        missing.length === 0
          ? `all ${SECTIONS.length} sections present`
          : `missing: ${missing.join(", ")}`,
      );

      // An identifier must never reach a reader. The section grammar puts the
      // division in front of them for the first time, so this is where an
      // OCD-ID would surface if one ever leaked into `divisionLabel`.
      check(
        "g13",
        `M136: ${body.label}'s card renders no internal identifier`,
        !/ocd-division\//.test(text) && !/school_district:/.test(text),
        (text.match(/ocd-division\/[^\s]*|school_district:[^\s]*/) ?? ["clean"])[0],
      );
    } finally {
      await page.context().close();
    }
  }
}

/* ── g15's M135: an autocomplete row opens a card ───────────────────────── */

/**
 * THE CHECK g15 CORRECTLY WITHHELD, appended now that its code is deployed.
 *
 * g15 converted the ask panel's autocomplete rows to M135's rule — a row opens
 * a card — and deliberately added no walk check for it, because nothing from
 * that session had reached production and a check against undeployed code
 * reads as a NAMED REGRESSION against a working build. That was the right
 * call and it left a stated debt. Production has served the fix since
 * 714abb0 (2026-08-18, g16), so the debt is paid here.
 *
 * WHAT IS ASSERTED, and why it is not "every body row opens a card": a body
 * row opens a card only when its body resolves DISTINCTLY — several bodies
 * share one division, `CoveredBody.name` is null on derived rows, and g15's
 * handler falls back to flying rather than opening one body's card from
 * another body's row. So the honest assertion is that the conversion is live
 * at all: among the body rows this zip offers, at least one opens the large
 * card. Before g15, the answer was none, at every zip. The number tried and
 * the number that opened are both printed, so a drop from many to one is
 * visible even while the check stays green.
 *
 * Its own fresh page per zip, and every query scoped to what this section
 * opened — the per-zip loop's page has been clicked through by a dozen checks
 * and a bare selector finds whatever they left behind.
 */
const AC_ROW = ".search-ac-item";

/**
 * Open the rail, type into the ask box, and wait for the autocomplete to HAVE
 * rows (R49 — an outcome, not a duration).
 *
 * THE TWO STEPS ARE NOT OPTIONAL AND THE FIRST DRAFT SKIPPED THEM. The ask
 * panel is not on the page at rest: the who-governs card is, and the rail sits
 * behind it. A check that looked straight for `[data-ask-box]` reported COULD
 * NOT RUN at both zips — honest, and useless. Minimize, then open the ask
 * pill, which is what M119 and A02 above already do.
 */
async function offerRows(page: Page, typed: string): Promise<number> {
  const minimize = page.locator(".coverage-notice button[aria-label^='Minimize']").first();
  if ((await minimize.count()) > 0) {
    await minimize.click();
    await page.locator(".coverage-notice").waitFor({ state: "detached", timeout: 6000 }).catch(() => {});
  }
  if ((await page.locator("[data-ask-panel]").count()) === 0) {
    await page.locator("[data-ask-pill]").first().click().catch(() => {});
    await page
      .locator("[data-ask-panel]")
      .first()
      .waitFor({ state: "visible", timeout: 6000 })
      .catch(() => {});
  }

  const input = page.locator("[data-ask-box]").first();
  if ((await input.count()) === 0) return -1;
  await input.fill(typed);
  await page
    .locator(AC_ROW)
    .first()
    .waitFor({ state: "visible", timeout: 8000 })
    .catch(() => {});
  return page.locator(AC_ROW).count();
}

for (const zip of ["85701", "85641"]) {
  const name = `M135: an autocomplete body row opens a card at ${zip}`;
  /*
   * A FRESH PAGE PER ATTEMPT, not a loop inside one page: picking a row calls
   * `dismissSidebar()`, which at phone width takes the ask panel away with it,
   * so a second attempt in the same page would be measuring a panel that is no
   * longer there and would read as a failure of the conversion.
   */
  let offered = -1;
  let tried = 0;
  let opened = 0;
  let firstOpened = "";
  let why = "";

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const page = await openAt(browser, zip);
    try {
      const count = await offerRows(page, "a");
      if (count === -1) {
        why = "no ask box";
        break;
      }
      const bodyRows = page.locator(AC_ROW, {
        has: page.locator(".search-ac-type", { hasText: /^Body$/ }),
      });
      offered = await bodyRows.count();
      if (offered === 0) {
        why = `the autocomplete offered no body row for "a" at this zip (${count} row(s) of other kinds)`;
        break;
      }
      if (attempt >= offered) break;

      const row = bodyRows.nth(attempt);
      const label = (await row.locator(".search-ac-name").innerText()).trim();
      tried += 1;
      await row.click();
      const card = page.locator(".account-modal").first();
      const cardOpened = await card
        .waitFor({ state: "visible", timeout: 6000 })
        .then(() => true)
        .catch(() => false);
      if (cardOpened) {
        opened += 1;
        if (!firstOpened) firstOpened = label;
        break;
      }
    } finally {
      await page.context().close();
    }
  }

  if (tried === 0) cannotRun("g15", name, why || "no body row could be clicked");
  else
    check(
      "g15",
      name,
      opened > 0,
      `${offered} body row(s) offered, ${tried} clicked, ${opened} opened the large card` +
        (firstOpened ? ` (first: ${JSON.stringify(firstOpened)})` : ""),
    );
}


/* ═══════════════════════════════════════════════════════════════════════
 * g21 — the last queue session. Four claims, appended per the standing rule.
 *
 * The suite only grows: a win shipped in one session and broken in the next
 * dies silently unless something owns it once the session ends.
 * ═══════════════════════════════════════════════════════════════════════ */

await (async function g21Checks() {
  console.log("\n── g21: voting locations, the Kearsarge towns, the badge, the comparison ──");

  // ── B19 — where a reader can actually vote ────────────────────────────
  //
  // Asserted through the ROUTE rather than the page, because the claim is
  // about the answer: Pima runs vote centers and the card has to say so.
  try {
    const res = await fetch(`${BASE}/api/voting-sites`, {
      method: "POST",
      headers: { "content-type": "application/json", ...RUN_HEADERS },
      body: JSON.stringify({ address: "240 N Stone Avenue, Tucson, AZ 85701" }),
    });
    if (!res.ok) {
      cannotRun("g21", "B19: a Tucson address gets Pima's vote centers", `HTTP ${res.status}`);
    } else {
      const answer = (await res.json()) as {
        jurisdictions: {
          name: string;
          model: string;
          sites: unknown[];
          narrowing: { kind: string };
        }[];
      };
      const pima = answer.jurisdictions.find((j) => /Pima/.test(j.name));
      check(
        "g21",
        "B19: a Tucson address gets Pima's vote centers, and the model is VOTE_CENTER",
        Boolean(pima) && pima!.model === "VOTE_CENTER" && pima!.sites.length >= 100,
        pima
          ? `${pima.name}: ${pima.sites.length} site(s), model ${pima.model}, narrowing ${pima.narrowing.kind}`
          : "no Pima jurisdiction in the answer",
      );
      // B16's whole point: a vote-center county is NOT_NEEDED, never a gap.
      check(
        "g21",
        "B16: a vote-center county narrows to NOT_NEEDED, never to a failure",
        pima?.narrowing.kind === "NOT_NEEDED",
        `narrowing = ${pima?.narrowing.kind ?? "(absent)"}`,
      );
    }
  } catch (error) {
    cannotRun("g21", "B19: a Tucson address gets Pima's vote centers", (error as Error).message.slice(0, 90));
  }

  // A walled jurisdiction renders its rungs, never an emptiness. This is the
  // transparency mandate's own assertion and it must survive a refactor.
  try {
    const res = await fetch(`${BASE}/api/voting-sites`, {
      method: "POST",
      headers: { "content-type": "application/json", ...RUN_HEADERS },
      body: JSON.stringify({ address: "937 Route 103, Newbury, NH 03255" }),
    });
    if (!res.ok) {
      cannotRun("g21", "B19: a walled jurisdiction renders its rungs", `HTTP ${res.status}`);
    } else {
      const answer = (await res.json()) as {
        jurisdictions: { name: string; refusal: { rungs: unknown[] } | null }[];
      };
      const withRungs = answer.jurisdictions.filter((j) => (j.refusal?.rungs.length ?? 0) > 0);
      const rungs = withRungs.reduce((n, j) => n + j.refusal!.rungs.length, 0);
      check(
        "g21",
        "B19: a walled jurisdiction renders its RUNGS, never an emptiness",
        withRungs.length > 0 && rungs >= 10,
        `${withRungs.length} jurisdiction(s) carrying ${rungs} recorded rung(s)`,
      );
    }
  } catch (error) {
    cannotRun("g21", "B19: a walled jurisdiction renders its rungs", (error as Error).message.slice(0, 90));
  }

  // ── M123 — the Kearsarge towns, and M81's division set ────────────────
  try {
    const res = await fetch(
      `${BASE}/api/meetings?lat=43.3217&lng=-72.0371&zip=03255`,
      { headers: RUN_HEADERS },
    );
    if (!res.ok) {
      cannotRun("g21", "M123: Wilmot and New London sit in 03255's answer", `HTTP ${res.status}`);
    } else {
      const body = (await res.json()) as {
        meetings: { jurisdiction: string; ocdId: string | null }[];
        governingOcdIds: string[] | null;
      };
      const towns = new Set(body.meetings.map((m) => m.jurisdiction));
      check(
        "g21",
        "M123: Wilmot AND New London are in 03255's own answer",
        towns.has("Wilmot, NH") && towns.has("New London, NH"),
        `${body.meetings.length} meeting(s) across ${towns.size} jurisdiction(s): ${[...towns].join(" · ")}`,
      );
      // M81 — the badge cannot be computed without this, and a NULL here is
      // deliberately different from an empty array.
      check(
        "g21",
        "M81: the meetings route sends the reader's own division set",
        Array.isArray(body.governingOcdIds) && body.governingOcdIds.length > 0,
        `governingOcdIds = ${
          body.governingOcdIds === null ? "null (resolution FAILED)" : `${body.governingOcdIds.length} division(s)`
        }`,
      );
      // And the badge's whole argument: at this zip most of what is on screen
      // does NOT govern the reader. A flat "everything governs" answer would
      // mean the division set had collapsed.
      const governing = new Set(body.governingOcdIds ?? []);
      const governs = body.meetings.filter((m) => m.ocdId && governing.has(m.ocdId)).length;
      check(
        "g21",
        "M81: at 03255 the badge splits the answer rather than blessing all of it",
        governs > 0 && governs < body.meetings.length,
        `${governs} of ${body.meetings.length} meeting(s) govern this reader`,
      );
    }
  } catch (error) {
    cannotRun("g21", "M123: Wilmot and New London sit in 03255's answer", (error as Error).message.slice(0, 90));
  }

  // ── D47 — two states side by side ─────────────────────────────────────
  try {
    const res = await fetch(`${BASE}/about-area/compare?a=NH&b=NJ`, { headers: RUN_HEADERS });
    const html = res.ok ? await res.text() : "";
    check(
      "g21",
      "D47: the side-by-side renders both states and says it does not rank",
      res.ok &&
        /New Hampshire and New Jersey/.test(html) &&
        /(don&#x27;t|don't|do not) rank/i.test(html),
      `HTTP ${res.status}, ${html.length} bytes`,
    );
  } catch (error) {
    cannotRun("g21", "D47: the side-by-side renders", (error as Error).message.slice(0, 90));
  }
})();

// ═══════════════════════════════════════════════════════════════════════════
// F01. The walkthrough items, on the live build (2026-08-19)
// ═══════════════════════════════════════════════════════════════════════════

section("F01. The walkthrough fixes hold (F01, 2026-08-19)");

{
  /*
   * These walkthrough fixes block further work until they are resolved, and
   * a fix nobody can see is not a fix, so the ones visible in the DOM are
   * asserted against the deploy rather than trusted from a green unit test.
   *
   * Its own page, per the standing rule: a page a dozen earlier checks have
   * clicked through answers with whatever they left open.
   */
  const page = await openWideAt(browser, "85701");
  try {
    // ── 9.2: the districts tile never says "Off" while districts are drawn ──
    const tile = (await page.evaluate(
      `(() => {
        const cards = [...document.querySelectorAll(".stats-bar *")]
          .map((n) => (n.textContent || "").replace(/\\s+/g, " ").trim())
          .filter((t) => /Districts in view$/.test(t));
        return { text: cards[0] || null };
      })()`,
    )) as { text: string | null };

    if (tile.text === null) {
      cannotRun(
        "F01",
        "9.2: the districts tile states a number, never Off",
        "no districts tile in the stats bar",
      );
    } else {
      const value = tile.text.replace(/Districts in view$/, "").trim();
      check(
        "F01",
        "9.2: the districts tile states a number, never Off",
        /^\d+$/.test(value),
        `tile read ${JSON.stringify(tile.text)} — value ${JSON.stringify(value)}`,
      );
    }
  } finally {
    await page.close();
  }
}

{
  /*
   * 9.6 — THE ONE TO PRESERVE. Selecting AZ-6 shades it on the map, and
   * closing the small battlecard on the right de-selects it. That behavior
   * stays as is.
   *
   * The map work in 9.1 through 9.5 is exactly what could have broken it, so
   * it gets a check of its own rather than an assumption. The gesture is real:
   * click the map, assert something opened, close it, assert it cleared. A
   * check that asserted only the first half would pass on a build where
   * closing no longer deselects.
   */
  const page = await openWideAt(browser, "85701");
  try {
    const box = await page.locator(".maplibregl-canvas").first().boundingBox();
    if (!box) {
      cannotRun(
        "F01",
        "9.6: selecting a district shades it, closing deselects",
        "no map canvas to click",
      );
    } else {
      /*
       * The district overlay is OFF by default (`use-district-layer` starts
       * pending and the reader has not chosen), and a click on bare basemap
       * hits no district — which is why the first run of this check reported
       * COULD NOT RUN honestly and proved nothing. So the overlay is turned on
       * first, through the reader’s own control, and the click goes to the
       * upper-right quadrant, which is the part of the map no overlay covers at
       * desktop width (the rail owns the left, the who-governs card the
       * bottom-left).
       */
      await page.evaluate(
        `(() => { try { localStorage.setItem("wtp.show_districts", "1"); } catch {} })()`,
      );
      await page.reload({ waitUntil: "domcontentloaded" });
      await appSettled(page);
      /* R49 DURATION, DELIBERATE: the district layer is fetched and added
       * asynchronously after the style settles, and there is no element to
       * poll for — the boundaries are WebGL, not DOM. The duration is the
       * layer load, not a guess at latency. */
      await page.waitForTimeout(3000);
      await page.mouse.click(box.x + box.width * 0.78, box.y + box.height * 0.32);
      /* R49 DURATION, DELIBERATE: a MAP SETTLE after a real click. The click can
       * open a picker, a card, or nothing at all, and "nothing at all" is a
       * legitimate outcome this check reports as COULD NOT RUN — so there is no
       * single element to poll for. Polling for "either of two things or
       * neither" is a fixed wait wearing a loop. The duration outlasts the
       * camera settle the click may trigger. */
      await page.waitForTimeout(2000);
      const opened = (await page.evaluate(
        `Boolean(document.querySelector(".district-picker") || document.querySelector(".popup-card"))`,
      )) as boolean;

      if (!opened) {
        cannotRun(
          "F01",
          "9.6: selecting a district shades it, closing deselects",
          "the map click opened neither a picker nor a card — the behaviour to preserve was never exercised",
        );
      } else {
        const cleared = (await page.evaluate(
          `(() => {
            const close = document.querySelector(
              '.popup-card [aria-label="Close"], .district-picker [aria-label="Dismiss"]',
            );
            if (close) close.click();
            return new Promise((r) =>
              setTimeout(() => {
                r(
                  !document.querySelector(".popup-card") &&
                    !document.querySelector(".district-picker"),
                );
              }, 900),
            );
          })()`,
        )) as boolean;
        check(
          "F01",
          "9.6: selecting a district shades it, closing deselects",
          Boolean(cleared),
          `opened=${opened} cleared=${cleared}`,
        );
      }
    }
  } finally {
    await page.close();
  }
}

{
  /*
   * 3.1 — every meetings list leads with what a reader can still attend.
   * Opened from a who-governs row, on its own page, and read out of the card
   * the click produced rather than out of the whole document.
   */
  const page = await openAt(browser, "85701");
  try {
    /* WGH-18: scoped to [data-governing-row] — see the note at the other
       governing-row lookup. The See-the-rest disclosure added a second,
       collapsed button list to this panel. */
    const row = page
      .locator('.coverage-notice [data-governing-row] button:has-text("Tucson Unified")')
      .first();
    if ((await row.count()) === 0) {
      cannotRun(
        "F01",
        "3.1: a meetings list leads with the upcoming group",
        "no Tucson Unified row at 85701",
      );
    } else {
      await row.click();
      await untilPresent(page, ".account-modal", 10_000);
      const read = (await page.evaluate(
        `(() => {
          const card = document.querySelector(".account-modal");
          if (!card) return null;
          const opener = [...card.querySelectorAll("button")].find((n) =>
            /Meetings/.test(n.textContent || ""),
          );
          if (opener) opener.click();
          return new Promise((r) =>
            setTimeout(() => {
              const text = (card.textContent || "").replace(/\\s+/g, " ");
              r({
                soonAt: text.indexOf("Meetings in the next 30 days"),
                laterAt: text.indexOf("Upcoming meetings after that"),
                closedAt: text.indexOf("Canceled or concluded"),
              });
            }, 1200),
          );
        })()`,
      )) as { soonAt: number; laterAt: number; closedAt: number } | null;

      if (!read) {
        cannotRun(
          "F01",
          "3.1: a meetings list leads with the upcoming group",
          "the battlecard did not open",
        );
      } else {
        const present = [read.soonAt, read.laterAt, read.closedAt].filter((n) => n >= 0);
        if (present.length === 0) {
          cannotRun(
            "F01",
            "3.1: a meetings list leads with the upcoming group",
            "no group header rendered — this body may hold no meetings at all, so the ordering was not exercised",
          );
        } else {
          // Whatever groups exist must appear in the specified order, and the
          // concluded block must never be the first thing on the list.
          const ascending = present.every((v, i) => i === 0 || present[i - 1] < v);
          const closedIsNotFirst = read.closedAt < 0 || present[0] !== read.closedAt;
          check(
            "F01",
            "3.1: a meetings list leads with the upcoming group",
            ascending && closedIsNotFirst,
            `soon@${read.soonAt} later@${read.laterAt} closed@${read.closedAt}`,
          );
        }
      }
    }
  } finally {
    await page.close();
  }
}

{
  /*
   * 6.1 — the struck gap phrasing is off the LIVE build, not merely out of the
   * source tree. A string test proves the repository; this proves the deploy.
   */
  for (const path of ["/", "/ballot?zip=85701", "/transparency"]) {
    const response = await fetch(`${BASE}${path}`, { headers: RUN_HEADERS });
    countProbe(`${BASE}${path}`);
    if (!response.ok) {
      cannotRun("F01", `6.1: no "gap in our" phrasing on ${path}`, `HTTP ${response.status}`);
      continue;
    }
    const html = await response.text();
    check(
      "F01",
      `6.1: no "gap in our" phrasing on ${path}`,
      !/gap in our (data|research)/i.test(html),
      `${html.length} bytes read`,
    );
  }
}

{
  /*
   * 1e — the struck never-store/never-log promise is off the live build too.
   * It is the one item where leaving the
   * old sentence up is a promise the business does not intend to keep.
   */
  const response = await fetch(`${BASE}/transparency`, { headers: RUN_HEADERS });
  countProbe(`${BASE}/transparency`);
  if (!response.ok) {
    cannotRun(
      "F01",
      "1e: the struck never-store promise is gone from the address copy",
      `HTTP ${response.status}`,
    );
  } else {
    const html = await response.text();
    const para =
      html.split(/<\/p>/).find((c) => /Census Bureau/.test(c) && /passes through/.test(c)) ?? "";
    check(
      "F01",
      "1e: the struck never-store promise is gone from the address copy",
      para.length > 0 && !/never (store|log)/i.test(para),
      para ? `address paragraph read, ${para.length} bytes` : "no address paragraph on the page",
    );
  }
}

{
  /*
   * 11.3 — the ballot page stopped claiming an order it does not use, and says
   * the true thing instead. A live read, because the sentence is the reader's
   * only account of why the candidates are in the order they are in.
   */
  const response = await fetch(`${BASE}/ballot?zip=85701`, { headers: RUN_HEADERS });
  countProbe(`${BASE}/ballot?zip=85701`);
  if (!response.ok) {
    cannotRun("F01", "11.3/11.4: the ballot states its real order and no recommendation", `HTTP ${response.status}`);
  } else {
    const html = await response.text();
    check(
      "F01",
      "11.3/11.4: the ballot states its real order and no recommendation",
      !/listed alphabetically by surname/i.test(html) &&
        /Nothing on this page is a recommendation/i.test(html),
      `${html.length} bytes read`,
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// F01C. The reader's own ballot counts all of it, and a clear is a clear
// ═══════════════════════════════════════════════════════════════════════════

section("F01C. The picks tally and the clear (F01-continued, 2026-08-19)");

/*
 * ITEM 8.7 and ITEM 9.6, on the deploy.
 *
 * The two defects were invisible from the source and obvious from the phone.
 * The tally counted MEASURES and not CANDIDATES — a measure pick can only be
 * explicit, a candidate pick can be derived from a Yes on the reaction control
 * — so the reader's own ballot was undercounting the reader's own ballot. And
 * "Clear my picks" removed the box and left the picks standing underneath it.
 *
 * **Both halves are read-only against production.** A pick is device-local by
 * construction (`lib/ballot/picks.ts` writes one localStorage key and touches
 * no network), so tapping one here writes nothing anywhere — which is why the
 * 0814c pick round-trip has always lived in this suite while every REACTION
 * tap is excluded by name. The derived half of the tally cannot be exercised
 * here for exactly that reason: deriving a pick needs a real Yes, and a Yes is
 * a write. It is exercised at phone width against localhost by
 * `scripts/verify-picks-f01c.mts`, and **that gap is stated rather than
 * implied** — what this check holds is the DENOMINATOR and the CLEAR, both of
 * which are what actually shipped wrong.
 */
for (const zip of ["85701", "03255"]) {
  const context = await browser.context({
    extraHTTPHeaders: RUN_HEADERS,
    viewport: PHONE,
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  page.on("response", (r) => countProbe(r.url()));
  try {
    await page.goto(`${BASE}/ballot?zip=${zip}`, {
      waitUntil: "domcontentloaded",
      timeout: 90_000,
    });
    // R49/R52: wait for the element this check CLICKS, hydrated — presence is
    // server markup and a click between the two does nothing at all.
    await untilInteractive(page, PICK_CHOICE, 12_000);

    const controls = await page.locator('.reaction-box[data-kind="pick"]').count();
    if (controls === 0) {
      cannotRun("F01C", `${zip}: the picks tally's denominator`, "no pick control on the page");
      continue;
    }

    await page.locator(PICK_CHOICE).first().click();
    const raised = await untilText(page, /races and measures on this ballot/i, 10_000);
    if (!raised) {
      cannotRun(
        "F01C",
        `${zip}: the picks tally's denominator`,
        "the tally never appeared after a pick — see 0814c's hydration note",
      );
      continue;
    }

    const tally = (await page.evaluate(
      `(() => {
         const e = document.querySelector("[data-pick-tally]");
         if (!e) return null;
         return {
           picked: Number(e.getAttribute("data-picked")),
           pickable: Number(e.getAttribute("data-pickable")),
           rows: document.querySelectorAll("[data-pick-tally] ~ ul > li").length,
         };
       })()`,
    )) as { picked: number; pickable: number; rows: number } | null;

    if (!tally) {
      cannotRun("F01C", `${zip}: the picks tally's denominator`, "no [data-pick-tally] element");
      continue;
    }

    // ITEM 8.7 — the denominator IS the rendered rows, not a number about them.
    check(
      "F01C",
      `${zip}: the picks tally's denominator equals the pick controls on the page`,
      tally.pickable === controls,
      `M=${tally.pickable}, pick controls rendered=${controls}`,
    );
    // …and the numerator is matched by rows, which is the same rule upward.
    check(
      "F01C",
      `${zip}: the picks tally's stated N equals its rendered rows`,
      tally.picked === tally.rows && tally.picked >= 1,
      `N=${tally.picked}, rows=${tally.rows}`,
    );

    // ITEM 9.6 — a clear is a clear, on every pick-bearing surface.
    await page.getByRole("button", { name: "Clear my picks" }).click();
    await untilPresent(page, '[role="dialog"][aria-label="Clear my picks"]', 8_000);
    await page.getByRole("button", { name: "Clear", exact: true }).click();
    await until(
      page,
      async () => !(await page.locator("[data-pick-tally]").count()),
      8_000,
    );

    const after = (await page.evaluate(
      `(() => ({
         box: document.querySelectorAll("[data-pick-tally]").length,
         stated: Array.from(document.querySelectorAll(".reaction-box-prompt"))
           .map((e) => (e.textContent || "").trim())
           .filter((t) => /^Your pick for this race:/.test(t)).length,
         stored: window.localStorage.getItem("wtp.ballot_picks") || "",
       }))()`,
    )) as { box: number; stated: number; stored: string };

    check(
      "F01C",
      `${zip}: after a clear, no surface still reflects a pick`,
      after.box === 0 && after.stated === 0,
      `picks box ${after.box}, contests still stating a pick ${after.stated}`,
    );
    check(
      "F01C",
      `${zip}: after a clear, the stored picks file holds none`,
      !/"choiceIds"/.test(after.stored),
      after.stored ? `${after.stored.length} bytes stored` : "nothing stored",
    );
  } finally {
    await context.close();
  }
}


// ═══════════════════════════════════════════════════════════════════════════
// F01C2. The battlecard, the positions search, the calendar and the placeholder
// ═══════════════════════════════════════════════════════════════════════════

section("F01C2. Items 12-17 on the deploy (F01-continued session 2, 2026-08-19)");

/*
 * Four items land here, and all four were invisible from the source and
 * obvious from a phone. Read-only: nothing below taps a reaction, submits an
 * ask, or writes any row. Opening a battlecard and typing in its search box
 * are both client-side; the positions search is a GET.
 *
 * ITEM 12 — the long sections moved into the battlecard, so the ballot stopped
 * being a forever scroll. Measured at 430x932: 07866 went 20,510 px to 9,574,
 * 85701 went 41,558 to 31,298.
 *
 * ITEM 13 — the battlecard's positions search read the officeholder-keyed
 * corpus while the candidate's own words live in the candidate-keyed one, so
 * a search for a term printed on the card returned "we haven't collected
 * anything they've published".
 *
 * ITEM 14 — the twelve-issue enumeration ran under every candidate. The row
 * carries the count now and the list is one tap inside the card.
 *
 * ITEM 16 — every dated voting event carries an add-to-calendar affordance,
 * WINDOWS INCLUDED. New Jersey's in-person early voting, 10/24 to 11/01, was
 * the one event on the page a reader could not save.
 */
for (const zip of ["07866", "85701"]) {
  const context = await browser.context({
    extraHTTPHeaders: RUN_HEADERS,
    viewport: PHONE,
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  page.on("response", (r) => countProbe(r.url()));
  try {
    await page.goto(`${BASE}/ballot?zip=${zip}`, {
      waitUntil: "domcontentloaded",
      timeout: 90_000,
    });
    await untilInteractive(page, "[data-battlecard-pill]", 15_000);

    const rows = await page.locator(".candidate-row").count();
    const pills = await page.locator("[data-battlecard-pill]").count();

    /*
     * **R58 (Prompt D item 3, 2026-08-20) — EVERY CHECK IN THIS BLOCK OWES AN
     * ENDING, and until today only the first one paid.**
     *
     * The whole block used to sit behind `if (rows === 0) { cannotRun(ONE);
     * continue; }`. When Prompt C's render gate withheld every contest on
     * these two zips, exactly two checks reported COULD NOT RUN — the pill
     * check, once per zip — and the other SEVENTEEN simply did not execute and
     * printed nothing at all. The identity diff caught them as GONE with "a
     * check that ran last time did not run now, and said nothing", which is
     * the last line of defence rather than the first.
     *
     * RULING 24: a check that cannot run SAYS SO. So the block's checks are
     * named up front, in one list, and any early exit declares all of them.
     * The list is also what makes the census honest — registered and reporting
     * have to be equal, and the assertion at the foot of this file goes red
     * when they are not.
     */
    const BLOCK_CHECKS: [string, string][] = [
      ["F01C2", `${zip}: every candidate row carries a battlecard pill`],
      ["NHHUNT", `${zip}: no per-card completeness count or enumeration anywhere on the ballot`],
      ["F01C2", `${zip}: every dated voting event can be calendared`],
      ["F01C2", `${zip}: a multi-day window carries the affordance too`],
      ["F01C2", `${zip}: the battlecard holds the sections the row gave up`],
      ["F01C2", `${zip}: the positions search finds a term from the card's own text`],
      ["F01C2", `${zip}: the polling-place affordance is an in-app pill, not a link out`],
      ["F01C2", `${zip}: the in-app voting panel opens on the ballot`],
      ["F01C2", `${zip}: the placeholder address names no region`],
      ["F22", `${zip}: the polling-place pointer renders exactly once on the ballot`],
    ];
    if (rows === 0) {
      for (const [session, name] of BLOCK_CHECKS) {
        cannotRun(session, name, "no candidate rows on the page");
      }
      continue;
    }

    // ITEM 12: equal effort is the point of the count. One pill per row, or
    // some candidates are better rendered than others.
    check(
      "F01C2",
      `${zip}: every candidate row carries a battlecard pill`,
      pills === rows,
      `${pills} pills for ${rows} rows`,
    );

    /*
     * RULING 47 AND RULING 44 (2026-08-20) — the check INVERTS, because the
     * author retired the claim behind it.
     *
     * Item 14 shipped a COUNT on the ballot row and a buried ENUMERATION in
     * the battlecard, and this check asserted exactly that arrangement. Both
     * are now deleted: a per-card measurement of our own coverage is RULING
     * 44's banned statement, and a digit is that statement compressed. The
     * check stays in the suite — it does not leave, it changes sides — so a
     * session that reintroduces either half fails against production.
     */
    const onRow = (await page.evaluate(
      `(() => ({
         annotations: document.querySelectorAll('[data-gap-annotation]').length,
         enumerations: document.querySelectorAll('[data-gap-enumeration]').length,
       }))()`,
    )) as { annotations: number; enumerations: number };
    check(
      "NHHUNT",
      `${zip}: no per-card completeness count or enumeration anywhere on the ballot`,
      onRow.annotations === 0 && onRow.enumerations === 0,
      `${onRow.annotations} annotations, ${onRow.enumerations} enumerations on the page`,
    );

    // ITEM 16: every dated voting event with a known date is one tap from a
    // calendar. A window is the event a reader most needs there.
    const dated = (await page.evaluate(
      `(() => {
         const rows = Array.from(document.querySelectorAll('[data-dated-event]'));
         return rows.map((r) => ({
           text: (r.textContent || '').trim().slice(0, 80),
           hasButton: Boolean(r.querySelector('button')),
           isWindow: /\\d{2}\\/\\d{2}\\/\\d{4}\\s*[-\\u2013\\u2014]\\s*\\d{2}\\/\\d{2}\\/\\d{4}/.test(r.textContent || ''),
         }));
       })()`,
    )) as { text: string; hasButton: boolean; isWindow: boolean }[];
    if (dated.length === 0) {
      cannotRun("F01C2", `${zip}: every dated voting event can be calendared`, "no [data-dated-event] on the page");
      // R58: the window check lives in the same else-branch and used to
      // vanish with it.
      cannotRun("F01C2", `${zip}: a multi-day window carries the affordance too`, "no [data-dated-event] on the page");
    } else {
      /*
       * A PAST event is not calendar material, and this check has to know
       * that or it reports the rule working as the rule broken.
       *
       * Caught by the first live run: 85701 failed on `07/21/2026`, which is
       * Arizona's primary, held. Item 16 did not change the past-date
       * exclusion — it changed the exclusion of WINDOWS, which is a different
       * thing that had been swept up with it. The row still renders, because
       * a voter reading the sequence needs to see that the primary happened;
       * it just carries no button.
       *
       * The reader's today is read off the PAGE's own rendered dates rather
       * than from this process's clock, so the check cannot drift from what
       * the server decided.
       */
      // The Phoenix day from the ONE module that owns it (item 0B). A
      // private copy here would be the sixth, and the guard that caught it
      // is the one written this session.
      const today = phoenixDay();
      const upcoming = dated.filter((d) => {
        const found = d.text.match(/\d{2}\/\d{2}\/\d{4}/g) ?? [];
        if (found.length === 0) return false;
        const last = found[found.length - 1];
        const [m, day, y] = last.split("/");
        return `${y}-${m}-${day}` >= today;
      });
      const missing = upcoming.filter((d) => !d.hasButton);
      check(
        "F01C2",
        `${zip}: every dated voting event can be calendared`,
        missing.length === 0,
        missing.length === 0
          ? `${upcoming.length} of ${dated.length} dated events are still ahead, all with the affordance` +
            ` (${dated.length - upcoming.length} past, correctly without)`
          : `${missing.length} of ${upcoming.length} upcoming without: ${missing.map((m) => m.text).join(" | ")}`,
      );
      const windows = dated.filter((d) => d.isWindow);
      check(
        "F01C2",
        `${zip}: a multi-day window carries the affordance too`,
        windows.every((w) => w.hasButton),
        `${windows.length} window(s) rendered${windows.length ? `: ${windows.map((w) => w.text).join(" | ")}` : " — none on this zip, which is not a failure"}`,
      );
    }

    /*
     * ITEM 12/13: open a battlecard and read what is inside it.
     *
     * The FIRST card is not good enough for item 13's half. The first
     * candidate on 07866 mentions 0 of the 12 issues, so their card holds no
     * quoted text to draw a search term from, and the first live run reported
     * COULD NOT RUN on a zip where the check could plainly have run against
     * the next card along. A cannot-run that is really a "did not look" is
     * the shape this whole suite exists to refuse.
     *
     * So: open cards until one holds quoted positions text, up to a stated
     * cap, and report which one was used. If none does, THAT is the honest
     * cannot-run and it names how many were opened.
     */
    const CARDS_TO_TRY = 6;
    let opened = false;
    let cardIndex = -1;
    for (let i = 0; i < Math.min(CARDS_TO_TRY, pills); i++) {
      await page.locator("[data-battlecard-pill]").nth(i).scrollIntoViewIfNeeded();
      await page.locator("[data-battlecard-pill]").nth(i).click();
      opened = await untilInteractive(page, "[data-candidate-battlecard]", 10_000);
      cardIndex = i;
      if (!opened) break;
      const hasQuotes = await page.evaluate(
        `(() => {
           const card = document.querySelector('[data-candidate-battlecard]');
           if (!card) return false;
           return card.querySelectorAll('blockquote, [data-candidate-positions] li').length > 0;
         })()`,
      );
      if (hasQuotes) break;
      if (i < Math.min(CARDS_TO_TRY, pills) - 1) {
        await page.keyboard.press("Escape");
        await page
          .locator("[data-candidate-battlecard]")
          .waitFor({ state: "detached", timeout: 5_000 })
          .catch(() => {});
      }
    }
    if (!opened) {
      cannotRun("F01C2", `${zip}: the battlecard opens and holds the moved sections`, "the card never opened");
      continue;
    }

    const inside = (await page.evaluate(
      `(() => {
         const card = document.querySelector('[data-candidate-battlecard]');
         if (!card) return null;
         return {
           positions: card.querySelectorAll('[data-candidate-positions]').length,
           enumerations: card.querySelectorAll('[data-gap-enumeration]').length,
           search: card.querySelectorAll('[data-positions-search]').length,
         };
       })()`,
    )) as { positions: number; enumerations: number; search: number } | null;
    check(
      "F01C2",
      `${zip}: the battlecard holds the sections the row gave up`,
      // RULING 44: a battlecard for a candidate we hold no published words for
      // renders NO positions section at all, so `positions` may legitimately
      // be 0 on the first card. What may never be non-zero is the enumeration.
      Boolean(inside) && inside!.enumerations === 0,
      inside ? `positions ${inside.positions}, enumerations ${inside.enumerations}` : "no card",
    );

    /*
     * ITEM 13's walk check, and it is the one the brief asks for by name: a
     * battlecard holding positions must not return zero hits for a term drawn
     * from its OWN positions text.
     *
     * The term is READ OFF THE CARD rather than chosen here. A hand-picked
     * term would have passed against the broken index — "housing" matches
     * nobody when the index does not contain the person — and that is exactly
     * how this shipped.
     */
    const term = (await page.evaluate(
      `(() => {
         const card = document.querySelector('[data-candidate-battlecard]');
         if (!card) return null;
         const quotes = Array.from(card.querySelectorAll('blockquote, [data-candidate-positions] li'));
         const text = quotes.map((q) => q.textContent || '').join(' ');
         const words = (text.toLowerCase().match(/[a-z]{6,14}/g) || []);
         const counted = new Map();
         for (const w of words) counted.set(w, (counted.get(w) || 0) + 1);
         const best = Array.from(counted.entries()).sort((a, b) => b[1] - a[1])[0];
         return best ? best[0] : null;
       })()`,
    )) as string | null;

    if (!term) {
      cannotRun(
        "F01C2",
        `${zip}: the positions search finds a term from the card's own text`,
        `opened ${cardIndex + 1} of ${Math.min(CARDS_TO_TRY, pills)} cards and none held quoted positions text to draw a term from — not a zero result`,
      );
    } else {
      /*
       * THE SEARCH BOX IS INSIDE A COLLAPSED SECTION, and the first live run
       * found that by CRASHING the whole suite on a 30-second `fill` timeout.
       *
       * Two things are wrong with that and both are this check's, not the
       * product's. The card's grammar is collapsible sections — rule 6b4,
       * every section a collapsed header — so `Positions` is shut when the
       * card opens and its input is not there to fill. And a walk check that
       * THROWS takes every check after it down with it, which is worse than
       * any red line: the suite stops reporting rather than reporting a
       * failure. It is wrapped, and an unreachable box is COULD NOT RUN.
       */
      /*
       * The section's toggle is a `button.card-section-header`, NOT a
       * `<summary>` — `components/officials/card-section.tsx`. The first fix
       * targeted `summary`, found nothing, clicked nothing and reported COULD
       * NOT RUN on both zips: honest, and still a check that had not run.
       * Reading the component settled it.
       */
      const header = page
        .locator("[data-candidate-battlecard] .card-section-header", {
          hasText: /positions/i,
        })
        .first();
      if ((await header.count()) > 0) {
        await header.scrollIntoViewIfNeeded().catch(() => {});
        await header.click().catch(() => {});
      }
      const box = page.locator("[data-positions-search]").first();
      const reachable = await box
        .waitFor({ state: "visible", timeout: 8_000 })
        .then(() => true)
        .catch(() => false);
      if (!reachable) {
        cannotRun(
          "F01C2",
          `${zip}: the positions search finds a term from the card's own text`,
          "the search box did not become reachable inside the card — this is a " +
            "failure to reach the control, never a zero-result search",
        );
      } else {
      await box.fill(term);
      const answered = await untilText(page, /last checked|none of them mentions|only inside a block|could not read/i, 12_000);
      const got = (await page.evaluate(
        `(() => {
           const card = document.querySelector('[data-candidate-battlecard]');
           if (!card) return null;
           const el = card.querySelector('[data-positions-answer]');
           return el ? el.getAttribute('data-positions-answer') : 'NONE';
         })()`,
      )) as string | null;
      check(
        "F01C2",
        `${zip}: the positions search finds a term from the card's own text`,
        answered && got === "MATCHED",
        `term "${term}" -> ${got ?? "no answer element"}`,
      );
      }
    }

    // ITEM 15/17: the polling-place affordance stays in the app, and its
    // placeholder names no region.
    await page.keyboard.press("Escape");
    const where = await page.locator("[data-where-to-vote-pill]").count();
    check(
      "F01C2",
      `${zip}: the polling-place affordance is an in-app pill, not a link out`,
      where > 0,
      `${where} in-app pill(s)`,
    );
    // F22 (2026-08-20), following F21: the pointer is required
    // ONCE PER PAGE, in the dates header. F01C2 shipped the check above
    // asserting only that the affordance stays in the app, and reported "2
    // in-app pill(s)" as evidence without holding the count to anything. The
    // both-places rule of 2026-08-15 is retired, so the count is now a claim
    // in its own right: a second identical pill returning here would be a
    // regression rather than a number in an evidence string.
    check(
      "F22",
      `${zip}: the polling-place pointer renders exactly once on the ballot`,
      where === 1,
      `${where} in-app pill(s) — once per page since the F21 ruling`,
    );
    if (where === 0) {
      // R58 again, one nesting level down: with no pill there is nothing to
      // open, so the two checks inside declare rather than vanish.
      cannotRun("F01C2", `${zip}: the in-app voting panel opens on the ballot`, "no polling-place pill to open");
      cannotRun("F01C2", `${zip}: the placeholder address names no region`, "no polling-place pill to open");
    } else {
      await page.locator("[data-where-to-vote-pill]").first().scrollIntoViewIfNeeded();
      await page.locator("[data-where-to-vote-pill]").first().click();
      const panel = await untilInteractive(page, ".voting-panel-input", 10_000);
      if (!panel) {
        cannotRun("F01C2", `${zip}: the in-app voting panel opens on the ballot`, "the panel never appeared");
        cannotRun("F01C2", `${zip}: the placeholder address names no region`, "the panel never appeared");
      } else {
        const placeholder = await page
          .locator(".voting-panel-input")
          .first()
          .getAttribute("placeholder");
        check(
          "F01C2",
          `${zip}: the in-app voting panel opens on the ballot`,
          true,
          "the same panel the map pill opens",
        );
        check(
          "F01C2",
          `${zip}: the placeholder address names no region`,
          placeholder === "123 Main St, Anywhere, USA",
          `placeholder is "${placeholder}"`,
        );
      }
    }
  } finally {
    await context.close();
  }
}


/*
 * ══════════════════════════════════════════════════════════════════════════
 * BAL-25, BAL-26 and BAL-30 (2026-08-28) — THE BALLOT AT DESKTOP WIDTH, THE
 * ASK AFFORDANCE, AND THE MEASURE TEXT.
 *
 * **TWO GAPS IN THIS SUITE, AND THEY ARE THE SAME GAP.**
 *
 * The ballot block above runs at `PHONE` and only at `PHONE`. That was right
 * when it was written — the tester's own passes were on a phone — but it meant
 * the suite had NEVER LOOKED at this page above 390px, and what BAL-25 found
 * is only visible above 390px: `app/ballot/page.tsx` carried a `max-w-2xl`
 * container and not one responsive utility anywhere on the surface, so a
 * 2,000px desktop rendered 672px of ballot and 1,328px of background. A
 * regression net that never opens the window cannot report the view.
 *
 * The same block never touched `[data-ballot-ask]` either. Ask reached this
 * page on 2026-08-27 and was mounted dead last, below every contest, footnote,
 * measure, note and absence block — roughly 20,000px down at 1280 and 25,000px
 * at 390. Nothing here would have noticed, because nothing here knew the panel
 * existed.
 *
 * **APPENDED, NEVER REWRITTEN.** Every check above is untouched: this block
 * adds identities and removes none, so `docs/walk-checks.txt` gains lines and
 * the set difference above stays readable.
 *
 * R58: the block's checks are NAMED UP FRONT and every early exit declares all
 * of them, so a check that could not run says so rather than printing nothing.
 * ══════════════════════════════════════════════════════════════════════════
 */
section("BAL-25/26/30 — the ballot at desktop width, and Ask where a reader can find it");

/**
 * The four local Pima measures BAL-30 renders text for. Named rather than
 * derived, so a check about the Vail override cannot quietly become a check
 * about whatever the page happened to render.
 */
const BAL30_LOCAL_MEASURES = [
  "ballot-az-pima:prop-423",
  "ballot-az-pima:prop-425",
  "ballot-az-pima:prop-428",
  "ballot-az-pima:prop-429",
];

interface BallotSurfaceRead {
  overflow: number;
  mainWidth: number;
  proseWidth: number;
  officeLefts: number[];
  candidateLefts: number[];
  candidateCount: number;
  firstContestTop: number;
  pillTop: number;
  statewideIds: string[];
  localIds: string[];
  questions: number;
  questionChars: number;
  statementPresent: number;
  statementGap: number;
  gapText: string;
  presentText: string;
}

/* One read, both widths. Document coordinates for the vertical claims, so a
   scrolled page cannot make "above the contests" true by accident. */
const READ_BALLOT_SURFACE = `(() => {
  const round = (n) => Math.round(n);
  const main = document.querySelector('main');
  const prose = document.querySelector('main p.text-voice') || document.querySelector('main p');
  const contests = Array.from(document.querySelectorAll('[data-contest-id]'));
  const offices = Array.from(document.querySelectorAll('.ballot-office-list > [data-contest-id]'));
  const candidates = Array.from(document.querySelectorAll('.ballot-candidate-grid > [data-candidate-target]'));
  const pill = document.querySelector('[data-ballot-ask-pill]');
  const scoped = (scope) => Array.from(
    document.querySelectorAll('[data-measure-scope="' + scope + '"] [data-contest-id]'),
  ).map((el) => el.getAttribute('data-contest-id'));
  const gap = document.querySelector('[data-measure-statement="GAP_OURS"]');
  const present = document.querySelector('[data-measure-statement="PRESENT"]');
  const questions = Array.from(document.querySelectorAll('[data-measure-question]'));
  return {
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    mainWidth: main ? round(main.getBoundingClientRect().width) : 0,
    proseWidth: prose ? round(prose.getBoundingClientRect().width) : 0,
    officeLefts: offices.map((c) => round(c.getBoundingClientRect().left)),
    candidateLefts: candidates.map((c) => round(c.getBoundingClientRect().left)),
    candidateCount: candidates.length,
    firstContestTop: contests.length
      ? round(contests[0].getBoundingClientRect().top + window.scrollY)
      : -1,
    pillTop: pill ? round(pill.getBoundingClientRect().top + window.scrollY) : -1,
    statewideIds: scoped('STATEWIDE'),
    localIds: scoped('LOCAL'),
    questions: questions.length,
    questionChars: questions.reduce((n, q) => n + (q.textContent || '').trim().length, 0),
    statementPresent: document.querySelectorAll('[data-measure-statement="PRESENT"]').length,
    statementGap: document.querySelectorAll('[data-measure-statement="GAP_OURS"]').length,
    gapText: gap ? (gap.textContent || '').trim() : '',
    presentText: present ? (present.textContent || '').trim() : '',
  };
})()`;

/*
 * **85629 IS THE CONTROL ZIP, AND THE CHOICE IS THE CHECK.**
 *
 * 85641 (Vail) was the obvious pick and it is the wrong one: it renders
 * Propositions 423 and 425, both of which HAVE an official statement, so a
 * check run there could never see the branch that matters. 85629 (Sahuarita)
 * renders 423 and 425 with their statements AND Proposition 428 without one —
 * the same class of question, from the same publisher, whose district Notice
 * of Election has not been read. Both branches on one page is the only way to
 * assert that they do not render as the same sentence.
 *
 * 07866 (Morris County, NJ) carries no measures at all, which exercises the
 * declaration path: three checks that COULD NOT RUN and say so.
 */
for (const zip of ["85629", "07866"]) {
  const WIDE_CHECKS: [string, string][] = [
    ["BAL25", `${zip}: the ballot fills the desktop width rather than a 672px column`],
    ["BAL25", `${zip}: offices stack and candidates use two columns at 1280`],
    ["BAL25", `${zip}: the ballot does not scroll sideways at 1280`],
    ["BAL25", `${zip}: prose keeps a readable measure while the container widens`],
    ["BAL26", `${zip}: the Ask affordance sits ABOVE the contests at 1280`],
    ["BAL26", `${zip}: the Ask panel opens from the pill at 1280, input and submit inside it`],
    ["BAL30", `${zip}: every measure with recorded question text renders it`],
    ["BAL30", `${zip}: a measure with no recorded statement names the gap as OURS`],
    ["BAL30", `${zip}: no local measure renders under the statewide heading`],
  ];

  const wide = await openWideAt(browser, zip);
  try {
    await wide.goto(`${BASE}/ballot?zip=${zip}`, {
      waitUntil: "domcontentloaded",
      timeout: 90_000,
    });
    const ready = await untilInteractive(wide, "[data-contest-id]", 20_000);
    if (!ready) {
      for (const [s, n] of WIDE_CHECKS) {
        cannotRun(s, n, `no [data-contest-id] rendered at 1280x900 for ${zip}`);
      }
    } else {
      const read = (await wide.evaluate(READ_BALLOT_SURFACE)) as BallotSurfaceRead;

      /*
       * ITEM 1 — the container. 672px WAS the defect, so the check is a claim
       * about the number rather than about "responsiveness": at 1280 with
       * `lg:px-8` the main element measures ~1088px, and anything near 672 is
       * the old column back.
       */
      check(
        "BAL25",
        `${zip}: the ballot fills the desktop width rather than a 672px column`,
        read.mainWidth > 900,
        `main measures ${read.mainWidth}px at a 1280px viewport (it was 672)`,
      );

      /*
       * BAL-43: the second column is now within an office, while whole office
       * blocks stay in a single top-to-bottom sequence.
       */
      const lefts = [...new Set(read.candidateLefts)];
      const officeLefts = [...new Set(read.officeLefts)];
      if (read.candidateCount < 2) {
        cannotRun(
          "BAL25",
          `${zip}: offices stack and candidates use two columns at 1280`,
          `${read.candidateCount} candidate(s) on the page — a second column needs a second card, and this is a failure to reach the subject rather than a zero result`,
        );
      } else {
        check(
          "BAL25",
          `${zip}: offices stack and candidates use two columns at 1280`,
          officeLefts.length === 1 && lefts.length === 2,
          `${officeLefts.length} office column; ${read.candidateCount} candidates across ${lefts.length} column position(s): ${lefts.join(", ")}`,
        );
      }

      check(
        "BAL25",
        `${zip}: the ballot does not scroll sideways at 1280`,
        read.overflow <= 0,
        `${read.overflow}px of horizontal overflow`,
      );

      /*
       * ITEM 3 — the rule the widening had to obey. Widening the container
       * while letting the prose run with it is not a desktop composition, it
       * is the phone page with the guard rails off. 42rem is 672px; the
       * allowance is for the border box.
       */
      check(
        "BAL25",
        `${zip}: prose keeps a readable measure while the container widens`,
        read.proseWidth > 0 &&
          read.proseWidth <= 700 &&
          read.mainWidth > read.proseWidth + 200,
        `prose ${read.proseWidth}px inside a ${read.mainWidth}px container`,
      );

      /*
       * BAL-26 — the affordance is ABOVE the reading, which is the whole of
       * the defect it fixes.
       */
      if (read.pillTop < 0) {
        cannotRun(
          "BAL26",
          `${zip}: the Ask affordance sits ABOVE the contests at 1280`,
          "no [data-ballot-ask-pill] on the page",
        );
        cannotRun(
          "BAL26",
          `${zip}: the Ask panel opens from the pill at 1280, input and submit inside it`,
          "no [data-ballot-ask-pill] to open",
        );
      } else {
        check(
          "BAL26",
          `${zip}: the Ask affordance sits ABOVE the contests at 1280`,
          read.firstContestTop < 0 || read.pillTop < read.firstContestTop,
          `pill at y=${read.pillTop}, first contest at y=${read.firstContestTop} — it used to sit below every one of them`,
        );

        await wide.locator("[data-ballot-ask-pill]").first().click();
        const opened = await untilInteractive(
          wide,
          "[data-ballot-ask] [data-ask-input]",
          8_000,
        );
        const contract = (await wide.evaluate(
          `(() => {
             const s = document.querySelector('[data-ballot-ask]');
             const p = document.querySelector('[data-ballot-ask-pill]');
             return {
               section: s ? 1 : 0,
               input: s ? s.querySelectorAll('[data-ask-input]').length : 0,
               submit: s ? s.querySelectorAll('[data-ask-submit]').length : 0,
               expanded: p ? p.getAttribute('aria-expanded') : null,
               overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
             };
           })()`,
        )) as {
          section: number;
          input: number;
          submit: number;
          expanded: string | null;
          overflow: number;
        };
        check(
          "BAL26",
          `${zip}: the Ask panel opens from the pill at 1280, input and submit inside it`,
          opened &&
            contract.section === 1 &&
            contract.input === 1 &&
            contract.submit === 1 &&
            contract.expanded === "true" &&
            contract.overflow <= 0,
          `section ${contract.section}, input ${contract.input}, submit ${contract.submit}, aria-expanded ${contract.expanded}, overflow ${contract.overflow}px`,
        );
      }

      /*
       * BAL-30 — the measure text. `data/states/az/ballot/az-pima-2026.json` has carried
       * the official question for four local measures since 2026-08-27 and the
       * page rendered none of it, which is the rule in `lib/ballot/analyses.ts`
       * broken by the surface the rule was written for.
       *
       * A ballot with no measures DECLARES rather than passes. 07866 has none.
       */
      const rendered = [...read.statewideIds, ...read.localIds];
      if (read.questions === 0 && rendered.length === 0) {
        cannotRun("BAL30", `${zip}: every measure with recorded question text renders it`, "no measures on this ballot");
        cannotRun("BAL30", `${zip}: a measure with no recorded statement names the gap as OURS`, "no measures on this ballot");
        cannotRun("BAL30", `${zip}: no local measure renders under the statewide heading`, "no measures on this ballot");
      } else {
        check(
          "BAL30",
          `${zip}: every measure with recorded question text renders it`,
          read.localIds.length > 0 && read.questions >= read.localIds.length && read.questionChars > 500,
          `${read.questions} question block(s), ${read.questionChars} characters of official wording on screen`,
        );

        /*
         * **THE CONTROL, and it is the reason this is two checks and not one.**
         * Propositions 428 (Sahuarita) and 429 (Tanque Verde) are the same
         * class of question from the same publisher as 423 (Vail), and their
         * statement is null because the district's own Notice of Election has
         * not been read. Rendering them like 423 would manufacture a claim;
         * rendering them as the SAME SENTENCE as 423 would hide one. Both must
         * be on screen and they must not read alike.
         */
        check(
          "BAL30",
          `${zip}: a measure with no recorded statement names the gap as OURS`,
          read.statementPresent >= 1 &&
            read.statementGap >= 1 &&
            read.gapText.length > 0 &&
            read.gapText !== read.presentText &&
            /we have not recorded/i.test(read.gapText),
          `${read.statementPresent} statement(s) rendered, ${read.statementGap} named gap(s); the gap reads "${read.gapText.slice(0, 90)}"`,
        );

        const misfiled = read.statewideIds.filter((id) =>
          BAL30_LOCAL_MEASURES.includes(id),
        );
        check(
          "BAL30",
          `${zip}: no local measure renders under the statewide heading`,
          misfiled.length === 0,
          misfiled.length === 0
            ? `${read.statewideIds.length} statewide, ${read.localIds.length} local`
            : `filed as statewide: ${misfiled.join(", ")}`,
        );
      }
    }
  } finally {
    await wide.context().close();
  }

  /*
   * AND THE SAME AFFORDANCE AT PHONE WIDTH, which is the width that matters
   * most: this page is ~25,000px at 390, so a feature at the bottom of it is
   * further from a phone reader than from anyone else.
   */
  const phoneContext = await browser.context({
    extraHTTPHeaders: RUN_HEADERS,
    viewport: PHONE,
    reducedMotion: "reduce",
  });
  const phone = await phoneContext.newPage();
  phone.on("response", (r) => countProbe(r.url()));
  try {
    await phone.goto(`${BASE}/ballot?zip=${zip}`, {
      waitUntil: "domcontentloaded",
      timeout: 90_000,
    });
    const ready = await untilInteractive(phone, "[data-ballot-ask-pill]", 20_000);
    if (!ready) {
      cannotRun("BAL26", `${zip}: the Ask affordance sits ABOVE the contests at 390`, "no [data-ballot-ask-pill] at 390x844");
      cannotRun("BAL26", `${zip}: the Ask panel opens at 390 without pushing the page sideways`, "no [data-ballot-ask-pill] at 390x844");
      cannotRun("BAL25", `${zip}: the ballot does not scroll sideways at 390`, "the ballot never rendered at 390x844");
    } else {
      const read = (await phone.evaluate(READ_BALLOT_SURFACE)) as BallotSurfaceRead;
      /*
       * **THE DEFECT THIS CHECK WAS WRITTEN FOR WAS FOUND BY MEASURING, NOT
       * BY LOOKING.** 07866 pushed the phone page 75px sideways: the dates
       * list put a nowrap label and a shrink-0 value in competition for 318px
       * and New Jersey.s early-voting WINDOW took the ground from the
       * viewport. Every screenshot of it looked fine.
       */
      check(
        "BAL25",
        `${zip}: the ballot does not scroll sideways at 390`,
        read.overflow <= 0,
        `${read.overflow}px of horizontal overflow at 390x844`,
      );
      check(
        "BAL26",
        `${zip}: the Ask affordance sits ABOVE the contests at 390`,
        read.pillTop >= 0 &&
          (read.firstContestTop < 0 || read.pillTop < read.firstContestTop),
        `pill at y=${read.pillTop}, first contest at y=${read.firstContestTop}`,
      );

      await phone.locator("[data-ballot-ask-pill]").first().click();
      const opened = await untilInteractive(
        phone,
        "[data-ballot-ask] [data-ask-input]",
        8_000,
      );
      const after = (await phone.evaluate(
        `(() => ({
           overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
           input: document.querySelectorAll('[data-ballot-ask] [data-ask-input]').length,
           submit: document.querySelectorAll('[data-ballot-ask] [data-ask-submit]').length,
         }))()`,
      )) as { overflow: number; input: number; submit: number };
      check(
        "BAL26",
        `${zip}: the Ask panel opens at 390 without pushing the page sideways`,
        opened && after.input === 1 && after.submit === 1 && after.overflow <= 0,
        `input ${after.input}, submit ${after.submit}, ${after.overflow}px of horizontal overflow`,
      );
    }
  } finally {
    await phoneContext.close();
  }
}

/* ── BAL-39: the two-column ballot has no holes in it ───────────────────── */

/**
 * **THE GAPS BETWEEN CONSECUTIVE CARDS IN ONE COLUMN, MEASURED.**
 * (Session B, 2026-08-31. The defect: the two-column desktop layout had gaps
 * and misaligned boxes.)
 *
 * ## Why this is DOM geometry and not an image evaluation
 *
 * The row's blocker asked for an image-evaluated measurement, and for the
 * properties `visual-suite.mts` owns — clipping, prominence, overlap — that is
 * right, because those are questions about PAINT and `getBoundingClientRect`
 * cannot answer them.
 *
 * A GAP is not one of those. It is layout: the distance between one card's
 * bottom edge and the next card's top edge in the same column, which the
 * geometry answers exactly and a screenshot answers only by inference. The
 * repository's own note on `measure-panels.mts` draws that line in the other
 * direction — *the DOM was never wrong* there, so pixels were the instrument.
 * Here the DOM is precisely what is wrong.
 *
 * ## What was measured before the fix, so the check has a baseline
 *
 * At 1280 on 2026-08-31, a two-column GRID placed cards in ROWS: each row's
 * height was its tallest card and every shorter card left a hole. 85701 ran
 * 13px to 689px within one column; 07866 ran 20px to 468px. Column flow
 * replaced it, and the same measurement now reads 13-15px throughout.
 *
 * The check allows a generous ceiling rather than pinning today's number: a
 * card gaining a section legitimately changes nothing about the gap BELOW it,
 * and a ceiling that tracked the design would fail on every restyle. What it
 * catches is the class — a hole an order of magnitude larger than the gap.
 */
const BALLOT_GAP_CEILING_PX = 60;

const BALLOT_COLUMNS_READ = `(() => {
  const out = [];
  for (const grid of document.querySelectorAll('.ballot-card-grid, .ballot-candidate-grid')) {
    const cards = [...grid.querySelectorAll(':scope > [data-contest-id], :scope > [data-candidate-target]')].map((el) => {
      const r = el.getBoundingClientRect();
      return {
        id: el.getAttribute('data-contest-id') || el.getAttribute('data-candidate-target'),
        x: Math.round(r.x),
        y: Math.round(r.y + window.scrollY),
        h: Math.round(r.height),
        w: Math.round(r.width),
      };
    });
    if (cards.length === 0) continue;
    const byColumn = {};
    for (const c of cards) {
      byColumn[c.x] = byColumn[c.x] || [];
      byColumn[c.x].push(c);
    }
    const columns = Object.keys(byColumn).map((x) => {
      const col = byColumn[x].sort((a, b) => a.y - b.y);
      const gaps = [];
      for (let i = 1; i < col.length; i += 1) {
        gaps.push(col[i].y - (col[i - 1].y + col[i - 1].h));
      }
      return { x: Number(x), count: col.length, top: col[0].y, widths: [...new Set(col.map((c) => c.w))], gaps };
    });
    out.push({ cards: cards.length, columns });
  }
  return out;
})()`;

interface BallotColumns {
  cards: number;
  columns: { x: number; count: number; top: number; widths: number[]; gaps: number[] }[];
}

for (const zip of ["85701", "07866"]) {
  const BLOCK: [string, string][] = [
    ["SB0831", `${zip}: the two-column ballot has no hole between consecutive cards`],
    ["SB0831", `${zip}: both ballot columns start at the same height`],
    ["SB0831", `${zip}: the ballot really is two columns of equal width at 1280`],
  ];
  const wide = await openWideAt(browser, zip);
  try {
    await wide.goto(`${BASE}/ballot?zip=${zip}`, {
      waitUntil: "domcontentloaded",
      timeout: 90_000,
    });
    const ready = await untilInteractive(wide, "[data-contest-id]", 20_000);
    if (!ready) {
      for (const [session, name] of BLOCK) {
        cannotRun(session, name, "no contest cards rendered on this ballot");
      }
      continue;
    }
    const grids = (await wide.evaluate(BALLOT_COLUMNS_READ)) as BallotColumns[];
    const multi = grids.filter((g) => g.columns.length > 1);
    if (multi.length === 0) {
      for (const [session, name] of BLOCK) {
        cannotRun(
          session,
          name,
          `no grid on this ballot laid out in more than one column at 1280 (${grids.length} grid(s) read)`,
        );
      }
      continue;
    }

    /*
     * THE DEFECT. A grid places in rows and a short card leaves a hole whose
     * size is set by its row-mate's height. A ceiling on the gap is what
     * distinguishes "these cards are spaced" from "this column has a hole".
     */
    const allGaps = multi.flatMap((g) => g.columns.flatMap((c) => c.gaps));
    const worst = allGaps.length > 0 ? Math.max(...allGaps) : 0;
    check(
      "SB0831",
      BLOCK[0][1],
      allGaps.length > 0 && worst <= BALLOT_GAP_CEILING_PX,
      `${allGaps.length} gap(s) across ${multi.length} multi-column grid(s); largest ${worst}px ` +
        `(ceiling ${BALLOT_GAP_CEILING_PX}); distinct ${[...new Set(allGaps)].sort((a, b) => a - b).join(",")}`,
    );

    /* The "misaligned boxes" half: the columns of one grid start level. */
    const tops = multi.map((g) => [...new Set(g.columns.map((c) => c.top))]);
    check(
      "SB0831",
      BLOCK[1][1],
      tops.every((t) => t.length === 1),
      `column tops per grid: ${tops.map((t) => t.join("/")).join(" · ")}`,
    );

    /* BAL-43 puts candidates inside full-width offices. Each pair must still
       have equal widths; measure cards have their own narrower envelope. */
    const widths = multi.flatMap((g) => g.columns.flatMap((c) => c.widths));
    check(
      "SB0831",
      BLOCK[2][1],
      multi.every((g) => g.columns.length === 2 &&
        new Set(g.columns.flatMap((c) => c.widths)).size === 1),
      `${multi.map((g) => g.columns.length).join("/")} column(s) per grid, ` +
        `width(s) ${[...new Set(widths)].join(",")}`,
    );
  } finally {
    await wide.context().close();
  }
}

/* ── RULING 222 / WGH-22: the scope IS the address ─────────────────────── */

/**
 * **THE POST-ADDRESS PANEL, ON THE RENDERED DOM, AT EVERY PILOT ZIP.**
 * (Session B, 2026-08-31. Third recurrence: WGH-12 and WGH-15 on 8/28,
 * WGH-22 on 8/30, falsified again by the owner on 8/31.)
 *
 * ## Why this exists, stated as the instrument failure it is
 *
 * WGH-22 was marked FIXED_VERIFIED in the 8.30.26 sweep against a check named
 * `rq:wgh-22-panel-seats`. **That check does not exist.** There is no such row
 * in `data/health/reader-questions.json` and never was; `rq:` names the
 * ReaderQuestion corpus, which is generated from the owner's own workbook and
 * cannot be authored by a session. What actually ran was
 * `tests/panel-seats.test.ts` — unit tests over a pure function, against a
 * hand-built `CoverageSummary` whose shape the production derivation cannot
 * emit.
 *
 * So the acceptance measured the reasoning that produced the fix and agreed
 * with it. It never measured the post-address panel. Driven against
 * production on 2026-08-31 at the owner's own address, that panel rendered
 * EMPTY at the state legislative levels — District 19 correctly set aside,
 * District 17 still nowhere.
 *
 * **Every check here is bound to the state the report was about**: an address
 * CONFIRMED, and the panel read afterwards. Nothing here can pass by
 * measuring the resolver, the pre-address view, or a fixture.
 *
 * ## The reader's question, and where it is asked
 *
 * The first check is the reader's own question — *I live at this address; who
 * is my state house representative?* — asked of the PANEL rather than of the
 * Ask box, because the second half of the requirement is a statement
 * about what the panel LISTS. It is deliberately NOT added to
 * `data/health/reader-questions.json`: that corpus is generated from the
 * owner's workbook under stated criteria, and a session writing its own
 * question into the answer key is the attack `lib/health/owner-corpus.ts`
 * refuses by name.
 *
 * ## The address is confirmed the way a reader confirms one
 *
 * The walk POSTs the street to `/api/address/resolve` — the product's own one
 * resolver, the same request the prompt component makes — and writes the
 * result into `sessionStorage` in exactly the shape `writeSessionAddress`
 * writes, then lets the surface's own storage subscription re-render. No
 * reload, and nothing asserted from a value the walk invented.
 */
const SCOPE_ADDRESSES: { zip: string; street: string; houseNumber: string }[] = [
  { zip: "85641", street: "South Bear Table Tank Drive", houseNumber: "10723" },
  { zip: "85701", street: "E Congress St", houseNumber: "" },
  { zip: "07866", street: "W Main St", houseNumber: "" },
  { zip: "03255", street: "Bay Point Rd", houseNumber: "" },
];

/** The levels the panel's State and Federal sections own. */
const SCOPE_LEVELS = ["sldl", "sldu", "cd"];

/** The deepest OCD segment's key — `lib/state/resolved-location.ts`'s split. */
function scopeLevelOf(ocdId: string): string {
  const last = ocdId.split("/").pop() ?? "";
  const colon = last.indexOf(":");
  return colon === -1 ? "" : last.slice(0, colon);
}

interface ScopeRead {
  rows: { standing: string; sourcing: string; label: string }[];
  exclusionMarks: number;
  disclosures: number;
  excludedRows: number;
  notYoursCopy: boolean;
  ocdIdOnScreen: boolean;
}

/** What the panel is showing, read off the DOM and nothing else. */
const SCOPE_READ = `(() => {
  const rows = [...document.querySelectorAll('[data-seat-standing]')];
  const text = document.body.innerText || "";
  return {
    rows: rows.map((el) => ({
      standing: el.getAttribute('data-seat-standing') || "",
      sourcing: el.getAttribute('data-seat-sourcing') || "",
      label: (el.querySelector('.text-label') ? el.querySelector('.text-label').textContent : '').trim(),
    })),
    exclusionMarks: document.querySelectorAll('[data-standing="ELSEWHERE_IN_ZIP"]').length,
    disclosures: document.querySelectorAll('[data-elsewhere-disclosure]').length,
    excludedRows: document.querySelectorAll('[data-elsewhere-row]').length,
    notYoursCopy: text.indexOf('not yours') !== -1 || text.indexOf('covers another part of') !== -1,
    ocdIdOnScreen: text.indexOf('ocd-division') !== -1,
  };
})()`;

interface ScopeExpectation {
  divisionIds: string[];
  splitLevels: string[];
  contestIds: string[];
}

/**
 * What the product's OWN resolver says this address settles.
 *
 * The EXPECTATION only. It is asked of the API because the API is the answer
 * key — never so that a check can write the answer onto the page it is about
 * to read. Both blocks below share this one implementation so the two cannot
 * drift into disagreeing about what the right answer is.
 */
async function resolveAddressExpectation(target: {
  zip: string;
  street: string;
  houseNumber: string;
}): Promise<ScopeExpectation | null> {
  try {
    const response = await fetch(`${BASE}/api/address/resolve`, {
      method: "POST",
      headers: { "content-type": "application/json", ...RUN_HEADERS },
      body: JSON.stringify({
        zip: target.zip,
        street: target.street,
        houseNumber: target.houseNumber,
      }),
    });
    const body = (await response.json()) as {
      resolution: {
        status: string;
        levels?: { level: string; divisionIds: string[]; certain: boolean }[];
      };
      contestIds?: string[];
    };
    const levels = body.resolution.levels ?? [];
    if (body.resolution.status === "FAILED" || levels.length === 0) return null;
    return {
      divisionIds: levels.filter((l) => l.certain).flatMap((l) => l.divisionIds),
      splitLevels: levels.filter((l) => !l.certain).map((l) => l.level),
      contestIds: body.contestIds ?? [],
    };
  } catch {
    return null;
  }
}

for (const target of SCOPE_ADDRESSES) {
  const BLOCK: [string, string][] = [
    [
      "SB0831",
      `${target.zip}: the districts a confirmed address settled are the districts the panel lists`,
    ],
    ["SB0831", `${target.zip}: no district the address ruled out is rendered, marked or disclosed`],
    ["SB0831", `${target.zip}: confirming an address CHANGES the panel to the resolved scope`],
    ["SB0831", `${target.zip}: no seat row renders an identifier or an unnamed district`],
  ];

  /*
   * The confirmed answer comes from the product's own resolver. A ZIP whose
   * test street stops resolving DECLARES (RULING 24) rather than skipping — a
   * silent skip is the failure mode this whole block exists to end.
   */
  const resolved = await resolveAddressExpectation(target);

  if (!resolved) {
    for (const [session, name] of BLOCK) {
      cannotRun(
        session,
        name,
        `the resolver did not place ${target.street} in ${target.zip}, so no address was confirmed`,
      );
    }
    continue;
  }

  const ownDistricts = resolved.divisionIds.filter((id) => SCOPE_LEVELS.includes(scopeLevelOf(id)));
  const scopeJson = JSON.stringify(
    JSON.stringify({
      zip: target.zip,
      contestIds: resolved.contestIds,
      divisionIds: resolved.divisionIds,
      splitLevels: resolved.splitLevels,
      streetLabel: target.street,
      resolvedAt: new Date().toISOString(),
    }),
  );

  const page = await openAt(browser, target.zip);
  try {
    // WGH-8: the card is REACHED the way a reader reaches it, never assumed.
    const wghPill = page.locator(".notice-fab").first();
    if (await wghPill.isVisible().catch(() => false)) {
      await wghPill.click();
      await until(page, async () => (await page.locator(".coverage-notice").count()) > 0, 8_000);
    }
    const opened = await untilPresent(page, "[data-seat-standing]", 15_000);
    if (!opened) {
      for (const [session, name] of BLOCK) {
        cannotRun(session, name, "the who-governs card rendered no seat rows to read");
      }
      continue;
    }
    const before = (await page.evaluate(SCOPE_READ)) as ScopeRead;

    await page.evaluate(
      `(() => {
        sessionStorage.setItem('wtp.session_address_scope', ${scopeJson});
        window.dispatchEvent(new StorageEvent('storage', { key: 'wtp.session_address_scope' }));
      })()`,
    );
    await untilSettled(page, "body", 400, 8_000);
    const after = (await page.evaluate(SCOPE_READ)) as ScopeRead;

    const confirmed = after.rows.filter((r) => r.standing === "CONFIRMED");
    const rendered = after.rows.map((r) => r.label).filter(Boolean);

    /*
     * **THE READER'S QUESTION.** *I live at this address — who is my state
     * house representative?* Answered only if every district the address
     * confirmed at these levels is on the panel, CONFIRMED, and NAMED. The
     * counts are compared, not a substring: a panel that renders one of two
     * confirmed districts is the 8/30 failure with a smaller hole.
     */
    check(
      "SB0831",
      BLOCK[0][1],
      confirmed.length === ownDistricts.length &&
        confirmed.every((r) => r.label.length > 0) &&
        after.rows.every((r) => r.standing === "CONFIRMED"),
      `the address confirmed ${ownDistricts.length} district(s) at these levels; the panel ` +
        `renders ${after.rows.length} row(s), ${confirmed.length} CONFIRMED: ` +
        `${rendered.join(" · ") || "none"}`,
    );

    /*
     * **RULING 222.** An entity the system determined does not govern this
     * reader is OUT OF SCOPE, not annotated. All four artefacts of the old
     * behaviour are refused together — the standing on a rendered row, the
     * disclosure, its rows, and the copy itself — because three sessions
     * running improved one of them and left the others.
     */
    check(
      "SB0831",
      BLOCK[1][1],
      after.exclusionMarks === 0 &&
        after.disclosures === 0 &&
        after.excludedRows === 0 &&
        !after.notYoursCopy &&
        after.rows.every((r) => r.standing !== "ELSEWHERE_IN_ZIP"),
      `${after.exclusionMarks} exclusion mark(s), ${after.disclosures} disclosure(s), ` +
        `${after.excludedRows} disclosed row(s), exclusion copy on screen: ${after.notYoursCopy}, ` +
        `rows carrying ELSEWHERE_IN_ZIP: ` +
        `${after.rows.filter((r) => r.standing === "ELSEWHERE_IN_ZIP").length}`,
    );

    /*
     * **THE STATE TRANSITION.** If the panel stays stagnant when an address
     * goes in, people will stop putting in addresses.
     *
     * The transition is asserted on the PANEL'S OWN STATE, not only on its
     * labels. At a ZIP whose centroid already sits inside the reader's
     * districts the names are the same and the answer still moved: every row
     * went from `UNSETTLED` — *we have not been told enough to say* — to
     * `CONFIRMED`. Demanding a LABEL change there would be demanding the panel
     * invent one, which is the opposite defect.
     */
    const beforeLabels = before.rows.map((r) => r.label).sort().join("|");
    const afterLabels = after.rows.map((r) => r.label).sort().join("|");
    const wasUnsettled = before.rows.some((r) => r.standing === "UNSETTLED");
    check(
      "SB0831",
      BLOCK[2][1],
      (beforeLabels !== afterLabels || wasUnsettled) &&
        after.rows.every((r) => r.standing === "CONFIRMED"),
      `before: ${beforeLabels || "no rows"} [${before.rows.map((r) => r.standing).join(",")}] · ` +
        `after: ${afterLabels || "no rows"} [${after.rows.map((r) => r.standing).join(",")}]`,
    );

    /*
     * A reader surface may never print an OCD-ID, and a district row with no
     * name is not renderable as a district. The named gap is the honest answer
     * while the lookup is in flight; an empty label never is.
     */
    check(
      "SB0831",
      BLOCK[3][1],
      !after.ocdIdOnScreen &&
        after.rows.every(
          (r) => r.label.length > 0 || r.sourcing === "looking" || r.sourcing === "unavailable",
        ),
      `ocd-division on screen: ${after.ocdIdOnScreen}; unnamed rows: ` +
        `${after.rows.filter((r) => r.label.length === 0).map((r) => r.sourcing).join(",") || "none"}`,
    );
  } finally {
    await page.context().close();
  }
}

/**
 * **WGH-22 — THE READER'S OWN INTERACTION, IN ONE TAB, WITH NOTHING SUPPLIED.**
 * (Session C, 2026-08-31.)
 *
 * The block above confirms an address by writing `sessionStorage` and then
 * DISPATCHING A SYNTHETIC `storage` EVENT. That event is the one thing a real
 * browser never produces for the tab that wrote — `sessionStorage` notifies
 * every OTHER tab and never the writer. So the block measured the panel's
 * derivation correctly and, in the same motion, supplied the notification the
 * product was failing to send. It passed on 8/31 while the owner was watching
 * the defect on production.
 *
 * That is the third instrument to certify this defect while it was live. The
 * first was a unit test whose fixture hand-built a `CoverageSummary` shape the
 * real derivation cannot emit; the second was a sweep row closed against a
 * check id that names nothing on disk.
 *
 * So this block supplies NOTHING. It clicks the pill a reader clicks, types
 * into the field a reader types into, presses the button a reader presses, and
 * then reads the panel — same tab, no reload, no seeded storage, no dispatched
 * event. The expectation still comes from the product's own resolver, because
 * an answer key is not a supplied answer.
 *
 * `lib/geo/session-address.ts` now publishes to its own subscribers on write
 * and on clear. Before that, the first check here fails at every ZIP.
 */
for (const target of SCOPE_ADDRESSES) {
  const LIVE: [string, string][] = [
    [
      "SC0831",
      `${target.zip}: typing an address into the prompt moves the panel in the same tab, no reload`,
    ],
    [
      "SC0831",
      `${target.zip}: the panel a reader sees after typing lists the districts the resolver settled`,
    ],
    ["SC0831", `${target.zip}: a device revisiting with a kept resolution lists the settled districts`],
    [
      "SC0831",
      `${target.zip}: on the revisit the banner is not the evidence — the LIST carries the districts`,
    ],
  ];

  const expectation = await resolveAddressExpectation(target);
  if (!expectation) {
    for (const [session, name] of LIVE) {
      cannotRun(
        session,
        name,
        `the resolver did not place ${target.street} in ${target.zip}, so no address was confirmed`,
      );
    }
    continue;
  }
  const ownDistricts = expectation.divisionIds.filter((id) =>
    SCOPE_LEVELS.includes(scopeLevelOf(id)),
  );

  const page = await openAt(browser, target.zip);
  try {
    const wghPill = page.locator(".notice-fab").first();
    if (await wghPill.isVisible().catch(() => false)) {
      await wghPill.click();
      await until(page, async () => (await page.locator(".coverage-notice").count()) > 0, 8_000);
    }
    if (!(await untilPresent(page, "[data-seat-standing]", 15_000))) {
      for (const [session, name] of LIVE) {
        cannotRun(session, name, "the who-governs card rendered no seat rows to read");
      }
      continue;
    }
    const before = (await page.evaluate(SCOPE_READ)) as ScopeRead;

    /*
     * The door a reader uses. `CouldGovernNotice` renders the pill only while
     * rows carry the mark; if it is not there the reader had no door, and that
     * is a DECLARED blocked check rather than a silent pass (RULING 24).
     */
    const pill = page.locator(".could-govern-notice-pill").first();
    if (await pill.isVisible().catch(() => false)) await pill.click();

    const street = page.locator('input[aria-label="Street"]').first();
    if (!(await street.isVisible().catch(() => false))) {
      for (const [session, name] of LIVE) {
        cannotRun(session, name, "the address prompt offered no street field to type into");
      }
      continue;
    }

    await untilInteractive(page, 'input[aria-label="Street"]');
    await street.fill(target.street);
    const submitted = page.waitForResponse(
      (response) => response.url().endsWith("/api/address/resolve") && response.request().method() === "POST",
      { timeout: 25_000 },
    ).then(async (response) => {
      const body = await response.json();
      return { http: response.status(), resolution: body.resolution?.status ?? "not recorded" };
    }).catch(() => ({ http: null, resolution: "NO RESPONSE OBSERVED" }));
    await page.locator(".address-prompt-fields button").first().click();
    const addressResponse = await submitted;

    /*
     * **WAIT FOR THE FIELD, NOT FOR THE PAGE TO GO QUIET.** The first version
     * of this block used a settle timer here and read the panel before the
     * resolver had answered, which made a timing race look exactly like the
     * defect it was written to catch. A street that needs a number asks for
     * one; that ASK is the thing to wait for, so it is waited for by name.
     *
     * An empty houseNumber in the table above is a reader who was never asked,
     * and skipping is a legal reader path — so the wait is conditional on this
     * walk having a number to give.
     */
    const houseNumber = page.locator('input[aria-label="House number"]').first();
    if (target.houseNumber) {
      const asked = await page
        .waitForSelector('input[aria-label="House number"]', { timeout: 20_000 })
        .then(() => true)
        .catch(() => false);
      if (asked) {
        await houseNumber.fill(target.houseNumber);
        await page.locator(".address-prompt-fields button").first().click();
      }
    }

    /*
     * Then wait for the CONDITION rather than for a duration: every row
     * CONFIRMED is what a settled address looks like. If it never arrives the
     * wait simply expires and the read below fails the check honestly, with
     * the panel's actual state as the evidence.
     */
    await until(
      page,
      async () => {
        const now = (await page.evaluate(SCOPE_READ)) as ScopeRead;
        return now.rows.length > 0 && now.rows.every((r) => r.standing === "CONFIRMED");
      },
      20_000,
    );

    const after = (await page.evaluate(SCOPE_READ)) as ScopeRead;
    const addressPrompt = await page.evaluate(() => document.querySelector(".address-prompt")?.textContent ?? null);
    const beforeState = before.rows.map((r) => `${r.label}:${r.standing}`).sort().join("|");
    const afterState = after.rows.map((r) => `${r.label}:${r.standing}`).sort().join("|");

    /*
     * **THE DEFECT ITSELF.** The screen: the control saying District 17
     * above a panel still listing District 19. The panel MOVED is the whole
     * claim — a panel that reads identically after the reader answered is the
     * bug, whatever the banner above it says.
     */
    check(
      "SC0831",
      LIVE[0][1],
      beforeState !== afterState && after.rows.every((r) => r.standing === "CONFIRMED"),
      `before: ${beforeState || "no rows"} · after: ${afterState || "no rows"} — ` +
        `${after.rows.filter((r) => r.standing === "CONFIRMED").length} of ${after.rows.length} CONFIRMED; ` +
        `resolver response ${JSON.stringify(addressResponse)}; prompt ${JSON.stringify(addressPrompt)}`,
    );

    const confirmed = after.rows.filter((r) => r.standing === "CONFIRMED");
    /*
     * The names the panel gave these districts when the reader settled them, so
     * the revisit check below can say whether the BANNER contains any of them.
     * Taken from the rendered rows rather than from a second lookup: the point
     * is what a reader can read on screen, and a second source of names would
     * be a second opinion about the answer rather than the answer.
     */
    const ownDistrictNames = confirmed.map((r) => r.label).filter(Boolean);
    check(
      "SC0831",
      LIVE[1][1],
      confirmed.length === ownDistricts.length &&
        confirmed.every((r) => r.label.length > 0) &&
        after.exclusionMarks === 0 &&
        !after.ocdIdOnScreen,
      `the resolver settled ${ownDistricts.length} district(s) at these levels; the panel shows ` +
        `${confirmed.length} CONFIRMED: ${confirmed.map((r) => r.label).join(" · ") || "none"}`,
    );

    /*
     * **THE REVISIT.** A device coming back inside the same session holds the
     * resolution already, so this one legitimately seeds and RELOADS — the
     * claim is about what a fresh mount reads, not about a notification. The
     * 8/28 failure was a banner that announced the address over a list that
     * had not used it, so the assertion is on the LIST.
     */
    await page.reload({ waitUntil: "domcontentloaded" });
    // The card is REACHED after a reload the same way it is reached on a cold
    // open — the surface has to mount before the pill exists, and probing
    // sooner reads an empty page and calls it a missing panel.
    await untilPresent(page, ".notice-fab", 30_000);
    if (await wghPill.isVisible().catch(() => false)) {
      await wghPill.click();
      await until(page, async () => (await page.locator(".coverage-notice").count()) > 0, 10_000);
    }
    const mounted = await untilPresent(page, "[data-seat-standing]", 20_000);
    if (mounted) {
      await until(
        page,
        async () => {
          const now = (await page.evaluate(SCOPE_READ)) as ScopeRead;
          return now.rows.length > 0 && now.rows.every((r) => r.standing === "CONFIRMED");
        },
        20_000,
      );
    }
    const revisited = mounted ? ((await page.evaluate(SCOPE_READ)) as ScopeRead) : null;
    const revisitConfirmed = revisited?.rows.filter((r) => r.standing === "CONFIRMED") ?? [];
    check(
      "SC0831",
      LIVE[2][1],
      revisited !== null &&
        revisitConfirmed.length === ownDistricts.length &&
        revisitConfirmed.every((r) => r.label.length > 0),
      revisited === null
        ? "the card rendered no seat rows after the revisit"
        : `after reload the panel shows ${revisitConfirmed.length} of ${ownDistricts.length} ` +
          `settled district(s): ${revisitConfirmed.map((r) => r.label).join(" · ") || "none"}`,
    );

    /*
     * **THE BANNER IS NOT THE EVIDENCE.** (Part A remainder, 2026-08-31.)
     *
     * On a REVISIT the banner and the list are fed by two different things, and
     * only one of them is the reader's districts:
     *
     * - The banner is `.address-prompt-confirmed` in `address-prompt.tsx`. Its
     *   mount effect reads the kept scope and sets `phase = "SETTLED"` and
     *   `street = held.streetLabel`, but leaves `resolution` NULL — so on a
     *   revisit the confirmed-levels branch cannot fire and the banner falls
     *   through to **"Set to <street>."**, rendered from the recognition label
     *   the store keeps for the reader's benefit. It is a correct sentence that
     *   contains no district and consults no district.
     * - The list is the panel's `[data-seat-standing]` rows, which read the
     *   store through `useResolvedLocation`.
     *
     * So a revisit check that read the banner would go green off a string the
     * store keeps for recognition while the list below it rendered nothing —
     * which is the 8/28 screen exactly: the control announcing District 17 over
     * a section listing District 19. This check states both readings and passes
     * only on the LIST: the banner is recorded as evidence of what a
     * banner-only check WOULD have believed, and it is never what decides.
     */
    const revisitBanner = (await page.evaluate(
      `(() => {
        const el = document.querySelector('.address-prompt-confirmed');
        const text = el ? (el.textContent || '').trim() : '';
        return { text: text, present: !!el };
      })()`,
    )) as { text: string; present: boolean };
    const bannerNamesADistrict = ownDistrictNames.some(
      (name) => name.length > 0 && revisitBanner.text.includes(name),
    );
    const listNamesThem =
      revisitConfirmed.length === ownDistricts.length &&
      revisitConfirmed.every((r) => r.label.length > 0);
    check(
      "SC0831",
      LIVE[3][1],
      listNamesThem,
      `banner ${revisitBanner.present ? `reads "${revisitBanner.text}"` : "absent"} and names a ` +
        `settled district: ${bannerNamesADistrict}; the LIST names ${revisitConfirmed.length} of ` +
        `${ownDistricts.length}: ${revisitConfirmed.map((r) => r.label).join(" · ") || "none"} — ` +
        "the list is what this check reads",
    );
  } finally {
    await page.context().close();
  }
}
/**
 * **THE BALLOT, REVISITED WITH A KEPT RESOLUTION — ONE VARIANT PER PILOT ZIP.**
 * (Part A remainder of `WGH-22`, 2026-08-31.)
 *
 * The block above asks the who-governs panel what a returning device shows.
 * This asks the BALLOT, which is the other surface a kept resolution reaches,
 * and it asks the question the way the 8/28 failure taught: **a banner can be
 * right while the list under it is untouched.**
 *
 * `components/ballot/ballot-narrowing.tsx` renders BOTH halves and they come
 * from different places, which is precisely why one can be right without the
 * other. `setAside` — the number in *"Narrowed to that address — N contests
 * elsewhere in 07866 are hidden"* — is React state. The hiding itself is a DOM
 * write: `applyScope` stamps `data-scoped-out` on each `[data-contest-id]`
 * section. So the sentence and the page it describes are two artefacts, and a
 * check that reads the sentence has verified the sentence.
 *
 * The three checks per ZIP are therefore:
 *
 * 1. The revisit narrows AT ALL — the reader gets back what they already gave.
 * 2. **The stated N equals the rendered N.** The banner's own number against
 *    the sections actually carrying `data-scoped-out`. This is the check that
 *    a banner-only verification cannot pass by accident.
 * 3. Candidates still render. A narrowed ballot showing zero `.candidate-row`
 *    cards is a shorter ballot, not a narrower one, and "show everything we
 *    find" forbids narrowing that empties the page.
 *
 * **NOTHING IS SUPPLIED.** The address is settled by typing into the ballot's
 * own prompt, and the revisit is a real navigation back to the same URL — no
 * seeded scope, no dispatched `storage` event. The event a harness dispatches
 * is the one notification a browser never sends the tab that wrote, and
 * supplying it is how the 8/31 walk passed over a live defect.
 */
{
  const BALLOT_REVISIT_READ = `(() => {
    const sections = [...document.querySelectorAll('[data-contest-id]')];
    const banner = document.querySelector('.ballot-narrowed');
    const bannerText = banner ? (banner.textContent || '').trim() : '';
    const stated = bannerText.match(/([0-9]+) contests? elsewhere/);
    return {
      contests: sections.length,
      scopedOut: sections.filter((s) => s.getAttribute('data-scoped-out') === 'true').length,
      candidateRows: document.querySelectorAll('.candidate-row').length,
      bannerPresent: !!banner,
      bannerText: bannerText,
      bannerSaysNoneHidden: bannerText.indexOf('Every contest below') !== -1,
      statedHidden: stated ? Number(stated[1]) : -1,
    };
  })()`;

  interface BallotRevisitRead {
    contests: number;
    scopedOut: number;
    candidateRows: number;
    bannerPresent: boolean;
    bannerText: string;
    bannerSaysNoneHidden: boolean;
    statedHidden: number;
  }

  for (const target of SCOPE_ADDRESSES) {
    const REVISIT: [string, string][] = [
      [
        "SC0831",
        `${target.zip}: returning to the ballot with a kept resolution narrows the contest list`,
      ],
      [
        "SC0831",
        `${target.zip}: the ballot's stated hidden count equals the contests actually set aside`,
      ],
      [
        "SC0831",
        `${target.zip}: the narrowed ballot still renders candidate cards, never an empty list`,
      ],
    ];

    const page = await openAt(browser, target.zip);
    try {
      const ballotUrl = `${BASE}/ballot?zip=${target.zip}`;
      await page.goto(ballotUrl, { waitUntil: "domcontentloaded", timeout: 90_000 });
      if (!(await untilPresent(page, "[data-contest-id]", 40_000))) {
        for (const [session, name] of REVISIT) {
          cannotRun(session, name, `the ballot at ${target.zip} rendered no contests to narrow`);
        }
        continue;
      }

      /*
       * Settle the address the way a reader does, on this page's own prompt.
       * A ZIP whose prompt is not offered DECLARES (RULING 24) — a silent skip
       * here is the reporting failure this whole section exists to end.
       */
      const trigger = page.locator(".address-prompt-trigger").first();
      if (!(await trigger.isVisible().catch(() => false))) {
        for (const [session, name] of REVISIT) {
          cannotRun(session, name, "the ballot offered no address prompt to narrow with");
        }
        continue;
      }
      await trigger.click();
      const street = page.locator('input[aria-label="Street"]').first();
      if (!(await street.isVisible().catch(() => false))) {
        for (const [session, name] of REVISIT) {
          cannotRun(session, name, "the address prompt offered no street field to type into");
        }
        continue;
      }
      await street.fill(target.street);
      await page.locator(".address-prompt-fields button").first().click();

      // The house-number ask is caused by the street, so it is waited for by
      // name rather than by a settle timer that cannot tell a slow resolver
      // from a missing question.
      if (target.houseNumber) {
        const asked = await page
          .waitForSelector('input[aria-label="House number"]', { timeout: 20_000 })
          .then(() => true)
          .catch(() => false);
        if (asked) {
          await page.locator('input[aria-label="House number"]').first().fill(target.houseNumber);
          await page.locator(".address-prompt-fields button").first().click();
        }
      }

      // Wait for the CONDITION — the prompt settled — never for a duration.
      const settled = await until(
        page,
        async () => (await page.locator(".address-prompt-settled").count()) > 0,
        20_000,
      );
      if (!settled) {
        for (const [session, name] of REVISIT) {
          cannotRun(
            session,
            name,
            `the prompt never settled ${target.street} in ${target.zip}, so nothing was kept`,
          );
        }
        continue;
      }

      /*
       * **THE REVISIT.** A real navigation back to the same URL in the same
       * tab: a fresh mount that holds nothing but what the store kept. This is
       * the return a reader makes when they leave the ballot and come back.
       */
      await page.goto(ballotUrl, { waitUntil: "domcontentloaded", timeout: 90_000 });
      if (!(await untilPresent(page, "[data-contest-id]", 40_000))) {
        for (const [session, name] of REVISIT) {
          cannotRun(session, name, "the ballot rendered no contests after the revisit");
        }
        continue;
      }
      await until(
        page,
        async () => (await page.locator(".ballot-narrowed").count()) > 0,
        20_000,
      );
      const read = (await page.evaluate(BALLOT_REVISIT_READ)) as BallotRevisitRead;

      /*
       * Narrowing HAPPENED. Both outcomes are legitimate — contests hidden, or
       * the honest "every contest below is on the ballot at that address" — and
       * neither is the absence of a banner over an unchanged page.
       */
      check(
        "SC0831",
        REVISIT[0][1],
        read.bannerPresent && (read.scopedOut > 0 || read.bannerSaysNoneHidden),
        `banner ${read.bannerPresent ? `present: "${read.bannerText}"` : "ABSENT"}; ` +
          `${read.scopedOut} of ${read.contests} contest(s) carry data-scoped-out`,
      );

      /*
       * **THE STATED N AGAINST THE RENDERED N.** The banner is React state and
       * the hiding is a DOM write, so the two can disagree — and a check that
       * read only the banner would report the disagreement as success. A
       * banner reading "none hidden" is held to a rendered zero by the same
       * rule, from the other direction.
       */
      const expectedHidden = read.bannerSaysNoneHidden ? 0 : read.statedHidden;
      check(
        "SC0831",
        REVISIT[1][1],
        expectedHidden >= 0 && expectedHidden === read.scopedOut,
        `the banner states ${expectedHidden < 0 ? "no number" : expectedHidden} hidden; ` +
          `${read.scopedOut} section(s) of ${read.contests} actually carry data-scoped-out — ` +
          `banner text: "${read.bannerText}"`,
      );

      /*
       * A ballot narrowed to nothing is not a narrowed ballot. `.candidate-row`
       * is the card count on this page — the `data-candidate-*` attributes
       * return 0 and are not the instrument.
       */
      check(
        "SC0831",
        REVISIT[2][1],
        read.candidateRows > 0 && read.scopedOut < read.contests,
        `${read.candidateRows} candidate card(s) after the revisit, with ` +
          `${read.contests - read.scopedOut} of ${read.contests} contest(s) still shown`,
      );
    } finally {
      await page.context().close();
    }
  }
}

/**
 * **NEW HAMPSHIRE MONEY REACHES THE 03255 READER.** (Session C, 2026-08-31.)
 *
 * `data/states/nh/funding/state-money-nh-2026.json` is acquired data, and the whole
 * failure mode this suite exists for applies to it: the file can go missing,
 * be regenerated against the wrong year, or lose its deploy tracing, and every
 * one of those renders as a clean card with no money on it. `tests/
 * state-money-nh.test.ts` guards the FILE; this guards what a reader SEES.
 *
 * Two claims, and the second matters as much as the first: a candidate the
 * registry holds nothing for must render the sourced absence and must never
 * render a zero. NH's thresholds exempt most town-level candidates, so the
 * absence is the COMMON case here, and a $0 in its place would be a false
 * claim about a named person's campaign on the majority of the ballot.
 */
{
  const NH_ZIP = "03255";
  const FILED_CANDIDATE = "Warmington";
  const ABSENT_CANDIDATE = "Strathdee";
  const MONEY: [string, string][] = [
    ["SC0831", `${NH_ZIP}: a candidate the state holds a filing for renders the filed totals`],
    ["SC0831", `${NH_ZIP}: a candidate the state holds nothing for renders a sourced absence, never a zero`],
  ];

  const readMoney = async (page: Page, surname: string): Promise<string | null> => {
    await page.goto(`${BASE}/ballot?zip=${NH_ZIP}`, {
      waitUntil: "domcontentloaded",
      timeout: 90_000,
    });
    if (!(await untilPresent(page, ".candidate-row", 40_000))) return null;
    const row = page.locator(".candidate-row", { hasText: surname }).first();
    const card = row.locator("button", { hasText: "View Battlecard" }).first();
    if (!(await card.isVisible().catch(() => false))) return null;
    await card.click();
    const money = page.getByRole("button", { name: /Campaign money/i }).first();
    if (!(await untilPresent(page, "button", 15_000))) return null;
    if (!(await money.isVisible().catch(() => false))) return null;
    await money.click();
    await untilSettled(page, "body", 400, 8_000);
    return (await page.evaluate(
      `(() => {
        var b = [...document.querySelectorAll('button')].filter(function (x) {
          return /Campaign money/i.test(x.innerText || '');
        })[0];
        if (!b) return null;
        var region = b.parentElement;
        for (var i = 0; i < 4 && region; i++) {
          if ((region.innerText || '').trim().length > 40) break;
          region = region.parentElement;
        }
        return region ? region.innerText : null;
      })()`,
    )) as string | null;
  };

  const page = await browser.page({ viewport: PHONE, reducedMotion: "reduce" });
  try {
    const filed = await readMoney(page, FILED_CANDIDATE);
    if (filed === null) {
      cannotRun("SC0831", MONEY[0][1], `the ballot did not open a card for ${FILED_CANDIDATE}`);
    } else {
      check(
        "SC0831",
        MONEY[0][1],
        /Raised/i.test(filed) && /\$[\d,]+/.test(filed) && /New Hampshire Secretary of State/i.test(filed),
        `the money pane reads: ${filed.replace(/\s+/g, " ").slice(0, 200)}`,
      );
    }

    const absent = await readMoney(page, ABSENT_CANDIDATE);
    if (absent === null) {
      cannotRun("SC0831", MONEY[1][1], `the ballot did not open a card for ${ABSENT_CANDIDATE}`);
    } else {
      /*
       * The false-zero rule, read off the surface. The absence must SAY it is
       * an absence, must name whose it is, and must not put a dollar figure on
       * a campaign the registry told us nothing about.
       */
      check(
        "SC0831",
        MONEY[1][1],
        /No reports on file/i.test(absent) &&
          !/not a statement/i.test(absent) &&
          !/\$\s?0\b/.test(absent),
        `the money pane reads: ${absent.replace(/\s+/g, " ").slice(0, 220)}`,
      );
    }
  } finally {
    await page.context().close();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// W6H3 — the zip fly-in does not re-query the map on every frame of itself.
// ═══════════════════════════════════════════════════════════════════════════

section(
  "W6H3. The fly-in's per-frame cost, and its host-normalized frame rate (W6 H3, 2026-08-31)",
);

{
  /*
   * **WHAT THIS ASSERTS, AND WHY IT IS A COUNT RATHER THAN A FRAME RATE.**
   *
   * Entering a zip flies the camera for 2600 ms. Two effects in
   * `components/map/map-canvas.tsx` were subscribed straight to `sourcedata`,
   * and `drawnDistrictsOn` runs a full-viewport `queryRenderedFeatures` across
   * eight district line layers. A fly-to crossing eight zoom levels re-tiles
   * every one of those eight GeoJSON sources repeatedly, so the measured cost
   * of one flight was:
   *
   * ```
   * 170 sourcedata events, 170 queryRenderedFeatures calls, 555ms of MAIN
   * THREAD inside a 2837ms animation — a fifth of the flight spent computing
   * answers the next frame threw away
   * ```
   *
   * `onSettledSourceChange` now drops those passes while `map.isMoving()` and
   * runs once on `moveend`. `pnpm measure:flyin` is the full instrument; this
   * is the one line of it that has to hold on every deploy.
   *
   * **THIS BLOCK NOW CARRIES TWO ASSERTIONS, AND THEY ARE NOT REDUNDANT.**
   *
   * 1. **The call count**, here, which does not move with host load. It was 170
   *    of 170; it is a handful; a regression that re-subscribes either effect
   *    to raw `sourcedata` puts it back into the hundreds no matter what else
   *    the machine is doing.
   * 2. **The host-normalized frame rate**, at the foot of this block, added by
   *    the amendment of 2026-08-31. It replaced an ABSOLUTE 55 fps
   *    target that was never assertable here: on the machine this was written
   *    on — seven agents building in parallel — the same build measured 29.5,
   *    31.6, 33.7, 36.1 and 38.2 fps p95-sustained across five consecutive
   *    runs. A `>= 55` assertion would have gone red on a healthy build, and a
   *    check that goes red on healthy builds is a check nobody reads. The
   *    amendment keeps the frame rate assertable by making it RELATIVE to a
   *    bare MapLibre map measured on the same host in the same minutes — see
   *    the long note at the foot of this block for the design and the load
   *    controls.
   *
   * Neither one substitutes for the other. The median rate is robust to a
   * single scheduling hiccup and therefore blind to concentrated jank; the call
   * count is blind to everything except its own mechanism.
   */
  const context = await browser.context({
    extraHTTPHeaders: RUN_HEADERS,
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
    /*
     * **NOT `reducedMotion: "reduce"`, unlike every other context in this
     * file.** `prefersReducedMotion()` short-circuits the fly-in to
     * `map.jumpTo`, so a reduced-motion context measures a fly-in that never
     * happens and reports a perfect score for it.
     */
    reducedMotion: "no-preference",
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
        // The read below fails honestly if the app never resolved a zip.
      }
    },
    { zip: "85701" },
  );
  const page = await context.newPage();
  page.on("response", (r) => countProbe(r.url()));
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 90_000 });

  // R49: the map instance is on the page, rather than N seconds have passed.
  const ready = await until(
    page,
    () =>
      page.evaluate(() => Boolean((window as unknown as { __wtpMap?: unknown }).__wtpMap)),
    30_000,
    150,
    "W6H3 __wtpMap",
  );
  if (!ready) {
    cannotRun("W6H3", "the zip fly-in does not re-query the map on every frame", "no __wtpMap on the page");
  } else {
    /*
     * **R49: THE SCRIM HAS DRAWN, RATHER THAN 2.5 SECONDS HAVE PASSED.**
     *
     * Flying before the state-focus overlay exists would measure a LIGHTER
     * page than a reader's and quietly flatter the build. The first version of
     * this wait was a fixed 2,500 ms on the grounds that there is no event for
     * "the scrim has drawn" — but there is an OUTCOME for it, which is the
     * scrim's own paths being in the DOM, and an outcome is always the better
     * instrument. A slow host now waits longer instead of measuring the wrong
     * page, and a build that never draws the scrim says so below rather than
     * silently scoring a lighter flight.
     */
    const scrimDrawn = await until(
      page,
      () =>
        page.evaluate(
          () => document.querySelectorAll(".state-focus-layer path").length > 0,
        ),
      20_000,
      150,
      "W6H3 state-focus scrim",
    );
    /* Not reported here: it joins the disposition chain below, so this block
       cannot both decline and then assert on the same run. */

    /*
     * The probe, as a STRING for the reason `scripts/browser.mts` gives for
     * its own: tsx rewrites named functions through a `__name` helper the page
     * does not have. No regex and no backtick inside it — a backtick would
     * close this template, and a regex would lose its escapes.
     */
    const FLY_PROBE = `(() => {
      const w = window;
      const map = w.__wtpMap;
      if (!map) return false;
      const probe = { frames: [], sourcedata: 0, qrf: 0, running: false };
      w.__wtpFlyProbe = probe;
      map.on("sourcedata", () => { if (probe.running) probe.sourcedata += 1; });
      const real = map.queryRenderedFeatures.bind(map);
      map.queryRenderedFeatures = function (...args) {
        if (probe.running) probe.qrf += 1;
        return real(...args);
      };
      /*
        THE FRAME WINDOW CLOSES ON TIME; THE CALL COUNTER KEEPS COUNTING.

        These two measurements want different windows and used to share one.
        The frame rate is about a FIXED 2600ms animation, so its window must be
        fixed too — extending it would fold post-flight idle frames into the
        average and quietly improve the number. The call count is about work
        that happens ON ARRIVAL, one animation frame after moveend, so its
        window has to outlast the flight or it reads zero for work that did
        happen. So the recorder stops pushing frames at the deadline and the
        loop keeps running for the counters.
      */
      const tick = () => {
        if (!probe.running) return;
        if (performance.now() < probe.frameDeadline) probe.frames.push(performance.now());
        else probe.windowClosed = true;
        w.requestAnimationFrame(tick);
      };
      probe.run = (opts, windowMs) => {
        probe.frames = [];
        probe.sourcedata = 0;
        probe.qrf = 0;
        probe.running = true;
        probe.windowClosed = false;
        probe.frameDeadline = performance.now() + windowMs;
        w.requestAnimationFrame(tick);
        if (opts) map.flyTo(opts);
      };
      probe.stop = () => { probe.running = false; };
      /*
        THE CAMERA IS PARKED AND ITS TILES HAVE LANDED — an OUTCOME the Node
        side can wait on, so neither run has to guess how long a jumpTo takes
        to settle. Both runs must start from the identical camera or the
        control is not a control.
      */
      probe.parked = () => !map.isMoving() && map.areTilesLoaded();
      return true;
    })()`;
    await page.evaluate(FLY_PROBE);

    // Both walks start at the continent, which is where a reader with no
    // remembered camera actually starts.
    /*
     * **R49 THROUGHOUT THIS SEQUENCE: every wait below is an OUTCOME.**
     *
     * The sampling window is still a fixed 2,800 ms — it has to be, because the
     * frame rate is about a fixed 2,600 ms animation and a window that stretched
     * with the host would fold post-flight idle frames into the average and
     * quietly improve the number. But the fixed duration now runs IN THE PAGE,
     * where it is the instrument, and the Node side waits for the window to
     * report itself CLOSED. That is the difference R49 is about: a blind
     * `waitForTimeout` here could not tell "the window closed" from "the page
     * never started", and would read the second as the first.
     */
    /*
     * `park` and `sampled` take their PAGE as an argument rather than closing
     * over the one above, because the host-normalized criterion below flies a
     * SECOND page — a bare MapLibre map with this product's layers removed —
     * and both pages have to be driven through the identical sequence. A helper
     * that silently only ever drove page A would make the bare arm's numbers
     * come from a page that never flew.
     */
    const park = async (target: Page, label: string): Promise<boolean> => {
      await target.evaluate(`window.__wtpMap.jumpTo({ center: [-98.5, 39.5], zoom: 3.2 })`);
      return until(
        target,
        () => target.evaluate(`window.__wtpFlyProbe.parked()`) as Promise<boolean>,
        10_000,
        50,
        label,
      );
    };
    const sampled = (target: Page, label: string): Promise<boolean> =>
      until(
        target,
        () => target.evaluate(`window.__wtpFlyProbe.windowClosed === true`) as Promise<boolean>,
        15_000,
        100,
        label,
      );

    // Both walks start at the continent, which is where a reader with no
    // remembered camera actually starts.
    const parkedForControl = await park(page, "W6H3 camera parked (control)");

    // The CONTROL first: the same frame clock, on the same page, in the same
    // second, with the camera standing still. It carries this host's load in
    // its own number, which is what makes the flight number readable.
    await page.evaluate(`window.__wtpFlyProbe.run(null, 2800)`);
    const controlSampled = await sampled(page, "W6H3 control frame window");
    const control = (await page.evaluate(
      `(() => { const p = window.__wtpFlyProbe; p.stop(); return { frames: p.frames }; })()`,
    )) as { frames: number[] };

    const parkedForFlight = await park(page, "W6H3 camera parked (flight)");
    // The options are the fly-in's own, copied from map-canvas.tsx.
    await page.evaluate(
      `window.__wtpFlyProbe.run({ center: [-110.9747, 32.2226], zoom: 11, duration: 2600, essential: true, curve: 1.5 }, 2800)`,
    );
    const flightSampled = await sampled(page, "W6H3 flight frame window");
    /*
     * **R49: WAIT FOR THE ARRIVAL, NOT FOR A DURATION.**
     *
     * The first run of this check measured exactly ONE deferred query — the
     * floor, with no margin. That pass runs on the animation frame after
     * `moveend`, and a fixed window that happens to close between the two reads
     * zero and fails the floor on a build with nothing wrong with it. This is
     * the R49 shape: the frame window above is fixed because the animation is,
     * and this one waits on the OUTCOME. The read below is unconditional, so a
     * pass that genuinely never happens still fails on the truth.
     */
    await until(
      page,
      () => page.evaluate(`window.__wtpFlyProbe.qrf >= 1`) as Promise<boolean>,
      5_000,
      150,
      "W6H3 moveend settle",
    );
    const flight = (await page.evaluate(
      `(() => {
        const p = window.__wtpFlyProbe;
        p.stop();
        return { frames: p.frames, sourcedata: p.sourcedata, qrf: p.qrf, zoom: window.__wtpMap.getZoom() };
      })()`,
    )) as { frames: number[]; sourcedata: number; qrf: number; zoom: number };

    /*
     * **DID THE CAMERA ACTUALLY FLY?** The g3 pin check reported "11 to 11 to
     * 11" while its gesture landed on an overlay and the map never moved. A
     * fly-in check has the same failure available to it and it is worse, because
     * a map that never flew renders a flawless 60 fps and a call count of zero
     * — a green check for an experiment that did not run.
     */
    const flew = flight.zoom > 5;
    /*
     * A window with fewer than three timestamps has no interval to measure, so
     * it says so instead of returning a rate. `0.0 fps` on this line would read
     * as a frozen fly-in when it means the recorder never started — the same
     * false-zero the product's own render rules forbid, one layer down.
     */
    const fps = (times: number[]): string => {
      if (times.length < 3) return `NOT MEASURED (${times.length} frame timestamps)`;
      const gaps: number[] = [];
      for (let i = 1; i < times.length; i += 1) gaps.push(times[i] - times[i - 1]);
      gaps.sort((a, b) => a - b);
      const p95 = gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * 0.95))];
      return `${(1000 / p95).toFixed(1)} fps`;
    };
    const controlFps = fps(control.frames);
    const flightFps = fps(flight.frames);
    /*
     * **THE RENDERER IS NAMED, OR THE FRAME RATE BELOW IS UNREADABLE.**
     *
     * This suite launches through `launchGuarded` with no GPU flags, and
     * Playwright adds `--enable-unsafe-swiftshader` — so every WebGL pixel here
     * is rasterised on the CPU. Measured on this machine: a MapLibre fly-to with
     * NOTHING of ours on the map sustained 8.1 fps under SwiftShader. A
     * single-digit number on this line is the rasteriser saying so, not a
     * regression, and a session reading it needs to be told which one it got.
     * `pnpm measure:flyin` runs the same flight on the GPU.
     *
     * **AND IT IS ALSO WHY THE ASSERTION BELOW IS RELATIVE.** The rasteriser
     * changes both arms together, so the normalized criterion at the foot of
     * this block reads the same on either one. (The figure that used to sit on
     * this line — "41.3 on the real adapter" — was WITHDRAWN on 2026-08-31: the
     * ablation it came from was healing mid-flight, so that number described a
     * fully loaded map, not a bare one. See the ablation's own note.)
     */
    const renderer = String(
      await page.evaluate(`(() => {
        const c = document.createElement("canvas");
        const gl = c.getContext("webgl2") || c.getContext("webgl");
        if (!gl) return "NO WEBGL";
        const dbg = gl.getExtension("WEBGL_debug_renderer_info");
        return dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : "UNKNOWN";
      })()`),
    );
    const software = renderer.toLowerCase().includes("swiftshader");

    /*
     * **ONE DISPOSITION, READ BY BOTH CHECKS.**
     *
     * This block now carries TWO assertions — the load-invariant call count and
     * the host-normalized frame-rate criterion — and every condition
     * below invalidates both of them for the same reason: the page under
     * measurement is not the page a reader gets, or the camera never flew, or
     * the sample was cut short. Deriving the reason ONCE and having both checks
     * consult it is what stops the pair from drifting into a state where one
     * declines and the other asserts on the very run that just declined.
     */
    const COUNT_CHECK = "the zip fly-in does not re-query the whole viewport on every frame of itself";
    const NORM_CHECK =
      "the fly-in holds 90% of a bare MapLibre fly-in's median frame rate on this host";
    /**
     * **THE SECOND POPULATION, ADDED 2026-09-01 — AND IT IS NOT A SECOND
     * OPINION ABOUT THE FIRST.**
     *
     * The check above asks what the fly-in costs a reader with a GPU. This asks
     * what it costs a reader without one, and until this session that question
     * was DECLINED here with its numbers named — the right call while nothing
     * had been done about it, and the wrong place to leave it once something
     * had. The host can run both rasterisers deterministically: `GPU_ARGS`
     * requests the real adapter and the suite's own default launch gets
     * SwiftShader, and both runs read their renderer back rather than trusting
     * the request.
     *
     * The two are never averaged and never share a floor. Hardware answers to
     * the 90% floor; software answers to `SOFTWARE_NORMALIZED_FLOOR` AND to
     * `SOFTWARE_JANK_CEILING`, because a build measured at 89% of bare with a
     * quarter of its frames past 33.4 ms is what proved the median alone is not
     * enough here.
     */
    const SOFT_CHECK =
      "the fly-in on a browser with NO GPU acceleration holds " +
      `${(SOFTWARE_NORMALIZED_FLOOR * 100).toFixed(0)}% of a bare MapLibre fly-in and stays ` +
      `under ${(SOFTWARE_JANK_CEILING * 100).toFixed(0)}% long frames`;
    const blockedReason: string | null = !scrimDrawn
      ? /* The page never reached a reader's weight, so the flight would be
           measuring a lighter map than the one this check is about. */
        "the state-focus scrim never drew, so the flight would measure a lighter page than a reader's"
      : !parkedForControl || !parkedForFlight
        ? /* The two runs did not start from the identical camera, so the control
             is not a control and the comparison has no meaning. */
          "the camera never parked at the continent between runs, so the control and the flight " +
          "did not start from the same place"
        : !controlSampled || !flightSampled
          ? /* The in-page frame window never reported itself closed — the sample
               was cut short or never started, and a short sample is not a fast one. */
            "the in-page frame window never closed, so the frames read are an incomplete sample"
          : !flew
            ? `the camera ended at zoom ${flight.zoom.toFixed(1)} — it never left the continent`
            : flight.sourcedata === 0
              ? /*
                 * No source re-tiled, so the ratio this check is about has no
                 * denominator (RULING 159). That is a real state — a build serving
                 * no district geometry — and it is not this check passing.
                 */
                "the flight fired no sourcedata events, so no district source re-tiled"
              : null;

    if (blockedReason !== null) {
      cannotRun("W6H3", COUNT_CHECK, blockedReason);
      cannotRun("W6H3", NORM_CHECK, blockedReason);
      cannotRun("W6H3", SOFT_CHECK, blockedReason);
    } else {
      /*
       * THE CEILING. Measured at 5-8 calls per flight across every run of
       * `pnpm measure:flyin` after the fix, against 170 before it. Twenty is
       * generous enough that a slow host firing extra sourcedata bursts between
       * camera moves cannot trip it, and far below the hundreds that a
       * re-subscription to raw `sourcedata` produces.
       */
      /*
       * **BOTH HALVES, OR THIS CHECK REWARDS THE WRONG FIX.**
       *
       * A ceiling on its own says "do less", and the cheapest way to satisfy
       * "do less" is to do NOTHING — unsubscribe the effects and the count goes
       * to zero and this check goes green while the districts card never
       * updates again. The floor is what makes the ceiling safe: the deferred
       * pass must still be PAID, once, when the camera lands. That is the exact
       * failure mode `onSettledSourceChange` introduces by deferring at all —
       * if `moveend` ever stops settling the debt, the work is not slow, it is
       * gone — so the check that authorises the deferral is the one that has to
       * prove the arrival still happens.
       */
      check(
        "W6H3",
        COUNT_CHECK,
        flight.qrf <= 20 && flight.qrf >= 1,
        `${flight.qrf} queryRenderedFeatures calls across ${flight.sourcedata} sourcedata ` +
          `events in one 2600ms fly-in (floor 1, ceiling 20; it was 170 of 170 before W6 H3, ` +
          "and the floor is what proves moveend still pays the deferred pass) — " +
          `descriptive frame rate this run: ${flightFps} p95-sustained in flight against a ` +
          `${controlFps} standing-still control on the same host, ` +
          `${flight.frames.length} frames measured, on ${software ? "the SOFTWARE rasteriser" : "a hardware GPU"} ` +
          `(${renderer}). THIS CHECK ASSERTS THE COUNT, NOT THAT RATE; the frame rate is ` +
          "asserted by the host-normalized criterion on the next line.",
      );

      /* ═══════════════════════════════════════════════════════════════════
         THE HOST-NORMALIZED CRITERION — amended 2026-08-31
         ═══════════════════════════════════════════════════════════════════

         ## What was here before, and why it could not stay

         W6 H3 shipped with the frame rate REPORTED and never asserted, on the
         explicit grounds that an absolute target — 55 fps — is a fact about the
         host rather than about the build. The evidence for that was not
         marginal: on the machine this was written on, a MapLibre map flying
         with EVERY district layer, every marker and the whole state-focus layer
         removed reached only 41.3 fps p95-sustained. A `>= 55` assertion was
         unreachable there by a map with nothing on it.

         The amendment replaced the absolute rather than lowering it. The
         criterion: run the identical fly-in repeatedly on (a) bare MapLibre
         with application layers/overlays removed and (b) the actual
         application, and report median FPS and frame-time/jank for both. It
         passes when application median FPS >= 90% of bare-map median FPS on
         that host. If the bare map itself cannot reach smooth motion, that
         host limit is reported numerically and does not waive the relative
         requirement. This is the permanent performance check.

         The bare map IS this host's ceiling, measured on the day rather than
         chosen in advance. It carries the rasteriser, the GPU, the refresh rate
         and whatever else is compiling on the box, in its own number. What is
         left over — the ratio — is the only part that belongs to this product,
         and a slow host lowers BOTH arms, so contention cannot fake a pass or a
         fail.

         ## HOW HOST LOAD IS CONTROLLED FOR, since it is the whole confound

         Six or seven worktree lanes build and test on this machine at once, and
         load ARRIVES and LEAVES in bursts of minutes. Measuring one arm as a
         block and the other as a second block hands any load change entirely to
         whichever arm was running, and the ratio then reports another agent's
         `pnpm build` as a regression in this product.

         So the arms are INTERLEAVED at the individual flight, and the order
         within each pair ALTERNATES:

             pair 1:  app,  bare        pair 3:  app,  bare
             pair 2:  bare, app         ...

         Interleaving means a burst spanning a pair lands on one run of each
         arm. Alternating the order means a systematic second-position advantage
         — a warmer cache, a JITed animation — cannot accumulate onto one arm
         either. Neither makes the host quiet; together they make it impossible
         for the host to be quiet for one arm and busy for the other, which is
         the only property the ratio needs. The measured CPU busy percentage is
         recorded per flight and PRINTED in the evidence, because a future
         session reading a red result has to be able to tell a regression from a
         busy machine, and it cannot do that from a ratio alone.

         ## WHY THE MEDIAN, AND WHY THE COUNT CHECK ABOVE STAYS

         The median is robust to exactly the single-frame hiccup that made the
         p95 statistic swing between 27.5 and 45.2 fps across five consecutive
         runs of one unchanged build. That robustness is why it was chosen —
         and it is also why it is BLIND to concentrated jank: the pre-fix
         build running 170 full-viewport queries through one animation had a
         median of 59.5 fps, a perfect median over a visibly broken flight,
         because its damage was 15 long frames out of 127. The median criterion
         is necessary and it is NOT sufficient, so the call count above is
         retained as the mechanism-level guard and the jank is reported with its
         threshold named. Neither substitutes for the other. */
      /*
       * **BOTH ARMS RUN ON A SECOND BROWSER, REQUESTED ONTO THE REAL ADAPTER,
       * AND THAT IS THE MOST CONSEQUENTIAL LINE IN THIS BLOCK.**
       *
       * The suite's own browser launches through `launchGuarded` with no GPU
       * flags, and Playwright adds `--enable-unsafe-swiftshader`, so every
       * WebGL pixel in the rest of this file is rasterised on the CPU. That is
       * a harness condition, not a reader's machine — and measured on
       * 2026-08-31 it is the difference between passing and failing:
       *
       * ```
       * hardware GPU (Intel Iris Xe):  app 59.9 / bare 60.1 fps median = 99.7%
       * software (SwiftShader):        app 15.4 / bare 59.9 fps median = 25.8%
       *                               app jank 124 of 127 frames over 33.4ms
       * ```
       *
       * **THE SOFTWARE ROW IS A REAL MEASUREMENT AND IT IS NOT THE ONE THIS
       * ASSERTS.** Note what makes it readable: the BARE map reaches 60 fps on
       * the software rasteriser too. SwiftShader is not too slow to fly a map;
       * it is too slow to fly THIS map. So the row is a genuine statement about
       * what this product's overlay stack costs when a reader has no GPU
       * acceleration — a real population (old machines, VMs, remote desktop,
       * blocklisted drivers, hardware acceleration switched off) — and it is
       * recorded here rather than smoothed away. It is a separate question from
       * the one this check asks, which is what the fly-in costs against a bare
       * map, and the answer to THAT is measured where a reader lives.
       *
       * A run that does not get the real adapter DECLINES rather than asserting
       * the software number: RULING 184's shape — a harness condition may never
       * become a fact about the build — and the renderer is read back on every
       * run so a silent fallback says so instead of quietly changing what was
       * measured.
       */
      /**
       * What one rasteriser's pass hands back. Every field is EVIDENCE and none
       * of them is a verdict: the two call sites below decide, because the
       * hardware population and the software population answer to different
       * floors and a shared verdict would eventually apply one to the other.
       */
      interface ArmsResult {
        /** The renderer string read back off the live context, never assumed. */
        renderer: string;
        /** Whether that string names the CPU rasteriser. */
        software: boolean;
        /** Both arms produced a `__wtpMap` to fly. */
        bareReady: boolean;
        /** Both arms drew the scrim, so both reached a reader's weight. */
        bareScrim: boolean;
        /** How many layers, sources and markers the bare ablation removed. */
        stripped: number;
        /** Bare flights discarded because the map healed during them. */
        healed: number;
        /** How many pairs were attempted; the denominator both arms must fill. */
        pairs: number;
        app: { gaps: number[]; hostBusyPct: number | null }[];
        bare: { gaps: number[]; hostBusyPct: number | null }[];
      }

      /**
       * **ONE PASS, RUN TWICE, ON TWO RASTERISERS.** (Session C, 2026-09-01.)
       *
       * This body used to exist once, hard-wired to `GPU_ARGS`, and the software
       * question was answered by a `cannotRun` naming last-measured numbers.
       * That was correct while nothing had been done about the software deficit
       * and wrong the moment something had — a check that permanently declines
       * the question it is named for is a check nobody can regress.
       *
       * So the pass takes its launch arguments as a PARAMETER and is called
       * twice: `GPU_ARGS` for the adapter a reader with a GPU has, and the
       * suite's own default launch for the CPU rasteriser (Playwright adds
       * `--enable-unsafe-swiftshader`, which is what the rest of this file has
       * always been running through).
       *
       * **NEITHER CALL TRUSTS ITS OWN REQUEST.** `READ_RENDERER` reads the live
       * string back and the call sites compare it against what they asked for,
       * so a host where the GPU request silently falls back — or where the
       * default launch happens to get a real adapter — DECLINES the affected
       * check with the renderer it actually got, rather than filing one
       * population's numbers under the other's name. RULING 184's shape: a
       * harness condition may never become a fact about the build.
       *
       * A separate browser per rasteriser, because the flags are a launch-time
       * property and cannot be changed on a running one.
       */
      const measureArms = async (
        rasterLabel: string,
        launchArgs: string[],
      ): Promise<ArmsResult> => {
      const gpuBrowser = await launchGuarded({
        label: `walk-all-w6h3-${rasterLabel}`,
        args: launchArgs,
      });
      /** One settled flight page on this browser. Both arms open the same way. */
      const openFlightPage = async (label: string) => {
        const ctx = await gpuBrowser.context({
          extraHTTPHeaders: RUN_HEADERS,
          viewport: { width: 1280, height: 900 },
          deviceScaleFactor: 1,
          /* NOT `reducedMotion: "reduce"` — `prefersReducedMotion()` short-
             circuits the fly-in to `jumpTo`, and a fly-in that never happens
             scores perfectly. */
          reducedMotion: "no-preference",
        });
        await ctx.addInitScript(
          ({ zip }) => {
            try {
              sessionStorage.setItem(
                "wtp.approximate_location",
                JSON.stringify({ zip, savedAt: new Date().toISOString() }),
              );
              localStorage.setItem("wtp.tutorial_seen", "1");
            } catch {
              // The readiness read below fails honestly if the app never resolved.
            }
          },
          { zip: "85701" },
        );
        const p = await ctx.newPage();
        p.on("response", (r) => countProbe(r.url()));
        await p.goto(BASE, { waitUntil: "domcontentloaded", timeout: 90_000 });
        const mapReady = await until(
          p,
          () => p.evaluate(() => Boolean((window as unknown as { __wtpMap?: unknown }).__wtpMap)),
          30_000,
          150,
          `${label} __wtpMap`,
        );
        /* The scrim is an OUTCOME to wait on, and BOTH arms wait for it. The
           bare arm is brought to a reader's weight and only then stripped, so
           the two pages differ in exactly one thing: whether the ablation ran. */
        const scrim = mapReady
          ? await until(
              p,
              () =>
                p.evaluate(() => document.querySelectorAll(".state-focus-layer path").length > 0),
              20_000,
              150,
              `${label} state-focus scrim`,
            )
          : false;
        if (mapReady) await p.evaluate(FLY_PROBE);
        return { ctx, page: p, ready: mapReady, scrim };
      };

      const appArm = await openFlightPage("W6H3 gpu app");
      const bareArm = await openFlightPage("W6H3 gpu bare");
      const barePage = bareArm.page;
      const gpuRenderer = appArm.ready
        ? String(await appArm.page.evaluate(READ_RENDERER))
        : "NOT READ";
      const gpuSoftware = isSoftwareRenderer(gpuRenderer);
      const bareReady = appArm.ready && bareArm.ready;
      const bareScrim = appArm.scrim && bareArm.scrim;
      /*
       * The ablation, as a string for the reason the probe is one: tsx rewrites
       * named functions through a `__name` helper the page does not have. No
       * regex and no backtick inside it.
       *
       * **IT BLOCKS THE RE-ADD BEFORE IT REMOVES ANYTHING, AND THAT ORDER IS
       * THE WHOLE FIX** (2026-08-31). The first version of this removed the
       * district layers and sources and the application put every one of them
       * straight back — measured on a live page as 24 layers and 8 sources
       * before, 45 things removed, and 24 layers and 8 sources IMMEDIATELY
       * after. `syncDistrictLayer` in `lib/map/districts.ts` is deliberately
       * idempotent (`if (!map.getSource(source)) map.addSource(...)`), so a
       * removal is an invitation to the next sync pass to rebuild — and the
       * removal is what provokes the pass. Nothing threw and nothing warned;
       * the page simply healed, and the "bare" arm was a fully loaded map with
       * its markers and scrim hidden.
       *
       * A ratio taken against that arm is the application compared against
       * ITSELF. It reads as a flawless 100% and asserts nothing whatsoever,
       * which is the most dangerous result a check can produce.
       */
      const stripped = bareReady
        ? Number(
            await barePage.evaluate(`(() => {
              const map = window.__wtpMap;
              if (!map) return 0;
              const realAddSource = map.addSource.bind(map);
              const realAddLayer = map.addLayer.bind(map);
              map.addSource = function (id, spec) {
                if (typeof id === "string" && id.indexOf("district-") === 0) return map;
                return realAddSource(id, spec);
              };
              map.addLayer = function (spec, before) {
                if (spec && typeof spec.id === "string" && spec.id.indexOf("district-") === 0) return map;
                return realAddLayer(spec, before);
              };
              let removed = 0;
              const style = map.getStyle() || {};
              for (const l of (style.layers || []).slice()) {
                if (l.id.indexOf("district-") !== 0) continue;
                try { map.removeLayer(l.id); removed += 1; } catch (e) { void e; }
              }
              for (const id of Object.keys(style.sources || {})) {
                if (id.indexOf("district-") !== 0) continue;
                try { map.removeSource(id); removed += 1; } catch (e) { void e; }
              }
              const layer = document.querySelector(".state-focus-layer");
              if (layer) { layer.style.display = "none"; removed += 1; }
              for (const pin of Array.from(document.querySelectorAll(".maplibregl-marker"))) {
                pin.remove();
                removed += 1;
              }
              return removed;
            })()`),
          )
        : 0;

      /*
       * **IS THE BARE MAP STILL BARE?** Read at the END of every bare flight.
       *
       * The ablation reports what it REMOVED, and that claim was true on every
       * run while the experiment was invalid. Only a readback after the camera
       * lands can tell a bare map from one that healed mid-flight, so this runs
       * per flight and a healed flight is DISCARDED. A dropped flight lowers a
       * denominator, which the disposition below notices; a healed flight
       * silently rewrites what the ratio means, which nothing would.
       */
      const BARE_INTACT = `(() => {
        const map = window.__wtpMap;
        if (!map) return { ok: false, layers: -1, sources: -1, markers: -1, scrimHidden: false };
        const style = map.getStyle() || {};
        const layers = (style.layers || []).filter((l) => l.id.indexOf("district-") === 0).length;
        const sources = Object.keys(style.sources || {}).filter((id) => id.indexOf("district-") === 0).length;
        const markers = document.querySelectorAll(".maplibregl-marker").length;
        const el = document.querySelector(".state-focus-layer");
        const scrimHidden = el ? el.style.display === "none" : true;
        return {
          ok: layers === 0 && sources === 0 && markers === 0 && scrimHidden,
          layers: layers,
          sources: sources,
          markers: markers,
          scrimHidden: scrimHidden,
        };
      })()`;
      let bareHealed = 0;

      /**
       * One flight, driven identically on whichever page it is handed.
       *
       * Returns the frame INTERVALS, or null when the flight cannot be counted
       * — the camera never parked, the window never closed, the map never left
       * the continent, or too few frames to form an interval. A null is dropped
       * from the arm's denominator rather than folded in as a slow flight: a
       * flight that did not happen is not a slow flight, and RULING 159's whole
       * point is that the two must never share a number.
       */
      const flyOnce = async (target: Page, label: string): Promise<number[] | null> => {
        if (!(await park(target, `${label} park`))) return null;
        await target.evaluate(
          `window.__wtpFlyProbe.run({ center: [-110.9747, 32.2226], zoom: 11, duration: 2600, essential: true, curve: 1.5 }, 2800)`,
        );
        const closed = await sampled(target, `${label} window`);
        const out = (await target.evaluate(
          `(() => { const q = window.__wtpFlyProbe; q.stop(); return { frames: q.frames, zoom: window.__wtpMap.getZoom() }; })()`,
        )) as { frames: number[]; zoom: number };
        if (!closed || !(out.zoom > 5) || out.frames.length < 3) return null;
        return frameGaps(out.frames);
      };

      /*
       * A DISCARDED WARM-UP ON EACH PAGE, and it is not politeness.
       *
       * Both pages are freshly loaded here, so the FIRST flight on either one
       * pays a cold-start cost — a first compile of the animation path, a first
       * pass through the projection code — that none of the counted flights
       * should carry. Warming both rather than one is the point: warming only
       * the bare arm would move that cost onto the ratio's denominator and
       * flatter the application by exactly the amount it hurt the bare map.
       */
      if (bareReady) {
        await flyOnce(appArm.page, "W6H3 app warm-up");
        await flyOnce(barePage, "W6H3 bare warm-up");
      }

      const PAIRS = 3;
      const appGaps: { gaps: number[]; hostBusyPct: number | null }[] = [];
      const bareGaps: { gaps: number[]; hostBusyPct: number | null }[] = [];
      /*
       * **THE RENDERER IS NOT IN THIS GATE ANY MORE, AND THAT IS THE POINT.**
       *
       * It used to read `&& !gpuSoftware`, which was right when the software
       * answer was permanently declined: there was no reason to fly six flights
       * whose numbers would be thrown away. Now BOTH rasterisers are measured,
       * so the flights always happen and whether the renderer was the one asked
       * for is decided at the CALL SITE, against that population's own floor.
       * The conditions left here are the ones that make the flights meaningless
       * whatever the adapter is.
       */
      if (bareReady && bareScrim && stripped > 0) {
        for (let pair = 1; pair <= PAIRS; pair += 1) {
          const order: ("app" | "bare")[] = pair % 2 === 1 ? ["app", "bare"] : ["bare", "app"];
          for (const arm of order) {
            const target = arm === "app" ? appArm.page : barePage;
            const ticksBefore = cpuTicks();
            const gaps = await flyOnce(target, `W6H3 ${arm} pair ${pair}`);
            const hostBusyPct = busyPct(ticksBefore, cpuTicks());
            if (gaps === null) continue;
            if (arm === "bare") {
              const intact = (await barePage.evaluate(BARE_INTACT)) as { ok: boolean };
              if (!intact.ok) {
                bareHealed += 1;
                continue;
              }
            }
            (arm === "app" ? appGaps : bareGaps).push({ gaps, hostBusyPct });
          }
        }
      }

      await appArm.ctx.close();
      await bareArm.ctx.close();
      await gpuBrowser.close();
      return {
        renderer: gpuRenderer,
        software: gpuSoftware,
        bareReady,
        bareScrim,
        stripped,
        healed: bareHealed,
        pairs: PAIRS,
        app: appGaps,
        bare: bareGaps,
      };
      /*
       * The closing brace of `measureArms`. **ITS BODY IS DELIBERATELY NOT
       * RE-INDENTED**, and that is a reviewability decision rather than an
       * oversight: this block became a function without one line of its logic
       * changing, and re-indenting three hundred lines would have buried that
       * fact under three hundred lines of whitespace diff. The change worth
       * reading is the parameterised launch at the top and the two call sites
       * below.
       */
      };

      /**
       * Everything that invalidates a pass on EITHER rasteriser, in one place.
       *
       * Returns the reason or null. Shared rather than written twice, because
       * two copies of a six-branch disposition drift, and the branch that drifts
       * is the one nobody re-reads. What is NOT here is the renderer test: that
       * is the one condition whose meaning differs between the two populations,
       * and each call site states its own.
       */
      const armsBlocked = (r: ArmsResult): string | null => {
        if (!r.bareReady) return "the bare-map arm never produced a __wtpMap to fly";
        if (!r.bareScrim) {
          return (
            "the bare arm's scrim never drew, so it was never brought to a reader's weight " +
            "before being stripped — the two arms would not differ in exactly one thing"
          );
        }
        if (r.stripped === 0) {
          /* The ablation matched nothing, so the "bare" arm is a fully loaded
             page and the ratio would be a page compared against itself — which
             reads as a flawless 1.00 and asserts nothing at all. */
          return (
            "the bare ablation removed NOTHING, so the bare arm is not bare and the ratio " +
            "would be this page compared against itself"
          );
        }
        if (r.healed > 0) {
          /* The application put its district layers back on the "bare" map
             during the flight, so that arm is not a bare map. */
          return (
            `${r.healed} of ${r.pairs} bare flights HEALED mid-flight — the application ` +
            "re-added its district layers to the stripped map, so the bare arm is not bare"
          );
        }
        if (r.app.length < r.pairs || r.bare.length < r.pairs) {
          /* A missing flight is not a slow flight. Both arms must carry the full
             denominator or the medians are taken over different populations. */
          return (
            `only ${r.app.length} of ${r.pairs} application flights and ${r.bare.length} of ` +
            `${r.pairs} bare flights completed — the arms would not share a denominator`
          );
        }
        return null;
      };

      /** The frame-time and jank sentence both populations report identically. */
      const armsDetail = (app: ArmSummary, bare: ArmSummary, r: ArmsResult): string =>
        `application median ${app.medianFps.toFixed(1)} fps over ${app.runs} flights, bare map ` +
        `${bare.medianFps.toFixed(1)} fps over ${bare.runs} flights, ${r.pairs} INTERLEAVED ` +
        `pairs with alternating within-pair order. Means ${app.meanFps.toFixed(1)} and ` +
        `${bare.meanFps.toFixed(1)} fps; a mean below its median is a stall the median hid. ` +
        `Frame time app p50 ${app.frameMs.p50.toFixed(1)}ms / p95 ${app.frameMs.p95.toFixed(1)}ms / ` +
        `p99 ${app.frameMs.p99.toFixed(1)}ms / max ${app.frameMs.max.toFixed(1)}ms, bare ` +
        `p50 ${bare.frameMs.p50.toFixed(1)}ms / p95 ${bare.frameMs.p95.toFixed(1)}ms / ` +
        `p99 ${bare.frameMs.p99.toFixed(1)}ms / max ${bare.frameMs.max.toFixed(1)}ms. ` +
        `JANK over ${LONG_FRAME_MS}ms: app ${app.longFrames}/${app.framesMeasured} frames, ` +
        `bare ${bare.longFrames}/${bare.framesMeasured} frames. ` +
        `${r.stripped} layers, sources and markers removed for the bare arm, and every bare ` +
        "flight read back 0 district layers, 0 sources and 0 markers AT LANDING. " +
        "THE ABSOLUTE RATE IS A FACT ABOUT THIS HOST; ONLY THE RATIO IS ASSERTED.";

      /* ─────────────────────────────────────────────────────────────────────
         POPULATION 1 — A READER WITH A GPU. The 90% criterion.
         ───────────────────────────────────────────────────────────────────── */
      const hw = await measureArms("gpu", GPU_ARGS);
      const hwBlocked = armsBlocked(hw);
      if (hwBlocked !== null) {
        cannotRun("W6H3", NORM_CHECK, hwBlocked);
      } else if (hw.software) {
        /*
         * The GPU request did not land, so this arm is on the CPU rasteriser and
         * its numbers belong to the OTHER population. RULING 184's shape: a
         * harness condition may never become a fact about the build. The
         * software check below still runs and still asserts, so declining here
         * loses no coverage — it only refuses to file one population's numbers
         * under the other's floor.
         */
        cannotRun(
          "W6H3",
          NORM_CHECK,
          `the GPU request fell back to the SOFTWARE rasteriser (${hw.renderer}), so this arm ` +
            "measured the CPU-rasterised population rather than a reader with a GPU. That " +
            "population has its own check on the next line and it is not waived by this " +
            "decline. Run `pnpm measure:flyin --normalized` for the full instrument",
        );
      } else {
        const app = summariseArm("application", hw.app);
        const bare = summariseArm("bare MapLibre", hw.bare);
        const verdict = judgeNormalized(app, bare);
        check(
          "W6H3",
          NORM_CHECK,
          verdict.pass,
          `RATIO ${(verdict.ratio * 100).toFixed(1)}% against the ` +
            `${(NORMALIZED_FLOOR * 100).toFixed(0)}% floor — ${armsDetail(app, bare, hw)} ` +
            `HOST CONDITION: ${hostCondition(verdict)}; measured on the hardware GPU ` +
            `(${hw.renderer}) rather than through this suite's default rasteriser (${renderer}).`,
        );
      }

      /* ─────────────────────────────────────────────────────────────────────
         POPULATION 2 — A READER WITH NO GPU ACCELERATION. (Session C.)

         Older machines, virtual machines, remote desktop, blocklisted drivers,
         hardware acceleration switched off. This block used to DECLINE this
         question permanently, naming the numbers, which was the honest thing to
         do while nothing had been done about them: 28.8% of a bare map, 17.2 fps
         median against 59.9, 189 of 194 frames over 33.4ms — with the bare map
         reaching 60 fps on the SAME rasteriser, which is what made the deficit
         ours rather than SwiftShader's.

         Something has now been done about it, so the question is ASSERTED. The
         floor is lower than the hardware floor and it is stated rather than
         chosen quietly: the repair deliberately stands treatments down while the
         camera moves, so this arm is not being asked to match a bare map as
         closely. The jank ceiling is not optional decoration beside it — a build
         measured at 89% of bare with 57 of 231 frames past 33.4ms is exactly
         what proved the median alone cannot close this question.
         ───────────────────────────────────────────────────────────────────── */
      /*
       * NO GPU FLAGS, which is how this run GETS the CPU rasteriser: Playwright
       * launches Chromium with `--enable-unsafe-swiftshader`, and that is what
       * every other check in this file has always been running through.
       */
      const sw = await measureArms("software", []);
      const swBlocked = armsBlocked(sw);
      if (swBlocked !== null) {
        cannotRun("W6H3", SOFT_CHECK, swBlocked);
      } else if (!sw.software) {
        /*
         * **THE HOST CANNOT PRODUCE THIS POPULATION DETERMINISTICALLY.** The
         * default launch came back on a real adapter, so there is no CPU-
         * rasterised arm to assert about and the numbers in hand describe a
         * reader with a GPU — who is already covered above. Declining with the
         * renderer named is the only honest output; asserting the software floor
         * against a hardware run would be a pass nobody measured.
         */
        cannotRun(
          "W6H3",
          SOFT_CHECK,
          `this suite's default launch came back on a HARDWARE adapter (${sw.renderer}) rather ` +
            "than the CPU rasteriser, so this host cannot produce the no-GPU population on " +
            "demand and there is nothing here to assert it against. Measured on 2026-09-01 on a " +
            "host that could: 49.9 fps median application against 54.2 bare = 92.0%, jank 20 of " +
            "771 frames. Run `FLYIN_SOFTWARE=1 pnpm measure:flyin --normalized` to reproduce",
        );
      } else {
        const app = summariseArm("application", sw.app);
        const bare = summariseArm("bare MapLibre", sw.bare);
        const verdict = judgeSoftware(app, bare);
        check(
          "W6H3",
          SOFT_CHECK,
          verdict.pass,
          `RATIO ${(verdict.ratio * 100).toFixed(1)}% against the ` +
            `${(SOFTWARE_NORMALIZED_FLOOR * 100).toFixed(0)}% software floor ` +
            `(${verdict.ratioPass ? "MET" : "NOT MET"}) and JANK ` +
            `${(verdict.jankFraction * 100).toFixed(1)}% against the ` +
            `${(SOFTWARE_JANK_CEILING * 100).toFixed(0)}% ceiling ` +
            `(${verdict.jankPass ? "MET" : "NOT MET"}) — BOTH are required, because a build ` +
            "measured at 89% of bare with 57 of 231 frames past 33.4ms is what proved the " +
            `median alone cannot close this. ${armsDetail(app, bare, sw)} ` +
            `Measured on the SOFTWARE rasteriser (${sw.renderer}) — a real reader population ` +
            "(older machines, VMs, remote desktop, blocklisted drivers, hardware acceleration " +
            "off), reported as its OWN population and never averaged with the hardware one. " +
            "It was 28.8% before 2026-09-01.",
        );
      }
    }
  }
  await context.close();
}

/* ────────────────────────────────────────────────────────────────────────────
 * SC3 — ARIZONA MONEY REACHES THE READER, AND EVERY CARD ENDS IN ONE STATE
 *
 * The defect this pins was never acquisition. `data/states/az/funding/state-money-az-2026.json`
 * held Katie Hobbs at $11,109,720 while her card showed nothing, because the
 * certified-lineup cards key on `${contest.id}|${nominee.name}` and the money
 * records key on candidacy ids. Two correct halves, one seam, and the seam is
 * the only place it could fail.
 *
 * Measured before the fix, on production and on a local production build that
 * agreed exactly: **4 money sections of 24 cards at 85701, 4 of 29 at 85641**.
 * After: 24 of 24 and 29 of 29, every one in exactly one honest state.
 *
 * **This asserts the FLOOR, not the composition.** A candidate who genuinely
 * files nothing must be free to move from FILED to a sourced absence without
 * going red here. What may never happen again is a card with NO money state at
 * all, which is the shape a broken join takes — silence that reads as "this
 * person raised nothing" when what actually happened is that we asked the wrong
 * question. And the OURS-gap count is CEILINGED rather than pinned, so an
 * identity layer that quietly stops resolving fails here rather than degrading
 * every card to an honest-looking shrug.
 * ──────────────────────────────────────────────────────────────────────────── */

section("SC3. Arizona money reaches the certified-lineup reader (Item 1, 2026-09-01)");

for (const { zip, cards: cardFloor, oursCeiling } of [
  { zip: "85701", cards: 24, oursCeiling: 6 },
  { zip: "85641", cards: 29, oursCeiling: 6 },
] as const) {
  const context = await browser.context();
  const page = await context.newPage();
  try {
    await page.goto(`${BASE}/ballot?zip=${zip}`, { waitUntil: "networkidle" });
    await until(
      page,
      async () => (await page.locator(".candidate-row").count()) > 0,
      15_000,
      150,
      `SC3 ${zip}: candidate cards`,
    );

    /* Open every battlecard, then every Campaign money section. The body is
       `{open && …}` — not hidden, ABSENT — so it has to be clicked open. */
    // Server-rendered cards can precede their click handlers (R52).
    await untilInteractive(page, '.candidate-row button[aria-expanded]');
    await page.evaluate(
      "(() => { for (const b of Array.from(document.querySelectorAll('button'))) " +
        "if ((b.textContent || '').trim() === 'View Battlecard') b.click(); })()",
    );
    await until(
      page,
      async () => (await page.locator(".card-section-title").count()) > 0,
      15_000,
      150,
      `SC3 ${zip}: battlecards open`,
    );
    const opened = await page.evaluate(
      "(() => { let n = 0; for (const t of Array.from(document.querySelectorAll('.card-section-title'))) " +
        "{ if (!/^Campaign money/.test((t.textContent || '').trim())) continue; " +
        "const b = t.closest('button'); if (b) { b.click(); n++; } } return n; })()",
    );
    await until(
      page,
      async () => (await page.locator(".card-section-body").count()) > 0,
      15_000,
      150,
      `SC3 ${zip}: money bodies`,
    );

    const seen = (await page.evaluate(`(() => {
      const titles = Array.from(document.querySelectorAll('.card-section-title'))
        .filter((e) => /^Campaign money/.test((e.textContent || '').trim()));
      const out = { cards: document.querySelectorAll('.candidate-row').length,
                    sections: titles.length, filed: 0, registered: 0, absence: 0,
                    oursGap: 0, federal: 0, silent: 0 };
      for (const t of titles) {
        const section = t.closest('section');
        const el = section && section.querySelector('.card-section-body');
        const body = ((el && el.textContent) || '').replace(/\\s+/g, ' ');
        if (/Raised\\s*\\$/.test(body)) out.filed++;
        else if (/Registered committee/.test(body)) out.registered++;
        else if (/No reports on file/.test(body)) out.absence++;
        else if (/haven\\u2019t matched|haven't matched|haven\\u2019t recorded|haven't recorded/i.test(body)) out.oursGap++;
        else if (/(FEC|election cycle)/.test((t.textContent || '') + body)) out.federal++;
        else out.silent++;
      }
      return out;
    })()`)) as {
      cards: number; sections: number; filed: number; registered: number;
      absence: number; oursGap: number; federal: number; silent: number;
    };

    const detail =
      `${seen.sections} money section(s) over ${seen.cards} card(s), ${opened} header(s) opened — ` +
      `FILED ${seen.filed}, registered-no-activity ${seen.registered}, sourced absence ${seen.absence}, ` +
      `OURS gap ${seen.oursGap}, federal FEC ${seen.federal}, UNCLASSIFIED ${seen.silent}`;

    check(
      "SC3",
      `${zip}: every candidate card carries a Campaign money section`,
      seen.cards >= cardFloor && seen.sections === seen.cards,
      `${detail}. Before 2026-09-01 this was 4 of ${cardFloor}: the snapshot held the money and ` +
        "the card asked for it by name, so it silently rendered nothing.",
    );

    check(
      "SC3",
      `${zip}: no money section renders an unrecognised state`,
      seen.silent === 0 && seen.sections > 0,
      `${detail}. A section whose text matches none of the four honest states is either a new ` +
        "wording nobody taught this check, or the join failing quietly again — both are worth a look.",
    );

    check(
      "SC3",
      `${zip}: the identity layer still resolves most candidates to their filings`,
      seen.filed > 0 && seen.oursGap <= oursCeiling,
      `${detail}. The OURS gap is CEILINGED at ${oursCeiling} rather than pinned: a candidate may ` +
        "honestly move between states, but an identity layer that stopped resolving would degrade " +
        "every card to an honest-looking shrug and pass a floor that only counted sections.",
    );

    check(
      "SC3",
      `${zip}: Katie Hobbs's filed total reaches her card`,
      await page.evaluate(
        "document.body.innerText.replace(/\\s+/g, ' ').includes('11,109,7')",
      ),
      "the named control for the whole item — the figure that was in the snapshot and not on " +
        "the page. A changed total is not a failure of this check; a MISSING one is.",
    );
  } finally {
    await context.close();
  }
}

await browser.close();

const EXCLUDED = [
  "tester-walk-0814b — the reaction-capture write half (taps a real reaction row)",
  "tester-walk-0814d — the T08 human-paced write gate (taps a real reaction row)",
  "tester-walk-0815 — the reaction half of item 5 (writes); its read half is carried here",
  // g9: R40's stored-path check WRITES a feedback row, so it stays out of the
  // standing suite by the same rule as the reaction taps. It lives in
  // scripts/walk-r40.mts and is run deliberately, with WTP_RUN_ID set.
  "walk-r40 — the feedback form's stored path (writes a real feedback row)",
  // g11: R41's blank-submit and address-stores checks write two real feedback
  // rows each run, so they join the same exclusion. scripts/walk-r41.mts, run
  // deliberately with WTP_RUN_ID set — it refuses to run without one.
  "walk-r41 — the optional reply field's stored path (writes two real feedback rows)",
  "pnpm pairs / pnpm shoot — screenshot passes; a human rules on pixels",
];

/*
 * THE IDENTITY UNIQUENESS CHECK RUNS FIRST (g9 item 4, 2026-08-17).
 *
 * The identity SET is diffed at the bottom of this file, but the duplicate
 * detection has to happen up here — before the summary prints — or a
 * duplicate would set the exit code without ever appearing in the named
 * regressions, which is a failure nobody reads. It fails through `failures`
 * so it lands in the list beside everything else.
 *
 * Why a duplicate is a failure at all: the suite exists to catch a win dying
 * quietly, and two checks sharing a name is how a CHECK dies quietly inside
 * the suite that was supposed to notice. Three shared names sat in the set
 * across two sessions while this printed as advice nobody was obliged to act
 * on.
 */
const sharedIdentities = (() => {
  const seen = new Map<string, number>();
  for (const id of identities) seen.set(id, (seen.get(id) ?? 0) + 1);
  return [...seen].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]);
})();
const duplicates = identities.length - new Set(identities).size;
if (duplicates > 0) {
  failures.push({
    session: "g9",
    name: "every check identity is unique",
    evidence:
      `${duplicates} duplicate(s) across ${sharedIdentities.length} shared name(s): ` +
      sharedIdentities.map(([id, n]) => `${id} ×${n}`).join("; ") +
      ` — the identity set counts them once, so the diff cannot see one of them die`,
  });
}

/*
 * THE PROBE CENSUS RUNS BEFORE THE SUMMARY (Prompt C, 2026-08-20).
 *
 * It used to be the last thing in the file, after the summary and after the
 * check-identity diff. That was fine while it only PRINTED — and it stopped
 * being fine the moment it grew a check: a check registered after the summary
 * is a check the summary does not count, so a run could print "N passed, 0
 * regressions" and then exit 1. Every request has been issued by this point,
 * which is the only thing the census actually waits on.
 */
/* ── Probe accounting: rows LANDED, not requests issued (G04) ───────────── */

console.log(
  `\nPRODUCTION ROWS THIS RUN CREATED: ${searchLogRows} search-log GET(s) issued ` +
    `(every /api/meetings GET writes one), ${askRows} ask/log request(s) issued. ` +
    `No reaction was tapped.` +
    (LIVE_TARGET
      ? ` Live target: the browser aborted ${browser.writesBlocked.count} write request(s).`
      : ""),
);

/**
 * G04: the line above counts REQUESTS ISSUED, at the call site, before the
 * response is known — and it reads as "rows created". A request that 404s,
 * that `getJson` discards on a non-ok status, or that a CDN serves without
 * reaching the route writes no row. Measured 2026-08-17: 28 issued, 25 landed.
 *
 * The C05 marker made the true number queryable for the first time, so the run
 * now ASKS. `.env.local`'s DATABASE_URL points at the local branch since R34,
 * so the production census reads the production string explicitly — and when
 * there is none, the run says the number could not be read rather than
 * printing the issued count as though it were the landed one.
 */
loadEnv({ path: join(process.cwd(), ".env.local") });
const PRODUCTION_DB = process.env.WTP_PRODUCTION_DATABASE_URL_READONLY;

/*
 * **R58 (Prompt D item 3.3, 2026-08-20) — THE SOLD-STORE CHECK IS THE SAME
 * CLASS, one floor down.**
 *
 * "the sold store accepted this run's rows at all" only fires on the branch
 * that actually reads production. Every other branch printed a sentence and
 * moved on, so a run against localhost — or against production with no
 * readonly credential — dropped the one observable the revenue path has, and
 * said nothing about having dropped it. Found by the assertion added in item
 * 3.4 on this session's first local walk, which is the assertion working.
 *
 * RULING 24: every branch now DECLARES.
 */
const LANDED_CHECK = "a live walk left no search-log or Ask row";

if (BASE !== PUBLIC_SITE_ORIGIN) {
  console.log(
    `  rows landed: NOT READ — this run targeted ${BASE}, not production, so a production ` +
      `census would be answering about someone else's rows.`,
  );
  cannotRun("promptC", LANDED_CHECK, `this run targeted ${BASE}, not production`);
} else if (!PRODUCTION_DB) {
  console.log(
    `  rows landed: COULD NOT READ — WTP_PRODUCTION_DATABASE_URL_READONLY is not set. ` +
      `The issued counts above stand as issued counts and are NOT the landed number.`,
  );
  cannotRun(
    "promptC",
    LANDED_CHECK,
    "WTP_PRODUCTION_DATABASE_URL_READONLY is not set — the landed number cannot be read",
  );
} else {
  try {
    const sql = neon(PRODUCTION_DB);
    const landed = (await sql`
      SELECT
        COUNT(*)::int                                          AS total,
        COUNT(*) FILTER (WHERE event_type = 'SEARCH')::int      AS searches
      FROM search_log WHERE run_id = ${RUN_ID}
    `) as { total: number; searches: number }[];
    const asked = (await sql`
      SELECT COUNT(*)::int AS total FROM ask_interactions WHERE run_id = ${askRunHash(RUN_ID)}
    `) as { total: number }[];
    const { total, searches } = landed[0];
    const askTotal = asked[0].total;
    console.log(
      `  rows landed: ${total} search-log row(s) (${searches} SEARCH) and ${askTotal} Ask row(s) ` +
        `carry run_id ${RUN_ID}. The browser aborted ${browser.writesBlocked.count} write request(s).`,
    );

    /*
     * **A LIVE WALK LEAVES NOTHING BEHIND (FE-01).**
     *
     * This check used to require rows to LAND (Prompt C, 2026-08-20): it was
     * the one outside view of the search log going dark when migration 0011
     * was never applied. A production walk now aborts every write in the
     * browser, so the right number is zero and any row is the leak. The cause
     * D73 exposed is still watched by the schema gate and the write alarm
     * below, which read the deploy itself.
     */
    check(
      "promptC",
      LANDED_CHECK,
      total === 0 && askTotal === 0,
      total === 0 && askTotal === 0
        ? `0 search-log and 0 Ask rows; ${browser.writesBlocked.count} write request(s) aborted ` +
          `(${[...browser.writesBlocked.paths].sort().join(", ") || "none"})`
        : `${total} search-log and ${askTotal} Ask row(s) landed from a walk that should write nothing — ` +
          `a write route is missing from LIVE_WRITE_PATHS (lib/ops/live-write-guard.ts) or was ` +
          `reached outside the browser`,
    );
  } catch (error) {
    // An unreadable census is COULD NOT RUN, never zero. Zero would read as
    // "this run created nothing", which is the opposite of what is known.
    console.log(
      `  rows landed: COULD NOT READ — ${(error as Error).message.slice(0, 120)}. ` +
        `The issued counts above stand as issued counts.`,
    );
    cannotRun(
      "promptC",
      LANDED_CHECK,
      `the production census threw: ${(error as Error).message.slice(0, 90)}`,
    );
  }
}

console.log(`\n${new Array(60).fill("─").join("")}`);
/* ── D73's class: the schema gate and the write alarm (Prompt D item 6) ──── */

/*
 * **TWO QUESTIONS THIS SUITE COULD NOT ASK BEFORE.**
 *
 * D73: migration 0011 added `coverage_tier` to both sold stores, the code
 * shipped, the migration was never applied, every insert failed for four hours,
 * and the walk was green throughout. The zero-landed check above closes the
 * SYMPTOM. These two close the CAUSE, and the alarm on it.
 *
 * The schema check runs against whatever `BASE` is, because the deploy answers
 * about the database IT is talking to — that is the whole point of asking the
 * running process rather than asking from here. The alarm read needs the
 * production credential and DECLARES when it does not have one, per RULING 24.
 */
{
  section("D73's class — the schema gate and the write alarm");
  /*
   * ── THE NAME IS STABLE; THE SUBJECT IS IN THE DETAIL ──────────────────────
   *
   * This check was written when the suite ran against production, and RULING 125
   * moved every walk to a LOCAL production build — which reads `DATABASE_URL`,
   * the development Neon branch. So it kept production-shaped wording while
   * asking a development database, and on 2026-08-25 it reported a NAMED
   * REGRESSION about migrations while production was IN SYNC at 21 of 21 the
   * same minute. RULING 115's shape for the third time in this repo: an alarm
   * that cannot tell an exercise from an event.
   *
   * **The first fix made the NAME depend on the target, and that was worse.**
   * A check whose identity changes with where it ran cannot be diffed: the
   * baseline looked for the old name, got nothing, and `R58` correctly reported
   * a check that had reported NO ENDING AT ALL. A check identity is how the
   * suite can see a single check die, and it must be the same string wherever
   * the run points.
   *
   * So the name never moves and the DETAIL says whose database was asked. A
   * local run naming its own branch is honest; a local run wearing production's
   * name is not.
   */
  const SCHEMA_CHECK = "the deploy's database has the migrations the deploy was built from";
  const whichDatabase = BASE.startsWith("http://localhost")
    ? "the LOCAL build's database (DATABASE_URL, the development branch) — production's own schema is `pnpm db:check --target=production`"
    : "the deploy's database";
  const raw = await get("/api/schema");
  if (raw.status === 200 || raw.status === 503) {
    /*
     * 200 and 503 are both ANSWERS — in sync and out of sync. Any other status
     * means the question could not be asked, which is a different finding and
     * must not be reported as the alarming one.
     */
    let summary = raw.text.slice(0, 300);
    try {
      const body = JSON.parse(raw.text) as { summary?: string };
      if (body.summary) summary = body.summary;
    } catch {
      // A body that will not parse is reported as the bytes that arrived.
    }
    check("promptD", SCHEMA_CHECK, raw.status === 200, `${whichDatabase} — ${summary}`);
  } else if (raw.status === 501) {
    cannotRun("promptD", SCHEMA_CHECK, "the deploy reports no DATABASE_URL — nothing was compared");
  } else {
    cannotRun("promptD", SCHEMA_CHECK, `/api/schema answered HTTP ${raw.status}`);
  }

  const ALARM_CHECK = "no sold-store write raised an alarm in the last 24h";
  if (!PRODUCTION_DB) {
    cannotRun(
      "promptD",
      ALARM_CHECK,
      "WTP_PRODUCTION_DATABASE_URL_READONLY is not set — an unread alarm table is not an empty one",
    );
  } else {
    try {
      const sql = neon(PRODUCTION_DB);
      const alarms = (await sql`
        SELECT store, COUNT(*)::int AS n
        FROM write_alarm
        WHERE raised_at > now() - interval '24 hours'
        GROUP BY store
      `) as { store: string; n: number }[];
      const total = alarms.reduce((a, r) => a + r.n, 0);
      check(
        "promptD",
        ALARM_CHECK,
        total === 0,
        total === 0
          ? "the alarm table is empty for this window"
          : `${alarms.map((a) => `${a.store}=${a.n}`).join(", ")} — run ` +
            "corepack pnpm alarms --target=production for the database's own words",
      );
    } catch (error) {
      cannotRun(
        "promptD",
        ALARM_CHECK,
        `could not read write_alarm: ${(error as Error).message.slice(0, 90)}`,
      );
    }
  }
}

console.log(`${passed} check(s) passed, ${failures.length} regression(s), ${blocked.length} could not run`);

/*
 * ITEM 1c: the suite's own census, printed every run. See `census` above for
 * why — the total is data-dependent and was being copied by hand between
 * session reports, and one wrong integer looked like two dead checks for two
 * sessions running.
 */
console.log(`\nCHECKS THAT RAN, BY THE SESSION THAT SHIPPED THEM (total ${passed + failures.length}):`);
for (const [session, n] of [...census].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
  console.log(`  ${String(n).padStart(4)}  [${session}]`);
}
console.log(
  `  (${blocked.length} further check(s) could not run and are NOT in the total — ` +
    `an unreachable service is not a missing feature.)`,
);

if (failures.length > 0) {
  console.log("\nNAMED REGRESSIONS — a win a prior session shipped is undone:");
  for (const f of failures) {
    console.log(`  · ${f.name}`);
    console.log(`      shipped by: ${f.session}${f.evidence ? `\n      saw: ${f.evidence}` : ""}`);
  }
}
if (blocked.length > 0) {
  console.log("\nCOULD NOT RUN (unknown, not negative):");
  for (const b of blocked) console.log(`  · ${b}`);
}

console.log("\nNOT IN THIS SUITE, deliberately:");
for (const e of EXCLUDED) console.log(`  · ${e}`);

/* ── The check-identity set, diffed rather than subtracted ──────────────── */

const ranNow = [...new Set(identities)].sort();
const previous = existsSync(CHECKS_FILE)
  ? readFileSync(CHECKS_FILE, "utf8")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"))
  : null;

/**
 * Baseline identities that neither RAN nor DECLARED they could not.
 *
 * Hoisted out of the diff block below because the baseline WRITER needs it:
 * a run that lost a check silently is precisely the run that may not overwrite
 * the file whose job is to notice that. Empty when there is no baseline yet.
 */
let silentIdentities: string[] = [];

console.log(`\nCHECK IDENTITIES: ${ranNow.length} distinct of ${identities.length} run`);
if (duplicates > 0) {
  // Already recorded as a NAMED REGRESSION above (g9 item 4); this is where
  // the offending names are printed, because this is the section a session
  // reads when it is working on the set.
  console.log(
    `  ${duplicates} check(s) share an identity with another — the set counts them once, ` +
      `so the diff cannot see them separately. Give them distinguishing names:`,
  );
  for (const [id, n] of sharedIdentities) console.log(`    ×${n}  ${id}`);
} else {
  console.log(`  every identity is unique — the diff below can see any single check die.`);
}
if (previous === null) {
  console.log(
    `  no committed baseline at docs/walk-checks.txt — this run WRITES the first one. ` +
      `Nothing is compared, and that is stated rather than printed as "no changes".`,
  );
} else {
  const before = new Set(previous);
  const added = ranNow.filter((c) => !before.has(c));
  const gone = previous.filter((c) => !ranNow.includes(c));
  console.log(`  baseline ${previous.length} · added ${added.length} · GONE ${gone.length}`);
  for (const c of added) console.log(`    +  ${c}`);
  /*
   * A removal is the thing integer subtraction cannot see, so it prints even
   * when the total went up.
   *
   * And it says WHICH KIND of removal (g10, 2026-08-17). A check that
   * declared CANNOT-RUN this run has not died — it reported, by name, that
   * the condition it guards was not present, which is the suite's own
   * discipline working. A check that is simply absent from both lists is the
   * silent death the diff exists to catch. Printing both as the same line
   * made a strictly-better snapshot — every source reachable, nothing carried
   * forward — read like three checks going missing.
   */
  const declared = new Set(declinedIdentities);
  for (const c of gone) {
    console.log(
      declared.has(c)
        ? `    -  ${c}   <- did not run, and SAID SO: it reported COULD NOT RUN above`
        : `    -  ${c}   <- a check that ran last time did not run now, and said nothing`,
    );
  }
  if (added.length === 0 && gone.length === 0) console.log("    (the same set, exactly)");

  /*
   * **R58 / RULING 24 (Prompt D item 3.4, 2026-08-20) — REGISTERED AND
   * REPORTING MUST BE EQUAL, AND THE RUN GOES RED WHEN THEY ARE NOT.**
   *
   * Everything above this line REPORTS. This ASSERTS, and that is the whole
   * difference. Prompt C's close-out walk printed seventeen GONE lines each
   * saying "a check that ran last time did not run now, and said nothing", and
   * the run still exited 0 — so the suite noticed the exact failure it exists
   * to catch and then passed. A diff nobody has to act on is a diff people
   * learn to scroll past.
   *
   * The rule, stated as arithmetic a session can check: every identity in the
   * committed baseline either RAN (it is in `identities`) or DECLARED it could
   * not (it is in `declinedIdentities`). Anything in neither list is a check
   * that vanished silently, and silence is not a passing result.
   *
   * A check the AUTHOR retires leaves the baseline in the same commit that
   * removes it, so retiring a claim is a deliberate act and never a silent one.
   */
  const silent = gone.filter((c) => !declared.has(c));
  silentIdentities = silent;
  console.log(
    `  ENDINGS: ${ranNow.length} ran + ${new Set(declinedIdentities).size} declared ` +
      `COULD NOT RUN · baseline ${previous.length} · silent ${silent.length}`,
  );
  if (silent.length > 0) {
    failures.push({
      session: "R58",
      name: "every registered check reports an ending",
      evidence:
        `${silent.length} check(s) in the committed baseline neither ran nor declared ` +
        `COULD NOT RUN: ${silent.join(" | ")}`,
    });
    console.log(
      "\nNAMED REGRESSION [R58] every registered check reports an ending — " +
        `${silent.length} check(s) reported NOTHING. A check that cannot run SAYS SO.`,
    );
    for (const c of silent) console.log(`    ×  ${c}`);
    // The regression summary printed further up ran before this diff existed,
    // so this prints its own line rather than counting on that one. The exit
    // code is the part that matters and it is shared.
    console.log(
      `  the summary above was printed before this check ran; regressions are now ` +
        `${failures.length}`,
    );
  }
}

/**
 * **THE BASELINE IS WRITTEN BY THE RUN THE LAW MANDATES, AND REFUSED BY A RUN
 * THAT LOST A CHECK.** (Part C, 2026-08-31. Replaces the production-only gate
 * of NJ Hunt 6, 2026-08-22.)
 *
 * ## The contradiction this removes
 *
 * The old gate was `AGAINST_PRODUCTION`, a regex for the Netlify host, and
 * the file was written only when it matched. Two days later **RULING 125**
 * removed production mode entirely: a non-local `SHOOT_BASE_URL` is refused at
 * the top of this file, `process.exit(1)`, before one check runs. So the
 * writer's condition became UNREACHABLE-true, and `docs/walk-checks.txt` could
 * not be regenerated by any run this repository permits. A committed baseline
 * no permitted run can rewrite is a baseline frozen at whatever it last said —
 * which turns the one instrument that can report a check DYING into a file
 * that only ever accuses the present of drifting from a fixed past.
 *
 * ## Why no ruling is needed to change it
 *
 * The old gate's stated reason was that a local run's production-only checks
 * would be silently dropped: *"committing that file would DELETE those
 * identities from the baseline."* **`NH112` removed that reason on
 * 2026-08-24**, in this same file, by making the baseline the UNION of what
 * ran and what DECLARED it could not run. A production-only check on a local
 * run reports `COULD NOT RUN` by name, lands in `declinedIdentities`, and is
 * carried. The premise is gone; only the guard was left standing.
 *
 * So this is not law changing. RULING 125 is the current answer to
 * `verification.target` — the LOCAL production build — and this makes the
 * writer agree with it instead of contradicting it. Nothing here relaxes what
 * the old guard was protecting.
 *
 * ## What replaces it, and it is stricter
 *
 * A blanket host check protected the baseline from one imagined loss. This
 * protects it from the ACTUAL loss, measured on this run: if any identity in
 * the committed baseline neither ran nor declared it could not — the `R58`
 * silent set computed above — the file is NOT written, and the refusal names
 * every identity that would have been dropped. A run that lost a check may
 * not overwrite the file whose entire job is to notice that.
 */
const LOCAL_TARGET = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(BASE);
if (!LOCAL_TARGET) {
  /* Unreachable while the RULING 125 refusal above stands, and kept as a
     belt: a baseline is a claim about the suite, not about a host we do not
     verify against. */
  console.log(
    `\n  docs/walk-checks.txt NOT written — this run targeted ${BASE}, which is not the\n` +
      `  LOCAL production build RULING 125 mandates. Diffing still happened above.`,
  );
} else if (silentIdentities.length > 0) {
  console.log(
    `\n  docs/walk-checks.txt NOT written — ${silentIdentities.length} identity(ies) in the\n` +
      `  committed baseline neither ran nor declared COULD NOT RUN on this run, and\n` +
      `  writing now would delete them, which is the check dying quietly arriving\n` +
      `  through the very file written to prevent it. Named above under [R58]:`,
  );
  for (const c of silentIdentities) console.log(`    ×  ${c}`);
} else {
  /*
   * **THE BASELINE RECORDS WHICH CHECKS EXIST, NOT WHICH ONES RAN TODAY.**
   * (`NH112`, fixed 2026-08-24.)
   *
   * This wrote `ranNow` alone, and a check that COULD NOT RUN pushes to
   * `declinedIdentities` rather than `identities` — so on 2026-08-24 a
   * production run deleted five check names from the baseline, taking it from
   * 377 to 372, purely because a service was unreachable for ninety seconds.
   *
   * The old header defended this: *"they did not run, and recording them as
   * present would be the same lie in the other direction."* That reasoning is
   * right about an OUTCOME and wrong about this FILE. The baseline exists for
   * exactly one purpose — to let the next run say **a check DIED** — and a
   * check that could not run has not died. Dropping it means the next run
   * inherits a baseline of 372, the five are simply absent, and nothing can
   * ever report them gone again.
   *
   * That is RULING 62's failure — a guard vanishing under a green run — one
   * layer above the test suite, and worse here because the instrument did it
   * to itself. It is also the walk rule's own words: new walks APPEND, the
   * suite only grows, and a check leaves it only when the author retires the
   * claim behind it. **A could-not-run is not a retirement.**
   *
   * So the baseline is the UNION of what ran and what declared it could not.
   * The per-run outcome is still reported separately and loudly above; this
   * file is the census of what exists.
   */
  const everyIdentity = [...new Set([...identities, ...declinedIdentities])].sort();
  const carriedDeclined = declinedIdentities.filter((d) => !identities.includes(d)).length;
  writeFileSync(
    CHECKS_FILE,
    `# The identity of every check pnpm walk:all HAS, one per line, sorted.\n` +
    `# Written by scripts/walk-all.mts on every production run and COMMITTED, so the\n` +
    `# next run diffs against it by set difference instead of subtracting two totals —\n` +
    `# a run that loses three checks and gains seven reports +4 either way, and the\n` +
    `# check dying quietly is the failure this suite exists to catch.\n` +
    `# Checks that COULD NOT RUN this time ARE here (NH112, 2026-08-24). This file\n` +
    `# records which checks EXIST, never which ones ran: a check that could not run\n` +
    `# has not been retired, and dropping it would make it impossible to ever report\n` +
    `# gone. The per-run outcome is reported separately, above, on every run.\n` +
      `${everyIdentity.join("\n")}\n`,
    "utf8",
  );
  console.log(
    `\n  docs/walk-checks.txt written — ${everyIdentity.length} identities ` +
      `(${ranNow.length} ran, ${carriedDeclined} carried because they COULD NOT RUN).`,
  );
}

/*
 * **THE QUARANTINE IS PRINTED ON EVERY RUN, whether or not it caught
 * anything.** (`NH176`, 2026-08-25.)
 *
 * A deliberate exclusion that reads as a clean result is the silent-trim shape
 * this repo names more often than any other. The number set aside is stated,
 * by name, beside the number that passed — so "372 passed" can never quietly
 * mean "372 passed and 3 were not counted".
 */
if (quarantined.length > 0) {
  console.log(
    `
  ${quarantined.length} check(s) QUARANTINED as flaky — tracked and hunted, NOT counted as passing:`,
  );
  for (const q of quarantined) console.log(`    ${q}`);
  console.log(
    "  Each carries a tracker row. Detection is pnpm flake:sweep; docs/walk-flakes.json is the verdict.",
  );
} else if (QUARANTINE && QUARANTINE.entries.length > 0) {
  console.log(
    `
  quarantine list holds ${QUARANTINE.entries.length} check(s); none of them failed this run.`,
  );
}

/**
 * **THE CANONICAL WALK RUN RECORD, AND THE TWENTY SLOWEST CHECKS.**
 * (WI7, 2026-08-30.)
 *
 * Two obligations meet here. The first is the measurement: a session asked to
 * make this suite faster without measuring less needs to know where the time
 * actually goes, and twenty named checks with their wall times is that answer.
 * It prints on EVERY run, not behind a flag, because a measurement that has to
 * be asked for is a measurement nobody has.
 *
 * The second is the record. RULING 146 forbids anything that can ask a session
 * a question, and a suite a session has to WATCH is the same defect wearing a
 * different hat — the session sits on it rather than working. So the run writes
 * its own summary to `data/health/walk-runs/`, and the session reads the file.
 * A detached run and a watched run leave identical evidence.
 *
 * The counts written here are the ones already computed above. Nothing is
 * recounted, because a second count is a second chance to disagree.
 */
{
  const finishedAt = new Date();
  const totalMs = Date.now() - STARTED_AT;
  const slowest = [...durations].sort((a, b) => b.ms - a.ms).slice(0, 20);

  console.log(`\n  WALL TIME: ${(totalMs / 1000).toFixed(1)}s total over ${durations.length} checks.`);
  console.log("  The twenty slowest checks, by the wall time attributed to each");
  console.log("  (the assertion plus the page load, zip seed and waits it needed):");
  for (const [i, d] of slowest.entries()) {
    console.log(`    ${String(i + 1).padStart(2)}. ${(d.ms / 1000).toFixed(2)}s  ${d.identity}`);
  }

  /*
   * **THE THIRD COPY OF THIS, AND THE ONE THAT DID NOT WORK.**
   * (Session C, 2026-08-31. RULING 103.)
   *
   * This block used to build its own sequence number, and the regex it built
   * it with was written inside a TEMPLATE LITERAL:
   *
   *     new RegExp(`^${day}-(\d+)\.json$`)
   *
   * The template consumes the backslashes before `RegExp` ever sees them, so
   * the pattern was `^2026-08-31-(d+).json$` — it matches a literal `d`, never
   * a digit. Nothing on disk ever matched, `seq` stayed 0, and EVERY walk
   * after the first on a given day silently overwrote the previous run's
   * record. That is how this session's first walk destroyed the record the
   * previous session had committed, and nothing said so.
   *
   * `lib/health/run-records.ts` is the implementation `reader-suite` and
   * `control-set` already share, and it escapes correctly. Using it removes
   * the duplicate and the defect in one move — which is the whole argument of
   * RULING 103: the second copy is where the rule drifts, and this one had
   * drifted into not working at all.
   */
  const runsDir = join(process.cwd(), "data", "health", "walk-runs");
  const recordPath = nextRunRecordPath(runsDir, phoenixDay());
  writeFileSync(
    recordPath,
    `${JSON.stringify(
      {
        runId: RUN_ID,
        baseUrl: BASE,
        testedSha: TESTED_SHA,
        startedAt: new Date(STARTED_AT).toISOString(),
        finishedAt: finishedAt.toISOString(),
        totalMs,
        checksRan: identities.length,
        declaredCouldNotRun: new Set(declinedIdentities).size,
        quarantined: quarantined.length,
        failures: failures.length,
        searchLogRows,
        askRows,
        liveTarget: LIVE_TARGET,
        writesBlocked: {
          count: browser.writesBlocked.count,
          paths: [...browser.writesBlocked.paths].sort(),
        },
        durations,
        slowest,
        /*
         * **WAITS THAT RAN OUT.** (Session B, W3.7.) Every `until` that spent
         * its full timeout, by label and by ceiling. 25 of 26 call sites
         * discard the boolean, so without this a wait that can never settle is
         * indistinguishable from a slow surface — which is exactly how A.1's
         * dead `.coverage-notice` wait cost 1142 seconds without anything
         * going red. A repeated label here is the signature.
         */
        waitTimeouts: {
          total: waitTimeouts.length,
          totalCeilingMs: waitTimeouts.reduce((n, w) => n + w.ms, 0),
          byLabel: Object.fromEntries(
            [...new Set(waitTimeouts.map((w) => w.label))]
              .map(
                (label) =>
                  [label, waitTimeouts.filter((w) => w.label === label).length] as const,
              )
              .sort((a, b) => b[1] - a[1]),
          ),
        },
        /* WHO RAN THIS. See lib/ops/run-provenance.ts — the proof class of
           every walk-proven capability is derived from this and nothing
           else, and its absence reads SESSION_MEASURED. (Session B WI1.8.) */
        provenance: readRunProvenance(TESTED_SHA),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  console.log(`  walk run record: ${recordPath}`);
}

if (failures.length > 0) process.exit(1);
