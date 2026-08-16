/**
 * The correction pass, on screen (2026-08-16, session g2).
 *
 * Every surface items 1–6 and 10 changed, at desktop AND 390px, with
 * MEASUREMENTS printed beside each shot — a screenshot proves pixels
 * rendered, a measurement proves the thing that was supposed to change did.
 *
 *   pnpm tsx scripts/shoot-0816g2.mts
 *   SHOOT_BASE_URL=https://… pnpm tsx scripts/shoot-0816g2.mts prod
 */

import { chromium, type Page } from "playwright";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(root, "screenshots");
const BASE = process.env.SHOOT_BASE_URL ?? "http://localhost:3000";
const PROD = process.argv[2] === "prod";
const PREFIX = PROD ? "prod-0816g2" : "after-0816g2";

const browser = await chromium.launch();
const notes: string[] = [];
function say(line: string) {
  notes.push(line);
  console.log(line);
}

async function open(width: number, height: number, zip: string, theme = "dark") {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 2,
    reducedMotion: "reduce",
  });
  await context.addInitScript(
    ([z, t]) => {
      try {
        sessionStorage.setItem(
          "wtp.approximate_location",
          JSON.stringify({ zip: z, savedAt: new Date().toISOString() }),
        );
        localStorage.setItem("wtp.tutorial_seen", "1");
        localStorage.setItem("wtp.reaction_disclosure_ack", "1");
        localStorage.setItem("wtp.recent_zips", JSON.stringify([z]));
        localStorage.setItem("wtp.theme", t as string);
      } catch {}
    },
    [zip, theme],
  );
  await context.addInitScript({
    content: `document.addEventListener("DOMContentLoaded",function(){
      var s=document.createElement("style");
      s.textContent="nextjs-portal{display:none !important}";
      document.head.appendChild(s);
    })`,
  });
  const page = await context.newPage();
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(7000);
  await page.evaluate((t) => {
    document.documentElement.setAttribute("data-theme", t as string);
  }, theme);
  return page;
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: join(OUT, `${PREFIX}-${name}.png`), fullPage: false });
  say(`  shot ${PREFIX}-${name}.png`);
}

/** Open the sidebar drawer at phone width; a no-op at desktop. */
async function openDrawer(page: Page) {
  const menu = page.locator('button[aria-label="Open menu"]');
  if ((await menu.count()) > 0 && (await menu.first().isVisible())) {
    await menu.first().click();
    await page.waitForTimeout(600);
  }
}

// ── Item 10: the amber remnant, by computed value, in both themes ────────
async function measureAccents(page: Page, theme: string) {
  const values = await page.evaluate(() => {
    // No inner named functions inside evaluate: tsx compiles them into a
    // call to esbuild__s __name helper, which does not exist in a browser.
    const style = getComputedStyle(document.documentElement);
    const out: Record<string, string> = {};
    for (const name of [
      "--link",
      "--action",
      "--accent-local",
      "--tier-fill-local",
      "--tier-fill-on",
      "--vote-yes",
      "--vote-text",
      "--panel-bg",
    ]) {
      out[name] = style.getPropertyValue(name).trim();
    }
    return {
      link: out["--link"],
      action: out["--action"],
      accentLocal: out["--accent-local"],
      tierFillLocal: out["--tier-fill-local"],
      tierFillOn: out["--tier-fill-on"],
      voteYes: out["--vote-yes"],
      voteText: out["--vote-text"],
      panelBg: out["--panel-bg"],
    };
  });
  say(`  [${theme}] --link ${values.link} · --action ${values.action}`);
  say(
    `  [${theme}] --tier-fill-local ${values.tierFillLocal} on ${values.tierFillOn} (was #6d4600 on #fdfaf4 in light)`,
  );
  say(`  [${theme}] --accent-local ${values.accentLocal} (map/legend only)`);
  if (values.tierFillLocal.toLowerCase() === "#6d4600") {
    say(`  !! [${theme}] THE AMBER REMNANT IS STILL LIVE`);
  }
  // Every element actually painting the dead brown, if any.
  const brown = await page.evaluate(() => {
    const hits: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("*"))) {
      const s = getComputedStyle(el);
      for (const prop of ["backgroundColor", "borderTopColor", "color", "outlineColor"] as const) {
        const v = s[prop];
        if (v === "rgb(109, 70, 0)" || v === "rgb(184, 134, 11)" || v === "rgb(255, 176, 0)") {
          hits.push(`${el.tagName.toLowerCase()}.${el.className.toString().slice(0, 40)} ${prop}=${v}`);
        }
      }
      if (hits.length > 24) break;
    }
    return hits;
  });
  say(`  [${theme}] elements painting a tier-amber value: ${brown.length}`);
  for (const h of brown.slice(0, 12)) say(`      ${h}`);
  return values;
}


/**
 * Open the officials door and click a person's name. `match` picks WHICH
 * person — a federal member is needed for the Voting Record at all.
 */
async function openPersonCard(page: Page, match?: RegExp): Promise<boolean> {
  const officials = page.locator('button[aria-label*="officials list" i]').first();
  if ((await officials.count()) === 0) return false;
  if (!(await officials.isVisible())) await openDrawer(page);
  if (!(await officials.isVisible())) {
    say("  officials door not visible at this width");
    return false;
  }
  await officials.click();
  await page.waitForTimeout(900);
  const rows = page.locator(".door-panel button.text-signal, .door-panel button.text-link");
  const row = match ? rows.filter({ hasText: match }).first() : rows.first();
  if ((await row.count()) === 0) {
    say("  no person row matched in the officials door");
    return false;
  }
  await row.click();
  await page.waitForTimeout(1800);
  return (await page.locator(".account-modal").count()) > 0;
}

/** Item 4: what the SMALL popup actually carries. */
async function measureSmallPopup(page: Page) {
  const shape = await page.evaluate(() => {
    const card = document.querySelector(".popup-card");
    if (!card) return null;
    const pills = card.querySelectorAll(".contact-pill");
    const row = card.querySelector(".contact-pill-row");
    const widths: number[] = [];
    for (const pill of Array.from(pills)) widths.push(Math.round(pill.getBoundingClientRect().width));
    const lefts = new Set<number>();
    for (const pill of Array.from(pills)) lefts.add(Math.round(pill.getBoundingClientRect().left));
    let more: number | null = null;
    for (const btn of Array.from(card.querySelectorAll("button"))) {
      if ((btn.textContent ?? "").trim().startsWith("More")) {
        more = Math.round(btn.getBoundingClientRect().width);
      }
    }
    const labels: string[] = [];
    for (const pill of Array.from(pills)) labels.push((pill.textContent ?? "").trim());
    return {
      chips: card.querySelectorAll(".id-chip").length,
      office: card.querySelectorAll(".id-office").length,
      tenure: card.querySelectorAll(".id-tenure").length,
      portrait: card.querySelectorAll(".id-portrait").length,
      pills: pills.length,
      labels,
      layout: row?.getAttribute("data-layout") ?? null,
      columns: lefts.size,
      pillWidths: Array.from(new Set(widths)),
      moreWidth: more,
      cardWidth: Math.round(card.getBoundingClientRect().width),
    };
  });
  if (!shape) {
    say("  small popup: not open");
    return;
  }
  say(
    `  small popup: ${shape.chips} chip(s) (want 1 = party) · ${shape.office} role line(s) (want 0) · ${shape.tenure} in-seat line(s) (want 0) · ${shape.portrait} circle`,
  );
  say(
    `  contact column: layout=${shape.layout} · ${shape.pills} pills in ${shape.columns} column(s) · widths ${shape.pillWidths.join("/")} · More ${shape.moreWidth}px · card ${shape.cardWidth}px`,
  );
  say(`  channels: ${shape.labels.join(" | ")}`);
}

/** Item 6: the Voting Record pane, and what it renders when selected. */
async function measureVotingRecord(page: Page) {
  const record = page.locator('.card-section-header:has-text("Voting Record")').first();
  if ((await record.count()) === 0) {
    say("  Voting Record: no section on this card");
    return;
  }
  await record.click();
  await page.waitForTimeout(900);
  const keyView = page.locator('button:has-text("When it mattered")').first();
  if ((await keyView.count()) === 0) {
    say("  When it mattered: no view button");
    return;
  }
  await keyView.click();
  await page.waitForTimeout(900);
  const pane = await page.evaluate(() => {
    const body = document.querySelector(".vote-view-body");
    if (!body) return null;
    const subs = body.querySelectorAll('.card-section[data-level="sub"]');
    const open = body.querySelectorAll('.card-section[data-level="sub"][data-open]');
    const entries = body.querySelectorAll("li[data-key-vote]");
    const indents: number[] = [];
    for (const sub of Array.from(subs)) {
      indents.push(
        Math.round(sub.getBoundingClientRect().left - body.getBoundingClientRect().left),
      );
    }
    return {
      height: Math.round(body.getBoundingClientRect().height),
      text: (body.textContent ?? "").trim().length,
      subs: subs.length,
      open: open.length,
      entries: entries.length,
      indents,
    };
  });
  if (!pane) {
    say("  When it mattered: the pane did not render");
    return;
  }
  say(
    `  When it mattered: ${pane.height}px tall, ${pane.text} chars, ${pane.subs} sub-group(s) of which ${pane.open} open, ${pane.entries} entries, indented ${pane.indents.join("/")}px`,
  );
  if (pane.entries === 0) say("  !! the pane rendered no entries");
}

// ── Item 1: tap a reaction and read the pill back ────────────────────────
async function tapReaction(page: Page, label: string) {
  const button = page.locator(`button.reaction-choice:has-text("${label}")`).first();
  if ((await button.count()) === 0) {
    say(`  reaction "${label}": no control on this surface`);
    return null;
  }
  await button.scrollIntoViewIfNeeded();
  await button.click();
  await page.waitForTimeout(2200);
  const state = await button.evaluate((el) => {
    // No inner named functions in an evaluate body — tsx compiles them into
    // a call to esbuild's `__name`, which does not exist in a browser.
    const s = getComputedStyle(el);
    const bg = s.backgroundColor;
    const fg = s.color;
    const lums: number[] = [];
    for (const rgb of [bg, fg]) {
      const m = /rgba?\((\d+), (\d+), (\d+)/.exec(rgb);
      if (!m) {
        lums.push(0);
        continue;
      }
      const parts: number[] = [];
      for (const raw of [m[1], m[2], m[3]]) {
        const v = Number(raw) / 255;
        parts.push(v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      }
      lums.push(0.2126 * parts[0] + 0.7152 * parts[1] + 0.0722 * parts[2]);
    }
    const la = lums[0];
    const lb = lums[1];
    const ratio = (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
    return {
      classes: el.className,
      background: bg,
      color: fg,
      ratio: Math.round(ratio * 100) / 100,
      pressed: el.getAttribute("aria-pressed"),
    };
  });
  say(
    `  reaction "${label}": pressed=${state.pressed} bg=${state.background} text=${state.color} contrast=${state.ratio}:1`,
  );
  say(`      classes: ${state.classes}`);
  if (state.ratio < 4.5) say(`  !! "${label}" IS UNREADABLE AFTER THE TAP (${state.ratio}:1)`);
  return state;
}

// ── The run ──────────────────────────────────────────────────────────────
for (const theme of ["dark", "light"] as const) {
  say(`\n=== ${theme} theme, desktop 1440×900, 85701 ===`);
  const page = await open(1440, 900, "85701", theme);
  await measureAccents(page, theme);
  await shot(page, `map-${theme}`);

  // Item 3: the who-governs list — no pills, no site links, body rows click.
  const list = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll(".person-row"));
    const chips = document.querySelectorAll(".person-row .id-chip").length;
    const partyText = document.querySelectorAll(".person-row-party").length;
    let siteLinks = 0;
    for (const a of Array.from(document.querySelectorAll(".person-row a"))) {
      if (/Their site/i.test(a.textContent ?? "")) siteLinks += 1;
    }
    const sourceMarks = document.querySelectorAll(".person-row .source-tag").length;
    let bodyButtons = 0;
    for (const btn of Array.from(document.querySelectorAll("li button"))) {
      if (/More about/i.test(btn.getAttribute("title") ?? "")) bodyButtons += 1;
    }
    const bodyLinksOut = Array.from(document.querySelectorAll("li > a[target=_blank]")).length;
    return { rows: rows.length, chips, partyText, siteLinks, sourceMarks, bodyButtons, bodyLinksOut };
  });
  say(
    `  who-governs: ${list.rows} person rows · ${list.chips} pills (want 0) · ${list.partyText} plain-party · ${list.siteLinks} "Their site" (want 0) · ${list.sourceMarks} source marks · ${list.bodyButtons} body rows opening a card · ${list.bodyLinksOut} body rows linking out (want 0)`,
  );

  await page.close();
}


// ── The person card: items 4, 6 and 1, in one pass, per theme ────────────
for (const theme of ["dark", "light"] as const) {
  say(`\n=== ${theme} theme, person card, desktop 1440×900, 85701 ===`);
  const page = await open(1440, 900, "85701", theme);
  const opened = await openPersonCard(page, /Kelly|Gallego|Ciscomani|Grijalva/i);
  if (!opened) {
    say("  could not open a federal member's card");
    await page.close();
    continue;
  }
  await shot(page, `person-card-${theme}`);
  await measureVotingRecord(page);
  await shot(page, `when-it-mattered-${theme}`);
  // Item 1: the pill, on a vote reaction inside the Recent pane.
  const recent = page.locator('button:has-text("Recent")').first();
  if ((await recent.count()) > 0) {
    await recent.click();
    await page.waitForTimeout(700);
  }
  await tapReaction(page, "Yes");
  await tapReaction(page, "Unsure");
  await shot(page, `reaction-pill-${theme}`);
  // Item 5: the two funding prompts, and their wording.
  const prompts = await page.evaluate(() => {
    const out: string[] = [];
    for (const p of Array.from(document.querySelectorAll(".reaction-box-prompt"))) {
      out.push((p.textContent ?? "").trim());
    }
    return out;
  });
  say(`  prompts on this card: ${JSON.stringify(prompts)}`);
  await page.close();
}

// ── The small popup (item 4), from a district click, both widths ─────────
for (const width of [1440, 390] as const) {
  say(`\n=== small popup, ${width}px, 85701 ===`);
  const page = await open(width, width === 390 ? 844 : 900, "85701", "dark");
  // The who-governs card is on screen at load; its first person row opens
  // the SMALL popup, which is the surface item 4 rebuilt.
  await openDrawer(page);
  const name = page.locator(".person-row-name button").first();
  if ((await name.count()) > 0) {
    await name.click();
    await page.waitForTimeout(1200);
    await measureSmallPopup(page);
    await shot(page, `small-popup-${width}`);
  } else {
    say("  no who-governs row for that person at this width");
  }
  await page.close();
}

// ── Phone width: the drawer ──────────────────────────────────────────────
say(`\n=== dark theme, phone 390×844, 85701 ===`);
const phone = await open(390, 844, "85701", "dark");
await openDrawer(phone);
await shot(phone, "phone-drawer");
await phone.close();

console.log(`\n--- ${notes.length} measured lines, shots in screenshots/${PREFIX}-*.png`);
await browser.close();
