import { neon } from "@neondatabase/serverless";

import {
  compareSchemaState,
  describeSchemaState,
  readJournal,
} from "@/lib/db/schema-state";

/**
 * GET /api/schema: does the database this deploy talks to have the migrations this deploy was built from?
 *
 * Per request, uncached: drift appears whenever a migration is committed and not applied. A mismatch is HTTP
 * 503 with the missing migrations named by tag. Nothing about the connection is reported.
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
    const sql = neon(url);
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
