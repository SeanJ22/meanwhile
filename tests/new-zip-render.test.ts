/**
 * **THE 85122 READINESS CHECK, AS AN APPLICATION RENDER.**
 * (Session C final, lane 1, 2026-09-01. RULING 229, RULING 224.)
 *
 * ## Why the unit test was not enough, said precisely
 *
 * `tests/new-zip-readiness.test.ts` traps `globalThis.fetch`, calls
 * `applicableDivisions()` and `projectOntoZip()` directly, and proves that the
 * PROJECTION performs no acquisition. That is a real proof about two functions.
 * It is not a proof about the product: it never renders a page, never runs a
 * route handler, and never asks whether a reader arriving at a ZIP outside the
 * pilot actually SEES a held record.
 *
 * RULING 224 is the reason that gap matters — *acquisition without promotion is
 * inventory, not product*. A corpus can be complete, a projection can be pure,
 * and the reader can still get nothing.
 *
 * **Both tests together are the permanent new-ZIP readiness check.** This one
 * keeps the other honest by asking the whole stack the same question.
 *
 * ## The two traps, because either one alone proves the wrong thing
 *
 * ```
 *   BROWSER   context.route("**\/*") records and ABORTS every request whose
 *             origin is not the local build. Catches a client-side hunt.
 *   SERVER    scripts/trap-outbound.mjs, preloaded into the Next process,
 *             wraps fetch / http.request / https.request, APPENDS EVERY ATTEMPT
 *             TO A FILE and then refuses it. Catches a route handler hunting
 *             during SSR — which the browser trap cannot see at all.
 * ```
 *
 * A browser-only version of this test would report ZERO OUTBOUND over a render
 * that hunted on the server, which is a false clean.
 *
 * ## How to run it, and what happens when it cannot
 *
 * ```
 *   pnpm build
 *   WTP_OUTBOUND_LOG=.render-trap/outbound.log \
 *     node --import ./scripts/trap-outbound.mjs node_modules/next/dist/bin/next start
 *   WTP_OUTBOUND_LOG=.render-trap/outbound.log pnpm test
 * ```
 *
 * With no reachable local build, or with no trap log, this test **SKIPS WITH THE
 * MISSING PIECE NAMED**. It does not pass. A render check that quietly passed
 * when nothing rendered is the shape that lets a suite go green over a product
 * nobody looked at.
 *
 * ## NO LIVE CALLS
 *
 * The target is refused unless it is loopback, exactly as `pnpm walk:all`
 * refuses production by name (RULING 125). The only network this test permits is
 * the page talking to its own build.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import test from "node:test";

import { launchGuarded } from "../scripts/browser.mts";

const BASE = (process.env.SHOOT_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const TRAP_LOG = process.env.WTP_OUTBOUND_LOG ?? "";
const NON_PILOT_ZIP = "85122";

/**
 * The record this test asserts a reader can see.
 *
 * Governor of Arizona is a STATEWIDE OFFICE. 85122 is Casa Grande, in Pinal
 * County — outside both pilot ZIPs, TIER_0, with zero people enumerated for it.
 * If activating it required a hunt, this is the contest that would have to be
 * hunted, and this project has held the record since 2026-08-14.
 */
const HELD_STATEWIDE_CONTEST = "ballot-az-pima:governor";
const HELD_STATEWIDE_CANDIDATE = "Katie Hobbs";

/** RULING 125's refusal, applied here: this may only ever target a local build. */
function refuseNonLocal(): string | null {
  let host: string;
  try {
    host = new URL(BASE).hostname;
  } catch {
    return `SHOOT_BASE_URL is not a URL: ${BASE}`;
  }
  const local = host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  return local ? null : `REFUSED — ${host} is not a local build. This check never runs against production.`;
}

async function reachable(): Promise<boolean> {
  try {
    const r = await fetch(BASE, { method: "GET", signal: AbortSignal.timeout(5000) });
    return r.ok;
  } catch {
    return false;
  }
}

/** Why this cannot run, or null. Named, never inferred, never silent. */
async function cannotRun(): Promise<string | null> {
  const refusal = refuseNonLocal();
  if (refusal) return refusal;
  if (!TRAP_LOG) {
    return (
      "WTP_OUTBOUND_LOG is not set, so the SERVER-SIDE trap is not installed. Without it a render " +
      "that hunted during SSR would look clean, and a clean-looking false answer is worse than no " +
      "answer. Start the build with `node --import ./scripts/trap-outbound.mjs` and set the same path."
    );
  }
  if (!existsSync(TRAP_LOG)) {
    return (
      `WTP_OUTBOUND_LOG points at ${TRAP_LOG}, which does not exist. The trap writes an "installed" ` +
      "line on load, so an absent file means the preload never ran in the server process."
    );
  }
  if (!/\btrap\tinstalled\b/.test(readFileSync(TRAP_LOG, "utf8"))) {
    return `${TRAP_LOG} exists but carries no "trap installed" line — the preload did not run.`;
  }
  if (!(await reachable())) {
    return `no local production build answering at ${BASE}. Run \`pnpm build\` then start it under the trap.`;
  }
  return null;
}

test("RULING 229: 85122 renders a held statewide record with ZERO outbound acquisition", async (t) => {
  const blocked = await cannotRun();
  if (blocked) {
    t.skip(`CANNOT RUN — ${blocked}`);
    return;
  }

  /* The trap log is truncated to its install line so what is read afterwards is
     THIS render's outbound attempts and not a previous run's. */
  const before = readFileSync(TRAP_LOG, "utf8");
  writeFileSync(TRAP_LOG, before.split("\n").filter((l) => /\btrap\tinstalled\b/.test(l)).join("\n") + "\n", "utf8");

  const thirdParty: string[] = [];
  const browser = await launchGuarded({ label: "new-zip-render" });
  try {
    const context = await browser.context({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      reducedMotion: "reduce",
    });
    /* Seeded the way `scripts/walk-all.mts` seeds it: the map entry does not
       read `?zip=`, it renders the welcome overlay, so a reader's saved
       location is what actually reaches the app. */
    await context.addInitScript(
      ({ zip }: { zip: string }) => {
        try {
          sessionStorage.setItem(
            "wtp.approximate_location",
            JSON.stringify({ zip, savedAt: new Date().toISOString() }),
          );
          localStorage.setItem("wtp.tutorial_seen", "1");
        } catch {
          /* Defaults are fine; the assertions below do not depend on the seed. */
        }
      },
      { zip: NON_PILOT_ZIP },
    );
    await context.route("**/*", async (route) => {
      const url = route.request().url();
      let host = "";
      try {
        host = new URL(url).hostname;
      } catch {
        host = url;
      }
      if (host === "localhost" || host === "127.0.0.1" || host === "::1") {
        await route.continue();
        return;
      }
      /* Recorded BEFORE it is refused. A trap that aborts without recording
         turns a violation into a broken image. */
      thirdParty.push(url);
      await route.abort();
    });

    const page = await context.newPage();
    const response = await page.goto(`${BASE}/ballot?zip=${NON_PILOT_ZIP}`, {
      waitUntil: "domcontentloaded",
      timeout: 90_000,
    });
    assert.equal(response?.status(), 200, `/ballot?zip=${NON_PILOT_ZIP} did not answer 200`);
    /* Wait for a candidate row rather than for a timer: a fixed sleep passes on
       a fast machine and reports an empty ballot on a slow one. */
    await page.waitForSelector(".candidate-row", { timeout: 60_000 });

    const contests = await page.$$eval("[data-contest-id]", (nodes) =>
      nodes.map((n) => n.getAttribute("data-contest-id") ?? ""),
    );
    const cards = await page.$$eval(".candidate-row", (nodes) => nodes.length);

    /* A page that rendered nothing would satisfy "zero outbound" perfectly, so
       the render is asserted BEFORE the acquisition claim is made. */
    assert.ok(
      contests.length > 0,
      "no [data-contest-id] rendered — a page with nothing on it trivially performs no acquisition",
    );
    assert.ok(cards > 0, "no .candidate-row rendered");
    assert.ok(
      contests.includes(HELD_STATEWIDE_CONTEST),
      `the held statewide contest ${HELD_STATEWIDE_CONTEST} did not render at ${NON_PILOT_ZIP}. ` +
        `Rendered: ${contests.slice(0, 12).join(", ")}`,
    );

    /*
     * READ THE ELEMENTS, NOT `innerText`.
     *
     * `innerText` is the RENDERED text and it omits anything the layout has
     * hidden — and a ballot card's sections are collapsed until their own header
     * button is pressed. Asserting on `innerText` failed here over a page whose
     * SSR HTML carries the name 24 times, which is a defect in the instrument
     * reported as a defect in the product. `textContent` over the candidate rows
     * asks whether the record REACHED THE DOCUMENT, which is the question.
     */
    const governorRows = await page.$$eval(
      `[data-contest-id="${HELD_STATEWIDE_CONTEST}"] .candidate-row`,
      (nodes) => nodes.map((n) => (n.textContent ?? "").replace(/\s+/g, " ").trim()),
    );
    assert.ok(
      governorRows.length > 0,
      `${HELD_STATEWIDE_CONTEST} rendered as a contest with NO candidate rows in it`,
    );
    assert.ok(
      governorRows.some((r) => r.includes(HELD_STATEWIDE_CANDIDATE)),
      `${HELD_STATEWIDE_CANDIDATE} — a candidate for a statewide Arizona office whose record this ` +
        `project has held since 2026-08-14 — is not in any candidate row of ${HELD_STATEWIDE_CONTEST} ` +
        `at ${NON_PILOT_ZIP}. Rows: ${governorRows.join(" | ").slice(0, 300)}`,
    );

    assert.deepEqual(
      thirdParty,
      [],
      "the BROWSER attempted outbound acquisition while rendering a held record for a new ZIP",
    );

    const after = readFileSync(TRAP_LOG, "utf8")
      .split("\n")
      .filter((l) => l.trim() !== "" && !/\btrap\tinstalled\b/.test(l));
    assert.deepEqual(
      after,
      [],
      "the SERVER attempted outbound acquisition while rendering a held record for a new ZIP",
    );

    t.diagnostic(
      `${NON_PILOT_ZIP}: ${contests.length} contest(s), ${cards} candidate card(s), ` +
        `0 browser outbound, 0 server outbound`,
    );
  } finally {
    await browser.close();
  }
});
