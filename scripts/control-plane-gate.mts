/**
 * `pnpm control-plane:gate` — THE CONTROL-PLANE DATABASE'S OWN GATE.
 * (Session B, W3.2, 2026-08-30. RULING 220.)
 *
 * RULING 220 puts Level-2 scheduling state in a dedicated database **outside
 * `lib/db`, outside `drizzle.config.ts`, invisible to `pnpm db:gate`**. That
 * exemption is deliberate and it is narrow:
 *
 * > **"Not governed by the serving gate" must not become "ungoverned."**
 *
 * So the control plane gets a gate of its own, checking the three things a
 * Drizzle migration would otherwise have given it:
 *
 * ```
 *   VERSIONED   BOOTSTRAP_VERSION moves when the DDL moves
 *   APPLIED     the database records its version, and this compares
 *   DRIFT       the live cp_ table set against what the module declares, so a
 *               hand edit in a console is caught
 * ```
 *
 * ## NOT_CONFIGURED is a state, and it is not a pass
 *
 * `WTP_CONTROL_PLANE_DATABASE_URL` is absent on a machine with no control
 * plane, which is legitimate — every developer checkout is one. So the gate
 * exits 0 with `NOT_CONFIGURED` printed and the variable NAMED, and it exits
 * NON-ZERO whenever the variable IS set and anything about the schema is
 * wrong. The distinction is the whole design: a gate that exited 0 on an
 * unreachable database would go green on every machine, which is an unenforced
 * check wearing a gate's name.
 *
 * Env var names only, never values. The connection string is read and handed
 * to the driver; it is never printed, never logged, and never written to a
 * record.
 */

import {
  BOOTSTRAP_VERSION,
  DECLARED_TABLES,
  judgeSchema,
  type SchemaVerdict,
} from "../lib/control-plane/repository/pg-schema.ts";
import {
  CONTROL_PLANE_URL_VAR,
  controlPlaneUrlFromEnv,
} from "../lib/control-plane/repository/pg-store.ts";
import { floorLine, floored } from "../lib/ops/denominator-floor.ts";

const url = controlPlaneUrlFromEnv();

async function readLive(connection: string): Promise<{
  reachable: boolean;
  appliedVersion: number | null;
  liveTables: string[] | null;
  reason?: string;
}> {
  try {
    const { neon } = await import("@neondatabase/serverless");
    const sql = neon(connection);
    const tables = (await sql.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
    )) as { table_name: string }[];
    let appliedVersion: number | null = null;
    if (tables.some((t) => t.table_name === "cp_schema_version")) {
      const rows = (await sql.query(
        `SELECT version FROM cp_schema_version WHERE singleton = true`,
      )) as { version: number }[];
      appliedVersion = rows.length > 0 ? Number(rows[0].version) : null;
    }
    return {
      reachable: true,
      appliedVersion,
      liveTables: tables.map((t) => t.table_name),
    };
  } catch (error) {
    /* The MESSAGE, never the connection string. A driver error can echo the
       host; it does not echo the password, and nothing here prints the URL. */
    return {
      reachable: false,
      appliedVersion: null,
      liveTables: null,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

const verdict: SchemaVerdict =
  url === null
    ? judgeSchema({ configured: false, reachable: false, appliedVersion: null, liveTables: null })
    : judgeSchema({ configured: true, ...(await readLive(url)) });

console.log(`control-plane:gate · schema version ${BOOTSTRAP_VERSION} declared by the provider`);

if (!verdict.configured) {
  console.log(
    `  NOT_CONFIGURED — ${CONTROL_PLANE_URL_VAR} is not set on this machine, so there is no ` +
      "control-plane database to check.",
  );
  console.log(
    "  This is a legitimate state and it is NOT a pass on the schema: nothing was read, and " +
      "nothing is claimed. The gate turns hard the moment the variable is set.",
  );
  /*
   * WHAT THIS LINE MAY CLAIM CHANGED ON 2026-08-31, so the line changed with it.
   *
   * It used to read "RULING 220's cutover proof ... has not been performed",
   * which was true while no control-plane database existed. It is now false:
   * The retired cutover-only proof performed all seven conditions against the
   * live Postgres lane and recorded them before its destructive executable was
   * deleted. A gate that goes on asserting an
   * out-of-date fact about our own evidence is doing the same thing this
   * repository refuses everywhere else.
   *
   * What is still true, and is what this says now, is narrower: THIS MACHINE
   * did not read anything on THIS run.
   */
  console.log(
    "  The proof conditions RULING 220 gates cutover on — two-process contention, a real " +
      "crash and reclaim, a restore drill, the due-time index, and concurrent append-log " +
      "correctness — WERE performed against the live lane and recorded under " +
      "data/health/control-plane-proofs/. This run read none of it: an unconfigured machine " +
      "reports what it can see, and it can see nothing.",
  );
  process.exit(0);
}

console.log(
  `  ${floorLine(
    floored(
      "declared control-plane tables present in the database",
      "the dedicated control-plane database",
      DECLARED_TABLES.length,
      DECLARED_TABLES.length - verdict.missingTables.length,
      DECLARED_TABLES.length === 0 ? "the provider declares no tables" : undefined,
    ),
  )}`,
);
console.log(
  `  applied version ${verdict.appliedVersion ?? "NONE RECORDED"} against declared ` +
    `${verdict.expectedVersion}`,
);
if (verdict.unexpectedTables.length > 0) {
  console.log(`  undeclared cp_ tables present: ${verdict.unexpectedTables.join(", ")}`);
}

if (verdict.problems.length > 0) {
  console.error(`\ncontrol-plane:gate · REFUSED — ${verdict.problems.length} problem(s):`);
  for (const p of verdict.problems) console.error(`  · ${p}`);
  process.exit(1);
}

console.log(
  "\ncontrol-plane:gate · the dedicated database is at the declared schema version with no drift",
);
