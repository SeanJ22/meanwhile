import { createGuardedNeon } from "@/lib/db/guarded-neon";

import {
  compareSchemaState,
  describeSchemaState,
  readJournal,
} from "@/lib/db/schema-state";

/**
 * GET /api/schema — does the database this deploy talks to have the migrations
 * this deploy was built from?
 *
 * **Prompt D item 6.1, 2026-08-20. D73's class.** Migration 0011 added
 * `coverage_tier` to both sold stores, the code that names it shipped, the
 * migration was never applied, and every insert into `search_log` and
 * `reactions` failed for four hours while the site served normally and every
 * instrument stayed green. Nothing in the product could be ASKED whether the
 * schema matched, so nobody asked.
 *
 * ## Where in the lifecycle it runs, and why there
 *
 * **On request, against the live database, uncached.** Not at build time and
 * not at cold start, for one reason each:
 *
 * - **Build time cannot see the answer.** The Netlify build has no production
 *   database credential, and giving it one to run a read would put a write-
 *   capable-adjacent secret into the build environment to answer a question the
 *   running deploy can answer for free.
 * - **Cold start answers once and then stops.** The drift this catches appears
 *   when a migration is committed and not applied, which can happen at any
 *   moment AFTER a process starts. A cached answer from cold start would report
 *   "in sync" through the entire window the gate exists to catch — which is
 *   exactly the shape of the original defect.
 *
 * So: per request, no cache, and the callers are machines. `pnpm walk:all`
 * asserts it at the end of every session and `pnpm db:check` runs it in the
 * scheduled jobs, which is where "fails loudly" actually happens — a red walk
 * and a red scheduled run, both in places this repo reads.
 *
 * ## What a mismatch does
 *
 * **HTTP 503, with the missing migrations NAMED by tag.** Not 200-with-a-flag:
 * a status a monitor already understands is the loud part, and a body nobody
 * parses is how the first version of this would have failed quietly too. The
 * body carries what to run.
 *
 * ## RULING 25
 *
 * This is an ops endpoint. It has no reader surface, it is linked from nothing,
 * and no reader-facing behaviour changes whatever it answers. A 503 here does
 * not degrade a single page.
 *
 * ## What it does not report
 *
 * Nothing about the connection: no host, no user, no database name, no
 * credential shape. Migration TAGS are already public — they are committed in
 * this repo — and the counts are arithmetic over them.
 */

// Read per request: a cached answer is the defect this endpoint exists to
// catch, wearing this endpoint's name.
export const dynamic = "force-dynamic";

export async function GET() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    /*
     * No database configured is an ordinary state for a local build, and it is
     * NOT "in sync" — an absent answer may never render as a passing one. 501
     * says the question could not be asked here, which a caller can tell apart
     * from 503's "asked, and the answer is bad".
     */
    return Response.json(
      {
        checked: false,
        reason: "DATABASE_URL is not set — the schema state could not be read here.",
      },
      { status: 501, headers: { "cache-control": "no-store, max-age=0" } },
    );
  }

  const journal = readJournal();

  let appliedWhen: number[];
  try {
    const sql = createGuardedNeon(url);
    const rows = (await sql`
      SELECT created_at FROM drizzle.__drizzle_migrations
    `) as { created_at: string | number }[];
    appliedWhen = rows.map((r) => Number(r.created_at));
  } catch (error) {
    // COULD NOT READ, never zero. Zero applied migrations would read as "the
    // database has nothing", which is a specific and probably false claim
    // about production made out of our own failure to connect.
    return Response.json(
      {
        checked: false,
        codeHead: journal[journal.length - 1]?.tag ?? "unknown",
        reason: `could not read drizzle.__drizzle_migrations: ${
          (error as Error).message.slice(0, 200)
        }`,
      },
      { status: 502, headers: { "cache-control": "no-store, max-age=0" } },
    );
  }

  const state = compareSchemaState(journal, appliedWhen);
  return Response.json(
    { checked: true, ...state, summary: describeSchemaState(state) },
    {
      status: state.inSync ? 200 : 503,
      headers: { "cache-control": "no-store, max-age=0" },
    },
  );
}
