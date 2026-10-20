/**
 * `pnpm walk:all` — the regression net.
 *
 *   pnpm build && pnpm start   # in another shell — the local production build
 *   pnpm walk:all              # against http://localhost:3000, or SHOOT_BASE_URL
 *
 * Every check is a claim the product shipped, tagged with the session label it
 * prints under. Checks that tap a reaction or submit an ask are excluded
 * (`EXCLUDED` at the bottom prints the list), because they would write reader
 * signal. Every `/api/meetings` GET writes a search-log row; the walk counts
 * and prints them.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { neon } from "@neondatabase/serverless";
import { config as loadEnv } from "dotenv";
import { type Page } from "playwright";

import { makeRunId, syntheticRunHeaders } from "../lib/db/run-marker.ts";
import { today as phoenixDay } from "./doc-dates.mjs";
import { PRODUCT_NAME } from "../lib/brand.ts";
import { ASK_PILL_EXAMPLES } from "../lib/routing/ask-pill-labels.ts";
import { mojibakePattern } from "../lib/text/mojibake.ts";
/* Frame statistics come from the same module `pnpm measure:flyin` uses. */
import {
  busyPct,
  cpuTicks,
  frameGaps,
  GPU_ARGS,
  hostCondition,
  isSoftwareRenderer,
  judgeNormalized,
  judgeSoftware,
  LONG_FRAME_MS,
  NORMALIZED_FLOOR,
  READ_RENDERER,
  SOFTWARE_JANK_CEILING,
  SOFTWARE_NORMALIZED_FLOOR,
  summariseArm,
  type ArmSummary,
} from "../lib/ops/flyin-normalized.ts";
import { decodePng, patchStats, regionChange } from "./png.mts";
import { launchGuarded, type GuardedBrowser } from "./browser.mts";

import { PUBLIC_SITE_ORIGIN } from "../lib/ops/origins.ts";
import { publishedPlaces } from "../lib/ops/post-deploy-warm.ts";

const DEFAULT_BASE = "http://localhost:3000";
const BASE = (process.env.SHOOT_BASE_URL ?? DEFAULT_BASE).replace(/\/$/, "");

try {
  new URL(BASE);
} catch {
  console.error(`walk:all · SHOOT_BASE_URL is not a URL: ${BASE}`);
  process.exit(1);
}

/** Coordinates the pinned regressions below were recorded at; per-ZIP walks run at the places the server publishes. */
const ZIPS = {
  tucson: { zip: "85701", lat: 32.21696, lng: -110.971 },
  vail: { zip: "85641", lat: 32.04903, lng: -110.62291 },
  rockaway: { zip: "07866", lat: 40.95499, lng: -74.48801 },
  newbury: { zip: "03255", lat: 43.31403, lng: -72.02455 },
} as const;
const WALK_PLACES = (await publishedPlaces(BASE, fetch, 15_000).catch(() => [])).map(({ zip }) => ({ zip }));
if (WALK_PLACES.length === 0) {
  console.error(`walk:all · ${BASE} publishes no place (/api/reader/places); there is nothing to walk`);
  process.exit(1);
}

const PHONE = { width: 390, height: 844 };

// ── The ledger ─────────────────────────────────────────────────────────────

interface Failure {
  session: string;
  name: string;
  evidence: string;
}

const failures: Failure[] = [];
let passed = 0;

/** Every check that ran, counted by session label; the count is data-dependent, so the suite prints its own census. */
const census = new Map<string, number>();

/**
 * Every check that ran, by identity. The run diffs this set against the
 * committed `docs/walk-checks.txt`, so a check that disappears is named even
 * when the total went up. Names never carry a measured value.
 */
const identities: string[] = [];
const CHECKS_FILE = join(process.cwd(), "docs", "walk-checks.txt");

/** One assertion, labelled with the session that shipped the claim. */
/**
 * Per-check wall time: from the end of the previous check to this one, so the
 * page load, zip seed and wait are attributed to the check that needed them.
 */
interface CheckDuration {
  readonly identity: string;
  readonly ms: number;
  outcome: "PASS" | "FAIL";
}
const durations: CheckDuration[] = [];
let lastCheckEndedAt = Date.now();
function recordCheckDuration(identity: string): CheckDuration {
  const now = Date.now();
  const row: CheckDuration = { identity, ms: now - lastCheckEndedAt, outcome: "PASS" };
  durations.push(row);
  lastCheckEndedAt = now;
  return row;
}


function check(session: string, name: string, ok: boolean, evidence = ""): boolean {
  census.set(session, (census.get(session) ?? 0) + 1);
  const identity = `[${session}] ${name}`;
  identities.push(identity);
  const durationRow = recordCheckDuration(identity);

  const outcome = ok ? "PASS" : "FAIL";
  durationRow.outcome = outcome;
  if (ok) passed += 1;
  else failures.push({ session, name, evidence });

  const mark = ok ? "ok  " : "FAIL";
  console.log(`  ${mark} ${elapsed()} ${identity}${evidence ? ` — ${evidence}` : ""}`);
  return ok;
}

/* Every line carries elapsed time, and a heartbeat fires when one check runs long, so slow is distinguishable from stopped. */
const STARTED_AT = Date.now();
function elapsed(): string {
  const s = Math.round((Date.now() - STARTED_AT) / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

const HEARTBEAT_MS = 30_000;
let lastLineAt = Date.now();
const heartbeat = setInterval(() => {
  const quiet = Math.round((Date.now() - lastLineAt) / 1000);
  if (quiet * 1000 >= HEARTBEAT_MS) {
    console.log(
      `  ..  ${elapsed()} still working — ${quiet}s since the last check ` +
        `(${passed} passed, ${failures.length} failed, ${blocked.length} could not run so far)`,
    );
  }
}, HEARTBEAT_MS);
heartbeat.unref();

const rawLog = console.log.bind(console);
console.log = ((...args: unknown[]) => {
  lastLineAt = Date.now();
  rawLog(...(args as []));
}) as typeof console.log;

/** A check that could not RUN is not a check that failed; it is recorded separately with what blocked it. */
const blocked: string[] = [];
/** Every identity that declared it could not run, kept apart because names and reasons both contain em-dashes. */
const declinedIdentities: string[] = [];

function cannotRun(session: string, name: string, why: string): void {
  blocked.push(`[${session}] ${name} — ${why}`);
  declinedIdentities.push(`[${session}] ${name}`);
  console.log(`  ??  [${session}] ${name} — COULD NOT RUN: ${why}`);
}

function section(title: string): void {
  console.log(`\n${title}`);
}

/* ── Wait for an outcome, never for a duration ──────────────────────────── */

/**
 * Poll until `settled()` is true, and return whether it ever was. A false
 * return never short-circuits an assertion: the caller reads anyway and the
 * check fails on the truth, so a slow surface is not reported as gone.
 */
/** Every wait that ran out, by label, printed at the end of the run. */
const waitTimeouts: { label: string; ms: number }[] = [];

async function until(
  page: Page,
  settled: () => Promise<boolean>,
  ms = 15_000,
  step = 150,
  label = "until",
): Promise<boolean> {
  const deadline = Date.now() + ms;
  for (;;) {
    try {
      if (await settled()) return true;
    } catch {
      // A detached element or a navigation mid-poll is a NOT YET, not an answer.
    }
    if (Date.now() >= deadline) {
      waitTimeouts.push({ label, ms });
      return false;
    }
    await page.waitForTimeout(step);
  }
}

/** `until` for a selector existing, which is most of what this suite waits on. */
async function untilPresent(page: Page, selector: string, ms = 15_000): Promise<boolean> {
  /* The selector is the label, so a timeout names the thing that never appeared. */
  return until(page, async () => (await page.locator(selector).count()) > 0, ms, 150, selector);
}

/** `until` for a subtree that has stopped changing: two consecutive identical markup lengths, `quietMs` apart. */
async function untilSettled(
  page: Page,
  selector: string,
  quietMs = 400,
  ms = 15_000,
): Promise<boolean> {
  const started = Date.now();
  let last = -1;
  while (Date.now() - started < ms) {
    const size = (await page.evaluate(
      `(() => { const el = document.querySelector(${JSON.stringify(selector)}); return el ? el.innerHTML.length : -1; })()`,
    )) as number;
    if (size >= 0 && size === last) return true;
    last = size;
    /* The poll interval of an event-driven check, not a fixed wait. */
    await new Promise<void>((resolve) => setTimeout(resolve, quietMs));
  }
  return false;
}

/** `until` for the page's text containing something. */
async function untilText(page: Page, re: RegExp, ms = 15_000): Promise<boolean> {
  return until(page, async () => re.test(await page.evaluate("document.body.innerText")), ms);
}

/**
 * `until` for an element being present AND hydrated: server-rendered markup is
 * not a handler, so a click before React wires it does nothing. React's fiber
 * and props on the DOM node are the signal.
 */
/** The pick box's own choices; the hydration gate and the click must address the same element. */
const PICK_CHOICE = '.reaction-box[data-kind="pick"] .reaction-choice';

async function untilInteractive(page: Page, selector: string, ms = 15_000): Promise<boolean> {
  const expr = `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    return Object.keys(el).some(
      (k) => k.startsWith("__reactFiber$") || k.startsWith("__reactProps$"),
    );
  })()`;
  return until(page, async () => Boolean(await page.evaluate(expr)), ms);
}

/**
 * The app has finished arriving at a seeded zip: the state focus layer, the
 * who-governs card and a meetings count have all rendered (a bare canvas
 * appears long before the division resolve returns), then a short quiescence.
 * The 20s ceiling is a wall, not a target. The result is returned and used.
 */
async function appSettled(page: Page, ms = 20_000): Promise<boolean> {
  const ready = await until(
    page,
    async () =>
      (await page.locator(".state-focus-layer").count()) > 0 &&
      Boolean(
        await page.evaluate(
          /* Escape-free on purpose: a backslash class inside an `evaluate` template can be silently eaten. */
          `(function () {
            var t = document.body.innerText || "";
            if (t.indexOf("Who governs here") === -1) return false;
            var i = t.indexOf("meetings");
            if (i === -1) return false;
            return /[0-9]/.test(t.slice(Math.max(0, i - 12), i));
          })()`,
        ),
      ),
    ms,
  );
  if (!ready) return false;
  /* Two identical text-length readings 400ms apart, bounded so a page that keeps animating cannot extend the wait. */
  await untilSettled(page, "body", 400, 4_000);
  return true;
}

// ── Probe accounting, and the run's own identity ───────────────────────────

/**
 * This run declares itself in a header, so the rows it creates in the search
 * log are recorded as synthetic. `WTP_RUN_ID` from CI when set, otherwise a
 * local id stamped with this run's start.
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

/** A page with the zip already resolved (seeded in sessionStorage) and the first-run tour marked seen. */
async function openAt(browser: GuardedBrowser, zip: string): Promise<Page> {
  const context = await browser.context({
    // The page's own /api/meetings fetches write search-log rows too, so the browser declares the run synthetic.
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
  /* Wait for the app to render; a genuine failure still fails on the read below. */
  /* A page that never settled is printed. */
  if (!(await appSettled(page))) {
    console.log(
      `  ..  ${elapsed()} the app did not report settled at ${zip} within the ceiling — ` +
        "reading anyway, so a genuine absence still fails on the truth below",
    );
  }
  return page;
}

/** A desktop context, for checks whose subject only exists at that width. */
async function openWideAt(browser: GuardedBrowser, zip: string): Promise<Page> {
  const context = await browser.context({
    // The same synthetic declaration on the wide viewport.
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
  /* Wait for the app to render; a genuine failure still fails on the read below. */
  /* A page that never settled is printed. */
  if (!(await appSettled(page))) {
    console.log(
      `  ..  ${elapsed()} the app did not report settled at ${zip} within the ceiling — ` +
        "reading anyway, so a genuine absence still fails on the truth below",
    );
  }
  return page;
}

async function bodyText(page: Page): Promise<string> {
  return page.locator("body").innerText();
}

const browser = await launchGuarded({ label: "walk-all" });

console.log(`walk:all — ${BASE}\n${new Array(60).fill("─").join("")}`);

// ═══════════════════════════════════════════════════════════════════════════
// A. The doors that must open at all — server-rendered, HTTP only.
// ═══════════════════════════════════════════════════════════════════════════

section("A. Top-level doors (0817, 0818, g3)");

/* `/api/build` must answer real values for both the code SHA (`commit`) and the serving deploy (`deployId`). */
{
  const build = await get("/api/build");
  check("promptC", "/api/build answers", build.status === 200, `HTTP ${build.status}`);
  if (build.status === 200) {
    let body: {
      commit?: string;
      commitShort?: string;
      deployId?: string;
      branch?: string;
    } = {};
    try {
      body = JSON.parse(build.text) as typeof body;
    } catch {
      body = {};
    }
    const commit = body.commit ?? "unknown";
    const deployId = body.deployId ?? "unknown";
    /* Production-only values: a local `next start` answers "unknown", so these report CANNOT RUN rather than FAIL. */
    const localTarget = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/.test(BASE);
    if (localTarget) {
      for (const label of [
        "/api/build states the code SHA",
        "/api/build states the deploy identifier",
        "/api/build's two identifiers are distinct facts, not one repeated",
      ]) {
        cannotRun(
          "promptC",
          label,
          "this run targeted a local build, which has no Netlify build environment — " +
            "ask `pnpm deploy:live` instead, which reads the deploy record with zero site traffic",
        );
      }
    } else {
      check(
        "promptC",
        "/api/build states the code SHA",
        /^[0-9a-f]{40}$/.test(commit),
        `commit=${commit}`,
      );
      check(
        "promptC",
        "/api/build states the deploy identifier",
        deployId !== "unknown" && deployId.length > 0,
        `deployId=${deployId}`,
      );
      check(
        "promptC",
        "/api/build's two identifiers are distinct facts, not one repeated",
        commit !== deployId,
        `commit=${body.commitShort ?? "?"} deployId=${deployId}`,
      );
    }
  }
}


for (const { zip } of WALK_PLACES) {
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

    /* The retired per-page coverage note must not come back. */
    check(
      "promptB",
      `/ballot renders no coverage note at ${zip}`,
      !/data-coverage-note=/.test(ballot.text),
      "the coverage note is rendering again — it was deleted because a " +
        "sentence counting what has not been worked out goes false the moment " +
        "the work is done and no test can see it",
    );

    /*
     * The page-level disclosure is present (checked by attribute, since the prose
     * may be rewritten), and the per-card completeness sentence never renders.
     */
    check(
      "promptE",
      `/ballot carries the page-level collection disclosure at ${zip}`,
      /data-collection-note/.test(ballot.text) ||
        !/vote for/i.test(ballot.text),
      "the page renders candidate contests and says nothing about what a " +
        "short card means — the short-card disclosure is missing",
    );
    check(
      "promptE",
      `/ballot carries no per-card completeness marker at ${zip}`,
      !/haven't found much about this candidate/i.test(ballot.text),
      "a per-card completeness marker is back on the ballot — it was " +
        "deleted because it lands on exactly the least-resourced candidate",
    );

    /* The ballot page links "How we handle data" instead of carrying the device-only sentence. */
    check(
      "F01",
      `/ballot links the data-handling page instead of the retired sentence at ${zip}`,
      /How we handle data/.test(ballot.text) &&
        !/saved on this device only/i.test(ballot.text),
      /saved on this device only/i.test(ballot.text)
        ? "the retired sentence is back on the page"
        : "link present, sentence gone",
    );
    check(
      "0817",
      `/ballot links "Moving here?" at ${zip}`,
      /Moving here\?/.test(ballot.text),
    );
    // The private note and the sold aggregate are differently consequential and must not read alike.
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
    /* The fifth provision kind reaches the reader and the old SUNSET label does not; only zips with a decomposed measure carry it. */
    if (zip.startsWith("85")) {
      check(
        "g17",
        `/ballot renders the fifth provision kind at ${zip}`,
        /When it starts</.test(ballot.text),
      );
      check(
        "g17",
        `/ballot no longer renders the widened SUNSET label at ${zip}`,
        !/When it starts and ends/.test(ballot.text),
      );
    }
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
    /** Present exactly when the last refresh could not reach this row. */
    carried?: { source: string; lastFreshAt: string };
  }>;
  tier: string;
  coverage: { bodies: Array<{ name: string | null; ocdId: string | null }> } | null;
  snapshot: {
    generatedAt: string;
    failed: Array<{ source: string }>;
    /** The rows this snapshot holds that its own run never retrieved. */
    carried?: { count: number; lastFreshAt: string | null };
  } | null;
}

/** Shipped meeting counts per zip, as floors: a source going dark empties a calendar, a refresh never lowers one below the floor. */
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
        least: 2,
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
      `${hits.length} row(s) of ${payload.meetings.length}, claim floor ${named.least}`,
    );
  }

  // A failed source is reported, but the bodies it serves must still carry their last known sittings.
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
// `member` is required — the route answers 400 without it.
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

// Three officials must render three different campaigns' books (distinct cache keys, distinct results).
interface FundingPayload {
  kind?: string;
  data?: { fecCandidateId?: string; name?: string; totals?: { receipts?: number } };
}
// The app-side id is `congress:<bioguide>`; the answers must name three different FEC candidate ids.
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

for (const { zip } of WALK_PLACES) {
  const page = await openAt(browser, zip);
  /* The who-governs card is reached the way a reader does, by clicking its pill. */
  const wghPill = page.locator(".notice-fab").first();
  if (await wghPill.isVisible().catch(() => false)) {
    await wghPill.click();
    await until(page, async () => (await page.locator(".coverage-notice").count()) > 0, 8_000);
  }
  const text = await bodyText(page);

  check("0814c", `${zip}: the map answers with something about this place`, text.length > 200);

  /* A basemap failure notice that latches over a drawing map: checked on the rendered notice, the reader's claim. */
  const basemapNotice = await page.evaluate(
    () => document.body.innerText.includes("Basemap unavailable"),
  );
  check(
    "njhunt6",
    `${zip}: the reader is not told the basemap is unavailable`,
    !basemapNotice,
    basemapNotice ? "the notice is on screen — VF02 has regressed" : "",
  );

  /* The notice being absent is not the same as the map drawing. */
  /* The map handle arrives after the card; wait for it so the check can run. */
  await page
    .waitForFunction(
      () =>
        ((window as unknown as { __wtpMap?: { getStyle?: () => { layers?: unknown[] } } }).__wtpMap
          ?.getStyle?.()
          ?.layers?.length ?? 0) > 0,
      undefined,
      { timeout: 25_000 },
    )
    .catch(() => undefined);
  const styleLayers = await page.evaluate(() => {
    const w = window as unknown as { __wtpMap?: { getStyle?: () => { layers?: unknown[] } } };
    return w.__wtpMap?.getStyle?.()?.layers?.length ?? -1;
  });
  if (styleLayers < 0) {
    cannotRun(
      "njhunt6",
      `${zip}: the basemap style has real layers`,
      "the page exposes no map handle to read a layer count from — a check that CANNOT RUN, " +
        "reported apart from one that failed",
    );
  } else {
    check(
      "njhunt6",
      `${zip}: the basemap style has real layers`,
      styleLayers > 1,
      `${styleLayers} layer(s); the plain-ground fallback has 1`,
    );
  }

  // The mojibake sweep uses the detector from `lib/text/mojibake.ts` rather than spelling the bytes out here.
  const mojibake = text.match(mojibakePattern()) ?? [];
  check("0815", `${zip}: no mojibake in the rendered text`, mojibake.length === 0, mojibake.slice(0, 4).join(" "));

  // The three tiers, and FEDERAL is the label.
  check(
    "0814c",
    `${zip}: who-governs is grouped Local / State / Federal`,
    /Local/.test(text) && /State/.test(text) && /Federal/.test(text),
  );
  check("0814c", `${zip}: "Federal" is the label, never "National"`, !/\bNational\b/.test(text));

  // The governor is a first-class attachment on who-governs.
  check("0814c", `${zip}: the state's governor is on who-governs`, /Governor/.test(text));

  // The sidebar counters, and DISTRICTS never spends the dash on a switch.
  check("0815", `${zip}: no counter renders the couldn't-check dash`, !/\bOFFICIALS\s*—\b/.test(text));

  // Each distinct footnote once per body; identical footnotes across bodies collapse to once per panel.
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

  /* One denominator: the prose count, the disclosure link's count and the `<li>` count, parsed from the page, must agree. */
  const denominators = await page.evaluate(`(() => {
    const card = document.querySelector(".coverage-notice");
    if (!card) return { reason: "no who-governs card" };

    const flat = (card.textContent || "").replace(/\\s+/g, " ");
    // "N bodies govern the area around <ZIP>" / "One body governs the area"
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

  // The ask box is on the card, and its beat never claims thought.
  check("0819", `${zip}: the ask box is on the who-governs card`, /ask/i.test(text));
  check(
    "0814b",
    `${zip}: no deliberation label anywhere on the map`,
    !/\b(Thinking|Pondering|Analyzing|Reasoning)\b/.test(text),
  );

  // One state's facts never bleed into another's. Scoped to the card: the welcome overlay names every covered place.
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
    // The mayor-reachability pair needs an untouched page; see section I.
    check("0819", "07866: no shouting surnames", !/\bROACH\b/.test(text));
  }

  /*
   * More viewport must never mean fewer pins. The zoom-out goes through
   * `__wtpZoomOut` so it takes a gesture's settle path, and the zoom itself is
   * asserted before the pin counts.
   */
  const zooms: number[] = [];
  const counts: number[] = [];
  /** The lowest pin count held at any instant during each settle. */
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
      /* Sampled through the settle: the floor is the lowest pin count held at any instant between this zoom and the next. */
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

  /* The state rises out of the map at every zoom, measured at the furthest zoom-out. */
  const focus = await page.evaluate(() => {
    const scrim = document.querySelector(".state-focus-scrim");
    const clip = document.querySelector(".state-focus-art clipPath path");
    return {
      scrim: Boolean(scrim),
      filter: scrim ? getComputedStyle(scrim).backdropFilter : "none",
      // The clip has to hold the map rect AND the state's rings; a rect alone would mute everything.
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

    /* The pin floor across every settle is never zero: a retrieval in flight may not be shown as an absence. */
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
  const context = await browser.context({
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
  /* Gate on the pick element being present AND hydrated, not on server markup. */
  await untilInteractive(page, PICK_CHOICE, 12_000);

  // A pick renders the reader's running ballot. The pick box's own choices distinguish it from the reaction sensor.
  const pickButtons = page.locator(PICK_CHOICE);
  const pickCount = await pickButtons.count();
  if (pickCount === 0) {
    cannotRun(
      "0814c",
      "85701: your-picks round trip",
      "no pick control on the page",
    );
  } else {
    await pickButtons.first().click();
    let raised = await untilText(page, /my picks/i, 10_000);
    let attempts = 1;
    if (!raised) {
      await pickButtons.first().click();
      raised = await untilText(page, /my picks/i, 10_000);
      attempts = 2;
    }
    const after = await bodyText(page);
    const present = /my picks/i.test(after);
    check(
      "0814c",
      "85701: a pick raises the reader's running ballot",
      present,
      present
        ? attempts === 1
          ? ""
          : "R52: the FIRST click raised nothing and the second did — the button was " +
            "almost certainly not hydrated yet. Passing, and saying so."
        : "no My picks surface after two picks, 10s apart — this is the feature, not the timing",
    );
    await pickButtons.first().click();
    // Undo the pick so the next section starts from a clean ballot; nothing is read after this.
    await untilText(page, /my picks/i, 8_000).then(async (still) =>
      still ? until(page, async () => !/my picks/i.test(await bodyText(page)), 8_000) : true,
    );
  }

  // Candidate names on the ballot open their large battlecards.
  const nameLinks = await page.locator("[data-candidate-card]").count();
  check(
    "g3",
    "85701: candidate names open their large battlecards",
    nameLinks > 0,
    `${nameLinks} name link(s)`,
  );

  /* The five-point funding scale reads as three groups, not one centre. */
  const inlineSeparators = await page.locator(".scale-sep").count();
  /* Funding renders only on a federal contest, so the card opened must be one. */
  const pillCount = await page.locator("[data-battlecard-pill]").count();
  const CARDS = Math.min(20, pillCount);
  let separators = 0;
  let searched = 0;
  for (let i = 0; i < CARDS; i++) {
    await page.locator("[data-battlecard-pill]").nth(i).scrollIntoViewIfNeeded();
    await page.locator("[data-battlecard-pill]").nth(i).click();
    const up = await page
      .locator("[data-candidate-battlecard]")
      .waitFor({ state: "visible", timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    searched = i + 1;
    if (up) {
      const money = page.locator("[data-battlecard-body] button:has-text('Campaign money')");
      if (await money.count()) {
        await money.first().click().catch(() => {});
        await page.locator(".scale-sep").first().waitFor({ state: "attached", timeout: 4_000 }).catch(() => {});
      }
      separators = await page.locator(".scale-sep").count();
    }
    if (separators > 0) break;
    await page.keyboard.press("Escape");
    await page
      .locator("[data-candidate-battlecard]")
      .waitFor({ state: "detached", timeout: 5_000 })
      .catch(() => {});
  }
  check(
    "g3",
    "85701: the five-point scale carries its group separators",
    separators > 0,
    `${separators} separator(s), found on card ${searched} of ${CARDS} opened, ` +
      `${inlineSeparators} on the row (item 12 moved the funding block into the ` +
      "card; the claim is unchanged and only the place to look moved)",
  );

  await context.close();
}

// ═══════════════════════════════════════════════════════════════════════════
// E. The sources vocabulary and the officials' facts.
// ═══════════════════════════════════════════════════════════════════════════

section("E. Sources and officials (g3 items 5, 8, 9)");

{
  const page = await openAt(browser, "85701");

  const wghPill = page.locator(".notice-fab").first();
  if (await wghPill.isVisible().catch(() => false)) {
    await wghPill.click();
    await until(page, async () => (await page.locator(".coverage-notice").count()) > 0, 8_000);
  }

  // A read from the body's own official source is verified.
  const opened = await page
    .locator('.coverage-notice button:has-text("Kelly")')
    .first()
    .click()
    .then(() => true)
    .catch(() => false);
  if (!opened) {
    /* All three identities declare when the block cannot run. */
    for (const identity of [
      "the sources tab's vocabulary",
      "an official-source read never says 'Verified: not yet'",
      "the large card carries no duplicate 'How to reach them' accordion",
    ]) {
      cannotRun("g3", identity, "no official row on the who-governs card");
    }
  } else {
    await untilPresent(page, ".popup-card", 10_000);
    const more = page.locator('.popup-card button:has-text("More")');
    if (await more.count()) {
      await more.first().click();
      await untilPresent(page, ".account-modal-body", 10_000);
    }
    const card = await page.locator(".account-modal-body, .popup-card").first().innerText();
    check(
      "g3",
      "an official-source read never says 'Verified: not yet'",
      !/Verified:\s*not yet/i.test(card),
      (card.match(/Verified:[^\n]*/) ?? [""])[0],
    );
    // The contact pills are the contact surface; no duplicate accordion.
    check(
      "g3",
      "the large card carries no duplicate 'How to reach them' accordion",
      !/How to reach them/i.test(card),
    );
  }

  await page.context().close();
}

// ═══════════════════════════════════════════════════════════════════════════
// F. The map answers to the reader, and the panels stop shouting.
// ═══════════════════════════════════════════════════════════════════════════

section("F. The reader's map and the folded panels (g4 items 1-5, 9, 11, 14, 15)");

{
  /* The zip hop, both directions: the raised state follows where the reader is. */
  const hops: Array<[string, string]> = [
    ["03255", "ocd-division/country:us/state:nh"],
    ["85701", "ocd-division/country:us/state:az"],
    ["07866", "ocd-division/country:us/state:nj"],
    ["03255", "ocd-division/country:us/state:nh"],
  ];

  for (const [index, [zip, expected]] of hops.entries()) {
    /* The hop's own name, so the repeated zip at the end has a distinct identity. */
    const hop = `hop ${index + 1} of ${hops.length}${
      index === hops.length - 1 ? ", returning" : ""
    }`;
    /* A fresh context per hop, because `openAt`'s init script rewrites the location on every load. */
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

    // No other state's boundaries, ever.
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
  /* Free panning must not glide back to the starting point. */
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
    /* Drag from a point the map can actually receive, not one covered by an overlay. */
    const origin = (await page.evaluate(`(() => {
      const b = ${JSON.stringify({ x: box.x, y: box.y, w: box.width, h: box.height })};
      const pts = [
        [b.x + b.w / 2, b.y + b.h / 2],
        [b.x + b.w / 2, b.y + b.h * 0.22],
        [b.x + b.w * 0.25, b.y + b.h * 0.3],
        [b.x + b.w * 0.75, b.y + b.h * 0.3],
        [b.x + b.w * 0.25, b.y + b.h * 0.7],
        [b.x + b.w * 0.75, b.y + b.h * 0.7],
      ];
      for (const [x, y] of pts) {
        const el = document.elementFromPoint(x, y);
        if (el && el.tagName === "CANVAS") return { x, y };
      }
      return null;
    })()`)) as { x: number; y: number } | null;

    if (!origin) {
      cannotRun(
        "g4",
        "the pan-and-wait check",
        "every candidate drag origin is covered by an overlay — no point on the canvas is reachable",
      );
    } else {
    await page.mouse.move(origin.x, origin.y);
    await page.mouse.down();
    await page.mouse.move(origin.x - 160, origin.y - 90, { steps: 12 });
    await page.mouse.up();
    await until(
      page,
      async () => {
        const now = await centreNow();
        return now !== null && before !== null && (Math.abs(now.lat - before.lat) > 1e-6 || Math.abs(now.lng - before.lng) > 1e-6);
      },
      8_000,
    );

    const panned = await centreNow();
    // The drag has to have moved the camera before its result means anything.
    const moved =
      panned !== null &&
      (Math.abs(panned.lat - before.lat) > 1e-4 ||
        Math.abs(panned.lng - before.lng) > 1e-4);

    if (!moved || !panned) {
      cannotRun("g4", "the pan-and-wait check", "the drag did not move the camera");
    } else {
      /* A deliberate duration: this waits for an auto-frame timer NOT to fire. */
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
  }

  await page.context().close();
}

{
  const page = await openWideAt(browser, "85701");

  // Filters opens collapsed, and holds radius and districts.
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

  /* Opening Filters is a click; a click that cannot land is reported as could-not-run. */
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
    await untilPresent(page, ".sidebar-scroll", 8_000);
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

  /* The moving-here line, exactly, asserted on the ballot page's server-rendered HTML. */
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
  /* The meetings panel opens fully collapsed. */
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
    await untilPresent(page, ".al-group-head", 10_000);
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
// The active-state model, and the panel that paints untouched.
// ═══════════════════════════════════════════════════════════════════════════

{
  /* The active state's interior is crisp at the zoom it once failed at. */
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
    /* A deliberate duration: the compositor repaints after a hidden layer, with no event to wait on. */
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
  /* The meetings panel paints without being touched: opened by a DOM click(), the mouse never moves. */
  const page = await openAt(browser, "85701");
  const menu = page.locator('button[aria-label="Open menu"]');
  if (await menu.count()) {
    await menu.first().evaluate((el: HTMLElement) => el.click());
    await untilPresent(page, ".sidebar-scroll, [data-ask-pill]", 8_000);
  }
  // The frame before the panel opens; every paint claim is measured against it.
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
    await untilPresent(page, ".al-overlay-count", 10_000);
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
      /* The body's own rectangle against the frame taken before the panel opened (png.mts#regionChange). */
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
// The meetings count agrees across the sidebar counter, the map chip, the
// panel header and the sum of its group counts. The chip is `sm:` and up, so
// on a phone it is reported absent, never as a zero.
// ═══════════════════════════════════════════════════════════════════════════
section("G. The meetings count agrees with itself (g6 item 1d)");

for (const { zip } of WALK_PLACES) {
 for (const wide of [false, true]) {
  // The phone pass covers the viewport the defect was reported on; the desktop pass reads the chip.
  const page = wide ? await openWideAt(browser, zip) : await openAt(browser, zip);
  const where = `${zip}${wide ? " (desktop)" : " (phone)"}`;

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
  await untilPresent(page, ".al-overlay-count", 10_000);
  /* And the panel has stopped changing: the header paints before the list's footer. */
  await untilSettled(page, ".al-panel", 400, 10_000);

  const panel = await page.evaluate(`(() => {
    const header = document.querySelector(".al-overlay-count");
    if (!header) return { reason: "the meetings panel did not open" };
    const counts = [];
    for (const h of document.querySelectorAll(".al-group-head")) {
      const n = Number((h.querySelector(".al-group-count")?.textContent || "").trim());
      if (Number.isFinite(n)) counts.push(n);
    }
    /* The list renders the first 200 and states the rest as "Show N more (N hidden)". */
    const more = document.querySelector(".al-more");
    /* No regex here: inside this template literal a backslash before a paren is dropped. */
    const moreText = more ? (more.textContent || "") : "";
    const open = moreText.lastIndexOf("(");
    const hiddenDigits = open >= 0 ? moreText.slice(open + 1).replace(/[^0-9]/g, "") : "";
    const hidden = hiddenDigits.length > 0 ? Number(hiddenDigits) : 0;
    return {
      stated: Number((header.textContent || "").replace(/[^0-9]/g, "")),
      groups: counts.length,
      sum: counts.reduce((a, b) => a + b, 0),
      hidden: Number.isFinite(hidden) ? hidden : 0,
      /* The raw text, so a future mismatch is diagnosable from the report. */
      moreText,
      clipStated: Boolean(more),
    };
  })()`) as {
    reason?: string;
    stated?: number;
    groups?: number;
    sum?: number;
    hidden?: number;
    /* The clip button's raw text, so a mismatch is diagnosable from the report. */
    moreText?: string;
    clipStated?: boolean;
  };

  if (panel.reason) {
    cannotRun("g6", `${where}: the meetings count agrees with itself`, panel.reason);
    await page.context().close();
    continue;
  }

  // The chip is hidden below `sm` by design; hidden is stated, never agreement or failure.
  const chipNote = numbers.chipVisible
    ? `chip ${numbers.chip}`
    : `chip not rendered at this width (sm: and up only)`;
  /* Rendered rows plus what the panel says it hides must equal the total every other surface states. */
  const hidden = panel.hidden ?? 0;
  const rendered = (panel.sum ?? 0) + hidden;
  const comparable = [numbers.sidebar, panel.stated, rendered].concat(
    numbers.chipVisible ? [numbers.chip] : [],
  );
  const allEqual = comparable.every((n) => n !== null && n === comparable[0]);
  // A clip that is not stated is still a failure.
  const clipHonest = hidden === 0 || panel.clipStated === true;
  const clipNote =
    hidden > 0
      ? `, group counts sum ${panel.sum} + ${hidden} the panel SAYS it is hiding = ${rendered}`
      : `, group counts sum ${panel.sum} across ${panel.groups} group(s)`;

  check(
    "g6",
    `${where}: the meetings count agrees with itself`,
    allEqual && clipHonest && (panel.stated ?? 0) >= 0,
    `sidebar ${numbers.sidebar}, ${chipNote}, panel header ${panel.stated}${clipNote}`,
  );

  await page.context().close();
 }
}

// ═══════════════════════════════════════════════════════════════════════════
// The summary.
// ═══════════════════════════════════════════════════════════════════════════


// ── Section G ─────────────────────────────────────────────────────────────

section("H. The frozen denominator (h item 1)");

/** A frozen external denominator: the 2022 Census of Governments names three governments at this point, so three divisions must carry a governing body. */
{
  /* Counted as distinct divisions carrying a governing body, because one government can have two governing bodies. */
  const payload = await getJson<{
    coverage: {
      counts: { governing: { total: number } };
      bodies?: { ocdId: string | null; bodyClass: string }[];
    } | null;
  }>("/api/meetings?lat=43.31403&lng=-72.02455");

  if (!payload) {
    cannotRun("h", "03255: the governing count matches the frozen external denominator", "/api/meetings did not answer");
  } else {
    const bodies = payload.coverage?.bodies ?? [];
    const governingBodies = bodies.filter((b) => b.bodyClass === "GOVERNING");
    const governments = new Set(
      governingBodies.map((b) => b.ocdId ?? "(no division)"),
    );
    // The stated total, so a run that loses the body list still measures something.
    const statedTotal = payload.coverage?.counts.governing.total ?? -1;
    check(
      "h",
      "03255: the governing count matches the frozen external denominator",
      governments.size === 3 && governingBodies.length >= 3,
      `production renders ${governingBodies.length} governing body/bodies across ` +
        `${governments.size} government(s) (API's own governing total: ${statedTotal}); ` +
        "the 2022 Census of Governments says 3 governments — Merrimack County, " +
        "Newbury town, Kearsarge Regional SD",
    );
  }
}


// ═══════════════════════════════════════════════════════════════════════════
// The mayor is still reachable after leaving the who-governs panel. Runs on its
// own fresh page, and every query is scoped to the dialog this check opened.
// The distance (row → card → Representation) is recorded.
// ═══════════════════════════════════════════════════════════════════════════
section("I. The mayor after item 6 (g6)");

{
  const page = await openAt(browser, "07866");

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
      await untilPresent(page, ".account-modal, .popup-card", 12_000);
      /* Body cards use collapsible sections while district and meeting cards keep tabs; both grammars are handled. */
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
        await untilPresent(page, "[role=tabpanel], .account-modal-body", 10_000);
        // Scope to the tab panel, or the dialog body for the section grammar, never the document.
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
// A carried row never inherits the snapshot's freshness.
// ═══════════════════════════════════════════════════════════════════════════

section("J. Carried rows state their own freshness (hotfix-0817 item 2)");

/* Rows carried forward from a previous snapshot must carry their own stamp, not the snapshot's "last checked". */
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

    // Fresh rows carry no mark: a mark is legitimate only on a row whose source reported a gap.
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
      /* All three identities report when the block cannot run. */
      /* With nothing carried, these assert the healthy state rather than reporting could-not-run. */
      const gapSources = [...withGaps];
      const evidence =
        `the snapshot generated ${generatedAt ?? "unknown"} carries 0 rows of ` +
        `${payload.meetings.length} at this zip, and ${gapSources.length} source(s) reported a gap` +
        `${gapSources.length > 0 ? ` (${gapSources.join(", ")})` : ""}`;
      check(
        "hotfix-0817",
        NAME,
        gapSources.length === 0,
        `${evidence} — with nothing carried, no row can claim the snapshot's freshness; ` +
          "a source reporting a gap while nothing is carried would be carry-forward not carrying",
      );
      check(
        "hotfix-0817",
        "03255: each carried row's stated timestamp is the one the snapshot records",
        gapSources.length === 0,
        `${evidence} — vacuously true over zero carried rows, and the condition that ` +
          "would make it non-vacuous (a refused source) is asserted absent rather than assumed",
      );
      check(
        "hotfix-0817",
        "03255: the footer does not speak for the carried rows",
        gapSources.length === 0 && meta === null,
        `${evidence}; snapshot.carried is ${meta === null ? "null" : JSON.stringify(meta)} — ` +
          "no carried rows and no carried metadata, which is what a fully-reached refresh looks like",
      );
    } else {
      // 1. Every carried row names its origin and an instant older than the snapshot's own.
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

      // 2. The snapshot's record and the rows agree: the slice never exceeds the file's count, and the
      // file's stated instant is on the rows' shared day and no newer than any row.
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

      // 3. The reader is told: the footer states the carried count, and each row's card its own stamp.
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
// K. Reader surfaces carry the current product name.
// ═══════════════════════════════════════════════════════════════════════════

section("K. Reader surfaces speak plain language (g8)");

{
  for (const { zip } of WALK_PLACES) {
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
      // The product wears one name, and the old one is gone from every surface a reader is served.
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
// One Phone pill, and the personal address that left the product.
// ═══════════════════════════════════════════════════════════════════════════

section("L. Contact surfaces (g9: R39 the phone pill, R40 the address)");

{
  /* One Phone pill, even for an officeholder with several numbers. Its own fresh page. */
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
    /* Wait for the row to populate, not merely mount. */
    await until(
      page,
      async () =>
        (await page.locator(".contact-pill-row").count()) > 0 &&
        /Phone/.test(await page.locator(".contact-pill-row").first().innerText()),
      15_000,
    );
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
      await untilPresent(page, "[role=dialog] a[href^='tel:'], .contact-chooser", 8_000);

      // The chooser's rows must equal the recorded count from the same route the card reads.
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
  /* No surface a reader is served carries the personal address. */
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
    check(
      "g9",
      "/feedback serves the form and says what happens to it",
      /data-feedback-input/.test(form.text) &&
        /only write back if you fill in the optional email box/i.test(form.text),
      `input present ${/data-feedback-input/.test(form.text)}, ` +
        `states when a reply is possible ` +
        `${/only write back if you fill in the optional email box/i.test(form.text)}`,
    );
    /* The read half of the reply-field checks; the write half writes real feedback rows and is excluded. */
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
    // The field and its disclosure ship together; the disclosure states what the address is never used for.
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
// Overlapping pins fan out, and dismissal returns them.
// ═══════════════════════════════════════════════════════════════════════════

section("M. Overlapping pins are each reachable (g9: M19, the author's ruling)");

{
  /* Two pins on top of each other are both tappable. The walk zooms out until something collides, or says so. */
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
    // Each zoom step is a real gesture through the settle path.
    for (let step = 0; step < 5 && reading.groups.length === 0; step++) {
      await page.evaluate(`window.__wtpZoomOut && window.__wtpZoomOut(1.5)`);
      /* A deliberate settle before a geometry read: the camera animates. */
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
        /* A deliberate settle before a geometry read: the camera animates. */
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
          /* A real mouse press at the stack's coordinates: the defect being guarded is pointer interception. */
          await page.mouse.click(at.x, at.y);
          /* A deliberate settle before a geometry read: the camera animates. */
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

          /* The dismissal check is gated on the fan having happened; ungated it would pass trivially. */
          if (!fanned) {
            cannotRun(
              "g9",
              "85701: dismissing the fan returns every pin",
              "the fan did not open, so a dismissal proves nothing",
            );
          } else {
            // Escape, the explicit control beside the map-press gesture.
            await page.keyboard.press("Escape");
            /* A deliberate settle before a geometry read: the camera animates. */
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
// Online sittings and agenda attribution, asked of the served site.
// ═══════════════════════════════════════════════════════════════════════════

section("G10. Online meetings, and agenda attribution");

/** Online sittings stay reachable, with distinct pins at published body offices. */
{
  const payload = await getJson<{
    meetings: {
      id: string;
      location: unknown;
      bodyId?: string;
      online?: { label: string; joinUrl: string | null };
    }[];
  }>("/api/meetings?lat=32.2226&lng=-110.9747&radiusKm=25");

  if (!payload) {
    cannotRun("g10", "85701: meetings held online are reachable", "/api/meetings did not answer");
  } else {
    const online = payload.meetings.filter((m) => m.location === null && m.online != null);
    check(
      "g10",
      "85701: meetings held online are reachable at all",
      online.length > 0,
      `${online.length} of ${payload.meetings.length} meetings have no physical place; ` +
        "before D18 every one of them was dropped at normalize",
    );

    // A null location with no online block is a meeting nobody can attend; nothing may serve one.
    const mute = online.filter((m) => !m.online?.label);
    check(
      "g10",
      "85701: every online meeting says how it is held",
      online.length > 0 && mute.length === 0,
      mute.length === 0
        ? `all ${online.length} carry the body's published location string`
        : `${mute.length} carry no label: ${mute.map((m) => m.id).join(", ")}`,
    );

    const addressPayload = await getJson<{ coverage?: { bodies: { bodyId: string; officeContact?: { address: string | null } }[] } }>("/api/meetings?lat=32.2226&lng=-110.9747&radiusKm=25");
    const officeIds = new Set((addressPayload?.coverage?.bodies ?? []).filter(body => body.officeContact?.address).map(body => body.bodyId));
    const expected = online.filter(meeting => meeting.online && meeting.bodyId && officeIds.has(meeting.bodyId));
    if (expected.length === 0) {
      cannotRun("g10", "85701: every online-only meeting with a published body address has an online-only pin with its join link", "no online-only meeting with a published body office address is held for this walk");
    } else {
      const page = await openAt(browser, "85701");
      try {
        await page.waitForFunction(() => document.querySelector('[data-venue-kind="ONLINE_ONLY"]'), undefined, { timeout: 30_000 });
        const pins = await page.locator('[data-venue-kind="ONLINE_ONLY"]').evaluateAll(elements => elements.map(element => ({ ids: JSON.parse((element as HTMLElement).dataset.meetingIds ?? "[]") as string[], links: JSON.parse((element as HTMLElement).dataset.joinUrls ?? "[]") as (string | null)[], label: element.getAttribute("aria-label") ?? "" })));
        const missing = expected.filter(meeting => !pins.some(pin => pin.ids.includes(meeting.id) && pin.label.includes("Online only") && pin.links.includes(meeting.online!.joinUrl)));
        check("g10", "85701: every online-only meeting with a published body address has an online-only pin with its join link", missing.length === 0, missing.length ? `missing pins or published join links: ${missing.map(meeting => meeting.id).join(", ")}` : `${expected.length} meetings represented by distinct online-only office pins; null published links remain named gaps`);
      } catch (error) {
        cannotRun("g10", "85701: every online-only meeting with a published body address has an online-only pin with its join link", error instanceof Error ? error.message : "online pin readback failed");
      } finally { await page.close(); }
    }
  }
}

/** The agenda attribution reaches the served site, and never names the host. */
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

    // Typography is not a government: a "PAGE BREAK" heading must not open a segment.
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
// H. The interface consolidates, and the ask box answers honestly.
//
// Exactly one ask input in each of four states (who-governs open, sidebar
// open, both closed, a battlecard open), the rail bounded and reachable at
// 390×844 with its longest content, and five questions asked by typing:
// a weather question, a strong-keyword question, an exact name, a
// classifier-routed question, and an honest refusal. Each ask writes one
// identifier-free QUESTION_ASKED row, counted in the probe accounting.
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

for (const { zip } of WALK_PLACES) {
  for (const wide of [false, true]) {
    const label = wide ? "desktop" : "390px";
    const page = wide ? await openWideAt(browser, zip) : await openAt(browser, zip);
    try {
      /* State 1 — who-governs open, reached by its pill. */
      const wghPill = page.locator(".notice-fab").first();
      if (await wghPill.isVisible().catch(() => false)) {
        await wghPill.click();
        await until(page, async () => (await page.locator(".coverage-notice").count()) > 0, 8_000);
      }
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
      // The pill names a concrete example, read from ASK_PILL_EXAMPLES so the walk and the label cannot drift.
      check(
        "g12",
        `G07: the Ask pill names a concrete example at ${zip} ${label}`,
        ASK_PILL_EXAMPLES.some((ex) =>
          new RegExp(ex, "i").test(wgh.pillText ?? ""),
        ),
        `label=${JSON.stringify(wgh.pillText)} examples=${ASK_PILL_EXAMPLES.join("|")}`,
      );

      /* State 2 — sidebar on screen, which closes who-governs. */
      const toggle = page.locator(".sidebar-toggle").first();
      if (await toggle.isVisible()) {
        await toggle.click();
      } else {
        await page
          .locator(".coverage-notice button[aria-label^='Minimize']")
          .first()
          .click();
      }
      await until(page, async () => (await page.locator(".coverage-notice").count()) === 0, 8_000);
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

      // One input, inside the cluster's expansion.
      if ((await page.locator("[data-ask-panel]").count()) === 0) {
        await page.locator("[data-ask-pill]").first().click();
        await untilPresent(page, "[data-ask-panel]", 8_000);
      }
      const opened = await clusterCensus(page);
      check(
        "g12",
        `M119: exactly one text input in the shell at ${zip} ${label}`,
        opened.inputs === 1,
        `${opened.inputs} inputs`,
      );

      // The rail is a bounded card with both ends reachable while holding its longest content, the digest.
      if (!wide) {
        const input = page.locator("[data-ask-box]").first();
        await input.fill("whats going on where i live");
        await page
          .locator("[data-ask-panel] button", { hasText: "Ask" })
          .first()
          .click();
        /* A deliberate duration: the geometry is measured with the streamed answer fully in. */
        await page.waitForTimeout(4500);
        /* Measure the gap from the scroller's maximum scroll position, not its current one. */
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

        /* The digest renders with its denominators (stated N equals rendered rows), waited for rather than read on arrival. */
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

        // ── Five questions, asked against the served site ──────────────────────
        /* Poll for the answer: the classifier is a network round trip. */
        /* Every question gets a fresh page, so a previous answer is never read as this one's. */
        const ask = async (question: string) => {
          await page.reload({ waitUntil: "domcontentloaded", timeout: 90_000 });
          await appSettled(page);
          if ((await page.locator("[data-ask-panel]").count()) === 0) {
            await page.locator("[data-ask-pill]").first().click();
            await untilPresent(page, "[data-ask-panel]", 8_000);
          }
          const input = page.locator("[data-ask-box]").first();

          await input.fill(question);
          await page
            .locator("[data-ask-panel] button", { hasText: "Ask" })
            .first()
            .click();

          /* The ceiling is 30s and the wait itself is reported, so the evidence says whether nothing rendered or the wrong thing did. */
          const started = Date.now();
          let settledAt: number | null = null;
          while (Date.now() - started < 30_000) {
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
            if (settled) {
              settledAt = Date.now() - started;
              break;
            }
            await page.waitForTimeout(250);
          }
          const waited =
            settledAt === null
              ? `TIMED OUT after ${Date.now() - started}ms with nothing rendered`
              : `settled in ${settledAt}ms`;

          const read = await page.evaluate(() => ({
            refusal: Boolean(document.querySelector("[data-ask-refusal]")),
            destination:
              document
                .querySelector("[data-ask-destination]")
                ?.getAttribute("data-ask-destination") ?? null,
            /* Case-insensitive: the eyebrow uppercases in CSS and `innerText` returns the rendered text. */
            answered: /the answer/i.test(
              (document.querySelector("[data-ask-panel]") as HTMLElement)
                ?.innerText ?? "",
            ),
          }));

          return { ...read, waited };
        };

        // 1. A single word "election" may be routed honestly, never answered with a lecture.
        const weather = await ask("what will the weather be like on election day");
        check(
          "g12",
          `the matcher ruling: the weather question is not keyword-routed at ${zip}`,
          weather.refusal || !weather.answered,
          `refusal=${weather.refusal} answered=${weather.answered} destination=${weather.destination} — ${weather.waited}`,
        );

        // 2. A strong keyword question (two distinct hits) still answers.
        const strong = await ask("there is a pothole on my street");
        check(
          "g12",
          `the matcher ruling: a strong keyword question answers at ${zip}`,
          strong.answered,
          `answered=${strong.answered} — ${strong.waited}`,
        );

        // 3. An exact name, read off the page's own autocomplete, navigates rather than asking.
        await input.fill("");
        await until(page, async () => (await page.locator(".search-ac-item").count()) === 0, 6_000);
        // Several meetings share a displayed title; the exact-name contract refuses that ambiguity, so use the body.
        const exactBody = zip === "85701" ? "Board of Supervisors" : null;
        await input.fill(exactBody ?? "Board");
        await untilPresent(page, ".search-ac-item", 8_000);
        const offered = await page.evaluate(
          (bodyName) => {
            const rows = Array.from(document.querySelectorAll(".search-ac-item"));
            const row = bodyName ? rows.find((entry) =>
              entry.querySelector(".search-ac-type")?.textContent?.trim() === "Body" &&
              entry.querySelector(".search-ac-name")?.textContent?.trim() === bodyName
            ) : rows[0];
            return (row?.querySelector(".search-ac-name") as HTMLElement | null)?.innerText ?? "";
          },
          exactBody,
        );
        if (offered) {
          await input.fill(offered);
          await page
            .locator("[data-ask-panel] button", { hasText: "Ask" })
            .first()
            .click();
          /* A deliberate duration: this asserts an absence (neither a refusal nor a digest renders). */
          await page.waitForTimeout(2500);
          const named = await page.evaluate(() => ({
            refusal: Boolean(document.querySelector("[data-ask-refusal]")),
            digest: Boolean(document.querySelector("[data-ask-digest]")),
            bodyOpened: Boolean(document.querySelector(".account-modal")),
          }));
          check(
            "g12",
            `the matcher ruling: an exact name navigates and asks nothing at ${zip}`,
            !named.refusal && !named.digest && (!exactBody || named.bodyOpened),
            `offered=${JSON.stringify(offered)}`,
          );
        } else {
          cannotRun(
            "g12",
            `the matcher ruling: an exact name navigates and asks nothing at ${zip}`,
            "the autocomplete offered no unambiguous name for this scenario",
          );
        }

        // 4. A classifier-routed question (one keyword hit, which the keyword layer declines) must be answered
        // honestly: the classifier found the drawer, or the refusal is stated.
        /* A destination counts as an honest answer. */
        const classified = await ask("my water bill");
        check(
          "g12",
          `the matcher ruling: a weak match is answered by the classifier or refused honestly at ${zip}`,
          classified.answered || classified.refusal || classified.destination !== null,
          `answered=${classified.answered} refusal=${classified.refusal} ` +
            `destination=${classified.destination} — ${classified.waited}`,
        );

        // 5. An honest refusal, with the destinations offered.
        const nonsense = await ask("qwertyuiop asdfghjkl zxcvbnm");
        check(
          "g12",
          `A07: an unroutable question refuses and offers the destinations at ${zip}`,
          nonsense.refusal && !nonsense.answered,
          `refusal=${nonsense.refusal} answered=${nonsense.answered} — ${nonsense.waited}`,
        );
      }
    } finally {
      await page.context().close();
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// The body battlecard's sections.
// ═══════════════════════════════════════════════════════════════════════════

section("M136. Body battlecards reach person-card depth (g13)");

{
  /* Each body renders every applicable section, with content or a named gap. */
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
      const pill = page.locator(".notice-fab").first();
      if (await pill.isVisible().catch(() => false)) {
        await pill.click();
        await until(page, async () => (await page.locator(".coverage-notice").count()) > 0, 8_000);
      }
      /* Scoped to the governing list. */
const row = page
        .locator(`.coverage-notice [data-governing-row] button:has-text("${body.label}")`)
        .first();
      if ((await row.count()) === 0) {
        /* Both identities declare when the block cannot run. */
        for (const identity of [
          `M136: ${body.label} (${body.what}) renders every section`,
          `M136: ${body.label}'s card renders no internal identifier`,
        ]) {
          cannotRun("g13", identity, `no who-governs row named "${body.label}" at ${body.zip}`);
        }
        continue;
      }
      await row.click();
      await untilPresent(page, ".account-modal", 10_000);

      const card = page.locator(".account-modal").first();
      if ((await card.count()) === 0) {
        for (const identity of [
          `M136: ${body.label} (${body.what}) renders every section`,
          `M136: ${body.label}'s card renders no internal identifier`,
        ]) {
          cannotRun("g13", identity, "the row opened no battlecard");
        }
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

      // An OCD-ID must never surface in `divisionLabel`.
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

/* ── An autocomplete row opens a card ─────────────────────────────────── */

/** An autocomplete row in the ask panel opens its card rather than submitting a question. */
const AC_ROW = ".search-ac-item";

/** Open the rail, type into the ask box, and wait for the autocomplete to have rows. */
async function offerRows(page: Page, typed: string): Promise<number> {
  const minimize = page.locator(".coverage-notice button[aria-label^='Minimize']").first();
  if ((await minimize.count()) > 0) {
    await minimize.click();
    await page.locator(".coverage-notice").waitFor({ state: "detached", timeout: 6000 }).catch(() => {});
  }
  if ((await page.locator("[data-ask-panel]").count()) === 0) {
    await page.locator("[data-ask-pill]").first().click().catch(() => {});
    await page
      .locator("[data-ask-panel]")
      .first()
      .waitFor({ state: "visible", timeout: 6000 })
      .catch(() => {});
  }

  const input = page.locator("[data-ask-box]").first();
  if ((await input.count()) === 0) return -1;
  await input.fill(typed);
  await page
    .locator(AC_ROW)
    .first()
    .waitFor({ state: "visible", timeout: 8000 })
    .catch(() => {});
  return page.locator(AC_ROW).count();
}

for (const zip of ["85701", "85641"]) {
  const name = `M135: an autocomplete body row opens a card at ${zip}`;
  /* A fresh page per attempt: picking a row dismisses the sidebar and the ask panel with it. */
  let offered = -1;
  let tried = 0;
  let opened = 0;
  let firstOpened = "";
  let why = "";

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const page = await openAt(browser, zip);
    try {
      const count = await offerRows(page, "a");
      if (count === -1) {
        why = "no ask box";
        break;
      }
      const bodyRows = page.locator(AC_ROW, {
        has: page.locator(".search-ac-type", { hasText: /^Body$/ }),
      });
      offered = await bodyRows.count();
      if (offered === 0) {
        why = `the autocomplete offered no body row for "a" at this zip (${count} row(s) of other kinds)`;
        break;
      }
      if (attempt >= offered) break;

      const row = bodyRows.nth(attempt);
      const label = (await row.locator(".search-ac-name").innerText()).trim();
      tried += 1;
      await row.click();
      const card = page.locator(".account-modal").first();
      const cardOpened = await card
        .waitFor({ state: "visible", timeout: 6000 })
        .then(() => true)
        .catch(() => false);
      if (cardOpened) {
        opened += 1;
        if (!firstOpened) firstOpened = label;
        break;
      }
    } finally {
      await page.context().close();
    }
  }

  if (tried === 0) cannotRun("g15", name, why || "no body row could be clicked");
  else
    check(
      "g15",
      name,
      opened > 0,
      `${offered} body row(s) offered, ${tried} clicked, ${opened} opened the large card` +
        (firstOpened ? ` (first: ${JSON.stringify(firstOpened)})` : ""),
    );
}


/* ═══════════════════════════════════════════════════════════════════════ */

await (async function g21Checks() {
  console.log("\n── g21: voting locations, the Kearsarge towns, the badge, the comparison ──");

// ── Where a reader can actually vote, asserted through the route ──────────
  try {
    const res = await fetch(`${BASE}/api/voting-sites`, {
      method: "POST",
      headers: { "content-type": "application/json", ...RUN_HEADERS },
      body: JSON.stringify({ address: "240 N Stone Avenue, Tucson, AZ 85701" }),
    });
    if (!res.ok) {
      cannotRun("g21", "B19: a Tucson address gets Pima's vote centers", `HTTP ${res.status}`);
    } else {
      const answer = (await res.json()) as {
        jurisdictions: {
          name: string;
          model: string;
          sites: unknown[];
          narrowing: { kind: string };
        }[];
      };
      const pima = answer.jurisdictions.find((j) => /Pima/.test(j.name));
      check(
        "g21",
        "B19: a Tucson address gets Pima's vote centers, and the model is VOTE_CENTER",
        Boolean(pima) && pima!.model === "VOTE_CENTER" && pima!.sites.length >= 100,
        pima
          ? `${pima.name}: ${pima.sites.length} site(s), model ${pima.model}, narrowing ${pima.narrowing.kind}`
          : "no Pima jurisdiction in the answer",
      );
      // A vote-center county is NOT_NEEDED, never a gap.
      check(
        "g21",
        "B16: a vote-center county narrows to NOT_NEEDED, never to a failure",
        pima?.narrowing.kind === "NOT_NEEDED",
        `narrowing = ${pima?.narrowing.kind ?? "(absent)"}`,
      );
    }
  } catch (error) {
    cannotRun("g21", "B19: a Tucson address gets Pima's vote centers", (error as Error).message.slice(0, 90));
  }

  // A walled jurisdiction renders its rungs, never an emptiness.
  try {
    const res = await fetch(`${BASE}/api/voting-sites`, {
      method: "POST",
      headers: { "content-type": "application/json", ...RUN_HEADERS },
      body: JSON.stringify({ address: "937 Route 103, Newbury, NH 03255" }),
    });
    if (!res.ok) {
      cannotRun("g21", "B19: a walled jurisdiction renders its rungs", `HTTP ${res.status}`);
    } else {
      const answer = (await res.json()) as {
        jurisdictions: { name: string; refusal: { rungs: unknown[] } | null }[];
      };
      const withRungs = answer.jurisdictions.filter((j) => (j.refusal?.rungs.length ?? 0) > 0);
      const rungs = withRungs.reduce((n, j) => n + j.refusal!.rungs.length, 0);
      check(
        "g21",
        "B19: a walled jurisdiction renders its RUNGS, never an emptiness",
        withRungs.length > 0 && rungs >= 10,
        `${withRungs.length} jurisdiction(s) carrying ${rungs} recorded rung(s)`,
      );
    }
  } catch (error) {
    cannotRun("g21", "B19: a walled jurisdiction renders its rungs", (error as Error).message.slice(0, 90));
  }

// ── Overlapping towns, and the division set ───────────────────────────────
  try {
    const res = await fetch(
      `${BASE}/api/meetings?lat=43.3217&lng=-72.0371&zip=03255`,
      { headers: RUN_HEADERS },
    );
    if (!res.ok) {
      cannotRun("g21", "M123: Wilmot and New London sit in 03255's answer", `HTTP ${res.status}`);
    } else {
      const body = (await res.json()) as {
        meetings: { jurisdiction: string; ocdId: string | null }[];
        governingOcdIds: string[] | null;
      };
      const towns = new Set(body.meetings.map((m) => m.jurisdiction));
      check(
        "g21",
        "M123: Wilmot AND New London are in 03255's own answer",
        towns.has("Wilmot, NH") && towns.has("New London, NH"),
        `${body.meetings.length} meeting(s) across ${towns.size} jurisdiction(s): ${[...towns].join(" · ")}`,
      );
      // A NULL division set is deliberately different from an empty array.
      check(
        "g21",
        "M81: the meetings route sends the reader's own division set",
        Array.isArray(body.governingOcdIds) && body.governingOcdIds.length > 0,
        `governingOcdIds = ${
          body.governingOcdIds === null ? "null (resolution FAILED)" : `${body.governingOcdIds.length} division(s)`
        }`,
      );
      // Most of what is on screen here does not govern the reader; "everything governs" means the set collapsed.
      const governing = new Set(body.governingOcdIds ?? []);
      const governs = body.meetings.filter((m) => m.ocdId && governing.has(m.ocdId)).length;
      check(
        "g21",
        "M81: at 03255 the badge splits the answer rather than blessing all of it",
        governs > 0 && governs < body.meetings.length,
        `${governs} of ${body.meetings.length} meeting(s) govern this reader`,
      );
    }
  } catch (error) {
    cannotRun("g21", "M123: Wilmot and New London sit in 03255's answer", (error as Error).message.slice(0, 90));
  }

// ── Two states side by side ───────────────────────────────────────────────
  try {
    const res = await fetch(`${BASE}/about-area/compare?a=NH&b=NJ`, { headers: RUN_HEADERS });
    const html = res.ok ? await res.text() : "";
    check(
      "g21",
      "D47: the side-by-side renders both states and says it does not rank",
      res.ok &&
        /New Hampshire and New Jersey/.test(html) &&
        /(don&#x27;t|don't|do not) rank/i.test(html),
      `HTTP ${res.status}, ${html.length} bytes`,
    );
  } catch (error) {
    cannotRun("g21", "D47: the side-by-side renders", (error as Error).message.slice(0, 90));
  }
})();

// ═══════════════════════════════════════════════════════════════════════════
// Walkthrough items, on the served build.
// ═══════════════════════════════════════════════════════════════════════════

section("F01. The walkthrough fixes hold (F01, 2026-08-19)");

{
  const page = await openWideAt(browser, "85701");
  try {
// ── The districts tile never says "Off" while districts are drawn ──
    const tile = (await page.evaluate(
      `(() => {
        const cards = [...document.querySelectorAll(".stats-bar *")]
          .map((n) => (n.textContent || "").replace(/\\s+/g, " ").trim())
          .filter((t) => /Districts in view$/.test(t));
        return { text: cards[0] || null };
      })()`,
    )) as { text: string | null };

    if (tile.text === null) {
      cannotRun(
        "F01",
        "9.2: the districts tile states a number, never Off",
        "no districts tile in the stats bar",
      );
    } else {
      const value = tile.text.replace(/Districts in view$/, "").trim();
      check(
        "F01",
        "9.2: the districts tile states a number, never Off",
        /^\d+$/.test(value),
        `tile read ${JSON.stringify(tile.text)} — value ${JSON.stringify(value)}`,
      );
    }
  } finally {
    await page.close();
  }
}

{
  /* Selecting a district shades it on the map, and closing its battlecard de-selects it. */
  const page = await openWideAt(browser, "85701");
  try {
    const box = await page.locator(".maplibregl-canvas").first().boundingBox();
    if (!box) {
      cannotRun(
        "F01",
        "9.6: selecting a district shades it, closing deselects",
        "no map canvas to click",
      );
    } else {
      /* The district overlay is off by default, so it is switched on before a click can hit a district. */
      await page.evaluate(
        `(() => { try { localStorage.setItem("wtp.show_districts", "1"); } catch {} })()`,
      );
      await page.reload({ waitUntil: "domcontentloaded" });
      await appSettled(page);
      /* A deliberate duration: the district layer is added asynchronously with no element to poll for. */
      await page.waitForTimeout(3000);
      await page.mouse.click(box.x + box.width * 0.78, box.y + box.height * 0.32);
      /* A deliberate settle after a real click, which may legitimately open nothing. */
      await page.waitForTimeout(2000);
      const opened = (await page.evaluate(
        `Boolean(document.querySelector(".district-picker") || document.querySelector(".popup-card"))`,
      )) as boolean;

      if (!opened) {
        cannotRun(
          "F01",
          "9.6: selecting a district shades it, closing deselects",
          "the map click opened neither a picker nor a card — the behaviour to preserve was never exercised",
        );
      } else {
        const cleared = (await page.evaluate(
          `(() => {
            const close = document.querySelector(
              '.popup-card [aria-label="Close"], .district-picker [aria-label="Dismiss"]',
            );
            if (close) close.click();
            return new Promise((r) =>
              setTimeout(() => {
                r(
                  !document.querySelector(".popup-card") &&
                    !document.querySelector(".district-picker"),
                );
              }, 900),
            );
          })()`,
        )) as boolean;
        check(
          "F01",
          "9.6: selecting a district shades it, closing deselects",
          Boolean(cleared),
          `opened=${opened} cleared=${cleared}`,
        );
      }
    }
  } finally {
    await page.close();
  }
}

{
  /* Every meetings list leads with what a reader can still attend, read from the card the click opened. */
  const page = await openAt(browser, "85701");
  try {
    /* Scoped to [data-governing-row]. */
    const row = page
      .locator('.coverage-notice [data-governing-row] button:has-text("Tucson Unified")')
      .first();
    if ((await row.count()) === 0) {
      cannotRun(
        "F01",
        "3.1: a meetings list leads with the upcoming group",
        "no Tucson Unified row at 85701",
      );
    } else {
      await row.click();
      await untilPresent(page, ".account-modal", 10_000);
      const read = (await page.evaluate(
        `(() => {
          const card = document.querySelector(".account-modal");
          if (!card) return null;
          const opener = [...card.querySelectorAll("button")].find((n) =>
            /Meetings/.test(n.textContent || ""),
          );
          if (opener) opener.click();
          return new Promise((r) =>
            setTimeout(() => {
              const text = (card.textContent || "").replace(/\\s+/g, " ");
              r({
                soonAt: text.indexOf("Meetings in the next 30 days"),
                laterAt: text.indexOf("Upcoming meetings after that"),
                closedAt: text.indexOf("Canceled or concluded"),
              });
            }, 1200),
          );
        })()`,
      )) as { soonAt: number; laterAt: number; closedAt: number } | null;

      if (!read) {
        cannotRun(
          "F01",
          "3.1: a meetings list leads with the upcoming group",
          "the battlecard did not open",
        );
      } else {
        const present = [read.soonAt, read.laterAt, read.closedAt].filter((n) => n >= 0);
        if (present.length === 0) {
          cannotRun(
            "F01",
            "3.1: a meetings list leads with the upcoming group",
            "no group header rendered — this body may hold no meetings at all, so the ordering was not exercised",
          );
        } else {
          // Groups appear in the specified order, and the concluded block is never first.
          const ascending = present.every((v, i) => i === 0 || present[i - 1] < v);
          const closedIsNotFirst = read.closedAt < 0 || present[0] !== read.closedAt;
          check(
            "F01",
            "3.1: a meetings list leads with the upcoming group",
            ascending && closedIsNotFirst,
            `soon@${read.soonAt} later@${read.laterAt} closed@${read.closedAt}`,
          );
        }
      }
    }
  } finally {
    await page.close();
  }
}

{
  /* The struck gap phrasing is off the served build, not merely out of the source tree. */
  for (const path of ["/", "/ballot?zip=85701", "/transparency"]) {
    const response = await fetch(`${BASE}${path}`, { headers: RUN_HEADERS });
    countProbe(`${BASE}${path}`);
    if (!response.ok) {
      cannotRun("F01", `6.1: no "gap in our" phrasing on ${path}`, `HTTP ${response.status}`);
      continue;
    }
    const html = await response.text();
    check(
      "F01",
      `6.1: no "gap in our" phrasing on ${path}`,
      !/gap in our (data|research)/i.test(html),
      `${html.length} bytes read`,
    );
  }
}

{
  /* The struck never-store/never-log promise is off the served build. */
  const response = await fetch(`${BASE}/transparency`, { headers: RUN_HEADERS });
  countProbe(`${BASE}/transparency`);
  if (!response.ok) {
    cannotRun(
      "F01",
      "1e: the struck never-store promise is gone from the address copy",
      `HTTP ${response.status}`,
    );
  } else {
    const html = await response.text();
    const para =
      html.split(/<\/p>/).find((c) => /Census Bureau/.test(c) && /passes through/.test(c)) ?? "";
    check(
      "F01",
      "1e: the struck never-store promise is gone from the address copy",
      para.length > 0 && !/never (store|log)/i.test(para),
      para ? `address paragraph read, ${para.length} bytes` : "no address paragraph on the page",
    );
  }
}

{
  /* The ballot page states the order it actually uses. */
  const response = await fetch(`${BASE}/ballot?zip=85701`, { headers: RUN_HEADERS });
  countProbe(`${BASE}/ballot?zip=85701`);
  if (!response.ok) {
    cannotRun("F01", "11.3/11.4: the ballot states its real order and no recommendation", `HTTP ${response.status}`);
  } else {
    const html = await response.text();
    check(
      "F01",
      "11.3/11.4: the ballot states its real order and no recommendation",
      !/listed alphabetically by surname/i.test(html) &&
        /Nothing on this page is a recommendation/i.test(html),
      `${html.length} bytes read`,
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// The reader's own ballot counts all of it, and a clear is a clear.
// ═══════════════════════════════════════════════════════════════════════════

section("F01C. The picks tally and the clear (F01-continued, 2026-08-19)");

/* The tally counts every pick-bearing row, and clearing a pick clears it on every surface. */
for (const zip of ["85701", "03255"]) {
  const context = await browser.context({
    extraHTTPHeaders: RUN_HEADERS,
    viewport: PHONE,
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  page.on("response", (r) => countProbe(r.url()));
  try {
    await page.goto(`${BASE}/ballot?zip=${zip}`, {
      waitUntil: "domcontentloaded",
      timeout: 90_000,
    });
    // Wait for the element this check clicks, hydrated.
    await untilInteractive(page, PICK_CHOICE, 12_000);

    const controls = await page.locator('.reaction-box[data-kind="pick"]').count();
    if (controls === 0) {
      cannotRun("F01C", `${zip}: the picks tally's denominator`, "no pick control on the page");
      continue;
    }

    await page.locator(PICK_CHOICE).first().click();
    const raised = await untilText(page, /races and measures on this ballot/i, 10_000);
    if (!raised) {
      cannotRun(
        "F01C",
        `${zip}: the picks tally's denominator`,
        "the tally never appeared after a pick — see 0814c's hydration note",
      );
      continue;
    }

    const tally = (await page.evaluate(
      `(() => {
         const e = document.querySelector("[data-pick-tally]");
         if (!e) return null;
         return {
           picked: Number(e.getAttribute("data-picked")),
           pickable: Number(e.getAttribute("data-pickable")),
           rows: document.querySelectorAll("[data-pick-tally] ~ ul > li").length,
         };
       })()`,
    )) as { picked: number; pickable: number; rows: number } | null;

    if (!tally) {
      cannotRun("F01C", `${zip}: the picks tally's denominator`, "no [data-pick-tally] element");
      continue;
    }

    // The denominator is the rendered rows, not a number about them.
    check(
      "F01C",
      `${zip}: the picks tally's denominator equals the pick controls on the page`,
      tally.pickable === controls,
      `M=${tally.pickable}, pick controls rendered=${controls}`,
    );
    check(
      "F01C",
      `${zip}: the picks tally's stated N equals its rendered rows`,
      tally.picked === tally.rows && tally.picked >= 1,
      `N=${tally.picked}, rows=${tally.rows}`,
    );

    // A clear is a clear, on every pick-bearing surface.
    await page.getByRole("button", { name: "Clear my picks" }).click();
    await untilPresent(page, '[role="dialog"][aria-label="Clear my picks"]', 8_000);
    await page.getByRole("button", { name: "Clear", exact: true }).click();
    await until(
      page,
      async () => !(await page.locator("[data-pick-tally]").count()),
      8_000,
    );

    const after = (await page.evaluate(
      `(() => ({
         box: document.querySelectorAll("[data-pick-tally]").length,
         stated: Array.from(document.querySelectorAll(".reaction-box-prompt"))
           .map((e) => (e.textContent || "").trim())
           .filter((t) => /^Your pick for this race:/.test(t)).length,
         stored: window.localStorage.getItem("wtp.ballot_picks") || "",
       }))()`,
    )) as { box: number; stated: number; stored: string };

    check(
      "F01C",
      `${zip}: after a clear, no surface still reflects a pick`,
      after.box === 0 && after.stated === 0,
      `picks box ${after.box}, contests still stating a pick ${after.stated}`,
    );
    check(
      "F01C",
      `${zip}: after a clear, the stored picks file holds none`,
      !/"choiceIds"/.test(after.stored),
      after.stored ? `${after.stored.length} bytes stored` : "nothing stored",
    );
  } finally {
    await context.close();
  }
}


// ═══════════════════════════════════════════════════════════════════════════
// The battlecard, the positions search, the calendar and the placeholder.
// ═══════════════════════════════════════════════════════════════════════════

section("F01C2. Items 12-17 on the deploy (F01-continued session 2, 2026-08-19)");

/* Read-only: nothing below taps a reaction or submits an ask. */
for (const zip of ["07866", "85701"]) {
  const context = await browser.context({
    extraHTTPHeaders: RUN_HEADERS,
    viewport: PHONE,
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  page.on("response", (r) => countProbe(r.url()));
  try {
    await page.goto(`${BASE}/ballot?zip=${zip}`, {
      waitUntil: "domcontentloaded",
      timeout: 90_000,
    });
    await untilInteractive(page, "[data-battlecard-pill]", 15_000);

    const rows = await page.locator(".candidate-row").count();
    const pills = await page.locator("[data-battlecard-pill]").count();

    /* Every check in this block declares an ending when it cannot run. */
    const BLOCK_CHECKS: [string, string][] = [
      ["F01C2", `${zip}: every candidate row carries a battlecard pill`],
      ["NHHUNT", `${zip}: no per-card completeness count or enumeration anywhere on the ballot`],
      ["F01C2", `${zip}: every dated voting event can be calendared`],
      ["F01C2", `${zip}: a multi-day window carries the affordance too`],
      ["F01C2", `${zip}: the battlecard holds the sections the row gave up`],
      ["F01C2", `${zip}: the positions search finds a term from the card's own text`],
      ["F01C2", `${zip}: the polling-place affordance is an in-app pill, not a link out`],
      ["F01C2", `${zip}: the in-app voting panel opens on the ballot`],
      ["F01C2", `${zip}: the placeholder address names no region`],
      ["F22", `${zip}: the polling-place pointer renders exactly once on the ballot`],
    ];
    if (rows === 0) {
      for (const [session, name] of BLOCK_CHECKS) {
        cannotRun(session, name, "no candidate rows on the page");
      }
      continue;
    }

    // One pill per row, so no candidate is better rendered than another.
    check(
      "F01C2",
      `${zip}: every candidate row carries a battlecard pill`,
      pills === rows,
      `${pills} pills for ${rows} rows`,
    );

    /* The retired per-row count must not come back. */
    const onRow = (await page.evaluate(
      `(() => ({
         annotations: document.querySelectorAll('[data-gap-annotation]').length,
         enumerations: document.querySelectorAll('[data-gap-enumeration]').length,
       }))()`,
    )) as { annotations: number; enumerations: number };
    check(
      "NHHUNT",
      `${zip}: no per-card completeness count or enumeration anywhere on the ballot`,
      onRow.annotations === 0 && onRow.enumerations === 0,
      `${onRow.annotations} annotations, ${onRow.enumerations} enumerations on the page`,
    );

    // Every dated voting event with a known date is one tap from a calendar.
    const dated = (await page.evaluate(
      `(() => {
         const rows = Array.from(document.querySelectorAll('[data-dated-event]'));
         return rows.map((r) => ({
           text: (r.textContent || '').trim().slice(0, 80),
           hasButton: Boolean(r.querySelector('button')),
           isWindow: /\\d{2}\\/\\d{2}\\/\\d{4}\\s*[-\\u2013\\u2014]\\s*\\d{2}\\/\\d{2}\\/\\d{4}/.test(r.textContent || ''),
         }));
       })()`,
    )) as { text: string; hasButton: boolean; isWindow: boolean }[];
    if (dated.length === 0) {
      cannotRun("F01C2", `${zip}: every dated voting event can be calendared`, "no [data-dated-event] on the page");
      cannotRun("F01C2", `${zip}: a multi-day window carries the affordance too`, "no [data-dated-event] on the page");
    } else {
      /* A past event is not calendar material. */
      const today = phoenixDay();
      const upcoming = dated.filter((d) => {
        const found = d.text.match(/\d{2}\/\d{2}\/\d{4}/g) ?? [];
        if (found.length === 0) return false;
        const last = found[found.length - 1];
        const [m, day, y] = last.split("/");
        return `${y}-${m}-${day}` >= today;
      });
      const missing = upcoming.filter((d) => !d.hasButton);
      check(
        "F01C2",
        `${zip}: every dated voting event can be calendared`,
        missing.length === 0,
        missing.length === 0
          ? `${upcoming.length} of ${dated.length} dated events are still ahead, all with the affordance` +
            ` (${dated.length - upcoming.length} past, correctly without)`
          : `${missing.length} of ${upcoming.length} upcoming without: ${missing.map((m) => m.text).join(" | ")}`,
      );
      const windows = dated.filter((d) => d.isWindow);
      check(
        "F01C2",
        `${zip}: a multi-day window carries the affordance too`,
        windows.every((w) => w.hasButton),
        `${windows.length} window(s) rendered${windows.length ? `: ${windows.map((w) => w.text).join(" | ")}` : " — none on this zip, which is not a failure"}`,
      );
    }

    /* Open cards until one holds quoted positions text, up to a stated cap; none is the honest could-not-run. */
    const CARDS_TO_TRY = 6;
    let opened = false;
    let cardIndex = -1;
    for (let i = 0; i < Math.min(CARDS_TO_TRY, pills); i++) {
      await page.locator("[data-battlecard-pill]").nth(i).scrollIntoViewIfNeeded();
      await page.locator("[data-battlecard-pill]").nth(i).click();
      opened = await untilInteractive(page, "[data-candidate-battlecard]", 10_000);
      cardIndex = i;
      if (!opened) break;
      const hasQuotes = await page.evaluate(
        `(() => {
           const card = document.querySelector('[data-candidate-battlecard]');
           if (!card) return false;
           return card.querySelectorAll('blockquote, [data-candidate-positions] li').length > 0;
         })()`,
      );
      if (hasQuotes) break;
      if (i < Math.min(CARDS_TO_TRY, pills) - 1) {
        await page.keyboard.press("Escape");
        await page
          .locator("[data-candidate-battlecard]")
          .waitFor({ state: "detached", timeout: 5_000 })
          .catch(() => {});
      }
    }
    if (!opened) {
      cannotRun("F01C2", `${zip}: the battlecard opens and holds the moved sections`, "the card never opened");
      continue;
    }

    const inside = (await page.evaluate(
      `(() => {
         const card = document.querySelector('[data-candidate-battlecard]');
         if (!card) return null;
         return {
           positions: card.querySelectorAll('[data-candidate-positions]').length,
           enumerations: card.querySelectorAll('[data-gap-enumeration]').length,
           search: card.querySelectorAll('[data-positions-search]').length,
         };
       })()`,
    )) as { positions: number; enumerations: number; search: number } | null;
    check(
      "F01C2",
      `${zip}: the battlecard holds the sections the row gave up`,
      // A battlecard with no published words renders no positions section, so 0 is legitimate; the enumeration never is.
      Boolean(inside) && inside!.enumerations === 0,
      inside ? `positions ${inside.positions}, enumerations ${inside.enumerations}` : "no card",
    );

    /* A card holding positions must return hits for a term read off its own positions text. */
    const term = (await page.evaluate(
      `(() => {
         const card = document.querySelector('[data-candidate-battlecard]');
         if (!card) return null;
         const quotes = Array.from(card.querySelectorAll('blockquote, [data-candidate-positions] li'));
         const text = quotes.map((q) => q.textContent || '').join(' ');
         const words = (text.toLowerCase().match(/[a-z]{6,14}/g) || []);
         const counted = new Map();
         for (const w of words) counted.set(w, (counted.get(w) || 0) + 1);
         const best = Array.from(counted.entries()).sort((a, b) => b[1] - a[1])[0];
         return best ? best[0] : null;
       })()`,
    )) as string | null;

    if (!term) {
      cannotRun(
        "F01C2",
        `${zip}: the positions search finds a term from the card's own text`,
        `opened ${cardIndex + 1} of ${Math.min(CARDS_TO_TRY, pills)} cards and none held quoted positions text to draw a term from — not a zero result`,
      );
    } else {
      /* The search box is inside a collapsed section; an unreachable box is could-not-run, never a thrown error. */
      /* The section toggle is a `button.card-section-header` (components/officials/card-section.tsx). */
      const header = page
        .locator("[data-candidate-battlecard] .card-section-header", {
          hasText: /positions/i,
        })
        .first();
      if ((await header.count()) > 0) {
        await header.scrollIntoViewIfNeeded().catch(() => {});
        await header.click().catch(() => {});
      }
      const box = page.locator("[data-positions-search]").first();
      const reachable = await box
        .waitFor({ state: "visible", timeout: 8_000 })
        .then(() => true)
        .catch(() => false);
      if (!reachable) {
        cannotRun(
          "F01C2",
          `${zip}: the positions search finds a term from the card's own text`,
          "the search box did not become reachable inside the card — this is a " +
            "failure to reach the control, never a zero-result search",
        );
      } else {
      await box.fill(term);
      const answered = await untilText(page, /last checked|none of them mentions|only inside a block|could not read/i, 12_000);
      const got = (await page.evaluate(
        `(() => {
           const card = document.querySelector('[data-candidate-battlecard]');
           if (!card) return null;
           const el = card.querySelector('[data-positions-answer]');
           return el ? el.getAttribute('data-positions-answer') : 'NONE';
         })()`,
      )) as string | null;
      check(
        "F01C2",
        `${zip}: the positions search finds a term from the card's own text`,
        answered && got === "MATCHED",
        `term "${term}" -> ${got ?? "no answer element"}`,
      );
      }
    }

    // The polling-place affordance stays in the app, and its placeholder names no region.
    await page.keyboard.press("Escape");
    const where = await page.locator("[data-where-to-vote-pill]").count();
    check(
      "F01C2",
      `${zip}: the polling-place affordance is an in-app pill, not a link out`,
      where > 0,
      `${where} in-app pill(s)`,
    );
    // The pointer appears once per page, in the dates header.
    check(
      "F22",
      `${zip}: the polling-place pointer renders exactly once on the ballot`,
      where === 1,
      `${where} in-app pill(s) — once per page since the F21 ruling`,
    );
    if (where === 0) {
      // With no pill there is nothing to open, so the two checks inside declare.
      cannotRun("F01C2", `${zip}: the in-app voting panel opens on the ballot`, "no polling-place pill to open");
      cannotRun("F01C2", `${zip}: the placeholder address names no region`, "no polling-place pill to open");
    } else {
      await page.locator("[data-where-to-vote-pill]").first().scrollIntoViewIfNeeded();
      await page.locator("[data-where-to-vote-pill]").first().click();
      const panel = await untilInteractive(page, ".voting-panel-input", 10_000);
      if (!panel) {
        cannotRun("F01C2", `${zip}: the in-app voting panel opens on the ballot`, "the panel never appeared");
        cannotRun("F01C2", `${zip}: the placeholder address names no region`, "the panel never appeared");
      } else {
        const placeholder = await page
          .locator(".voting-panel-input")
          .first()
          .getAttribute("placeholder");
        check(
          "F01C2",
          `${zip}: the in-app voting panel opens on the ballot`,
          true,
          "the same panel the map pill opens",
        );
        check(
          "F01C2",
          `${zip}: the placeholder address names no region`,
          placeholder === "123 Main St, Anywhere, USA",
          `placeholder is "${placeholder}"`,
        );
      }
    }
  } finally {
    await context.close();
  }
}


/*
 * The ballot at desktop width, the ask affordance, and the measure text. The
 * block's checks are named up front and every early exit declares all of them.
 */
section("BAL-25/26/30 — the ballot at desktop width, and Ask where a reader can find it");

/** The local measures whose text is checked, named rather than derived. */
const BAL30_LOCAL_MEASURES = [
  "ballot-az-pima:prop-423",
  "ballot-az-pima:prop-425",
  "ballot-az-pima:prop-428",
  "ballot-az-pima:prop-429",
];

interface BallotSurfaceRead {
  overflow: number;
  mainWidth: number;
  proseWidth: number;
  officeLefts: number[];
  candidateLefts: number[];
  candidateCount: number;
  firstContestTop: number;
  pillTop: number;
  statewideIds: string[];
  localIds: string[];
  questions: number;
  questionChars: number;
  statementPresent: number;
  statementGap: number;
  gapText: string;
  presentText: string;
}

/* One read, both widths. Document coordinates for the vertical claims. */
const READ_BALLOT_SURFACE = `(() => {
  const round = (n) => Math.round(n);
  const main = document.querySelector('main');
  const prose = document.querySelector('main p.text-voice') || document.querySelector('main p');
  const contests = Array.from(document.querySelectorAll('[data-contest-id]'));
  const offices = Array.from(document.querySelectorAll('.ballot-office-list > [data-contest-id]'));
  const candidates = Array.from(document.querySelectorAll('.ballot-candidate-grid > [data-candidate-target]'));
  const pill = document.querySelector('[data-ballot-ask-pill]');
  const scoped = (scope) => Array.from(
    document.querySelectorAll('[data-measure-scope="' + scope + '"] [data-contest-id]'),
  ).map((el) => el.getAttribute('data-contest-id'));
  const gap = document.querySelector('[data-measure-statement="GAP_OURS"]');
  const present = document.querySelector('[data-measure-statement="PRESENT"]');
  const questions = Array.from(document.querySelectorAll('[data-measure-question]'));
  return {
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    mainWidth: main ? round(main.getBoundingClientRect().width) : 0,
    proseWidth: prose ? round(prose.getBoundingClientRect().width) : 0,
    officeLefts: offices.map((c) => round(c.getBoundingClientRect().left)),
    candidateLefts: candidates.map((c) => round(c.getBoundingClientRect().left)),
    candidateCount: candidates.length,
    firstContestTop: contests.length
      ? round(contests[0].getBoundingClientRect().top + window.scrollY)
      : -1,
    pillTop: pill ? round(pill.getBoundingClientRect().top + window.scrollY) : -1,
    statewideIds: scoped('STATEWIDE'),
    localIds: scoped('LOCAL'),
    questions: questions.length,
    questionChars: questions.reduce((n, q) => n + (q.textContent || '').trim().length, 0),
    statementPresent: document.querySelectorAll('[data-measure-statement="PRESENT"]').length,
    statementGap: document.querySelectorAll('[data-measure-statement="GAP_OURS"]').length,
    gapText: gap ? (gap.textContent || '').trim() : '',
    presentText: present ? (present.textContent || '').trim() : '',
  };
})()`;

/*
 * The control zip renders measures both with and without an official
 * statement, so both branches can be asserted not to read alike. A zip with
 * no measures exercises the declaration path.
 */
for (const zip of ["85629", "07866"]) {
  const WIDE_CHECKS: [string, string][] = [
    ["BAL25", `${zip}: the ballot fills the desktop width rather than a 672px column`],
    ["BAL25", `${zip}: offices stack and candidates use two columns at 1280`],
    ["BAL25", `${zip}: the ballot does not scroll sideways at 1280`],
    ["BAL25", `${zip}: prose keeps a readable measure while the container widens`],
    ["BAL26", `${zip}: the Ask affordance sits ABOVE the contests at 1280`],
    ["BAL26", `${zip}: the Ask panel opens from the pill at 1280, input and submit inside it`],
    ["BAL30", `${zip}: every measure with recorded question text renders it`],
    ["BAL30", `${zip}: a measure with no recorded statement names the gap as OURS`],
    ["BAL30", `${zip}: no local measure renders under the statewide heading`],
  ];

  const wide = await openWideAt(browser, zip);
  try {
    await wide.goto(`${BASE}/ballot?zip=${zip}`, {
      waitUntil: "domcontentloaded",
      timeout: 90_000,
    });
    const ready = await untilInteractive(wide, "[data-contest-id]", 20_000);
    if (!ready) {
      for (const [s, n] of WIDE_CHECKS) {
        cannotRun(s, n, `no [data-contest-id] rendered at 1280x900 for ${zip}`);
      }
    } else {
      const read = (await wide.evaluate(READ_BALLOT_SURFACE)) as BallotSurfaceRead;

      /* The container at 1280 measures ~1088px; anything near 672 is the old narrow column back. */
      check(
        "BAL25",
        `${zip}: the ballot fills the desktop width rather than a 672px column`,
        read.mainWidth > 900,
        `main measures ${read.mainWidth}px at a 1280px viewport (it was 672)`,
      );

      /* The second column is within an office; whole office blocks stay in one top-to-bottom sequence. */
      const lefts = [...new Set(read.candidateLefts)];
      const officeLefts = [...new Set(read.officeLefts)];
      if (read.candidateCount < 2) {
        cannotRun(
          "BAL25",
          `${zip}: offices stack and candidates use two columns at 1280`,
          `${read.candidateCount} candidate(s) on the page — a second column needs a second card, and this is a failure to reach the subject rather than a zero result`,
        );
      } else {
        check(
          "BAL25",
          `${zip}: offices stack and candidates use two columns at 1280`,
          officeLefts.length === 1 && lefts.length === 2,
          `${officeLefts.length} office column; ${read.candidateCount} candidates across ${lefts.length} column position(s): ${lefts.join(", ")}`,
        );
      }

      check(
        "BAL25",
        `${zip}: the ballot does not scroll sideways at 1280`,
        read.overflow <= 0,
        `${read.overflow}px of horizontal overflow`,
      );

      /* The prose stays at 42rem (672px) while the container widens; the allowance is for the border box. */
      check(
        "BAL25",
        `${zip}: prose keeps a readable measure while the container widens`,
        read.proseWidth > 0 &&
          read.proseWidth <= 700 &&
          read.mainWidth > read.proseWidth + 200,
        `prose ${read.proseWidth}px inside a ${read.mainWidth}px container`,
      );

      /* The ask affordance is above the reading. */
      if (read.pillTop < 0) {
        cannotRun(
          "BAL26",
          `${zip}: the Ask affordance sits ABOVE the contests at 1280`,
          "no [data-ballot-ask-pill] on the page",
        );
        cannotRun(
          "BAL26",
          `${zip}: the Ask panel opens from the pill at 1280, input and submit inside it`,
          "no [data-ballot-ask-pill] to open",
        );
      } else {
        check(
          "BAL26",
          `${zip}: the Ask affordance sits ABOVE the contests at 1280`,
          read.firstContestTop < 0 || read.pillTop < read.firstContestTop,
          `pill at y=${read.pillTop}, first contest at y=${read.firstContestTop} — it used to sit below every one of them`,
        );

        await wide.locator("[data-ballot-ask-pill]").first().click();
        const opened = await untilInteractive(
          wide,
          "[data-ballot-ask] [data-ask-input]",
          8_000,
        );
        const contract = (await wide.evaluate(
          `(() => {
             const s = document.querySelector('[data-ballot-ask]');
             const p = document.querySelector('[data-ballot-ask-pill]');
             return {
               section: s ? 1 : 0,
               input: s ? s.querySelectorAll('[data-ask-input]').length : 0,
               submit: s ? s.querySelectorAll('[data-ask-submit]').length : 0,
               expanded: p ? p.getAttribute('aria-expanded') : null,
               overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
             };
           })()`,
        )) as {
          section: number;
          input: number;
          submit: number;
          expanded: string | null;
          overflow: number;
        };
        check(
          "BAL26",
          `${zip}: the Ask panel opens from the pill at 1280, input and submit inside it`,
          opened &&
            contract.section === 1 &&
            contract.input === 1 &&
            contract.submit === 1 &&
            contract.expanded === "true" &&
            contract.overflow <= 0,
          `section ${contract.section}, input ${contract.input}, submit ${contract.submit}, aria-expanded ${contract.expanded}, overflow ${contract.overflow}px`,
        );
      }

      /* The official measure question renders; a ballot with no measures declares rather than passes. */
      const rendered = [...read.statewideIds, ...read.localIds];
      if (read.questions === 0 && rendered.length === 0) {
        cannotRun("BAL30", `${zip}: every measure with recorded question text renders it`, "no measures on this ballot");
        cannotRun("BAL30", `${zip}: a measure with no recorded statement names the gap as OURS`, "no measures on this ballot");
        cannotRun("BAL30", `${zip}: no local measure renders under the statewide heading`, "no measures on this ballot");
      } else {
        check(
          "BAL30",
          `${zip}: every measure with recorded question text renders it`,
          read.localIds.length > 0 && read.questions >= read.localIds.length && read.questionChars > 500,
          `${read.questions} question block(s), ${read.questionChars} characters of official wording on screen`,
        );

        /* The control: a measure with a null statement must render and must not read like one with a statement. */
        check(
          "BAL30",
          `${zip}: a measure with no recorded statement names the gap as OURS`,
          read.statementPresent >= 1 &&
            read.statementGap >= 1 &&
            read.gapText.length > 0 &&
            read.gapText !== read.presentText &&
            /we have not recorded/i.test(read.gapText),
          `${read.statementPresent} statement(s) rendered, ${read.statementGap} named gap(s); the gap reads "${read.gapText.slice(0, 90)}"`,
        );

        const misfiled = read.statewideIds.filter((id) =>
          BAL30_LOCAL_MEASURES.includes(id),
        );
        check(
          "BAL30",
          `${zip}: no local measure renders under the statewide heading`,
          misfiled.length === 0,
          misfiled.length === 0
            ? `${read.statewideIds.length} statewide, ${read.localIds.length} local`
            : `filed as statewide: ${misfiled.join(", ")}`,
        );
      }
    }
  } finally {
    await wide.context().close();
  }

  /* The same affordance at phone width, where the page is longest. */
  const phoneContext = await browser.context({
    extraHTTPHeaders: RUN_HEADERS,
    viewport: PHONE,
    reducedMotion: "reduce",
  });
  const phone = await phoneContext.newPage();
  phone.on("response", (r) => countProbe(r.url()));
  try {
    await phone.goto(`${BASE}/ballot?zip=${zip}`, {
      waitUntil: "domcontentloaded",
      timeout: 90_000,
    });
    const ready = await untilInteractive(phone, "[data-ballot-ask-pill]", 20_000);
    if (!ready) {
      cannotRun("BAL26", `${zip}: the Ask affordance sits ABOVE the contests at 390`, "no [data-ballot-ask-pill] at 390x844");
      cannotRun("BAL26", `${zip}: the Ask panel opens at 390 without pushing the page sideways`, "no [data-ballot-ask-pill] at 390x844");
      cannotRun("BAL25", `${zip}: the ballot does not scroll sideways at 390`, "the ballot never rendered at 390x844");
    } else {
      const read = (await phone.evaluate(READ_BALLOT_SURFACE)) as BallotSurfaceRead;
      /* No horizontal overflow at phone width, measured rather than looked at. */
      check(
        "BAL25",
        `${zip}: the ballot does not scroll sideways at 390`,
        read.overflow <= 0,
        `${read.overflow}px of horizontal overflow at 390x844`,
      );
      check(
        "BAL26",
        `${zip}: the Ask affordance sits ABOVE the contests at 390`,
        read.pillTop >= 0 &&
          (read.firstContestTop < 0 || read.pillTop < read.firstContestTop),
        `pill at y=${read.pillTop}, first contest at y=${read.firstContestTop}`,
      );

      await phone.locator("[data-ballot-ask-pill]").first().click();
      const opened = await untilInteractive(
        phone,
        "[data-ballot-ask] [data-ask-input]",
        8_000,
      );
      const after = (await phone.evaluate(
        `(() => ({
           overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
           input: document.querySelectorAll('[data-ballot-ask] [data-ask-input]').length,
           submit: document.querySelectorAll('[data-ballot-ask] [data-ask-submit]').length,
         }))()`,
      )) as { overflow: number; input: number; submit: number };
      check(
        "BAL26",
        `${zip}: the Ask panel opens at 390 without pushing the page sideways`,
        opened && after.input === 1 && after.submit === 1 && after.overflow <= 0,
        `input ${after.input}, submit ${after.submit}, ${after.overflow}px of horizontal overflow`,
      );
    }
  } finally {
    await phoneContext.close();
  }
}

/* ── The two-column ballot has no holes in it ────────────────────────────── */

/**
 * The gaps between consecutive cards in one column, measured as DOM geometry.
 * A generous ceiling rather than today's number: it catches a hole an order of
 * magnitude larger than the gap, not a restyle.
 */
const BALLOT_GAP_CEILING_PX = 60;

const BALLOT_COLUMNS_READ = `(() => {
  const out = [];
  for (const grid of document.querySelectorAll('.ballot-card-grid, .ballot-candidate-grid')) {
    const cards = [...grid.querySelectorAll(':scope > [data-contest-id], :scope > [data-candidate-target]')].map((el) => {
      const r = el.getBoundingClientRect();
      return {
        id: el.getAttribute('data-contest-id') || el.getAttribute('data-candidate-target'),
        x: Math.round(r.x),
        y: Math.round(r.y + window.scrollY),
        h: Math.round(r.height),
        w: Math.round(r.width),
      };
    });
    if (cards.length === 0) continue;
    const byColumn = {};
    for (const c of cards) {
      byColumn[c.x] = byColumn[c.x] || [];
      byColumn[c.x].push(c);
    }
    const columns = Object.keys(byColumn).map((x) => {
      const col = byColumn[x].sort((a, b) => a.y - b.y);
      const gaps = [];
      for (let i = 1; i < col.length; i += 1) {
        gaps.push(col[i].y - (col[i - 1].y + col[i - 1].h));
      }
      return { x: Number(x), count: col.length, top: col[0].y, widths: [...new Set(col.map((c) => c.w))], gaps };
    });
    out.push({ cards: cards.length, columns });
  }
  return out;
})()`;

interface BallotColumns {
  cards: number;
  columns: { x: number; count: number; top: number; widths: number[]; gaps: number[] }[];
}

for (const zip of ["85701", "07866"]) {
  const BLOCK: [string, string][] = [
    ["SB0831", `${zip}: the two-column ballot has no hole between consecutive cards`],
    ["SB0831", `${zip}: both ballot columns start at the same height`],
    ["SB0831", `${zip}: the ballot really is two columns of equal width at 1280`],
  ];
  const wide = await openWideAt(browser, zip);
  try {
    await wide.goto(`${BASE}/ballot?zip=${zip}`, {
      waitUntil: "domcontentloaded",
      timeout: 90_000,
    });
    const ready = await untilInteractive(wide, "[data-contest-id]", 20_000);
    if (!ready) {
      for (const [session, name] of BLOCK) {
        cannotRun(session, name, "no contest cards rendered on this ballot");
      }
      continue;
    }
    const grids = (await wide.evaluate(BALLOT_COLUMNS_READ)) as BallotColumns[];
    const multi = grids.filter((g) => g.columns.length > 1);
    if (multi.length === 0) {
      for (const [session, name] of BLOCK) {
        cannotRun(
          session,
          name,
          `no grid on this ballot laid out in more than one column at 1280 (${grids.length} grid(s) read)`,
        );
      }
      continue;
    }

    /* A ceiling on the gap distinguishes spaced cards from a column with a hole. */
    const allGaps = multi.flatMap((g) => g.columns.flatMap((c) => c.gaps));
    const worst = allGaps.length > 0 ? Math.max(...allGaps) : 0;
    check(
      "SB0831",
      BLOCK[0][1],
      allGaps.length > 0 && worst <= BALLOT_GAP_CEILING_PX,
      `${allGaps.length} gap(s) across ${multi.length} multi-column grid(s); largest ${worst}px ` +
        `(ceiling ${BALLOT_GAP_CEILING_PX}); distinct ${[...new Set(allGaps)].sort((a, b) => a - b).join(",")}`,
    );

    /* The "misaligned boxes" half: the columns of one grid start level. */
    const tops = multi.map((g) => [...new Set(g.columns.map((c) => c.top))]);
    check(
      "SB0831",
      BLOCK[1][1],
      tops.every((t) => t.length === 1),
      `column tops per grid: ${tops.map((t) => t.join("/")).join(" · ")}`,
    );

    /* Candidates sit inside full-width offices; each pair has equal widths, and measure cards have their own envelope. */
    const widths = multi.flatMap((g) => g.columns.flatMap((c) => c.widths));
    check(
      "SB0831",
      BLOCK[2][1],
      multi.every((g) => g.columns.length === 2 &&
        new Set(g.columns.flatMap((c) => c.widths)).size === 1),
      `${multi.map((g) => g.columns.length).join("/")} column(s) per grid, ` +
        `width(s) ${[...new Set(widths)].join(",")}`,
    );
  } finally {
    await wide.context().close();
  }
}

/* ── Out-of-scope entities are absent from the post-address panel ─────────── */

/**
 * The post-address panel, on the rendered DOM. The address is confirmed the way
 * a reader confirms one: POST to `/api/address/resolve` and write the result
 * into sessionStorage in the shape `writeSessionAddress` writes, then let the
 * surface re-render. Every check reads the panel after confirmation.
 */
const SCOPE_ADDRESSES: { zip: string; street: string; houseNumber: string }[] = [
  { zip: "85641", street: "South Bear Table Tank Drive", houseNumber: "10723" },
  { zip: "85701", street: "E Congress St", houseNumber: "" },
  { zip: "07866", street: "W Main St", houseNumber: "" },
  { zip: "03255", street: "Bay Point Rd", houseNumber: "" },
];

/** The levels the panel's State and Federal sections own. */
const SCOPE_LEVELS = ["sldl", "sldu", "cd"];

/** The deepest OCD segment's key — `lib/state/resolved-location.ts`'s split. */
function scopeLevelOf(ocdId: string): string {
  const last = ocdId.split("/").pop() ?? "";
  const colon = last.indexOf(":");
  return colon === -1 ? "" : last.slice(0, colon);
}

interface ScopeRead {
  rows: { standing: string; sourcing: string; label: string }[];
  exclusionMarks: number;
  disclosures: number;
  excludedRows: number;
  notYoursCopy: boolean;
  ocdIdOnScreen: boolean;
}

/** What the panel is showing, read off the DOM and nothing else. */
const SCOPE_READ = `(() => {
  const rows = [...document.querySelectorAll('[data-seat-standing]')];
  const text = document.body.innerText || "";
  return {
    rows: rows.map((el) => ({
      standing: el.getAttribute('data-seat-standing') || "",
      sourcing: el.getAttribute('data-seat-sourcing') || "",
      label: (el.querySelector('.text-label') ? el.querySelector('.text-label').textContent : '').trim(),
    })),
    exclusionMarks: document.querySelectorAll('[data-standing="ELSEWHERE_IN_ZIP"]').length,
    disclosures: document.querySelectorAll('[data-elsewhere-disclosure]').length,
    excludedRows: document.querySelectorAll('[data-elsewhere-row]').length,
    notYoursCopy: text.indexOf('not yours') !== -1 || text.indexOf('covers another part of') !== -1,
    ocdIdOnScreen: text.indexOf('ocd-division') !== -1,
  };
})()`;

interface ScopeExpectation {
  divisionIds: string[];
  splitLevels: string[];
  contestIds: string[];
}

/** What the product's own resolver says this address settles: the expectation only, never written onto the page. */
async function resolveAddressExpectation(target: {
  zip: string;
  street: string;
  houseNumber: string;
}): Promise<ScopeExpectation | null> {
  try {
    const response = await fetch(`${BASE}/api/address/resolve`, {
      method: "POST",
      headers: { "content-type": "application/json", ...RUN_HEADERS },
      body: JSON.stringify({
        zip: target.zip,
        street: target.street,
        houseNumber: target.houseNumber,
      }),
    });
    const body = (await response.json()) as {
      resolution: {
        status: string;
        levels?: { level: string; divisionIds: string[]; certain: boolean }[];
      };
      contestIds?: string[];
    };
    const levels = body.resolution.levels ?? [];
    if (body.resolution.status === "FAILED" || levels.length === 0) return null;
    return {
      divisionIds: levels.filter((l) => l.certain).flatMap((l) => l.divisionIds),
      splitLevels: levels.filter((l) => !l.certain).map((l) => l.level),
      contestIds: body.contestIds ?? [],
    };
  } catch {
    return null;
  }
}

for (const target of SCOPE_ADDRESSES) {
  const BLOCK: [string, string][] = [
    [
      "SB0831",
      `${target.zip}: the districts a confirmed address settled are the districts the panel lists`,
    ],
    ["SB0831", `${target.zip}: no district the address ruled out is rendered, marked or disclosed`],
    ["SB0831", `${target.zip}: confirming an address CHANGES the panel to the resolved scope`],
    ["SB0831", `${target.zip}: no seat row renders an identifier or an unnamed district`],
  ];

  /* A zip whose test street stops resolving declares rather than skipping. */
  const resolved = await resolveAddressExpectation(target);

  if (!resolved) {
    for (const [session, name] of BLOCK) {
      cannotRun(
        session,
        name,
        `the resolver did not place ${target.street} in ${target.zip}, so no address was confirmed`,
      );
    }
    continue;
  }

  const ownDistricts = resolved.divisionIds.filter((id) => SCOPE_LEVELS.includes(scopeLevelOf(id)));
  const scopeJson = JSON.stringify(
    JSON.stringify({
      zip: target.zip,
      contestIds: resolved.contestIds,
      divisionIds: resolved.divisionIds,
      splitLevels: resolved.splitLevels,
      streetLabel: target.street,
      resolvedAt: new Date().toISOString(),
    }),
  );

  const page = await openAt(browser, target.zip);
  try {
    // The card is reached the way a reader reaches it.
    const wghPill = page.locator(".notice-fab").first();
    if (await wghPill.isVisible().catch(() => false)) {
      await wghPill.click();
      await until(page, async () => (await page.locator(".coverage-notice").count()) > 0, 8_000);
    }
    const opened = await untilPresent(page, "[data-seat-standing]", 15_000);
    if (!opened) {
      for (const [session, name] of BLOCK) {
        cannotRun(session, name, "the who-governs card rendered no seat rows to read");
      }
      continue;
    }
    const before = (await page.evaluate(SCOPE_READ)) as ScopeRead;

    await page.evaluate(
      `(() => {
        sessionStorage.setItem('wtp.session_address_scope', ${scopeJson});
        window.dispatchEvent(new StorageEvent('storage', { key: 'wtp.session_address_scope' }));
      })()`,
    );
    await untilSettled(page, "body", 400, 8_000);
    const after = (await page.evaluate(SCOPE_READ)) as ScopeRead;

    const confirmed = after.rows.filter((r) => r.standing === "CONFIRMED");
    const rendered = after.rows.map((r) => r.label).filter(Boolean);

    /* Every district the address confirmed at these levels is on the panel, confirmed and named; counts are compared. */
    check(
      "SB0831",
      BLOCK[0][1],
      confirmed.length === ownDistricts.length &&
        confirmed.every((r) => r.label.length > 0) &&
        after.rows.every((r) => r.standing === "CONFIRMED"),
      `the address confirmed ${ownDistricts.length} district(s) at these levels; the panel ` +
        `renders ${after.rows.length} row(s), ${confirmed.length} CONFIRMED: ` +
        `${rendered.join(" · ") || "none"}`,
    );

    /* An entity that does not govern this reader is out of scope, not annotated: all four old artefacts are refused together. */
    check(
      "SB0831",
      BLOCK[1][1],
      after.exclusionMarks === 0 &&
        after.disclosures === 0 &&
        after.excludedRows === 0 &&
        !after.notYoursCopy &&
        after.rows.every((r) => r.standing !== "ELSEWHERE_IN_ZIP"),
      `${after.exclusionMarks} exclusion mark(s), ${after.disclosures} disclosure(s), ` +
        `${after.excludedRows} disclosed row(s), exclusion copy on screen: ${after.notYoursCopy}, ` +
        `rows carrying ELSEWHERE_IN_ZIP: ` +
        `${after.rows.filter((r) => r.standing === "ELSEWHERE_IN_ZIP").length}`,
    );

    /* The panel must change when an address goes in. */
    const beforeLabels = before.rows.map((r) => r.label).sort().join("|");
    const afterLabels = after.rows.map((r) => r.label).sort().join("|");
    const wasUnsettled = before.rows.some((r) => r.standing === "UNSETTLED");
    check(
      "SB0831",
      BLOCK[2][1],
      (beforeLabels !== afterLabels || wasUnsettled) &&
        after.rows.every((r) => r.standing === "CONFIRMED"),
      `before: ${beforeLabels || "no rows"} [${before.rows.map((r) => r.standing).join(",")}] · ` +
        `after: ${afterLabels || "no rows"} [${after.rows.map((r) => r.standing).join(",")}]`,
    );

    /* A reader surface never prints an OCD-ID; an unnamed district row is a named gap, not a district. */
    check(
      "SB0831",
      BLOCK[3][1],
      !after.ocdIdOnScreen &&
        after.rows.every(
          (r) => r.label.length > 0 || r.sourcing === "looking" || r.sourcing === "unavailable",
        ),
      `ocd-division on screen: ${after.ocdIdOnScreen}; unnamed rows: ` +
        `${after.rows.filter((r) => r.label.length === 0).map((r) => r.sourcing).join(",") || "none"}`,
    );
  } finally {
    await page.context().close();
  }
}

/** The reader's own interaction, in one tab, with nothing supplied: the address is typed into the page's prompt. */
for (const target of SCOPE_ADDRESSES) {
  const LIVE: [string, string][] = [
    [
      "SC0831",
      `${target.zip}: typing an address into the prompt moves the panel in the same tab, no reload`,
    ],
    [
      "SC0831",
      `${target.zip}: the panel a reader sees after typing lists the districts the resolver settled`,
    ],
    ["SC0831", `${target.zip}: a device revisiting with a kept resolution lists the settled districts`],
    [
      "SC0831",
      `${target.zip}: on the revisit the banner is not the evidence — the LIST carries the districts`,
    ],
  ];

  const expectation = await resolveAddressExpectation(target);
  if (!expectation) {
    for (const [session, name] of LIVE) {
      cannotRun(
        session,
        name,
        `the resolver did not place ${target.street} in ${target.zip}, so no address was confirmed`,
      );
    }
    continue;
  }
  const ownDistricts = expectation.divisionIds.filter((id) =>
    SCOPE_LEVELS.includes(scopeLevelOf(id)),
  );

  const page = await openAt(browser, target.zip);
  try {
    const wghPill = page.locator(".notice-fab").first();
    if (await wghPill.isVisible().catch(() => false)) {
      await wghPill.click();
      await until(page, async () => (await page.locator(".coverage-notice").count()) > 0, 8_000);
    }
    if (!(await untilPresent(page, "[data-seat-standing]", 15_000))) {
      for (const [session, name] of LIVE) {
        cannotRun(session, name, "the who-governs card rendered no seat rows to read");
      }
      continue;
    }
    const before = (await page.evaluate(SCOPE_READ)) as ScopeRead;

    /* The door a reader uses: the pill renders only while rows carry the mark. */
    const pill = page.locator(".could-govern-notice-pill").first();
    if (await pill.isVisible().catch(() => false)) await pill.click();

    const street = page.locator('input[aria-label="Street"]').first();
    if (!(await street.isVisible().catch(() => false))) {
      for (const [session, name] of LIVE) {
        cannotRun(session, name, "the address prompt offered no street field to type into");
      }
      continue;
    }

    await untilInteractive(page, 'input[aria-label="Street"]');
    await street.fill(target.street);
    const submitted = page.waitForResponse(
      (response) => response.url().endsWith("/api/address/resolve") && response.request().method() === "POST",
      { timeout: 25_000 },
    ).then(async (response) => {
      const body = await response.json();
      return { http: response.status(), resolution: body.resolution?.status ?? "not recorded" };
    }).catch(() => ({ http: null, resolution: "NO RESPONSE OBSERVED" }));
    await page.locator(".address-prompt-fields button").first().click();
    const addressResponse = await submitted;

    /* Wait for the field, not for the page to go quiet. */
    const houseNumber = page.locator('input[aria-label="House number"]').first();
    if (target.houseNumber) {
      const asked = await page
        .waitForSelector('input[aria-label="House number"]', { timeout: 20_000 })
        .then(() => true)
        .catch(() => false);
      if (asked) {
        await houseNumber.fill(target.houseNumber);
        await page.locator(".address-prompt-fields button").first().click();
      }
    }

    /* Wait for every row to be CONFIRMED, which is what a settled address looks like. */
    await until(
      page,
      async () => {
        const now = (await page.evaluate(SCOPE_READ)) as ScopeRead;
        return now.rows.length > 0 && now.rows.every((r) => r.standing === "CONFIRMED");
      },
      20_000,
    );

    const after = (await page.evaluate(SCOPE_READ)) as ScopeRead;
    const addressPrompt = await page.evaluate(() => document.querySelector(".address-prompt")?.textContent ?? null);
    const beforeState = before.rows.map((r) => `${r.label}:${r.standing}`).sort().join("|");
    const afterState = after.rows.map((r) => `${r.label}:${r.standing}`).sort().join("|");

    /* The panel moved when the control changed. */
    check(
      "SC0831",
      LIVE[0][1],
      beforeState !== afterState && after.rows.every((r) => r.standing === "CONFIRMED"),
      `before: ${beforeState || "no rows"} · after: ${afterState || "no rows"} — ` +
        `${after.rows.filter((r) => r.standing === "CONFIRMED").length} of ${after.rows.length} CONFIRMED; ` +
        `resolver response ${JSON.stringify(addressResponse)}; prompt ${JSON.stringify(addressPrompt)}`,
    );

    const confirmed = after.rows.filter((r) => r.standing === "CONFIRMED");
    /* The names the panel gave these districts, so the revisit can check whether the banner contains any. */
    const ownDistrictNames = confirmed.map((r) => r.label).filter(Boolean);
    check(
      "SC0831",
      LIVE[1][1],
      confirmed.length === ownDistricts.length &&
        confirmed.every((r) => r.label.length > 0) &&
        after.exclusionMarks === 0 &&
        !after.ocdIdOnScreen,
      `the resolver settled ${ownDistricts.length} district(s) at these levels; the panel shows ` +
        `${confirmed.length} CONFIRMED: ${confirmed.map((r) => r.label).join(" · ") || "none"}`,
    );

    /* The revisit: a device returning in the same session holds the resolution, so this seeds and reloads. */
    await page.reload({ waitUntil: "domcontentloaded" });
    // After a reload the card is reached the same way as on a cold open.
    await untilPresent(page, ".notice-fab", 30_000);
    if (await wghPill.isVisible().catch(() => false)) {
      await wghPill.click();
      await until(page, async () => (await page.locator(".coverage-notice").count()) > 0, 10_000);
    }
    const mounted = await untilPresent(page, "[data-seat-standing]", 20_000);
    if (mounted) {
      await until(
        page,
        async () => {
          const now = (await page.evaluate(SCOPE_READ)) as ScopeRead;
          return now.rows.length > 0 && now.rows.every((r) => r.standing === "CONFIRMED");
        },
        20_000,
      );
    }
    const revisited = mounted ? ((await page.evaluate(SCOPE_READ)) as ScopeRead) : null;
    const revisitConfirmed = revisited?.rows.filter((r) => r.standing === "CONFIRMED") ?? [];
    check(
      "SC0831",
      LIVE[2][1],
      revisited !== null &&
        revisitConfirmed.length === ownDistricts.length &&
        revisitConfirmed.every((r) => r.label.length > 0),
      revisited === null
        ? "the card rendered no seat rows after the revisit"
        : `after reload the panel shows ${revisitConfirmed.length} of ${ownDistricts.length} ` +
          `settled district(s): ${revisitConfirmed.map((r) => r.label).join(" · ") || "none"}`,
    );

    /* On a revisit the banner and the list are fed by different things; the list is the evidence. */
    const revisitBanner = (await page.evaluate(
      `(() => {
        const el = document.querySelector('.address-prompt-confirmed');
        const text = el ? (el.textContent || '').trim() : '';
        return { text: text, present: !!el };
      })()`,
    )) as { text: string; present: boolean };
    const bannerNamesADistrict = ownDistrictNames.some(
      (name) => name.length > 0 && revisitBanner.text.includes(name),
    );
    const listNamesThem =
      revisitConfirmed.length === ownDistricts.length &&
      revisitConfirmed.every((r) => r.label.length > 0);
    check(
      "SC0831",
      LIVE[3][1],
      listNamesThem,
      `banner ${revisitBanner.present ? `reads "${revisitBanner.text}"` : "absent"} and names a ` +
        `settled district: ${bannerNamesADistrict}; the LIST names ${revisitConfirmed.length} of ` +
        `${ownDistricts.length}: ${revisitConfirmed.map((r) => r.label).join(" · ") || "none"} — ` +
        "the list is what this check reads",
    );
  } finally {
    await page.context().close();
  }
}
/** The ballot, revisited with a kept resolution, one variant per walked place. */
{
  const BALLOT_REVISIT_READ = `(() => {
    const sections = [...document.querySelectorAll('[data-contest-id]')];
    const banner = document.querySelector('.ballot-narrowed');
    const bannerText = banner ? (banner.textContent || '').trim() : '';
    const stated = bannerText.match(/([0-9]+) contests? elsewhere/);
    return {
      contests: sections.length,
      scopedOut: sections.filter((s) => s.getAttribute('data-scoped-out') === 'true').length,
      candidateRows: document.querySelectorAll('.candidate-row').length,
      bannerPresent: !!banner,
      bannerText: bannerText,
      bannerSaysNoneHidden: bannerText.indexOf('Every contest below') !== -1,
      statedHidden: stated ? Number(stated[1]) : -1,
    };
  })()`;

  interface BallotRevisitRead {
    contests: number;
    scopedOut: number;
    candidateRows: number;
    bannerPresent: boolean;
    bannerText: string;
    bannerSaysNoneHidden: boolean;
    statedHidden: number;
  }

  for (const target of SCOPE_ADDRESSES) {
    const REVISIT: [string, string][] = [
      [
        "SC0831",
        `${target.zip}: returning to the ballot with a kept resolution narrows the contest list`,
      ],
      [
        "SC0831",
        `${target.zip}: the ballot's stated hidden count equals the contests actually set aside`,
      ],
      [
        "SC0831",
        `${target.zip}: the narrowed ballot still renders candidate cards, never an empty list`,
      ],
    ];

    const page = await openAt(browser, target.zip);
    try {
      const ballotUrl = `${BASE}/ballot?zip=${target.zip}`;
      await page.goto(ballotUrl, { waitUntil: "domcontentloaded", timeout: 90_000 });
      if (!(await untilPresent(page, "[data-contest-id]", 40_000))) {
        for (const [session, name] of REVISIT) {
          cannotRun(session, name, `the ballot at ${target.zip} rendered no contests to narrow`);
        }
        continue;
      }

      /* Settle the address on this page's own prompt; a zip whose prompt is not offered declares. */
      const trigger = page.locator(".address-prompt-trigger").first();
      if (!(await trigger.isVisible().catch(() => false))) {
        for (const [session, name] of REVISIT) {
          cannotRun(session, name, "the ballot offered no address prompt to narrow with");
        }
        continue;
      }
      await trigger.click();
      const street = page.locator('input[aria-label="Street"]').first();
      if (!(await street.isVisible().catch(() => false))) {
        for (const [session, name] of REVISIT) {
          cannotRun(session, name, "the address prompt offered no street field to type into");
        }
        continue;
      }
      await street.fill(target.street);
      await page.locator(".address-prompt-fields button").first().click();

      // The house-number ask is caused by the street, so it is waited for by name.
      if (target.houseNumber) {
        const asked = await page
          .waitForSelector('input[aria-label="House number"]', { timeout: 20_000 })
          .then(() => true)
          .catch(() => false);
        if (asked) {
          await page.locator('input[aria-label="House number"]').first().fill(target.houseNumber);
          await page.locator(".address-prompt-fields button").first().click();
        }
      }

      const settled = await until(
        page,
        async () => (await page.locator(".address-prompt-settled").count()) > 0,
        20_000,
      );
      if (!settled) {
        for (const [session, name] of REVISIT) {
          cannotRun(
            session,
            name,
            `the prompt never settled ${target.street} in ${target.zip}, so nothing was kept`,
          );
        }
        continue;
      }

      /* The revisit: a real navigation back to the same URL, a fresh mount holding only what the store kept. */
      await page.goto(ballotUrl, { waitUntil: "domcontentloaded", timeout: 90_000 });
      if (!(await untilPresent(page, "[data-contest-id]", 40_000))) {
        for (const [session, name] of REVISIT) {
          cannotRun(session, name, "the ballot rendered no contests after the revisit");
        }
        continue;
      }
      await until(
        page,
        async () => (await page.locator(".ballot-narrowed").count()) > 0,
        20_000,
      );
      const read = (await page.evaluate(BALLOT_REVISIT_READ)) as BallotRevisitRead;

      /* Narrowing happened: contests hidden, or the honest "every contest below is on the ballot at that address". */
      check(
        "SC0831",
        REVISIT[0][1],
        read.bannerPresent && (read.scopedOut > 0 || read.bannerSaysNoneHidden),
        `banner ${read.bannerPresent ? `present: "${read.bannerText}"` : "ABSENT"}; ` +
          `${read.scopedOut} of ${read.contests} contest(s) carry data-scoped-out`,
      );

      /* The stated N against the rendered N: the banner is React state and the hiding is a DOM write. */
      const expectedHidden = read.bannerSaysNoneHidden ? 0 : read.statedHidden;
      check(
        "SC0831",
        REVISIT[1][1],
        expectedHidden >= 0 && expectedHidden === read.scopedOut,
        `the banner states ${expectedHidden < 0 ? "no number" : expectedHidden} hidden; ` +
          `${read.scopedOut} section(s) of ${read.contests} actually carry data-scoped-out — ` +
          `banner text: "${read.bannerText}"`,
      );

      /* A ballot narrowed to nothing is not a narrowed ballot; `.candidate-row` is the card count. */
      check(
        "SC0831",
        REVISIT[2][1],
        read.candidateRows > 0 && read.scopedOut < read.contests,
        `${read.candidateRows} candidate card(s) after the revisit, with ` +
          `${read.contests - read.scopedOut} of ${read.contests} contest(s) still shown`,
      );
    } finally {
      await page.context().close();
    }
  }
}

/** New Hampshire money reaches the reader. */
{
  const NH_ZIP = "03255";
  const FILED_CANDIDATE = "Warmington";
  const ABSENT_CANDIDATE = "Strathdee";
  const MONEY: [string, string][] = [
    ["SC0831", `${NH_ZIP}: a candidate the state holds a filing for renders the filed totals`],
    ["SC0831", `${NH_ZIP}: a candidate the state holds nothing for renders a sourced absence, never a zero`],
  ];

  const readMoney = async (page: Page, surname: string): Promise<string | null> => {
    await page.goto(`${BASE}/ballot?zip=${NH_ZIP}`, {
      waitUntil: "domcontentloaded",
      timeout: 90_000,
    });
    if (!(await untilPresent(page, ".candidate-row", 40_000))) return null;
    const row = page.locator(".candidate-row", { hasText: surname }).first();
    const card = row.locator("button", { hasText: "View Battlecard" }).first();
    if (!(await card.isVisible().catch(() => false))) return null;
    await card.click();
    const money = page.getByRole("button", { name: /Campaign money/i }).first();
    if (!(await untilPresent(page, "button", 15_000))) return null;
    if (!(await money.isVisible().catch(() => false))) return null;
    await money.click();
    await untilSettled(page, "body", 400, 8_000);
    return (await page.evaluate(
      `(() => {
        var b = [...document.querySelectorAll('button')].filter(function (x) {
          return /Campaign money/i.test(x.innerText || '');
        })[0];
        if (!b) return null;
        var region = b.parentElement;
        for (var i = 0; i < 4 && region; i++) {
          if ((region.innerText || '').trim().length > 40) break;
          region = region.parentElement;
        }
        return region ? region.innerText : null;
      })()`,
    )) as string | null;
  };

  const page = await browser.page({ viewport: PHONE, reducedMotion: "reduce" });
  try {
    const filed = await readMoney(page, FILED_CANDIDATE);
    if (filed === null) {
      cannotRun("SC0831", MONEY[0][1], `the ballot did not open a card for ${FILED_CANDIDATE}`);
    } else {
      check(
        "SC0831",
        MONEY[0][1],
        /Raised/i.test(filed) && /\$[\d,]+/.test(filed) && /New Hampshire Secretary of State/i.test(filed),
        `the money pane reads: ${filed.replace(/\s+/g, " ").slice(0, 200)}`,
      );
    }

    const absent = await readMoney(page, ABSENT_CANDIDATE);
    if (absent === null) {
      cannotRun("SC0831", MONEY[1][1], `the ballot did not open a card for ${ABSENT_CANDIDATE}`);
    } else {
      /* The false-zero rule: an absence says it is one, names whose it is, and carries no dollar figure. */
      check(
        "SC0831",
        MONEY[1][1],
        /No reports on file/i.test(absent) &&
          !/not a statement/i.test(absent) &&
          !/\$\s?0\b/.test(absent),
        `the money pane reads: ${absent.replace(/\s+/g, " ").slice(0, 220)}`,
      );
    }
  } finally {
    await page.context().close();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// The zip fly-in does not re-query the map on every frame of itself.
// ═══════════════════════════════════════════════════════════════════════════

section(
  "W6H3. The fly-in's per-frame cost, and its host-normalized frame rate (W6 H3, 2026-08-31)",
);

{
  /* Entering a zip flies the camera; the assertion is a count of deferred map queries, which does not depend on host speed. */
  const context = await browser.context({
    extraHTTPHeaders: RUN_HEADERS,
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
    /* Not `reducedMotion: "reduce"`: that short-circuits the fly-in to `jumpTo`. */
    reducedMotion: "no-preference",
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
        // The read below fails honestly if the app never resolved a zip.
      }
    },
    { zip: "85701" },
  );
  const page = await context.newPage();
  page.on("response", (r) => countProbe(r.url()));
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 90_000 });

  const ready = await until(
    page,
    () =>
      page.evaluate(() => Boolean((window as unknown as { __wtpMap?: unknown }).__wtpMap)),
    30_000,
    150,
    "W6H3 __wtpMap",
  );
  if (!ready) {
    cannotRun("W6H3", "the zip fly-in does not re-query the map on every frame", "no __wtpMap on the page");
  } else {
    /* Wait for the scrim, so the flight is measured at a reader's weight. */
    const scrimDrawn = await until(
      page,
      () =>
        page.evaluate(
          () => document.querySelectorAll(".state-focus-layer path").length > 0,
        ),
      20_000,
      150,
      "W6H3 state-focus scrim",
    );
    /* Not reported here: it joins the disposition chain below, so this block
       cannot both decline and then assert on the same run. */

    /* The probe as a string: tsx rewrites named functions through a `__name` helper the page does not have. */
    const FLY_PROBE = `(() => {
      const w = window;
      const map = w.__wtpMap;
      if (!map) return false;
      const probe = { frames: [], sourcedata: 0, qrf: 0, running: false };
      w.__wtpFlyProbe = probe;
      map.on("sourcedata", () => { if (probe.running) probe.sourcedata += 1; });
      const real = map.queryRenderedFeatures.bind(map);
      map.queryRenderedFeatures = function (...args) {
        if (probe.running) probe.qrf += 1;
        return real(...args);
      };
      /*
        THE FRAME WINDOW CLOSES ON TIME; THE CALL COUNTER KEEPS COUNTING.

        These two measurements want different windows and used to share one.
        The frame rate is about a FIXED 2600ms animation, so its window must be
        fixed too — extending it would fold post-flight idle frames into the
        average and quietly improve the number. The call count is about work
        that happens ON ARRIVAL, one animation frame after moveend, so its
        window has to outlast the flight or it reads zero for work that did
        happen. So the recorder stops pushing frames at the deadline and the
        loop keeps running for the counters.
      */
      const tick = () => {
        if (!probe.running) return;
        if (performance.now() < probe.frameDeadline) probe.frames.push(performance.now());
        else probe.windowClosed = true;
        w.requestAnimationFrame(tick);
      };
      probe.run = (opts, windowMs) => {
        probe.frames = [];
        probe.sourcedata = 0;
        probe.qrf = 0;
        probe.running = true;
        probe.windowClosed = false;
        probe.frameDeadline = performance.now() + windowMs;
        w.requestAnimationFrame(tick);
        if (opts) map.flyTo(opts);
      };
      probe.stop = () => { probe.running = false; };
      /*
        THE CAMERA IS PARKED AND ITS TILES HAVE LANDED — an OUTCOME the Node
        side can wait on, so neither run has to guess how long a jumpTo takes
        to settle. Both runs must start from the identical camera or the
        control is not a control.
      */
      probe.parked = () => !map.isMoving() && map.areTilesLoaded();
      return true;
    })()`;
    await page.evaluate(FLY_PROBE);

    // Both walks start at the continent, where a reader with no remembered camera starts.
    /* Every wait in this sequence is an outcome; the sampling window is fixed because the frame clock is what is measured. */
    /* `park` and `sampled` take their page as an argument because the criterion below flies a second page. */
    const park = async (target: Page, label: string): Promise<boolean> => {
      await target.evaluate(`window.__wtpMap.jumpTo({ center: [-98.5, 39.5], zoom: 3.2 })`);
      return until(
        target,
        () => target.evaluate(`window.__wtpFlyProbe.parked()`) as Promise<boolean>,
        10_000,
        50,
        label,
      );
    };
    const sampled = (target: Page, label: string): Promise<boolean> =>
      until(
        target,
        () => target.evaluate(`window.__wtpFlyProbe.windowClosed === true`) as Promise<boolean>,
        15_000,
        100,
        label,
      );

    // Both walks start at the continent, where a reader with no remembered camera starts.
    const parkedForControl = await park(page, "W6H3 camera parked (control)");

    // The control first: the same frame clock with the camera standing still carries this host's load.
    await page.evaluate(`window.__wtpFlyProbe.run(null, 2800)`);
    const controlSampled = await sampled(page, "W6H3 control frame window");
    const control = (await page.evaluate(
      `(() => { const p = window.__wtpFlyProbe; p.stop(); return { frames: p.frames }; })()`,
    )) as { frames: number[] };

    const parkedForFlight = await park(page, "W6H3 camera parked (flight)");
    // The options are the fly-in's own, copied from map-canvas.tsx.
    await page.evaluate(
      `window.__wtpFlyProbe.run({ center: [-110.9747, 32.2226], zoom: 11, duration: 2600, essential: true, curve: 1.5 }, 2800)`,
    );
    const flightSampled = await sampled(page, "W6H3 flight frame window");
    /* Wait for the arrival, not for a duration. */
    await until(
      page,
      () => page.evaluate(`window.__wtpFlyProbe.qrf >= 1`) as Promise<boolean>,
      5_000,
      150,
      "W6H3 moveend settle",
    );
    const flight = (await page.evaluate(
      `(() => {
        const p = window.__wtpFlyProbe;
        p.stop();
        return { frames: p.frames, sourcedata: p.sourcedata, qrf: p.qrf, zoom: window.__wtpMap.getZoom() };
      })()`,
    )) as { frames: number[]; sourcedata: number; qrf: number; zoom: number };

    /* The camera must actually have flown before the count means anything. */
    const flew = flight.zoom > 5;
    /* Fewer than three timestamps has no interval to measure, so it says so rather than "0.0 fps". */
    const fps = (times: number[]): string => {
      if (times.length < 3) return `NOT MEASURED (${times.length} frame timestamps)`;
      const gaps: number[] = [];
      for (let i = 1; i < times.length; i += 1) gaps.push(times[i] - times[i - 1]);
      gaps.sort((a, b) => a - b);
      const p95 = gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * 0.95))];
      return `${(1000 / p95).toFixed(1)} fps`;
    };
    const controlFps = fps(control.frames);
    const flightFps = fps(flight.frames);
    /* The renderer is named, or the frame rate is unreadable. */
    const renderer = String(
      await page.evaluate(`(() => {
        const c = document.createElement("canvas");
        const gl = c.getContext("webgl2") || c.getContext("webgl");
        if (!gl) return "NO WEBGL";
        const dbg = gl.getExtension("WEBGL_debug_renderer_info");
        return dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : "UNKNOWN";
      })()`),
    );
    const software = renderer.toLowerCase().includes("swiftshader");

    /* One disposition, read by both checks. */
    const COUNT_CHECK = "the zip fly-in does not re-query the whole viewport on every frame of itself";
    const NORM_CHECK =
      "the fly-in holds 90% of a bare MapLibre fly-in's median frame rate on this host";
/** A second population, a reader without GPU acceleration, measured by the same relative criterion. */
    const SOFT_CHECK =
      "the fly-in on a browser with NO GPU acceleration holds " +
      `${(SOFTWARE_NORMALIZED_FLOOR * 100).toFixed(0)}% of a bare MapLibre fly-in and stays ` +
      `under ${(SOFTWARE_JANK_CEILING * 100).toFixed(0)}% long frames`;
    const blockedReason: string | null = !scrimDrawn
      ? /* The page never reached a reader's weight, so the flight would be
           measuring a lighter map than the one this check is about. */
        "the state-focus scrim never drew, so the flight would measure a lighter page than a reader's"
      : !parkedForControl || !parkedForFlight
        ? /* The two runs did not start from the identical camera, so the control
             is not a control and the comparison has no meaning. */
          "the camera never parked at the continent between runs, so the control and the flight " +
          "did not start from the same place"
        : !controlSampled || !flightSampled
          ? /* The in-page frame window never reported itself closed — the sample
               was cut short or never started, and a short sample is not a fast one. */
            "the in-page frame window never closed, so the frames read are an incomplete sample"
          : !flew
            ? `the camera ended at zoom ${flight.zoom.toFixed(1)} — it never left the continent`
            : flight.sourcedata === 0
              ? /*
                 * No source re-tiled, so the ratio this check is about has no
                 * denominator. That is a real state — a build serving
                 * no district geometry — and it is not this check passing.
                 */
                "the flight fired no sourcedata events, so no district source re-tiled"
              : null;

    if (blockedReason !== null) {
      cannotRun("W6H3", COUNT_CHECK, blockedReason);
      cannotRun("W6H3", NORM_CHECK, blockedReason);
      cannotRun("W6H3", SOFT_CHECK, blockedReason);
    } else {
      /* The ceiling: 5-8 calls per flight after the fix, against 170 before it. */
      /* Both halves: a ceiling alone would reward doing nothing, so the work must still happen. */
      check(
        "W6H3",
        COUNT_CHECK,
        flight.qrf <= 20 && flight.qrf >= 1,
        `${flight.qrf} queryRenderedFeatures calls across ${flight.sourcedata} sourcedata ` +
          `events in one 2600ms fly-in (floor 1, ceiling 20; it was 170 of 170 before W6 H3, ` +
          "and the floor is what proves moveend still pays the deferred pass) — " +
          `descriptive frame rate this run: ${flightFps} p95-sustained in flight against a ` +
          `${controlFps} standing-still control on the same host, ` +
          `${flight.frames.length} frames measured, on ${software ? "the SOFTWARE rasteriser" : "a hardware GPU"} ` +
          `(${renderer}). THIS CHECK ASSERTS THE COUNT, NOT THAT RATE; the frame rate is ` +
          "asserted by the host-normalized criterion on the next line.",
      );

      /*
       * The host-normalized criterion: run the identical fly-in on (a) bare MapLibre
       * with application layers removed and (b) the application, and pass when the
       * application's median FPS is at least 90% of the bare map's on that host.
       * Flights are interleaved per pair with alternating order, so host load lands
       * on both arms; CPU busy is printed per flight. The median ignores single-frame
       * hiccups, so the call-count check above and the jank figure are kept too.
       */
      /* Both arms run on a second browser requested onto the real adapter. */
/** What one rasteriser's pass hands back: evidence only; the call sites decide. */
      interface ArmsResult {
        /** The renderer string read back off the live context, never assumed. */
        renderer: string;
        /** Whether that string names the CPU rasteriser. */
        software: boolean;
        /** Both arms produced a `__wtpMap` to fly. */
        bareReady: boolean;
        /** Both arms drew the scrim, so both reached a reader's weight. */
        bareScrim: boolean;
        /** How many layers, sources and markers the bare ablation removed. */
        stripped: number;
        /** Bare flights discarded because the map healed during them. */
        healed: number;
        /** How many pairs were attempted; the denominator both arms must fill. */
        pairs: number;
        app: { gaps: number[]; hostBusyPct: number | null }[];
        bare: { gaps: number[]; hostBusyPct: number | null }[];
      }

/** One pass, run on whichever rasteriser the launch produced. */
      const measureArms = async (
        rasterLabel: string,
        launchArgs: string[],
      ): Promise<ArmsResult> => {
      const gpuBrowser = await launchGuarded({
        label: `walk-all-w6h3-${rasterLabel}`,
        args: launchArgs,
      });
      /** One settled flight page on this browser. Both arms open the same way. */
      const openFlightPage = async (label: string) => {
        const ctx = await gpuBrowser.context({
          extraHTTPHeaders: RUN_HEADERS,
          viewport: { width: 1280, height: 900 },
          deviceScaleFactor: 1,
          /* Not `reducedMotion: "reduce"`: that short-circuits the fly-in to `jumpTo`. */
          reducedMotion: "no-preference",
        });
        await ctx.addInitScript(
          ({ zip }) => {
            try {
              sessionStorage.setItem(
                "wtp.approximate_location",
                JSON.stringify({ zip, savedAt: new Date().toISOString() }),
              );
              localStorage.setItem("wtp.tutorial_seen", "1");
            } catch {
              // The readiness read below fails honestly if the app never resolved.
            }
          },
          { zip: "85701" },
        );
        const p = await ctx.newPage();
        p.on("response", (r) => countProbe(r.url()));
        await p.goto(BASE, { waitUntil: "domcontentloaded", timeout: 90_000 });
        const mapReady = await until(
          p,
          () => p.evaluate(() => Boolean((window as unknown as { __wtpMap?: unknown }).__wtpMap)),
          30_000,
          150,
          `${label} __wtpMap`,
        );
        /* Both arms wait for the scrim; the bare arm is stripped only after reaching a reader's weight. */
        const scrim = mapReady
          ? await until(
              p,
              () =>
                p.evaluate(() => document.querySelectorAll(".state-focus-layer path").length > 0),
              20_000,
              150,
              `${label} state-focus scrim`,
            )
          : false;
        if (mapReady) await p.evaluate(FLY_PROBE);
        return { ctx, page: p, ready: mapReady, scrim };
      };

      const appArm = await openFlightPage("W6H3 gpu app");
      const bareArm = await openFlightPage("W6H3 gpu bare");
      const barePage = bareArm.page;
      const gpuRenderer = appArm.ready
        ? String(await appArm.page.evaluate(READ_RENDERER))
        : "NOT READ";
      const gpuSoftware = isSoftwareRenderer(gpuRenderer);
      const bareReady = appArm.ready && bareArm.ready;
      const bareScrim = appArm.scrim && bareArm.scrim;
      /* The ablation as a string, for the same reason the probe is one. */
      const stripped = bareReady
        ? Number(
            await barePage.evaluate(`(() => {
              const map = window.__wtpMap;
              if (!map) return 0;
              const realAddSource = map.addSource.bind(map);
              const realAddLayer = map.addLayer.bind(map);
              map.addSource = function (id, spec) {
                if (typeof id === "string" && id.indexOf("district-") === 0) return map;
                return realAddSource(id, spec);
              };
              map.addLayer = function (spec, before) {
                if (spec && typeof spec.id === "string" && spec.id.indexOf("district-") === 0) return map;
                return realAddLayer(spec, before);
              };
              let removed = 0;
              const style = map.getStyle() || {};
              for (const l of (style.layers || []).slice()) {
                if (l.id.indexOf("district-") !== 0) continue;
                try { map.removeLayer(l.id); removed += 1; } catch (e) { void e; }
              }
              for (const id of Object.keys(style.sources || {})) {
                if (id.indexOf("district-") !== 0) continue;
                try { map.removeSource(id); removed += 1; } catch (e) { void e; }
              }
              const layer = document.querySelector(".state-focus-layer");
              if (layer) { layer.style.display = "none"; removed += 1; }
              for (const pin of Array.from(document.querySelectorAll(".maplibregl-marker"))) {
                pin.remove();
                removed += 1;
              }
              return removed;
            })()`),
          )
        : 0;

      /* Is the bare map still bare at the end of the flight? */
      const BARE_INTACT = `(() => {
        const map = window.__wtpMap;
        if (!map) return { ok: false, layers: -1, sources: -1, markers: -1, scrimHidden: false };
        const style = map.getStyle() || {};
        const layers = (style.layers || []).filter((l) => l.id.indexOf("district-") === 0).length;
        const sources = Object.keys(style.sources || {}).filter((id) => id.indexOf("district-") === 0).length;
        const markers = document.querySelectorAll(".maplibregl-marker").length;
        const el = document.querySelector(".state-focus-layer");
        const scrimHidden = el ? el.style.display === "none" : true;
        return {
          ok: layers === 0 && sources === 0 && markers === 0 && scrimHidden,
          layers: layers,
          sources: sources,
          markers: markers,
          scrimHidden: scrimHidden,
        };
      })()`;
      let bareHealed = 0;

/** One flight, driven identically on whichever page it is handed; null when the flight cannot be counted. */
      const flyOnce = async (target: Page, label: string): Promise<number[] | null> => {
        if (!(await park(target, `${label} park`))) return null;
        await target.evaluate(
          `window.__wtpFlyProbe.run({ center: [-110.9747, 32.2226], zoom: 11, duration: 2600, essential: true, curve: 1.5 }, 2800)`,
        );
        const closed = await sampled(target, `${label} window`);
        const out = (await target.evaluate(
          `(() => { const q = window.__wtpFlyProbe; q.stop(); return { frames: q.frames, zoom: window.__wtpMap.getZoom() }; })()`,
        )) as { frames: number[]; zoom: number };
        if (!closed || !(out.zoom > 5) || out.frames.length < 3) return null;
        return frameGaps(out.frames);
      };

      /* A discarded warm-up on each page: the first flight pays a cold-start cost. */
      if (bareReady) {
        await flyOnce(appArm.page, "W6H3 app warm-up");
        await flyOnce(barePage, "W6H3 bare warm-up");
      }

      const PAIRS = 3;
      const appGaps: { gaps: number[]; hostBusyPct: number | null }[] = [];
      const bareGaps: { gaps: number[]; hostBusyPct: number | null }[] = [];
      /* The renderer is not part of this gate. */
      if (bareReady && bareScrim && stripped > 0) {
        for (let pair = 1; pair <= PAIRS; pair += 1) {
          const order: ("app" | "bare")[] = pair % 2 === 1 ? ["app", "bare"] : ["bare", "app"];
          for (const arm of order) {
            const target = arm === "app" ? appArm.page : barePage;
            const ticksBefore = cpuTicks();
            const gaps = await flyOnce(target, `W6H3 ${arm} pair ${pair}`);
            const hostBusyPct = busyPct(ticksBefore, cpuTicks());
            if (gaps === null) continue;
            if (arm === "bare") {
              const intact = (await barePage.evaluate(BARE_INTACT)) as { ok: boolean };
              if (!intact.ok) {
                bareHealed += 1;
                continue;
              }
            }
            (arm === "app" ? appGaps : bareGaps).push({ gaps, hostBusyPct });
          }
        }
      }

      await appArm.ctx.close();
      await bareArm.ctx.close();
      await gpuBrowser.close();
      return {
        renderer: gpuRenderer,
        software: gpuSoftware,
        bareReady,
        bareScrim,
        stripped,
        healed: bareHealed,
        pairs: PAIRS,
        app: appGaps,
        bare: bareGaps,
      };
      /* The closing brace of `measureArms`; its body is deliberately not re-indented. */
      };

/** Everything that invalidates a pass on either rasteriser, in one place: the reason, or null. */
      const armsBlocked = (r: ArmsResult): string | null => {
        if (!r.bareReady) return "the bare-map arm never produced a __wtpMap to fly";
        if (!r.bareScrim) {
          return (
            "the bare arm's scrim never drew, so it was never brought to a reader's weight " +
            "before being stripped — the two arms would not differ in exactly one thing"
          );
        }
        if (r.stripped === 0) {
          /* The ablation matched nothing, so the "bare" arm is a fully loaded page. */
          return (
            "the bare ablation removed NOTHING, so the bare arm is not bare and the ratio " +
            "would be this page compared against itself"
          );
        }
        if (r.healed > 0) {
          /* The application put its district layers back on the "bare" map
             during the flight, so that arm is not a bare map. */
          return (
            `${r.healed} of ${r.pairs} bare flights HEALED mid-flight — the application ` +
            "re-added its district layers to the stripped map, so the bare arm is not bare"
          );
        }
        if (r.app.length < r.pairs || r.bare.length < r.pairs) {
          /* A missing flight is not a slow flight. Both arms must carry the full
             denominator or the medians are taken over different populations. */
          return (
            `only ${r.app.length} of ${r.pairs} application flights and ${r.bare.length} of ` +
            `${r.pairs} bare flights completed — the arms would not share a denominator`
          );
        }
        return null;
      };

      /** The frame-time and jank sentence both populations report identically. */
      const armsDetail = (app: ArmSummary, bare: ArmSummary, r: ArmsResult): string =>
        `application median ${app.medianFps.toFixed(1)} fps over ${app.runs} flights, bare map ` +
        `${bare.medianFps.toFixed(1)} fps over ${bare.runs} flights, ${r.pairs} INTERLEAVED ` +
        `pairs with alternating within-pair order. Means ${app.meanFps.toFixed(1)} and ` +
        `${bare.meanFps.toFixed(1)} fps; a mean below its median is a stall the median hid. ` +
        `Frame time app p50 ${app.frameMs.p50.toFixed(1)}ms / p95 ${app.frameMs.p95.toFixed(1)}ms / ` +
        `p99 ${app.frameMs.p99.toFixed(1)}ms / max ${app.frameMs.max.toFixed(1)}ms, bare ` +
        `p50 ${bare.frameMs.p50.toFixed(1)}ms / p95 ${bare.frameMs.p95.toFixed(1)}ms / ` +
        `p99 ${bare.frameMs.p99.toFixed(1)}ms / max ${bare.frameMs.max.toFixed(1)}ms. ` +
        `JANK over ${LONG_FRAME_MS}ms: app ${app.longFrames}/${app.framesMeasured} frames, ` +
        `bare ${bare.longFrames}/${bare.framesMeasured} frames. ` +
        `${r.stripped} layers, sources and markers removed for the bare arm, and every bare ` +
        "flight read back 0 district layers, 0 sources and 0 markers AT LANDING. " +
        "THE ABSOLUTE RATE IS A FACT ABOUT THIS HOST; ONLY THE RATIO IS ASSERTED.";

      /* Population 1: a reader with a GPU. The 90% criterion. */
      const hw = await measureArms("gpu", GPU_ARGS);
      const hwBlocked = armsBlocked(hw);
      if (hwBlocked !== null) {
        cannotRun("W6H3", NORM_CHECK, hwBlocked);
      } else if (hw.software) {
        /* The GPU request did not land, so this arm is on the CPU rasteriser and belongs to the other population. */
        cannotRun(
          "W6H3",
          NORM_CHECK,
          `the GPU request fell back to the SOFTWARE rasteriser (${hw.renderer}), so this arm ` +
            "measured the CPU-rasterised population rather than a reader with a GPU. That " +
            "population has its own check on the next line and it is not waived by this " +
            "decline. Run `pnpm measure:flyin --normalized` for the full instrument",
        );
      } else {
        const app = summariseArm("application", hw.app);
        const bare = summariseArm("bare MapLibre", hw.bare);
        const verdict = judgeNormalized(app, bare);
        check(
          "W6H3",
          NORM_CHECK,
          verdict.pass,
          `RATIO ${(verdict.ratio * 100).toFixed(1)}% against the ` +
            `${(NORMALIZED_FLOOR * 100).toFixed(0)}% floor — ${armsDetail(app, bare, hw)} ` +
            `HOST CONDITION: ${hostCondition(verdict)}; measured on the hardware GPU ` +
            `(${hw.renderer}) rather than through this suite's default rasteriser (${renderer}).`,
        );
      }

      /*
       * Population 2: a reader with no GPU acceleration. The floor is lower than
       * the hardware floor, because treatments stand down while the camera moves,
       * and the jank ceiling applies too.
       */
      /* No GPU flags, which is how this run gets the CPU rasteriser. */
      const sw = await measureArms("software", []);
      const swBlocked = armsBlocked(sw);
      if (swBlocked !== null) {
        cannotRun("W6H3", SOFT_CHECK, swBlocked);
      } else if (!sw.software) {
        /* The default launch came back on a real adapter, so there is no CPU-rasterised arm to assert on this host. */
        cannotRun(
          "W6H3",
          SOFT_CHECK,
          `this suite's default launch came back on a HARDWARE adapter (${sw.renderer}) rather ` +
            "than the CPU rasteriser, so this host cannot produce the no-GPU population on " +
            "demand and there is nothing here to assert it against. Measured on 2026-09-01 on a " +
            "host that could: 49.9 fps median application against 54.2 bare = 92.0%, jank 20 of " +
            "771 frames. Run `FLYIN_SOFTWARE=1 pnpm measure:flyin --normalized` to reproduce",
        );
      } else {
        const app = summariseArm("application", sw.app);
        const bare = summariseArm("bare MapLibre", sw.bare);
        const verdict = judgeSoftware(app, bare);
        check(
          "W6H3",
          SOFT_CHECK,
          verdict.pass,
          `RATIO ${(verdict.ratio * 100).toFixed(1)}% against the ` +
            `${(SOFTWARE_NORMALIZED_FLOOR * 100).toFixed(0)}% software floor ` +
            `(${verdict.ratioPass ? "MET" : "NOT MET"}) and JANK ` +
            `${(verdict.jankFraction * 100).toFixed(1)}% against the ` +
            `${(SOFTWARE_JANK_CEILING * 100).toFixed(0)}% ceiling ` +
            `(${verdict.jankPass ? "MET" : "NOT MET"}) — BOTH are required, because a build ` +
            "measured at 89% of bare with 57 of 231 frames past 33.4ms is what proved the " +
            `median alone cannot close this. ${armsDetail(app, bare, sw)} ` +
            `Measured on the SOFTWARE rasteriser (${sw.renderer}) — a real reader population ` +
            "(older machines, VMs, remote desktop, blocklisted drivers, hardware acceleration " +
            "off), reported as its OWN population and never averaged with the hardware one. " +
            "It was 28.8% before 2026-09-01.",
        );
      }
    }
  }
  await context.close();
}

/*
 * Arizona money reaches the reader, and every card ends in exactly one money
 * state. Asserts the floor (no card without a state) and ceilings the OURS-gap
 * count, rather than pinning the composition.
 */

section("SC3. Arizona money reaches the certified-lineup reader (Item 1, 2026-09-01)");

for (const { zip, cards: cardFloor, oursCeiling } of [
  { zip: "85701", cards: 24, oursCeiling: 6 },
  { zip: "85641", cards: 29, oursCeiling: 6 },
] as const) {
  const context = await browser.context();
  const page = await context.newPage();
  try {
    await page.goto(`${BASE}/ballot?zip=${zip}`, { waitUntil: "networkidle" });
    await until(
      page,
      async () => (await page.locator(".candidate-row").count()) > 0,
      15_000,
      150,
      `SC3 ${zip}: candidate cards`,
    );

    /* Open every battlecard, then every Campaign money section; the body is absent until clicked open. */
    // Server-rendered cards can precede their click handlers.
    await untilInteractive(page, '.candidate-row button[aria-expanded]');
    await page.evaluate(
      "(() => { for (const b of Array.from(document.querySelectorAll('button'))) " +
        "if ((b.textContent || '').trim() === 'View Battlecard') b.click(); })()",
    );
    await until(
      page,
      async () => (await page.locator(".card-section-title").count()) > 0,
      15_000,
      150,
      `SC3 ${zip}: battlecards open`,
    );
    const opened = await page.evaluate(
      "(() => { let n = 0; for (const t of Array.from(document.querySelectorAll('.card-section-title'))) " +
        "{ if (!/^Campaign money/.test((t.textContent || '').trim())) continue; " +
        "const b = t.closest('button'); if (b) { b.click(); n++; } } return n; })()",
    );
    await until(
      page,
      async () => (await page.locator(".card-section-body").count()) > 0,
      15_000,
      150,
      `SC3 ${zip}: money bodies`,
    );

    const seen = (await page.evaluate(`(() => {
      const titles = Array.from(document.querySelectorAll('.card-section-title'))
        .filter((e) => /^Campaign money/.test((e.textContent || '').trim()));
      const out = { cards: document.querySelectorAll('.candidate-row').length,
                    sections: titles.length, filed: 0, registered: 0, absence: 0,
                    oursGap: 0, federal: 0, silent: 0 };
      for (const t of titles) {
        const section = t.closest('section');
        const el = section && section.querySelector('.card-section-body');
        const body = ((el && el.textContent) || '').replace(/\\s+/g, ' ');
        if (/Raised\\s*\\$/.test(body)) out.filed++;
        else if (/Registered committee/.test(body)) out.registered++;
        else if (/No reports on file/.test(body)) out.absence++;
        else if (/haven\\u2019t matched|haven't matched|haven\\u2019t recorded|haven't recorded/i.test(body)) out.oursGap++;
        else if (/(FEC|election cycle)/.test((t.textContent || '') + body)) out.federal++;
        else out.silent++;
      }
      return out;
    })()`)) as {
      cards: number; sections: number; filed: number; registered: number;
      absence: number; oursGap: number; federal: number; silent: number;
    };

    const detail =
      `${seen.sections} money section(s) over ${seen.cards} card(s), ${opened} header(s) opened — ` +
      `FILED ${seen.filed}, registered-no-activity ${seen.registered}, sourced absence ${seen.absence}, ` +
      `OURS gap ${seen.oursGap}, federal FEC ${seen.federal}, UNCLASSIFIED ${seen.silent}`;

    check(
      "SC3",
      `${zip}: every candidate card carries a Campaign money section`,
      seen.cards >= cardFloor && seen.sections === seen.cards,
      `${detail}. Before 2026-09-01 this was 4 of ${cardFloor}: the snapshot held the money and ` +
        "the card asked for it by name, so it silently rendered nothing.",
    );

    check(
      "SC3",
      `${zip}: no money section renders an unrecognised state`,
      seen.silent === 0 && seen.sections > 0,
      `${detail}. A section whose text matches none of the four honest states is either a new ` +
        "wording nobody taught this check, or the join failing quietly again — both are worth a look.",
    );

    check(
      "SC3",
      `${zip}: the identity layer still resolves most candidates to their filings`,
      seen.filed > 0 && seen.oursGap <= oursCeiling,
      `${detail}. The OURS gap is CEILINGED at ${oursCeiling} rather than pinned: a candidate may ` +
        "honestly move between states, but an identity layer that stopped resolving would degrade " +
        "every card to an honest-looking shrug and pass a floor that only counted sections.",
    );

    check(
      "SC3",
      `${zip}: Katie Hobbs's filed total reaches her card`,
      await page.evaluate(
        "document.body.innerText.replace(/\\s+/g, ' ').includes('11,109,7')",
      ),
      "the named control for the whole item — the figure that was in the snapshot and not on " +
        "the page. A changed total is not a failure of this check; a MISSING one is.",
    );
  } finally {
    await context.close();
  }
}

await browser.close();

const EXCLUDED = [
  "tester-walk-0814b — the reaction-capture write half (taps a real reaction row)",
  "tester-walk-0814d — the T08 human-paced write gate (taps a real reaction row)",
  "tester-walk-0815 — the reaction half of item 5 (writes); its read half is carried here",
  "walk-r40 — the feedback form's stored path (writes a real feedback row)",
  "walk-r41 — the optional reply field's stored path (writes two real feedback rows)",
  "pnpm pairs / pnpm shoot — screenshot passes; a human rules on pixels",
];

/* The identity uniqueness check runs before the summary, so a duplicate is a named regression. */
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

/* The probe census runs before the summary, so its findings are counted in it. */
/* ── Probe accounting: rows landed, not requests issued ────────────────── */

console.log(
  `\nPRODUCTION ROWS THIS RUN CREATED: ${searchLogRows} search-log GET(s) issued ` +
    `(every /api/meetings GET writes one), ${askRows} ask/log request(s) issued. ` +
    `No reaction was tapped.`,
);

/** The line above counts requests issued; this reads the rows that actually landed, by run id. */
loadEnv({ path: join(process.cwd(), ".env.local") });
const PRODUCTION_DB = process.env.WTP_PRODUCTION_DATABASE_URL_READONLY;

/* The sold store accepting this run's rows at all is checked, not assumed. */
const LANDED_CHECK = "the sold store accepted this run's rows at all";

if (BASE !== PUBLIC_SITE_ORIGIN) {
  console.log(
    `  rows landed: NOT READ — this run targeted ${BASE}, not production, so a production ` +
      `census would be answering about someone else's rows.`,
  );
  cannotRun("promptC", LANDED_CHECK, `this run targeted ${BASE}, not production`);
} else if (!PRODUCTION_DB) {
  console.log(
    `  rows landed: COULD NOT READ — WTP_PRODUCTION_DATABASE_URL_READONLY is not set. ` +
      `The issued counts above stand as issued counts and are NOT the landed number.`,
  );
  cannotRun(
    "promptC",
    LANDED_CHECK,
    "WTP_PRODUCTION_DATABASE_URL_READONLY is not set — the landed number cannot be read",
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

    /* A gap between issued and landed is ordinary; zero landed when requests were issued is not. */
    check(
      "promptC",
      LANDED_CHECK,
      !(searchLogRows + askRows > 0 && total === 0),
      total === 0
        ? `issued ${searchLogRows + askRows} write-triggering requests and NOTHING landed — ` +
          `the search log is not recording. Check the migration state against ` +
          `lib/db/migrations/meta/_journal.json: a column in the code and not in the ` +
          `database fails every insert, and the route catches it.`
        : `${total} landed`,
    );
  } catch (error) {
    // An unreadable census is could-not-run, never zero.
    console.log(
      `  rows landed: COULD NOT READ — ${(error as Error).message.slice(0, 120)}. ` +
        `The issued counts above stand as issued counts.`,
    );
    cannotRun(
      "promptC",
      LANDED_CHECK,
      `the production census threw: ${(error as Error).message.slice(0, 90)}`,
    );
  }
}

console.log(`\n${new Array(60).fill("─").join("")}`);
/* ── The schema gate and the write alarm ──────────────────────────────── */

/* Whether the served schema matches the code, and whether a write to a sold store has failed. */
{
  section("D73's class — the schema gate and the write alarm");
  /* The check name is stable; the subject is in the detail. */
  const SCHEMA_CHECK = "the deploy's database has the migrations the deploy was built from";
  const whichDatabase = BASE.startsWith("http://localhost")
    ? "the LOCAL build's database (DATABASE_URL, the development branch) — production's own schema is `pnpm db:check --target=production`"
    : "the deploy's database";
  const raw = await get("/api/schema");
  if (raw.status === 200 || raw.status === 503) {
    /* 200 and 503 are both answers (in sync, out of sync); any other status means the question could not be asked. */
    let summary = raw.text.slice(0, 300);
    try {
      const body = JSON.parse(raw.text) as { summary?: string };
      if (body.summary) summary = body.summary;
    } catch {
      // A body that will not parse is reported as the bytes that arrived.
    }
    check("promptD", SCHEMA_CHECK, raw.status === 200, `${whichDatabase} — ${summary}`);
  } else if (raw.status === 501) {
    cannotRun("promptD", SCHEMA_CHECK, "the deploy reports no DATABASE_URL — nothing was compared");
  } else {
    cannotRun("promptD", SCHEMA_CHECK, `/api/schema answered HTTP ${raw.status}`);
  }

  const ALARM_CHECK = "no sold-store write raised an alarm in the last 24h";
  if (!PRODUCTION_DB) {
    cannotRun(
      "promptD",
      ALARM_CHECK,
      "WTP_PRODUCTION_DATABASE_URL_READONLY is not set — an unread alarm table is not an empty one",
    );
  } else {
    try {
      const sql = neon(PRODUCTION_DB);
      const alarms = (await sql`
        SELECT store, COUNT(*)::int AS n
        FROM write_alarm
        WHERE raised_at > now() - interval '24 hours'
        GROUP BY store
      `) as { store: string; n: number }[];
      const total = alarms.reduce((a, r) => a + r.n, 0);
      check(
        "promptD",
        ALARM_CHECK,
        total === 0,
        total === 0
          ? "the alarm table is empty for this window"
          : `${alarms.map((a) => `${a.store}=${a.n}`).join(", ")} — run ` +
            "corepack pnpm alarms --target=production for the database's own words",
      );
    } catch (error) {
      cannotRun(
        "promptD",
        ALARM_CHECK,
        `could not read write_alarm: ${(error as Error).message.slice(0, 90)}`,
      );
    }
  }
}

console.log(`${passed} check(s) passed, ${failures.length} regression(s), ${blocked.length} could not run`);

/* The suite's own census, printed every run. */
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

/** Baseline identities that neither ran nor declared they could not; the baseline writer needs it too. */
let silentIdentities: string[] = [];

console.log(`\nCHECK IDENTITIES: ${ranNow.length} distinct of ${identities.length} run`);
if (duplicates > 0) {
  // The offending duplicate names, already counted as a named regression above.
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
  /* A removal prints even when the total went up, and says whether the check declared could-not-run or vanished. */
  const declared = new Set(declinedIdentities);
  for (const c of gone) {
    console.log(
      declared.has(c)
        ? `    -  ${c}   <- did not run, and SAID SO: it reported COULD NOT RUN above`
        : `    -  ${c}   <- a check that ran last time did not run now, and said nothing`,
    );
  }
  if (added.length === 0 && gone.length === 0) console.log("    (the same set, exactly)");

  /* Every baseline identity must have run or declared it could not; anything else fails the run. */
  const silent = gone.filter((c) => !declared.has(c));
  silentIdentities = silent;
  console.log(
    `  ENDINGS: ${ranNow.length} ran + ${new Set(declinedIdentities).size} declared ` +
      `COULD NOT RUN · baseline ${previous.length} · silent ${silent.length}`,
  );
  if (silent.length > 0) {
    failures.push({
      session: "R58",
      name: "every registered check reports an ending",
      evidence:
        `${silent.length} check(s) in the committed baseline neither ran nor declared ` +
        `COULD NOT RUN: ${silent.join(" | ")}`,
    });
    console.log(
      "\nNAMED REGRESSION [R58] every registered check reports an ending — " +
        `${silent.length} check(s) reported NOTHING. A check that cannot run SAYS SO.`,
    );
    for (const c of silent) console.log(`    ×  ${c}`);
    // The summary above was printed before this check ran; the exit code is shared.
    console.log(
      `  the summary above was printed before this check ran; regressions are now ` +
        `${failures.length}`,
    );
  }
}

/**
 * The baseline is written only by a run against a local build, and refused by
 * a run that lost a check silently: a run that lost a check may not overwrite
 * the file whose job is to notice that.
 */
const LOCAL_TARGET = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(BASE);
if (!LOCAL_TARGET) {
  /* A baseline is a claim about the suite against a local build. */
  console.log(
    `\n  docs/walk-checks.txt NOT written — this run targeted ${BASE}, which is not a\n` +
      `  local build. Diffing still happened above.`,
  );
} else if (silentIdentities.length > 0) {
  console.log(
    `\n  docs/walk-checks.txt NOT written — ${silentIdentities.length} identity(ies) in the\n` +
      `  committed baseline neither ran nor declared COULD NOT RUN on this run, and\n` +
      `  writing now would delete them, which is the check dying quietly arriving\n` +
      `  through the very file written to prevent it. Named above under [R58]:`,
  );
  for (const c of silentIdentities) console.log(`    ×  ${c}`);
} else {
  /*
   * The baseline records which checks exist: the union of what ran and what
   * declared it could not. A could-not-run is not a retirement.
   */
  const everyIdentity = [...new Set([...identities, ...declinedIdentities])].sort();
  const carriedDeclined = declinedIdentities.filter((d) => !identities.includes(d)).length;
  writeFileSync(
    CHECKS_FILE,
    `# The identity of every check pnpm walk:all HAS, one per line, sorted.\n` +
    `# Written by scripts/walk-all.mts on every production run and COMMITTED, so the\n` +
    `# next run diffs against it by set difference instead of subtracting two totals —\n` +
    `# a run that loses three checks and gains seven reports +4 either way, and the\n` +
    `# check dying quietly is the failure this suite exists to catch.\n` +
    `# Checks that COULD NOT RUN this time ARE here (NH112, 2026-08-24). This file\n` +
    `# records which checks EXIST, never which ones ran: a check that could not run\n` +
    `# has not been retired, and dropping it would make it impossible to ever report\n` +
    `# gone. The per-run outcome is reported separately, above, on every run.\n` +
      `${everyIdentity.join("\n")}\n`,
    "utf8",
  );
  console.log(
    `\n  docs/walk-checks.txt written — ${everyIdentity.length} identities ` +
      `(${ranNow.length} ran, ${carriedDeclined} carried because they COULD NOT RUN).`,
  );
}

/** Wall time and the twenty slowest checks, printed every run. */
{
  const totalMs = Date.now() - STARTED_AT;
  const slowest = [...durations].sort((a, b) => b.ms - a.ms).slice(0, 20);

  console.log(`\n  WALL TIME: ${(totalMs / 1000).toFixed(1)}s total over ${durations.length} checks.`);
  console.log("  The twenty slowest checks, by the wall time attributed to each");
  console.log("  (the assertion plus the page load, zip seed and waits it needed):");
  for (const [i, d] of slowest.entries()) {
    console.log(`    ${String(i + 1).padStart(2)}. ${(d.ms / 1000).toFixed(2)}s  ${d.identity}`);
  }
  if (waitTimeouts.length > 0) {
    const byLabel = new Map<string, number>();
    for (const w of waitTimeouts) byLabel.set(w.label, (byLabel.get(w.label) ?? 0) + 1);
    console.log(`  Waits that ran out: ${waitTimeouts.length} (${[...byLabel].map(([label, n]) => `${label} ×${n}`).join(", ")})`);
  }
}

if (failures.length > 0) process.exit(1);
