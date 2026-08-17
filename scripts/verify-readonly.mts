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
const STORES = ["search_log", "reactions", "intake_limiter"];

let failures = 0;
function report(label: string, ok: boolean, detail: string) {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label} — ${detail}`);
}

// ── 1. Who the connection actually is ────────────────────────────────────
const who = (await sql`
  select current_user as who,
         pg_has_role(current_user, 'neon_superuser', 'member') as superuser_member
`) as { who: string; superuser_member: boolean }[];
const identity = who[0];
console.log("IDENTITY");
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
  const exists = (await sql`select to_regclass(${"public." + table}) is not null as present`) as {
    present: boolean;
  }[];
  if (!exists[0].present) {
    console.log(`  CANNOT-RUN  ${table} — the table does not exist on this database`);
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
}

// ── 3. A real read, and a real attempted write ───────────────────────────
console.log("\nATTEMPTED OPERATIONS");
try {
  const rows = (await sql`select count(*)::int as n from search_log`) as { n: number }[];
  report("a SELECT through the variable succeeds", true, `search_log holds ${rows[0].n} rows`);
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

console.log(
  `\n${failures === 0 ? "R36 CLOSES" : `R36 STAYS OPEN — ${failures} check(s) failed`}\n`,
);
process.exit(failures === 0 ? 0 : 1);
