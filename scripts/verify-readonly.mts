import { storedKeyEnvironment } from "../lib/core/keys-values.ts";
/** Verify the saved reader can SELECT, cannot write, and inherits no owner privileges. */

import { neon } from "../lib/db/client.ts";


const VAR = "WTP_PRODUCTION_DATABASE_URL_READONLY";
const connection = storedKeyEnvironment()[VAR];
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
// Every collection store; a store this script forgets is one nobody has proved read-only.
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
  // The connection itself was refused: one FAIL and a stated list of what could not run.
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
   * `limit 1` and no count: SELECT must reach a real store table (grants are
   * per-table), but a raw search_log total must never be printed outside the
   * organic filter (lib/signal/search-log-reads.ts).
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
