/**
 * **THE REACTION CONTROL HEARS ITS OWN STORE — PROVED AT THE RENDERED DOM.**
 * (Part A remainder of `WGH-22`, class audit item 1, 2026-08-31.)
 *
 * `components/reactions/reaction-control.tsx` read `wtp.reactions` through
 * `useSyncExternalStore` and handed it a local `emptySubscribe` returning an
 * empty teardown. It therefore heard NOTHING: not the same-tab
 * `REACTIONS_EVENT` its own store publishes, and not the cross-tab `storage`
 * event either. A local `override` state made the tapped control move, which is
 * why the defect had no symptom on the control the finger landed on.
 *
 * The reader-visible symptom is the SECOND surface: a reader with the ballot
 * open in two tabs answers in one and the other goes on showing the question as
 * unanswered, for as long as that tab stays open.
 *
 * ## Why two tabs is the honest instrument here
 *
 * `wtp.reactions` is `localStorage`, so two pages in one browser context share
 * it and the browser fires `storage` in the tab that did NOT write. That is a
 * signal the PRODUCT receives, not one this probe supplies: nothing here
 * dispatches an event, seeds the store, or reloads the second tab. The only
 * thing seeded is `wtp.reaction_disclosure_ack`, which is the one-time capture
 * disclosure — an unrelated preference, and seeding it is how the probe reaches
 * the control rather than how it gets its answer.
 *
 * ## Local build only
 *
 * A tap POSTs to `/api/reactions`, and a reaction is a row in the sold store. So
 * this runs against a LOCAL production build and refuses any other origin. The
 * device-local half of `rememberReaction` writes and publishes before the
 * request is made, so the server half failing locally does not affect what is
 * being measured — and the probe prints the outcome the control rendered so
 * that is visible rather than assumed.
 *
 * ```
 * pnpm build && npx next start -p 3117
 * pnpm exec tsx scripts/probe-reaction-subscribe.mts
 * ```
 */

import { launchGuarded } from "./browser.mts";

const BASE = (process.env.SHOOT_BASE_URL ?? "http://localhost:3117").replace(/\/$/, "");
const ZIP = process.env.PROBE_ZIP ?? "03255";

if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:|$)/.test(BASE)) {
  throw new Error(
    `refusing to run against ${BASE}: a tap here writes a reaction row, so this probe is ` +
      "local-build only",
  );
}

const SEED = `(() => {
  try {
    sessionStorage.setItem(
      "wtp.approximate_location",
      JSON.stringify({ zip: ${JSON.stringify(ZIP)}, savedAt: new Date().toISOString() }),
    );
    localStorage.setItem("wtp.tutorial_seen", "1");
    // The one-time capture disclosure. Seeded so the probe can REACH the
    // control; it is not the signal under test.
    localStorage.setItem("wtp.reaction_disclosure_ack", "1");
  } catch {}
})()`;

/**
 * What the control for one target is rendering, read off the DOM.
 *
 * Expression-shaped, with the logic in Node: tsx wraps named functions in a
 * `__name` helper the page does not have.
 */
const READ = (targetId: string) => `(() => {
  const boxes = [...document.querySelectorAll('.reaction-box')];
  const box = boxes.filter((b) => (b.getAttribute('aria-label') || (b.querySelector('.reaction-box-prompt') ? b.querySelector('.reaction-box-prompt').textContent : '')) !== null)[${0}];
  const target = ${JSON.stringify(targetId)};
  const el = document.querySelector('[data-reaction-target=' + JSON.stringify(target) + ']');
  const scope = el || box;
  if (!scope) return { found: false, selected: [], buttons: 0 };
  const buttons = [...scope.querySelectorAll('button')];
  return {
    found: true,
    buttons: buttons.length,
    selected: buttons
      .filter((b) => b.getAttribute('aria-pressed') === 'true' || b.dataset.selected === 'true')
      .map((b) => (b.textContent || '').trim()),
    classes: buttons.map((b) => (b.textContent || '').trim() + ':' + b.className).slice(0, 8),
  };
})()`;

async function main(): Promise<void> {
  const browser = await launchGuarded({ label: "probe-reaction-subscribe" });
  const context = await browser.context({ viewport: { width: 390, height: 844 } });
  await context.addInitScript(SEED);
  const lines: string[] = [];
  try {
    const tabA = await context.newPage();
    const tabB = await context.newPage();
    const url = `${BASE}/ballot?zip=${ZIP}`;
    await tabA.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await tabB.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await tabA.waitForSelector(".reaction-box", { timeout: 60_000 });
    await tabB.waitForSelector(".reaction-box", { timeout: 60_000 });

    // The FIRST candidate control on the page, chosen by position so both tabs
    // are looking at the same one without the probe naming a candidate.
    const firstBox = ".reaction-box";
    const promptA = await tabA
      .locator(`${firstBox} .reaction-box-prompt`)
      .first()
      .textContent();
    lines.push(`prompt under test: ${(promptA ?? "").trim()}`);

    const readSelected = async (page: import("playwright").Page): Promise<string[]> =>
      (await page.evaluate(
        `(() => {
          const box = document.querySelector('.reaction-box');
          if (!box) return [];
          return [...box.querySelectorAll('button')]
            .filter((b) => (b.className || '').indexOf('reaction-pill') !== -1
              || b.getAttribute('aria-pressed') === 'true')
            .map((b) => (b.textContent || '').trim());
        })()`,
      )) as string[];

    const beforeA = await readSelected(tabA);
    const beforeB = await readSelected(tabB);
    lines.push(`tab A before: [${beforeA.join(", ")}]`);
    lines.push(`tab B before: [${beforeB.join(", ")}]`);

    // The reader answers, in tab A only. Nothing is supplied to tab B.
    const yes = tabA.locator(`${firstBox} button`, { hasText: /^Yes$/ }).first();
    if (!(await yes.isVisible().catch(() => false))) {
      lines.push("CANNOT RUN: the first reaction box offered no Yes button");
      process.stdout.write(`${lines.join("\n")}\n`);
      process.exitCode = 1;
      return;
    }
    await yes.click();

    /*
     * Wait for the CONDITION in tab B — never for a duration, and never with a
     * dispatched event.
     *
     * **THE POLL IS IN NODE.** `page.waitForFunction` polls on
     * `requestAnimationFrame` by default, and a page that is not the front tab
     * has rAF suppressed — so the predicate is never evaluated and a tab that
     * DID update times out. The first two runs of this probe reported FAIL
     * while printing tab B's answer as `[✓Yes]` three lines above, which is an
     * instrument disagreeing with its own evidence. A Node-side loop calling
     * `page.evaluate` does not depend on the page getting a frame.
     */
    const startedAt = Date.now();
    let heard = false;
    while (Date.now() - startedAt < 15_000) {
      if ((await readSelected(tabB)).length > beforeB.length) {
        heard = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    lines.push(
      heard
        ? `tab B moved ${Date.now() - startedAt}ms after the tap in tab A`
        : "tab B never moved inside the 15s ceiling",
    );

    const afterA = await readSelected(tabA);
    const afterB = await readSelected(tabB);
    lines.push(`tab A after the tap: [${afterA.join(", ")}]`);
    lines.push(`tab B after the tap, nothing supplied: [${afterB.join(", ")}]`);
    lines.push("");
    lines.push(
      heard && afterB.length > beforeB.length
        ? "PASS  the second tab heard the store and re-rendered the reader's answer"
        : "FAIL  the second tab did not move — the control is not hearing its store",
    );
    if (!heard || afterB.length <= beforeB.length) process.exitCode = 1;
  } finally {
    await context.close();
    await browser.close();
    process.stdout.write(`${lines.join("\n")}\n`);
  }
}

await main();
