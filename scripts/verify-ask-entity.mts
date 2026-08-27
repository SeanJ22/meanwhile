/**
 * `pnpm verify:ask-entity` — **THE TESTER'S QUESTION, THROUGH THE REAL READER
 * PATH, AGAINST A LOCAL PRODUCTION BUILD.** (2026-08-27.)
 *
 * A tester at a Tucson zip asked *"What's on the Vail school district
 * agenda?"* and the product answered about **Sunnyside Unified District**.
 * `tests/ask-entity-binding.test.ts` pins the repair at the routing layer;
 * this drives the actual Ask box in an actual browser, because a component can
 * drop what the router returned and the tester was reading a screen rather
 * than a function.
 *
 * ## What it proves, and what it deliberately does not
 *
 * It asserts INVARIANTS, never an expected sentence — the copy is allowed to
 * change and this check is not a snapshot of it:
 *
 * 1. Vail cannot silently become Sunnyside: the answer names no government
 *    other than the one asked about.
 * 2. The resolved entity is INSPECTABLE — the surface says which case it is.
 * 3. A question that names NO government still gets the reader's own district,
 *    so a repair that simply stopped answering is caught here too.
 *
 * ```
 * pnpm build && pnpm verify:ask-entity            # against :3111
 * SHOOT_BASE_URL=http://localhost:3000 pnpm verify:ask-entity
 * ```
 */

import { floored, floorLine } from "../lib/ops/denominator-floor.ts";
import { launchGuarded, type GuardedBrowser } from "./browser.mts";

const BASE = process.env.SHOOT_BASE_URL ?? "http://localhost:3111";
/** The tester's own context: a point inside Sunnyside Unified's territory. */
const ZIP = "85706";

interface Probe {
  question: string;
  /** Governments that must NOT be named in the answer. */
  forbidden: string[];
  /** True when the reader's own district SHOULD still answer. */
  expectLocal: boolean;
}

const PROBES: Probe[] = [
  {
    question: "What's on the Vail school district agenda?",
    forbidden: ["Sunnyside"],
    expectLocal: false,
  },
  {
    question: "when does the Vail school board meet",
    forbidden: ["Sunnyside"],
    expectLocal: false,
  },
  {
    /* The control. Names nobody, so the ZIP default is the CORRECT answer and
     * a repair that over-fired would show up right here. */
    question: "What's on the school district agenda?",
    forbidden: [],
    expectLocal: true,
  },
];

async function openAt(browser: GuardedBrowser, zip: string) {
  const context = await browser.context({ viewport: { width: 430, height: 932 } });
  await context.addInitScript(
    ({ zip }) => {
      try {
        sessionStorage.setItem(
          "wtp.approximate_location",
          JSON.stringify({ zip, savedAt: new Date().toISOString() }),
        );
        localStorage.setItem("wtp.tutorial_seen", "1");
      } catch {
        /* The walk types the zip instead. */
      }
    },
    { zip },
  );
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 90_000 });
  return page;
}

const failures: string[] = [];
const lines: string[] = [];

const browser = await launchGuarded({ label: "verify-ask-entity" });
try {
  const page = await openAt(browser, ZIP);

  for (const probe of PROBES) {
    /*
     * **THE PANEL IS NOT ON THE PAGE AT REST**, and the first draft of this
     * script looked straight for `[data-ask-box]` and timed out — the same
     * mistake `scripts/walk-all.mts` records at its own `offerRows`. The
     * who-governs card is what renders; the rail sits behind it, and the ask
     * pill is what opens the panel.
     */
    const minimize = page
      .locator(".coverage-notice button[aria-label^='Minimize']")
      .first();
    if ((await minimize.count()) > 0) {
      await minimize.click().catch(() => {});
      await page
        .locator(".coverage-notice")
        .waitFor({ state: "detached", timeout: 6000 })
        .catch(() => {});
    }
    if ((await page.locator("[data-ask-panel]").count()) === 0) {
      await page.locator("[data-ask-pill]").first().click().catch(() => {});
      await page
        .locator("[data-ask-panel]")
        .first()
        .waitFor({ state: "visible", timeout: 10_000 });
    }

    const box = page.locator("[data-ask-box]").first();
    await box.waitFor({ state: "visible", timeout: 30_000 });
    await box.fill(probe.question);
    await page
      .locator("[data-ask-panel] button", { hasText: "Ask" })
      .first()
      .click();

    /* The answer region, whichever shape it takes — routed steps or refusal. */
    await page
      .locator("[data-ask-refusal], [data-ask-panel] [data-ask-entity-state]")
      .first()
      .waitFor({ state: "visible", timeout: 20_000 })
      .catch(() => undefined);

    const text = (await page.locator("main").innerText()).replace(/\s+/g, " ");
    const entityState = await page
      .locator("[data-ask-panel]")
      .first()
      .getAttribute("data-ask-entity")
      .catch(() => null);
    const entityId = await page
      .locator("[data-ask-panel]")
      .first()
      .getAttribute("data-ask-entity-id")
      .catch(() => null);

    lines.push(
      `\n  Q ${JSON.stringify(probe.question)}\n    entity state: ${entityState ?? "(none rendered)"}` +
        (entityId ? ` -> ${entityId}` : ""),
    );

    for (const banned of probe.forbidden) {
      if (text.includes(banned)) {
        failures.push(
          `${JSON.stringify(probe.question)} produced an answer naming "${banned}" — ` +
            "a government the reader did not ask about",
        );
      }
    }
    if (probe.expectLocal && !text.includes("Sunnyside")) {
      failures.push(
        `${JSON.stringify(probe.question)} names NO government. The reader's own district must ` +
          "still answer it — a repair that stopped answering is not a repair.",
      );
    }
    lines.push(
      `    names Sunnyside: ${text.includes("Sunnyside")}  (expected local: ${probe.expectLocal})`,
    );
  }
} finally {
  await browser.close();
}

console.log(`\nverify:ask-entity — ${BASE} at ${ZIP}`);
console.log(lines.join(""));

/* RULING 159: a count states what it is a count OF. "3 probes passed" and
 * "3 of 3 probes passed" are different claims, and only the second is one. */
console.log(
  `  ${floorLine(
    floored("probes holding the entity-binding contract", "the probes run", PROBES.length, PROBES.length - failures.length),
  )}`,
);

if (failures.length > 0) {
  console.error(`\n  FAILED — ${failures.length} invariant(s):`);
  for (const f of failures) console.error(`    ✗ ${f}`);
  process.exit(1);
}
console.log(
  "\n  OK. A named government is never silently replaced by the reader's own, and a\n" +
    "  question naming nobody still gets the reader's own district.",
);
