/**
 * The 2026-08-14 sixth-session tester walk (session item 7): every zip at
 * 390×844 as a stranger, on the surfaces this session touched.
 *
 * THE GATE leads: the library question at 03255 must carry ZERO Arizona
 * references, and every link in the answer must resolve to a New Hampshire
 * body (item 1 — the topic template wore one county's fact at every zip).
 * Then: the ballot reachable within ONE TAP of the settled map (item 2,
 * the tester could not find it at all); no fixed control sitting over
 * readable content (item 3); all six district types on for a fresh device
 * AND for a device carrying pre-fix stored prefs (item 4); a thin
 * candidate's honesty line (item 5); the PAC labels with one explainer
 * opened (item 6); and the governor's official portrait (item 6b).
 *
 * `pnpm exec tsx scripts/tester-walk-0814e.mts <zip>`
 * The log supersedes docs/tester-pass.md.
 */
import { chromium, type Page } from "playwright";
import { join } from "node:path";

const OUT = "C:/Users/seanj/dev/we-the-people/screenshots";
const zip = process.argv[2] ?? "03255";

const results: string[] = [];
function check(name: string, ok: boolean, detail = "") {
  results.push(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

/** Markers of a jurisdiction outside the reader's own state. */
const FOREIGN: Record<string, RegExp> = {
  "85701": /\b(rockaway|morris|newbury|kearsarge|merrimack|jersey)\b/i,
  "85641": /\b(rockaway|morris|newbury|kearsarge|merrimack|jersey)\b/i,
  "07866": /\b(tucson|pima|tusd|arizona|newbury|kearsarge|merrimack)\b/i,
  "03255": /\b(tucson|pima|tusd|arizona|rockaway|morris|jersey)\b/i,
};
const OWN_LINK: Record<string, RegExp> = {
  "85701": /(pima|tucson|az\.gov|arizona)/i,
  "85641": /(pima|vail|az\.gov|arizona)/i,
  "07866": /(rockaway|morris|nj\.gov|njleg)/i,
  "03255": /(newbury|merrimack|kearsarge|nh\.gov|gencourt|gc\.nh)/i,
};
const GOVERNOR: Record<string, RegExp> = {
  "85701": /Katie Hobbs/,
  "85641": /Katie Hobbs/,
  "07866": /Mikie Sherrill/,
  "03255": /Kelly Ayotte/,
};

const browser = await chromium.launch();

/** One run of the app at phone width, with an optional pre-seeded store. */
async function open(seed?: Record<string, string>) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  if (seed) {
    await page.addInitScript((entries: Record<string, string>) => {
      for (const [k, v] of Object.entries(entries)) {
        window.localStorage.setItem(k, v);
      }
    }, seed);
  }
  await page.goto("http://localhost:3000/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);
  const zipInput = page.locator(".welcome-overlay input").first();
  if (await zipInput.isVisible().catch(() => false)) {
    await zipInput.click();
    await page.keyboard.type(zip, { delay: 60 });
    await page.keyboard.press("Enter");
    await page.waitForTimeout(8000);
  }
  // The tour and the narrowing prompt are sanctioned friction, not defects:
  // dismiss them the way a reader would and carry on.
  for (let i = 0; i < 4; i += 1) {
    const skip = page.getByRole("button", { name: /^(Skip|No thanks, show me everything)$/ }).first();
    if (await skip.isVisible().catch(() => false)) {
      await skip.click();
      await page.waitForTimeout(700);
    }
  }
  await page.waitForTimeout(1200);
  return { context, page };
}

const { context, page } = await open({ "wtp.tutorial_seen": "1" });
const body = () => page.locator("body").innerText();

// ── ITEM 1 (THE GATE): the library question ─────────────────────────────
{
  // Two ask boxes mount at once — the rail's and the who-governs card's.
  // At phone width the rail is a closed drawer, so the card's is the one a
  // reader can actually use; `.first()` picks the hidden rail copy and
  // reports the gate unreachable when it is not.
  const ask = page.locator(".coverage-notice [data-ask-box]").first();
  if (await ask.isVisible().catch(() => false)) {
    await ask.scrollIntoViewIfNeeded();
    await ask.click();
    await page.keyboard.type("library", { delay: 40 });
    await page.keyboard.press("Enter");
    await page.waitForTimeout(4500);
    // The AskBox root, not the input's immediate wrapper — the answer
    // renders as a sibling of the input row, so a one-level ancestor
    // captures the word "Ask" and nothing else.
    const answer = ask.locator(
      "xpath=ancestor::div[contains(@class,'border-dashed')][1]",
    );
    const answerText = await answer.innerText();
    check(
      "1 GATE: the library answer names no jurisdiction outside this state",
      !FOREIGN[zip].test(answerText),
      answerText.slice(0, 220).replace(/\s+/g, " "),
    );
    const hrefs = await answer.locator("a[href^='http']").evaluateAll((els) =>
      els.map((e) => (e as HTMLAnchorElement).href),
    );
    const strayLink = hrefs.find((h) => !OWN_LINK[zip].test(h));
    check(
      "1 GATE: every link in the answer resolves inside this state",
      hrefs.length > 0 && !strayLink,
      `${hrefs.length} links: ${hrefs.join(" ")}${strayLink ? ` — STRAY ${strayLink}` : ""}`,
    );
    await page.screenshot({ path: join(OUT, `walk0814e-${zip}-library-GATE.png`) });
  } else {
    check("1 GATE: the ask box is reachable", false);
  }
}

// ── ITEM 2: the ballot within ONE TAP of the settled map ────────────────
{
  const entry = page.locator(".coverage-notice-ballot").first();
  const visible = await entry.isVisible().catch(() => false);
  check("2 GATE: a What's-on-the-ballot entry is on screen at 390×844", visible);
  if (visible) {
    const boxNow = await entry.boundingBox();
    check(
      "2: the entry sits in the upper half of the screen, not under the chrome",
      Boolean(boxNow && boxNow.y < 422),
      boxNow ? `y=${Math.round(boxNow.y)}` : "no box",
    );
    // It must survive the card's own scrolling — it is pinned, not a row.
    await page.locator(".coverage-notice-body").first().evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await page.waitForTimeout(400);
    const after = await entry.boundingBox();
    check(
      "2: the entry is pinned — scrolling the card does not scroll it away",
      Boolean(after && boxNow && Math.abs(after.y - boxNow.y) < 2),
      after ? `y=${Math.round(after.y)}` : "gone",
    );
    await page.screenshot({ path: join(OUT, `walk0814e-${zip}-ballot-entry-GATE.png`) });
    // ONE TAP.
    await entry.click();
    await page.waitForTimeout(4000);
    check(
      "2 GATE: one tap reaches the ballot",
      page.url().includes("/ballot"),
      page.url(),
    );
    check(
      "2: the zip travelled with the tap — no re-asking",
      page.url().includes(`zip=${zip}`),
    );
  }
}

// ── ITEM 5 and 6 live on the ballot page, so walk them here ─────────────
if (page.url().includes("/ballot")) {
  const text = await body();
  check(
    "5: a thin candidate's absence is named, not silent",
    text.includes("We haven't found much about this candidate yet."),
  );
  check(
    "5: the line never apologizes or characterizes the candidate",
    !/sorry|unfortunately|little-known|lesser-known/i.test(text),
  );
  // Item 6: the PAC labels, and one explainer opened.
  const typeLabels = page.locator(".funding-type > summary");
  const labelCount = await typeLabels.count();
  check(
    "6: committee contributions carry a what-kind-of-money label",
    labelCount > 0,
    `${labelCount} labels on this ballot page`,
  );
  if (labelCount > 0) {
    const labels = await typeLabels.allInnerTexts();
    check(
      "6: the labels are differentiated, not all 'a political action committee'",
      new Set(labels.map((l) => l.trim())).size > 1,
      [...new Set(labels.map((l) => l.trim()))].slice(0, 6).join(" | "),
    );
    const first = typeLabels.first();
    await first.scrollIntoViewIfNeeded();
    await first.click();
    await page.waitForTimeout(500);
    const opened = await body();
    check(
      "6: tapping a label opens two sentences citing the FEC's own definition",
      opened.includes("the FEC's own definition"),
    );
    await page.screenshot({ path: join(OUT, `walk0814e-${zip}-pac-explainer.png`) });
  }
  await page.goBack();
  await page.waitForTimeout(5000);
}

// ── ITEM 3: no fixed control sits over readable content ─────────────────
{
  const overlaps = await page.evaluate(() => {
    const card = document.querySelector(".map-bottom-stack > .panel");
    if (!card) return ["no who-governs card on screen"];
    const box = card.getBoundingClientRect();
    const hits: string[] = [];
    for (const selector of [
      ".sidebar-toggle",
      ".maplibregl-ctrl-top-right",
      ".maplibregl-ctrl-top-left",
      ".legend",
      ".ballot-bubble",
      ".count-badge",
    ]) {
      const el = document.querySelector(selector);
      if (!el) continue;
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const over =
        !(r.right < box.left || r.left > box.right || r.bottom < box.top || r.top > box.bottom);
      if (over) hits.push(`${selector} at (${Math.round(r.x)},${Math.round(r.y)})`);
    }
    return hits;
  });
  check(
    "3: no fixed control overlaps the who-governs card",
    overlaps.length === 0,
    overlaps.join("; "),
  );
  // And nothing has escaped the viewport upward the way the card did.
  const offscreen = await page.evaluate(() => {
    const out: string[] = [];
    for (const selector of [".map-bottom-stack > .panel", ".count-badge", ".ballot-bubble"]) {
      const el = document.querySelector(selector);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (r.top < 0) out.push(`${selector} top=${Math.round(r.top)}`);
    }
    return out;
  });
  check(
    "3: nothing on the overlay stack runs off the top of the screen",
    offscreen.length === 0,
    offscreen.join("; "),
  );
  await page.screenshot({ path: join(OUT, `walk0814e-${zip}-controls.png`) });
}

// ── ITEM 6b: the governor's card carries the official portrait ──────────
{
  const text = await body();
  check("6b: the state's governor renders on who-governs", GOVERNOR[zip].test(text));
  const portrait = await page.evaluate(() => {
    const img = [...document.querySelectorAll("img")].find((i) =>
      /statewide-/.test(i.getAttribute("src") ?? ""),
    );
    if (!img) return null;
    img.loading = "eager";
    return { src: img.getAttribute("src"), w: img.naturalWidth, h: img.naturalHeight };
  });
  if (portrait) {
    check(
      "6b: the governor's portrait is served from our origin and decodes",
      portrait.src!.startsWith("/officials/") && portrait.w > 0,
      `${portrait.src} ${portrait.w}×${portrait.h}`,
    );
  } else {
    // The collapsed card names the governor without a face; the portrait
    // lives on their full card, which is where the brief's gate points.
    const link = page.getByRole("button", { name: GOVERNOR[zip] }).first();
    const opened = await link.isVisible().catch(() => false);
    if (opened) {
      await link.click();
      await page.waitForTimeout(1500);
      const shot = await page.evaluate(() => {
        const img = [...document.querySelectorAll("img")].find((i) =>
          /statewide-/.test(i.getAttribute("src") ?? ""),
        );
        if (!img) return null;
        img.loading = "eager";
        return { src: img.getAttribute("src"), w: img.naturalWidth, h: img.naturalHeight };
      });
      check(
        "6b: the governor's official portrait renders on their full card",
        Boolean(shot?.src?.startsWith("/officials/statewide-") && shot.w > 0),
        shot ? shot.src + " " + shot.w + "x" + shot.h : "no statewide image on the card",
      );
      await page.screenshot({ path: join(OUT, `walk0814e-${zip}-governor-portrait.png`) });
      await page.keyboard.press("Escape");
      await page.waitForTimeout(800);
    } else {
      check("6b: the governor's full card is openable", false);
    }
  }
}

// ── ITEM 4: the district types, on BOTH device profiles ─────────────────
async function districtBoxes(p: Page) {
  const toggle = p.locator(".sidebar-toggle");
  if (await toggle.isVisible().catch(() => false)) {
    await toggle.click();
    await p.waitForTimeout(900);
  }
  return p.evaluate(() => {
    const names = ["Congressional", "State Senate", "State House", "County", "School", "Municipal"];
    const boxes = [...document.querySelectorAll(".sidebar input[type=checkbox]")];
    const out: Record<string, boolean> = {};
    for (const input of boxes) {
      const label = (input.closest("label") ?? input.parentElement)?.textContent?.trim() ?? "";
      const hit = names.find((n) => label.startsWith(n));
      if (hit) out[hit] = (input as HTMLInputElement).checked;
    }
    return out;
  });
}
{
  const fresh = await districtBoxes(page);
  const onCount = Object.values(fresh).filter(Boolean).length;
  check(
    "4: fresh device — all six district types default on",
    Object.keys(fresh).length === 6 && onCount === 6,
    `${onCount} of ${Object.keys(fresh).length} on: ${JSON.stringify(fresh)}`,
  );
  await page.screenshot({ path: join(OUT, `walk0814e-${zip}-districts-fresh.png`) });
}
await context.close();

{
  // The second profile: a device carrying the pre-fix stored preference.
  const seeded = await open({
    "wtp.tutorial_seen": "1",
    "wtp.show_districts": "1",
  });
  const boxes = await districtBoxes(seeded.page);
  const onCount = Object.values(boxes).filter(Boolean).length;
  check(
    "4: device carrying pre-fix stored prefs — all six district types on",
    Object.keys(boxes).length === 6 && onCount === 6,
    `${onCount} of ${Object.keys(boxes).length} on`,
  );
  await seeded.page.screenshot({ path: join(OUT, `walk0814e-${zip}-districts-seeded.png`) });
  await seeded.context.close();
}

console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("FAIL")).length;
console.log(`\n${results.length - failed}/${results.length} checks green at ${zip}`);
await browser.close();
process.exit(failed > 0 ? 1 : 0);
