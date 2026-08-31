/**
 * `pnpm control-plane:bootstrap` — bring the dedicated control-plane database
 * up to the declared schema version.
 *
 * (Session B resume, W3.D, 2026-08-31. RULING 220, tracker NH300.)
 *
 * Separate from `control-plane:gate` on purpose. The GATE reads and judges and
 * never writes; this WRITES. A gate that quietly bootstrapped what it found
 * missing could never report a missing table, because it would have created it
 * before deciding — which is a check that repairs the thing it is checking and
 * therefore checks nothing.
 *
 * ## The duplicate-position sweep runs BEFORE the unique index
 *
 * Schema version 2 makes `(log_key, position)` UNIQUE, and version 1 could
 * admit duplicates under concurrent appends. `CREATE UNIQUE INDEX` over a table
 * that already holds one fails with a message naming the INDEX, which tells an
 * operator nothing about which log raced. So the duplicates are looked for
 * first and reported by log, key and position.
 *
 * Env var names only, never values.
 */

import {
  BOOTSTRAP_VERSION,
  APPEND_ONLY_LOGS,
  DECLARED_TABLES,
  duplicatePositionQuery,
} from "../lib/control-plane/repository/pg-schema.ts";
import {
  CONTROL_PLANE_URL_VAR,
  controlPlaneUrlFromEnv,
  createPgRepositories,
} from "../lib/control-plane/repository/pg-store.ts";
import { floorLine, floored } from "../lib/ops/denominator-floor.ts";

const url = controlPlaneUrlFromEnv();
if (url === null) {
  console.error(
    `control-plane:bootstrap · ${CONTROL_PLANE_URL_VAR} is not set. Nothing was done, and no ` +
      "schema claim is made.",
  );
  process.exit(1);
}

const { neon } = await import("@neondatabase/serverless");
const sql = neon(url);

console.log(`control-plane:bootstrap · target schema version ${BOOTSTRAP_VERSION}`);

/* --------------------------------------- the pre-flight duplicate sweep --- */

const tables = (await sql.query(
  `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
)) as { table_name: string }[];
const present = new Set(tables.map((t) => t.table_name));

let duplicates = 0;
for (const log of APPEND_ONLY_LOGS) {
  if (!present.has(`cp_log_${log}`)) continue;
  const rows = (await sql.query(duplicatePositionQuery(log))) as {
    log_key: string;
    position: string;
    n: string;
  }[];
  for (const row of rows) {
    duplicates += 1;
    console.error(
      `  DUPLICATE POSITION cp_log_${log} key ${row.log_key} position ${row.position}: ` +
        `${row.n} records share it. The version-1 schema admitted this; version 2 refuses it. ` +
        "A person must decide which record keeps the position before the unique index can exist.",
    );
  }
}
if (duplicates > 0) {
  console.error(
    `\ncontrol-plane:bootstrap · REFUSED — ${duplicates} duplicate position(s). The unique index ` +
      "is not created, the version is not recorded, and the database stays at its current version.",
  );
  process.exit(1);
}
/*
 * RULING 159: the sweep's clean result is stated against the population it was
 * taken over. "0 duplicates" is the same sentence whether five logs were
 * examined or none existed to examine, and those are opposite facts about
 * whether this check ran.
 */
const examined = APPEND_ONLY_LOGS.filter((l) => present.has(`cp_log_${l}`));
console.log(
  `  ${floorLine(
    floored(
      "append-only log(s) examined for duplicate positions",
      "the logs this schema declares",
      APPEND_ONLY_LOGS.length,
      examined.length,
      undefined,
    ),
  )} — ${duplicates} duplicate position(s) found`,
);

/* ------------------------------------------------------- the bootstrap --- */

/* `createPgRepositories` runs the bootstrap on connect and records the version.
   Going through it rather than calling `bootstrap` directly means this script
   exercises the same path every other caller takes. */
const repos = await createPgRepositories(url, new Date().toISOString());
console.log(`  ${repos.describe()}`);

const version = (await sql.query(
  `SELECT version, applied_at FROM cp_schema_version WHERE singleton = true`,
)) as { version: number; applied_at: string }[];

const after = (await sql.query(
  `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'
   AND table_name LIKE 'cp\\_%' ORDER BY table_name`,
)) as { table_name: string }[];

console.log(`  applied version: ${version[0]?.version ?? "NONE RECORDED"}`);
console.log(
  `  ${floorLine(
    floored(
      "declared control-plane tables now present",
      "the dedicated control-plane database",
      DECLARED_TABLES.length,
      after.filter((t) => DECLARED_TABLES.includes(t.table_name)).length,
      DECLARED_TABLES.length === 0 ? "the provider declares no tables" : undefined,
    ),
  )}`,
);
for (const t of after) console.log(`      ${t.table_name}`);
console.log(
  "\ncontrol-plane:bootstrap · done. `pnpm control-plane:gate` is the check; this was the write.",
);
