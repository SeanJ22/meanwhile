/**
 * The 2026-08-19 tester walk (session item 6): every zip at 390×844 as a
 * stranger — this session's surfaces first. THE GATE leads: three officials'
 * funding sections must render three DIFFERENT campaigns' books (D40 — the
 * production bug was Kelly's data on all three). Then 2a self-funding
 * labels, 2b photo drops, the 3-series copy (What do you think?, single
 * picks disclosure, moving-here verbatim, party colors, bold summaries,
 * collapsed official analysis), 3i calendar links, item 4 record links, and
 * the item 5 ask box goldens. Prints PASS/FAIL with counts; screenshots per
 * surface. The log supersedes docs/tester-pass.md.
 *
 * `pnpm tsx scripts/tester-walk-0819.mts <zip>`
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

const browser = await launchGuarded({ label: "tester-walk-0819" });
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
check("map: meetings or honest coverage line", /meeting|calendar|govern/i.test(text));
check(
  "3c: moving-here line verbatim on who-governs",
  text.includes("Moving here? Know the basics — Taxes, schools, registering, and more."),
);
// The label renders uppercase via CSS, and innerText reports the rendered
// case — match case-insensitively.
check("5: ask box on the who-governs card", /who do i talk to about/i.test(text));
await page.screenshot({ path: join(OUT, `walk19-${zip}-1-map.png`) });

// ── 5: the ask box goldens, live on the surface (before anything else
//     collapses the who-governs card) ──────────────────────────────────
if (zip === "85701") {
  const ask = page.locator("input[data-ask-box]:visible").first();
  if (await ask.isVisible().catch(() => false)) {
    await ask.fill("They stopped building the library down the road — who should I talk to?");
    await ask.press("Enter");
    await page.waitForTimeout(800);
    text = await body();
    check(
      "5 golden: the library question routes to Tucson and Pima",
      /Libraries/.test(text) && /Tucson/.test(text) && /Pima/.test(text),
    );
    check(
      "5: the denominator is stated",
      /Based on what we track here/.test(text) && /2 of 2 steps/.test(text),
    );
    await ask.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(OUT, `walk19-${zip}-ask-routed.png`) });

    await ask.fill("what is the meaning of civic life");
    await ask.press("Enter");
    await page.waitForTimeout(800);
    text = await body();
    check("5: the honest refusal renders", /Rather than guess/.test(text));
    await page.screenshot({ path: join(OUT, `walk19-${zip}-ask-refusal.png`) });
    await ask.fill("");
  } else {
    check("5: ask box input reachable", false);
  }
}

// ── THE GATE (D40), at 85701: three officials, three different books ───
if (zip === "85701") {
  const officials: { name: RegExp; file: string; expectRaised: RegExp }[] = [
    { name: /Mark Kelly/, file: "gate-kelly", expectRaised: /\$41 million/ },
    { name: /Ruben Gallego/, file: "gate-gallego", expectRaised: /\$4\.3 million/ },
    { name: /Adelita S\. Grijalva/, file: "gate-grijalva", expectRaised: /\$2\.3 million/ },
  ];
  const seenSentences: string[] = [];
  for (const official of officials) {
    const btn = page.getByRole("button", { name: official.name }).first();
    if (!(await btn.isVisible().catch(() => false))) {
      check(`GATE: ${official.file} reachable`, false, "name button not on who-governs");
      continue;
    }
    await btn.click();
    await page.waitForTimeout(1000);
    // The compact card opens first — go to the large tier where Funding lives.
    const more = page.getByRole("button", { name: /More/ }).first();
    if (await more.isVisible().catch(() => false)) {
      await more.click();
      await page.waitForTimeout(1500);
    }
    await page.waitForTimeout(1500); // the funding fetch
    const modal = page.locator(".account-modal");
    const modalText = (await modal.allTextContents()).join(" ");
    const raisedSentence =
      modalText.match(/This campaign has raised [^.]+\./)?.[0] ?? "(no funding sentence)";
    seenSentences.push(raisedSentence);
    check(
      `GATE: ${official.file} shows THEIR raised figure`,
      official.expectRaised.test(modalText),
      raisedSentence,
    );
    const funding = modal.locator("text=Campaign money · FEC").first();
    if (await funding.isVisible().catch(() => false)) await funding.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(OUT, `walk19-${zip}-${official.file}.png`) });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(600);
  }
  check(
    "GATE: three officials, three DISTINCT payloads",
    new Set(seenSentences).size === 3,
    seenSentences.join(" | "),
  );

}

// ── 3i: calendar links on the meeting surfaces ─────────────────────────
const badge = page.locator(".count-badge");
if (await badge.isVisible().catch(() => false)) {
  await badge.evaluate((el) => (el as HTMLElement).click());
  await page.waitForTimeout(900);
  const listRow = page.locator(".al-panel button.al-row").first();
  if (await listRow.isVisible().catch(() => false)) {
    await listRow.evaluate((el) => (el as HTMLElement).click());
    await page.waitForTimeout(1500);
    const panelText = await body();
    check(
      "3i: calendar links in the sidebar meeting list",
      panelText.includes("Add to calendar (.ics)") && panelText.includes("Google Calendar"),
      panelText.includes("Add to calendar") ? "" : "no calendar links in the venue panel",
    );
    await page.screenshot({ path: join(OUT, `walk19-${zip}-calendar.png`) });
    const panelClose = page.locator('aside button[aria-label="Close"]').first();
    if (await panelClose.isVisible().catch(() => false)) await panelClose.click();
    await page.waitForTimeout(400);
  } else {
    check("3i: sidebar meeting list reachable", false, "no list rows (may be honest: no meetings)");
  }
}

// ── The ballot page ────────────────────────────────────────────────────
await page.goto(`http://localhost:3000/ballot?zip=${zip}`, {
  waitUntil: "domcontentloaded",
});
await page.waitForTimeout(2500);
text = await body();

check("ballot: renders contests", /vote for/i.test(text));
// 3d's label was SUPERSEDED by g3 item 7 (2026-08-16): the pick control and
// the per-candidate sensor both said "What do you think?", so the author read
// the ballot-builder as a duplicate. The claim this walk owns is unchanged —
// the pick control carries the author's current words — and `pnpm walk:all`
// holds it going forward.
check("3d → g3: the pick control names the action", text.includes("Your pick for this race"));
check("3d: the old label is gone", !/mark how you.d vote/i.test(text));
const disclosureCount = (text.match(/saved on this device only/gi) ?? []).length;
check(
  "3e: the picks disclosure states ONCE",
  disclosureCount === 1,
  `${disclosureCount} occurrences`,
);
check(
  "3e: the single statement carries the reactions distinction",
  text.includes("join anonymous local totals"),
);
check(
  "3c: ballot moving-here line verbatim",
  text.includes("Moving here? Know the basics — Taxes, schools, registering, and more."),
);

// 3a: party labels carry their palette colors, not the muted gray.
const partyColors = await page.evaluate(() => {
  const spans = Array.from(document.querySelectorAll("span"));
  const byParty: Record<string, string> = {};
  for (const s of spans) {
    const t = s.textContent?.trim() ?? "";
    if (/^(Democratic|Republican|Green|Libertarian)$/.test(t) && s.getAttribute("style")) {
      byParty[t] = getComputedStyle(s).color;
    }
  }
  return byParty;
});
check(
  "3a: Democratic and Republican labels wear different colors",
  Boolean(
    partyColors.Democratic &&
      partyColors.Republican &&
      partyColors.Democratic !== partyColors.Republican,
  ),
  JSON.stringify(partyColors),
);

// Item 4: the incumbent record link, and it opens the real record.
const recordLinks = (text.match(/See their voting record/g) ?? []).length;
const expectRecord = zip === "85641" || zip === "07866" || zip === "85701" || zip === "03255";
check(
  "4: incumbent record link present",
  !expectRecord || recordLinks > 0,
  `${recordLinks} links at ${zip}`,
);
if (recordLinks > 0) {
  const link = page.getByRole("button", { name: /See their voting record/ }).first();
  await link.scrollIntoViewIfNeeded();
  // Dispatch in the DOM — the sticky ballot layout stalls Playwright's
  // viewport check on some zips (harness quirk; the button taps by hand).
  await link.evaluate((el) => (el as HTMLElement).click());
  await page.waitForTimeout(2500);
  const modalText = (await page.locator(".account-modal").allTextContents()).join(" ");
  check(
    "4: the record modal opens with Recent votes",
    /Recent votes/.test(modalText),
    /Recent votes/.test(modalText) ? "" : "modal lacked the votes section",
  );
  await page.screenshot({ path: join(OUT, `walk19-${zip}-record.png`) });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
}

// 2a at 85701: Butierez's self-funding says so, from the FEC fields.
if (zip === "85701") {
  check(
    "2a: the candidate's own money labeled",
    text.includes("the candidate's own money"),
  );
}
// 2b: the DROPPED photos are actually gone — matched by their exact
// files, because two of the hosts also serve KEPT portraits (Warmington
// on run.imgix, Liot Hill on wixstatic).
const droppedPhotoFragments =
  zip === "85701"
    ? ["katiehobbs.org"]
    : zip === "03255"
      ? [
          "kellyfornh.com", // Ayotte banner
          "scottbrown.com", // Brown candid
          "f28da3_2b522f593d584d4a9d296d5beb786b97", // Sununu couple photo
          "619f0f55-d765-4c16-90a2-4d65cdb49697", // Harned selfie
        ]
      : zip === "07866"
        ? ["jerseyjustin4senate.org"]
        : [];
for (const fragment of droppedPhotoFragments) {
  const count = await page.locator(`img[src*="${fragment}"]`).count();
  check(`2b: dropped photo gone (${fragment.slice(0, 24)}…)`, count === 0, `${count} imgs`);
}
// And the kept portraits still render where they should.
if (zip === "03255") {
  const kept = await page
    .locator('img[src*="4d7eafb4-1f9c-4589-9ba4-0d1a344679e3"], img[src*="644896_ac32357ab0c6496a8824ebedef424559"]')
    .count();
  check("2b: kept portraits still render (Warmington/Liot Hill)", kept >= 1, `${kept} imgs`);
}

// 3f: the official analysis collapses; the summary stays open and bold.
if (/Official analysis —/.test(text)) {
  const analysisBody = page
    .locator("details:has(summary:has-text('Official analysis')) p")
    .first();
  const visibleBefore = await analysisBody.isVisible().catch(() => false);
  check("3f: official analysis collapsed by default", !visibleBefore);
  const summaryCtl = page.locator("summary", { hasText: "Official analysis" }).first();
  await summaryCtl.scrollIntoViewIfNeeded();
  await summaryCtl.evaluate((el) => (el as HTMLElement).click());
  await page.waitForTimeout(400);
  check(
    "3f: expands downward on click",
    await analysisBody.isVisible().catch(() => false),
  );
  // 3b: the plain-language summary above it renders bold.
  const weight = await page.evaluate(() => {
    const label = Array.from(document.querySelectorAll("p")).find((p) =>
      p.textContent?.startsWith("Plain-language summary"),
    );
    const summary = label?.nextElementSibling;
    return summary ? getComputedStyle(summary).fontWeight : null;
  });
  check("3b: measure summary renders bold", Number(weight) >= 600, `font-weight ${weight}`);
  await page.screenshot({ path: join(OUT, `walk19-${zip}-measures.png`) });
}

await page.screenshot({ path: join(OUT, `walk19-${zip}-ballot.png`), fullPage: true });

// Funding coverage across people (the five-distinct-people requirement is
// the gate trio + these ballot sections).
const fundingSections = (text.match(/Campaign money · FEC/gi) ?? []).length;
check("D34: funding sections render", fundingSections > 0, `${fundingSections} sections`);

console.log(`\n== walk19 ${zip} ==`);
for (const line of results) console.log(line);
console.log(
  "console errors:",
  consoleErrors.length === 0 ? "none" : consoleErrors.slice(0, 5).join(" | "),
);

await browser.close();
if (results.some((r) => r.startsWith("FAIL"))) process.exitCode = 1;
