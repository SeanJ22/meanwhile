/**
 * `pnpm verify:readonly` — R36, verified on evidence rather than on a report.
 *
 * The row's claim to close is narrow and checkable: the connection string
 * named READONLY must be able to SELECT and must be REFUSED BY THE DATABASE
 * when it tries to write. Three probes, in that order, and every one of them
 * prints what it actually got:
 *
 * 1. **Who am I** — `current_user`, and whether that role is a member of
 *    `neon_superuser`. A role that inherits superuser membership can write
 *    whatever its grants say it cannot.
 * 2. **Privilege, as Postgres itself reports it** — `has_table_privilege` for
 *    SELECT / INSERT / UPDATE / DELETE on every store. This is the
 *    authoritative answer and it touches no row.
 * 3. **An attempted write** — `delete from <table> where false`. It changes
 *    nothing whether it is permitted or refused, so it is safe to run against
 *    production, and it is a REAL attempt rather than an inference: a
 *    permission error here is the database itself saying no.
 *
 * A fourth probe was added 2026-08-17 (g10), ahead of the three, after the
 * variable was repaired in the one way none of them could see. **RIGHT ROLE,
 * WRONG BRANCH.** A Neon role exists on the branch it was created on and
 * nowhere else, so a `readonly` string pointed at the LOCAL branch endpoint
 * authenticates nowhere — and, far worse for a row that closes on this
 * script's word, a `readonly` string that DID authenticate against the local
 * branch would pass all nine checks below while reading a database production
 * has never seen. The probe is structural rather than a hostname allowlist,
 * for the reason `lib/db/write-guard.ts` gives for not hardcoding one: this
 * variable must not point at the same host as `DATABASE_URL`, which is the
 * line declared local.
 *
 * The same pass taught the second lesson, which is the transparency mandate
 * applied to our own instrument: a refused CONNECTION used to escape as an
 * unhandled rejection and a Node stack trace. A failed retrieval is reported
 * as a failed retrieval, so every probe below now runs inside a catch and
 * prints FAIL with the database's own words.
 *
 * It writes nothing, creates nothing, and alters no role. R36 explicitly
 * belongs to the author's hands; this only reports.
 *
 * Run: `pnpm verify:readonly`
 */
import { join } from "node:path";

import { config as loadEnv } from "dotenv";
import { neon } from "@neondatabase/serverless";

loadEnv({ path: join(process.cwd(), ".env.local") });

const VAR = "WTP_PRODUCTION_DATABASE_URL_READONLY";
const connection = process.env[VAR];
if (!connection) {
  console.error(`verify:readonly: ${VAR} is not set — refusing to guess`);
  process.exit(1);
}

const url = new URL(connection);
console.log(`\n${VAR}`);
console.log(`  role = ${url.username}`);
console.log(`  host = ${url.hostname}`);
console.log(`  db   = ${url.pathname.slice(1).split("?")[0]}\n`);

const sql = neon(connection);
// Every collection store, which is four since R40 added `feedback`. The
// n-stores rule is "same rule for every n", and a store this script forgets
// is a store nobody has proved is read-only.
const STORES = ["search_log", "reactions", "intake_limiter", "feedback"];

let failures = 0;
function report(label: string, ok: boolean, detail: string) {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label} — ${detail}`);
}
function cannotRun(label: string, detail: string) {
  console.log(`  CANNOT-RUN  ${label} — ${detail}`);
}
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "unknown";
}
function finish(): never {
  console.log(
    `\n${failures === 0 ? "R36 CLOSES" : `R36 STAYS OPEN — ${failures} check(s) failed`}\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

// ── 0. Which BRANCH this string points at ────────────────────────────────
// Before anything asks who the role is: a role is per-branch, so a string on
// the wrong branch is wrong even when every privilege on it is perfect.
console.log("BRANCH");
const localConnection = process.env.DATABASE_URL;
if (!localConnection) {
  cannotRun(
    "the READONLY variable points at a different branch from DATABASE_URL",
    "DATABASE_URL is unset, so there is nothing to compare against",
  );
} else {
  const localHost = new URL(localConnection).hostname;
  const declaredLocal = process.env.WTP_DB_ROLE === "local";
  if (!declaredLocal) {
    cannotRun(
      "the READONLY variable points at a different branch from DATABASE_URL",
      `WTP_DB_ROLE is ${JSON.stringify(process.env.WTP_DB_ROLE ?? null)}, so DATABASE_URL is not ` +
        "declared local and a shared host would not prove anything",
    );
  } else {
    report(
      "this string is not on the branch DATABASE_URL declares as local",
      localHost !== url.hostname,
      localHost === url.hostname
        ? `both point at ${url.hostname} — this variable is on the LOCAL branch, so it reads a ` +
          "database production has never seen"
        : `readonly = ${url.hostname}, local = ${localHost}`,
    );
  }
}

// ── 1. Who the connection actually is ────────────────────────────────────
console.log("\nIDENTITY");
let identity: { who: string; superuser_member: boolean };
try {
  const who = (await sql`
    select current_user as who,
           pg_has_role(current_user, 'neon_superuser', 'member') as superuser_member
  `) as { who: string; superuser_member: boolean }[];
  identity = who[0];
} catch (error) {
  // The connection itself was refused. Everything below needs it, so this is
  // one FAIL and a stated list of what could not run — never a stack trace,
  // and never silence that reads like the checks passed.
  report("the connection authenticates at all", false, errorText(error));
  cannotRun("every check below", "there is no connection to ask");
  finish();
}
report(
  "the connection is not the owner role",
  identity.who !== "neondb_owner",
  `current_user = ${identity.who}`,
);
report(
  "the role is not a member of neon_superuser",
  identity.superuser_member === false,
  `pg_has_role(neon_superuser) = ${identity.superuser_member}`,
);

// ── 2. Privilege, as Postgres reports it ─────────────────────────────────
console.log("\nPRIVILEGE (has_table_privilege)");
for (const table of STORES) {
  try {
    const exists = (await sql`select to_regclass(${"public." + table}) is not null as present`) as {
      present: boolean;
    }[];
    if (!exists[0].present) {
      cannotRun(table, "the table does not exist on this database");
      continue;
    }
    const rows = (await sql`
      select has_table_privilege(current_user, ${"public." + table}, 'SELECT') as sel,
             has_table_privilege(current_user, ${"public." + table}, 'INSERT') as ins,
             has_table_privilege(current_user, ${"public." + table}, 'UPDATE') as upd,
             has_table_privilege(current_user, ${"public." + table}, 'DELETE') as del
    `) as { sel: boolean; ins: boolean; upd: boolean; del: boolean }[];
    const p = rows[0];
    report(`${table}: SELECT is granted`, p.sel === true, `SELECT = ${p.sel}`);
    report(
      `${table}: no write privilege`,
      !p.ins && !p.upd && !p.del,
      `INSERT = ${p.ins}, UPDATE = ${p.upd}, DELETE = ${p.del}`,
    );
  } catch (error) {
    report(`${table}: privilege could be read at all`, false, errorText(error));
  }
}

// ── 3. A real read, and a real attempted write ───────────────────────────
console.log("\nATTEMPTED OPERATIONS");
try {
  /*
   * `limit 1`, and NO COUNT — deliberately.
   *
   * What this probe needs to prove is that SELECT reaches a real store table,
   * because grants are per-table and a `select 1` against nothing would prove
   * nothing. What it must NOT do is print an unfiltered row total: every
   * countable number out of search_log goes through the organic filter
   * (lib/signal/search-log-reads.ts), and a raw total printed by a probe is a
   * number somebody can quote. So it reports that a row came back, and the
   * privilege table above carries the actual finding.
   */
  const rows = (await sql`select 1 as ok from search_log limit 1`) as { ok: number }[];
  report(
    "a SELECT through the variable succeeds",
    rows.length === 1,
    `search_log returned ${rows.length} row(s) to a limit-1 read`,
  );
} catch (error) {
  report(
    "a SELECT through the variable succeeds",
    false,
    error instanceof Error ? error.message : "unknown",
  );
}

// `where false` matches nothing, so this changes no row whether it is
// permitted or refused. What it DOES do is exercise the DELETE privilege.
try {
  await sql`delete from search_log where false`;
  report(
    "a DELETE through the variable is refused by the database",
    false,
    "the delete was PERMITTED (it matched no rows, so nothing changed — but the privilege is there)",
  );
} catch (error) {
  const message = error instanceof Error ? error.message : "unknown";
  report(
    "a DELETE through the variable is refused by the database",
    /permission denied|must be owner|read-only/i.test(message),
    message,
  );
}

finish();
