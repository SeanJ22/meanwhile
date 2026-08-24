/**
 * `pnpm feedback:read` — the author's path to what readers sent (R40).
 *
 * ## Why a script and not an admin page
 *
 * R40 asked the builder to state whether submissions reach the author by an
 * admin path or an export. This is the export, and the choice was deliberate:
 * an admin page needs authentication, and this product has exactly one
 * account concept (a magic-link identity nobody has built yet) and no admin
 * role at all. Adding a login-gated surface to read a handful of messages
 * would be a new attack surface, a new session mechanism, and a new place for
 * reader text to leak — all to save the one person who reads it from running
 * a command.
 *
 * ## Which database, said out loud
 *
 * Reads through `WTP_PRODUCTION_DATABASE_URL_READONLY` with
 * `--target=production`, and `DATABASE_URL` otherwise. It prints the role and
 * host before it prints anything else, because a read against the wrong
 * database returns an empty list and an empty list looks exactly like "nobody
 * wrote" — the empty-success shape this repo keeps finding.
 *
 * It states its COUNT and its denominator on every run, including zero, and
 * it separates the quarantined rows from the clean ones rather than hiding
 * them: a message that tripped a velocity threshold is still a person writing
 * to the author, and the author decides.
 *
 * Run: `pnpm feedback:read [--target=production] [--since=YYYY-MM-DD] [--all]`
 */
import { join } from "node:path";

import { config as loadEnv } from "dotenv";
import { neon } from "@neondatabase/serverless";

loadEnv({ path: join(process.cwd(), ".env.local") });

const PRODUCTION = process.argv.includes("--target=production");
/** By default the reader's own messages only — synthetic rows are plumbing. */
const ALL = process.argv.includes("--all");
const since = process.argv
  .find((a) => a.startsWith("--since="))
  ?.slice("--since=".length);

const connection = PRODUCTION
  ? process.env.WTP_PRODUCTION_DATABASE_URL_READONLY
  : process.env.DATABASE_URL;
const which = PRODUCTION ? "WTP_PRODUCTION_DATABASE_URL_READONLY" : "DATABASE_URL";

if (!connection) {
  console.error(`feedback:read: ${which} is not set — refusing to guess`);
  process.exit(1);
}

{
  const u = new URL(connection);
  console.log(
    `target: ${which}  role=${u.username}  host=${u.hostname}  ` +
      `WTP_DB_ROLE=${JSON.stringify(process.env.WTP_DB_ROLE ?? null)}`,
  );
}

const sql = neon(connection);

interface Row {
  id: string;
  received_at: string;
  message: string;
  surface: string;
  run_class: string;
  run_id: string | null;
  suspect_reason: string | null;
  /** A-001 · resolved from the delivery store, and null on almost every row. */
  reply_address: string | null;
}

/*
 * **A-001 · THE ONE PLACE THE HANDLE IS RESOLVED, 2026-08-24.**
 *
 * The reply address used to sit on the feedback row as `reply_to`. It moved to
 * `feedback_contact` because a raw email address in a reader collection store
 * made the constitutional claim false — see `lib/db/identity-domains.ts`.
 *
 * Two things worth stating plainly rather than leaving to be inferred.
 *
 * **This query is a join, and the remediation brief said the delivery store
 * would be "joined to nothing".** What it is joined by is a RANDOM handle this
 * project minted, on the author's own read path, and nowhere else in the
 * product. That is the only reason the handle exists. What the brief's phrase
 * protects against — a value letting somebody match these rows to anything
 * else — holds: the address shares no value space with any reader store, and
 * the handle is meaningless outside these two tables.
 *
 * **And the address was never actually readable before.** This query did not
 * select `reply_to`, so R41's reply address had been collected and never
 * surfaced since the day it shipped. Moving it without reading it here would
 * have left a reader who asked to be answered with a store nobody opens, which
 * is the render-default failure one layer down.
 */
const rows = (await sql`
  select f.id, f.received_at, f.message, f.surface, f.run_class, f.run_id,
         f.suspect_reason, c.address as reply_address
  from feedback f
  left join feedback_contact c on c.contact_ref = f.contact_ref
  where (${since ?? null}::text is null or f.received_at >= ${since ?? null}::timestamptz)
  order by f.received_at desc
`) as Row[];

const organic = rows.filter((r) => r.run_class === "ORGANIC");
const shown = ALL ? rows : organic;
const clean = shown.filter((r) => !r.suspect_reason);
const quarantined = shown.filter((r) => r.suspect_reason);

console.log(
  `\n${rows.length} row(s) in the store${since ? ` since ${since}` : ""} · ` +
    `${organic.length} organic · ${rows.length - organic.length} declared automated` +
    `${ALL ? " (showing all)" : " (showing organic only; --all for the rest)"}\n`,
);

function render(list: Row[], heading: string) {
  console.log(`── ${heading}: ${list.length} ──`);
  if (list.length === 0) {
    console.log("   (none)\n");
    return;
  }
  for (const row of list) {
    const tags = [row.surface, row.run_class !== "ORGANIC" ? row.run_class : null, row.run_id]
      .filter(Boolean)
      .join(" · ");
    console.log(`\n   ${row.received_at}  [${tags}]`);
    if (row.suspect_reason) console.log(`   quarantined: ${row.suspect_reason}`);
    // Printed because a reader typed it into a field that said we would reply.
    if (row.reply_address) console.log(`   reply to: ${row.reply_address}`);
    for (const line of row.message.split("\n")) console.log(`   | ${line}`);
  }
  console.log("");
}

render(clean, "Messages");
render(quarantined, "Quarantined (tripped a rate threshold; nothing is auto-deleted)");
