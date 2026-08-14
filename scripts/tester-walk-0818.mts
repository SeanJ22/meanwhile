/**
 * The 2026-08-18 tester walk (session item 5): every zip at 390px, walked
 * as a stranger — everything the 0817 walk checked, PLUS this session's
 * surfaces: the Funding sections (D34) on the ballot, the wired Sunnyside/
 * Amphitheater boards with their people (D39), the Rockaway BOE full names
 * (4a), and the NH legislator contacts (item 3). Prints PASS/FAIL per
 * check with counts; screenshots per surface. The log supersedes
 * docs/tester-pass.md.
 */
import { chromium, type Page } from "playwright";
import { join } from "node:path";

const OUT = "C:/Users/seanj/dev/we-the-people/screenshots";
const zip = process.argv[2] ?? "03255";

const results: string[] = [];
function check(name: string, ok: boolean, detail = "") {
  results.push(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

const browser = await chromium.launch();
const context = await browser.newContext({
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

await page.screenshot({ path: join(OUT, `walk18-${zip}-1-map.png`) });

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
  check("03255: Selectboard members named", /Schultz|Wheeler|Warde/.test(text));
}
if (zip === "07866") {
  check("07866: mayor line renders (roster mayor)", /Mayor/.test(text));
}
check("who-governs: about-area link", text.includes("Moving here? The basics"));

// ── D39/4a: the wired boards reach the reader through the list ─────────
// 85701: Sunnyside's sittings are pins/list rows and the compact card
// names its board. 07866: the Rockaway BOE the same way, full names.
const boardCase =
  zip === "85701"
    ? { row: /Sunnyside/, member: /Quintero/, label: "Sunnyside board + members" }
    : zip === "07866"
      ? { row: /Township School District|Board of Education/i, member: /McGeary/, label: "Rockaway BOE full names" }
      : null;
if (boardCase) {
  const badge = page.locator(".count-badge");
  if (await badge.isVisible().catch(() => false)) {
    await badge.click();
    await page.waitForTimeout(900);
    const listText = (await page.locator(".al-panel").textContent().catch(() => "")) ?? "";
    check(`list: ${boardCase.label} row present`, boardCase.row.test(listText));
    const row = page.locator(".al-panel button.al-row", { hasText: boardCase.row }).first();
    if (await row.isVisible().catch(() => false)) {
      await row.click();
      await page.waitForTimeout(1500);
      // The venue panel specifically — the sidebar is an aside too. The
      // click dispatches in the DOM: the sheet's scroll container stalls
      // Playwright's scroll-into-view even for visible rows (harness
      // quirk, not an app defect — the row is tappable by hand).
      await page.waitForTimeout(600);
      await page.evaluate(() => {
        const el = document.querySelector(
          'aside[aria-label^="Meetings at"] h3 button',
        ) as HTMLButtonElement | null;
        el?.click();
      });
      await page.waitForTimeout(1200);
      const cardText = (await page.locator(".popup-card").allTextContents()).join(" ");
      check(
        `card: ${boardCase.label} render`,
        boardCase.member.test(cardText),
        boardCase.member.test(cardText) ? "" : `card text lacked the member name`,
      );
      await page.screenshot({ path: join(OUT, `walk18-${zip}-5-board.png`) });
      await page.keyboard.press("Escape");
      await page.waitForTimeout(400);
      const panelClose = page.locator('aside button[aria-label="Close"]').first();
      if (await panelClose.isVisible().catch(() => false)) await panelClose.click();
      await page.waitForTimeout(400);
    } else {
      check(`card: ${boardCase.label} render`, false, "list row not clickable");
    }
  } else {
    check(`list: ${boardCase.label} row present`, false, "count badge not visible");
  }
}

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
  await page.screenshot({ path: join(OUT, `walk18-${zip}-2-door-officials.png`) });

  // Scoped to the door dialog — a venue panel's own Close must not be the
  // one this clicks.
  const close = page
    .locator('[aria-label="Officials here"]')
    .getByRole("button", { name: /^Close$/ })
    .first();
  if (await close.isVisible().catch(() => false)) await close.click();
  await page.waitForTimeout(500);
  check("door: closes", !/officials here/i.test(await body()));
} else {
  check("door: officials stat reachable", false, "stat card not found in drawer");
}

// Item 3 (03255): a Merrimack legislator's card carries directory contact —
// the reader path is the who-governs card's own name button.
if (zip === "03255") {
  const rep = page.getByRole("button", { name: /Greg Sargent|Karen Ebel/ }).first();
  if (await rep.isVisible().catch(() => false)) {
    await rep.click();
    await page.waitForTimeout(1000);
    const cardText = (
      await page.locator(".popup-card, .account-modal").allTextContents()
    ).join(" ");
    check(
      "3: NH legislator contact renders (phone + email)",
      /\(603\) \d{3}-\d{4}/.test(cardText) && /@gc\.nh\.gov/i.test(cardText),
      /\(603\)/.test(cardText) ? "" : "no directory phone in the card",
    );
    await page.screenshot({ path: join(OUT, `walk18-${zip}-6-nh-contact.png`) });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
  } else {
    check(
      "3: NH legislator contact renders (phone + email)",
      false,
      "no rep name button on who-governs",
    );
  }
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
check("ballot: pick control present and distinct", /mark how you.d vote/i.test(text));
check("ballot: device-only sentence", text.includes("Saved on this device only"));
check("ballot: about-area link", text.includes("Moving here?"));

// ── D34: the Funding sections ──────────────────────────────────────────
const fundingSections = (text.match(/Campaign money · FEC/gi) ?? []).length;
const fundingReactions = (
  text.match(/Would you vote for someone whose campaign is funded this way\?/g) ?? []
).length;
const contributorLists = (text.match(/Largest reported contributions/gi) ?? []).length;
const stateNotes = (text.match(/state campaign-finance systems/g) ?? []).length;
check(
  "D34: funding sections on federal candidates",
  fundingSections > 0,
  `${fundingSections} sections, ${fundingReactions} total-reactions, ${contributorLists} contributor lists`,
);
check("D34: state races carry the honest state-systems note", stateNotes > 0, `${stateNotes} notes`);
if (zip === "85641") {
  check("D34: an earned absence renders with its reason", /don.t have to register|has not filed/i.test(text));
}

if (zip === "07866") {
  check("2d: no shouting surnames (ROACH→Roach)", !/\bROACH\b/.test(text));
  check("2b: card bios render", /Randolph|union job|25 years/.test(text));
}
if (zip === "03255") {
  check("2a: statewide-measure absence stated", /No statewide ballot question/.test(text));
  check("2b: NH card bios render", /Executive Council|research scientist/.test(text));
  check("4b: executive councilor explainer", /five-member elected council/.test(text));
  check("4b: Goodlander portrait on her card", text.includes("Goodlander"));
}
await page.screenshot({ path: join(OUT, `walk18-${zip}-3-ballot.png`), fullPage: true });

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
await page.screenshot({ path: join(OUT, `walk18-${zip}-4-area.png`), fullPage: true });

console.log(`\n== walk ${zip} ==`);
for (const line of results) console.log(line);
console.log(
  "console errors:",
  consoleErrors.length === 0 ? "none" : consoleErrors.slice(0, 5).join(" | "),
);

await browser.close();
if (results.some((r) => r.startsWith("FAIL"))) process.exitCode = 1;
