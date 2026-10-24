/** Read production with the named read-only role; all writes and worker probes stay on local PostgreSQL. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { Pool } from "pg";
import { workList, type WorkInput } from "../lib/core/work.ts";
import { workCounts } from "../lib/core/work-counts.ts";
import { CONTROL_READS_BACKFILL_DDL } from "../lib/control-plane/repository/control-reads-backfill.ts";
import { REGISTRY_STATES } from "../lib/civic-data/state-scopes.ts";

const pool = new Pool({ host: "/tmp", port: 55435, database: "postgres", user: "agent", max: 200 });
const query = async (text: string, params: readonly unknown[] = []) => (await pool.query(text, [...params])).rows;
const mode = process.argv[2];
try {
  if (mode === "snapshot") {
    const url = (await readFile("/tmp/rb-a5-cp-readonly-url", "utf8")).trim();
    assert.equal(new URL(url).username, "wtp_cp_release_readonly");
    assert.match(new URL(url).hostname, /^ep-dark-night-aeo1ekz3(?:-pooler)?\./);
    const remote = async (text: string, params: unknown[] = []) => {
      assert.match(text, /^SELECT /);
      const response = await fetch(`https://${new URL(url).hostname.replace("-pooler.", ".")}/sql`, {
        method: "POST", headers: { "Neon-Connection-String": url, "Content-Type": "application/json" },
        body: JSON.stringify({ query: text, params }),
      });
      if (!response.ok) throw new Error(`Read-only snapshot answered ${response.status}`);
      const result = await response.json() as { rows: Record<string, unknown>[] };
      return result.rows;
    };
    const startedAt = new Date().toISOString();
    const [before] = await remote("SELECT current_user, count(*)::int AS n FROM cp_box_findings");
    assert.equal(before!.current_user, "wtp_cp_release_readonly");
    await query("CREATE TABLE IF NOT EXISTS rb_a5_box_copy(id text PRIMARY KEY, value jsonb NOT NULL)");
    let cursor = "", total = 0;
    const hash = createHash("sha256");
    for (;;) {
      const rows = await remote("SELECT id, value FROM cp_box_findings WHERE id > $1 ORDER BY id LIMIT 2000", [cursor]);
      if (!rows.length) break;
      const body = JSON.stringify(rows);
      hash.update(body);
      await query(`INSERT INTO rb_a5_box_copy SELECT * FROM jsonb_to_recordset($1::jsonb) AS rows(id text,value jsonb)
        ON CONFLICT(id) DO UPDATE SET value=EXCLUDED.value`, [body]);
      cursor = String(rows.at(-1)!.id); total += rows.length;
      if (total % 20_000 === 0) console.log(`Copied ${total} Box rows`);
    }
    const [after] = await remote("SELECT count(*)::int AS n FROM cp_box_findings");
    const report = { sourceProject: "withered-sunset-39821877", sourceBranch: "br-tiny-frog-aeufpjeq", role: before!.current_user,
      startedAt, endedAt: new Date().toISOString(), rowsBefore: before!.n, rowsAfter: after!.n, copied: total, sha256: hash.digest("hex") };
    await writeFile(".scratch/rb-a5/snapshot.json", JSON.stringify(report, null, 2));
    console.log(report);
  } else if (mode === "seed") {
    const list = workList(query, { owner: "production-copy-loader" });
    let cursor = "", total = 0;
    for (;;) {
      const rows = await query("SELECT id, value FROM rb_a5_box_copy WHERE id > $1 ORDER BY id LIMIT 1000", [cursor]);
      if (!rows.length) break;
      for (let offset = 0; offset < rows.length; offset += 20) await Promise.all(rows.slice(offset, offset + 20).map(async row => {
        const value = row.value as { subjectId: string; sourceUrl: string | null; exactQuote: string | null; fact?: { field: string; value: unknown }; origins: unknown[] };
        const isLink = typeof value.fact?.value === "string" && /^https?:\/\//i.test(value.fact.value);
        const input: WorkInput = { kind: isLink ? "read" : "check", placeId: value.subjectId.split("#")[0]!, subjectId: value.subjectId,
          url: isLink ? String(value.fact!.value) : value.sourceUrl,
          ...(isLink ? {} : { field: value.fact?.field ?? "unclassified", claimKey: String(row.id) }),
          value: isLink ? null : value.fact?.value ?? null, quote: isLink ? null : value.exactQuote,
          source: { boxId: row.id, subjectId: value.subjectId, url: value.sourceUrl, quote: value.exactQuote, reports: value.origins.length } };
        await list.add(input);
      }));
      cursor = String(rows.at(-1)!.id); total += rows.length;
      if (total % 20_000 === 0) console.log(`Fed ${total} production Box reports into work.add()`);
    }
    await query("ANALYZE work_row");
    console.log({ reports: total, workRows: (await query("SELECT count(*)::int n FROM work_row"))[0]!.n });
  } else if (mode === "killed-worker") {
    const [claim] = await workList(query, { owner: "doomed-worker", leaseMs: 1_500 }).claim("read", 1);
    assert.ok(claim);
    console.log(JSON.stringify({ id: claim.id, leaseUntil: claim.lease_until, leaseOwner: claim.lease_owner }));
    await new Promise(() => setInterval(() => undefined, 1_000));
  } else if (mode === "prove") {
    const list = workList(query, { owner: "probe" });
    const latency: number[] = [];
    for (let round = 0; round < 20; round++) {
      const start = performance.now();
      const rows = await list.claim("read", 1);
      latency.push(performance.now() - start);
      assert.equal(rows.length, 1);
      assert.ok(await list.finish(rows[0]!));
    }
    assert.ok(Math.max(...latency) < 50, `Claim took ${Math.max(...latency)}ms`);
    const clients = await Promise.all(Array.from({ length: 200 }, () => pool.connect()));
    let release!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    const started = clients.map(async (client, index) => {
      const worker = workList(async (text, params = []) => (await client.query(text, [...params])).rows, { owner: `worker-${index}` });
      await barrier;
      try { return await worker.claim("read", 1); } finally { client.release(); }
    });
    release();
    const claims = (await Promise.all(started)).flat();
    assert.equal(claims.length, 200);
    assert.equal(new Set(claims.map(row => row.id)).size, 200);
    await Promise.all(claims.slice(0, 199).map(row => list.finish(row)));
    const killed = claims[199]!;
    const afterExpiry = workList(query, { owner: "replacement", now: () => new Date(new Date(killed.lease_until!).getTime() + 1) });
    assert.equal(await afterExpiry.recover(), 1);
    assert.equal(await list.finish(killed), false);
    const [returned] = await query("SELECT state,lease_owner FROM work_row WHERE id=$1", [killed.id]);
    assert.equal(returned!.state, "ready");
    assert.equal(returned!.lease_owner, null);
    const child = spawn(process.execPath, ["--experimental-strip-types", import.meta.filename, "killed-worker"], { stdio: ["ignore", "pipe", "inherit"] });
    const lines = createInterface({ input: child.stdout });
    const line = await lines[Symbol.asyncIterator]().next();
    assert.ok(line.value);
    const dead = JSON.parse(line.value) as { id: string; leaseUntil: string; leaseOwner: string };
    const stopped = once(child, "exit");
    child.kill("SIGKILL");
    const [, signal] = await stopped;
    assert.equal(signal, "SIGKILL");
    lines.close();
    // Its lease really elapses. The normal claim call performs the next run's recovery.
    await new Promise(resolve => setTimeout(resolve, Math.max(0, new Date(dead.leaseUntil).getTime() - Date.now() + 1)));
    await list.recover();
    const [recoveredChild] = await query("SELECT state,lease_owner FROM work_row WHERE id=$1", [dead.id]);
    assert.equal(recoveredChild!.state, "ready");
    assert.equal(recoveredChild!.lease_owner, null);
    const [refused] = await list.claim("check", 1);
    assert.ok(refused);
    assert.ok(await list.refuse(refused, "Source does not confirm this value"));
    assert.equal(await list.refuse(refused, "Repeated result"), false);
    assert.equal((await query("SELECT count(*)::int n FROM work_row WHERE id=$1", [`detect-${refused.id}`]))[0]!.n, 1);
    const direct = await query(`SELECT cp_control_state(jsonb_build_object('subjectId',place_id)) state,
      count(*)::int incoming, count(*) FILTER(WHERE state='done')::int done, count(*) FILTER(WHERE state='refused')::int refused
      FROM work_row GROUP BY 1 ORDER BY 1`);
    const counted = await query(`SELECT state,sum(n) FILTER(WHERE step='work_in')::int incoming,
      coalesce(sum(n) FILTER(WHERE step='work_done'),0)::int done, coalesce(sum(n) FILTER(WHERE step='work_refused'),0)::int refused
      FROM count_hour WHERE step IN ('work_in','work_done','work_refused') GROUP BY state ORDER BY state`);
    assert.deepEqual(counted, direct);
    const directHours = await query(`WITH events AS (
      SELECT cp_control_state(jsonb_build_object('subjectId',place_id)) AS state, date_trunc('hour',received_at) AS hour, 'work_in' AS step FROM work_row
      UNION ALL SELECT cp_control_state(jsonb_build_object('subjectId',place_id)), date_trunc('hour',done_at), 'work_done' FROM work_row WHERE done_at IS NOT NULL
      UNION ALL SELECT cp_control_state(jsonb_build_object('subjectId',place_id)), date_trunc('hour',refused_at), 'work_refused' FROM work_row WHERE refused_at IS NOT NULL
    ) SELECT state,hour,step,count(*)::int n FROM events GROUP BY 1,2,3 ORDER BY 1,2,3`);
    assert.deepEqual(await query("SELECT state,hour,step,n::int FROM count_hour WHERE step IN ('work_in','work_done','work_refused') ORDER BY 1,2,3"), directHours);
    const admin = await workCounts(query, null, new Date());
    for (const row of direct) assert.equal(admin.filter(hour => hour.state === row.state).reduce((n, h) => n + h.incoming, 0), row.incoming);
    const report = { at: new Date().toISOString(), snapshot: JSON.parse(await readFile(".scratch/rb-a5/snapshot.json", "utf8")),
      claimsMs: latency, maxClaimMs: Math.max(...latency), concurrentWorkers: 200, duplicateClaims: 0,
      killedWorkerRecovered: dead.id, killedSignal: signal, countsEqual: true, countsPerHourEqual: true,
      countsByState: [...REGISTRY_STATES.map(state => state.toLowerCase()), "system"].sort().map(state => counted.find(row => row.state === state) ?? { state, incoming: 0, done: 0, refused: 0 }),
      sourceCountsByState: await query("SELECT cp_control_state(value) state,count(*)::int n FROM rb_a5_box_copy GROUP BY 1 ORDER BY 1"),
      plan: (await query("EXPLAIN (FORMAT JSON) SELECT id FROM work_row WHERE kind='read' AND state='ready' AND not_before<=now() ORDER BY priority DESC,not_before,id LIMIT 1"))[0] };
    await writeFile(".scratch/rb-a5/proof.json", JSON.stringify(report, null, 2));
    console.log(report);
  } else if (mode === "schema") {
    await query(CONTROL_READS_BACKFILL_DDL[0]!);
    await query(await readFile("tests/fixtures/work/base.sql", "utf8"));
    await query(await readFile("lib/control-plane/repository/migrations/RB-A5.sql", "utf8"));
    console.log("Local PostgreSQL schema applied");
  } else throw new Error("Use snapshot, schema, seed or prove");
} finally { await pool.end(); }
