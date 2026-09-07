/**
 * **ASK MAPTILER WHAT WE SPENT** — `pnpm maptiler:usage` (MAPQ-5, 2026-09-07).
 *
 * The first billing period closed at 101,863 requests against a 100,000-request
 * free allowance while public readership was tiny, and nothing in this
 * repository could confirm or refute a single one of those requests: they are
 * made by browsers, to a third party, and none of them crosses a host we own.
 * The only authority on what MapTiler counted is MapTiler.
 *
 * So this reads the provider's own analytics — read-only, GET only, with a
 * SERVICE credential and never the public browser key — and writes the reading
 * to `data/ops/maptiler-usage.json`. `pnpm owner:publish` then folds that file
 * onto the owner snapshot, which is how it reaches the admin console: the
 * console reads ONE record at ONE instant, and a deployed Netlify bundle has no
 * working tree to read this file from.
 *
 * ## Two classifiers, and what happens when the credential is missing
 *
 * `api_keys` is what attribution needs; `services` is fetched too so `Tiles`
 * and `Rendered maps` cannot collapse into one unexplained bucket. With no
 * `MAPTILER_SERVICE_TOKEN` the file records **NOT CONNECTED** and says which
 * variable is missing by name. It never records a zero. A zero would read as
 * headroom, which is the single most expensive wrong answer this file could
 * give.
 *
 * ## And our own side of the comparison (MAPQ-7)
 *
 * When a production read-only database URL is available, the run also counts
 * reader-app events by the actor class the runner ALREADY declares
 * (`search_log.run_class`). No new identity system, no person-level anything,
 * no IP, no new column — just the aggregate that lets an owner see whether our
 * declared robots still move with the provider's numbers. After MAPQ-1 they
 * must not.
 *
 * ## The credential
 *
 * Read by name from the environment, sent in an `Authorization` header, and
 * never printed, written, or put in an error message. `lib/ops/provider-access.ts`
 * additionally blocks a browser from reaching `service.maptiler.com` at all, so
 * a page can never be the thing that holds one.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  fetchTimeline,
  scrubToken,
  serviceTokenFromEnv,
} from "../lib/control-plane/maptiler/client.ts";
import {
  MAPTILER_ALLOWANCE_VAR,
  MAPTILER_SERVICE_TOKEN_VAR,
  MAPTILER_USAGE_FORMAT_VERSION,
  type MapTilerActorCounts,
  type MapTilerClassifier,
  type MapTilerFetchProvenance,
  type MapTilerUsageDay,
  type MapTilerUsageSnapshot,
} from "../lib/control-plane/maptiler/types.ts";
import { allowanceFrom, normalizeTimeline, projectPanel } from "../lib/control-plane/maptiler/usage.ts";
import { RUN_CLASS_CENSUS_WINDOW_SQL } from "../lib/signal/search-log-reads.ts";
import { floorLine, floored } from "../lib/ops/denominator-floor.ts";

export const USAGE_FILE = join("data", "ops", "maptiler-usage.json");

const NOW_ISO = new Date().toISOString();
const OUT = join(process.cwd(), USAGE_FILE);
const DRY_RUN = process.argv.includes("--dry-run");

function log(line: string): void {
  console.log(`maptiler:usage · ${line}`);
}

/**
 * Reader-app events by declared actor class, over the same window as the bill.
 *
 * READ-ONLY, against the production replica, through the same column the store
 * already carries. It counts rows; it reads no identifier, and there is none in
 * the row to read. A failure here is a NULL — we could not ask — and never a
 * zero, exactly as everywhere else in this repair.
 */
async function actorCounts(since: string | null, until: string | null): Promise<MapTilerActorCounts | null> {
  const url = process.env.WTP_PRODUCTION_DATABASE_URL_READONLY?.trim();
  if (!url || since === null || until === null) return null;
  try {
    const { neon } = await import("@neondatabase/serverless");
    const sql = neon(url);
    /* The query is `lib/signal/search-log-reads.ts`'s, not this script's. That
     * module is the only door into this table, and a windowed census
     * hand-written here would be a second reader of it that nothing checks. */
    const rows = (await sql.query(RUN_CLASS_CENSUS_WINDOW_SQL, [
      `${since}T00:00:00Z`,
      `${until}T23:59:59Z`,
    ])) as { run_class: string; n: number }[];
    const of = (name: string): number => rows.find((r) => r.run_class === name)?.n ?? 0;
    return {
      since,
      until,
      declaredSynthetic: of("SYNTHETIC"),
      undeclaredPublic: of("ORGANIC"),
      unattributed: of("UNKNOWN"),
      author: of("AUTHOR"),
    };
  } catch (error) {
    log(`could not count reader events (${(error as Error)?.name ?? "error"}) — the comparison is a gap, not a zero`);
    return null;
  }
}

async function main(): Promise<void> {
  const token = serviceTokenFromEnv();
  const { allowance, assumed } = allowanceFrom(process.env[MAPTILER_ALLOWANCE_VAR]);

  let snapshot: MapTilerUsageSnapshot;

  if (token === null) {
    /*
     * NOT CONNECTED is a legitimate state and a NEEDS OWNER, and it is not a
     * measurement of zero. The two must never be collapsed: one says the
     * account is quiet, the other says nobody has asked.
     */
    snapshot = {
      formatVersion: MAPTILER_USAGE_FORMAT_VERSION,
      collectedAt: NOW_ISO,
      publisher: "pnpm maptiler:usage",
      connection: "NOT_CONNECTED",
      detail:
        `NOT CONNECTED — ${MAPTILER_SERVICE_TOKEN_VAR} is not set in this runtime, so nobody has ` +
        "asked MapTiler what this account spent. That is a fact about our configuration, not " +
        "about the bill, and it must never be read as headroom. The token is created on the " +
        "MapTiler account's Credentials page; docs/maptiler-keys.md carries the owner action.",
      period: "current_billing_period",
      since: null,
      until: null,
      allowance,
      allowanceIsAssumed: assumed,
      days: [],
      provenance: [],
      actors: null,
    };
    log(snapshot.detail ?? "NOT CONNECTED");
  } else {
    const days: MapTilerUsageDay[] = [];
    const provenance: MapTilerFetchProvenance[] = [];
    let since: string | null = null;
    let until: string | null = null;
    let anyOk = false;
    const failures: string[] = [];

    for (const classifier of ["api_keys", "services"] as MapTilerClassifier[]) {
      const result = await fetchTimeline({
        period: "current_billing_period",
        classifier,
        group: "request",
        token,
        nowIso: NOW_ISO,
      });
      provenance.push(result.provenance);
      if (!result.ok || result.timeline === null) {
        failures.push(result.provenance.error ?? `classifier=${classifier} failed`);
        log(`classifier=${classifier} FAILED — ${result.provenance.error}`);
        continue;
      }
      anyOk = true;
      since ??= result.timeline.since ?? null;
      until ??= result.timeline.until ?? null;
      const rows = normalizeTimeline({ timeline: result.timeline, classifier, group: "request" });
      days.push(...rows);
      log(
        `classifier=${classifier} 200 · ${result.provenance.datasets} dataset(s), ` +
          `${rows.length} day row(s), sha256 ${result.provenance.responseSha256.slice(0, 12)}…`,
      );
    }

    snapshot = {
      formatVersion: MAPTILER_USAGE_FORMAT_VERSION,
      collectedAt: NOW_ISO,
      publisher: "pnpm maptiler:usage",
      connection: anyOk ? "CONNECTED" : "COULD_NOT_ASK",
      detail: anyOk
        ? failures.length > 0
          ? scrubToken(`Partial reading: ${failures.join(" ")}`, token)
          : null
        : scrubToken(
            `COULD NOT ASK — every request to MapTiler's analytics API failed. ${failures.join(" ")} ` +
              "This is not a reading of zero.",
            token,
          ),
      period: "current_billing_period",
      since,
      until,
      allowance,
      allowanceIsAssumed: assumed,
      days,
      provenance,
      actors: await actorCounts(since, until),
    };
  }

  /* Read it back the way the console will, so a shape that cannot be rendered
   * fails here rather than on the owner's page. */
  const panel = projectPanel({ snapshot });
  log(panel.says);

  /*
   * RULING 159: the count is printed over its population, and an unasked
   * question is COULD NOT ASSERT rather than "0 of 0". On a quota reading the
   * distinction is the whole point — a measured zero reads as headroom, and a
   * missing credential is not a measurement of anything.
   */
  const datasets = snapshot.provenance.reduce((sum, p) => sum + p.datasets, 0);
  log(
    `  ${floorLine(
      floored(
        "day rows read",
        "the datasets MapTiler's timeline returned",
        datasets,
        snapshot.days.length,
        datasets === 0
          ? (snapshot.detail ?? "MapTiler returned no dataset, so nothing was counted")
          : undefined,
      ),
    )}`,
  );
  for (const row of panel.byKey) {
    log(`  ${row.label.padEnd(38)} ${row.requests.toLocaleString("en-US").padStart(9)}  ${row.expectation}`);
  }
  for (const row of panel.byService) {
    log(`  service ${row.service.padEnd(30)} ${row.requests.toLocaleString("en-US").padStart(9)}`);
  }
  if (panel.burn) log(`  burn: ${panel.burn.says}`);
  for (const need of panel.needsOwner) log(`  NEEDS OWNER: ${need}`);

  const serialized = JSON.stringify(snapshot, null, 2);
  if (token !== null && serialized.includes(token)) {
    /* Belt and braces on the one thing that must never be written. */
    throw new Error(
      "REFUSING TO WRITE: the service credential appears in the usage record. Nothing carrying a " +
        "token may reach a committed file, a log, or a rendered page.",
    );
  }

  if (DRY_RUN) {
    log(`--dry-run: ${USAGE_FILE} not written`);
    return;
  }
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${serialized}\n`, "utf8");
  log(`wrote ${USAGE_FILE} — ${snapshot.connection}, ${snapshot.days.length} day row(s)`);
  log("run `pnpm owner:publish` to put this reading on the admin console");
}

await main();
