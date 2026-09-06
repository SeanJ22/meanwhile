import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, relative } from "node:path";
import test from "node:test";
import ts from "typescript";
import { neon, neonConfig, SqlTemplate, type NeonQueryPromise } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { sql } from "drizzle-orm";
import { createGuardedNeon, guardNeonClient } from "../lib/db/guarded-neon.ts";
import { describeWriteContext, ProductionWriteRefused, type WriteEnvironment } from "../lib/db/write-guard.ts";
import { databaseDestinationHints, evaluateDatabaseDestination, sameEndpointIdentity } from "../lib/ops/staging-isolation.ts";

const PRODUCTION = "postgres://owner:planted-secret@ep-live-123.example/neondb";
const STAGING = "postgres://owner:planted-secret@ep-stage-456.example/neondb";
const env = (context: string): WriteEnvironment => ({
  NODE_ENV: "production",
  WTP_BUILD_CONTEXT: context,
  WTP_BUILD_PRODUCTION_DATABASE_HOST: "ep-live-123.example",
  WTP_BUILD_STAGING_DATABASE_HOST: "ep-stage-456.example",
  WTP_BUILD_PRODUCTION_CONTROL_PLANE_HOST: "ep-live-123.example",
  WTP_BUILD_STAGING_CONTROL_PLANE_HOST: "ep-stage-456.example",
});

type Query = NeonQueryPromise<boolean, boolean>;
const queryText = (q: Query) => q.queryData instanceof SqlTemplate
  ? q.queryData.toParameterizedQuery().query : q.queryData.query;

function fixture(connection: string, environment: () => WriteEnvironment, databaseRefusesWrite = false) {
  const calls: { queries: string[]; readOnly: boolean }[] = [];
  const client = neon(connection);
  const originalQuery = client.query;
  client.query = ((...args: Parameters<typeof originalQuery>) => {
    const query = originalQuery(...args);
    query.execute = async () => {
      calls.push({ queries: [queryText(query)], readOnly: false });
      return [];
    };
    return query;
  }) as typeof client.query;
  client.transaction = (async (queries: Query[], options: { readOnly?: boolean } = {}) => {
    calls.push({ queries: queries.map(queryText), readOnly: options.readOnly === true });
    if (databaseRefusesWrite && options.readOnly) throw Object.assign(new Error("database refused write"), { code: "25006" });
    return queries.map(() => []);
  }) as typeof client.transaction;
  return { guarded: guardNeonClient(client, connection, { environment }), calls };
}

test("SISO-3 shared SQL: branch production writes cannot dispatch through query, tagged SQL or batch", async () => {
  const { guarded, calls } = fixture(PRODUCTION, () => env("branch-deploy"));
  await assert.rejects(async () => guarded.query("INSERT INTO search_log DEFAULT VALUES"), ProductionWriteRefused);
  await assert.rejects(async () => guarded`DELETE FROM search_log`, ProductionWriteRefused);
  await assert.rejects(async () => guarded.transaction([guarded.query("UPDATE search_log SET zip = '00000'")]), ProductionWriteRefused);
  await assert.rejects(async () => guarded.transaction((tx) => [tx.query("TRUNCATE search_log")]), ProductionWriteRefused);
  assert.equal(calls.length, 0, "forbidden writes reached the driver");
});

test("SISO-3 shared SQL: raw Drizzle execute cannot bypass the guard", async () => {
  const { guarded, calls } = fixture(PRODUCTION, () => env("branch-deploy"));
  const db = drizzle(guarded);
  await assert.rejects(async () => db.execute(sql`DELETE FROM search_log`), (error: unknown) => {
    assert.ok(error && typeof error === "object" && "cause" in error);
    assert.ok(error.cause instanceof ProductionWriteRefused);
    return true;
  });
  assert.equal(calls.length, 0);
});

test("SISO-3 shared SQL: correct staging/production pairings dispatch writes", async () => {
  for (const [context, connection] of [["production", PRODUCTION], ["branch-deploy", STAGING]]) {
    const { guarded, calls } = fixture(connection, () => env(context));
    await guarded.query("INSERT INTO search_log DEFAULT VALUES");
    await guarded.transaction([guarded.query("DELETE FROM search_log")]);
    assert.equal(calls.length, 2);
    assert.equal(calls.every((call) => !call.readOnly), true);
  }
});

test("SISO-3 shared SQL: pinned connection and fresh context prevent cache/env laundering", async () => {
  let environment = { ...env("branch-deploy"), DATABASE_URL: STAGING };
  const { guarded, calls } = fixture(PRODUCTION, () => environment);
  const pending = guarded.query("DELETE FROM search_log");
  environment = { ...env(""), DATABASE_URL: STAGING };
  await assert.rejects(async () => pending, ProductionWriteRefused);
  assert.equal(calls.length, 0);
});

test("SISO-3 shared SQL: denied writers retain reads only inside forced READ ONLY", async () => {
  const { guarded, calls } = fixture(PRODUCTION, () => env("branch-deploy"));
  await guarded.query("SELECT count(*) FROM search_log");
  await guarded`SELECT count(*) FROM search_log`;
  await guarded.transaction([guarded.query("SELECT 1")], { readOnly: false });
  assert.equal(calls.length, 3);
  assert.equal(calls.every((call) => call.readOnly), true, "caller overrode database enforcement");
  await assert.rejects(async () => guarded.query("SELECT 1; SET TRANSACTION READ WRITE; DELETE FROM search_log"), ProductionWriteRefused);
  assert.equal(calls.length, 3);
});

test("SISO-3 shared SQL: CTE and SELECT-function mutations receive database refusal as named guard error", async () => {
  const { guarded, calls } = fixture(PRODUCTION, () => env("branch-deploy"), true);
  for (const statement of [
    "WITH changed AS (DELETE FROM search_log RETURNING *) SELECT * FROM changed",
    "SELECT a_function_that_mutates()",
  ]) await assert.rejects(async () => guarded.query(statement), ProductionWriteRefused);
  assert.equal(calls.length, 2);
  assert.equal(calls.every((call) => call.readOnly), true);
});

test("SISO-3 shared SQL: control-plane uses the same boundary and its actual destination", async () => {
  const { guarded: base } = fixture(PRODUCTION, () => env("production"));
  const cp = guardNeonClient(base, PRODUCTION, {
    destination: "control-plane", environment: () => ({ ...env("branch-deploy"), DATABASE_URL: STAGING }),
  });
  await assert.rejects(async () => cp.query("INSERT INTO cp_work_items DEFAULT VALUES"), ProductionWriteRefused);
});

test("PLANTED shared SQL: HTTP options cannot replace the body, destination or read-only header", async () => {
  const previousFetch = neonConfig.fetchFunction;
  const requests: RequestInit[] = [];
  neonConfig.fetchFunction = async (_input: unknown, init: RequestInit) => {
    requests.push(init);
    const body = JSON.parse(String(init.body));
    const result = { fields: [], rows: [], rowCount: 0, command: "SELECT" };
    return new Response(JSON.stringify(body.queries ? { results: body.queries.map(() => result) } : result), {
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    for (const connection of [PRODUCTION, STAGING]) {
      const guarded = createGuardedNeon(connection, { environment: () => env("branch-deploy") });
      const transportOverride = {
        fetchOptions: {
          headers: { "Neon-Batch-Read-Only": "false", "Neon-Connection-String": PRODUCTION },
          body: JSON.stringify({ query: "DELETE FROM search_log", params: [] }),
        },
      };
      await assert.rejects(async () => guarded.query("SELECT 1", [], transportOverride), ProductionWriteRefused);
      await assert.rejects(async () => guarded.transaction([guarded.query("SELECT 1")], transportOverride), ProductionWriteRefused);
      await assert.rejects(async () => guarded.transaction([guarded.query("SELECT 1", [], transportOverride)]), ProductionWriteRefused);
      const query = guarded.query("SELECT 1");
      await assert.rejects(async () => query.execute(query.queryData, transportOverride), ProductionWriteRefused);
    }
    assert.equal(requests.length, 0, "a transport override reached the real driver's fetch seam");
    const denied = createGuardedNeon(PRODUCTION, { environment: () => env("branch-deploy") });
    await denied.query("SELECT 1");
    assert.equal(requests.length, 1, "the positive read control did not exercise the real transport");
    assert.equal((requests[0].headers as Record<string, string>)["Neon-Batch-Read-Only"], "true");
    assert.deepEqual(JSON.parse(String(requests[0].body)), { queries: [{ query: "SELECT 1", params: [] }] });
  } finally {
    neonConfig.fetchFunction = previousFetch;
  }
});

test("PLANTED shared SQL: exposed query data and execute still use the guarded dispatch", async () => {
  const { guarded, calls } = fixture(PRODUCTION, () => env("branch-deploy"));
  const query = guarded.query("SELECT 1");
  const mutation = { query: "DELETE FROM search_log", params: [] };
  await assert.rejects(async () => query.execute(mutation), ProductionWriteRefused);
  query.queryData = mutation;
  await assert.rejects(async () => query, ProductionWriteRefused);
  assert.equal(calls.length, 0);
});

test("SISO-3 endpoint aliases: pooled/direct Neon spelling cannot hide a production collision", () => {
  assert.equal(sameEndpointIdentity(PRODUCTION, PRODUCTION.replace("ep-live-123.", "ep-live-123-pooler.")), true);
  assert.equal(sameEndpointIdentity(PRODUCTION, "postgres://readonly:pw@pool.example/neondb?options=endpoint%3Dep-live-123"), true);
});

test("SISO-3 driver construction never exposes a malformed connection credential", () => {
  assert.throws(() => createGuardedNeon("postgres://owner:CONSTRUCTION_SENTINEL@[/db"), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.doesNotMatch(error.message + JSON.stringify(error), /CONSTRUCTION_SENTINEL|postgres:/);
    assert.equal(error.cause, undefined);
    return true;
  });
});

test("SISO-3 Next runtime binds only sanitized hosts and statically reads the build context", () => {
  const hosts = [
    "WTP_BUILD_PRODUCTION_DATABASE_HOST", "WTP_BUILD_STAGING_DATABASE_HOST",
    "WTP_BUILD_PRODUCTION_CONTROL_PLANE_HOST", "WTP_BUILD_STAGING_CONTROL_PLANE_HOST",
  ];
  const processResult = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e",
    'const {default: config} = await import("./next.config.ts"); console.log(JSON.stringify(config.env));',
  ], {
    encoding: "utf8",
    env: {
      ...process.env,
      CONTEXT: "branch-deploy",
      [hosts[0]]: "ep-live-123.example",
      [hosts[1]]: "postgres://owner:BUILD_SECRET_SENTINEL@ep-stage-456.example/neondb",
      [hosts[2]]: "postgres://owner:BUILD_SECRET_SENTINEL@[/invalid",
      [hosts[3]]: "https://ep-control-stage-456.example/neondb",
    },
  });
  assert.equal(processResult.status, 0, processResult.stderr);
  assert.doesNotMatch(processResult.stdout + processResult.stderr, /BUILD_SECRET_SENTINEL/);
  const built = JSON.parse(processResult.stdout);
  assert.equal(built.WTP_BUILD_CONTEXT, "branch-deploy");
  assert.deepEqual(hosts.map((name) => built[name]), ["ep-live-123", "ep-stage-456", "", ""]);
  const runtime = readFileSync("lib/db/write-guard.ts", "utf8");
  for (const name of ["WTP_BUILD_CONTEXT", ...hosts]) {
    assert.ok(runtime.includes(`process.env.${name}`), `${name} lost the literal read Next needs to inline it`);
  }
  const legacy = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e",
    'const {default: config} = await import("./next.config.ts"); console.log(JSON.stringify(config.env));',
  ], {
    encoding: "utf8",
    env: {
      ...process.env,
      ...Object.fromEntries(hosts.map((name) => [name, ""])),
      WTP_PRODUCTION_DATABASE_URL_READONLY: "postgres://readonly:BUILD_SECRET_SENTINEL@ep-live-123.example/neondb",
      WTP_STAGING_DATABASE_URL_READONLY: "postgres://readonly:BUILD_SECRET_SENTINEL@ep-stage-456.example/neondb",
      WTP_PRODUCTION_CONTROL_PLANE_DATABASE_URL_READONLY: "postgres://readonly:BUILD_SECRET_SENTINEL@ep-control-live-123.example/neondb",
      WTP_STAGING_CONTROL_PLANE_DATABASE_URL_READONLY: "postgres://readonly:BUILD_SECRET_SENTINEL@ep-control-stage-456.example/neondb",
    },
  });
  assert.equal(legacy.status, 0, legacy.stderr);
  assert.doesNotMatch(legacy.stdout + legacy.stderr, /BUILD_SECRET_SENTINEL/);
  const fallbackBindings = JSON.parse(legacy.stdout);
  assert.deepEqual(hosts.map((name) => fallbackBindings[name]), [
    "ep-live-123", "ep-stage-456", "ep-control-live-123", "ep-control-stage-456",
  ], "build and runtime must resolve the same legacy anchors");
  const pooledEnvironment = {
    ...process.env,
    CONTEXT: "branch-deploy",
    ...Object.fromEntries(hosts.map((name) => [name, ""])),
    WTP_PRODUCTION_DATABASE_URL_READONLY: "postgres://readonly:BUILD_SECRET_SENTINEL@pool.example/neondb?options=endpoint%3Dep-live-123",
    WTP_STAGING_DATABASE_URL_READONLY: "postgres://readonly:BUILD_SECRET_SENTINEL@pool.example/neondb?options=endpoint%3Dep-stage-456",
    WTP_PRODUCTION_CONTROL_PLANE_DATABASE_URL_READONLY: "postgres://readonly:BUILD_SECRET_SENTINEL@pool.example/neondb?options=endpoint%3Dep-control-live-123",
    WTP_STAGING_CONTROL_PLANE_DATABASE_URL_READONLY: "postgres://readonly:BUILD_SECRET_SENTINEL@pool.example/neondb?options=endpoint%3Dep-control-stage-456",
  };
  const pooled = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e",
    'const {default: config} = await import("./next.config.ts"); console.log(JSON.stringify(config.env));',
  ], { encoding: "utf8", env: pooledEnvironment });
  assert.equal(pooled.status, 0, pooled.stderr);
  assert.doesNotMatch(pooled.stdout + pooled.stderr, /BUILD_SECRET_SENTINEL/);
  const pooledBindings = JSON.parse(pooled.stdout);
  assert.deepEqual(hosts.map((name) => pooledBindings[name]), hosts.map((name) => fallbackBindings[name]));
  for (const destination of ["application", "control-plane"] as const) {
    const url = destination === "application"
      ? pooledEnvironment.WTP_STAGING_DATABASE_URL_READONLY
      : pooledEnvironment.WTP_STAGING_CONTROL_PLANE_DATABASE_URL_READONLY;
    assert.equal(evaluateDatabaseDestination({
      context: "branch-deploy", databaseUrl: url, ...databaseDestinationHints(pooledEnvironment, destination),
    }).ok, true);
    assert.equal(describeWriteContext({
      NODE_ENV: "production", ...pooledBindings,
      [destination === "application" ? "DATABASE_URL" : "WTP_CONTROL_PLANE_DATABASE_URL"]: url,
    }, "a database mutation", destination).allowed, true, "runtime lost the pooled endpoint proof passed by the build");
  }
});

function driverImports(source: string, filename: string): string[] {
  const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  function inspect(node: ts.Node) {
    if (ts.isImportDeclaration(node) && node.importClause?.isTypeOnly) return;
    if (ts.isImportDeclaration(node) && node.importClause?.namedBindings &&
      ts.isNamedImports(node.importClause.namedBindings) && !node.importClause.name &&
      node.importClause.namedBindings.elements.every((item) =>
        item.isTypeOnly || (item.propertyName ?? item.name).text === "neonConfig")) return;
    const specifier = ts.isImportDeclaration(node) || ts.isExportDeclaration(node) ? node.moduleSpecifier
      : ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === "require")
        ? node.arguments[0] : undefined;
    if (specifier && ts.isStringLiteralLike(specifier) && /^(?:@neondatabase\/serverless|pg|postgres|postgresjs)(?:\/|$)/.test(specifier.text)) {
      found.push(specifier.text);
    }
    ts.forEachChild(node, inspect);
  }
  inspect(file);
  return found;
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : /\.[cm]?[jt]sx?$/.test(path) ? [path] : [];
  });
}

test("SISO-3 structural boundary: app/lib can construct database drivers only through guarded-neon", () => {
  const files = [...sourceFiles("app"), ...sourceFiles("lib")];
  assert.ok(files.length > 100, "the structural check did not inspect the runtime source universe");
  const bypasses = files.filter((file) => relative(".", file).replace(/\\/g, "/") !== "lib/db/guarded-neon.ts")
    .filter((file) => driverImports(readFileSync(file, "utf8"), file).length > 0);
  assert.deepEqual(bypasses, [], "a runtime module gained a database driver outside the shared boundary");
  assert.match(readFileSync("lib/db/index.ts", "utf8"), /drizzle\(createGuardedNeon\(/);
  assert.match(readFileSync("lib/control-plane/repository/pg-store.ts", "utf8"), /createGuardedNeon\(connectionString,\s*\{ destination: "control-plane" \}\)/);
});

test("PLANTED structural bypass: direct import, re-export, dynamic import and require are detected", () => {
  for (const source of [
    'import { neon } from "@neondatabase/serverless";',
    'export { neon } from "@neondatabase/serverless";',
    'const driver = await import("@neondatabase/serverless");',
    ['const driver = require', '("pg");'].join(""),
  ]) assert.equal(driverImports(source, "planted.ts").length, 1);
});
