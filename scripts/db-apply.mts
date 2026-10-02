/** The build and runner share the migration command and existing Admin history. */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { neon } from "@neondatabase/serverless";
import { config as loadEnv } from "dotenv";
import { OWNER_SURFACE_FORMAT_VERSION, type OwnerDigestRecord } from "../lib/control-plane/owner-surface.ts";
import { pgAppendOnlyRepository } from "../lib/control-plane/repository/pg-store.ts";
import { PRODUCTION_MIGRATION_HEADLINE, redactMigrationOutput, type ProductionMigrationOutcome } from "../lib/db/migration-phases.ts";
import { PUBLIC_SITE_ORIGIN } from "../lib/ops/origins.ts";
import { fetchServedCommit } from "./post-deploy-observer.mts";

type MigrationRecord = OwnerDigestRecord & { readonly migration: ProductionMigrationOutcome };
interface ApplyDeps {
  readonly execute?: (args: readonly string[], env: NodeJS.ProcessEnv) => { status: number | null; stdout: string; stderr: string };
  readonly head?: () => string | null;
  readonly served?: () => Promise<string | null>;
  readonly record?: (record: MigrationRecord) => Promise<void>;
}

export function productionBuildCanApply(env: Record<string, string | undefined>): boolean {
  return env.NETLIFY === "true" && env.CONTEXT === "production" && env.BRANCH === "main";
}

export async function runDbApply(args: string[], env = process.env, deps: ApplyDeps = {}): Promise<number> {
  if (args.includes("--production-build") && !productionBuildCanApply(env)) {
    console.log("db:apply: production expand skipped outside the Netlify production main build; writes=0");
    return 0;
  }
  loadEnv({ path: ".env.local", processEnv: env, quiet: true });
  const production = args.includes("--target=production");
  const dry = args.includes("--dry");
  const phase = args.find(a => a.startsWith("--phase="))?.slice(8) ?? "all";
  const head = deps.head ?? (() => spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", windowsHide: true }).stdout?.trim() ?? null);
  const sha = head();
  const testedSha = /^[0-9a-f]{40}$/.test(sha ?? "") ? sha : null;
  let result: { status: number | null; stdout: string; stderr: string };
  const expected = args.find(arg => arg.startsWith("--runtime-commit="))?.slice(17);
  if (args.includes("--production-runtime") && (!production || phase !== "contract" ||
      env.WTP_RUNTIME_MODE !== "production" || testedSha === null || expected !== testedSha ||
      (!dry && await (deps.served ?? (async () => (await fetchServedCommit(PUBLIC_SITE_ORIGIN)).sha))() !== testedSha))) {
    result = { status: 1, stdout: "", stderr: "db:apply: REFUSED — contract migrations require the exact production commit to be serving and loaded\n" };
  } else {
    const execute = deps.execute ?? ((childArgs, childEnv) => {
      const child = spawnSync(process.execPath, ["--experimental-strip-types", "scripts/apply-migrations.mts", ...childArgs], {
        cwd: process.cwd(), env: childEnv, encoding: "utf8", windowsHide: true, maxBuffer: 16 * 1024 * 1024,
      });
      return { status: child.status, stdout: child.stdout ?? "", stderr: child.stderr ?? child.error?.name ?? "" };
    });
    try { result = execute(args, env); }
    catch { result = { status: 1, stdout: "", stderr: "db:apply: migration command failed to launch\n" }; }
  }
  const stdout = redactMigrationOutput(result.stdout, env);
  const stderr = redactMigrationOutput(result.stderr, env);
  process.stdout.write(stdout);
  process.stderr.write(stderr);
  const status = result.status ?? 1;
  if (!production || dry) return status;
  const lines = `${stdout}\n${stderr}`.split(/\r?\n/).filter(Boolean);
  const state = status === 0 ? "SUCCEEDED" : lines.some(line => /REFUSED/.test(line)) ? "REFUSED" : "FAILED";
  const at = new Date().toISOString();
  const digestId = `db-migration:${phase}:${createHash("sha256").update(`${testedSha}:${at}`).digest("hex")}`;
  const record: MigrationRecord = { formatVersion: OWNER_SURFACE_FORMAT_VERSION, digestId,
    writtenAt: at, headline: PRODUCTION_MIGRATION_HEADLINE, lines: lines.slice(-12).map(line => line.slice(0, 400)),
    cycleOk: status === 0, testedSha, migration: { phase, state, targetHost: "ep-dry-river-axwtolzc",
      summary: lines.slice(-5).join("\n").slice(-2000) } };
  try {
    const save = deps.record ?? (async value => {
      const connection = env.WTP_CONTROL_PLANE_DATABASE_URL;
      if (!connection) throw new Error("CONTROL_PLANE_UNAVAILABLE");
      const sql = neon(connection);
      const history = pgAppendOnlyRepository<MigrationRecord>({
        query: (text, params, options) => sql.query(text, [...(params ?? [])], options),
      }, "owner_digests");
      await history.append("owner-digest", value.digestId, value, value.writtenAt);
    });
    await save(record);
    console.log(`db:apply: ${state} recorded in Admin's existing change history`);
  } catch (error) {
    console.error(`db:apply: Admin outcome could not be recorded (${error instanceof Error ? error.name : "error"}); release held`);
    return 1;
  }
  return status;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runDbApply(process.argv.slice(2));
}
