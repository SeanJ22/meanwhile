/**
 * `pnpm verify:ask-entity` — **THE TESTER'S QUESTION, THROUGH THE REAL READER
 * PATH, AGAINST A LOCAL PRODUCTION BUILD.** (2026-08-27.)
 *
 * A tester at a Tucson zip asked *"What's on the Vail school district
 * agenda?"* and the product answered about **Sunnyside Unified District**.
 * `tests/ask-entity-binding.test.ts` pins the repair at the routing layer;
 * this drives the actual Ask box in an actual browser, because a component can
 * drop what the router returned — and one did: the client's agenda handler read
 * `body.topic ? body : null`, so the correct body-agenda answer was discarded
 * silently and the reader saw nothing at all.
 *
 * ## Two contexts, because the contract has two halves
 *
 * One zip can only show one of them:
 *
 * - **85706**, the tester's own, where the named government is thirty miles
 *   away and NOT local. This is where the substitution happened.
 * - **85641**, Vail's own, where the named government IS the reader's. This is
 *   where a repair that simply stopped answering would show up.
 *
 * It asserts INVARIANTS, never an expected sentence — the copy is free to
 * change and this is not a snapshot of it.
 *
 * ```
 * pnpm build && pnpm verify:ask-entity            # against :3111
 * SHOOT_BASE_URL=http://localhost:3000 pnpm verify:ask-entity
 * ```
 */

import { floored, floorLine } from "../lib/ops/denominator-floor.ts";
import { launchGuarded, type GuardedBrowser } from "./browser.mts";

const BASE = process.env.SHOOT_BASE_URL ?? "http://localhost:3111";

interface Probe {
  question: string;
  /** Governments that must NOT be named in the answer. */
  forbidden: string[];
  /** True when the reader's own district SHOULD still answer. */
  expectLocal: boolean;
}

interface Context {
  zip: string;
  /** The district this zip's own reader gets for a question naming nobody. */
  local: string;
  probes: Probe[];
}

const CONTEXTS: Context[] = [
  {
    zip: "85706",
    local: "Sunnyside",
    probes: [
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
      /* Names nobody, so the ZIP default is CORRECT here and a repair that
         over-fired shows up immediately. */
      {
        question: "What's on the school district agenda?",
        forbidden: [],
        expectLocal: true,
      },
    ],
  },
  {
    zip: "85641",
    local: "Vail",
    probes: [
      /* The named government IS this reader's, so it must BIND and answer
         rather than be suppressed by the repair. */
      {
        question: "What's on the Vail school district agenda?",
        forbidden: ["Sunnyside"],
        expectLocal: true,
      },
      {
        question: "What's on the school district agenda?",
        forbidden: ["Sunnyside"],
        expectLocal: true,
      },
    ],
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
let probesRun = 0;

const browser = await launchGuarded({ label: "verify-ask-entity" });
try {
  for (const context of CONTEXTS) {
    const page = await openAt(browser, context.zip);
    lines.push(`\n  --- at ${context.zip} (local district: ${context.local}) ---`);

    for (const probe of context.probes) {
      probesRun++;
      /*
       * **THE PANEL IS NOT ON THE PAGE AT REST**, and the first draft of this
       * script looked straight for `[data-ask-box]` and timed out — the same
       * mistake `scripts/walk-all.mts` records at its own `offerRows`. The
       * who-governs card is what renders; the rail sits behind it.
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
      await page.locator("[data-ask-panel] button", { hasText: "Ask" }).first().click();

      await page
        .locator(
          "[data-ask-refusal], [data-ask-body-agenda], [data-ask-panel] [data-ask-entity-state]",
        )
        .first()
        .waitFor({ state: "visible", timeout: 20_000 })
        .catch(() => undefined);

      const text = (await page.locator("main").innerText()).replace(/\s+/g, " ");
      const entity = await page
        .locator("[data-ask-panel]")
        .first()
        .getAttribute("data-ask-entity")
        .catch(() => null);
      const entityId = await page
        .locator("[data-ask-panel]")
        .first()
        .getAttribute("data-ask-entity-id")
        .catch(() => null);
      const docket = await page
        .locator("[data-ask-body-agenda]")
        .first()
        .getAttribute("data-ask-body-agenda")
        .catch(() => null);

      lines.push(
        `\n  Q ${JSON.stringify(probe.question)}` +
          `\n    entity: ${entity ?? "(none)"}${entityId ? ` -> ${entityId}` : ""}` +
          (docket ? `\n    docket: ${docket}` : ""),
      );

      for (const banned of probe.forbidden) {
        if (text.includes(banned)) {
          failures.push(
            `${context.zip} ${JSON.stringify(probe.question)} named "${banned}" — ` +
              "a government the reader did not ask about",
          );
        }
      }
      if (probe.expectLocal && !text.includes(context.local)) {
        failures.push(
          `${context.zip} ${JSON.stringify(probe.question)} must still be answered by the ` +
            `reader's own district (${context.local}) — a repair that stopped answering is not a repair`,
        );
      }
      lines.push(
        `    names ${context.local}: ${text.includes(context.local)}  (expected: ${probe.expectLocal})`,
      );
    }
    await page.close();
  }
} finally {
  await browser.close();
}

console.log(`\nverify:ask-entity — ${BASE}`);
console.log(lines.join(""));

/* RULING 159: a count states what it is a count OF. "5 probes passed" and
 * "5 of 5 probes passed" are different claims, and only the second is one. */
console.log(
  `\n  ${floorLine(
    floored(
      "probes holding the entity-binding contract",
      "the probes run",
      probesRun,
      probesRun - failures.length,
    ),
  )}`,
);

if (failures.length > 0) {
  console.error(`\n  FAILED — ${failures.length} invariant(s):`);
  for (const f of failures) console.error(`    ✗ ${f}`);
  process.exit(1);
}
console.log(
  "\n  OK. A named government is never silently replaced by the reader's own; a\n" +
    "  question naming nobody still gets the reader's own district; and where the\n" +
    "  named government IS the reader's, it still answers.",
);
