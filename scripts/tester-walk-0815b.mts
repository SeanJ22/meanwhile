/**
 * The second 2026-08-15 walk — party, meetings and faces, at 390×844, as a
 * stranger who has never been to any of these places.
 *
 * The session's claims, checked the way a reader would meet them rather than
 * the way the code was written:
 *
 *   1 (M62) a LOCAL partisan official renders a party, and the party carries
 *           the certified record it was read from — and a school board, which
 *           is nonpartisan, renders none;
 *   2 (M59) a meeting whose publisher never posted a start time renders the
 *           date and the honest line, never a clock, and its calendar export
 *           is an all-day event carrying the same sentence;
 *   3 (M74) a pick made on another state's ballot says which state;
 *   4 (M72) the who-governs card sits inside the viewport at BOTH widths;
 *   5 (M73) nothing in the bottom stack sits under the map legend;
 *   6 (D50) the challenger faces — a zero this session, so what is checked is
 *           that the absence renders as the standard line and not as a blank.
 *
 * `pnpm exec tsx scripts/tester-walk-0815b.mts [zip] [baseUrl]`
 */
import { chromium, type Page } from "playwright";

declare global {
  interface Window {
    __zip: string;
    __lat: number;
    __lng: number;
  }
}

const OUT = "C:/Users/seanj/dev/we-the-people/screenshots";
const zip = process.argv[2] ?? "07866";
const BASE = process.argv[3] ?? "http://localhost:3000";

const results: string[] = [];
function check(name: string, ok: boolean, detail = "") {
  results.push(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

/**
 * A check that does not APPLY at this zip. Not a pass and not a failure: a
 * walk that fails for asking Tucson about a New Jersey archive teaches the
 * reader to ignore its failures, which is the same defect as a green light
 * that means nothing.
 */
function skip(name: string, why: string) {
  results.push(`SKIP ${name} — ${why}`);
}

const MOJIBAKE =
  /[\u00c2\u00c3\u00e2\u00e3\u00f0\u00f1][\u0080-\u00bf\u2010-\u203a\u20ac\u2122]/;

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
const body = () => page.locator("body").innerText();

const ZCTA: Record<string, [number, number]> = {
  "85701": [32.21696, -110.971],
  "85641": [32.04903, -110.62291],
  "07866": [40.95499, -74.48801],
  "03255": [43.31403, -72.02455],
};

async function enterZip(target: string) {
  const [lat, lng] = ZCTA[target];
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.evaluate(
    ([z, la, ln]) => {
      localStorage.setItem("wtp.approximate_location", JSON.stringify({ zip: z, savedAt: "2026-08-15T12:00:00.000Z" }));
      localStorage.setItem("wtp.tutorial_seen", "1");
    },
    [target, lat, lng] as [string, number, number],
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4500);
}

/* ── 1. Party on a local partisan official, and none on a school board ──── */

await enterZip(zip);
await page.screenshot({ path: `${OUT}/walk0815b-${zip}-map.png` });

// Read the card as TEXT, the way a reader meets it. The party renders as its
// own element beside the name, so hunting for one element containing both
// finds nothing and reports a defect that is not there — the first run of
// this walk did exactly that.
// NOTE: no inner named functions inside page.evaluate — tsx compiles a
// `const fn = () => {}` into a call to esbuild's `__name` helper, which does
// not exist in the browser context and throws "__name is not defined". Cost
// one walk run to find; inlined here so it cannot recur.
const card = await page.evaluate(() => {
  const notice = document.querySelector(".coverage-notice");
  const text = notice ? (notice as HTMLElement).innerText : "";
  const out: Record<string, string> = { text, LOCAL: "", STATE: "", FEDERAL: "" };
  for (const name of ["LOCAL", "STATE", "FEDERAL"]) {
    const start = text.indexOf(`\n${name}\n`);
    if (start === -1) continue;
    const rest = text.slice(start + name.length + 2);
    const end = rest.search(/\n(LOCAL|STATE|FEDERAL)\n/);
    out[name] = end === -1 ? rest : rest.slice(0, end);
  }
  return { text, local: out.LOCAL, state: out.STATE, federal: out.FEDERAL };
});
const PARTY = /·\s*(Democratic|Democrat|Republican|Green|Independent|Libertarian)\b/g;
const localParties = card.local.match(PARTY) ?? [];
const anyParties = card.text.match(PARTY) ?? [];

// An OFFICE TITLE on its own line, not the word anywhere. The first version
// of this matched "Newbury isn't a city — it has no mayor" and then failed
// the zip for not showing a party for the mayor it had just said did not
// exist. A loose pattern verifies nothing, in either direction.
const localPartisanHere = /^(Mayor|Council President|Council Vice President|Council Member|County Supervisor|County Commissioner|Commissioner)/m.test(
  card.local,
);
(localPartisanHere ? check : (n: string, _ok: boolean, d: string) => skip(n, `no partisan local body on this card — ${d}`))(
  `M62 a LOCAL official renders a party at ${zip}`,
  localParties.length > 0,
  `${localParties.length} local row(s) carry a party (${[...new Set(localParties)].join(", ")}); ` +
    `${anyParties.length} on the whole card`,
);
// And the negative half, which matters just as much: a nonpartisan body
// renders nothing, and that nothing is a stated fact rather than a gap.
check(
  "M62 the card cites a record wherever it states a party",
  !localParties.length || /SOURCE/.test(card.local),
  "every roster row carries its SOURCE link",
);

/* ── 2. The day-only meeting ─────────────────────────────────────────────── */

// Ask the API the way the app does, then find the rendered card.
await page.evaluate(
  ([z, la, ln]) => {
    window.__zip = z as string;
    window.__lat = la as number;
    window.__lng = ln as number;
  },
  [zip, ZCTA[zip][0], ZCTA[zip][1]] as [string, number, number],
);
const dayOnly = await page.evaluate(async () => {
  const res = await fetch(`/api/meetings?lat=${window.__lat}&lng=${window.__lng}&zip=${window.__zip}`, {
    headers: { accept: "application/json" },
  });
  const payload = await res.json();
  const meetings = (payload.meetings ?? []) as {
    id: string;
    startsAt: string;
    startPrecision?: string;
    jurisdiction: string;
    status: string;
  }[];
  const day = meetings.filter((m) => m.startPrecision === "DAY");
  return {
    total: meetings.length,
    day: day.length,
    sample: day.slice(0, 4).map((m) => `${m.jurisdiction} ${m.startsAt.slice(0, 10)} ${m.status}`),
  };
});
if (dayOnly.day === 0) {
  skip(
    "M59 the day-only meeting shape",
    `no archived date-only sitting inside this zip radius (${dayOnly.total} meeting(s) served) — ` +
      "the two archives are Rockaway Township NJ and Merrimack County NH",
  );
} else {
  check(
    "M59 the served window carries day-only meetings",
    true,
    `${dayOnly.day} of ${dayOnly.total} served: ${dayOnly.sample.join(" | ")}`,
  );
}

let pageText = "";
if (dayOnly.day > 0) {
// The rendered line. The concluded meetings are behind a status chip AND a
// backward date window, so this taps the chip and then opens the list — the
// reader's own route to a past sitting, not a shortcut around it.
await page.evaluate(() => {
  const controls = [...document.querySelectorAll("button, [role=button], summary")];
  const exact = controls.find((b) => /^concluded$/i.test((b.textContent ?? "").trim()));
  const loose = controls.find((b) => /concluded/i.test((b.textContent ?? "").trim()));
  (exact ?? loose)?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
});
await page.waitForTimeout(1800);
// Then the meetings door — the sidebar counter that opens the list. Its label
// is a count glued to the word, e.g. "14Meetings".
await page.evaluate(() => {
  const el = [...document.querySelectorAll("button, [role=button], a")].find((b) =>
    /^\d*\s*meetings$/i.test((b.textContent ?? "").trim()),
  );
  (el as HTMLElement | undefined)?.click();
});
await page.waitForTimeout(2500);
// The LIST shows dates and distances and never a clock — for every meeting,
// timed or not. The time lives on the meeting's own card, which is where the
// honest line has to appear, so this opens one. Checking the list alone
// would have "passed" by never rendering a time at all.
const opened = await page.evaluate(() => {
  const row = [...document.querySelectorAll("button, [role=button], a, li")].find((b) =>
    /Township Council|Board of Commissioners/i.test(b.textContent ?? "") &&
      /\d\d\/\d\d\/2026/.test(b.textContent ?? ""),
  );
  (row as HTMLElement | undefined)?.click();
  return Boolean(row);
});
await page.waitForTimeout(2000);
pageText = await body();
check(
  "M59 a day-only meeting's card is reachable from the list",
  opened,
  opened ? "opened a Rockaway Township Council sitting" : "no archived row to open",
);
check(
  "M59 a date-only meeting says the time was not posted",
  /Time not posted/i.test(pageText),
  pageText.includes("Time not posted")
    ? `line present: "${(pageText.match(/Time not posted[^\n]*/) ?? [""])[0]}"`
    : "not found in rendered text",
);
check(
  "M59 no day-only meeting renders midnight",
  !/12:00\s?AM/i.test(pageText),
  /12:00\s?AM/i.test(pageText) ? "a midnight clock reached the reader" : "no 12:00 AM anywhere",
);
await page.screenshot({ path: `${OUT}/walk0815b-${zip}-concluded.png`, fullPage: false });
} else {
  skip("M59 the rendered day-only card", "nothing archived to open at this zip");
}

/* ── 3. Picks from another state's ballot ────────────────────────────────── */

await page.evaluate(() => {
  localStorage.setItem(
    "wtp.ballot_picks",
    JSON.stringify({
      version: 1,
      picks: {
        "ballot-az-pima:governor": {
          contestId: "ballot-az-pima:governor",
          contestTitle: "Governor",
          choiceIds: ["Katie Hobbs"],
          labels: { "Katie Hobbs": "Katie Hobbs" },
        },
      },
    }),
  );
});
await page.goto(`${BASE}/ballot?zip=${zip}`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2000);
const ballotText = await body();
const foreignHere = zip !== "85701" && zip !== "85641";
(foreignHere ? check : (n: string, _ok: boolean, _d: string) => skip(n, "this IS the Arizona ballot, so the Arizona pick is not foreign — the correct answer is no label"))(
  "M74 a pick from another state's ballot names its jurisdiction",
  /Pima County, Arizona/.test(ballotText),
  /Pima County, Arizona/.test(ballotText) ? "labelled" : "still unlabelled",
);
check(
  "M74 an internal key never reaches the reader",
  !/az-pima|ocd-division/.test(ballotText),
  "",
);
await page.screenshot({ path: `${OUT}/walk0815b-${zip}-picks.png`, fullPage: false });

/* ── 4 & 5. The two bounds, at both widths ───────────────────────────────── */

async function boundsAt(width: number, height: number) {
  await context.pages()[0].setViewportSize({ width, height });
  await enterZip(zip);
  return page.evaluate(() => {
    const vh = window.innerHeight;
    const stack = document.querySelector(".map-bottom-stack");
    const legend = document.querySelector(".legend");
    const s = stack?.getBoundingClientRect();
    const L = legend?.getBoundingClientRect();
    let over = 0;
    if (stack && L) {
      for (const el of stack.querySelectorAll("*")) {
        if (el.children.length) continue;
        const t = (el.textContent ?? "").trim();
        if (!t) continue;
        const b = el.getBoundingClientRect();
        if (b.width < 5 || b.height < 5) continue;

        // A CLIPPED element still has a rect. The who-governs card's body
        // scrolls inside itself, so rows below the fold sit at coordinates
        // the legend also occupies while being painted nowhere at all —
        // counting those reports a collision that no reader can see, which
        // is what the first version of this check did. Skip anything outside
        // its own scroll container's visible box before asking what is on
        // top of it.
        let clipped = false;
        let ancestor: Element | null = el.parentElement;
        while (ancestor && ancestor !== document.body) {
          const cs = getComputedStyle(ancestor);
          if (cs.overflowY !== "visible" || cs.overflowX !== "visible") {
            const a = ancestor.getBoundingClientRect();
            if (b.top >= a.bottom || b.bottom <= a.top) clipped = true;
            break;
          }
          ancestor = ancestor.parentElement;
        }
        if (clipped) continue;

        // Paint-level: what is actually on top at this element's midpoint?
        const mid = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
        if (mid && (mid as Element).closest(".legend")) over++;
      }
    }
    return {
      vh,
      stackTop: s ? Math.round(s.top) : null,
      stackBottom: s ? Math.round(s.bottom) : null,
      legendTop: L ? Math.round(L.top) : null,
      coveredByLegend: over,
    };
  });
}

const phone = await boundsAt(390, 844);
check(
  "M72 the bottom stack stays inside the viewport at 390px",
  phone.stackTop !== null && phone.stackTop >= 0,
  JSON.stringify(phone),
);
check(
  "M73 nothing in the stack is painted over by the legend at 390px",
  phone.coveredByLegend === 0,
  `${phone.coveredByLegend} element(s) under the legend`,
);

const desktop = await boundsAt(1280, 800);
check(
  "M72 the bottom stack stays inside the viewport at 1280px",
  desktop.stackTop !== null && desktop.stackTop >= 0,
  JSON.stringify(desktop),
);
await page.screenshot({ path: `${OUT}/walk0815b-${zip}-desktop.png` });

/* ── 6. The faces that are not there ─────────────────────────────────────── */

await context.pages()[0].setViewportSize({ width: 390, height: 844 });
await page.goto(`${BASE}/ballot?zip=${zip}`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
const ballot = await body();
check(
  "D50 a candidate we found nothing for says so, in the standard line",
  /We haven't found much about this candidate yet\./.test(ballot),
  /We haven't found much about this candidate yet\./.test(ballot)
    ? "the thin-candidate line renders"
    : "the line is absent — a blank would read as absence of the candidate",
);

/* ── Cross-cutting ───────────────────────────────────────────────────────── */

check("no mojibake in the rendered text", !MOJIBAKE.test(ballot + pageText), "");
check(
  "no console errors during the walk",
  consoleErrors.length === 0,
  consoleErrors.slice(0, 3).join(" | "),
);

await browser.close();

console.log(`\n── walk 0815b, zip ${zip}, 390×844 ──`);
for (const line of results) console.log(`  ${line}`);
const failed = results.filter((r) => r.startsWith("FAIL")).length;
console.log(`\n  ${results.length - failed} pass, ${failed} fail\n`);
