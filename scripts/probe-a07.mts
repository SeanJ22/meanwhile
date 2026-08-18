/**
 * A07 — is the refusal GONE, or just slower than the walk waits?
 *
 *   pnpm probe:a07
 *
 * `pnpm walk:all` reported "an unroutable question refuses and offers the
 * destinations" as a NAMED REGRESSION at 85701 and 07866, and PASSING at
 * 85641 and 03255 — the same check, same build, four zips. Every other ask
 * check passed at all four. That pattern is a latency signature rather than a
 * behaviour change, but a signature is not a diagnosis, so this measures it.
 *
 * The walk waits a fixed 4500 ms after clicking Ask and then reads once. This
 * polls every 250 ms for 30 s and reports WHEN the refusal appeared — so the
 * three possible answers separate cleanly:
 *
 *   - appears after 4.5 s   → the check's wait is too short for this question
 *   - never appears         → a real regression, and this says so
 *   - appears before 4.5 s  → something else, and the walk needs re-running
 *
 * The nonsense question is the one the walk uses, verbatim, because a
 * different string would be measuring a different question.
 */
import { chromium, type Browser } from "playwright";

import { makeRunId, syntheticRunHeaders } from "../lib/db/run-marker.ts";

const BASE = (process.env.SHOOT_BASE_URL ?? "https://sparkwtp.netlify.app").replace(
  /\/$/,
  "",
);
const RUN_ID =
  process.env.WTP_RUN_ID ?? makeRunId("g14-a07-probe", new Date().toISOString());
const RUN_HEADERS = syntheticRunHeaders({ ...process.env, WTP_RUN_ID: RUN_ID });

const NONSENSE = process.env.A07_QUESTION ?? "qwertyuiop asdfghjkl zxcvbnm";
const ZIPS = (process.env.A07_ZIPS ?? "85701,07866,85641,03255").split(",");
const POLL_MS = 250;
const LIMIT_MS = 30_000;
/** What the walk waits before it reads, once. */
const WALK_WAIT_MS = 4500;

let asks = 0;

async function probe(browser: Browser, zip: string): Promise<string> {
  const context = await browser.newContext({
    extraHTTPHeaders: RUN_HEADERS,
    viewport: { width: 1280, height: 800 },
    reducedMotion: "reduce",
  });
  // C05: sendBeacon ignores extraHTTPHeaders, so anything leaving by that
  // path is recorded ORGANIC — our own run counted as a reader in the store
  // we sell. Removing it forces the fetch fallback, which carries the header.
  await context.addInitScript(() => {
    try {
      Object.defineProperty(navigator, "sendBeacon", {
        value: undefined,
        configurable: true,
      });
    } catch {
      // Still declared on every fetch if it cannot be removed.
    }
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
        // Defaults are fine.
      }
    },
    { zip },
  );
  const page = await context.newPage();
  page.on("response", (r) => {
    if (r.url().includes("/api/ask/")) asks += 1;
  });

  try {
    await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.waitForTimeout(8000);

    /*
     * The panel is behind its pill, and the input is `[data-ask-box]` — not
     * `[data-ask-panel] input`, which is what the first version of this probe
     * looked for and found nowhere, reporting COULD NOT RUN at all four zips
     * against a working page. Taken from `walk-all.mts`, which reaches it the
     * same way.
     */
    if ((await page.locator("[data-ask-panel]").count()) === 0) {
      await page.locator("[data-ask-pill]").first().click();
      await page.waitForTimeout(600);
    }
    const input = page.locator("[data-ask-box]").first();
    if ((await input.count()) === 0) {
      return `${zip}: COULD NOT RUN — no ask box on the page`;
    }
    await input.fill(NONSENSE);
    await page.locator("[data-ask-panel] button", { hasText: "Ask" }).first().click();

    const started = Date.now();
    let refusedAt: number | null = null;
    let answeredAt: number | null = null;

    while (Date.now() - started < LIMIT_MS) {
      const state = (await page.evaluate(() => ({
        refusal: Boolean(document.querySelector("[data-ask-refusal]")),
        destination: document.querySelector("[data-ask-destination]")?.getAttribute("data-ask-destination") ?? null,
        answered: /the answer/i.test(
          (document.querySelector("[data-ask-panel]") as HTMLElement)?.innerText ?? "",
        ),
      }))) as {
        refusal: boolean;
        answered: boolean;
        destination: string | null;
      };

      if (state.refusal && refusedAt === null) refusedAt = Date.now() - started;
      if (state.answered && answeredAt === null) answeredAt = Date.now() - started;
      if (state.destination) return `${zip}: DESTINATION "${state.destination}" at ${Date.now()-started}ms — routed, not refused`;
      if (refusedAt !== null) break;
      await page.waitForTimeout(POLL_MS);
    }

    if (refusedAt === null) {
      return (
        `${zip}: NO REFUSAL within ${LIMIT_MS / 1000}s` +
        (answeredAt !== null ? ` — but it ANSWERED at ${answeredAt}ms` : " and no answer either")
      );
    }
    const verdict =
      refusedAt > WALK_WAIT_MS
        ? `LATER than the walk's ${WALK_WAIT_MS}ms read — the check read too early`
        : `within the walk's ${WALK_WAIT_MS}ms window`;
    return `${zip}: refused at ${refusedAt}ms — ${verdict}`;
  } finally {
    await context.close();
  }
}

const browser = await chromium.launch();
console.log(`\nA07 refusal latency — ${BASE}, run id ${RUN_ID}`);
console.log(`question: ${JSON.stringify(NONSENSE)}, polling every ${POLL_MS}ms\n`);

try {
  for (const zip of ZIPS) {
    console.log("  " + (await probe(browser, zip.trim())));
  }
} finally {
  await browser.close();
}

console.log(`\n/api/ask responses at ${BASE}: ${asks} — declared SYNTHETIC`);
console.log(`run id: ${RUN_ID}`);
