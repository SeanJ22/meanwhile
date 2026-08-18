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
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { neon } from "@neondatabase/serverless";
import { config as loadEnv } from "dotenv";
import { chromium, type Browser, type Page } from "playwright";

import { makeRunId, syntheticRunHeaders } from "../lib/db/run-marker.ts";
import { PRODUCT_NAME } from "../lib/brand.ts";
import { internalSourceIds } from "../lib/meetings/source-labels.ts";
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
 * Every check that actually RAN, by the session that shipped it.
 *
 * ITEM 1c (g6, 2026-08-17). The suite's count did not reconcile across two
 * sessions: g5 reported 133 before its work, retired 4 and added 7, and
 * reported 134 — which is arithmetic that does not close — and h then took
 * 134 as given and grew it to 135.
 *
 * The enumeration found no lost check. What it found was that **the starting
 * number was wrong**: the count at g5's parent commit was 131, not 133, and
 * 131 - 4 + 7 = 134 closes exactly. 131 is also the number g4's own report
 * recorded ("Green locally: 131 of 131"). A single mis-transcribed integer
 * propagated through two sessions and a merge and looked, from the far end,
 * exactly like two checks silently dying.
 *
 * The count is data-dependent — several checks live inside per-zip loops and
 * eleven more come off the `MEETING_FLOORS` table — so it can never be
 * derived by reading the file, which is why it was being copied by hand. So
 * the suite prints its own census: no session has to transcribe a number
 * again, and a session that adds checks can diff its own run against the
 * previous one instead of trusting a sentence in a report.
 */
const census = new Map<string, number>();

/**
 * Every check that ran, BY IDENTITY — and the reason integers were not enough.
 *
 * The census above fixed one half of the counting problem: no session has to
 * transcribe a total. It did not fix the other half. A session still compares
 * its run to the previous one by SUBTRACTING — "148 last time, 152 now, so I
 * added four" — and that subtraction is blind in the way that matters: a run
 * that loses three checks and gains seven reports +4, identical to a run that
 * simply gained four. The failure the suite exists to catch is a check dying
 * quietly, and integer arithmetic is exactly the instrument that cannot see it.
 *
 * So the run emits its check identities as a SET, `docs/walk-checks.txt`, and
 * diffs itself against the committed one. What prints is what a session
 * actually needs to say: these were added, these are GONE. A removal is loud
 * even when the total went up.
 *
 * Names are stable by construction — the interpolated parts are zips and body
 * names from committed tables, never a measured value, which belongs in the
 * `evidence` argument. A name that carried a measurement would churn the diff
 * on every run and teach everyone to ignore it.
 */
const identities: string[] = [];
const CHECKS_FILE = join(process.cwd(), "docs", "walk-checks.txt");

/**
 * One assertion, owned by the session that shipped the claim.
 *
 * `session` is not decoration: a failure prints as "the win <session> shipped
 * is undone", which is the sentence the standing report needs and the one a
 * bare check name cannot produce.
 */
function check(session: string, name: string, ok: boolean, evidence = ""): boolean {
  census.set(session, (census.get(session) ?? 0) + 1);
  identities.push(`[${session}] ${name}`);
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
/**
 * Every identity that DECLARED it could not run (g10, 2026-08-17).
 *
 * Kept beside `blocked` rather than parsed back out of it: a check name and a
 * reason are both free text and both contain em-dashes, so splitting the
 * formatted line would truncate exactly the names that need matching.
 */
const declinedIdentities: string[] = [];

function cannotRun(session: string, name: string, why: string): void {
  blocked.push(`[${session}] ${name} — ${why}`);
  declinedIdentities.push(`[${session}] ${name}`);
  console.log(`  ??  [${session}] ${name} — COULD NOT RUN: ${why}`);
}

function section(title: string): void {
  console.log(`\n${title}`);
}

// ── Probe accounting, and the run's own identity (C05) ─────────────────────

/**
 * This run declares itself, at write time, from its own environment.
 *
 * C05 (2026-08-17): every row this walk creates in production's `search_log`
 * is ours, and nothing sold may contain it. The runner cannot mark the row —
 * the route writes it, on Netlify — so the runner says who it is in a header
 * and the route records the declaration. Never a user-agent guess, never a
 * heuristic applied afterwards.
 *
 * `WTP_RUN_ID` from CI when it is set, so a CI run keeps its own identity;
 * otherwise a local id stamped with this run's start. Both are SYNTHETIC.
 */
const RUN_ID =
  process.env.WTP_RUN_ID?.trim() ||
  makeRunId(process.env.CI ? "walk-all-ci" : "walk-all-local", new Date().toISOString());
const RUN_HEADERS = syntheticRunHeaders({ ...process.env, WTP_RUN_ID: RUN_ID });

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
    headers: {
      "User-Agent": "we-the-people walk:all (regression net)",
      ...RUN_HEADERS,
    },
  });
  return { status: response.status, text: await response.text() };
}

async function getJson<T>(path: string): Promise<T | null> {
  const url = `${BASE}${path}`;
  countProbe(url);
  const response = await fetch(url, {
    headers: { accept: "application/json", ...RUN_HEADERS },
  });
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
    // C05: the browser declares this run synthetic too. The page's own
    // /api/meetings fetches write search-log rows exactly like the direct
    // probes do, and they are the bulk of what a walk creates.
    extraHTTPHeaders: RUN_HEADERS,
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
    // C05: same declaration on the wide viewport.
    extraHTTPHeaders: RUN_HEADERS,
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
    /** hotfix-0817: present exactly when the last refresh could not reach this row. */
    carried?: { source: string; lastFreshAt: string };
  }>;
  tier: string;
  coverage: { bodies: Array<{ name: string | null; ocdId: string | null }> } | null;
  snapshot: {
    generatedAt: string;
    failed: Array<{ source: string }>;
    /** hotfix-0817: the rows this snapshot holds that its own run never retrieved. */
    carried?: { count: number; lastFreshAt: string | null };
  } | null;
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

  /*
   * ITEM 1a (g6, 2026-08-17) — ONE DENOMINATOR, asserted in the DOM.
   *
   * Production at 85701 read "4 bodies govern the area around 85701" above a
   * disclosure reading "Why these 5?" above 5 rows. Three numbers, one list,
   * on the surface whose entire job is telling a stranger who governs them.
   *
   * All three are parsed out of the rendered page — the prose number, the
   * disclosure link's number, and the actual `<li>` count — and asserted
   * equal. Parsing the rendered thing is the point: the two definitions each
   * looked right in isolation, and only the screen showed them disagreeing.
   */
  const denominators = await page.evaluate(`(() => {
    const card = document.querySelector(".coverage-notice");
    if (!card) return { reason: "no who-governs card" };

    const flat = (card.textContent || "").replace(/\\s+/g, " ");
    // "N bodies govern the area around 85701" / "One body governs the area"
    // / "We track the calendars of M of the N bodies that govern the area".
    let prose = null;
    const ofThe = flat.match(/of the (\\d+) bodies that govern the area/);
    const govern = flat.match(/(\\d+) bodies govern the area/);
    const one = /One body governs the area/.test(flat);
    if (ofThe) prose = Number(ofThe[1]);
    else if (govern) prose = Number(govern[1]);
    else if (one) prose = 1;

    // The disclosure link: "Why these N?"
    let link = null;
    for (const s of card.querySelectorAll("summary")) {
      const m = (s.textContent || "").match(/Why these (\\d+)\\?/);
      if (m) link = Number(m[1]);
    }

    // The rendered rows, off an explicit hook rather than a Tailwind class —
    // a class is a styling decision, and the next design pass would have
    // disarmed this guard without anyone noticing.
    const rows = card.querySelectorAll("li[data-governing-row]").length;
    return { prose, link, rows, sample: flat.slice(0, 160) };
  })()`) as { reason?: string; prose?: number | null; link?: number | null; rows?: number | null; sample?: string };

  if (denominators.reason) {
    cannotRun("g6", `${zip}: who-governs states one number for one list`, denominators.reason);
  } else {
    const { prose, link, rows } = denominators;
    const all = [prose, link, rows];
    if (all.some((n) => n === null || n === undefined)) {
      cannotRun(
        "g6",
        `${zip}: who-governs states one number for one list`,
        `could not parse all three: prose=${prose} link=${link} rows=${rows} — "${denominators.sample}"`,
      );
    } else {
      check(
        "g6",
        `${zip}: who-governs states one number for one list`,
        prose === link && link === rows,
        `prose ${prose}, disclosure link ${link}, rendered rows ${rows}`,
      );
    }
  }

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
    // The mayor-reachability pair moved OUT of this shared page loop — see
    // section I. It needs a page nobody else has touched.
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
  /** R47: the lowest pin count held at any instant during each settle. */
  const floors: number[] = [];
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
      /*
       * R47 (g14) — SAMPLED THROUGH THE SETTLE, not once at the end of it.
       *
       * This wait used to be a blind `waitForTimeout`. That is what made the
       * pin wipe look like a race: the map emptied for 200–500 ms while its
       * next answer was in flight, and a single sample after a fixed wait
       * landed inside that window on some runs and not others. The suite
       * reported the same build red and then green minutes apart, and the
       * row it opened called it intermittent. It was not — the DEFECT was
       * deterministic and the INSTRUMENT was intermittent.
       *
       * So the wait is now forty samples instead of one, and the floor it
       * records is the lowest pin count the map held at any instant between
       * this zoom and the next. That is what makes a single green run
       * sufficient for this class: the check no longer has to be lucky about
       * when it looks, because it looks the whole time. `pnpm probe:r47`
       * carries the same instrument at higher resolution for diagnosis.
       */
      let floor = Number.POSITIVE_INFINITY;
      const until = Date.now() + 4000;
      while (Date.now() < until) {
        const pins = await page.evaluate(() => {
          const w = window as unknown as { __wtpPinCount?: () => number };
          return typeof w.__wtpPinCount === "function" ? w.__wtpPinCount() : -1;
        });
        if (pins >= 0 && pins < floor) floor = pins;
        await page.waitForTimeout(100);
      }
      floors.push(Number.isFinite(floor) ? floor : -1);
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

    /*
     * R47 (g14) — and never empties on the way there either.
     *
     * g3's check above compares the SETTLED counts at each zoom tier, so a
     * map that drops every pin and puts them all back between two samples
     * passes it while a reader watching sees the map blank. This asserts the
     * floor instead: the lowest count held at ANY instant across the settle,
     * at every zoom tier the walk reaches.
     *
     * A zero floor is the defect whether the pins come back or not. That is
     * CLAUDE.md's refresh corollary applied to the render — a retrieval in
     * flight may not be shown as an absence — and it is why this is its own
     * check rather than a tightening of g3's: they are two different claims,
     * and folding them together would let one hide behind the other.
     */
    if (floors.some((f) => f < 0)) {
      cannotRun("g14", `${zip}: pin floor`, "the map exposes no pin-count probe mid-settle");
    } else {
      check(
        "g14",
        `${zip}: the map never empties while a wider view loads`,
        floors.every((f) => f > 0),
        `floor ${floors.join(" → ")} across the settles (40 samples each, 100ms apart) — ` +
          "sampled throughout rather than once, so a single green run is sufficient here",
      );
    }
  }

  await page.context().close();
}

// ═══════════════════════════════════════════════════════════════════════════
// D. The ballot page — picks, names, the scale.
// ═══════════════════════════════════════════════════════════════════════════

section("D. The ballot page (0814c, D53, g3)");

{
  const context = await browser.newContext({
    // C05: this run is ours, declared at write time.
    extraHTTPHeaders: RUN_HEADERS,
    viewport: PHONE,
    reducedMotion: "reduce",
  });
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

  for (const [index, [zip, expected]] of hops.entries()) {
    /*
     * THE HOP'S OWN NAME (g9 item 4, 2026-08-17).
     *
     * 03255 appears twice in this journey — first, and again at the end to
     * prove the raised state comes BACK after two other states. That return
     * is the whole point of the fourth hop and it is a different claim from
     * the first, but both hops emitted three checks under identical names, so
     * the identity set collapsed six checks into three and the diff could not
     * have seen one of them die. The distinguishing fact is the journey
     * position, so that is what the name carries — not a measured value,
     * which would churn the diff on every run.
     */
    const hop = `hop ${index + 1} of ${hops.length}${
      index === hops.length - 1 ? ", returning" : ""
    }`;
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
      cannotRun("g4", `${zip} (${hop}): the map probe`, "no __wtpMapProbe on the page");
      await page.context().close();
      continue;
    }

    check(
      "g4",
      `${zip} (${hop}): the raised state is the state the reader is in`,
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
      `${zip} (${hop}): only the active state draws district boundaries`,
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
      `${zip} (${hop}): the zip draws nothing on the map`,
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
// ITEM 1d (g6, 2026-08-17) — the meetings count, all four places, all four
// zips, one run.
//
// g5 measured group headers summing to 78 and never named the header count it
// compared against; an earlier frame of the author's read 86. Production now
// reads 78 in all three places, so the 86 is a different moment rather than a
// live defect — but "confirmed by reading one number in one place" is how a
// stated-N defect survives, so this closes it mechanically and permanently.
//
// Four numbers per zip: the sidebar counter, the map chip, the panel's header
// and the sum of its group counts. The chip is `sm:` and up, so on a phone
// viewport it is legitimately absent — absent is reported as absent, never as
// a zero and never as a pass.
// ═══════════════════════════════════════════════════════════════════════════
section("G. The meetings count agrees with itself (g6 item 1d)");

for (const { zip } of FOUR) {
 for (const wide of [false, true]) {
  // The chip lives at `sm:` and up, so the phone pass legitimately cannot see
  // it and the desktop pass is where the FOURTH number comes from. Both run:
  // dropping the phone would drop the viewport the defect was reported on,
  // and dropping the desktop would leave the chip permanently unchecked.
  const page = wide ? await openWideAt(browser, zip) : await openAt(browser, zip);
  const where = `${zip}${wide ? " (desktop)" : " (phone)"}`;
  await page.waitForTimeout(600);

  const numbers = await page.evaluate(`(() => {
    const readInt = (el) => {
      if (!el) return null;
      const n = Number((el.textContent || "").replace(/[^0-9]/g, ""));
      return Number.isFinite(n) ? n : null;
    };
    const sidebarEl = document.querySelector('[data-stat="meetings"] .num');
    const chipEl = document.querySelector("[data-meeting-count]");
    const sidebar = readInt(sidebarEl);
    const chip = chipEl ? Number(chipEl.getAttribute("data-meeting-count")) : null;
    const chipVisible = chipEl ? chipEl.getClientRects().length > 0 : false;

    // Open the meetings door, then read the panel.
    let opened = false;
    const door = document.querySelector('[data-stat="meetings"]');
    if (door) { door.click(); opened = true; }
    return { sidebar, chip, chipVisible, opened };
  })()`) as {
    sidebar: number | null;
    chip: number | null;
    chipVisible: boolean;
    opened: boolean;
  };

  if (!numbers.opened) {
    cannotRun("g6", `${where}: the meetings count agrees with itself`, "no meetings door on the sidebar");
    await page.context().close();
    continue;
  }
  await page.waitForTimeout(1400);

  const panel = await page.evaluate(`(() => {
    const header = document.querySelector(".al-overlay-count");
    if (!header) return { reason: "the meetings panel did not open" };
    const counts = [];
    for (const h of document.querySelectorAll(".al-group-head")) {
      const n = Number((h.querySelector(".al-group-count")?.textContent || "").trim());
      if (Number.isFinite(n)) counts.push(n);
    }
    return {
      stated: Number((header.textContent || "").replace(/[^0-9]/g, "")),
      groups: counts.length,
      sum: counts.reduce((a, b) => a + b, 0),
    };
  })()`) as { reason?: string; stated?: number; groups?: number; sum?: number };

  if (panel.reason) {
    cannotRun("g6", `${where}: the meetings count agrees with itself`, panel.reason);
    await page.context().close();
    continue;
  }

  // The chip is hidden below the `sm` breakpoint by design. Hidden is stated,
  // not silently treated as agreement and not counted as a failure.
  const chipNote = numbers.chipVisible
    ? `chip ${numbers.chip}`
    : `chip not rendered at this width (sm: and up only)`;
  const comparable = [numbers.sidebar, panel.stated, panel.sum].concat(
    numbers.chipVisible ? [numbers.chip] : [],
  );
  const allEqual = comparable.every((n) => n !== null && n === comparable[0]);

  check(
    "g6",
    `${where}: the meetings count agrees with itself`,
    allEqual && (panel.stated ?? 0) >= 0,
    `sidebar ${numbers.sidebar}, ${chipNote}, panel header ${panel.stated}, ` +
      `group counts sum ${panel.sum} across ${panel.groups} group(s)`,
  );

  await page.context().close();
 }
}

// ═══════════════════════════════════════════════════════════════════════════
// The summary.
// ═══════════════════════════════════════════════════════════════════════════


// ── Section G ─────────────────────────────────────────────────────────────

section("H. The frozen denominator (h item 1)");

/**
 * The one claim h shipped that production can be asked about.
 *
 * h enumerated 03255 against the 2022 Census of Governments and froze the
 * answer: THREE units govern this point — Merrimack County, the Town of
 * Newbury, and Kearsarge Regional School District. That number comes from
 * OUTSIDE our own records, which is the whole reason it is worth pinning:
 * if production ever renders a different governing count at 03255, either a
 * body was added without the denominator moving or the denominator moved
 * without anyone saying so, and both are the failure CLAUDE.md names.
 *
 * It is deliberately pinned to the UNIT count rather than the body count.
 * The body denominator is UNENUMERABLE today (H02) — the Census has one row
 * for the Town of Newbury and the product renders five of its boards — so a
 * check against a body count would be pinning our own registry to itself,
 * which is exactly the self-defining denominator this check exists to
 * refuse.
 */
{
  const payload = await getJson<{
    coverage: { counts: { governing: { total: number } } } | null;
  }>("/api/meetings?lat=43.31403&lng=-72.02455");

  if (!payload) {
    cannotRun("h", "03255: the governing count matches the frozen external denominator", "/api/meetings did not answer");
  } else {
    const governing = payload.coverage?.counts.governing.total ?? -1;
    check(
      "h",
      "03255: the governing count matches the frozen external denominator",
      governing === 3,
      `production says ${governing} governing; the 2022 Census of Governments says 3 ` +
        `(Merrimack County, Newbury town, Kearsarge Regional SD)`,
    );
  }
}


// ═══════════════════════════════════════════════════════════════════════════
// ITEM 6 (g6, 2026-08-17) — the mayor is still reachable after leaving the
// who-governs panel.
//
// This REPLACES `[0818] 07866: the mayor line renders`, which asserted /Mayor/
// on the who-governs card. That check leaves the suite the only way a check
// ever may: **the author retired the claim behind it.** Keeping it would now
// assert a defect. What was worth guarding was never the row — it was that a
// reader at 07866 can still reach their mayor.
//
// **It runs on its own fresh page, and that is the point.** The first version
// lived inside the shared per-zip loop in section C, after a dozen other
// checks had already opened and closed things on that page, and it failed
// against a production build where the office was demonstrably present: the
// "Representation" button it clicked belonged to whatever surface an earlier
// check had left open, not to the card this check had just opened. A guard
// that reports a regression against a working build is worse than no guard.
//
// So every query below is scoped to the dialog this check opened —
// `[role="dialog"]`, its own `[role="tablist"]`, its own `[role="tabpanel"]` —
// and nothing is read off `document.body`.
//
// The distance is also recorded, because it is item 6's real cost: the mayor
// moved from zero clicks (a row on who-governs) to two (row → card →
// Representation). The author ruled the placement out; the price is stated
// rather than implied.
// ═══════════════════════════════════════════════════════════════════════════
section("I. The mayor after item 6 (g6)");

{
  const page = await openAt(browser, "07866");
  await page.waitForTimeout(700);

  const onPanel = await page.evaluate(`(() => {
    const card = document.querySelector(".coverage-notice");
    if (!card) return null;
    return /Mayor/.test(card.textContent || "");
  })()`) as boolean | null;

  if (onPanel === null) {
    cannotRun("g6", "07866: the Mayor row is gone from the who-governs panel", "no who-governs card");
    cannotRun("g6", "07866: the mayor is reachable from who-governs", "no who-governs card");
  } else {
    check(
      "g6",
      "07866: the Mayor row is gone from the who-governs panel",
      onPanel === false,
      `who-governs text contains "Mayor": ${onPanel}`,
    );

    const opened = await page.evaluate(`(() => {
      const card = document.querySelector(".coverage-notice");
      for (const b of card.querySelectorAll("li[data-governing-row] button")) {
        if (/Rockaway township/i.test(b.textContent || "")) { b.click(); return true; }
      }
      return false;
    })()`) as boolean;

    if (!opened) {
      cannotRun("g6", "07866: the mayor is reachable from who-governs", "no Rockaway township row to open");
    } else {
      await page.waitForTimeout(2500);
      /*
       * TWO GRAMMARS, because M136 (g13, 2026-08-18) gave BODY cards
       * collapsible sections while district and meeting cards kept their
       * tabs. This check went COULD-NOT-RUN the moment the body card stopped
       * having a Representation tab — a check that stops running is the
       * quietest way for a claim to die, so it is taught the new shape here
       * rather than left reporting an honest nothing.
       *
       * The CLAIM is unchanged and is still two clicks from the panel: row →
       * card → open the seats. Only the second click's affordance moved, and
       * the evidence line below says which one answered.
       */
      const opened2 = await page.evaluate(`(() => {
        const dlg = document.querySelector('[role="dialog"]');
        if (!dlg) return "no dialog";
        for (const b of dlg.querySelectorAll('[role="tablist"] button')) {
          if (/representation/i.test(b.textContent || "")) { b.click(); return "tab"; }
        }
        for (const b of dlg.querySelectorAll("button")) {
          if (/who sits on it/i.test(b.textContent || "")) { b.click(); return "section"; }
        }
        return "neither a Representation tab nor a Who-sits-on-it section in the dialog";
      })()`) as string;

      if (opened2 !== "tab" && opened2 !== "section") {
        cannotRun("g6", "07866: the mayor is reachable from who-governs", opened2);
      } else {
        await page.waitForTimeout(1800);
        // Scope to the tab panel where there is one, and to the whole dialog
        // body where the section grammar is in play — never to the document,
        // which would let anything else on the page answer for this card.
        const inPanel = await page.evaluate(`(() => {
          const dlg = document.querySelector('[role="dialog"]');
          const panel =
            (dlg && dlg.querySelector('[role="tabpanel"]')) ||
            (dlg && dlg.querySelector('.account-modal-body')) ||
            dlg;
          const t = (panel && panel.textContent) || "";
          return { mayor: /Mayor/.test(t), jackson: /Joseph Jackson/.test(t), chars: t.length };
        })()`) as { mayor: boolean; jackson: boolean; chars: number };

        check(
          "g6",
          "07866: the mayor is reachable from who-governs",
          inPanel.mayor && inPanel.jackson,
          `two clicks from the panel (row → card → ${opened2}): the office renders ${inPanel.mayor}, ` +
            `the holder renders ${inPanel.jackson}, over ${inPanel.chars} chars`,
        );
      }
    }
  }
  await page.context().close();
}

// ═══════════════════════════════════════════════════════════════════════════
// hotfix-0817 — a carried row never inherits the snapshot's freshness.
// ═══════════════════════════════════════════════════════════════════════════

section("J. Carried rows state their own freshness (hotfix-0817 item 2)");

/*
 * The defect: the footer says "LAST CHECKED 6 hours ago", which is true of the
 * snapshot and FALSE of the rows carried forward out of the previous one
 * because a source refused. At 03255 those rows are Kearsarge's and Newbury's
 * — the calendars whose host refuses the CI runner's egress — and a reader
 * looking at one had no way to know they were looking at something we could
 * not reach.
 *
 * THIS CHECK CANNOT ALWAYS RUN, and that is not a defect in it. Carried rows
 * exist only when a source was unreachable on the refresh that wrote the
 * committed snapshot. When every source was reachable there is nothing to
 * assert, and the honest report is that it could not run, named, with the
 * reason — never a pass it did not earn. It is never retired for being unable
 * to run: the condition it guards is exactly the condition it cannot rehearse.
 */
{
  const payload = await getJson<MeetingsPayload>(
    `/api/meetings?lat=${ZIPS.newbury.lat}&lng=${ZIPS.newbury.lng}&zip=03255`,
  );
  const NAME = "03255: no carried row is claimed to be as fresh as the snapshot";
  if (!payload) {
    cannotRun("hotfix-0817", NAME, "/api/meetings did not answer");
  } else {
    const carriedRows = payload.meetings.filter((m) => m.carried);
    const meta = payload.snapshot?.carried ?? null;
    const generatedAt = payload.snapshot?.generatedAt ?? null;

    // The fresh rows are unaffected — asserted whether or not anything was
    // carried, because marks smeared across rows that WERE retrieved is the
    // mirror-image failure: a working calendar wearing a staleness it does
    // not have. A mark is only legitimate on a row whose source reported a
    // gap, so any other marked row fails this.
    const withGaps = new Set((payload.snapshot?.failed ?? []).map((f) => f.source));
    const misplaced = carriedRows.filter((m) => !withGaps.has(m.carried!.source));
    check(
      "hotfix-0817",
      "03255: only rows from a source that reported a gap carry a mark",
      misplaced.length === 0,
      `${carriedRows.length} marked of ${payload.meetings.length} row(s); sources reporting a gap: ` +
        `${[...withGaps].join(", ") || "none"}${misplaced.length > 0 ? `; misplaced: ${misplaced.map((m) => m.id).join(", ")}` : ""}`,
    );

    if (carriedRows.length === 0) {
      /*
       * ALL THREE report, not just the first (g10, 2026-08-17).
       *
       * Only `NAME` used to be named here, and the other two live inside the
       * `else` below — so when a refresh reached every source they did not
       * report CANNOT-RUN, they simply ceased to exist. The identity diff saw
       * "GONE 3" against a run where one was accounted for and two were not,
       * which is precisely the shape the diff exists to catch: a check dying
       * quietly inside the suite that was supposed to notice.
       *
       * Found by this session's own refresh, which reached every source and
       * carried nothing forward — a strictly better snapshot that made two
       * checks vanish. A condition a check cannot rehearse is still a check;
       * it says so by name.
       */
      const reason =
        `the snapshot generated ${generatedAt ?? "unknown"} holds no carried rows at this zip — ` +
        "every source serving 03255 was reachable on the last refresh, so there is " +
        "no stale row for a freshness statement to speak for";
      for (const name of [
        NAME,
        "03255: each carried row's stated timestamp is the one the snapshot records",
        "03255: the footer does not speak for the carried rows",
      ]) {
        cannotRun("hotfix-0817", name, reason);
      }
    } else {
      // 1. Every carried row names its origin and an instant, and that instant
      //    is OLDER than the snapshot's own — a carried row that claims to be
      //    as new as the run that never reached it is the defect itself.
      const older = carriedRows.filter(
        (m) =>
          Number.isFinite(Date.parse(m.carried!.lastFreshAt)) &&
          generatedAt !== null &&
          Date.parse(m.carried!.lastFreshAt) < Date.parse(generatedAt),
      );
      check(
        "hotfix-0817",
        NAME,
        older.length === carriedRows.length,
        `${older.length} of ${carriedRows.length} carried row(s) state an instant strictly older ` +
          `than the snapshot's ${generatedAt}`,
      );

      // 2. The snapshot's own record and the rows agree. The count is a
      //    whole-file number and this zip is a slice of it, so the slice must
      //    not exceed it and every row's stamp must be one the file records.
      //
      // The file's stated instant is the OLDEST of the carried rows on a
      // single shared day, so two things have to hold: it is on that day, and
      // it is no NEWER than any row it speaks for. An instant newer than some
      // row would be the footer claiming a freshness that row never had —
      // which is the defect one layer down from the one this section exists
      // for, and it is how the first version of this check failed.
      const day = meta?.lastFreshAt?.slice(0, 10) ?? null;
      const stated = meta?.lastFreshAt ? Date.parse(meta.lastFreshAt) : null;
      const newerThanARow =
        stated === null
          ? []
          : carriedRows.filter((m) => Date.parse(m.carried!.lastFreshAt) < stated);
      check(
        "hotfix-0817",
        "03255: each carried row's stated timestamp is the one the snapshot records",
        meta !== null &&
          carriedRows.length <= meta.count &&
          (meta.lastFreshAt === null ||
            (carriedRows.every((m) => m.carried!.lastFreshAt.slice(0, 10) === day) &&
              newerThanARow.length === 0)),
        `${carriedRows.length} carried here of ${meta?.count ?? "?"} in the snapshot; ` +
          `file says ${meta?.lastFreshAt ?? "the rows disagree, each states its own"}` +
          (newerThanARow.length > 0
            ? `; ${newerThanARow.length} row(s) older than the stated instant`
            : ""),
      );

      // 3. And the reader is told. The footer must state the carried count
      //    rather than letting one age speak for every row, and the row's own
      //    card must carry its own stamp.
      const page = await openAt(browser, "03255");
      const footer = await page.evaluate(`(() => {
        const el = [...document.querySelectorAll("p")].find((p) =>
          /Last checked/i.test(p.textContent || ""));
        return el ? (el.textContent || "").replace(/\\s+/g, " ") : null;
      })()`) as string | null;
      if (footer === null) {
        cannotRun("hotfix-0817", "03255: the footer does not speak for the carried rows", "no last-checked line on the page");
      } else {
        check(
          "hotfix-0817",
          "03255: the footer does not speak for the carried rows",
          /older than that/i.test(footer),
          `footer reads "${footer.slice(0, 160)}"`,
        );
      }
      await page.context().close();
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// K. No internal key reaches a reader (g8)
// ═══════════════════════════════════════════════════════════════════════════

section("K. Reader surfaces speak plain language (g8)");

/*
 * `schedulepage`, `civicplus`, `iqm2`, `clerksboards` — adapter ids. Right in
 * the wiring, wrong in front of a person, and `/api/meetings` ships them to
 * the client in three places (`sources[].source`, every meeting `id`, and
 * `carried.source`), so the value is permanently one interpolation away from a
 * surface.
 *
 * Read off PRODUCTION rather than off the source, because that is where the
 * claim lives. `tests/source-labels.test.ts` reads the components; this reads
 * what a reader is actually served. The API's own JSON is deliberately NOT
 * checked — it is a wire format, not a reader surface, and asserting on it
 * would either fail forever or force the ids out of the place they belong.
 */
{
  const ids = internalSourceIds();
  for (const { zip } of FOUR) {
    for (const [surface, path] of [
      ["the map's server HTML", `/?zip=${zip}`],
      ["/about-area", `/about-area?zip=${zip}`],
      ["/ballot", `/ballot?zip=${zip}`],
    ] as const) {
      const res = await get(path);
      if (res.status !== 200) {
        cannotRun("g8", `${zip}: no internal source id on ${surface}`, `HTTP ${res.status}`);
        continue;
      }
      const found = ids.filter((id) => new RegExp(`\\b${id}\\b`).test(res.text));
      check(
        "g8",
        `${zip}: no internal source id on ${surface}`,
        found.length === 0,
        found.length > 0 ? `found: ${found.join(", ")}` : `${ids.length} id(s) checked`,
      );

      // B01 interim: the product wears one name, and the old one is gone from
      // every surface a reader is served. A rename that half-lands is worse
      // than one that never started — two names read as two products.
      check(
        "g8",
        `${zip}: ${surface} carries the current product name, not the old one`,
        res.text.includes(PRODUCT_NAME) && !/We[ ]the[ ]People/i.test(res.text),
        res.text.includes(PRODUCT_NAME)
          ? /We[ ]the[ ]People/i.test(res.text)
            ? "both names are on the page"
            : `"${PRODUCT_NAME}" present`
          : `"${PRODUCT_NAME}" is not on the page at all`,
      );
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// g9 — one Phone pill (R39) and the address that left the product (R40).
// ═══════════════════════════════════════════════════════════════════════════

section("L. Contact surfaces (g9: R39 the phone pill, R40 the address)");

{
  /*
   * R39. Jeanne Shaheen's card rendered seven stacked phone rows; 531 of the
   * 1,157 officeholder records carry more than one number, so this is a
   * class-wide claim checked at its loudest instance. Its own fresh page,
   * because the per-zip loop's page has been clicked through by a dozen
   * checks and a bare querySelector would find whatever they left open.
   */
  const page = await openAt(browser, "03255");

  const opened = (await page.evaluate(`(() => {
    const card = document.querySelector(".coverage-notice");
    if (!card) return false;
    for (const b of card.querySelectorAll("button")) {
      if (/Shaheen/i.test(b.textContent || "")) { b.click(); return true; }
    }
    return false;
  })()`)) as boolean;

  if (!opened) {
    cannotRun("g9", "03255: Shaheen renders ONE Phone pill", "no Shaheen row on who-governs");
    cannotRun("g9", "03255: the phone chooser lists every recorded number", "no Shaheen row");
  } else {
    await page.waitForTimeout(2500);
    const pills = (await page.evaluate(`(() => {
      const row = document.querySelector(".contact-pill-row");
      if (!row) return null;
      const p = [...row.querySelectorAll(".contact-pill")];
      return {
        total: p.length,
        phonePills: p.filter((x) => x.tagName === "BUTTON" && /Phone/.test(x.textContent || "")).length,
        showingANumber: p.filter((x) => /\\d{3}[).\\- ]\\s?\\d{3}[-. ]\\d{4}/.test(x.textContent || "")).length,
      };
    })()`)) as { total: number; phonePills: number; showingANumber: number } | null;

    if (!pills) {
      cannotRun("g9", "03255: Shaheen renders ONE Phone pill", "no contact pill row on the card");
      cannotRun("g9", "03255: the phone chooser lists every recorded number", "no contact pill row");
    } else {
      check(
        "g9",
        "03255: Shaheen renders ONE Phone pill",
        pills.phonePills === 1 && pills.showingANumber === 0,
        `${pills.phonePills} Phone pill(s), ${pills.showingANumber} pill(s) showing a number, ` +
          `${pills.total} pill(s) total`,
      );

      await page.evaluate(`(() => {
        for (const p of document.querySelectorAll("button.contact-pill")) {
          if (/Phone/.test(p.textContent || "")) { p.click(); return; }
        }
      })()`);
      await page.waitForTimeout(700);

      // The chooser's rows against the RECORDED count, read from the same
      // route the card reads. A modal with the wrong number of rows is the
      // stated-N-equals-rendered-rows rule failing where a reader dials.
      const modal = (await page.evaluate(`(async () => {
        const overlay = document.querySelector(".phone-modal-overlay");
        if (!overlay) return null;
        const rows = [...overlay.querySelectorAll(".phone-modal-row")];
        const r = await fetch("/api/directory?member=congress:S001181");
        const recorded = r.ok
          ? new Set(((await r.json()).districtOffices || []).map((o) => o.phone).filter(Boolean)).size
          : null;
        return {
          rows: rows.length,
          tel: rows.filter((x) => (x.getAttribute("href") || "").startsWith("tel:")).length,
          labelled: rows.filter((x) => ((x.querySelector(".phone-modal-row-label") || {}).textContent || "").trim()).length,
          recorded,
          overCard: Number(getComputedStyle(overlay).zIndex) > 1300,
        };
      })()`)) as {
        rows: number;
        tel: number;
        labelled: number;
        recorded: number | null;
        overCard: boolean;
      } | null;

      if (!modal) {
        cannotRun("g9", "03255: the phone chooser lists every recorded number", "the pill opened nothing");
      } else if (modal.recorded === null) {
        cannotRun("g9", "03255: the phone chooser lists every recorded number", "the directory route did not answer");
      } else {
        check(
          "g9",
          "03255: the phone chooser lists every recorded number",
          modal.rows === modal.recorded + 1 &&
            modal.tel === modal.rows &&
            modal.labelled === modal.rows &&
            modal.overCard,
          `${modal.rows} row(s) against ${modal.recorded} recorded district number(s) + 1 Washington; ` +
            `${modal.tel} are tel: links, ${modal.labelled} carry an office label; over the card ${modal.overCard}`,
        );
      }
    }
  }
  await page.context().close();
}

{
  /*
   * R40. The author's personal address left the product. This is the
   * class-wide form of it: not "the sidebar no longer shows it" but "no
   * surface a reader is served carries it at all", checked in the SERVED
   * HTML rather than in rendered text, because a string in an attribute or a
   * script payload is just as reachable and does not show up in innerText.
   */
  const ADDRESS = ["seanj22", "gmail.com"].join("@");
  for (const [surface, path] of [
    ["the map", "/?zip=03255"],
    ["/transparency", "/transparency"],
    ["/feedback", "/feedback"],
  ] as const) {
    const res = await get(path);
    if (res.status !== 200) {
      cannotRun("g9", `${surface}: carries no personal email address`, `HTTP ${res.status}`);
      continue;
    }
    check(
      "g9",
      `${surface}: carries no personal email address`,
      !res.text.includes(ADDRESS) && !/href="mailto:/.test(res.text),
      res.text.includes(ADDRESS)
        ? "the address is in the served HTML"
        : /href="mailto:/.test(res.text)
          ? "a mailto: link is in the served HTML"
          : "neither the address nor a mailto: link",
    );
  }

  // The replacement exists and is in-app, and its disclosure shipped with it.
  const map = await get("/?zip=03255");
  if (map.status !== 200) {
    cannotRun("g9", "the sidebar offers the in-app feedback route", `HTTP ${map.status}`);
  } else {
    check(
      "g9",
      "the sidebar offers the in-app feedback route",
      /href="\/feedback"/.test(map.text),
      /href="\/feedback"/.test(map.text) ? "/feedback is linked" : "no link to /feedback",
    );
  }
  const transparency = await get("/transparency");
  if (transparency.status !== 200) {
    cannotRun("g9", "/transparency discloses the feedback store", `HTTP ${transparency.status}`);
  } else {
    check(
      "g9",
      "/transparency discloses the feedback store",
      /feedback form/i.test(transparency.text) &&
        /aggregated or licensed/i.test(transparency.text),
      `names the form ${/feedback form/i.test(transparency.text)}, ` +
        `states never-licensed ${/aggregated or licensed/i.test(transparency.text)}`,
    );
  }
  const form = await get("/feedback");
  if (form.status !== 200) {
    cannotRun("g9", "/feedback serves the form and says what happens to it", `HTTP ${form.status}`);
  } else {
    /*
     * g11: the "cannot write back" half of this check MOVED rather than being
     * dropped. R41 shipped the optional reply field, so the flat promise is
     * now true only of a blank submission and the page says which case the
     * reader is in. The check still asserts a claim about replies is made —
     * it just asserts the CURRENT one, and the g9 identity stays on the
     * surviving half so a real regression in the form still prints as g9's.
     */
    check(
      "g9",
      "/feedback serves the form and says what happens to it",
      /data-feedback-input/.test(form.text) &&
        /only write back if you fill in the optional email box/i.test(form.text),
      `input present ${/data-feedback-input/.test(form.text)}, ` +
        `states when a reply is possible ` +
        `${/only write back if you fill in the optional email box/i.test(form.text)}`,
    );
    /*
     * R41 (g11, 2026-08-17, the author's ruling A). The READ half of the row's
     * walk checks — the write half writes real feedback rows and lives in
     * scripts/walk-r41.mts, named in EXCLUDED below.
     *
     * What is asserted here is that the field ships, that it ships OPTIONAL,
     * and that the message body's scrub promise survived the change. The
     * third matters most: R41's whole risk is that the one deliberate
     * exception to T09 widens, and a page that stopped saying the message is
     * scrubbed would be the first visible sign of it.
     */
    check(
      "g11",
      "/feedback ships the optional reply field",
      /data-feedback-reply/.test(form.text),
      `field present ${/data-feedback-reply/.test(form.text)}`,
    );
    check(
      "g11",
      "the reply field is labelled optional and required by nothing",
      /Your email — optional/.test(form.text) && !/data-feedback-reply[^>]*\srequired/.test(form.text),
      `label present ${/Your email — optional/.test(form.text)}, ` +
        `not marked required ${!/data-feedback-reply[^>]*\srequired/.test(form.text)}`,
    );
    check(
      "g11",
      "the message body is still promised the T09 scrub",
      /an address left in the message itself is removed/i.test(form.text),
      `scrub promise present ${/an address left in the message itself is removed/i.test(form.text)}`,
    );
  }
  const transparencyAgain = await get("/transparency");
  if (transparencyAgain.status !== 200) {
    cannotRun("g11", "/transparency discloses the optional reply address", `HTTP ${transparencyAgain.status}`);
  } else {
    // The coupling rule: the field and its disclosure ship together, and the
    // disclosure states what the address is NEVER used for, not only what it is.
    check(
      "g11",
      "/transparency discloses the optional reply address",
      /one optional box for your email address/i.test(transparencyAgain.text) &&
        /never added to a mailing list/i.test(transparencyAgain.text),
      `names the field ${/one optional box for your email address/i.test(transparencyAgain.text)}, ` +
        `states the limits ${/never added to a mailing list/i.test(transparencyAgain.text)}`,
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// g9 / M19 — overlapping pins fan out, and dismissal returns them.
// ═══════════════════════════════════════════════════════════════════════════

section("M. Overlapping pins are each reachable (g9: M19, the author's ruling)");

{
  /*
   * The claim: two pins sitting on top of each other are BOTH tappable.
   *
   * The walk cannot guess which pins collide — that depends on zoom, data and
   * viewport — so it asks the map, through the same projection and the same
   * collision rule the click path uses. Then it FORCES a collision by zooming
   * out, because a build where nothing happens to overlap would otherwise
   * report green on a check that never ran, which is the g3 lesson.
   *
   * Its own page, and no selection is made: the first press on a stacked pin
   * fans and selects nothing, which is precisely the behaviour under test, so
   * this check opens no popup and writes no MEETING_OPENED row.
   *
   * DESKTOP width, for g4 item 5's reason: at 390px the who-governs card
   * covers the middle of the map, so a press aimed at a pin lands on an
   * overlay and the check reports a working fan as a broken one. That is not
   * a hypothetical — the first run of this check FAILED exactly that way, 4
   * pins in the stack and 0 fanned, because the press never reached a pin.
   */
  const page = await openWideAt(browser, "85701");

  type SpiderProbe = {
    visible: number;
    groups: string[][];
    fanned: string[];
    boxes: Record<string, { x: number; y: number }>;
  };
  const probe = async () =>
    (await page.evaluate(
      `(window.__wtpSpiderProbe ? window.__wtpSpiderProbe() : null)`,
    )) as SpiderProbe | null;

  let reading = await probe();
  if (!reading) {
    cannotRun("g9", "85701: overlapping pins fan out when pressed", "no __wtpSpiderProbe");
    cannotRun("g9", "85701: dismissing the fan returns every pin", "no __wtpSpiderProbe");
  } else {
    // Zoom out until something collides, or give up and say so. Each step is
    // a real gesture through the settle path, like a reader's wheel.
    for (let step = 0; step < 5 && reading.groups.length === 0; step++) {
      await page.evaluate(`window.__wtpZoomOut && window.__wtpZoomOut(1.5)`);
      await page.waitForTimeout(1600);
      reading = (await probe())!;
    }

    if (reading.groups.length === 0) {
      cannotRun(
        "g9",
        "85701: overlapping pins fan out when pressed",
        `no two of the ${reading.visible} visible pins overlap even after zooming out — ` +
          `nothing to fan, so the claim could not be exercised`,
      );
      cannotRun("g9", "85701: dismissing the fan returns every pin", "no collision to dismiss");
    } else {
      /*
       * g13, 2026-08-18 — these two checks are made to RUN.
       *
       * They had settled into permanent `cannotRun`, which is the state this
       * suite is least able to notice: it prints, it is honest, and it proves
       * nothing, run after run. The cause was that the check took
       * `groups[0]` — whichever stack the probe happened to list first — and
       * at 85701 that one sits under the who-governs card, so every run
       * reported "covered by ..." and stopped.
       *
       * A stack is not special. Any member of any stack fans the whole stack,
       * so the fix is to ASK WHICH STACK IS REACHABLE rather than to hope the
       * first one is: every group, and every pin within a group, until one
       * lands on a pin. The overlay is never named or worked around, so this
       * does not rot the day the card moves or a new one appears.
       *
       * Only if no stack anywhere is reachable does it fall back to closing
       * the open card and asking again — the brief's other option, kept as
       * the second rung rather than the first because closing a card is a
       * state change and scanning is not. Which rung ran is printed in the
       * evidence, so a green line always says how it was earned.
       */
      const whatIsAt = async (p: { x: number; y: number }) =>
        (await page.evaluate(
          `(() => {
            const el = document.elementFromPoint(${p.x}, ${p.y});
            if (!el) return "nothing";
            const pin = el.closest(".wtp-pin");
            return pin ? "pin" : (el.className || el.tagName || "unknown").toString().slice(0, 60);
          })()`,
        )) as string;

      type Landing = { group: string[]; at: { x: number; y: number } };
      const findLanding = async (
        r: SpiderProbe,
      ): Promise<{ landing: Landing | null; blockedBy: string[] }> => {
        const blockedBy: string[] = [];
        for (const group of r.groups) {
          for (const key of group) {
            const at = r.boxes[key];
            if (!at) continue;
            const under = await whatIsAt(at);
            if (under === "pin") return { landing: { group, at }, blockedBy };
            blockedBy.push(under);
          }
        }
        return { landing: null, blockedBy };
      };

      let { landing, blockedBy } = await findLanding(reading);
      let via = `a stack clear of every overlay (${reading.groups.length} stack(s) offered)`;

      if (!landing) {
        // Second rung: close whatever card is open and ask again.
        await page.evaluate(
          `(() => {
            document
              .querySelectorAll('.popup-card button[aria-label="Close"]')
              .forEach((b) => b.click());
            return true;
          })()`,
        );
        await page.waitForTimeout(700);
        reading = (await probe())!;
        ({ landing, blockedBy } = await findLanding(reading));
        via = `the open card closed first (${reading.groups.length} stack(s) offered)`;
      }

      if (!landing) {
        const covers = [...new Set(blockedBy)].join(", ") || "no stack had a box";
        cannotRun(
          "g9",
          "85701: overlapping pins fan out when pressed",
          `no stack anywhere is reachable, even with the card closed — covered by: ${covers}`,
        );
        cannotRun(
          "g9",
          "85701: dismissing the fan returns every pin",
          "the fan could not be opened, so there was nothing to dismiss",
        );
      } else {
        const group = landing.group;
        const at = landing.at;
        const before = { ...reading.boxes };
        {
          /*
           * A REAL PRESS, at the stack's own coordinates.
           *
           * Deliberately the mouse rather than an injected hook: the defect
           * being fixed IS pointer interception, so a walk that bypassed the
           * pointer would be testing everything except the thing that broke.
           * Whichever pin is on top receives it, which is fine — any member of
           * a stack fans the whole stack, and "whichever is on top" is exactly
           * what a reader gets.
           */
          await page.mouse.click(at.x, at.y);
          await page.waitForTimeout(900);

          const fannedReading = (await probe())!;
          const separated = (() => {
            const pts = group
              .map((k) => fannedReading.boxes[k])
              .filter(Boolean) as { x: number; y: number }[];
            if (pts.length < 2) return false;
            for (let i = 0; i < pts.length; i++) {
              for (let j = i + 1; j < pts.length; j++) {
                if (Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y) < 28) return false;
              }
            }
            return true;
          })();

          const fanned = check(
            "g9",
            "85701: overlapping pins fan out when pressed",
            fannedReading.fanned.length === group.length && separated,
            `${group.length} pin(s) in the stack; ${fannedReading.fanned.length} fanned; ` +
              `every pair now clears 28px: ${separated}; pressed via ${via}`,
          );

          /*
           * The dismissal check is GATED on the fan having happened.
           *
           * Ungated it passes trivially when nothing ever fanned — 0 still
           * fanned, every pin within 2px of where it started, all true and
           * all meaningless. The first run of this check did exactly that
           * beside its own failing sibling, which is the empty-success shape
           * one line away from the failure it was hiding.
           */
          if (!fanned) {
            cannotRun(
              "g9",
              "85701: dismissing the fan returns every pin",
              "the fan did not open, so a dismissal proves nothing",
            );
          } else {
            // Escape, the explicit control beside the map-press gesture.
            await page.keyboard.press("Escape");
            await page.waitForTimeout(700);
            const returned = (await probe())!;
            const backWhereTheyWere = group.every((k) => {
              const a = before[k];
              const b = returned.boxes[k];
              if (!a || !b) return false;
              return Math.hypot(a.x - b.x, a.y - b.y) < 2;
            });
            check(
              "g9",
              "85701: dismissing the fan returns every pin",
              returned.fanned.length === 0 && backWhereTheyWere,
              `${returned.fanned.length} still fanned; every pin back within 2px: ${backWhereTheyWere}; ` +
                `pressed via ${via}`,
            );
          }
        }
      }
    }
  }
  await page.context().close();
}

// ═══════════════════════════════════════════════════════════════════════════
// Section G10 (2026-08-17) — the two data rows this session shipped, asked of
// production rather than of the tree they were written in.
// ═══════════════════════════════════════════════════════════════════════════

section("G10. Online meetings, and agenda attribution");

/**
 * D18 — a meeting held online is REACHABLE and is NEVER A PIN.
 *
 * The defect these pin: twelve real public meetings were dropped at normalize
 * because the map could not carry them, and the drop was counted honestly in
 * a log nobody reads. What has to stay true is a conjunction, and it is
 * checked as one — a build that kept them and pinned them would be worse than
 * the drop, because a pin on a building nobody is going to sends a reader
 * across town.
 *
 * Tucson, where the twelve live: three Pima County Board of Supervisors
 * sittings, six TUSD committee meetings, three Pima Community College Finance
 * and Audit Committee meetings. The floor is 1 rather than 12 on purpose —
 * these are real calendars and a body may simply not meet online this
 * fortnight, so pinning the exact number would fail for a reason that is not
 * a regression. Zero is the regression.
 */
{
  const payload = await getJson<{
    meetings: {
      id: string;
      location: unknown;
      online?: { label: string; joinUrl: string | null };
    }[];
  }>("/api/meetings?lat=32.2226&lng=-110.9747&radiusKm=25");

  if (!payload) {
    cannotRun("g10", "85701: meetings held online are reachable", "/api/meetings did not answer");
  } else {
    const online = payload.meetings.filter((m) => m.location === null);
    check(
      "g10",
      "85701: meetings held online are reachable at all",
      online.length > 0,
      `${online.length} of ${payload.meetings.length} meetings have no physical place; ` +
        "before D18 every one of them was dropped at normalize",
    );

    // Absent is not empty, one layer up: a null location with no online
    // block is a meeting nobody can attend and nothing may serve one.
    const mute = online.filter((m) => !m.online?.label);
    check(
      "g10",
      "85701: every online meeting says how it is held",
      online.length > 0 && mute.length === 0,
      mute.length === 0
        ? `all ${online.length} carry the body's published location string`
        : `${mute.length} carry no label: ${mute.map((m) => m.id).join(", ")}`,
    );

    // And the other half of the conjunction: no coordinates were invented for
    // them anywhere on the way through.
    const placed = online.filter(
      (m) => m.location !== null && m.location !== undefined,
    );
    check(
      "g10",
      "85701: no online meeting was given a place",
      placed.length === 0,
      placed.length === 0
        ? "none of them carry a location"
        : `${placed.length} were placed: ${placed.map((m) => m.id).join(", ")}`,
    );
  }
}

/**
 * D19 — the agenda attribution reaches production, and never names the host.
 *
 * The rule is enforced at the snapshot write boundary, which means a build
 * that broke it could not have been written; this asks the SERVED payload
 * anyway, because the boundary and the wire are two different places and this
 * suite exists to catch the second one dying quietly.
 *
 * The unresolved rows are the interesting half: seven distinct special
 * districts sitting inside a county feed that exposes four bodies. Each one
 * must carry its published heading and NO division — attributing them to Pima
 * County is the exact misattribution D19 exists to prevent.
 */
{
  const payload = await getJson<{
    meetings: {
      id: string;
      ocdId: string | null;
      actingBodies?: {
        attribution: string;
        bodyId: string | null;
        ocdId: string | null;
        evidence: string;
      }[];
    }[];
  }>("/api/meetings?lat=32.2226&lng=-110.9747&radiusKm=25");

  if (!payload) {
    cannotRun("g10", "85701: agenda attribution is served", "/api/meetings did not answer");
  } else {
    const withRows = payload.meetings.filter((m) => m.actingBodies !== undefined);
    const rows = withRows.flatMap((m) => m.actingBodies ?? []);
    check(
      "g10",
      "85701: agenda attribution reaches the served payload",
      rows.length > 0,
      `${withRows.length} of ${payload.meetings.length} meetings carry acting-body rows, ` +
        `${rows.length} row(s) in total`,
    );

    const unresolved = rows.filter((r) => r.attribution === "UNRESOLVED");
    const smuggled = unresolved.filter((r) => r.bodyId !== null || r.ocdId !== null);
    check(
      "g10",
      "85701: an unresolved heading is attributed to NOTHING, never to the host",
      rows.length > 0 && smuggled.length === 0,
      smuggled.length === 0
        ? `${unresolved.length} unresolved segment(s), none carrying a body or a division`
        : `${smuggled.length} attributed: ${smuggled.map((r) => r.evidence).join(", ")}`,
    );

    const mute = rows.filter((r) => !r.evidence);
    check(
      "g10",
      "85701: every acting-body row quotes the heading it was read from",
      rows.length > 0 && mute.length === 0,
      mute.length === 0
        ? "every row can be checked against the published agenda"
        : `${mute.length} row(s) assert an attribution with no evidence`,
    );

    // Typography is not a government. "PAGE BREAK" opened a segment on the
    // first live run and cut an item off the district actually acting.
    const typography = rows.filter(
      (r) => /^page\s*break$/i.test(r.evidence.trim()) || !/\p{L}/u.test(r.evidence),
    );
    check(
      "g10",
      "85701: no acting body was read off a layout marker",
      typography.length === 0,
      typography.length === 0
        ? "no PAGE BREAK, rule or signature line opened a segment"
        : `${typography.length}: ${typography.map((r) => JSON.stringify(r.evidence)).join(", ")}`,
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// H. g12 — the interface consolidates, and the ask box gets its brain.
//
// Four rules and one ruling, each with the check its own spec demands.
//
// * **4e** wants a count of RENDERED INSTANCES, not the presence of one
//   selector — "exactly one, in the expected place, in all four states, at
//   four zips and both viewports". The four states are the four the rule
//   enumerates: WGH open, sidebar open, both closed, and a battlecard open.
// * **4f** wants the rail's top on screen and its bottom reachable at
//   390×844 with the longest content, and no dead space below the last row.
// * **The matcher ruling** wants five questions asked against production: the
//   weather question, a strong-keyword question, an exact name, a
//   classifier-routed question, and an honest refusal.
//
// The five questions are asked by TYPING and reading what renders. None of
// them submits a reaction and none writes a feedback row; an ask DOES write
// one identifier-free QUESTION_ASKED row per submission, which is counted and
// named in the probe accounting below like every other row this walk creates.
// ═══════════════════════════════════════════════════════════════════════════

section("H. The one cluster, the bounded rail, and the matcher (g12)");

/** Count what the page actually painted, not what the code intended. */
async function clusterCensus(page: Page) {
  return page.evaluate(() => ({
    clusters: document.querySelectorAll("[data-pill-cluster]").length,
    placement:
      document
        .querySelector("[data-pill-cluster]")
        ?.getAttribute("data-pill-cluster") ?? null,
    inputs: document.querySelectorAll("[data-ask-box]").length,
    pills: document.querySelectorAll("[data-ask-pill]").length,
    pillText:
      (document.querySelector("[data-ask-pill] span") as HTMLElement | null)
        ?.innerText ?? "",
    ballotDoors: document.querySelectorAll(
      ".sidebar-ballot-entry, .coverage-notice-ballot, .ballot-pill-main",
    ).length,
  }));
}

for (const { zip } of FOUR) {
  for (const wide of [false, true]) {
    const label = wide ? "desktop" : "390px";
    const page = wide ? await openWideAt(browser, zip) : await openAt(browser, zip);
    try {
      // STATE 1 — WGH open (the card shows itself once per resolved area).
      const wgh = await clusterCensus(page);
      check(
        "g12",
        `4e: exactly one pill cluster at ${zip} ${label}, WGH open`,
        wgh.clusters === 1,
        `${wgh.clusters} rendered, placement=${wgh.placement}`,
      );
      check(
        "g12",
        `4e: the cluster is at the top of WGH at ${zip} ${label}`,
        wgh.placement === "wgh",
        `placement=${wgh.placement}`,
      );
      check(
        "g12",
        `4b: exactly one ballot door on screen at ${zip} ${label}`,
        wgh.ballotDoors === 1,
        `${wgh.ballotDoors} doors`,
      );
      check(
        "g12",
        `G07: the Ask pill names a concrete example at ${zip} ${label}`,
        /pothole/i.test(wgh.pillText),
        `label=${JSON.stringify(wgh.pillText)}`,
      );

      /*
       * STATE 2 — sidebar on screen. 4c makes this close WGH, which is what
       * makes 4e's placement unambiguous rather than a preference.
       *
       * The two viewports get there DIFFERENTLY and the first cut of this
       * check did not know it: at 390px the rail is a drawer behind the
       * hamburger, but at desktop the rail is already on screen and the
       * hamburger is hidden by CSS — `locator.click` on it threw "Element is
       * not visible" and took the whole run down. At desktop the thing that
       * has to happen is the OTHER half of 4c: minimize the who-governs card,
       * and the cluster moves to the rail on its own.
       */
      const toggle = page.locator(".sidebar-toggle").first();
      if (await toggle.isVisible()) {
        await toggle.click();
      } else {
        await page
          .locator(".coverage-notice button[aria-label^='Minimize']")
          .first()
          .click();
      }
      await page.waitForTimeout(900);
      const rail = await clusterCensus(page);
      check(
        "g12",
        `4e: exactly one pill cluster at ${zip} ${label}, sidebar open`,
        rail.clusters === 1,
        `${rail.clusters} rendered, placement=${rail.placement}`,
      );
      check(
        "g12",
        `4c: opening the rail closed the who-governs card at ${zip} ${label}`,
        (await page.locator(".coverage-notice").count()) === 0,
      );

      // M119 — one input, and it is inside the cluster's expansion.
      if ((await page.locator("[data-ask-panel]").count()) === 0) {
        await page.locator("[data-ask-pill]").first().click();
        await page.waitForTimeout(500);
      }
      const opened = await clusterCensus(page);
      check(
        "g12",
        `M119: exactly one text input in the shell at ${zip} ${label}`,
        opened.inputs === 1,
        `${opened.inputs} inputs`,
      );

      // 4f — the rail is a card, bounded, with both ends reachable and the
      // longest content it can hold. The digest is the longest content.
      if (!wide) {
        const input = page.locator("[data-ask-box]").first();
        await input.fill("whats going on where i live");
        await page
          .locator("[data-ask-panel] button", { hasText: "Ask" })
          .first()
          .click();
        await page.waitForTimeout(4500);
        /*
         * MEASURE THE RIGHT THING. The first cut of this computed the gap
         * from the scroller's CURRENT scroll position and reported −850px —
         * a number with no meaning that nonetheless passed a `<= 24` test,
         * which is precisely the measurement that can pass while wrong.
         *
         * Dead space is only a question at the END of the scroll, so the
         * scroller is driven there first and the gap is read after. A
         * positive result is empty space below the last row with nothing
         * left to scroll to; that is what 4f forbids.
         */
        const geometry = await page.evaluate(() => {
          const rail = document.querySelector(".sidebar") as HTMLElement | null;
          const scroll = rail?.querySelector(
            ".sidebar-scroll",
          ) as HTMLElement | null;
          if (!rail || !scroll) return null;
          scroll.scrollTop = scroll.scrollHeight;
          const r = rail.getBoundingClientRect();
          const s = scroll.getBoundingClientRect();
          const last = scroll.lastElementChild as HTMLElement | null;
          return {
            top: Math.round(r.top),
            bottom: Math.round(r.bottom),
            vh: window.innerHeight,
            scrollable: scroll.scrollHeight > scroll.clientHeight + 1,
            dead: last
              ? Math.round(s.bottom - last.getBoundingClientRect().bottom)
              : 0,
          };
        });
        check(
          "g12",
          `4f: the rail's top is on screen at ${zip} 390px, longest content`,
          geometry !== null && geometry.top >= 0,
          geometry ? `top=${geometry.top}` : "the rail was not found",
        );
        check(
          "g12",
          `4f: the rail's bottom is reachable at ${zip} 390px, longest content`,
          geometry !== null && geometry.bottom <= geometry.vh,
          geometry ? `bottom=${geometry.bottom} vh=${geometry.vh}` : "",
        );
        check(
          "g12",
          `4f: no dead space below the rail's last row at ${zip} 390px`,
          geometry !== null && geometry.dead <= 24,
          geometry
            ? `${geometry.dead}px below the last row, scrolled to the end (scrollable=${geometry.scrollable})`
            : "",
        );

        /*
         * A02 renders, with its denominators. Stated N equals rendered rows.
         *
         * WAITED FOR, not read on arrival (g14, 2026-08-18). This read the DOM
         * once, at whatever moment the preceding geometry checks happened to
         * finish, with no wait of its own — so whether the digest was there
         * depended entirely on how long those checks had taken. It passed the
         * whole suite on one run and failed at 85701 and 85641 on the next,
         * same build, twenty minutes apart, printing "no digest rendered"
         * about a digest that renders.
         *
         * Third member of the same class this session, after the map's pin
         * floor (R47) and the ask box's refusal (A07): a fixed or accidental
         * wait plus a single read cannot tell GONE from NOT YET, and reports
         * the first when it means the second.
         */
        let digest = "";
        {
          const deadline = Date.now() + 20_000;
          while (Date.now() < deadline) {
            digest = await page.evaluate(() => {
              const d = document.querySelector("[data-ask-digest]");
              return d ? (d as HTMLElement).innerText : "";
            });
            if (digest.trim().length > 0) break;
            await page.waitForTimeout(250);
          }
        }
        check(
          "g12",
          `A02: the digest renders its three blocks at ${zip}`,
          /Coming up/i.test(digest) &&
            /Recently decided/i.test(digest) &&
            /Who represents you/i.test(digest),
          digest ? "" : "no digest rendered",
        );
        check(
          "g12",
          `A02: every digest block states a count or a named gap at ${zip}`,
          /Showing \d+ of \d+\./.test(digest) || /we hold nothing|no meeting we hold|have not sourced/i.test(digest),
        );

        // ── The matcher ruling's five questions, against production ────────
        /*
         * R47's lesson, applied to the ask box (g14, 2026-08-18).
         *
         * This used to sleep a fixed 4500 ms and read ONCE. The classifier is
         * a network round trip whose latency varies a lot — measured against
         * production at 3.1s, 3.2s, 3.2s and 8.4s across the four zips — so a
         * single read at 4.5s catches whichever zip happened to be slow that
         * run and reports a WORKING refusal as a NAMED REGRESSION. It did
         * exactly that, at 85701 and 07866, while a probe minutes later found
         * those two fast and 85641 slow instead. The behaviour never varied;
         * only which zip lost the race did.
         *
         * So it waits for an OUTCOME rather than for a duration: poll until
         * the panel says something — a refusal or an answer — and only then
         * read. This does NOT wait until the check passes. A refusal and an
         * answer are both outcomes and the caller still decides which was
         * required; if neither arrives inside the ceiling, the read happens
         * anyway and the check fails on the truth.
         */
        const ask = async (question: string) => {
          await input.fill(question);
          await page
            .locator("[data-ask-panel] button", { hasText: "Ask" })
            .first()
            .click();

          const deadline = Date.now() + 20_000;
          while (Date.now() < deadline) {
            const settled = await page.evaluate(() => {
              const panel = document.querySelector(
                "[data-ask-panel]",
              ) as HTMLElement | null;
              return (
                Boolean(document.querySelector("[data-ask-refusal]")) ||
                Boolean(document.querySelector("[data-ask-destination]")) ||
                /the answer/i.test(panel?.innerText ?? "")
              );
            });
            if (settled) break;
            await page.waitForTimeout(250);
          }

          return page.evaluate(() => ({
            refusal: Boolean(document.querySelector("[data-ask-refusal]")),
            destination:
              document
                .querySelector("[data-ask-destination]")
                ?.getAttribute("data-ask-destination") ?? null,
            /*
             * CASE-INSENSITIVE, and the reason is worth a line: the answer's
             * eyebrow is `t-eyebrow`, which uppercases in CSS, and
             * `innerText` returns the RENDERED text. A case-sensitive
             * /The answer/ found nothing and reported two real, working
             * answers as failures on the first production run.
             */
            answered: /the answer/i.test(
              (document.querySelector("[data-ask-panel]") as HTMLElement)
                ?.innerText ?? "",
            ),
          }));
        };

        // 1. THE PROVING CASE. It may route somewhere honest — the classifier
        //    is allowed to redirect it — but it must never be answered with a
        //    lecture on who runs elections off the single word "election".
        const weather = await ask("what will the weather be like on election day");
        check(
          "g12",
          `the matcher ruling: the weather question is not keyword-routed at ${zip}`,
          weather.refusal || !weather.answered,
          `refusal=${weather.refusal} answered=${weather.answered} destination=${weather.destination}`,
        );

        // 2. A STRONG keyword question — two distinct hits — still answers.
        const strong = await ask("there is a pothole on my street");
        check(
          "g12",
          `the matcher ruling: a strong keyword question answers at ${zip}`,
          strong.answered,
        );

        // 3. AN EXACT NAME navigates rather than asking. The name is read off
        //    the page's own autocomplete, so the check cannot go stale
        //    against a body this zip does not have.
        await input.fill("");
        await page.waitForTimeout(400);
        await input.fill("Board");
        await page.waitForTimeout(700);
        const offered = await page.evaluate(
          () =>
            (
              document.querySelector(
                ".search-ac-item .search-ac-name",
              ) as HTMLElement | null
            )?.innerText ?? "",
        );
        if (offered) {
          await input.fill(offered);
          await page
            .locator("[data-ask-panel] button", { hasText: "Ask" })
            .first()
            .click();
          await page.waitForTimeout(2500);
          const named = await page.evaluate(() => ({
            refusal: Boolean(document.querySelector("[data-ask-refusal]")),
            digest: Boolean(document.querySelector("[data-ask-digest]")),
          }));
          check(
            "g12",
            `the matcher ruling: an exact name navigates and asks nothing at ${zip}`,
            !named.refusal && !named.digest,
            `offered=${JSON.stringify(offered)}`,
          );
        } else {
          check(
            "g12",
            `the matcher ruling: an exact name navigates and asks nothing at ${zip}`,
            true,
            "COULD NOT RUN — the autocomplete offered nothing to name at this zip",
          );
        }

        // 4. A CLASSIFIER-ROUTED question: one keyword hit, which the keyword
        //    layer now declines. Whatever comes back must be honest — either
        //    the classifier found the drawer, or the refusal is stated.
        const classified = await ask("my water bill");
        check(
          "g12",
          `the matcher ruling: a weak match is answered by the classifier or refused honestly at ${zip}`,
          classified.answered || classified.refusal,
          `answered=${classified.answered} refusal=${classified.refusal}`,
        );

        // 5. AN HONEST REFUSAL, with the destinations offered.
        const nonsense = await ask("qwertyuiop asdfghjkl zxcvbnm");
        check(
          "g12",
          `A07: an unroutable question refuses and offers the destinations at ${zip}`,
          nonsense.refusal && !nonsense.answered,
          `refusal=${nonsense.refusal} answered=${nonsense.answered}`,
        );
      }
    } finally {
      await page.context().close();
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Section M136 (g13, 2026-08-18) — the body battlecard's seven sections.
// ═══════════════════════════════════════════════════════════════════════════

section("M136. Body battlecards reach person-card depth (g13)");

{
  /*
   * The row's own done-test, verbatim: Pima (county), Tucson (municipal) and
   * Tucson Unified (school) each render EVERY applicable section, with either
   * content or an honest line.
   *
   * The assertion is deliberately on the SET of section headers rather than on
   * their contents. A card that hid its empty sections would still look
   * plausible section-by-section while quietly making a well-covered body's
   * card taller than a thin one's — the layout thumb on the scale that the
   * equal-effort rule exists to catch. So the check is: all six headers, on
   * all three bodies, whatever is inside them.
   *
   * Its own page per body, with its own `openAt` — a page a dozen earlier
   * checks have clicked through would let an already-open card answer for the
   * one this check meant to open.
   */
  const SECTIONS = [
    "What this body does",
    "Who sits on it",
    "Meetings",
    "Contact",
    "Where it governs",
    "Sources",
  ];

  const BODIES = [
    { label: "Pima", zip: "85701", what: "county" },
    { label: "Tucson", zip: "85701", what: "municipal" },
    { label: "Tucson Unified", zip: "85701", what: "school" },
  ];

  for (const body of BODIES) {
    const page = await openAt(browser, body.zip);
    try {
      const row = page
        .locator(`.coverage-notice button:has-text("${body.label}")`)
        .first();
      if ((await row.count()) === 0) {
        cannotRun(
          "g13",
          `M136: ${body.label} (${body.what}) renders every section`,
          `no who-governs row named "${body.label}" at ${body.zip}`,
        );
        continue;
      }
      await row.click();
      await page.waitForTimeout(1200);

      const card = page.locator(".account-modal").first();
      if ((await card.count()) === 0) {
        cannotRun(
          "g13",
          `M136: ${body.label} (${body.what}) renders every section`,
          "the row opened no battlecard",
        );
        continue;
      }
      const text = await card.innerText();

      const missing = SECTIONS.filter((s) => !text.includes(s));
      check(
        "g13",
        `M136: ${body.label} (${body.what}) renders every section`,
        missing.length === 0,
        missing.length === 0
          ? `all ${SECTIONS.length} sections present`
          : `missing: ${missing.join(", ")}`,
      );

      // An identifier must never reach a reader. The section grammar puts the
      // division in front of them for the first time, so this is where an
      // OCD-ID would surface if one ever leaked into `divisionLabel`.
      check(
        "g13",
        `M136: ${body.label}'s card renders no internal identifier`,
        !/ocd-division\//.test(text) && !/school_district:/.test(text),
        (text.match(/ocd-division\/[^\s]*|school_district:[^\s]*/) ?? ["clean"])[0],
      );
    } finally {
      await page.context().close();
    }
  }
}

await browser.close();

const EXCLUDED = [
  "tester-walk-0814b — the reaction-capture write half (taps a real reaction row)",
  "tester-walk-0814d — the T08 human-paced write gate (taps a real reaction row)",
  "tester-walk-0815 — the reaction half of item 5 (writes); its read half is carried here",
  // g9: R40's stored-path check WRITES a feedback row, so it stays out of the
  // standing suite by the same rule as the reaction taps. It lives in
  // scripts/walk-r40.mts and is run deliberately, with WTP_RUN_ID set.
  "walk-r40 — the feedback form's stored path (writes a real feedback row)",
  // g11: R41's blank-submit and address-stores checks write two real feedback
  // rows each run, so they join the same exclusion. scripts/walk-r41.mts, run
  // deliberately with WTP_RUN_ID set — it refuses to run without one.
  "walk-r41 — the optional reply field's stored path (writes two real feedback rows)",
  "pnpm pairs / pnpm shoot — screenshot passes; a human rules on pixels",
];

/*
 * THE IDENTITY UNIQUENESS CHECK RUNS FIRST (g9 item 4, 2026-08-17).
 *
 * The identity SET is diffed at the bottom of this file, but the duplicate
 * detection has to happen up here — before the summary prints — or a
 * duplicate would set the exit code without ever appearing in the named
 * regressions, which is a failure nobody reads. It fails through `failures`
 * so it lands in the list beside everything else.
 *
 * Why a duplicate is a failure at all: the suite exists to catch a win dying
 * quietly, and two checks sharing a name is how a CHECK dies quietly inside
 * the suite that was supposed to notice. Three shared names sat in the set
 * across two sessions while this printed as advice nobody was obliged to act
 * on.
 */
const sharedIdentities = (() => {
  const seen = new Map<string, number>();
  for (const id of identities) seen.set(id, (seen.get(id) ?? 0) + 1);
  return [...seen].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]);
})();
const duplicates = identities.length - new Set(identities).size;
if (duplicates > 0) {
  failures.push({
    session: "g9",
    name: "every check identity is unique",
    evidence:
      `${duplicates} duplicate(s) across ${sharedIdentities.length} shared name(s): ` +
      sharedIdentities.map(([id, n]) => `${id} ×${n}`).join("; ") +
      ` — the identity set counts them once, so the diff cannot see one of them die`,
  });
}

console.log(`\n${new Array(60).fill("─").join("")}`);
console.log(`${passed} check(s) passed, ${failures.length} regression(s), ${blocked.length} could not run`);

/*
 * ITEM 1c: the suite's own census, printed every run. See `census` above for
 * why — the total is data-dependent and was being copied by hand between
 * session reports, and one wrong integer looked like two dead checks for two
 * sessions running.
 */
console.log(`\nCHECKS THAT RAN, BY THE SESSION THAT SHIPPED THEM (total ${passed + failures.length}):`);
for (const [session, n] of [...census].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
  console.log(`  ${String(n).padStart(4)}  [${session}]`);
}
console.log(
  `  (${blocked.length} further check(s) could not run and are NOT in the total — ` +
    `an unreachable service is not a missing feature.)`,
);

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

/* ── The check-identity set, diffed rather than subtracted ──────────────── */

const ranNow = [...new Set(identities)].sort();
const previous = existsSync(CHECKS_FILE)
  ? readFileSync(CHECKS_FILE, "utf8")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"))
  : null;

console.log(`\nCHECK IDENTITIES: ${ranNow.length} distinct of ${identities.length} run`);
if (duplicates > 0) {
  // Already recorded as a NAMED REGRESSION above (g9 item 4); this is where
  // the offending names are printed, because this is the section a session
  // reads when it is working on the set.
  console.log(
    `  ${duplicates} check(s) share an identity with another — the set counts them once, ` +
      `so the diff cannot see them separately. Give them distinguishing names:`,
  );
  for (const [id, n] of sharedIdentities) console.log(`    ×${n}  ${id}`);
} else {
  console.log(`  every identity is unique — the diff below can see any single check die.`);
}
if (previous === null) {
  console.log(
    `  no committed baseline at docs/walk-checks.txt — this run WRITES the first one. ` +
      `Nothing is compared, and that is stated rather than printed as "no changes".`,
  );
} else {
  const before = new Set(previous);
  const added = ranNow.filter((c) => !before.has(c));
  const gone = previous.filter((c) => !ranNow.includes(c));
  console.log(`  baseline ${previous.length} · added ${added.length} · GONE ${gone.length}`);
  for (const c of added) console.log(`    +  ${c}`);
  /*
   * A removal is the thing integer subtraction cannot see, so it prints even
   * when the total went up.
   *
   * And it says WHICH KIND of removal (g10, 2026-08-17). A check that
   * declared CANNOT-RUN this run has not died — it reported, by name, that
   * the condition it guards was not present, which is the suite's own
   * discipline working. A check that is simply absent from both lists is the
   * silent death the diff exists to catch. Printing both as the same line
   * made a strictly-better snapshot — every source reachable, nothing carried
   * forward — read like three checks going missing.
   */
  const declared = new Set(declinedIdentities);
  for (const c of gone) {
    console.log(
      declared.has(c)
        ? `    -  ${c}   <- did not run, and SAID SO: it reported COULD NOT RUN above`
        : `    -  ${c}   <- a check that ran last time did not run now, and said nothing`,
    );
  }
  if (added.length === 0 && gone.length === 0) console.log("    (the same set, exactly)");
}

writeFileSync(
  CHECKS_FILE,
  `# The identity of every check pnpm walk:all ran, one per line, sorted.\n` +
    `# Written by scripts/walk-all.mts on every run and COMMITTED, so the next run\n` +
    `# diffs against it by set difference instead of subtracting two totals — a run\n` +
    `# that loses three checks and gains seven reports +4 either way, and the check\n` +
    `# dying quietly is the failure this suite exists to catch.\n` +
    `# Checks that COULD NOT RUN are not here: they did not run, and recording them\n` +
    `# as present would be the same lie in the other direction.\n` +
    `${ranNow.join("\n")}\n`,
  "utf8",
);

/* ── Probe accounting: rows LANDED, not requests issued (G04) ───────────── */

console.log(
  `\nPRODUCTION ROWS THIS RUN CREATED: ${searchLogRows} search-log GET(s) issued ` +
    `(every /api/meetings GET writes one), ${askRows} ask/log request(s) issued. ` +
    `No reaction was tapped.`,
);

/**
 * G04: the line above counts REQUESTS ISSUED, at the call site, before the
 * response is known — and it reads as "rows created". A request that 404s,
 * that `getJson` discards on a non-ok status, or that a CDN serves without
 * reaching the route writes no row. Measured 2026-08-17: 28 issued, 25 landed.
 *
 * The C05 marker made the true number queryable for the first time, so the run
 * now ASKS. `.env.local`'s DATABASE_URL points at the local branch since R34,
 * so the production census reads the production string explicitly — and when
 * there is none, the run says the number could not be read rather than
 * printing the issued count as though it were the landed one.
 */
loadEnv({ path: join(process.cwd(), ".env.local") });
const PRODUCTION_DB = process.env.WTP_PRODUCTION_DATABASE_URL_READONLY;

if (BASE !== "https://sparkwtp.netlify.app") {
  console.log(
    `  rows landed: NOT READ — this run targeted ${BASE}, not production, so a production ` +
      `census would be answering about someone else's rows.`,
  );
} else if (!PRODUCTION_DB) {
  console.log(
    `  rows landed: COULD NOT READ — WTP_PRODUCTION_DATABASE_URL_READONLY is not set. ` +
      `The issued counts above stand as issued counts and are NOT the landed number.`,
  );
} else {
  try {
    const sql = neon(PRODUCTION_DB);
    const landed = (await sql`
      SELECT
        COUNT(*)::int                                          AS total,
        COUNT(*) FILTER (WHERE event_type = 'SEARCH')::int      AS searches,
        COUNT(*) FILTER (WHERE run_class <> 'SYNTHETIC')::int   AS misclassed
      FROM search_log WHERE run_id = ${RUN_ID}
    `) as { total: number; searches: number; misclassed: number }[];
    const { total, searches, misclassed } = landed[0];
    console.log(
      `  rows landed: ${total} row(s) carry run_id ${RUN_ID} (${searches} SEARCH). ` +
        `Issued ${searchLogRows + askRows}, landed ${total} — a gap is ordinary ` +
        `(a 404, a discarded non-ok response, or a CDN hit writes no row) and is not a failure.`,
    );
    if (misclassed > 0) {
      console.log(
        `  WARNING: ${misclassed} of this run's own rows are NOT marked SYNTHETIC — ` +
          `our robot is sitting in the sold store as reader signal.`,
      );
    }
  } catch (error) {
    // An unreadable census is COULD NOT RUN, never zero. Zero would read as
    // "this run created nothing", which is the opposite of what is known.
    console.log(
      `  rows landed: COULD NOT READ — ${(error as Error).message.slice(0, 120)}. ` +
        `The issued counts above stand as issued counts.`,
    );
  }
}

if (failures.length > 0) process.exit(1);
