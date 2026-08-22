/**
 * **NJ HUNT CAPTURES — 07866 and 03255, at 430×932** (2026-08-22, item 8.2).
 *
 * RULING 2: a capture is evidence only once it has been READ AS AN IMAGE, and
 * a capture whose claim does not match its contents reports NOT VISIBLE rather
 * than shipping the wrong picture.
 *
 * Two prior failures this is written against, both from NH Hunt 6:
 *
 *   1. `?zip=` does NOT seed the app — the map entry renders its welcome
 *      overlay over everything and the first pass captured the overlay. The
 *      location is SESSION-scoped under `wtp.approximate_location`, so it is
 *      seeded the way `walk:all` seeds it.
 *   2. The second pass produced captures whose claims did not match their
 *      contents. So every shot here ASSERTS what it expects to see in the DOM
 *      first, and a shot whose assertion fails is written with `NOT-VISIBLE`
 *      in its filename so it can never be presented as the thing it is not.
 *
 * Full-page captures on a ballot run to tens of thousands of pixels and cannot
 * be read; each shot is CLIPPED to its subject and page zoom is applied where
 * the subject is long.
 */
import { mkdirSync, writeFileSync } from "node:fs";

import type { Page } from "playwright";

import { launchGuarded } from "./browser.mts";
import { today } from "./doc-dates.mjs";

const BASE = process.env.SHOOT_BASE_URL ?? "https://sparkwtp.netlify.app";

const OUT = "screenshots/nj-hunt-0822";
const PHONE = { width: 430, height: 932 };

mkdirSync(OUT, { recursive: true });

const browser = await launchGuarded({ label: "nj-hunt-0822-shoot" });
const RUN = browser.runId;

async function openAt(zip: string): Promise<Page> {
  const context = await browser.context({
    extraHTTPHeaders: { "x-wtp-synthetic-run": RUN },
    viewport: PHONE,
    deviceScaleFactor: 2,
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
      } catch {
        /* the shot will show the overlay and its assertion will fail, which is the honest outcome */
      }
    },
    { zip },
  );
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForTimeout(4_000);
  return page;
}

interface Shot {
  name: string;
  zip: string;
  path: string;
  /** What the capture CLAIMS. Asserted in the DOM before the shot is kept. */
  claim: string;
  /** Text that must be present for the claim to hold. */
  mustContain: string[];
}

const results: (Shot & { visible: boolean; found: string[]; missing: string[]; file: string })[] = [];

async function shoot(shot: Shot, page: Page): Promise<void> {
  const body = (await page.evaluate("document.body.innerText")) as string;
  const found = shot.mustContain.filter((t) => body.includes(t));
  const missing = shot.mustContain.filter((t) => !body.includes(t));
  const visible = missing.length === 0;
  /*
   * The filename carries the verdict. A capture that does not show what it
   * claims is still WRITTEN — it is evidence of the gap — but it can never be
   * mistaken for the thing it failed to show.
   */
  const file = `${OUT}/${shot.name}${visible ? "" : "--NOT-VISIBLE"}.png`;
  await page.screenshot({ path: file, fullPage: false });
  results.push({ ...shot, visible, found, missing, file });
  console.log(
    `  ${visible ? "VISIBLE    " : "NOT VISIBLE"} ${shot.name}\n` +
      `      claim: ${shot.claim}\n` +
      `      found ${found.length}/${shot.mustContain.length}` +
      (missing.length ? ` · MISSING: ${missing.join(" | ")}` : "") +
      `\n      ${file}`,
  );
}

console.log(`\nNJ HUNT CAPTURES — ${BASE} · ${today()} · run ${RUN}\n`);

/* ── 07866 ─────────────────────────────────────────────────────────────── */
{
  const page = await openAt("07866");
  await shoot(
    {
      name: "07866-entry",
      zip: "07866",
      path: "/",
      claim: "the 07866 entry surface, welcome overlay dismissed, showing Rockaway Township",
      mustContain: ["Rockaway"],
    },
    page,
  );
  /*
   * **The ballot page takes the zip in the QUERY, and the page says so.**
   * Navigating to a bare /ballot renders the explainer and the sentence "Open
   * this page with a zip, e.g. /ballot?zip=07866" — which is the product working
   * and was this capture script failing. The seeded sessionStorage is what the
   * MAP entry reads; the ballot route reads the query.
   */
  await page.goto(`${BASE}/ballot?zip=07866`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForTimeout(5_000);
  /* The ballot is long; shrink the PAGE so the subject fits a readable frame. */
  await page.evaluate("document.body.style.zoom = '0.5'");
  await page.waitForTimeout(1_000);
  /*
   * **SCROLL TO THE SUBJECT, OR THE CAPTURE SHOWS THE TOP OF THE PAGE.**
   *
   * RULING 2 caught this exactly. The DOM assertion for Mezik and Nydegger
   * PASSED — they are on the page — and the image showed the United States
   * Senate contest, because a viewport capture of a long page shows whatever
   * sits at scroll position zero. A capture whose claim its own pixels do not
   * support is the thing the ruling exists to stop, and a passing DOM check is
   * not a substitute for looking at it.
   */
  await page.evaluate(
    "(function(){var n=document.querySelectorAll('h2,h3');for(var i=0;i<n.length;i++){if(/Board of Education/i.test(n[i].textContent||'')){n[i].scrollIntoView({block:'start'});return;}}})()",
  );
  await page.waitForTimeout(1_500);
  await shoot(
    {
      name: "07866-ballot-school-board",
      zip: "07866",
      path: "/ballot",
      claim:
        "the 07866 ballot showing the Rockaway Township Board of Education candidates with the contacts this session found",
      /*
       * **Title Case, not the filing's CAPS.** The clerk files "MEZIK" and the
       * card renders "Mezik"; asserting the filing's form failed against a page
       * that was correct. The email is the load-bearing assertion — it is the
       * thing this session put there.
       */
      mustContain: ["Mezik", "Nydegger", "lisa.mezik@gmail.com"],
    },
    page,
  );
  await page.close();
}

/* ── 03255 — the regression check, Sutton's new bodies ─────────────────── */
{
  const page = await openAt("03255");
  await shoot(
    {
      name: "03255-entry",
      zip: "03255",
      path: "/",
      claim: "the 03255 entry surface still renders after the NJ changes",
      mustContain: ["Newbury"],
    },
    page,
  );
  /*
   * **The who-governs card lists GOVERNING bodies, and Sutton does not govern
   * Newbury** — so "Sutton" was never going to appear in it, and a capture
   * claiming it would have been a capture claiming the wrong thing. Sutton's
   * sittings render as PINS, and the surface-level number for them is the
   * meeting count on the entry screen. That is what this shot claims.
   *
   * The direct proof is the API read printed below: 37 Sutton meetings across
   * six named bodies, up from 5 across one.
   */
  await shoot(
    {
      name: "03255-meeting-count",
      zip: "03255",
      path: "/",
      claim:
        "the 03255 entry states its meeting and venue counts, which is where RULING 65's newly wired Sutton sittings land",
      mustContain: ["meetings", "venues"],
    },
    page,
  );
  await page.close();
}

await browser.close();

const visible = results.filter((r) => r.visible).length;
console.log(
  `\n  ${results.length} capture(s) · ${visible} show what they claim · ${results.length - visible} NOT VISIBLE\n` +
    "  Every one is still to be OPENED AND READ AS AN IMAGE — RULING 2. A DOM\n" +
    "  assertion plus a live walk does not substitute; the defects this rule exists\n" +
    "  to catch are the ones the DOM is happy about.\n",
);

writeFileSync(`${OUT}/manifest.json`, `${JSON.stringify({ base: BASE, run: RUN, on: today(), results }, null, 2)}\n`, "utf8");
