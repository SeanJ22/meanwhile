/**
 * `pnpm walk:all` — the regression net.
 *
 *   pnpm walk:all                              # against production
 *   SHOOT_BASE_URL=http://localhost:3000 pnpm walk:all
 *
 * ## Why this exists
 *
 * Every session before this one wrote its own walk, and every walk checked
 * only the surfaces that session had touched. So a win shipped in one session
 * and broken in the next died silently: nothing owned it. Kearsarge's fifteen
 * sittings, verified in the truth session, were gone before anyone looked;
 * `/about-area` had been 500ing at every zip; the reader's own picks had
 * vanished off the ballot page. Three real regressions, none of them caught,
 * because no walk was responsible for a claim once its session ended.
 *
 * This is that owner. Every check below is a claim some prior session
 * SHIPPED, re-expressed as an assertion a machine can make against
 * production, and tagged with the session that shipped it. A failure here is
 * not "a check failed" — it is a **named regression**, and the summary prints
 * it as one, with the session that is being undone.
 *
 * ## The standing rule (CLAUDE.md)
 *
 * Every session ends by running this against production. A prior win that
 * fails is a regression named in the standing report. New walks APPEND — the
 * suite only grows, and a check is removed only when the author retires the
 * claim behind it.
 *
 * ## What is deliberately NOT here, and why
 *
 * The prior walks that TAP A REACTION or FIRE A LOG EVENT are excluded whole:
 * `tester-walk-0814b`, `-0814d` and the reaction half of `-0815`. Those write
 * real rows to the production store, and a suite that runs every session
 * would manufacture reader signal on every run — the exact thing
 * `CLAUDE.md`'s probe-naming rule exists to keep visible. Their read-only
 * halves (the disclosure gate's WORDING, the honest-refusal line, the
 * controls being reachable) are carried here; their write halves stay in
 * those scripts, run by hand when the write path itself is what changed.
 * `EXCLUDED` at the bottom prints that list every run, so the gap is stated
 * rather than implied.
 *
 * The screenshot passes (`pnpm pairs`, `pnpm shoot`) are also not here. They
 * are a different instrument: this one is behavioural, and a human rules on
 * pixels.
 *
 * ## Probe rows
 *
 * A GET to `/api/meetings` writes a SEARCH row to the production search log
 * (`app/api/meetings/route.ts` calls `logSearchEvent`) — so the map settling
 * on a zip writes one, and so does every direct probe here. This walk COUNTS
 * them and prints the total, because the standing order says every row a
 * session creates against production is named in its report. No reaction is
 * ever tapped and no ask is ever submitted.
 */
import { chromium, type Browser, type Page } from "playwright";

import { mojibakePattern } from "../lib/text/mojibake.ts";
import { decodePng, patchStats, regionChange } from "./png.mts";

const BASE = (process.env.SHOOT_BASE_URL ?? "https://sparkwtp.netlify.app").replace(
  /\/$/,
  "",
);

/** The four zips that are the product (state.md §9), plus the refusal zip. */
const ZIPS = {
  tucson: { zip: "85701", lat: 32.21696, lng: -110.971 },
  vail: { zip: "85641", lat: 32.04903, lng: -110.62291 },
  rockaway: { zip: "07866", lat: 40.95499, lng: -74.48801 },
  newbury: { zip: "03255", lat: 43.31403, lng: -72.02455 },
} as const;
const FOUR = [ZIPS.tucson, ZIPS.vail, ZIPS.rockaway, ZIPS.newbury];

const PHONE = { width: 390, height: 844 };

// ── The ledger ─────────────────────────────────────────────────────────────

interface Failure {
  session: string;
  name: string;
  evidence: string;
}

const failures: Failure[] = [];
let passed = 0;

/**
 * One assertion, owned by the session that shipped the claim.
 *
 * `session` is not decoration: a failure prints as "the win <session> shipped
 * is undone", which is the sentence the standing report needs and the one a
 * bare check name cannot produce.
 */
function check(session: string, name: string, ok: boolean, evidence = ""): boolean {
  if (ok) passed += 1;
  else failures.push({ session, name, evidence });
  console.log(
    `  ${ok ? "ok  " : "FAIL"} [${session}] ${name}${evidence ? ` — ${evidence}` : ""}`,
  );
  return ok;
}

/**
 * A check that could not RUN is not a check that failed.
 *
 * `walk-0815g` learned this the hard way: an unreachable meetings service
 * reported through `check` looks identical to "the Zoning Board is missing
 * from production", which is a different and much more alarming claim. A
 * blocked check throws with what blocked it; the suite records it separately.
 */
const blocked: string[] = [];
function cannotRun(session: string, name: string, why: string): void {
  blocked.push(`[${session}] ${name} — ${why}`);
  console.log(`  ??  [${session}] ${name} — COULD NOT RUN: ${why}`);
}

function section(title: string): void {
  console.log(`\n${title}`);
}

// ── Probe accounting ───────────────────────────────────────────────────────

let searchLogRows = 0;
let askRows = 0;

function countProbe(url: string): void {
  if (url.includes("/api/meetings")) searchLogRows += 1;
  if (url.includes("/api/ask") || url.includes("/api/log")) askRows += 1;
}

// ── HTTP helpers (no browser — fast, and most claims are server-rendered) ──

interface Fetched {
  status: number;
  text: string;
}

async function get(path: string): Promise<Fetched> {
  const url = `${BASE}${path}`;
  countProbe(url);
  const response = await fetch(url, {
    headers: { "User-Agent": "we-the-people walk:all (regression net)" },
  });
  return { status: response.status, text: await response.text() };
}

async function getJson<T>(path: string): Promise<T | null> {
  const url = `${BASE}${path}`;
  countProbe(url);
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) return null;
  return (await response.json()) as T;
}

// ── Browser helpers ────────────────────────────────────────────────────────

/**
 * A page with the zip already resolved, the way a mid-session reader has it.
 *
 * The location is SESSION-scoped (6f, 2026-08-15) and lives in
 * `sessionStorage` under `wtp.approximate_location`, so seeding it is how a
 * walk skips eleven seconds of typing without pretending to be a state the
 * app does not have. The tutorial flag is seeded too: the first-run tour is
 * its own check, not a thing every other check has to dismiss.
 */
async function openAt(browser: Browser, zip: string): Promise<Page> {
  const context = await browser.newContext({
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
        localStorage.setItem("wtp.recent_zips", JSON.stringify([zip, "03255"]));
      } catch {
        // Defaults are fine — the walk just types the zip instead.
      }
    },
    { zip },
  );
  const page = await context.newPage();
  page.on("response", (r) => countProbe(r.url()));
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForTimeout(9000);
  return page;
}

/**
 * A DESKTOP context, for the checks whose subject only exists at that width.
 *
 * The suite runs at phone size by default and that is right for most of it —
 * the tester's own passes were on a phone. But g4 item 14 is a claim about
 * the desktop RAIL, and item 5 is a claim about dragging the middle of a map
 * that a phone's overlays cover. Running those at 390px reported "could not
 * run" four times over, which is honest and useless: the check has to be able
 * to reach its subject before its result means anything.
 */
async function openWideAt(browser: Browser, zip: string): Promise<Page> {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
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
        // Defaults are fine — the walk just types the zip instead.
      }
    },
    { zip },
  );
  const page = await context.newPage();
  page.on("response", (r) => countProbe(r.url()));
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForTimeout(9000);
  return page;
}

async function bodyText(page: Page): Promise<string> {
  return page.locator("body").innerText();
}

const browser = await chromium.launch();

console.log(`walk:all — ${BASE}\n${new Array(60).fill("─").join("")}`);

// ═══════════════════════════════════════════════════════════════════════════
// A. The doors that must open at all — server-rendered, HTTP only.
// ═══════════════════════════════════════════════════════════════════════════

section("A. Top-level doors (0817, 0818, g3)");

for (const { zip } of FOUR) {
  const area = await get(`/about-area?zip=${zip}`);
  check(
    "0817",
    `/about-area answers at ${zip}`,
    area.status === 200,
    `HTTP ${area.status}`,
  );
  if (area.status === 200) {
    check(
      "0817",
      `/about-area renders its facts at ${zip}`,
      /basics of living here/.test(area.text) && /marijuana/i.test(area.text),
      area.text.includes("haven&#x27;t written this up")
        ? "rendered the no-coverage gap instead of the facts"
        : "",
    );
    check(
      "0817",
      `/about-area cites every answer at ${zip}`,
      /Department|Secretary|Division|Commission/.test(area.text),
    );
  }

  const ballot = await get(`/ballot?zip=${zip}`);
  check("0817", `/ballot answers at ${zip}`, ballot.status === 200, `HTTP ${ballot.status}`);
  if (ballot.status === 200) {
    check("0817", `/ballot renders contests at ${zip}`, /vote for/i.test(ballot.text));
    check(
      "0817",
      `/ballot carries the office explainer at ${zip}`,
      /Powers defined in/.test(ballot.text),
    );
    check(
      "0814c",
      `/ballot carries the device-only sentence at ${zip}`,
      /saved on this device only/i.test(ballot.text),
    );
    check(
      "0817",
      `/ballot links "Moving here?" at ${zip}`,
      /Moving here\?/.test(ballot.text),
    );
    // g3 item 7 superseded 3d's shared label. The two asks on this page are
    // differently consequential — one is a private note, one joins an
    // anonymous aggregate that is sold — and they must not read alike.
    check(
      "g3",
      `/ballot names the pick as a ballot-building action at ${zip}`,
      /Your pick for this race/.test(ballot.text),
    );
    check(
      "g3",
      `/ballot's picks disclosure quotes wording that is on the page at ${zip}`,
      !/&ldquo;What do you think\?&rdquo; picks/.test(ballot.text),
    );
  }
}

const transparency = await get("/transparency");
check("0815e", "/transparency answers", transparency.status === 200, `HTTP ${transparency.status}`);
check(
  "0815e",
  "/transparency states the photo rule's FOUR doors",
  /four doors|door 4|last resort/i.test(transparency.text),
);
check(
  "0815e",
  "/transparency discloses the classifier and keeps the no-generation guarantee",
  /classif/i.test(transparency.text),
);

// ═══════════════════════════════════════════════════════════════════════════
// B. The data the reader's answers are made of — API level.
// ═══════════════════════════════════════════════════════════════════════════

section("B. The data behind the answers (0815c, 0815g, f, 0816)");

interface MeetingsPayload {
  meetings: Array<{
    id: string;
    bodyName: string;
    ocdId: string | null;
    status: string;
    location: { name: string };
  }>;
  tier: string;
  coverage: { bodies: Array<{ name: string | null; ocdId: string | null }> } | null;
  snapshot: { generatedAt: string; failed: Array<{ source: string }> } | null;
}

/**
 * The meeting counts that prior sessions SHIPPED, per zip.
 *
 * These are floors, not equalities: a real refresh adds sittings and a passing
 * calendar year removes them, so an equality would fail for a reason that is
 * the product working. A floor catches the thing that actually happens — a
 * source going dark and a previously-full calendar emptying.
 */
const MEETING_FLOORS: Array<{
  session: string;
  zip: string;
  lat: number;
  lng: number;
  total: number;
  bodies: number;
  named: Array<{ session: string; match: RegExp; least: number; label: string }>;
}> = [
  {
    session: "0815c",
    ...ZIPS.newbury,
    total: 26,
    bodies: 4,
    named: [
      {
        session: "f",
        match: /kearsarge/i,
        least: 15,
        label: "Kearsarge Regional School District's sittings",
      },
      {
        session: "0815f",
        match: /zoning-board/i,
        least: 1,
        label: "Newbury's Zoning Board of Adjustment",
      },
    ],
  },
  {
    session: "0815c",
    ...ZIPS.rockaway,
    total: 20,
    bodies: 3,
    named: [
      {
        session: "0815c",
        match: /morris-hills|mhrd/i,
        least: 1,
        label: "Morris Hills Regional's board",
      },
    ],
  },
  { session: "0818", ...ZIPS.tucson, total: 30, bodies: 4, named: [] },
  { session: "0818", ...ZIPS.vail, total: 3, bodies: 1, named: [] },
];

for (const floor of MEETING_FLOORS) {
  const payload = await getJson<MeetingsPayload>(
    `/api/meetings?lat=${floor.lat}&lng=${floor.lng}&zip=${floor.zip}`,
  );
  if (!payload) {
    cannotRun("0815c", `meetings at ${floor.zip}`, "/api/meetings did not answer");
    continue;
  }
  const bodies = new Set(payload.meetings.map((m) => m.bodyName));
  check(
    floor.session,
    `${floor.zip}: the meeting count holds`,
    payload.meetings.length >= floor.total,
    `${payload.meetings.length} meetings, floor ${floor.total} — bodies: ${[...bodies].join(", ") || "none"}`,
  );
  check(
    floor.session,
    `${floor.zip}: the number of bodies with sittings holds`,
    bodies.size >= floor.bodies,
    `${bodies.size} of ${floor.bodies}`,
  );
  for (const named of floor.named) {
    const hits = payload.meetings.filter((m) => named.match.test(m.id));
    check(
      named.session,
      `${floor.zip}: ${named.label}`,
      hits.length >= named.least,
      `${hits.length} row(s) of ${payload.meetings.length}, floor ${named.least}`,
    );
  }

  // The refresh corollary (g3): a source failing must never EMPTY a surface
  // that was full. A failed source is allowed — it is reported honestly — but
  // the bodies it serves must still be carrying their last known sittings.
  const failed = payload.snapshot?.failed ?? [];
  if (failed.length > 0) {
    console.log(
      `      (snapshot reports ${failed.length} failed source(s): ${failed
        .map((f) => f.source)
        .join(", ")} — the counts above are what the reader actually gets)`,
    );
  }
}

interface VotesPayload {
  keyVotes?: unknown[];
  votes?: unknown[];
}
// `member` is REQUIRED — the route answers 400 without it. The first version
// of this check called `/api/votes` bare, read the error body's absent
// `keyVotes`, and reported the key-votes surface as gone. That is a walk
// missing its aim, not a regression, and it is exactly the confusion
// `cannotRun` exists to prevent; the fix is the parameter, not a softer floor.
const votes = await getJson<VotesPayload>("/api/votes?member=congress:K000377");
if (!votes) {
  cannotRun("0816", "the key-votes surface", "/api/votes did not answer for a known member");
} else {
  check(
    "0816",
    "the key-votes surface still has its votes",
    Array.isArray(votes.keyVotes) && votes.keyVotes.length >= 36,
    `${votes.keyVotes?.length ?? "no"} keyVotes`,
  );
  check(
    "0815c",
    "a senator's roll-call record still resolves",
    Array.isArray(votes.votes) && votes.votes.length >= 20,
    `${votes.votes?.length ?? "no"} votes`,
  );
}

// D40 — three officials must render three DIFFERENT campaigns' books. The
// production bug was one campaign's filings served for all three, and the
// cache key was the cause; distinct keys must still produce distinct results.
interface FundingPayload {
  kind?: string;
  data?: { fecCandidateId?: string; name?: string; totals?: { receipts?: number } };
}
// The target is the app-side id — `congress:<bioguide>` for a federal member
// (`FundingCandidate.targetKeys`). Three real, different people; the D40 bug
// served ONE campaign's books for all three, so the assertion is that the
// three answers name three different FEC candidate ids.
const FUNDING_TARGETS = [
  "congress:K000377", // Mark Kelly
  "congress:G000574", // Ruben Gallego
  "congress:G000606", // Adelita Grijalva
];
const books: Array<{ target: string; id: string; name: string }> = [];
for (const target of FUNDING_TARGETS) {
  const payload = await getJson<FundingPayload>(
    `/api/funding/${encodeURIComponent(target)}`,
  );
  if (!payload) {
    cannotRun("0819", `funding for ${target}`, "/api/funding did not answer");
    continue;
  }
  books.push({
    target,
    id: payload.data?.fecCandidateId ?? "none",
    name: payload.data?.name ?? "none",
  });
}
if (books.length >= 2) {
  const ids = new Set(books.map((b) => b.id));
  check(
    "0819",
    "D40: distinct officials render distinct campaign books",
    ids.size === books.length && !ids.has("none"),
    books.map((b) => `${b.target}→${b.id} (${b.name})`).join(" · "),
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// C. The map surfaces — a real browser, phone width, as a stranger.
// ═══════════════════════════════════════════════════════════════════════════

section("C. The map, who-governs, and the footnotes (0814c, 0815, e, g3)");

for (const { zip } of FOUR) {
  const page = await openAt(browser, zip);
  const text = await bodyText(page);

  check("0814c", `${zip}: the map answers with something about this place`, text.length > 200);

  // M60 — the mojibake sweep. It has recurred often enough to be permanent.
  //
  // The pattern comes from `lib/text/mojibake.ts` rather than being written
  // here. Two reasons, and the second is the one that matters: it is the
  // detector the repo already tests against real production sequences, and a
  // hand-rolled copy would have to spell the byte sequences out — which trips
  // `tests/mojibake.test.ts`, whose whole job is to find those bytes in
  // committed text. The first draft of this walk did exactly that and failed
  // the suite for detecting itself.
  const mojibake = text.match(mojibakePattern()) ?? [];
  check("0815", `${zip}: no mojibake in the rendered text`, mojibake.length === 0, mojibake.slice(0, 4).join(" "));

  // M48/2c — the three tiers, and FEDERAL is the label.
  check(
    "0814c",
    `${zip}: who-governs is grouped Local / State / Federal`,
    /Local/.test(text) && /State/.test(text) && /Federal/.test(text),
  );
  check("0814c", `${zip}: "Federal" is the label, never "National"`, !/\bNational\b/.test(text));

  // B11 — the governor is a first-class attachment on who-governs.
  check("0814c", `${zip}: the state's governor is on who-governs`, /Governor/.test(text));

  // M57 — the sidebar counters, and DISTRICTS never spends the dash on a switch.
  check("0815", `${zip}: no counter renders the couldn't-check dash`, !/\bOFFICIALS\s*—\b/.test(text));

  // g3 item 4 (M94) — each distinct footnote once per body, identical
  // footnotes across bodies collapsed to once per panel with the bodies named.
  const notices = await page.evaluate(() => {
    const out: string[] = [];
    for (const p of document.querySelectorAll(".coverage-notice p")) {
      const t = (p.textContent ?? "").replace(/\s+/g, " ").trim();
      if (t) out.push(t);
    }
    return out;
  });
  const normalized = notices.map((n) =>
    n.replace(/^[^—]*—\s*/, "").replace(/\s+/g, " ").trim(),
  );
  const repeated = normalized.filter(
    (n, i) => n.length > 30 && normalized.indexOf(n) !== i,
  );
  check(
    "g3",
    `${zip}: no footnote repeats in the who-governs panel`,
    repeated.length === 0,
    repeated.length ? `${repeated.length} repeat(s): "${repeated[0].slice(0, 64)}…"` : "",
  );

  // A09/A10 — the ask box is on the card, and its beat never claims thought.
  check("0819", `${zip}: the ask box is on the who-governs card`, /ask/i.test(text));
  check(
    "0814b",
    `${zip}: no deliberation label anywhere on the map`,
    !/\b(Thinking|Pondering|Analyzing|Reasoning)\b/.test(text),
  );

  // M53 — one state's facts never bleed into another's.
  //
  // Scoped to the CARD, not the document. The welcome overlay's shortcut
  // buttons name every covered place ("Tucson, AZ") and stay in the DOM after
  // the zip resolves, so a document-wide regex reports Arizona contamination
  // on a clean New Hampshire card. The claim M53 shipped is about the answer,
  // and the answer is the card.
  if (zip === "03255") {
    const cardText = await page
      .locator(".coverage-notice")
      .innerText()
      .catch(() => "");
    check(
      "0814e",
      "03255: zero Arizona references on the New Hampshire card",
      cardText.length > 0 && !/Arizona|Tucson|Pima/i.test(cardText),
      cardText.length === 0
        ? "the who-governs card did not render"
        : (cardText.match(/Arizona|Tucson|Pima/i) ?? []).join(" "),
    );
    check("0814c", "03255: Kearsarge Regional is named on who-governs", /Kearsarge/.test(text));
    check(
      "0818",
      "03255: Newbury's no-mayor fact renders",
      /isn.t a city — it has no mayor|no mayor/.test(text),
    );
  }
  if (zip === "07866") {
    check("0818", "07866: the mayor line renders", /Mayor/.test(text));
    check("0819", "07866: no shouting surnames", !/\bROACH\b/.test(text));
  }

  /*
   * g3 item 6 — more viewport must never mean fewer pins.
   *
   * The zoom-out goes through `__wtpZoomOut`, which issues the camera move
   * WITH an `originalEvent` so it takes the same settle path a reader's
   * gesture does. Playwright's own `mouse.wheel` was tried first and does not
   * work here: at 390 wide the who-governs card covers the middle of the
   * viewport, the wheel lands on the card, and the map never moves.
   *
   * **The zoom is asserted before the pin counts are.** The first version of
   * this check printed a cheerful "11 → 11 → 11" while the map had not moved
   * an inch — a green check for an experiment that never ran, which is worse
   * than a red one, and the same shape as the empty-success failures this
   * repo keeps finding. A flat count only means something once the camera is
   * known to have changed.
   */
  const zooms: number[] = [];
  const counts: number[] = [];
  for (let step = 0; step < 3; step++) {
    const state = await page.evaluate(() => {
      const w = window as unknown as {
        __wtpPinCount?: () => number;
        __wtpZoom?: () => number;
      };
      return {
        pins: typeof w.__wtpPinCount === "function" ? w.__wtpPinCount() : -1,
        zoom: typeof w.__wtpZoom === "function" ? w.__wtpZoom() : Number.NaN,
      };
    });
    counts.push(state.pins);
    zooms.push(state.zoom);
    if (step < 2) {
      await page.evaluate(() =>
        (window as unknown as { __wtpZoomOut?: (by?: number) => void }).__wtpZoomOut?.(2),
      );
      await page.waitForTimeout(4000);
    }
  }

  /*
   * g3 item 10 (M91) — the state rises out of the map, at every zoom.
   *
   * Measured at the LAST zoom step, which is the far end of the author's own
   * test: "zooming ALL THE WAY OUT, Arizona still reads raised and everything
   * else still reads muted and slightly blurred." A check that only looked at
   * neighbourhood scale would pass on a treatment that vanishes when the
   * state's border comes into view, which is the case that matters.
   */
  const focus = await page.evaluate(() => {
    const scrim = document.querySelector(".state-focus-scrim");
    const clip = document.querySelector(".state-focus-art clipPath path");
    return {
      scrim: Boolean(scrim),
      filter: scrim ? getComputedStyle(scrim).backdropFilter : "none",
      // The clip has to hold the map rect AND the state's rings; a rect
      // alone would mute everything, state included.
      subpaths: (clip?.getAttribute("d") ?? "").split("M").length - 1,
    };
  });
  check(
    "g3",
    `${zip}: the state focus holds when zoomed out`,
    focus.scrim &&
      /blur\(/.test(focus.filter) &&
      /saturate\(/.test(focus.filter) &&
      focus.subpaths >= 2,
    `scrim ${focus.scrim ? "present" : "MISSING"}, filter "${focus.filter}", ${focus.subpaths} clip subpath(s)`,
  );

  const zoomed =
    zooms.every((z) => Number.isFinite(z)) && zooms[2] < zooms[0] - 1;
  if (!zoomed) {
    cannotRun(
      "g3",
      `${zip}: pin monotonicity`,
      `the map did not zoom out (zooms ${zooms.join(" → ")}) — the check never ran`,
    );
  } else if (counts.some((c) => c < 0)) {
    cannotRun("g3", `${zip}: pin monotonicity`, "the map exposes no pin-count probe");
  } else {
    check(
      "g3",
      `${zip}: zooming out never removes pins`,
      counts[1] >= counts[0] && counts[2] >= counts[1],
      `pins ${counts.join(" → ")} across zooms ${zooms.map((z) => z.toFixed(1)).join(" → ")}`,
    );
  }

  await page.context().close();
}

// ═══════════════════════════════════════════════════════════════════════════
// D. The ballot page — picks, names, the scale.
// ═══════════════════════════════════════════════════════════════════════════

section("D. The ballot page (0814c, D53, g3)");

{
  const context = await browser.newContext({ viewport: PHONE, reducedMotion: "reduce" });
  const page = await context.newPage();
  page.on("response", (r) => countProbe(r.url()));
  await page.goto(`${BASE}/ballot?zip=85701`, {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });
  await page.waitForTimeout(3500);

  // M49/M50 — a pick renders the reader's running ballot.
  //
  // The selector is the pick BOX's own choices (`data-kind="pick"`), which is
  // what distinguishes the ballot-builder from the reaction sensor sharing
  // the same `.reaction-box` styling. An earlier draft looked for a
  // `[data-pick-choice]` attribute this walk had invented and the product
  // never had, and reported the round trip as un-runnable at every zip.
  const pickButtons = page.locator(
    '.reaction-box[data-kind="pick"] .reaction-choice',
  );
  const pickCount = await pickButtons.count();
  if (pickCount === 0) {
    cannotRun(
      "0814c",
      "85701: your-picks round trip",
      "no pick control on the page",
    );
  } else {
    await pickButtons.first().click();
    await page.waitForTimeout(900);
    const after = await bodyText(page);
    check(
      "0814c",
      "85701: a pick raises the reader's running ballot",
      /my picks/i.test(after),
      /my picks/i.test(after) ? "" : "no My picks surface after a pick",
    );
    await pickButtons.first().click();
    await page.waitForTimeout(400);
  }

  // g3 item 7 — candidate names on the ballot open their large battlecards.
  const nameLinks = await page.locator("[data-candidate-card]").count();
  check(
    "g3",
    "85701: candidate names open their large battlecards",
    nameLinks > 0,
    `${nameLinks} name link(s)`,
  );

  // g3 item 7 — the five-point scale reads as three groups, not one centre.
  const separators = await page.locator(".scale-sep").count();
  check(
    "g3",
    "85701: the five-point scale carries its group separators",
    separators > 0,
    `${separators} separator(s)`,
  );

  await context.close();
}

// ═══════════════════════════════════════════════════════════════════════════
// E. The sources vocabulary and the officials' facts.
// ═══════════════════════════════════════════════════════════════════════════

section("E. Sources and officials (g3 items 5, 8, 9)");

{
  const page = await openAt(browser, "85701");

  // g3 item 5 — a read from the body's own official source IS verified.
  const opened = await page
    .locator('.coverage-notice button:has-text("Kelly")')
    .first()
    .click()
    .then(() => true)
    .catch(() => false);
  if (!opened) {
    cannotRun("g3", "the sources tab's vocabulary", "no official row on the who-governs card");
  } else {
    await page.waitForTimeout(900);
    const more = page.locator('.popup-card button:has-text("More")');
    if (await more.count()) {
      await more.first().click();
      await page.waitForTimeout(1200);
    }
    const card = await page.locator(".account-modal-body, .popup-card").first().innerText();
    check(
      "g3",
      "an official-source read never says 'Verified: not yet'",
      !/Verified:\s*not yet/i.test(card),
      (card.match(/Verified:[^\n]*/) ?? [""])[0],
    );
    // g3 item 9 — the contact pills are the contact surface; no duplicate
    // accordion carrying the same facts.
    check(
      "g3",
      "the large card carries no duplicate 'How to reach them' accordion",
      !/How to reach them/i.test(card),
    );
  }

  await page.context().close();
}

// ═══════════════════════════════════════════════════════════════════════════
// F. The map answers to the reader, and the panels stop shouting (g4).
// ═══════════════════════════════════════════════════════════════════════════

section("F. The reader's map and the folded panels (g4 items 1-5, 9, 11, 14, 15)");

{
  /*
   * The zip hop, both directions (g4 item 1).
   *
   * The mask used to be bound to the last activation that SUCCEEDED rather
   * than to where the reader is, so changing an NH zip to an AZ zip flew to
   * Arizona and left New Hampshire raised. Every hop asserts the newly active
   * state is the one the map says is focused; a hop that ends on the previous
   * state is the defect returning.
   */
  const hops: Array<[string, string]> = [
    ["03255", "ocd-division/country:us/state:nh"],
    ["85701", "ocd-division/country:us/state:az"],
    ["07866", "ocd-division/country:us/state:nj"],
    ["03255", "ocd-division/country:us/state:nh"],
  ];

  for (const [zip, expected] of hops) {
    /*
     * A FRESH CONTEXT per hop.
     *
     * The first version wrote `sessionStorage` and reloaded — but `openAt`
     * installs an init script that rewrites the location on EVERY navigation,
     * so the reload put 03255 straight back and the walk reported New
     * Hampshire raised while sitting at 85701. It was measuring its own
     * fixture, and on a build where the defect was fixed it would have
     * reported the defect anyway.
     */
    const page = await openAt(browser, zip);

    const probe = (await page.evaluate(
      () =>
        (
          window as unknown as { __wtpMapProbe?: () => Record<string, unknown> }
        ).__wtpMapProbe?.() ?? null,
    )) as {
      focusOcdId: string | null;
      districtLayers: string[];
      districtFilterStates: (string | null)[];
      customSources: string[];
    } | null;

    if (!probe) {
      cannotRun("g4", `${zip}: the map probe`, "no __wtpMapProbe on the page");
      await page.context().close();
      continue;
    }

    check(
      "g4",
      `${zip}: the raised state is the state the reader is in`,
      probe.focusOcdId === expected,
      `focus ${probe.focusOcdId ?? "none"}, wanted ${expected}`,
    );

    // g4 item 3 — no other state's boundaries, ever.
    const want = expected.slice(-2).toUpperCase();
    const foreign = probe.districtFilterStates.filter(
      (abbr) => abbr !== null && abbr !== want,
    );
    check(
      "g4",
      `${zip}: only the active state draws district boundaries`,
      foreign.length === 0,
      `${probe.districtLayers.length} layer(s); foreign filters ${JSON.stringify(foreign)}`,
    );

    /*
     * RETIRED, not regressed: g4 item 4's "the current zip is shaded".
     *
     * The author removed zip shading from the product in g5 — the zip chooses
     * the active state and centres the camera, and draws nothing. The claim
     * behind the check is gone, so the check goes with it, which is the only
     * ground on which this suite ever loses a check. Its replacement asserts
     * the opposite and is the g5 line below.
     */
    check(
      "g5",
      `${zip}: the zip draws nothing on the map`,
      !probe.customSources.some((id) => id.includes("zip-shade")),
      `custom sources ${JSON.stringify(probe.customSources)}`,
    );

    await page.context().close();
  }
}

{
  /*
   * g4 item 5 — the map stops dragging the reader back.
   *
   * The author's report was that free panning glides back to the STARTING
   * POINT, which is a reframe rather than inertia: the 2.8 s auto-frame flew
   * the camera to a box built around the zip's own centroid. Pan by hand,
   * wait past the timer, and the camera must not have moved.
   */
  const page = await openWideAt(browser, "85701");
  const centreNow = async () =>
    (await page.evaluate(
      () =>
        (
          window as unknown as {
            __wtpMapProbe?: () => { centre: { lat: number; lng: number } };
          }
        ).__wtpMapProbe?.().centre ?? null,
    )) as { lat: number; lng: number } | null;

  const before = await centreNow();
  const box = await page.locator(".maplibregl-canvas").first().boundingBox();

  if (!before || !box) {
    cannotRun(
      "g4",
      "the pan-and-wait check",
      before ? "no map canvas to drag" : "no __wtpMapProbe on the page",
    );
  } else {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      box.x + box.width / 2 - 160,
      box.y + box.height / 2 - 90,
      { steps: 12 },
    );
    await page.mouse.up();
    await page.waitForTimeout(1200);

    const panned = await centreNow();
    // The experiment has to have RUN before its result means anything — g3's
    // lesson about a green check for a gesture that landed on an overlay and
    // never moved the map at all.
    const moved =
      panned !== null &&
      (Math.abs(panned.lat - before.lat) > 1e-4 ||
        Math.abs(panned.lng - before.lng) > 1e-4);

    if (!moved || !panned) {
      cannotRun("g4", "the pan-and-wait check", "the drag did not move the camera");
    } else {
      // Past the 2800 ms auto-frame timer and its 1400 ms flight.
      await page.waitForTimeout(5000);
      const after = await centreNow();
      const drift = after
        ? Math.abs(after.lat - panned.lat) + Math.abs(after.lng - panned.lng)
        : 99;
      check(
        "g4",
        "85701: the camera stays where the reader put it",
        drift < 1e-3,
        `drift ${drift.toFixed(5)} degrees after four seconds`,
      );
    }
  }

  await page.context().close();
}

{
  const page = await openWideAt(browser, "85701");

  // g4 item 14 — Filters opens COLLAPSED, and holds radius and districts.
  const filtersOpen = await page
    .locator(".filters-title[aria-expanded='true']")
    .count();
  check("g4", "85701: Filters renders collapsed", filtersOpen === 0);

  const railVisible = await page
    .locator(".sidebar-scroll")
    .isVisible()
    .catch(() => false);
  if (!railVisible) {
    cannotRun(
      "g4",
      "85701: the rail's control placement",
      "the rail is closed at this width",
    );
  }
  const railText = railVisible
    ? await page.locator(".sidebar-scroll").innerText()
    : "";
  check(
    "g4",
    "85701: Near me stays outside Filters",
    /Near me/i.test(railText),
    "Near me is on the rail",
  );
  check(
    "g4",
    "85701: Limit radius and Show districts moved inside Filters",
    !/Limit radius/i.test(railText) && !/Show districts/i.test(railText),
    railText.replace(/\s+/g, " ").slice(0, 120),
  );

  /*
   * Opening Filters is a CLICK, and a click that cannot land is reported as
   * "could not run" rather than thrown.
   *
   * The rail is a drawer below the desktop breakpoint and the walk runs at
   * more than one width; a hidden control there is the sidebar behaving, not
   * a regression. Throwing would have taken the whole suite down with it —
   * which is the opposite of what a regression net is for.
   */
  const filtersButton = page.locator(".filters-title").first();
  const canOpen = await filtersButton.isVisible().catch(() => false);
  if (!canOpen) {
    cannotRun(
      "g4",
      "85701: opening Filters",
      "the Filters control is not visible at this width (the rail is a drawer)",
    );
  } else {
    await filtersButton.click();
    await page.waitForTimeout(500);
    const opened = await page.locator(".sidebar-scroll").innerText();
    check(
      "g4",
      "85701: opening Filters reveals radius and districts",
      /Limit radius/i.test(opened) && /Show districts/i.test(opened),
    );
    check(
      "g4",
      "85701: District types is collapsed inside Filters",
      (await page.locator(".filter-group-toggle[aria-expanded='false']").count()) > 0,
    );
  }

  /*
   * g4 item 15 — the moving-here line, exactly.
   *
   * Asserted against the BALLOT page's server-rendered HTML rather than the
   * map's DOM. The line lives on both surfaces, but on the map it is inside
   * the who-governs card, which is collapsed to its bubble at some widths and
   * after some interactions — so reading it off the map measured whether the
   * card happened to be open, and reported "(absent)" for a string that was
   * shipped and correct. The ballot page renders it unconditionally.
   */
  const ballotHtml = (await get("/ballot?zip=85701")).text;
  check(
    "g4",
    "the moving-here line reads exactly",
    /Moving here\? Know the basics/.test(ballotHtml) &&
      !/Taxes, schools, registering/.test(ballotHtml),
    /Taxes, schools, registering/.test(ballotHtml)
      ? "the long form is still on the page"
      : "exact",
  );

  await page.context().close();
}

{
  /*
   * g4 item 11 — the meetings panel opens fully collapsed.
   *
   * The author's comparison screenshots: grouped-and-collapsed is right,
   * auto-expanded is wrong.
   */
  const page = await openWideAt(browser, "85701");
  const listButton = page.locator('button:has-text("meetings")').first();
  if ((await listButton.count()) === 0) {
    cannotRun("g4", "the meetings panel", "no control opens the list at 85701");
  } else {
    const canOpenList = await listButton.isVisible().catch(() => false);
    if (!canOpenList) {
      cannotRun("g4", "the meetings panel", "the list control is not visible at this width");
    } else {
    await listButton.click();
    await page.waitForTimeout(900);
    const groups = await page.locator(".al-group-head").count();
    const expanded = await page
      .locator(".al-group-head[aria-expanded='true']")
      .count();
    if (groups === 0) {
      cannotRun("g4", "the meetings panel's groups", "no groups rendered");
    } else {
      check(
        "g4",
        "85701: the meetings panel opens with every group collapsed",
        expanded === 0,
        `${expanded} of ${groups} group(s) open`,
      );
    }
    }
  }
  await page.context().close();
}


// ═══════════════════════════════════════════════════════════════════════════
// g5 — the active-state model, and the panel that would not paint.
// ═══════════════════════════════════════════════════════════════════════════

{
  /*
   * g5 item 1 — THE ACTIVE STATE'S INTERIOR IS CRISP.
   *
   * The claim in one assertion, at the zoom it failed at. The scrim's clip
   * path was the state's rings at full projected extent — about 16,800 ×
   * 20,000 px at z11 — and Chromium DROPS a clip that large rather than
   * applying it, so the scrim painted over the whole map and the reader
   * standing in the middle of Arizona saw no crisp pixel anywhere.
   *
   * Sampled at a real place FAR FROM THE ENTERED ZIP, because near the centre
   * there is nothing to compare and the shipped defect was invisible to any
   * check that looked there. `pnpm measure:focus` is the full pass across
   * three zooms, two zips and both themes; this is the one line of it that
   * has to hold on every deploy.
   */
  const page = await openWideAt(browser, "85701");
  const probe = await page.evaluate(
    () =>
      (
        window as unknown as {
          __wtpProject?: (p: [number, number]) => { x: number; y: number };
        }
      ).__wtpProject?.([-110.98, 32.3]) ?? null,
  );
  if (!probe) {
    cannotRun("g5", "85701: the active state's interior is crisp", "no __wtpProject");
  } else {
    const canvas = page.locator("canvas.maplibregl-canvas");
    const on = decodePng(await canvas.screenshot());
    await page.evaluate(() => {
      const el = document.querySelector(".state-focus-layer") as HTMLElement | null;
      if (el) el.style.visibility = "hidden";
    });
    await page.waitForTimeout(500);
    const off = decodePng(await canvas.screenshot());
    const x = Math.round(probe.x);
    const y = Math.round(probe.y);
    const delta = Math.abs(
      patchStats(on, x, y, 8).luma - patchStats(off, x, y, 8).luma,
    );
    check(
      "g5",
      "85701: north Tucson renders crisp, not muted, at city zoom",
      delta <= 2.5,
      `north Tucson at (${x},${y}), effect on vs off delta ${delta.toFixed(2)} <= 2.5`,
    );
  }
  await page.context().close();
}

{
  /*
   * g5 item 2 — THE MEETINGS PANEL PAINTS WITHOUT BEING TOUCHED.
   *
   * The mouse never moves: the panel is opened with a DOM `click()` issued
   * from inside the page, because a pointer move is the thing that repaired
   * the defect and a walk that hovers cannot see it. Measured on PIXELS — the
   * DOM was never wrong, and a guard that read it would have passed on every
   * broken build.
   *
   * `pnpm measure:panels` is the full pass at four zips, two viewports and
   * repeated for the intermittency; this is the claim that has to hold.
   */
  const page = await openAt(browser, "85701");
  const menu = page.locator('button[aria-label="Open menu"]');
  if (await menu.count()) {
    await menu.first().evaluate((el: HTMLElement) => el.click());
    await page.waitForTimeout(800);
  }
  // The frame BEFORE the panel opens. Every paint claim below is measured
  // against it, so no absolute threshold has to know what the basemap looks
  // like underneath the panel.
  const closedFrame = decodePng(await page.screenshot());
  const opened = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll("button, [role=button]"));
    for (const c of cards) {
      const text = c.textContent ?? "";
      if (/meetings/i.test(text) && /\d/.test(text)) {
        (c as HTMLElement).click();
        return true;
      }
    }
    return false;
  });
  if (!opened) {
    cannotRun("g5", "85701: the meetings panel paints on first render", "no meetings door");
  } else {
    await page.waitForTimeout(1600);
    const shape = await page.evaluate(() => {
      const header = document.querySelector(".al-overlay-count");
      const heads = Array.from(document.querySelectorAll(".al-group-head"));
      const counts: number[] = [];
      for (const h of heads) {
        const n = Number((h.querySelector(".al-group-count")?.textContent ?? "").trim());
        if (Number.isFinite(n)) counts.push(n);
      }
      const body = document.querySelector(".al-overlay-body");
      return {
        stated: Number((header?.textContent ?? "").replace(/[^\d]/g, "")),
        groups: heads.length,
        sum: counts.reduce((a, b) => a + b, 0),
        rect: body ? body.getBoundingClientRect().toJSON() : null,
      };
    });
    const png = decodePng(await page.screenshot());
    let change = 0;
    if (shape.rect && shape.rect.width > 8) {
      /*
       * The body's own rectangle, against the frame taken before the panel
       * opened — see png.mts#regionChange for why this replaced a
       * "does this patch carry detail" test.
       *
       * That test read a standard deviation of 2.6 on a good build against a
       * threshold of 1, because a group header is mostly empty ground with a
       * short label on the left. Device pixel ratio alone flipped it: this
       * check reported a NAMED REGRESSION against a build that
       * `pnpm measure:panels` had just passed 30 of 30 on the same
       * production deploy. A guard that fails a build its own sibling passes
       * is measuring the wrong thing.
       *
       * The walk's phone context runs at deviceScaleFactor 2, so a CSS rect
       * is half the pixels the screenshot is measured in.
       */
      change = regionChange(closedFrame, png, {
        x: shape.rect.x * 2,
        y: shape.rect.y * 2,
        width: shape.rect.width * 2,
        height: shape.rect.height * 2,
      });
    }
    check(
      "g5",
      "85701: the meetings panel body paints on first render, no pointer",
      shape.groups > 0 && change >= 6,
      `${shape.groups} group header(s), the body's pixels moved ${change.toFixed(1)} from the frame before it opened (>= 6)`,
    );
    check(
      "g5",
      "85701: the panel's group counts sum to the stated count",
      shape.stated > 0 && shape.sum === shape.stated,
      `groups sum ${shape.sum}, header states ${shape.stated}`,
    );
  }
  await page.context().close();
}

// ═══════════════════════════════════════════════════════════════════════════
// The summary.
// ═══════════════════════════════════════════════════════════════════════════

await browser.close();

const EXCLUDED = [
  "tester-walk-0814b — the reaction-capture write half (taps a real reaction row)",
  "tester-walk-0814d — the T08 human-paced write gate (taps a real reaction row)",
  "tester-walk-0815 — the reaction half of item 5 (writes); its read half is carried here",
  "pnpm pairs / pnpm shoot — screenshot passes; a human rules on pixels",
];

console.log(`\n${new Array(60).fill("─").join("")}`);
console.log(`${passed} check(s) passed, ${failures.length} regression(s), ${blocked.length} could not run`);

if (failures.length > 0) {
  console.log("\nNAMED REGRESSIONS — a win a prior session shipped is undone:");
  for (const f of failures) {
    console.log(`  · ${f.name}`);
    console.log(`      shipped by: ${f.session}${f.evidence ? `\n      saw: ${f.evidence}` : ""}`);
  }
}
if (blocked.length > 0) {
  console.log("\nCOULD NOT RUN (unknown, not negative):");
  for (const b of blocked) console.log(`  · ${b}`);
}

console.log("\nNOT IN THIS SUITE, deliberately:");
for (const e of EXCLUDED) console.log(`  · ${e}`);

console.log(
  `\nPRODUCTION ROWS THIS RUN CREATED: ${searchLogRows} search-log row(s) ` +
    `(every /api/meetings GET writes one), ${askRows} ask/log row(s). ` +
    `No reaction was tapped.`,
);

if (failures.length > 0) process.exit(1);
