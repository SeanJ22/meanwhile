/**
 * `pnpm verify:local-write` — R42, verified on evidence rather than on a report.
 *
 * R42's complaint was narrow and checkable: `.env.local`'s `DATABASE_URL`
 * carried a role that does not exist on the branch it points at, so every
 * local write path failed at the driver and NO LOCAL RUN COULD PROVE A WRITE.
 * That is what this script proves, end to end, through the application's own
 * write paths rather than through a hand-written INSERT — a raw INSERT would
 * prove the driver works and nothing about the code a reader's submission
 * actually travels through.
 *
 * Six probes, in order, each printing what it actually got:
 *
 * 1. **The declaration** — `WTP_DB_ROLE` must say `local`. This script
 *    WRITES, so it refuses to run at all against an undeclared role.
 *    `write-guard.ts` reads undeclared as production, and this honours that
 *    reading rather than re-deciding it.
 * 2. **The wrong-branch check** — the variable named READONLY must not point
 *    at the SAME HOST as `DATABASE_URL`. A Neon role lives on one branch, so
 *    "right role, wrong branch" authenticates nowhere and reads nothing; it
 *    is the exact failure that produced R36 and R42 in both directions, and
 *    it is invisible to any check that only asks whether a connection works.
 * 3. **Connection** — `current_user`, `current_database()`, host.
 * 4. **Schema currency** — every migration in the journal is applied here. A
 *    local branch behind production fails a write for a reason that looks
 *    exactly like R42 and is not R42.
 * 5. **A real write through the real path** — `logSearchEvent` and
 *    `writeFeedback`, both marked SYNTHETIC with a run id this script mints,
 *    then read back BY that run id. A write nobody reads back is the empty
 *    success `CLAUDE.md` forbids.
 * 6. **Cleanup, counted** — the two probe rows are deleted and the DELTA
 *    across each store is printed, so a repeated run cannot silently
 *    accumulate and the deletion cannot silently take more than it made.
 *    Deltas rather than totals, deliberately: `verify-readonly.mts` gives the
 *    reason, and it holds here too even though this is the local branch —
 *    a raw `search_log` total printed by a probe is a number somebody can
 *    quote, and every countable number out of that table is supposed to have
 *    gone through the organic filter first.
 *
 * It touches the LOCAL branch only, and step 2 is what makes that claim
 * checkable rather than assumed.
 *
 * Run: `pnpm verify:local-write`
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { neon } from "@neondatabase/serverless";
import { config as loadEnv } from "dotenv";

loadEnv({ path: join(process.cwd(), ".env.local") });

// Imported after the env is loaded: `write-guard.ts` and the write paths read
// `process.env` at call time, but a static import that ran first would give a
// reader every reason to think otherwise.
const { logSearchEvent } = await import("../lib/db/search-log.ts");
const { writeFeedback } = await import("../lib/db/feedback.ts");
const { describeWriteContext } = await import("../lib/db/write-guard.ts");

let failures = 0;
function report(label: string, ok: boolean, detail: string) {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label} — ${detail}`);
}
function cannotRun(label: string, detail: string) {
  console.log(`  CANNOT-RUN  ${label} — ${detail}`);
}
function finish(): never {
  console.log(
    `\n${failures === 0 ? "R42 CLOSES" : `R42 STAYS OPEN — ${failures} check(s) failed`}\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

// ── 1. The declaration ───────────────────────────────────────────────────
console.log("\nDECLARATION");
const context = describeWriteContext();
report(
  "DATABASE_URL is declared local",
  context.dbRole === "local",
  `WTP_DB_ROLE = ${JSON.stringify(process.env.WTP_DB_ROLE ?? null)} -> ${context.dbRole}`,
);
const connection = process.env.DATABASE_URL;
report("DATABASE_URL is set", Boolean(connection), connection ? "set" : "unset");
if (!connection || context.dbRole !== "local") {
  cannotRun(
    "every probe below",
    "this script WRITES, and it will not write through a connection that has not declared itself local",
  );
  finish();
}

const url = new URL(connection);
console.log(`  role = ${url.username}`);
console.log(`  host = ${url.hostname}`);
console.log(`  db   = ${url.pathname.slice(1).split("?")[0]}`);

// ── 2. The wrong-branch check ────────────────────────────────────────────
console.log("\nBRANCH SEPARATION");
const readonlyRaw = process.env.WTP_PRODUCTION_DATABASE_URL_READONLY;
if (!readonlyRaw) {
  cannotRun(
    "the local branch is not the production branch",
    "WTP_PRODUCTION_DATABASE_URL_READONLY is unset, so there is nothing to compare against",
  );
} else {
  const readonlyHost = new URL(readonlyRaw).hostname;
  report(
    "the local branch is not the branch the READONLY variable points at",
    readonlyHost !== url.hostname,
    readonlyHost === url.hostname
      ? `both point at ${url.hostname} — one of the two variables is on the wrong branch`
      : `local = ${url.hostname}, readonly = ${readonlyHost}`,
  );
}

// ── 3. Connection ────────────────────────────────────────────────────────
console.log("\nCONNECTION");
const sql = neon(connection);
let connected = false;
try {
  const rows = (await sql`select current_user as who, current_database() as db`) as {
    who: string;
    db: string;
  }[];
  connected = true;
  report(
    "the connection authenticates",
    true,
    `current_user = ${rows[0].who}, current_database = ${rows[0].db}`,
  );
} catch (error) {
  report("the connection authenticates", false, errorText(error));
}
if (!connected) {
  cannotRun("every probe below", "there is no connection to write through");
  finish();
}

// ── 4. Schema currency ───────────────────────────────────────────────────
console.log("\nSCHEMA CURRENCY");
const journal = JSON.parse(
  readFileSync(join(process.cwd(), "lib/db/migrations/meta/_journal.json"), "utf8"),
) as { entries: { tag: string; when: number }[] };
const appliedRows = (await sql`select created_at from drizzle.__drizzle_migrations`) as {
  created_at: string | number;
}[];
const appliedWhen = new Set(appliedRows.map((r) => Number(r.created_at)));
const missing = journal.entries.filter((e) => !appliedWhen.has(e.when));
report(
  "every migration in the journal is applied on this branch",
  missing.length === 0,
  missing.length === 0
    ? `${journal.entries.length} of ${journal.entries.length} applied`
    : `missing ${missing.map((m) => m.tag).join(", ")} — ${appliedRows.length} of ${journal.entries.length} applied`,
);

// ── 5. A real write through the real path ────────────────────────────────
console.log("\nWRITE AND READ BACK");
const runId = `verify-local-write@${new Date().toISOString()}`;
const marker = { runClass: "SYNTHETIC" as const, runId };
console.log(`  run id = ${runId}`);

const beforeLog = (await sql`select count(*)::int as n from search_log`) as { n: number }[];
const beforeFeedback = (await sql`select count(*)::int as n from feedback`) as { n: number }[];

try {
  const wrote = await logSearchEvent({
    eventType: "SEARCH",
    approximateLocation: "03255",
    ocdIds: [],
    detail: { probe: "verify-local-write" },
    marker,
  });
  report("logSearchEvent reports a write", wrote, `returned ${wrote}`);
} catch (error) {
  report("logSearchEvent reports a write", false, errorText(error));
}

try {
  const result = await writeFeedback({
    message: "verify:local-write probe row - R42 evidence, not a reader.",
    surface: "TRANSPARENCY",
    marker,
  });
  report(
    "writeFeedback reports a write",
    result.kind === "STORED",
    result.kind === "FAILED" ? `${result.kind}: ${result.reason}` : result.kind,
  );
} catch (error) {
  report("writeFeedback reports a write", false, errorText(error));
}

const logRows = (await sql`
  select run_class from search_log where run_id = ${runId}
`) as { run_class: string }[];
report(
  "the search log row reads back by its run id",
  logRows.length === 1 && logRows[0].run_class === "SYNTHETIC",
  `${logRows.length} row(s), run_class = ${logRows[0]?.run_class ?? "none"}`,
);

const feedbackRows = (await sql`
  select run_class from feedback where run_id = ${runId}
`) as { run_class: string }[];
report(
  "the feedback row reads back by its run id",
  feedbackRows.length === 1 && feedbackRows[0].run_class === "SYNTHETIC",
  `${feedbackRows.length} row(s), run_class = ${feedbackRows[0]?.run_class ?? "none"}`,
);

// ── 6. Cleanup, counted ──────────────────────────────────────────────────
console.log("\nCLEANUP");
const deletedLog = (await sql`
  delete from search_log where run_id = ${runId} returning id
`) as { id: string }[];
const deletedFeedback = (await sql`
  delete from feedback where run_id = ${runId} returning id
`) as { id: string }[];
const afterLog = (await sql`select count(*)::int as n from search_log`) as { n: number }[];
const afterFeedback = (await sql`select count(*)::int as n from feedback`) as { n: number }[];
report(
  "the probe rows are removed and both stores return to where they started",
  afterLog[0].n === beforeLog[0].n && afterFeedback[0].n === beforeFeedback[0].n,
  `search_log delta ${afterLog[0].n - beforeLog[0].n} (deleted ${deletedLog.length}), ` +
    `feedback delta ${afterFeedback[0].n - beforeFeedback[0].n} (deleted ${deletedFeedback.length})`,
);

finish();

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "unknown";
}
