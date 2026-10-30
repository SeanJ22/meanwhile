import { CP01_COUNTS_DECLARATIONS, controlCountsMigrationDefinition, expandControlCounts, contractControlCounts, contractControlCountsMigrationDefinition } from "../lib/control-plane/repository/migrations/CP-01-counts.ts";
import { LEGISTAR_WORK_MIGRATION_SOURCE,legistarWorkMigrationDefinition,expandLegistarWork } from "../lib/control-plane/repository/migrations/RB-A9.ts";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool, neonConfig } from "../lib/db/client.ts";
import type { Sql } from "../lib/control-plane/repository/pg-store.ts";
import { CP_MIGRATIONS_DDL } from "../lib/control-plane/repository/pg-schema.ts";
import { CP01_DECLARATION_SOURCES, controlReadsMigrationDefinition, expandControlReads } from "../lib/control-plane/repository/migrations/CP-01.ts";
import { debtStateMigrationDefinition, stampDebtStates } from "../lib/control-plane/repository/migrations/DT-01.ts";
import { WORK_MIGRATION_SOURCE, workMigrationDefinition, expandWorkList } from "../lib/control-plane/repository/migrations/RB-A5.ts";
import { sharedWorkMigrationDefinition, expandSharedWork } from "../lib/control-plane/repository/migrations/RB-A1.ts";
import { reopenHeldDoors, reopenHeldDoorsMigrationDefinition } from "../lib/control-plane/repository/migrations/RIVER-KEYS.ts";
import { reopenKeyHeldDoors, reopenKeyHeldDoorsMigrationDefinition } from "../lib/control-plane/repository/migrations/RIVER-KEYS-FX.ts";

import { COUNT_SCHEMA_SOURCE, countHourMigrationDefinition, installHourlyCounts } from "../lib/control-plane/repository/migrations/RB-A8.ts";
import { buildResearchRevisionIndexes, researchRevisionIndexesMigrationDefinition } from "../lib/control-plane/repository/migrations/DB-03.ts";
import { boxDueIndexesMigrationDefinition, buildBoxDueIndexes } from "../lib/control-plane/repository/migrations/RV-BOX.ts";
import { LINKING_SEEDS, linkingPagesMigrationDefinition, migrateLinkingPages } from "../lib/control-plane/repository/migrations/DB-03A.ts";
import { moveRetiredDoorPages } from "../lib/control-plane/repository/migrations/RIVER-DOORCFG-149.ts";
import { resolveProductionWriteHandle } from "../lib/db/write-handle.ts";
import { installJobBreaker, jobBreakerMigrationDefinition } from "../lib/control-plane/repository/migrations/BB-01.ts";
import { installKeys, keysMigrationDefinition } from "../lib/control-plane/repository/migrations/KB-01.ts";
import { expandOwnerLive, ownerLiveMigrationDefinition } from "../lib/control-plane/repository/migrations/CP-01-LIVE.ts";

const JOURNAL = "lib/control-plane/repository/migrations/meta/_journal.json";
function withProductionReader(migrate: (control: Sql, reader: Sql) => Promise<string>) {
  return async (sql: Sql, env: NodeJS.ProcessEnv, connect: NonNullable<Dependencies["withDatabase"]>) => {
    const reader = resolveProductionWriteHandle(env);
    if (reader.host.replace("-pooler.", ".") !== "ep-dry-river-axwtolzc.c-4.us-east-2.aws.neon.tech")
      throw Error("db:apply: REFUSED — saved linking pages require the production reader database");
    return connect(reader.connection, async readerSql => migrate(sql, readerSql));
  };
}
const MIGRATIONS = [
  { id: "CP-01_expand", source: "lib/control-plane/repository/migrations/CP-01.ts", declarations: CP01_DECLARATION_SOURCES,
    definition: controlReadsMigrationDefinition, apply: async (sql: Sql) => { await expandControlReads(sql); return "control reads"; } },
  { id: "DT-01_expand", source: "lib/control-plane/repository/migrations/DT-01.ts", declarations: [] as readonly string[],
    definition: debtStateMigrationDefinition, apply: async (sql: Sql) => `${await stampDebtStates(sql)} debt(s) given their state` },
  { id: "RB-A1_expand", source: "lib/control-plane/repository/migrations/RB-A1.ts", declarations: [] as readonly string[],
    definition: sharedWorkMigrationDefinition, apply: async (sql: Sql) => { await expandSharedWork(sql); return "shared work and hourly counts"; } },
  { id: "RIVER-KEYS_expand", source: "lib/control-plane/repository/migrations/RIVER-KEYS.ts", declarations: [] as readonly string[],
    definition: reopenHeldDoorsMigrationDefinition, apply: async (sql: Sql) => `${await reopenHeldDoors(sql)} held door(s) reopened` },
  { id: "RIVER-KEYS-FX_expand", source: "lib/control-plane/repository/migrations/RIVER-KEYS-FX.ts", declarations: [] as readonly string[],
    definition: reopenKeyHeldDoorsMigrationDefinition, apply: async (sql: Sql) => `${await reopenKeyHeldDoors(sql)} key-held door(s) reopened` },
  { id: "RB-A5_expand", source: "lib/control-plane/repository/migrations/RB-A5.ts", declarations: [WORK_MIGRATION_SOURCE],
    definition: workMigrationDefinition, apply: expandWorkList },
  { id: "RB-A8_expand", source: "lib/control-plane/repository/migrations/RB-A8.ts", declarations: [COUNT_SCHEMA_SOURCE],
    definition: countHourMigrationDefinition, apply: async (sql: Sql) => { await installHourlyCounts(sql); return "hourly counts"; } },
  { id: "RV-BOX_expand", source: "lib/control-plane/repository/migrations/RV-BOX.ts", declarations: ["lib/control-plane/repository/pg-schema.ts"],
    definition: boxDueIndexesMigrationDefinition, apply: buildBoxDueIndexes },
  { id: "DB-03_expand", source: "lib/control-plane/repository/migrations/DB-03.ts", declarations: ["lib/control-plane/repository/pg-schema.ts"],
    definition: researchRevisionIndexesMigrationDefinition, apply: buildResearchRevisionIndexes },
  { id: "DB-03A_expand", source: "lib/control-plane/repository/migrations/DB-03A.ts", declarations: [LINKING_SEEDS, "lib/facts/linking-copy.ts"],
    definition: linkingPagesMigrationDefinition, apply: withProductionReader(migrateLinkingPages) },
  { id: "BB-01_expand", source: "lib/control-plane/repository/migrations/BB-01.ts", declarations: [] as readonly string[],
    definition: jobBreakerMigrationDefinition, apply: installJobBreaker },
  { id: "CP-01_counts_expand", source: "lib/control-plane/repository/migrations/CP-01-counts.ts", declarations: CP01_COUNTS_DECLARATIONS,
    definition: controlCountsMigrationDefinition, apply: expandControlCounts },
  { id: "CP-01_counts_contract", source: "lib/control-plane/repository/migrations/CP-01-counts.ts", declarations: CP01_COUNTS_DECLARATIONS,
    definition: contractControlCountsMigrationDefinition, apply: contractControlCounts },
  { id:"RB-A9_expand",source:"lib/control-plane/repository/migrations/RB-A9.ts",declarations:[LEGISTAR_WORK_MIGRATION_SOURCE],definition:legistarWorkMigrationDefinition,apply:expandLegistarWork },
  { id: "RIVER-DOORCFG-149_expand", source: "lib/control-plane/repository/migrations/RIVER-DOORCFG-149.ts", declarations: ["lib/control-plane/repository/migrations/DB-03A.ts", LINKING_SEEDS, "lib/facts/linking-copy.ts"],
    definition: linkingPagesMigrationDefinition, apply: withProductionReader(moveRetiredDoorPages) },
  { id: "KB-01_expand", source: "lib/control-plane/repository/migrations/KB-01.ts", declarations: ["lib/core/keys-store.ts"], definition: keysMigrationDefinition, apply: installKeys },
  { id: "CP-01-LIVE_expand", source: "lib/control-plane/repository/migrations/CP-01-LIVE.ts", declarations: ["lib/control-plane/repository/owner-lease-changes.ts"], definition: ownerLiveMigrationDefinition, apply: expandOwnerLive },
] as const;
interface Entry { readonly id: string; readonly phase: "expand" | "contract"; readonly hash: string }
interface Dependencies {
  readonly root?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly head?: () => string;
  readonly servedCommit?: () => Promise<string | null>;
  readonly committed?: (path: string) => Buffer;
  readonly withDatabase?: <T>(connection: string, operation: (sql: Sql) => Promise<T>) => Promise<T>;
}

export function controlPlaneMigrationHash(root = process.cwd(), id: string = MIGRATIONS[0].id): string {
  const migration = MIGRATIONS.find(candidate => candidate.id === id);
  if (!migration) throw new Error(`db:apply: REFUSED — ${id} is not a control-plane migration`);
  return createHash("sha256").update(readFileSync(join(root, migration.source))).update(migration.definition()).digest("hex");
}

export function productionControlPlaneTarget(args: readonly string[], env: NodeJS.ProcessEnv): string {
  const phase = args.find(arg => arg.startsWith("--phase="))?.slice(8);
  const build = args.includes("--production-build") && env.NETLIFY === "true" && env.CONTEXT === "production" && env.BRANCH === "main";
  const runtimeCommit = args.find(arg => arg.startsWith("--runtime-commit="))?.slice(17);
  const runtime = args.includes("--production-runtime") && env.WTP_RUNTIME_MODE === "production" && /^[0-9a-f]{40}$/.test(runtimeCommit ?? "");
  if (!args.includes("--target=production") || !(phase === "expand" && build || phase === "contract" && runtime)) {
    throw new Error("db:apply: REFUSED — control-plane migrations require the production main build or the loaded production runtime");
  }
  const connection = env.WTP_CONTROL_PLANE_DATABASE_URL;
  let url: URL;
  try { url = new URL(connection ?? ""); } catch { throw new Error("db:apply: REFUSED — production control-plane connection is unavailable"); }
  const endpoint = url.hostname.replace(/-pooler(?=\.)/, "");
  if (!["postgres:", "postgresql:"].includes(url.protocol) ||
      endpoint !== "ep-dark-night-aeo1ekz3.c-2.us-east-2.aws.neon.tech" || !url.username || !url.password || !url.pathname.slice(1)) {
    throw new Error("db:apply: REFUSED — control-plane migrations require the separate production control-plane endpoint");
  }
  return connection!;
}

async function withDatabase<T>(connection: string, operation: (sql: Sql) => Promise<T>): Promise<T> {
  if (!neonConfig.webSocketConstructor) neonConfig.webSocketConstructor = globalThis.WebSocket;
  const direct = new URL(connection);
  direct.hostname = direct.hostname.replace("-pooler.", ".");
  const pool = new Pool({ connectionString: direct.toString(), connectionTimeoutMillis: 15_000,
    statement_timeout: 900_000, query_timeout: 901_000 });
  try {
    const client = await pool.connect();
    try { return await operation({ query: async (text, params = []) => (await client.query(text, [...params])).rows }); }
    finally { client.release(true); }
  } finally { await pool.end(); }
}

export async function applyControlPlaneMigrations(args: string[], deps: Dependencies = {}): Promise<void> {
  const env = deps.env ?? process.env, root = deps.root ?? process.cwd();
  const connection = productionControlPlaneTarget(args, env);
  const phase = args.find(arg => arg.startsWith("--phase="))!.slice(8) as Entry["phase"];
  const dry = args.includes("--dry");
  if (phase === "contract") {
    const sha = (deps.head ?? (() => execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim()))();
    if (args.find(arg => arg.startsWith("--runtime-commit="))?.slice(17) !== sha)
      throw new Error("db:apply: REFUSED — control-plane contracts require the exact loaded commit");
  }
  const committed = deps.committed ?? (path => execFileSync("git", ["show", `HEAD:${path}`], { cwd: root, stdio: ["ignore", "pipe", "pipe"] }));
  for (const path of [JOURNAL, ...MIGRATIONS.flatMap(migration => [migration.source, ...migration.declarations])]) {
    if (!committed(path).equals(readFileSync(join(root, path)))) throw new Error(`db:apply: REFUSED — ${path} differs from its committed version`);
  }
  const journal = JSON.parse(readFileSync(join(root, JOURNAL), "utf8")) as { entries: Entry[] };
  if (journal.entries.length !== MIGRATIONS.length || journal.entries.some((row, at) => row.id !== MIGRATIONS[at].id || row.phase !== (MIGRATIONS[at].id.endsWith("_contract") ? "contract" : "expand"))) {
    throw new Error("db:apply: REFUSED — control-plane migration journal is invalid");
  }
  await (deps.withDatabase ?? withDatabase)(connection, async sql => {
    const present = await sql.query("SELECT to_regclass('cp_schema_version') AS schema, to_regclass('cp_migrations') AS journal") as { schema: string | null; journal: string | null }[];
    if (!present[0]?.schema) throw new Error("db:apply: REFUSED — target is not an existing control-plane database");
    const readApplied = async () => await sql.query("SELECT id, hash FROM cp_migrations") as { id: string; hash: string }[];
    const pendingOf = (rows: readonly { id: string; hash: string }[]) => {
      for (const row of rows) {
        const declared = journal.entries.find(candidate => candidate.id === row.id);
        if (declared && declared.hash !== row.hash) throw new Error(`db:apply: REFUSED — ${row.id} differs from the applied journal hash`);
      }
      const pending = journal.entries.filter(entry => !rows.some(row => row.id === entry.id));
      if (phase === "contract" && pending.some(entry => entry.phase === "expand"))
        throw new Error("db:apply: REFUSED — control-plane expand migrations must finish before cleanup");
      for (const entry of pending) {
        if (entry.hash !== controlPlaneMigrationHash(root, entry.id)) throw new Error(`db:apply: REFUSED — ${entry.id} definition differs from the committed journal hash`);
      }
      return pending.filter(entry => entry.phase === phase);
    };
    const waiting = pendingOf(present[0].journal ? await readApplied() : []);
    if (waiting.length === 0) {
      console.log(`control-plane: ${phase} already applied; writes=0`); return;
    }
    if (dry) { console.log(`control-plane: pending ${waiting.map(entry => entry.id).join(", ")}; DRY RUN; writes=0`); return; }
    if (phase === "contract") {
      const served = deps.servedCommit ?? (async () => {
        const { fetchServedCommit } = await import("./post-deploy-observer.mts");
        const { PUBLIC_SITE_ORIGIN } = await import("../lib/ops/origins.ts");
        return (await fetchServedCommit(PUBLIC_SITE_ORIGIN)).sha;
      });
      if (await served() !== args.find(arg => arg.startsWith("--runtime-commit="))?.slice(17))
        throw new Error("db:apply: REFUSED — control-plane contracts require the exact loaded commit to be serving");
    }
    await sql.query("SELECT pg_advisory_lock(1835360622,2)");
    try {
      await sql.query(CP_MIGRATIONS_DDL);
      for (const entry of pendingOf(await readApplied())) {
        const done = await MIGRATIONS.find(migration => migration.id === entry.id)!.apply(sql, env, deps.withDatabase ?? withDatabase);
        await sql.query("INSERT INTO cp_migrations(id,hash,completed_at) VALUES ($1,$2,now())", [entry.id, entry.hash]);
        console.log(`control-plane: ${entry.id} applied to ${new URL(connection).hostname} (${done})`);
      }
    } finally { await sql.query("SELECT pg_advisory_unlock(1835360622,2)"); }
  });
}
