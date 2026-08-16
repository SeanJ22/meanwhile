/**
 * The truth session's walk (2026-08-15, item 11) — every surface this
 * session changed, desktop and 390×844, as a stranger.
 *
 *   pnpm tsx scripts/tester-walk-0815e.mts <zip>
 *
 * REAL-PAGE verification, because Node-blindness has shipped three dead
 * features here: every check below reads the rendered document.
 *
 * Prints PASS/FAIL with counts; screenshots per surface.
 */
import { chromium, type Browser, type Page } from "playwright";
import { join } from "node:path";

const OUT = "C:/Users/seanj/dev/we-the-people/screenshots";
const zip = process.argv[2] ?? "85701";
const results: string[] = [];
function check(name: string, ok: boolean, detail = "") {
  results.push(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

const browser: Browser = await chromium.launch();

async function openAt(width: number, height: number): Promise<Page> {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 2,
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  await page.goto("http://localhost:3000/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4500);
  // The quick tour opens over the welcome overlay on a cold device and
  // intercepts the zip input. A stranger dismisses it; so does the walk.
  await page
    .getByRole("button", { name: /Skip the tour/i })
    .first()
    .click({ timeout: 5000 })
    .catch(() => {});
  await page.waitForTimeout(500);
  const zipInput = page.locator(".welcome-overlay input").first();
  if (await zipInput.isVisible().catch(() => false)) {
    await zipInput.click({ timeout: 8000 }).catch(() => {});
    await page.keyboard.type(zip, { delay: 50 });
    await page.keyboard.press("Enter");
    await page.waitForTimeout(9000);
  }
  await page
    .getByRole("button", { name: /No thanks|show me everything/i })
    .first()
    .click({ timeout: 4000 })
    .catch(() => {});
  await page.waitForTimeout(1500);
  return page;
}

/* ── Desktop: the counters and the ask box's second rung ───────────────── */
const wide = await openAt(1280, 900);
const cards = await wide.locator(".stat-card").allInnerTexts().catch(() => []);
const districts = cards.find((c) => /DISTRICTS/i.test(c)) ?? "";
check(
  "M87: the districts tile says what it counts",
  /in view/i.test(districts) || /you're in/i.test(districts),
  districts.replace(/\n/g, " "),
);
await wide.screenshot({ path: join(OUT, `walk0815e-${zip}-desktop-counters.png`) });

if (zip === "85701") {
  const ask = wide.locator("input[data-ask-box]:visible").first();
  if (await ask.isVisible().catch(() => false)) {
    // No curated keyword in this sentence at all — the on-device matcher
    // refuses it, so an answer here came through the Level 1 classifier.
    await ask.fill("the light outside my house has been out for a week");
    await ask.press("Enter").catch(() => {});
    await wide.waitForTimeout(8000);
    const box = await ask
      .locator("xpath=ancestor::div[contains(@class,'rounded-[10px]')][1]")
      .innerText()
      .catch(() => "");
    check(
      "A12: a keyword-refused question routes through the classifier",
      /THE ANSWER/i.test(box) && /Streets and roads/i.test(box),
      box.replace(/\n+/g, " | ").slice(0, 110),
    );
    await wide.screenshot({ path: join(OUT, `walk0815e-${zip}-ask-classifier.png`) });
  } else {
    check("A12: the ask box is reachable", false);
  }
}

/* ── The transparency page, read as a stranger ─────────────────────────── */
await wide.goto("http://localhost:3000/transparency", { waitUntil: "domcontentloaded" });
await wide.waitForTimeout(1500);
const t = await wide.locator("body").innerText();
check("M88: the funding question is the author's", /How do you feel about how this campaign is funded/i.test(t));
check("M88: the five options are named", /love it/i.test(t) && /don't care/i.test(t));
check("D61: the scale break is disclosed", /until 15 August 2026/i.test(t) && /never combined/i.test(t));
check("D61: the exclusion sentence is gone", !/excluded from anything licensed/i.test(t));
check("A12: the classifier is disclosed", /pick which of those same topics/i.test(t));
check("A12: the no-AI guarantee survives", /No AI writes the answer/i.test(t));
check("M88: the photo rule's four doors", /four things/i.test(t) && /\.gov site/i.test(t));
check(
  "M88: the meta-language is gone",
  !/we would rather say it plainly/i.test(t) && !/not just promised here/i.test(t),
);
await wide.screenshot({ path: join(OUT, `walk0815e-transparency.png`), fullPage: true });

/* ── Phone: the same zip, as a stranger holds it ───────────────────────── */
const phone = await openAt(390, 844);
const phoneText = await phone.locator("body").innerText();
check("phone: the zip resolves and the map answers", /meeting|calendar|govern/i.test(phoneText));
await phone.screenshot({ path: join(OUT, `walk0815e-${zip}-phone.png`) });

console.log(`\n=== walk 0815e @ ${zip} ===`);
for (const r of results) console.log(r);
console.log(`\n${results.filter((r) => r.startsWith("PASS")).length}/${results.length} pass`);

await browser.close();
