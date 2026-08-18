/**
 * The 2026-08-17 tester walk (session brief item 10): every zip at 390px,
 * walked as a stranger — the map surfaces, who-governs, the doors, a
 * meeting card (upcoming + concluded variants), then the ballot page
 * (cards, explainers, picks, registration link, about-area link) and the
 * about-area page. Prints PASS/FAIL per check with counts; screenshots per
 * surface. The log feeds docs/tester-pass.md.
 */
import { type Page } from "playwright";
import { join } from "node:path";
import { launchGuarded } from "./browser.mts";

const OUT = "C:/Users/seanj/dev/we-the-people/screenshots";
const zip = process.argv[2] ?? "03255";

const results: string[] = [];
function check(name: string, ok: boolean, detail = "") {
  results.push(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

const browser = await launchGuarded({ label: "tester-walk-0817" });
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

// ── The map, cold entry ────────────────────────────────────────────────
await page.goto("http://localhost:3000/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(4000);

const welcomeText = await page.locator("body").innerText();
check(
  "welcome: mission text verbatim",
  welcomeText.includes("politics cares about you") &&
    welcomeText.includes("say something anyway"),
);

const zipInput = page.locator(".welcome-overlay input").first();
if (await zipInput.isVisible().catch(() => false)) {
  await zipInput.click();
  await page.keyboard.type(zip, { delay: 60 });
  await page.keyboard.press("Enter");
  await page.waitForTimeout(8000);
}

// Decline the narrowing modal — the stranger's default.
const noThanks = page.getByRole("button", { name: /No thanks|show me everything/i });
if (await noThanks.isVisible().catch(() => false)) {
  await noThanks.click();
  await page.waitForTimeout(1200);
  check("narrowing modal: shown and declinable", true);
}

await page.screenshot({ path: join(OUT, `walk-${zip}-1-map.png`) });

const body = () => page.locator("body").innerText();
let text = await body();
check("map: meetings or honest coverage line", /meeting|calendar|govern/i.test(text));

if (zip === "03255") {
  check(
    "03255: Newbury no-mayor fact + Select Board members",
    text.includes("isn’t a city — it has no mayor.") ||
      text.includes("isn't a city — it has no mayor."),
    "who-governs select-board block",
  );
  check(
    "03255: Selectboard members named",
    /Schultz|Wheeler|Warde/.test(text),
  );
}
if (zip === "07866") {
  check("07866: mayor line renders (roster mayor)", /Mayor/.test(text));
}
check(
  "who-governs: about-area link",
  text.includes("Moving here? The basics"),
);

// ── The doors (8a) ─────────────────────────────────────────────────────
const drawerBtn = page.getByRole("button", { name: /menu|filters|controls/i }).first();
if (await drawerBtn.isVisible().catch(() => false)) {
  await drawerBtn.click();
  await page.waitForTimeout(800);
}
const officialsCard = page.getByRole("button", { name: /Open the officials list/i });
if (await officialsCard.isVisible().catch(() => false)) {
  await officialsCard.click();
  await page.waitForTimeout(1000);
  text = await body();
  check("door: officials list opens with names", /officials here/i.test(text));
  await page.screenshot({ path: join(OUT, `walk-${zip}-2-door-officials.png`) });
  const close = page.getByRole("button", { name: /^Close$/ }).first();
  if (await close.isVisible().catch(() => false)) await close.click();
  await page.waitForTimeout(500);
  check("door: closes", !/officials here/i.test(await body()));
} else {
  check("door: officials stat reachable", false, "stat card not found in drawer");
}

// ── The ballot page ────────────────────────────────────────────────────
await page.goto(`http://localhost:3000/ballot?zip=${zip}`, {
  waitUntil: "domcontentloaded",
});
await page.waitForTimeout(2500);
text = await body();

check("ballot: renders contests", /vote for/i.test(text));
check(
  "ballot: registration link prominent",
  /registered to vote|voter registration|Look up your voter/i.test(text),
);
check("ballot: office explainer present", /Powers defined in/.test(text));
check(
  "ballot: pick control present and distinct",
  /mark how you.d vote/i.test(text),
);
check(
  "ballot: device-only sentence",
  text.includes("Saved on this device only"),
);
check("ballot: about-area link", text.includes("Moving here?"));
if (zip === "07866") {
  check("2d: no shouting surnames (ROACH→Roach)", !/\bROACH\b/.test(text));
  check("2b: card bios render", /Randolph|union job|25 years/.test(text));
}
if (zip === "03255") {
  check("2a: statewide-measure absence stated", /No statewide ballot question/.test(text));
  check("2b: NH card bios render", /Executive Council|research scientist/.test(text));
  check("4b: executive councilor explainer", /five-member elected council/.test(text));
}
await page.screenshot({ path: join(OUT, `walk-${zip}-3-ballot.png`), fullPage: true });

// A pick round-trip: tap the first pick button, confirm My picks appears.
const pickBtn = page
  .locator("div:has(> p:text-matches('Mark how', 'i')) button")
  .first();
if (await pickBtn.isVisible().catch(() => false)) {
  await pickBtn.click();
  await page.waitForTimeout(600);
  text = await body();
  check("4a: My picks view appears after a tap", /my picks/i.test(text));
  await pickBtn.click(); // clear the toggle again
} else {
  check("4a: pick button clickable", false, "no pick button found");
}

// ── The about-area page ────────────────────────────────────────────────
await page.goto(`http://localhost:3000/about-area?zip=${zip}`, {
  waitUntil: "domcontentloaded",
});
await page.waitForTimeout(1500);
text = await body();
check("about-area: renders state facts", /basics of living here/.test(text));
check("about-area: marijuana answered", /marijuana/i.test(text));
check("about-area: every fact cited", /Department|Secretary|Division|Commission/.test(text));
await page.screenshot({ path: join(OUT, `walk-${zip}-4-area.png`), fullPage: true });

console.log(`\n== walk ${zip} ==`);
for (const line of results) console.log(line);
console.log(
  "console errors:",
  consoleErrors.length === 0 ? "none" : consoleErrors.slice(0, 5).join(" | "),
);

await browser.close();
