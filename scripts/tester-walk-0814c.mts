/**
 * The 2026-08-14 third-session tester walk (session item 9): every zip at
 * 390×844 as a stranger — this session's surfaces first.
 *
 * THE GATE leads: the Rockaway Township mayor's card at 07866 must carry
 * NO Tucson content (item 1 — the per-type blurb wore one city's charter
 * on another city's mayor). Then: Kearsarge reachable at 03255 with all
 * layers default-on (2), the governor under STATE (2b), the three-tier
 * grouping on who-governs and the officials door (2c), the 85723 pothole
 * refusal (2d), the party breakdown on roll calls (3), the ballot CTA
 * header + ONE add-to-calendar control (4), the picks card + clear (5),
 * the 3-second ask beat (6e), and the first-run tutorial (6c).
 *
 * `pnpm tsx scripts/tester-walk-0814c.mts <zip>` — 85723 runs the
 * ask-box refusal walk only. The log supersedes docs/tester-pass.md.
 */
import { chromium, type Page } from "playwright";
import { join } from "node:path";

const OUT = "C:/Users/seanj/dev/we-the-people/screenshots";
const zip = process.argv[2] ?? "85701";

const results: string[] = [];
function check(name: string, ok: boolean, detail = "") {
  results.push(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

const GOVERNOR: Record<string, RegExp> = {
  "85701": /Katie Hobbs/,
  "85641": /Katie Hobbs/,
  "85723": /Katie Hobbs/,
  "07866": /Mikie Sherrill/,
  "03255": /Kelly Ayotte/,
};

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  reducedMotion: "reduce",
});
const page: Page = await context.newPage();
const body = () => page.locator("body").innerText();

await page.goto("http://localhost:3000/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(4000);

const zipInput = page.locator(".welcome-overlay input").first();
if (await zipInput.isVisible().catch(() => false)) {
  await zipInput.click();
  await page.keyboard.type(zip, { delay: 60 });
  await page.keyboard.press("Enter");
  await page.waitForTimeout(8000);
}

// ── 6c: the first-run tutorial, once, skippable at every step ──────────
{
  const tour = page.getByRole("dialog", { name: "Quick tour" });
  const tourVisible = await tour.isVisible().catch(() => false);
  check("6c: the tour appears on first visit after the zip resolves", tourVisible);
  if (tourVisible) {
    const text = await tour.innerText();
    check("6c: step 1 of 5 with a Skip", /1 of 5/i.test(text) && /Skip/i.test(text));
    await page.screenshot({ path: join(OUT, `walk0814c-${zip}-tutorial.png`) });
    if (zip === "85701") {
      // Walk it whole once: Next ×4 then Done.
      for (let i = 0; i < 4; i++) {
        await tour.getByRole("button", { name: "Next" }).click();
        await page.waitForTimeout(250);
      }
      const last = await tour.innerText();
      check("6c: step 5 of 5 reached, Done offered", /5 of 5/i.test(last) && /Done/i.test(last));
      await tour.getByRole("button", { name: "Done" }).click();
    } else {
      await tour.getByRole("button", { name: "Skip the tour" }).click();
    }
    await page.waitForTimeout(500);
    check(
      "6c: dismissed and gone",
      !(await tour.isVisible().catch(() => false)),
    );
  }
}

const noThanks = page.getByRole("button", { name: /No thanks|show me everything/i });
if (await noThanks.isVisible().catch(() => false)) {
  await noThanks.click();
  await page.waitForTimeout(1200);
}

// ── 85723: the ask-box refusal walk only (2d) ──────────────────────────
if (zip === "85723") {
  const ask = page.locator("input[data-ask-box]:visible").first();
  if (await ask.isVisible().catch(() => false)) {
    await ask.fill("pothole in front of my house");
    await ask.press("Enter");
    // 6e: the beat — during it, the line shows and no answer renders.
    await page.waitForTimeout(1200);
    const text = await body();
    check("6e: the hang-tight line shows during the beat", /I got you\.\.\. hang tight/.test(text));
    check("6e: the answer is held for the beat", !/Streets and roads/i.test(text));
    await page.screenshot({ path: join(OUT, `walk0814c-${zip}-beat.png`) });
    await page.waitForTimeout(3000);
    // Scope to the ask box's OWN answer: the PHA legitimately appears in
    // the who-governs bodies list on this page — the defect was the PHA
    // inside the ROUTED ANSWER, so that is what the gate checks.
    const askContainer = page
      .locator('div[class*="border-dashed"]')
      .filter({ has: page.locator("input[data-ask-box]:visible") })
      .first();
    const answerText = await askContainer.innerText();
    check(
      "2d: the pothole answer renders after the beat",
      /Streets|roads/i.test(answerText),
    );
    check(
      "2d GATE: the PHA never answers for a pothole",
      !/Public Housing Authority/i.test(answerText),
      answerText.slice(0, 200),
    );
    check(
      "2d: only own governments or the honest gap",
      /Tucson|general owner|haven't sourced/i.test(answerText),
    );
    await page.screenshot({ path: join(OUT, `walk0814c-${zip}-pothole.png`) });
  } else {
    check("85723: ask box reachable", false);
  }
  console.log(results.join("\n"));
  const failed = results.filter((r) => r.startsWith("FAIL")).length;
  console.log(`\n${results.length - failed}/${results.length} checks green at ${zip}`);
  await browser.close();
  process.exit(failed > 0 ? 1 : 0);
}

let text = await body();

// ── 2c: the who-governs card groups Local / State / Federal ────────────
check("2c: Local / State / Federal headers on who-governs",
  /Local/.test(text) && /State/.test(text) && /Federal/.test(text));
check("2c: 'Federal' is the label, never 'National'", !/National\b/.test(text));

// ── 2b: the governor under STATE, with the honesty line ────────────────
check(`2b: the governor renders (${GOVERNOR[zip]})`, GOVERNOR[zip].test(text));
check(
  "2b: statewide coverage honesty line",
  text.includes("The governor is the only statewide office listed so far."),
);
await page.screenshot({ path: join(OUT, `walk0814c-${zip}-whogoverns.png`) });

// ── 2: Kearsarge at 03255, and layers default on ───────────────────────
if (zip === "03255") {
  check("2: Kearsarge Regional named on who-governs", /Kearsarge/.test(text));
}
{
  // The sidebar drawer holds the district-type checkboxes.
  const menu = page.getByRole("button", { name: /Open menu/i });
  if (await menu.isVisible().catch(() => false)) {
    await menu.click();
    await page.waitForTimeout(800);
  }
  const boxes = page.locator('input[type="checkbox"]');
  const states = await boxes.evaluateAll((els) =>
    els.map((el) => ({
      checked: (el as HTMLInputElement).checked,
      label: el.closest("label")?.textContent?.trim() ?? "",
    })),
  );
  const districtBoxes = states.filter((s) =>
    /congressional|state senate|state house|county|school|municipal/i.test(s.label),
  );
  check(
    "2: all six district types default ON",
    districtBoxes.length >= 6 && districtBoxes.every((s) => s.checked),
    districtBoxes.map((s) => `${s.label}:${s.checked}`).join(", "),
  );
  const drawerText = await body();
  check("2: the overlay master reads ON (no off-notice)",
    !/The overlay is off/.test(drawerText));

  // ── 2c: the officials door groups in three tiers ─────────────────────
  const officialsDoor = page.getByRole("button", { name: /officials/i }).first();
  if (await officialsDoor.isVisible().catch(() => false)) {
    await officialsDoor.click();
    await page.waitForTimeout(1000);
    const door = page.getByRole("dialog", { name: /Officials here/i });
    const doorText = await door.innerText().catch(() => "");
    check(
      "2c: officials door renders Local, State, Federal in order",
      (() => {
        const upper = doorText.toUpperCase();
        const a = upper.indexOf("LOCAL");
        const b = upper.indexOf("STATE", a + 1);
        const c = upper.indexOf("FEDERAL", b + 1);
        return a >= 0 && b > a && c > b;
      })(),
    );
    check("2c: the door includes the governor", GOVERNOR[zip].test(doorText));
    check(
      "2c: the door includes local people (the old flat list had none)",
      (() => {
        const upper = doorText.toUpperCase();
        const a = upper.indexOf("LOCAL");
        const b = upper.indexOf("STATE", a + 1);
        return a >= 0 && doorText.slice(a, b).trim().length > 8;
      })(),
    );
    await page.screenshot({ path: join(OUT, `walk0814c-${zip}-officials-door.png`) });
    const close = door.getByRole("button", { name: "Close" });
    if (await close.isVisible().catch(() => false)) await close.click();
    await page.waitForTimeout(400);
  } else {
    check("2c: officials door reachable", false, "no officials stat button");
  }
  // Close the drawer if it's still open.
  const closeDrawer = page.getByRole("button", { name: /Close menu|Close/i }).first();
  if (await closeDrawer.isVisible().catch(() => false)) {
    await closeDrawer.click().catch(() => {});
    await page.waitForTimeout(400);
  }
}

// ── 1 THE GATE at 07866: the Rockaway mayor wears his own township ─────
if (zip === "07866") {
  const mayorBtn = page.getByRole("button", { name: /Joseph Jackson/ }).first();
  if (await mayorBtn.isVisible().catch(() => false)) {
    await mayorBtn.click();
    await page.waitForTimeout(1000);
    const more = page.getByRole("button", { name: /More/ }).first();
    if (await more.isVisible().catch(() => false)) {
      await more.click();
      await page.waitForTimeout(1500);
    }
    const modal = page.locator(".account-modal");
    const modalText = (await modal.allTextContents()).join(" ");
    check("1 GATE: the mayor's card renders", /Joseph Jackson/.test(modalText));
    check("1 GATE: NO Tucson content anywhere on the card", !/Tucson/i.test(modalText));
    check(
      "1: the blurb is jurisdiction-neutral",
      /depends on the city's own charter/.test(modalText),
    );
    check("1: the NJ phone stands", /973-627-7200/.test(modalText));
    await page.screenshot({ path: join(OUT, `walk0814c-${zip}-mayor-GATE.png`) });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(600);
  } else {
    check("1 GATE: Rockaway mayor reachable on who-governs", false);
  }
}

// ── 3: the party breakdown on a roll call (via a federal official) ─────
{
  const federalNames: Record<string, RegExp> = {
    "85701": /Ruben Gallego|Mark Kelly/,
    "85641": /Ruben Gallego|Mark Kelly/,
    // Sherrill is the governor now — her card has no roll calls; the
    // senators do.
    "07866": /Cory Booker|Andy Kim/,
    "03255": /Maggie Goodlander|Jeanne Shaheen|Maggie Hassan/,
  };
  const fed = page.getByRole("button", { name: federalNames[zip] }).first();
  if (await fed.isVisible().catch(() => false)) {
    await fed.click();
    await page.waitForTimeout(1000);
    const more = page.getByRole("button", { name: /More/ }).first();
    if (await more.isVisible().catch(() => false)) {
      await more.click();
    }
    await page.waitForTimeout(2500); // the votes fetch
    const modal = page.locator(".account-modal");
    const modalText = (await modal.allTextContents()).join(" ");
    check(
      "3: 'How the parties voted' under the member's vote",
      /How the parties voted:/.test(modalText),
    );
    check(
      "3: real numbers, no characterization",
      /\d+ for, \d+ against/.test(modalText) &&
        !/party-line|crossed the aisle/i.test(modalText),
    );
    const votes = modal.locator("text=How the parties voted").first();
    if (await votes.isVisible().catch(() => false)) await votes.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(OUT, `walk0814c-${zip}-partybreakdown.png`) });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(600);
  } else {
    check("3: a federal official reachable for the breakdown", false);
  }
}

// ── 6e: the ask beat, full 3 seconds ───────────────────────────────────
{
  const ask = page.locator("input[data-ask-box]:visible").first();
  if (await ask.isVisible().catch(() => false)) {
    await ask.fill("pothole in front of my house");
    await ask.press("Enter");
    await page.waitForTimeout(1200);
    let t = await body();
    check("6e: hang-tight shows during the beat", /I got you\.\.\. hang tight/.test(t));
    check("6e: answer held for the beat", !/Streets and roads/i.test(t));
    await page.waitForTimeout(3000);
    t = await body();
    check("6e: the answer lands after ~3s", /Streets|roads|Rather than guess/i.test(t));
  } else {
    check("6e: ask box reachable", false);
  }
}

// ── The ballot: the CTA header, one calendar control, picks card ───────
await page.goto(`http://localhost:3000/ballot?zip=${zip}`, {
  waitUntil: "domcontentloaded",
});
await page.waitForTimeout(2500);
text = await body();

if (/haven't built the ballot/.test(text)) {
  check("ballot: honest gap (no coverage here)", true);
} else {
  check("4: the standing header — The next election", /the next election/i.test(text));
  check("4: election day add-to-calendar present", /Add to calendar/.test(text));
  check(
    "4: 'Everyone below is on this ballot.'",
    text.includes("Everyone below is on this ballot."),
  );
  if (zip === "85701" || zip === "85641") {
    check(
      "4: the propositions sentence rides where propositions exist",
      text.includes("Propositions are voted on at the same time."),
    );
  }
  check(
    "4: the old two-link render is gone",
    !text.includes("Add to calendar (.ics)"),
  );
  check(
    "4: the incumbent-record line renders where the join holds",
    zip === "03255" || zip === "85701"
      ? /currently holds this seat, so there's more information about them/.test(text)
      : true,
    "line is per-incumbent; NJ contests may hold none",
  );

  // One control → the three-way popup.
  const addCal = page.getByRole("button", { name: "Add to calendar" }).first();
  if (await addCal.isVisible().catch(() => false)) {
    await addCal.click();
    await page.waitForTimeout(500);
    const menuText = await body();
    check(
      "4: the popup offers Apple, Google, Outlook",
      /Apple Calendar/.test(menuText) &&
        /Google Calendar/.test(menuText) &&
        /Outlook/.test(menuText),
    );
    await page.screenshot({ path: join(OUT, `walk0814c-${zip}-calendar-popup.png`) });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
  } else {
    check("4: add-to-calendar control reachable", false);
  }

  // ── 4/prior session: the incumbent-record modal actually opens ───────
  const record = page.getByRole("button", { name: /See their voting record/ }).first();
  if (await record.isVisible().catch(() => false)) {
    await record.scrollIntoViewIfNeeded();
    await record.click();
    await page.waitForTimeout(2500);
    const modalText = (await page.locator(".account-modal").allTextContents()).join(" ");
    check(
      "incumbent-record modal opens (the prior session's unproven item)",
      /recent votes/i.test(modalText),
    );
    check(
      "3: the breakdown rides the ballot-opened record too",
      /How the parties voted:|A party-by-party count/.test(modalText),
    );
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
  }

  // ── 5: the picks card, created and cleared. The Yes must be a PICK
  //     control's Yes — the reaction buttons also say Yes, and tapping
  //     one parks it behind the one-time disclosure gate. ─────────────
  const measureControl = page
    .locator('div[class*="border-dashed"]')
    .filter({ hasText: "What do you think?" })
    .filter({ has: page.getByRole("button", { name: "Yes", exact: true }) })
    .first();
  const candidateControl = page
    .locator('div[class*="border-dashed"]')
    .filter({ hasText: "What do you think?" })
    .first();
  // A measure's Yes where the ballot has measures; else the first
  // candidate option (NJ has no statewide measures — an honest absence).
  const anyPick = (await measureControl.count())
    ? measureControl.getByRole("button", { name: "Yes", exact: true })
    : candidateControl.locator("button").first();
  if (await anyPick.isVisible().catch(() => false)) {
    await anyPick.scrollIntoViewIfNeeded();
    await anyPick.click();
    await page.waitForTimeout(800);
    text = await body();
    check("5: My picks appears after a pick", /My picks — this device only/i.test(text));
    const create = page.getByRole("button", { name: "Create my card" }).first();
    if (await create.isVisible().catch(() => false)) {
      await create.scrollIntoViewIfNeeded();
      await create.click();
      await page.waitForTimeout(800);
      const card = page.locator('img[alt^="My picks card"]');
      check("5: the card renders as an image", await card.isVisible().catch(() => false));
      check(
        "5: download offered, nothing transmitted claim stated",
        (await body()).includes("Drawn on your device; nothing is sent anywhere."),
      );
      if (await card.isVisible().catch(() => false)) {
        await card.scrollIntoViewIfNeeded();
      }
      await page.screenshot({ path: join(OUT, `walk0814c-${zip}-picks-card.png`) });
    } else {
      check("5: Create my card reachable", false);
    }
    const clear = page.getByRole("button", { name: "Clear my picks" }).first();
    if (await clear.isVisible().catch(() => false)) {
      await clear.click();
      await page.waitForTimeout(300);
      check("5: clear confirms first", (await body()).includes("Really clear every pick"));
      await page.getByRole("button", { name: "Clear", exact: true }).first().click();
      await page.waitForTimeout(800);
      check(
        "5: picks cleared — the box is gone",
        !/My picks — this device only/i.test(await body()),
      );
    } else {
      check("5: Clear my picks reachable", false);
    }
  } else {
    check("5: a pick control reachable", false);
  }
}

console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("FAIL")).length;
console.log(`\n${results.length - failed}/${results.length} checks green at ${zip}`);
await browser.close();
process.exit(failed > 0 ? 1 : 0);
