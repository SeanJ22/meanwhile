import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool, neonConfig } from "@neondatabase/serverless";
import type { Sql } from "../lib/control-plane/repository/pg-store.ts";
import { CP_MIGRATIONS_DDL } from "../lib/control-plane/repository/pg-schema.ts";
import { CP01_DECLARATION_SOURCES, controlReadsMigrationDefinition, expandControlReads } from "../lib/control-plane/repository/migrations/CP-01.ts";
import { debtStateMigrationDefinition, stampDebtStates } from "../lib/control-plane/repository/migrations/DT-01.ts";

const JOURNAL = "lib/control-plane/repository/migrations/meta/_journal.json";
const MIGRATIONS = [
  { id: "CP-01_expand", source: "lib/control-plane/repository/migrations/CP-01.ts", declarations: CP01_DECLARATION_SOURCES,
    definition: controlReadsMigrationDefinition, apply: async (sql: Sql) => { await expandControlReads(sql); return "control reads"; } },
  { id: "DT-01_expand", source: "lib/control-plane/repository/migrations/DT-01.ts", declarations: [] as readonly string[],
    definition: debtStateMigrationDefinition, apply: async (sql: Sql) => `${await stampDebtStates(sql)} debt(s) given their state` },
] as const;
interface Entry { readonly id: string; readonly phase: "expand"; readonly hash: string }
interface Dependencies {
  readonly root?: string;
  readonly env?: NodeJS.ProcessEnv;
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
  if (!args.includes("--target=production") || !(phase === "expand" && build)) {
    throw new Error("db:apply: REFUSED — control-plane migrations require the production main build");
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
  const committed = deps.committed ?? (path => execFileSync("git", ["show", `HEAD:${path}`], { cwd: root, stdio: ["ignore", "pipe", "pipe"] }));
  for (const path of [JOURNAL, ...MIGRATIONS.flatMap(migration => [migration.source, ...migration.declarations])]) {
    if (!committed(path).equals(readFileSync(join(root, path)))) throw new Error(`db:apply: REFUSED — ${path} differs from its committed version`);
  }
  const journal = JSON.parse(readFileSync(join(root, JOURNAL), "utf8")) as { entries: Entry[] };
  if (journal.entries.length !== MIGRATIONS.length || journal.entries.some((row, at) => row.id !== MIGRATIONS[at].id || row.phase !== phase)) {
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
      for (const entry of pending) {
        if (entry.hash !== controlPlaneMigrationHash(root, entry.id)) throw new Error(`db:apply: REFUSED — ${entry.id} definition differs from the committed journal hash`);
      }
      return pending;
    };
    const waiting = pendingOf(present[0].journal ? await readApplied() : []);
    if (waiting.length === 0) {
      console.log(`control-plane: ${journal.entries.map(entry => entry.id).join(", ")} already applied; writes=0`); return;
    }
    if (dry) { console.log(`control-plane: pending ${waiting.map(entry => entry.id).join(", ")}; DRY RUN; writes=0`); return; }
    await sql.query("SELECT pg_advisory_lock(1835360622,2)");
    try {
      await sql.query(CP_MIGRATIONS_DDL);
      for (const entry of pendingOf(await readApplied())) {
        const done = await MIGRATIONS.find(migration => migration.id === entry.id)!.apply(sql);
        await sql.query("INSERT INTO cp_migrations(id,hash,completed_at) VALUES ($1,$2,now())", [entry.id, entry.hash]);
        console.log(`control-plane: ${entry.id} applied to ${new URL(connection).hostname} (${done})`);
      }
    } finally { await sql.query("SELECT pg_advisory_unlock(1835360622,2)"); }
  });
}
