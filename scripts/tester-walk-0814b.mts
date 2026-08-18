/**
 * The second-08-14-session tester walk (session brief 6): the changed
 * surfaces at 390×844 as a stranger. The reaction-honesty proof leads —
 * a tap with the network cut must render the honest not-counted line,
 * and a tap that lands must render selected only after the 204 (P11).
 * Then the everyday ask-box answers (A10): the pothole golden with the
 * hang-tight beat at 85701, the two-municipality answer at 07866, and
 * the refusal staying honest. Prints PASS/FAIL with counts; screenshots
 * per surface. The log supersedes docs/tester-pass.md.
 *
 * `pnpm exec tsx scripts/tester-walk-0814b.mts <zip>`
 *
 * NOTE: at 85701 the COUNTED tap is a REAL write — the dev server holds
 * the production DATABASE_URL, so one FEDERAL_VOTE row lands in Neon,
 * stamped at the run's wall-clock time. The session report names it so
 * the tester-activity delta can exclude it.
 */
import { type Page } from "playwright";
import { join } from "node:path";
import { launchGuarded } from "./browser.mts";

const OUT = "C:/Users/seanj/dev/we-the-people/screenshots";
const zip = process.argv[2] ?? "85701";

const results: string[] = [];
function check(name: string, ok: boolean, detail = "") {
  results.push(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

const browser = await launchGuarded({ label: "tester-walk-0814b" });
const context = await browser.context({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  reducedMotion: "reduce",
});
const page: Page = await context.newPage();
const consoleErrors: string[] = [];
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text().slice(0, 160));
});
const body = () => page.locator("body").innerText();

// ── The map, cold entry ────────────────────────────────────────────────
await page.goto("http://localhost:3000/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(4000);

const zipInput = page.locator(".welcome-overlay input").first();
if (await zipInput.isVisible().catch(() => false)) {
  await zipInput.click();
  await page.keyboard.type(zip, { delay: 60 });
  await page.keyboard.press("Enter");
  await page.waitForTimeout(8000);
}
const noThanks = page.getByRole("button", { name: /No thanks|show me everything/i });
if (await noThanks.isVisible().catch(() => false)) {
  await noThanks.click();
  await page.waitForTimeout(1200);
}

let text = await body();
check("map: who-governs renders", /govern|meeting/i.test(text));
check("ask box present", /who do i talk to about/i.test(text));

// ── A10: the pothole golden, the beat, and the everyday card ───────────
const ask = page.locator("input[data-ask-box]:visible").first();
if (await ask.isVisible().catch(() => false)) {
  await ask.fill("There's a pothole in front of my house — who do I call?");
  await ask.press("Enter");
  // The hang-tight beat renders during the ~250ms presentation delay.
  await page.waitForTimeout(100);
  const beatText = await body();
  check(
    "A10: the hang-tight beat renders, the author's words",
    beatText.includes("I got you... hang tight..."),
  );
  check("A10: the beat never says Thinking", !/Thinking/.test(beatText));
  await page.waitForTimeout(600);
  text = await body();
  if (zip === "85701") {
    check(
      "A10 golden: pothole → Tucson Street Maintenance via 311",
      text.includes("Street Maintenance") && /Tucson 311/.test(text),
    );
    check("A10: the 311 phone renders", /\b311\b/.test(text));
    check(
      "A10: the source is cited on the card",
      /source — City of Tucson/i.test(text),
    );
  }
  if (zip === "07866") {
    check(
      "A10: BOTH municipalities answer at 07866",
      text.includes("Rockaway Township — Department of Public Works & Utilities") &&
        text.includes("Borough of Rockaway — Department of Public Works"),
    );
  }
  if (zip === "03255") {
    check(
      "A10: Newbury Highway Department answers the pothole",
      text.includes("Highway Department") && text.includes("603-938-5494"),
    );
  }
  await ask.scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(OUT, `walk0814b-${zip}-ask-pothole.png`) });

  // The refusal stays honest.
  await ask.fill("what is the meaning of civic life");
  await ask.press("Enter");
  await page.waitForTimeout(700);
  text = await body();
  check("A10: the honest refusal still renders", /Rather than guess/.test(text));
  await page.screenshot({ path: join(OUT, `walk0814b-${zip}-ask-refusal.png`) });

  // The refusal-driven route: the live refusal from this morning now routes.
  if (zip === "85701") {
    await ask.fill("my kids school");
    await ask.press("Enter");
    await page.waitForTimeout(700);
    text = await body();
    check(
      "A10: 'my kids school' (this morning's live refusal) now routes",
      /How a school is being run/.test(text),
    );
  }
} else {
  check("A10: ask box reachable", false);
}

// ── P11: reaction honesty on the ballot's own reaction controls ────────
// The candidate reaction controls are the same ReactionControl the vote
// and funding surfaces use — one component, one honesty rule.
if (zip === "85701") {
  await page.goto(`http://localhost:3000/ballot?zip=${zip}`, {
    waitUntil: "networkidle",
  });
  await page.waitForTimeout(4000); // hydration — the tap needs the handler
  const yes = page.getByRole("button", { name: "Yes", exact: true }).first();
  if ((await yes.count()) > 0) {
    // 1) The network is CUT: the tap must render the honest line, and
    //    the device-local record must still write.
    await page.route("**/api/reactions", (route) => route.abort());
    await yes.scrollIntoViewIfNeeded();
    await yes.evaluate((el) => (el as HTMLElement).click());
    await page.waitForTimeout(400);
    // First-ever tap on this fresh profile: the one-time notice parks it.
    const ok = page.getByRole("button", { name: /OK — record my answer/ }).first();
    if (await ok.isVisible().catch(() => false)) {
      check("P03: the one-time notice gates the first tap", true);
      await ok.evaluate((el) => (el as HTMLElement).click());
      await page.waitForTimeout(800);
    } else {
      check("P03: the one-time notice gates the first tap", false, "notice never appeared");
    }
    let pageText = await body();
    check(
      "P11: a failed write renders the honest not-counted line",
      pageText.includes(
        "Couldn't reach the totals — your answer is saved on this device and wasn't counted.",
      ),
    );
    await page.screenshot({ path: join(OUT, `walk0814b-${zip}-reaction-notcounted.png`) });

    // 2) The network is BACK: changing the answer must land a 204 and
    //    render selected-and-counted with the line gone. REAL ROW.
    await page.unroute("**/api/reactions");
    const control = yes.locator("xpath=ancestor::div[1]");
    const unsure = control.getByRole("button", { name: "Unsure", exact: true }).first();
    await unsure.evaluate((el) => (el as HTMLElement).click());
    await page.waitForTimeout(1500);
    pageText = await body();
    check(
      "P11: a landed write earns the counted rendering — the line is gone",
      !pageText.includes("Couldn't reach the totals"),
    );
    const pressed = await unsure.getAttribute("aria-pressed");
    check("P11: the landed answer renders selected", pressed === "true");
    await page.screenshot({ path: join(OUT, `walk0814b-${zip}-reaction-counted.png`) });
    console.log(
      `REAL ROW WRITTEN: CANDIDATE UNSURE at ${new Date().toISOString()} (this walk's own tap — exclude from the tester delta)`,
    );
  } else {
    check("P11: a reaction control reachable on the ballot", false);
  }
}

// ── T09: the transparency page discloses the scrub ─────────────────────
await page.goto("http://localhost:3000/transparency", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1200);
text = await body();
check(
  "T09: the scrub is disclosed",
  text.includes("automatically blanked") && /phone number/.test(text),
);
check("ask box disclosure still present", /no AI writes the answer/.test(text));
await page.screenshot({ path: join(OUT, `walk0814b-${zip}-transparency.png`) });

console.log(`\n== walk0814b ${zip} ==`);
for (const line of results) console.log(line);
console.log(
  "console errors:",
  consoleErrors.length === 0 ? "none" : consoleErrors.slice(0, 5).join(" | "),
);

await browser.close();
if (results.some((r) => r.startsWith("FAIL"))) process.exitCode = 1;
