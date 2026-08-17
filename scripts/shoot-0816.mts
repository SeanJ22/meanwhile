/**
 * The 0816 card-face pass, on screen.
 *
 * Screenshots the surfaces items 1–8 rebuilt, at desktop AND 390px, and
 * PRINTS MEASUREMENTS beside each — a screenshot proves the pixels rendered,
 * a measurement proves the thing that was supposed to change did.
 *
 *   pnpm tsx scripts/shoot-0816.mts
 *   SHOOT_BASE_URL=https://… pnpm tsx scripts/shoot-0816.mts prod
 */

import { chromium, type Page } from "playwright";
import { makeRunId, syntheticRunHeaders } from "../lib/db/run-marker.ts";

/**
 * C05 (2026-08-17): this run declares itself so the rows it writes to
 * production's search log are never counted as a reader's. The runner cannot
 * mark the row — the route writes it — so it says who it is in a header.
 */
const RUN_HEADERS = syntheticRunHeaders({
  WTP_RUN_ID:
    process.env.WTP_RUN_ID?.trim() ||
    makeRunId("shoot-0816", new Date().toISOString()),
});

import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(root, "screenshots");
const BASE = process.env.SHOOT_BASE_URL ?? "http://localhost:3000";
const PREFIX = process.argv[2] === "prod" ? "prod-0816" : "after-0816";

const browser = await chromium.launch();

async function open(width: number, height: number, zip: string) {
  const context = await browser.newContext({
    // C05: this run is ours, declared at write time.
    extraHTTPHeaders: RUN_HEADERS,
    viewport: { width, height },
    deviceScaleFactor: 2,
    reducedMotion: "reduce",
  });
  await context.addInitScript(
    ([z]) => {
      try {
        // SESSION storage, not local — M90 made the reader's location
        // session-scoped, and seeding the old key leaves the welcome overlay
        // on screen intercepting every click. (This cost one run.)
        sessionStorage.setItem(
          "wtp.approximate_location",
          JSON.stringify({ zip: z, savedAt: new Date().toISOString() }),
        );
        localStorage.setItem("wtp.tutorial_seen", "1");
        localStorage.setItem("wtp.reaction_disclosure_ack", "1");
        localStorage.setItem("wtp.recent_zips", JSON.stringify([z]));
      } catch {}
    },
    [zip],
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
  return page;
}

/**
 * Open the officials door and click a person row.
 *
 * `match` picks WHICH person — a federal member is needed to see the Voting
 * Record, the Committees section and the social pills at all, and the door's
 * first row is a local one at every demo zip.
 */
async function openPersonCard(page: Page, match?: RegExp): Promise<boolean> {
  // At 390px the counters live inside the sidebar drawer, which starts
  // closed. Clicking a hidden button times out rather than failing fast, so
  // the drawer is opened first when it is not already showing.
  const officials = page.locator('button[aria-label*="officials list" i]').first();
  if ((await officials.count()) === 0) return false;
  if (!(await officials.isVisible())) {
    const menu = page.locator('button[aria-label="Open menu"]').first();
    if ((await menu.count()) > 0) {
      await menu.click();
      await page.waitForTimeout(700);
    }
  }
  if (!(await officials.isVisible())) {
    console.log("    officials door still not visible at this width");
    return false;
  }
  await officials.click();
  await page.waitForTimeout(900);

  if (match) {
    const named = page
      .locator(".door-panel button.text-signal, .door-panel button.text-link")
      .filter({ hasText: match })
      .first();
    if ((await named.count()) > 0) {
      await named.click();
      await page.waitForTimeout(1800);
      return (await page.locator(".account-modal").count()) > 0;
    }
    const seen = await page.evaluate(() =>
      [...document.querySelectorAll(".door-panel button")]
        .map((b) => (b.textContent ?? "").trim())
        .filter(Boolean)
        .slice(0, 40),
    );
    console.log("    no match; door offered:", JSON.stringify(seen));
    return false;
  }
  // A person's name inside the officials door is a plain <button> in the
  // link register. Filtered to the panel so the door's own chrome (close,
  // "show boundaries") cannot be picked instead.
  const row = page.locator(".door-panel button.text-signal, .door-panel button.text-link").first();
  if ((await row.count()) === 0) {
    const names = await page.evaluate(() =>
      [...document.querySelectorAll(".door-panel button")]
        .map((b) => (b.textContent ?? "").trim())
        .slice(0, 12),
    );
    console.log("    door buttons seen:", JSON.stringify(names));
    return false;
  }
  await row.click();
  await page.waitForTimeout(1500);
  return (await page.locator(".account-modal").count()) > 0;
}

function say(label: string, value: unknown) {
  console.log(`    ${label}: ${JSON.stringify(value)}`);
}

// ---------------------------------------------------------------- desktop
{
  const page = await open(1440, 950, "85701");
  console.log("desktop 1440 @ 85701");

  // The new accent, read as a COMPUTED value — never off the stylesheet.
  const tokens = await page.evaluate(() => {
    const s = getComputedStyle(document.documentElement);
    const out: Record<string, string> = {};
    for (const t of [
      "--link",
      "--action",
      "--signal",
      "--vote-yes",
      "--vote-no",
      "--vote-neutral",
      "--party-on",
      "--accent-local",
    ]) {
      out[t] = s.getPropertyValue(t).trim();
    }
    return out;
  });
  say("computed tokens", tokens);

  await page.screenshot({ path: join(OUT, `${PREFIX}-01-map-desktop.png`) });

  // A FEDERAL member: the only card that carries a Voting Record, a
  // Committees section and social pills at all. Ciscomani is AZ-6, the
  // reference screenshot's own subject.
  if (await openPersonCard(page, /Ciscomani|Kelly|Gallego|Grijalva/)) {
    await page.screenshot({ path: join(OUT, `${PREFIX}-02-battlecard-desktop.png`) });

    const header = await page.evaluate(() => {
      const name = document.querySelector(".id-name");
      const portrait = document.querySelector(".id-portrait");
      const chips = [...document.querySelectorAll(".id-chip")].map((c) => ({
        text: (c.textContent ?? "").trim(),
        filled: c.hasAttribute("data-fill"),
        height: Math.round(c.getBoundingClientRect().height),
      }));
      const pills = [...document.querySelectorAll(".contact-pill")].map((p) => ({
        text: (p.textContent ?? "").trim().slice(0, 24),
        height: Math.round(p.getBoundingClientRect().height),
      }));
      const ring = portrait ? getComputedStyle(portrait).borderTopColor : null;
      return {
        name: (name?.textContent ?? "").trim(),
        nameSize: name ? getComputedStyle(name).fontSize : null,
        portrait: portrait
          ? {
              w: Math.round(portrait.getBoundingClientRect().width),
              h: Math.round(portrait.getBoundingClientRect().height),
              radius: getComputedStyle(portrait).borderTopLeftRadius,
              ring,
            }
          : null,
        chips,
        pills,
        sections: [...document.querySelectorAll(".card-section-title")].map(
          (t) => (t.textContent ?? "").trim(),
        ),
      };
    });
    say("identity header", header);

    // Open Voting Record and read the two views + the chevron directions.
    const voting = page
      .locator(".card-section-header", { hasText: "Voting Record" })
      .first();
    if ((await voting.count()) > 0) {
      await voting.click();
      await page.waitForTimeout(2500);
      await page.screenshot({
        path: join(OUT, `${PREFIX}-03-voting-record-recent.png`),
      });

      const views = await page.evaluate(() => {
        const btns = [...document.querySelectorAll(".vote-view-btn")].map((b) => ({
          text: (b.textContent ?? "").trim(),
          selected: b.hasAttribute("data-selected"),
          width: Math.round(b.getBoundingClientRect().width),
        }));
        const body = document.querySelector(".vote-view-body");
        const section = document.querySelector(".card-section[data-open]");
        const pills = [...document.querySelectorAll(".vote-pill")]
          .slice(0, 6)
          .map((p) => ({
            text: (p.textContent ?? "").trim(),
            bg: getComputedStyle(p).backgroundColor,
          }));
        // The chevron check: every OPEN section's own chevron must be
        // rotated and every CLOSED one must not.
        const chevrons = [...document.querySelectorAll(".card-section")].map((s) => {
          const chev = s.querySelector(":scope > .card-section-header .card-section-chevron");
          return {
            title: (s.querySelector(":scope > .card-section-header .card-section-title")?.textContent ?? "").trim(),
            open: s.hasAttribute("data-open"),
            transform: chev ? getComputedStyle(chev).transform : null,
          };
        });
        return {
          btns,
          bodyWidth: body ? Math.round(body.getBoundingClientRect().width) : null,
          sectionWidth: section ? Math.round(section.getBoundingClientRect().width) : null,
          pills,
          chevrons,
        };
      });
      say("voting record", views);

      const whenItMattered = page
        .locator(".vote-view-btn", { hasText: "When it mattered" })
        .first();
      if ((await whenItMattered.count()) > 0) {
        await whenItMattered.click();
        await page.waitForTimeout(700);
        await page.screenshot({
          path: join(OUT, `${PREFIX}-04-voting-record-key.png`),
        });
        const after = await page.evaluate(() =>
          [...document.querySelectorAll(".vote-view-btn")].map((b) => ({
            text: (b.textContent ?? "").trim(),
            selected: b.hasAttribute("data-selected"),
          })),
        );
        say("accordion after switching", after);

        // The sub-group chevrons, closed, inside an OPEN parent — the defect.
        const sub = await page.evaluate(() =>
          [...document.querySelectorAll(".card-section")]
            .map((s) => ({
              title: (s.querySelector(":scope > .card-section-header .card-section-title")?.textContent ?? "").trim(),
              open: s.hasAttribute("data-open"),
              transform: getComputedStyle(
                s.querySelector(":scope > .card-section-header .card-section-chevron")!,
              ).transform,
            }))
            .filter((r) => /Votes on/.test(r.title)),
        );
        say("sub-group chevrons (closed must be matrix(1,0,0,1,0,0))", sub);
      }
    }

    // Sources — the false sentence.
    const sources = page.locator(".card-section-header", { hasText: "Sources" }).first();
    if ((await sources.count()) > 0) {
      await sources.click();
      await page.waitForTimeout(500);
      const s = await page.evaluate(() => {
        const section = [...document.querySelectorAll(".card-section")].find((x) =>
          /Sources/.test(x.querySelector(".card-section-title")?.textContent ?? ""),
        );
        return {
          meta: section?.querySelector(".card-section-meta")?.textContent ?? null,
          rows: section?.querySelectorAll(".account-modal-person").length ?? 0,
          text: (section?.textContent ?? "").slice(0, 160),
        };
      });
      say("person card Sources (stated N must equal rows)", s);
      await page.screenshot({ path: join(OUT, `${PREFIX}-05-person-sources.png`) });
    }
  } else {
    console.log("    !! could not open a person battlecard");
  }
  await page.close();
}

// ------------------------------------------- the mini card, THE test case
{
  const page = await open(390, 844, "85701");
  console.log("\nphone 390 @ 85701 — the mini card");

  const overflow = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
  }));
  say("horizontal overflow (scrollW must not exceed clientW)", overflow);
  await page.screenshot({ path: join(OUT, `${PREFIX}-06-map-390.png`) });

  /*
   * "Dr. Matt Heinz" is the brief's own test case: a Pima supervisor whose
   * office title is "County Supervisor, District 2 (Vice Chair)". That title
   * as a nowrap key is what starved the value column and rendered his NAME
   * one character per line. The measurement below is the proof: a name box
   * narrower than about 60px cannot hold a word, and that is what vertical
   * text looks like as a number.
   */
  if (await openPersonCard(page, /Heinz/)) {
    await page.screenshot({ path: join(OUT, `${PREFIX}-07-heinz-390.png`) });
    const m = await page.evaluate(() => {
      const name = document.querySelector(".id-name");
      const rect = name?.getBoundingClientRect();
      return {
        name: (name?.textContent ?? "").trim(),
        nameWidth: rect ? Math.round(rect.width) : null,
        nameHeight: rect ? Math.round(rect.height) : null,
        lines: rect ? Math.round(rect.height / 20) : null,
        pills: [...document.querySelectorAll(".contact-pill")].map((p) => ({
          text: (p.textContent ?? "").trim().slice(0, 22),
          h: Math.round(p.getBoundingClientRect().height),
          w: Math.round(p.getBoundingClientRect().width),
        })),
      };
    });
    say("Heinz at 390 (nameWidth must be wide, height must be 1-2 lines)", m);
    await page.locator(".account-modal .popup-expand-btn").first().click().catch(() => {});
    await page.waitForTimeout(400);
  }

  // The district card's representation list — where the vertical text was.
  const districtsDoor = page.locator('button[aria-label*="districts" i]').first();
  if ((await districtsDoor.count()) > 0) {
    await districtsDoor.click().catch(() => {});
    await page.waitForTimeout(700);
    await page.screenshot({ path: join(OUT, `${PREFIX}-08-districts-390.png`) });
  }

  await page.close();
}


// ------------------------------------- item 6: counters + who-governs
for (const [w, h, label] of [
  [1440, 950, "desktop"],
  [390, 844, "phone"],
] as const) {
  const page = await open(w, h, "85701");
  console.log(`\n${label} ${w} — counters and who-governs`);
  if (w < 768) {
    const menu = page.locator('button[aria-label="Open menu"]').first();
    if ((await menu.count()) > 0) {
      await menu.click();
      await page.waitForTimeout(700);
    }
  }

  // The overflow check is the whole point: the labels used to be wider than
  // the tiles that held them, which is what "overflowing its tiles" means as
  // a number.
  const counters = await page.evaluate(() =>
    [...document.querySelectorAll(".stat-card")].map((c) => {
      const lab = c.querySelector(".label");
      return {
        label: (lab?.textContent ?? "").trim(),
        num: (c.querySelector(".num")?.textContent ?? "").trim(),
        tileW: Math.round(c.getBoundingClientRect().width),
        overflows: lab ? lab.scrollWidth > lab.clientWidth + 1 : null,
      };
    }),
  );
  say("counters (overflows must all be false)", counters);
  await page.screenshot({ path: join(OUT, `${PREFIX}-12-counters-${w}.png`) });

  const gov = await page.evaluate(() => {
    const card = document.querySelector(".coverage-notice");
    if (!card) return null;
    const rows = [...card.querySelectorAll(".person-row")].map((r) => {
      const n = r.querySelector(".person-row-name") as HTMLElement | null;
      return {
        name: (n?.textContent ?? "").trim(),
        nameW: n ? Math.round(n.getBoundingClientRect().width) : null,
      };
    });
    return {
      cardW: Math.round(card.getBoundingClientRect().width),
      personRows: rows.length,
      sample: rows.slice(0, 4),
      partyChips: card.querySelectorAll(".id-chip[data-fill]").length,
      theirSite: [...card.querySelectorAll("a")].filter((a) =>
        /Their site/.test(a.textContent ?? ""),
      ).length,
    };
  });
  say("who-governs", gov);
  await page.screenshot({ path: join(OUT, `${PREFIX}-13-who-governs-${w}.png`) });
  await page.close();
}

// -------------------------------------- a member WITH the full social row
{
  const page = await open(1440, 950, "85701");
  console.log("\ndesktop — the full contact pill row");
  if (await openPersonCard(page, /Mark Kelly/)) {
    const row = await page.evaluate(() => ({
      name: (document.querySelector(".id-name")?.textContent ?? "").trim(),
      pills: [...document.querySelectorAll(".contact-pill")].map((p) =>
        (p.textContent ?? "").trim(),
      ),
      marks: document.querySelectorAll(".contact-pill svg").length,
    }));
    say("the full pill row (X, Facebook, YouTube, Instagram + contact)", row);
    await page.screenshot({ path: join(OUT, `${PREFIX}-09-contact-pills.png`) });

    const sources = page.locator(".card-section-header", { hasText: "Sources" }).first();
    if ((await sources.count()) > 0) {
      await sources.click();
      await page.waitForTimeout(400);
      const s = await page.evaluate(() => {
        const section = [...document.querySelectorAll(".card-section")].find((x) =>
          /Sources/.test(x.querySelector(".card-section-title")?.textContent ?? ""),
        );
        return {
          meta: section?.querySelector(".card-section-meta")?.textContent ?? null,
          rows: section?.querySelectorAll(".account-modal-person").length ?? 0,
        };
      });
      say("federal Sources (stated N must equal rows)", s);
    }

    const committees = page.locator(".card-section-header", { hasText: "Committees" }).first();
    if ((await committees.count()) > 0) {
      await committees.click();
      await page.waitForTimeout(600);
      const c = await page.evaluate(() => {
        const section = [...document.querySelectorAll(".card-section")].find((x) =>
          /Committees/.test(x.querySelector(".card-section-title")?.textContent ?? ""),
        );
        return {
          meta: section?.querySelector(".card-section-meta")?.textContent ?? null,
          rows: section?.querySelectorAll("li").length ?? 0,
          first: (section?.querySelector("li")?.textContent ?? "").slice(0, 90),
        };
      });
      say("Committees (stated N must equal rows)", c);
      await page.screenshot({ path: join(OUT, `${PREFIX}-10-committees.png`) });
    }

    const offices = page.locator(".card-section-header", { hasText: "Offices near you" }).first();
    if ((await offices.count()) > 0) {
      await offices.click();
      await page.waitForTimeout(500);
      const o = await page.evaluate(() => {
        const section = [...document.querySelectorAll(".card-section")].find((x) =>
          /Offices near you/.test(x.querySelector(".card-section-title")?.textContent ?? ""),
        );
        return {
          meta: section?.querySelector(".card-section-meta")?.textContent ?? null,
          rows: section?.querySelectorAll("li").length ?? 0,
          text: (section?.querySelector("li")?.textContent ?? "").slice(0, 90),
        };
      });
      say("Offices near you (stated N must equal rows)", o);
      await page.screenshot({ path: join(OUT, `${PREFIX}-11-district-offices.png`) });
    }
  }
  await page.close();
}

await browser.close();
console.log("\ndone");
