/**
 * The item-7 walk — mobile round two, 2026-08-15.
 *
 *   pnpm walk:0815g                       # against localhost
 *   SHOOT_BASE_URL=https://… pnpm walk:0815g
 *
 * Every check the brief's item 7 names that a machine can actually assert,
 * on both a FRESH profile and a RETURNING one. Each check prints its own
 * evidence, and a failure names what it saw rather than only that it failed.
 *
 * Deliberately NOT a screenshot pass — `pnpm pairs` is that. This is the
 * behavioural half: gestures, state, counts.
 */
import { type Page } from "playwright";

import { makeRunId, syntheticRunHeaders } from "../lib/db/run-marker.ts";
import { launchGuarded } from "./browser.mts";

/**
 * C05 (2026-08-17): this run declares itself so the rows it writes to
 * production's search log are never counted as a reader's. The runner cannot
 * mark the row — the route writes it — so it says who it is in a header.
 */
const RUN_HEADERS = syntheticRunHeaders({
  WTP_RUN_ID:
    process.env.WTP_RUN_ID?.trim() ||
    makeRunId("walk-0815g", new Date().toISOString()),
});

const BASE = process.env.SHOOT_BASE_URL ?? "http://localhost:3000";
const PHONE = { width: 390, height: 844 };

let failures = 0;
function check(name: string, ok: boolean, evidence = "") {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${evidence ? ` — ${evidence}` : ""}`);
}

const browser = await launchGuarded({ label: "walk-0815g" });

/** A profile with a zip already in play, the way a mid-session reader has. */
async function returningPage(zip: string): Promise<Page> {
  const context = await browser.context({
    // C05: this run is ours, declared at write time.
    extraHTTPHeaders: RUN_HEADERS,
    viewport: PHONE,
    reducedMotion: "reduce",
  });
  await context.addInitScript(
    ({ zip }) => {
      try {
        sessionStorage.setItem(
          "wtp.approximate_location",
          JSON.stringify({ zip, savedAt: new Date().toISOString() }),
        );
        localStorage.setItem("wtp.tutorial_seen", "1");
        localStorage.setItem("wtp.recent_zips", JSON.stringify([zip, "03255"]));
      } catch {
        // Defaults are fine.
      }
    },
    { zip },
  );
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(9000);
  return page;
}

console.log(`Walk 0815g — ${BASE}, 390×844\n`);

// ── A fresh profile ────────────────────────────────────────────────────────
console.log("fresh profile");
{
  const context = await browser.context({
    // C05: this run is ours, declared at write time.
    extraHTTPHeaders: RUN_HEADERS,
    viewport: PHONE,
    reducedMotion: "reduce",
  });
  // No seed at all. This is what a first-ever open looks like — and, since
  // the location became session-scoped, what EVERY new tab looks like.
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(6000);

  const welcome = await page.locator(".welcome-card").count();
  check("6f: a fresh open asks where you are", welcome === 1, `${welcome} welcome card(s)`);

  const subtitle = await page.locator(".welcome-subtitle").count();
  check("6e2: the institutional subtitle is gone", subtitle === 0);

  const titleSize = await page
    .locator(".welcome-title")
    .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  const msgSize = await page
    .locator(".welcome-msg p")
    .first()
    .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  check(
    "6e2: the type is on the readable scale",
    titleSize >= 26 && msgSize >= 15,
    `title ${titleSize}px, mission ${msgSize}px`,
  );
  await context.close();
}

// ── A returning profile at 85701 ───────────────────────────────────────────
console.log("\nreturning profile, 85701");
{
  const page = await returningPage("85701");

  // Item 2 — both entries in one tap, and the ballot pill is a standout.
  const pillHeight = await page
    .locator(".ballot-pill-main")
    .evaluate((el) => el.getBoundingClientRect().height);
  const pillFont = await page
    .locator(".ballot-pill-main")
    .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  check(
    "2: the ballot pill is a standout entry",
    pillHeight >= 40 && pillFont >= 14,
    `${Math.round(pillHeight)}px tall, ${pillFont}px type`,
  );
  check("2: the Ask pill is on the map", (await page.locator(".ask-pill").count()) === 1);

  // Item 1 — a press outside minimizes the card.
  const cardBefore = await page.locator(".coverage-notice").count();
  // (200, 100) — the strip of map BETWEEN the floaters (which end near y=67)
  // and the card (which starts at y=142 at this zip). Measured, not guessed:
  // the first version of this walk clicked (200, 250), which is INSIDE the
  // card, and reported the feature broken when the aim was.
  await page.mouse.click(200, 100);
  await page.waitForTimeout(600);
  const fab = await page.locator(".notice-fab").count();
  check(
    "1: a press outside dismisses the who-governs card",
    cardBefore === 1 && fab === 1,
    `card ${cardBefore} → bubble ${fab}`,
  );

  // Item 6f — and it STAYS dismissed through a pan, with no blink.
  await page.mouse.move(200, 500);
  await page.mouse.down();
  await page.mouse.move(120, 300, { steps: 16 });
  await page.mouse.up();
  await page.waitForTimeout(3200);
  const stillBubble = await page.locator(".notice-fab").count();
  const reappeared = await page.locator(".coverage-notice").count();
  check(
    "6f: dismissed stays dismissed across a pan",
    stillBubble === 1 && reappeared === 0,
    `bubble ${stillBubble}, card ${reappeared}`,
  );

  // Item 2 — Ask reopens the card and focuses the box already in it.
  await page.locator(".ask-pill").click();
  await page.waitForTimeout(900);
  const focused = await page.evaluate(
    () => document.activeElement?.getAttribute("data-ask-box") !== null,
  );
  check("2: Ask focuses the ask box on the card", focused);

  // Item 3 — the zip switcher, with recents.
  await page.locator(".ballot-pill-zip").click();
  await page.waitForTimeout(500);
  const recents = await page.locator(".zip-switcher-recents button").count();
  check(
    "3: the zip switcher opens with device-local recents",
    (await page.locator(".zip-switcher").count()) === 1 && recents >= 1,
    `${recents} recent(s)`,
  );
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);

  // Item 5 — each tier toggle wears its own colour.
  await page.locator(".sidebar-toggle").click();
  await page.waitForTimeout(800);
  const tierColours = await page.evaluate(() => {
    const out: Record<string, string> = {};
    for (const el of document.querySelectorAll<HTMLElement>(
      '.view-btn[data-active="true"]',
    )) {
      out[el.dataset.tier ?? "?"] = getComputedStyle(el).backgroundColor;
    }
    return out;
  });
  const distinct = new Set(Object.values(tierColours)).size;
  check(
    "5: each selected tier wears its own colour",
    distinct === Object.keys(tierColours).length && distinct >= 3,
    JSON.stringify(tierColours),
  );

  // Item 5 — nothing fixed paints over the open drawer.
  const legendOverDrawer = await page.evaluate(() => {
    const legend = document.querySelector(".legend");
    if (!legend) return "no legend element";
    return getComputedStyle(legend).display === "none"
      ? "hidden"
      : "VISIBLE OVER THE DRAWER";
  });
  check(
    "5: the legend does not paint over the open drawer",
    legendOverDrawer === "hidden",
    legendOverDrawer,
  );
  await page.locator('.sidebar button[aria-label="Hide sidebar"]').click();
  await page.waitForTimeout(600);

  await page.context().close();
}

// ── The battlecard, both chambers ──────────────────────────────────────────
console.log("\nbattlecards at 85701");
{
  const page = await returningPage("85701");

  for (const [who, name] of [
    ["a senator", "Mark Kelly"],
    ["a House member", "Adelita"],
  ] as const) {
    // Opening the previous modal was a press outside the card, so item 1's
    // dismissal has already minimized it — which is the feature working, and
    // which is why the second iteration used to find no rows at all and
    // report a House member unreachable. Reopen from the bubble first.
    if ((await page.locator(".notice-fab").count()) > 0) {
      await page.locator(".notice-fab").click();
      await page.waitForTimeout(700);
    }
    const opened = await page
      .locator(`.coverage-notice button:has-text("${name}")`)
      .count();
    if (opened === 0) {
      check(`6b: ${who}'s card is reachable from who-governs`, false, `no "${name}" row`);
      continue;
    }
    await page.locator(`.coverage-notice button:has-text("${name}")`).first().click();
    await page.waitForTimeout(700);
    await page.locator('.popup-card button:has-text("More")').click();
    await page.waitForTimeout(900);

    const headers = await page.locator(".account-modal-body .card-section-title").allInnerTexts();
    check(
      `6b4: ${who}'s card is section headers, in order`,
      headers.length >= 5,
      headers.join(" · "),
    );

    const openSections = await page.locator(".card-section[data-open]").count();
    check(`6b4: ${who}'s sections start collapsed`, openSections === 0);

    await page.locator('.card-section-header:has-text("When it mattered")').click();
    await page.waitForTimeout(500);
    const lawsMeta = await page
      .locator('.card-section-header:has-text("Votes on laws") .card-section-meta')
      .innerText()
      .catch(() => "");
    check(
      `6b: ${who}'s laws group states its N`,
      lawsMeta.trim() === "20",
      `meta "${lawsMeta.trim()}"`,
    );

    const peopleMeta = await page
      .locator('.card-section-header:has-text("Votes on people") .card-section-meta')
      .innerText()
      .catch(() => "");
    if (who === "a House member") {
      await page.locator('.card-section-header:has-text("Votes on people")').click();
      await page.waitForTimeout(400);
      // `.last()`: the "Votes on people" section is NESTED inside the "When
      // it mattered" section, so a `:has()` on the header matches the outer
      // one too. The inner one is the group's own body.
      const body = await page
        .locator(
          '.card-section:has(> .card-section-header:has-text("Votes on people")) > .card-section-body',
        )
        .last()
        .innerText();
      check(
        "6b: a House card says the nominations line ONCE",
        /doesn't vote on nominations/.test(body) &&
          body.split("doesn't vote on nominations").length === 2,
        body.trim().slice(0, 80),
      );
    } else {
      check(
        "6b: a senator's people group is full",
        peopleMeta.trim() === "16",
        `meta "${peopleMeta.trim()}"`,
      );
    }

    // 6d — the identity block carries the term and, on the large card, age.
    const identity = await page.locator(".account-modal-body").innerText();
    check(
      `6d: ${who}'s card states the term end`,
      /In seat until/.test(identity),
      (identity.match(/In seat until [^\n]*/) ?? [""])[0],
    );

    await page.locator('.account-modal button[aria-label="Close"]').click();
    await page.waitForTimeout(500);
  }

  await page.context().close();
}

// ── Newbury's Zoning Board, at 03255 ───────────────────────────────────────
console.log("\n03255 — the Zoning Board");
{
  const page = await returningPage("03255");

  /*
   * A DISCRIMINATED union, not two object shapes (fixed 2026-08-16).
   *
   * This returned `{ error: number }` on a bad response and
   * `{ total, zba, first }` otherwise, and the caller narrowed with
   * `"zba" in found`. TypeScript widens a union like that so BOTH members
   * carry every key — one of them optional-undefined — so the `in` check
   * narrows nothing and `found.zba` stays `number | undefined`. That is
   * `TS18048`, and it is the error that failed Netlify's build for
   * `705f73b` and left production on the previous deploy.
   *
   * `ok` is a real discriminant, so the narrowing below is real. No `!`
   * assertion anywhere: the whole point of the check is that it cannot be
   * told to stop worrying.
   */
  type ZbaProbe =
    | { ok: false; status: number }
    | { ok: true; total: number; zba: number; first: string | null };

  const found: ZbaProbe = await page.evaluate(async () => {
    const r = await fetch("/api/meetings?lat=43.32&lng=-72.04&zip=03255", {
      headers: { accept: "application/json" },
    });
    if (!r.ok) return { ok: false as const, status: r.status };
    const body = (await r.json()) as {
      meetings: { id: string; bodyName: string; location: { name: string } }[];
    };
    const zba = body.meetings.filter((m) => m.id.includes("zoning-board"));
    return {
      ok: true as const,
      total: body.meetings.length,
      zba: zba.length,
      first: zba[0] ? `${zba[0].bodyName} @ ${zba[0].location.name}` : null,
    };
  });

  /*
   * An unreachable meetings service is not a failed CHECK — it is a walk
   * that could not run its check, and the two must never render the same.
   * Throwing here is deliberate: a `check(..., false)` would land in the
   * summary looking exactly like "the Zoning Board is missing from
   * production", which is a different and much more alarming claim.
   *
   * A ZBA count of zero, by contrast, IS a failed check and stays one — it
   * is the answer the walk exists to get, and it fails loudly through
   * `check` with the counts printed beside it.
   */
  if (!found.ok) {
    throw new Error(
      `walk-0815g: /api/meetings at 03255 answered ${found.status} — the Zoning Board check could not run, so its result is unknown rather than negative`,
    );
  }

  check(
    "0: the Zoning Board's meetings are live at 03255",
    found.zba > 0,
    // The count AND its denominator, per the standing rule: "1 of 31" is an
    // answer, "1" on its own is a number.
    `${found.zba} zoning-board row(s) of ${found.total} meetings${found.first ? ` — ${found.first}` : ""}`,
  );
  await page.context().close();
}

await browser.close();
console.log(`\n${failures === 0 ? "all checks passed" : `${failures} check(s) failed`}`);
if (failures > 0) process.exit(1);
