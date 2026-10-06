import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { neonConfig } from "@neondatabase/serverless";
import { createPgRepositories } from "../lib/control-plane/repository/pg-store.ts";
import { boundedQuery } from "../lib/control-plane/repository/request-bounds.ts";
import {
  callerFromStack, countNeonBytes, flushNeonBytes, formatNeonBytesLine, hourStart, processNeonBytes, pruneNeonBytes,
  readNeonBytesHour, summarizeNeonBytes,
} from "../lib/db/transfer-by-caller.ts";

const callerBytes = (prefix: string) => processNeonBytes().flatMap(hour => Object.entries(hour.byCaller))
  .filter(([caller]) => caller.startsWith(prefix));

test("a real control-plane read counts its response bytes under the operation and the code that asked", async () => {
  const saved = { fetch: neonConfig.fetchFunction, env: { ...process.env } };
  Object.assign(process.env, {
    DATABASE_URL: "postgresql://local:local@ep-reader-bytes-test.us-east-2.aws.neon.tech/neondb",
    WTP_CONTROL_PLANE_DATABASE_URL: "postgresql://local:local@ep-cp-bytes-test.us-east-2.aws.neon.tech/neondb",
  });
  const response = JSON.stringify({ command: "SELECT", rowCount: 1, rowAsArray: true,
    fields: ["id", "revision", "updated_at", "value"].map(name => ({ name, dataTypeID: 25 })),
    rows: [["admin", "1", "2026-10-02T00:00:00.000Z", "{\"padding\":\"" + "x".repeat(5000) + "\"}"]] });
  neonConfig.fetchFunction = async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    if (body.queries) return new Response(JSON.stringify({ results: body.queries.map(() => ({ command: "INSERT", rowCount: 1, rowAsArray: true, fields: [], rows: [] })) }));
    return new Response(response);
  };
  try {
    const repos = await createPgRepositories(process.env.WTP_CONTROL_PLANE_DATABASE_URL!, undefined, { skipBootstrap: true });
    for (let i = 0; i < 2; i++) await repos.adminConfig.read("admin");
    const counted = callerBytes("cp_admin_config.");
    assert.equal(counted.length, 1, `one caller key, got ${JSON.stringify(counted)}`);
    const [caller, bytes] = counted[0]!;
    assert.match(caller, /^cp_admin_config\.\w+ ← tests\/neon-bytes-by-caller\.test\.ts:\d+$/);
    assert.equal(bytes, 2 * Buffer.byteLength(response));
  } finally {
    neonConfig.fetchFunction = saved.fetch;
    for (const key of Object.keys(process.env)) if (!(key in saved.env)) delete process.env[key];
    Object.assign(process.env, saved.env);
  }
});

test("bytes counted when a lazy query is awaited inside boundedQuery stay under its operation", async () => {
  // The Neon driver's query is a thenable that sends its request only when awaited.
  const lazy = { query: () => ({ then: (resolve: (rows: unknown[]) => void) => { countNeonBytes("control-plane", 700); resolve([]); } }) };
  await boundedQuery(lazy as never, { operation: "cp_lazy_probe.list", callClass: "PAGE" }, "select 1");
  assert.deepEqual(callerBytes("cp_lazy_probe."), [[callerBytes("cp_lazy_probe.")[0]![0], 700]]);
  assert.match(callerBytes("cp_lazy_probe.")[0]![0], / ← tests\/neon-bytes-by-caller\.test\.ts:\d+$/);
});

test("the caller is the first frame outside the database layers, repo-relative", () => {
  const stack = [
    "Error",
    "    at callSite (/srv/releases/abc/lib/db/transfer-by-caller.ts:80:9)",
    "    at boundedQuery (/srv/releases/abc/lib/control-plane/repository/request-bounds.ts:250:12)",
    "    at async Object.list (/srv/releases/abc/lib/control-plane/repository/pg-store.ts:400:5)",
    "    at async Promise.all (index 0)",
    "    at async runCycle (/srv/releases/abc/node_modules/x/lib/y.js:1:1)",
    "    at async publicationCycle (/srv/releases/abc/lib/control-plane/promotion/campaign-publication-cycle.ts:56:21)",
  ].join("\n");
  assert.equal(callerFromStack(stack), "lib/control-plane/promotion/campaign-publication-cycle.ts:56");
  assert.equal(callerFromStack("Error\n    at file:///srv/x/scripts/freshness-shadow.mts:3507:11"), "scripts/freshness-shadow.mts:3507");
  assert.equal(callerFromStack(undefined), "unknown");
});

test("each process writes its hour file, the parent sums the hour, and old hours are pruned", () => {
  const dir = mkdtempSync(join(tmpdir(), "neon-bytes-"));
  try {
    const now = Date.parse("2020-01-06T07:30:00Z");
    countNeonBytes("control-plane", 1_000, now);
    countNeonBytes("reader", 50, now);
    assert.equal(flushNeonBytes(dir, now), true);
    // A second process's file for the same hour (a research child), and a foreign half-written file.
    writeFileSync(join(dir, "2020-01-06T07--999999.json"), JSON.stringify({ hour: "2020-01-06T07:00:00.000Z", requests: 3,
      bytes: { reader: 0, "control-plane": 4_000 }, byCaller: { "cp_attempts.list ← lib/a.ts:1": 4_000 }, processes: ["freshness-shadow#999999"] }));
    writeFileSync(join(dir, "2020-01-06T07--1.json"), "{\"hour\":");
    writeFileSync(join(dir, "2020-01-03T01--1.json"), "{}");
    const hour = readNeonBytesHour(dir, hourStart(now));
    assert.equal(hour.bytes["control-plane"], 5_000);
    assert.equal(hour.bytes.reader, 50);
    assert.equal(hour.processes.length, 2);
    const summary = summarizeNeonBytes(hour, 1);
    assert.deepEqual(summary.byCaller[0], { caller: "cp_attempts.list ← lib/a.ts:1", bytes: 4_000 });
    assert.equal(summary.byCaller.at(-1)!.caller, "other");
    assert.equal(summary.byCaller.at(-1)!.bytes, 1_050);
    assert.match(formatNeonBytesLine(summary, "last full hour"), /control plane 0\.0 MB, reader 0\.0 MB; largest: 0\.0 MB cp_attempts\.list/);
    // The finished hour is forgotten once written; the next flush writes nothing new for it.
    assert.equal(processNeonBytes().some(h => h.hour === "2020-01-06T07:00:00.000Z"), true);
    flushNeonBytes(dir, Date.parse("2020-01-06T08:01:00Z"));
    assert.equal(processNeonBytes().some(h => h.hour === "2020-01-06T07:00:00.000Z"), false);
    pruneNeonBytes(dir, Date.parse("2020-01-06T08:01:00Z"));
    assert.equal(readdirSync(dir).some(name => name.startsWith("2020-01-03")), false);
    assert.equal(readdirSync(dir).filter(name => name.startsWith("2020-01-06T07")).length, 3);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
