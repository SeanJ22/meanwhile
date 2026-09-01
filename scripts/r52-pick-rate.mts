/**
 * R52 — HOW OFTEN DOES THE FIRST CLICK DO NOTHING? (g18, 2026-08-18)
 *
 * ## The finding this measures
 *
 * `walk:all`'s check `[0814c] 85701: a pick raises the reader's running ballot`
 * failed on one production run of four in g17, and passed on the other three,
 * on identical code against an identical deploy. g17 diagnosed it to a
 * mechanism — the gate before the click waits for `[data-pick], .ballot-measure,
 * main` to be PRESENT, and presence is server-rendered markup rather than an
 * attached React handler — and shipped a retry that records WHICH ATTEMPT
 * WORKED. The instrumented run then passed first-try, so the diagnosis stood
 * plausible and unconfirmed.
 *
 * A retry that makes a check green is not a diagnosis. What settles it is a
 * RATE, and one run of the 308-check suite buys one trial of this gate. So the
 * gate is lifted out and run on its own, many times.
 *
 * ## This is a faithful lift, not a re-implementation
 *
 * The navigation, the readiness gate, the pick selector and the assertion are
 * copied from `scripts/walk-all.mts` verbatim — same URL, same
 * `domcontentloaded`, same presence gate on the same selector with the same
 * 12s ceiling, same `.reaction-box[data-kind="pick"] .reaction-choice`
 * locator, same `/my picks/i` read with the same 10s ceiling. If those drift
 * apart this script stops measuring the check it names, so they are named
 * together here and in the walk.
 *
 * The one deliberate difference: this script does NOT retry. The walk retries
 * because its job is to report the feature's health; this script's job is to
 * count first-click outcomes, and a retry would erase the measurement.
 *
 * ## WHAT IT FOUND, and the part that is not a rate
 *
 * 30 trials on the presence gate alone: 29 first clicks raised the ballot, ONE
 * did not and the second click on the same button did — 3.3%, the R52 shape.
 *
 * Then the window itself was measured, and it is the real finding. After the
 * presence gate is satisfied, the pick button takes a FURTHER 13–233ms to
 * carry a React fiber — in 10 of 10 trials, median ~105ms. The gate returns
 * while the button is rendered and dead, every single time.
 *
 * WHY THE FAILURE IS THEN RARE RATHER THAN CONSTANT, stated because the
 * obvious objection deserves an answer: React attaches a root-level listener
 * early and REPLAYS events captured before a node hydrates, so nearly every
 * click that lands in the window is replayed and works. The 1-in-30 is the
 * narrower sub-window where even replay does not reach. The fix does not
 * depend on replay at all.
 *
 * ## What this run does NOT prove
 *
 * With the hydration wait in place the probe read 0 misses in 10 trials. That
 * is CONSISTENT with the fix and does not on its own establish it: against a
 * 3.3% base rate, 10 clean trials is what you would often see anyway. The
 * evidence for the fix is the measured window and the served HTML — the pick
 * button is in `/ballot`'s server-rendered markup, so the old gate provably
 * could be satisfied before any JavaScript ran — not this run's zero.
 *
 * ## The rows this writes
 *
 * Every trial loads `/ballot?zip=85701`, and the page's own client logging
 * writes rows. The browser is opened through `scripts/browser.mts`, so every
 * request — and every beacon, which is forced onto `fetch` there — carries
 * `x-wtp-synthetic-run`. The run id is printed at the top and again at the
 * bottom, and belongs in the session report by name.
 *
 * ## The hypothesis, and what would refute it
 *
 * If the cause is hydration, a first-click miss should be MORE likely on a
 * cold page and the miss should resolve on a later click of the same button.
 * Each trial therefore records, on a miss, whether a second click succeeds —
 * which separates "not hydrated yet" from "the feature is broken for this
 * page load". A miss that a second click does not fix is not R52.
 */

import { launchGuarded } from "./browser.mts";

import { PUBLIC_SITE_ORIGIN } from "../lib/ops/origins.ts";

const BASE = process.env.WTP_WALK_BASE ?? PUBLIC_SITE_ORIGIN;
const TRIALS = Number(process.env.WTP_R52_TRIALS ?? "12");
const PHONE = { width: 390, height: 844 };
const PICK = '.reaction-box[data-kind="pick"] .reaction-choice';

/** `until`, copied from walk-all so the timing behaviour is the same. */
async function until(
  page: { evaluate: (f: string) => Promise<unknown> },
  cond: () => Promise<boolean>,
  ms: number,
): Promise<boolean> {
  const deadline = Date.now() + ms;
  for (;;) {
    if (await cond()) return true;
    if (Date.now() > deadline) return false;
    await new Promise((r) => setTimeout(r, 100));
  }
}

interface Trial {
  n: number;
  pickCount: number;
  firstClick: boolean;
  secondClick: boolean | null;
  msToReady: number;
  msPresentToHydrated: number;
  msFirstToRaise: number | null;
}

async function main() {
  const browser = await launchGuarded({ label: "r52-pick-rate" });
  console.log(`R52 first-click rate · ${BASE} · ${TRIALS} trials`);
  console.log(`run id ${browser.runId} (SYNTHETIC)\n`);

  const trials: Trial[] = [];
  try {
    for (let n = 1; n <= TRIALS; n++) {
      // A FRESH CONTEXT PER TRIAL, deliberately. Reusing one would warm the
      // HTTP cache and the JS parse, which is precisely the variable under
      // test — a hydration race is a cold-load race, and measuring it on a
      // warm page would report a rate of zero and prove nothing.
      const context = await browser.context({
        viewport: PHONE,
        reducedMotion: "reduce",
      });
      const page = await context.newPage();
      const t0 = Date.now();
      await page.goto(`${BASE}/ballot?zip=85701`, {
        waitUntil: "domcontentloaded",
        timeout: 90_000,
      });
      await until(
        page,
        async () => (await page.locator("[data-pick], .ballot-measure, main").count()) > 0,
        12_000,
      );
      const msToReady = Date.now() - t0;

      /*
       * THE WINDOW ITSELF, MEASURED (g18). The rate above says how often a
       * click lands in the gap; this says how wide the gap IS. React attaches
       * its fiber to a DOM node when it hydrates that node, so the moment the
       * pick button carries one is the moment it stops being decoration.
       */
      const hydrated =
        "(() => {" +
        `  const el = document.querySelector(${JSON.stringify(PICK)});` +
        "  if (!el) return false;" +
        '  return Object.keys(el).some((k) => k.startsWith("__reactFiber$") || k.startsWith("__reactProps$"));' +
        "})()";
      const presentAt = Date.now();
      await until(page, async () => Boolean(await page.evaluate(hydrated)), 12_000);
      const msPresentToHydrated = Date.now() - presentAt;

      const picks = page.locator(PICK);
      const pickCount = await picks.count();
      if (pickCount === 0) {
        // Not a miss — the gate could not run. Reported apart from a failure,
        // which is the walk's own discipline about could-not-run.
        trials.push({ n, pickCount, firstClick: false, secondClick: null, msToReady, msPresentToHydrated, msFirstToRaise: null });
        console.log(`  trial ${String(n).padStart(2)} · COULD NOT RUN — no pick control on the page`);
        await context.close();
        continue;
      }

      const t1 = Date.now();
      await picks.first().click();
      const raised = await until(
        page,
        async () => /my picks/i.test(String(await page.evaluate("document.body.innerText"))),
        10_000,
      );
      const msFirstToRaise = raised ? Date.now() - t1 : null;

      let second: boolean | null = null;
      if (!raised) {
        await picks.first().click();
        second = await until(
          page,
          async () => /my picks/i.test(String(await page.evaluate("document.body.innerText"))),
          10_000,
        );
      }

      trials.push({ n, pickCount, firstClick: raised, secondClick: second, msToReady, msPresentToHydrated, msFirstToRaise });
      console.log(
        `  trial ${String(n).padStart(2)} · ` +
          (raised
            ? `first click RAISED in ${msFirstToRaise}ms (ready ${msToReady}ms, +${msPresentToHydrated}ms to hydrate)`
            : second
              ? `first click MISSED, second RAISED — consistent with hydration (ready ${msToReady}ms)`
              : `first click MISSED, second MISSED — NOT R52, this is the feature (ready ${msToReady}ms)`),
      );
      await context.close();
    }
  } finally {
    await browser.close();
  }

  const ran = trials.filter((t) => t.pickCount > 0);
  const firstOk = ran.filter((t) => t.firstClick).length;
  const hydrationMiss = ran.filter((t) => !t.firstClick && t.secondClick === true).length;
  const realMiss = ran.filter((t) => !t.firstClick && t.secondClick === false).length;

  console.log(`\nTRIALS ${trials.length} · ran ${ran.length} · could not run ${trials.length - ran.length}`);
  console.log(`  first click raised the ballot   ${firstOk}/${ran.length}`);
  console.log(`  first missed, second raised     ${hydrationMiss}/${ran.length}  (the R52 shape)`);
  console.log(`  both missed                     ${realMiss}/${ran.length}  (NOT R52 — a real failure)`);
  const rate = ran.length === 0 ? null : hydrationMiss / ran.length;
  console.log(
    rate === null
      ? "\nNo trial ran. Nothing is claimed about the rate — this is a could-not-run, not a zero."
      : `\nFIRST-CLICK MISS RATE: ${(rate * 100).toFixed(1)}% (${hydrationMiss} of ${ran.length}).`,
  );
  if (ran.length > 0) {
    const ready = ran.map((t) => t.msToReady).sort((a, b) => a - b);
    console.log(
      `Time to the readiness gate: min ${ready[0]}ms · median ${ready[Math.floor(ready.length / 2)]}ms · max ${ready[ready.length - 1]}ms`,
    );
  }
  console.log(`\nAll rows this run wrote are SYNTHETIC under ${browser.runId}.`);
}

await main();
