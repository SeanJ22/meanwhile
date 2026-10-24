/** Built meeting responses against production, sequentially, before and after an idle server.
 * NODE_USE_ENV_PROXY=1 node --env-file=/tmp/rs03-production.env --experimental-strip-types
 *   --import ./scripts/register-test-loader.mjs scripts/rs-03-check.mts
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { neon } from "@neondatabase/serverless";
import { readZipLocation } from "../lib/place-map/locations.ts";
import { readerMeetingsPath, warmAfterDeploy } from "../lib/ops/post-deploy-warm.ts";

const connection = process.env.WTP_PRODUCTION_DATABASE_URL_READONLY;
if (!connection) throw new Error("The existing production readonly connection is required");
const target = new URL(connection);
assert.equal(target.username, "readonly");
assert.ok(target.hostname.replace(/-pooler(?=\.)/, "").startsWith("ep-dry-river-axwtolzc."));
const sql = neon(connection);
const [[identity]] = await sql.transaction([sql.query(`SELECT current_user AS role, current_setting('transaction_read_only') AS read_only,
 EXISTS(SELECT 1 FROM pg_tables WHERE schemaname='public' AND has_table_privilege(current_user,quote_ident(schemaname)||'.'||quote_ident(tablename),'INSERT,UPDATE,DELETE')) AS can_write`, [])], { readOnly: true });
assert.equal(identity.role, "readonly");
assert.equal(identity.read_only, "on");
assert.equal(identity.can_write, false);
const output = resolve(process.argv.find(arg => arg.startsWith("--out="))?.slice(6) ?? ".scratch/rs03");
await mkdir(output, { recursive: true });
const buildId = (await readFile(".next/BUILD_ID", "utf8")).trim();
const zips = ["85701", "03301", "07960", "77002", "10001"];
const places = await Promise.all(zips.map(async zip => { const point=await readZipLocation(zip);assert.ok(point,zip);return point; }));
const rows: Record<string, unknown>[] = [];
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", "3303", "-H", "127.0.0.1"], {
  env: { ...process.env, DATABASE_URL: connection, WTP_DB_ROLE: "production", WTP_VITAL_SIGNS_REPORT: "1", NODE_ENV: "production" },
  stdio: ["ignore", "pipe", "pipe"],
});
let log = "";
child.stdout.on("data", data => { log += data; });
child.stderr.on("data", data => { log += data; });
const origin = "http://127.0.0.1:3303";
const save = () => writeFile(`${output}/meetings.json`, JSON.stringify({ buildId, productionReadonly: identity, idleMs: 360_000, rows }, null, 2) + "\n");
try {
  await new Promise<void>((ready, fail) => {
    const timer = setTimeout(() => fail(new Error("Server startup timed out")), 20_000);
    child.stdout.on("data", () => { if (log.includes("Ready in")) { clearTimeout(timer); ready(); } });
    child.once("exit", code => { clearTimeout(timer); fail(new Error(`Server exited before readiness (${code})`)); });
  });
  const read = async (point: typeof places[number], phase: string) => {
    const path = readerMeetingsPath(point), started = performance.now();
    const response = await fetch(`${origin}${path}`, { headers: { "x-wtp-synthetic-run": "rs-03-check" }, signal: AbortSignal.timeout(15_000) });
    const body = await response.json();
    const row = { zip: point.zip, phase, path, at: new Date().toISOString(), ms: performance.now() - started,
      status: response.status, nearZip: body.nearZip, meetings: body.meetings?.length,
      coverageBodies: body.coverage?.bodies?.length, serverTiming: response.headers.get("server-timing") };
    rows.push(row); console.log(JSON.stringify(row)); await save();
    assert.equal(response.status, 200); assert.equal(body.nearZip, point.zip); assert.ok(Array.isArray(body.meetings));
  };
  for (const point of places) await read(point, "first");
  for (const point of places) await read(point, "repeat");
  const idleStarted = Date.now();
  console.log(JSON.stringify({ idleStarted: new Date(idleStarted).toISOString(), requestsDuringIdle: 0 }));
  await new Promise(ready => setTimeout(ready, 360_000));
  for (const point of places) await read(point, "after-idle");
  const response = await fetch(`${origin}/api/reader/places`);
  const manifest = await response.json();
  assert.equal(response.status, 200); assert.ok(manifest.places.length > 0);
  await writeFile(`${output}/places.json`, JSON.stringify(manifest, null, 2) + "\n");
  const build = await (await fetch(`${origin}/api/build`)).json();
  const fill = await warmAfterDeploy({ commit: build.commit, deployId: "rs03-built-check" }, {
    origin, places: async () => places,
  });
  assert.equal(fill.outcome, "WARMED");
  if (fill.outcome === "WARMED") {
    assert.ok(fill.fills.every(row => row.status === 200));
    assert.ok(fill.rereads.every(row => row.status === 200));
  }
  await writeFile(`${output}/release-fill.json`, JSON.stringify(fill, null, 2) + "\n");
  assert.equal((await fetch(`${origin}/api/warm`)).status, 404);
} finally {
  if (child.exitCode === null && child.signalCode === null) {
    const stopped = once(child, "close"); child.kill("SIGTERM");
    const timer = setTimeout(() => child.kill("SIGKILL"), 2_000);
    await stopped; clearTimeout(timer);
  }
  await writeFile(`${output}/server.log`, log.split(connection).join("[production readonly connection]"));
}
