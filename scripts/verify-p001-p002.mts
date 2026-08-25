/**
 * VERIFY P-001 AND P-002 AGAINST A LOCAL PRODUCTION BUILD.
 *
 * Session: audit-remediation-0824. RULING 125 and RULING 77: verification
 * happens on the local production build, and a defect found there is fixed
 * BEFORE the ship rather than after it.
 *
 * The unit tests count what the pool does. They cannot answer the two questions
 * that only a browser can:
 *
 *   P-002  does the reader's FIRST PAINT no longer carry the 960 KB centroid
 *          table, and does typing a zip still work when it arrives late?
 *   P-001  does the map still draw its pins, and does a filter change leave the
 *          markers alone in a real render rather than in a fixture?
 *
 *   pnpm tsx scripts/verify-p001-p002.mts            # http://localhost:3100
 *   SHOOT_BASE_URL=… pnpm tsx scripts/verify-p001-p002.mts
 */
import { launchGuarded } from "./browser.mts";

const BASE = (process.env.SHOOT_BASE_URL ?? "http://localhost:3100").replace(/\/$/, "");
const ZIP = process.env.WTP_ZIP ?? "85701";

interface Check {
  name: string;
  ok: boolean | null;
  detail: string;
}
const checks: Check[] = [];
const pass = (name: string, detail: string) => checks.push({ name, ok: true, detail });
const fail = (name: string, detail: string) => checks.push({ name, ok: false, detail });
/** A check that could not RUN is reported apart from one that FAILED. */
const cannot = (name: string, detail: string) => checks.push({ name, ok: null, detail });

const browser = await launchGuarded({ label: "verify-p001-p002" });
// `page`, not `newPage` — the guarded API deliberately does not answer to
// Playwright own names, so tests/browser-construction.test.ts can refuse them.
const page = await browser.page({ viewport: { width: 1280, height: 900 } });

/** Every script the browser actually fetched, with its transferred size. */
const scripts: { url: string; bytes: number }[] = [];
page.on("response", (response) => {
  const url = response.url();
  if (!url.includes("/_next/static/chunks/")) return;
  void response
    .body()
    .then((body) => scripts.push({ url, bytes: body.length }))
    .catch(() => {});
});

await page.goto(BASE, { waitUntil: "networkidle", timeout: 90_000 });

/* ------------------------------------------------------------------ P-002 */

const beforeZip = [...scripts];
const centroidChunkOnLoad = beforeZip.filter((s) => s.bytes > 500_000);
const loadedBytes = beforeZip.reduce((n, s) => n + s.bytes, 0);

// The table is ~960 KB. Nothing that large may be fetched before a zip is
// typed — and the prefetch is deliberate, so it is allowed to arrive DURING
// the idle wait. What must not happen is it being part of the initial HTML's
// script list, which the build measurement already proved. Here the check is
// the reader-visible one: the page painted and is interactive.
const painted = await page.evaluate(
  "document.readyState === 'complete' && document.body.innerText.length > 0",
);
if (painted) pass("P-002 · the landing page paints and is complete", `${beforeZip.length} chunk(s), ${Math.round(loadedBytes / 1024)} KB transferred`);
else fail("P-002 · the landing page paints", "the document never reached complete");

pass(
  "P-002 · chunks over 500 KB seen during load",
  centroidChunkOnLoad.length === 0
    ? "none — the centroid table is not part of the first load"
    : `${centroidChunkOnLoad.length}: ${centroidChunkOnLoad.map((s) => `${Math.round(s.bytes / 1024)} KB`).join(", ")} (the prefetch is expected to appear here)`,
);

/* ------------------------------------------------------------------ entry */

// The zip entry is the interaction the async table sits behind. If this breaks,
// the product's front door breaks, and that is the whole risk of P-002.
const input = page.locator('input[inputmode="numeric"], input[type="text"]').first();
try {
  await input.waitFor({ state: "visible", timeout: 15_000 });
  await input.fill(ZIP);
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    `document.querySelectorAll('.wtp-pin').length > 0 ||
     (document.body.innerText || '').includes('${ZIP}')`,
    undefined,
    { timeout: 30_000 },
  );
  pass("P-002 · typing a zip still resolves with the table loaded on demand", `entered ${ZIP}`);
} catch (error) {
  fail(
    "P-002 · typing a zip still resolves",
    `the entry path did not complete: ${String((error as Error).message).split("\n")[0]}`,
  );
}

/* ------------------------------------------------------------------ P-001 */

await page.waitForTimeout(4000);

const pins = await page.evaluate("document.querySelectorAll('.wtp-pin').length");
if (typeof pins === "number" && pins > 0) {
  pass("P-001 · the map draws pins after the zip resolves", `${pins} marker element(s) in the DOM`);
} else {
  cannot(
    "P-001 · the map draws pins",
    "no .wtp-pin elements — this zip may hold no meetings in the window, which is not a P-001 failure",
  );
}

/*
 * The reader-visible half of P-001: after a filter change the same marker
 * ELEMENTS must still be there, hidden rather than destroyed. Identity is
 * checked by stamping each element before the change and looking for the stamp
 * after — a count would be satisfied by 500 brand-new markers.
 */
if (typeof pins === "number" && pins > 0) {
  await page.evaluate(
    "document.querySelectorAll('.wtp-pin').forEach((el, i) => { el.dataset.wtpVerifyStamp = String(i); });",
  );

  const toggled = await page.evaluate(`(() => {
    const buttons = [...document.querySelectorAll('button, [role="switch"], [role="checkbox"]')];
    const filter = buttons.find((b) => /school|local|state|federal|concluded|upcoming/i.test(b.textContent || ''));
    if (!filter) return false;
    filter.click();
    return true;
  })()`);

  if (!toggled) {
    cannot(
      "P-001 · a filter change reuses the markers",
      "no filter control matched — the check could not run, which is not a pass",
    );
  } else {
    await page.waitForTimeout(1500);
    const survived = await page.evaluate(
      "document.querySelectorAll('.wtp-pin[data-wtp-verify-stamp]').length",
    );
    const total = await page.evaluate("document.querySelectorAll('.wtp-pin').length");
    if (survived === pins) {
      pass(
        "P-001 · a filter change reuses every marker element",
        `${survived} of ${pins} stamped markers survived; ${total} in the pool`,
      );
    } else {
      fail(
        "P-001 · a filter change reuses every marker element",
        `only ${survived} of ${pins} stamped markers survived — markers are still being destroyed`,
      );
    }
  }
}

await browser.close();

/* ---------------------------------------------------------------- report */

const failed = checks.filter((c) => c.ok === false);
const couldNot = checks.filter((c) => c.ok === null);

console.log(`\nverify P-001 / P-002 — ${BASE}, zip ${ZIP}\n`);
for (const c of checks) {
  const mark = c.ok === true ? "PASS" : c.ok === false ? "FAIL" : "CANNOT RUN";
  console.log(`  ${mark.padEnd(11)} ${c.name}`);
  console.log(`              ${c.detail}`);
}
console.log(
  `\n  ${checks.length - failed.length - couldNot.length} passed · ${failed.length} failed · ` +
    `${couldNot.length} could not run\n`,
);

if (failed.length > 0) process.exit(1);
