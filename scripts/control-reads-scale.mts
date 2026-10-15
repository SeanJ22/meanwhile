import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { PGlite } from "@electric-sql/pglite";
import type { ControlPlaneRepositories } from "../lib/control-plane/repository/types.ts";
import type { StandingObligation } from "../lib/control-plane/scheduler/durable.ts";
import type { NeonBytesHour } from "../lib/db/transfer-by-caller.ts";
import type { FixMapRow } from "../lib/method/fix-map.ts";

interface RunReport {
  run: number; ms: number; responseBytes: number; requestBytes: number; peakRssBytes: number;
  output: unknown; digest: string; hours: NeonBytesHour[];
}

const arg = (name: string, fallback = "") => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const root = resolve(arg("root", process.cwd()));
const sourceRoot = resolve(arg("source", process.cwd()));
const legacy = arg("legacy") === "true";
const now = "2026-10-15T12:00:00.000Z";
const importAt = (path: string) => import(pathToFileURL(join(root, path)).href);
const scenario = arg("scenario", "manual");
const repetitions = Number(arg("repetitions", "3"));
const history = Number(arg("history", "4"));
const runsPerDay = Number(arg("runs-per-day", "1440"));
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const mode = arg("mode", "parent");

if (mode === "worker") await worker();
else await parent();

async function worker() {
  const { neonConfig } = await import("@neondatabase/serverless");
  const inflight = new Map<number, { resolve: (value: string) => void; reject: (error: Error) => void }>();
  let sequence = 0;
  process.on("message", (message: { id: number; body?: string; error?: string }) => {
    const pending = inflight.get(message.id);
    if (!pending) return;
    inflight.delete(message.id);
    if (message.error) pending.reject(new Error(message.error));
    else pending.resolve(message.body!);
  });
  neonConfig.fetchFunction = async (_url: unknown, options?: RequestInit) => {
    const id = ++sequence;
    const body = await new Promise<string>((resolve, reject) => {
      inflight.set(id, { resolve, reject });
      process.send!({ type: "query", id, body: options?.body });
    });
    return new Response(body, { headers: { "content-type": "application/json" } });
  };
  const pg = await importAt("lib/control-plane/repository/pg-store.ts");
  const copies = await importAt("lib/control-plane/repository/incremental-reads.ts");
  const transfer = await importAt("lib/db/transfer-by-caller.ts");
  transfer.keepNeonBytesInProcess();
  pg.installHeldCopies(() => copies.openHeldCopies(arg("copies"), { slackMs: 0 }));
  const repos = await pg.createPgRepositories("postgresql://fixture:fixture@ep-cp-scale.us-east-2.aws.neon.tech/fixture", now, { skipBootstrap: true });
  const places = JSON.parse(await readFile(arg("selected"), "utf8")) as string[];
  const results: RunReport[] = [];
  for (let run = 0; run < repetitions; run++) {
    const before = transfer.processNeonBytes().reduce((sum: number, hour: { bytes: Record<string, number> }) => sum + hour.bytes["control-plane"], 0);
    const sentBefore = transfer.processNeonBytes().reduce((sum: number, hour: { sent: Record<string, { bytes: number }> }) => sum + hour.sent["control-plane"].bytes, 0);
    const began = performance.now();
    const output = await workload(repos, places, run);
    const parts = transfer.takeNeonBytesHours();
    const read = parts.reduce((sum: number, hour: { bytes: Record<string, number> }) => sum + hour.bytes["control-plane"], 0);
    const sent = parts.reduce((sum: number, hour: { sent: Record<string, { bytes: number }> }) => sum + hour.sent["control-plane"].bytes, 0);
    for (const part of parts) {
      const summary = transfer.summarizeNeonBytes(part, 1000);
      assert.equal(summary.byCaller.reduce((sum: number, row: { bytes: number }) => sum + row.bytes, 0), summary.controlPlaneBytes + summary.readerBytes);
    }
    // rusage can retain the fixture parent's pre-exec peak; VmHWM measures this worker's address space.
    const highWater = /VmHWM:\s+(\d+) kB/.exec(readFileSync("/proc/self/status", "utf8"));
    assert.ok(highWater, "Linux process memory high-water reading is required");
    const report = { run, ms: performance.now() - began, responseBytes: read - before, requestBytes: sent - sentBefore,
      peakRssBytes: Number(highWater[1]) * 1024, output, digest: digest(output), hours: parts };
    results.push(report);
    process.send!({ type: "progress", scenario, run, responseBytes: report.responseBytes, requestBytes: report.requestBytes, ms: report.ms });
  }
  process.send!({ type: "done", results }, () => process.disconnect!());
}

async function workload(repos: ControlPlaneRepositories, places: string[], run: number): Promise<unknown> {
  if (scenario === "admin") {
    const values = [];
    for (let call = 0; call < 79; call++) values.push((await repos.adminConfig.read("current"))?.value.apiFallback);
    return { calls: values.length, settings: values[0] };
  }
  if (scenario === "spend") {
    const spend = await importAt("lib/control-plane/spend-window.ts");
    const safety = await importAt("lib/control-plane/fleet-safety.ts");
    const entry = costEntry(`added-${run}`, places[0]);
    await spend.countCharge(repos, entry, now);
    const totals = [];
    for (let point = 0; point < 7; point++) {
      const held = await spend.readSpendWindow(repos, now);
      totals.push(legacy ? safety.aggregatePricedSpend(held, "2026-10-14T12:00:00.000Z", now).usd : held.usd);
    }
    return { admissions: totals.length, usd: totals[0] };
  }
  if (scenario === "method") {
    let works = await repos.fixMap.worksFor(["scale-method"]);
    for (let packet = 1; packet < places.length; packet++) works = await repos.fixMap.worksFor(["scale-method"]);
    if (legacy) {
      const prior = repos.fixMap as unknown as { forMethod(id: string, limit: number): Promise<readonly FixMapRow[]> };
      const proof = await prior.forMethod("scale-method", 1000);
      return { packets: places.length, works: [...works], proofCount: proof.length, triedCount: proof.filter(row => places.includes(row.placeId)).length };
    }
    const proof = await repos.fixMap.statistics("scale-method");
    const tried = await repos.fixMap.forPlaces("scale-method", places);
    return { packets: places.length, works: [...works], proofCount: proof.total, triedCount: tried.length };
  }
  if (scenario === "manual") {
    const manual = await importAt("lib/control-plane/field-manual.ts");
    const changed = await repos.fieldManual.mustRead("note-0-1");
    await repos.fieldManual.compareAndSet(changed.id, changed.revision, { ...changed.value, summary: `Calendar lesson ${run}` }, now);
    const notes = [];
    for (const place of places) {
      const query = { role: "SCOUT", state: /\/state:([a-z]{2})(?:\/|$)/.exec(place)?.[1], ocdIds: [place], limit: 12 };
      const result = await manual.readFieldManualRows(repos, query);
      if (result.error) throw new Error(result.error);
      notes.push({ place, ids: result.store.entries.map((entry: { id: string }) => entry.id).sort() });
    }
    return notes;
  }
  if (scenario === "coordinator") {
    const pg = await importAt("lib/control-plane/repository/pg-store.ts");
    const rows = await pg.readCoordinatorWorkItems(repos);
    assert.equal(rows.length, places.length + 1);
    assert.ok(rows.some((row: { id: string }) => row.id === "wi-0-1"), "Archived non-hunt continuation must remain visible");
    return rows.map((row: { id: string }) => row.id).sort();
  }
  if (scenario === "dispatch") {
    const durable = await importAt("lib/control-plane/scheduler/durable.ts");
    const obligations = places.map((subjectId, index) => ({ id: `o-${index}`, subjectId, openOccurrenceId: `open-${index}`, occurrenceCount: history + 1, updatedAt: now } as StandingObligation));
    if (legacy) {
      await repos.workItems.list();
      const tasks = await repos.routeTasks.list();
      await durable.scanOccurrences(repos, { obligations, settledRouteTaskIds: new Set(), neverClaimedRouteTaskIds: new Set(tasks.filter(row => row.value.state === "PENDING").map(row => row.id)) });
      return Promise.all(obligations.map(obligation => durable.resumeOpenOccurrence(repos, obligation)));
    }
    const snapshot = await repos.dispatchState.readOpen({ since: run === 0 ? null : now });
    await durable.scanOccurrences(repos, { obligations, settledRouteTaskIds: new Set(), neverClaimedRouteTaskIds: new Set(snapshot.routeTasks.keys()), snapshot });
    return Promise.all(obligations.map(obligation => durable.resumeOpenOccurrence(repos, obligation, snapshot)));
  }
  throw new Error(`Unknown scenario ${scenario}`);
}

function costEntry(id: string, place: string) {
  return { attemptId: id, workItemId: `wi-${id}`, routeTaskId: `rt-${id}`, routeId: null, source: "api.anthropic.com", jurisdiction: place,
    project: "freshness", role: "SCOUT", model: "claude-haiku-4-5-20251001", recordedAt: now,
    cost: { usd: 0.01, requestCount: 1, inputTokens: 1000, outputTokens: 100, elapsedMs: 250,
      uncachedInputTokens: 1000, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, cacheCreation5mInputTokens: 0, cacheCreation1hInputTokens: 0 } };
}

async function nationalPlaces(): Promise<string[]> {
  const directory = join(sourceRoot, "data/derived/zip-divisions");
  const places = new Set<string>();
  for (const file of (await readdir(directory)).filter(name => /^\d\d\.json$/.test(name))) {
    const shard = JSON.parse(await readFile(join(directory, file), "utf8"));
    for (const place of shard.divisions) places.add(place);
  }
  return [...places].sort();
}

async function parent() {
  assert.ok(Number.isInteger(repetitions) && repetitions > 0);
  assert.ok(Number.isInteger(history) && history > 0);
  const setupStarted = performance.now();
  const { PGlite } = await import("@electric-sql/pglite");
  const pg = new PGlite();
  const schema = await importAt("lib/control-plane/repository/pg-schema.ts");
  for (const ddl of schema.BOOTSTRAP_DDL) {
    if (scenario === "method" && !legacy && /cp_fix_method_summar/.test(ddl)) continue;
    await pg.exec(ddl.replaceAll(" CONCURRENTLY ", " "));
  }
  const all = await nationalPlaces();
  const maximum = Number(arg("places", String(all.length)));
  const byState = new Map<string, string>();
  for (const place of all) {
    const state = /\/(?:state|territory|district):([^/]+)/.exec(place)?.[1];
    if (state && !byState.has(state)) byState.set(state, place);
  }
  const selected = [...byState.values()];
  const places = [...new Set([...selected, ...all])].slice(0, maximum);
  await pg.exec("CREATE TABLE scale_places (ordinal integer PRIMARY KEY, id text NOT NULL)");
  for (let at = 0; at < places.length; at += 1000) await pg.query("INSERT INTO scale_places SELECT (e->>'ordinal')::integer, e->>'id' FROM jsonb_array_elements($1::jsonb) e", [JSON.stringify(places.slice(at, at + 1000).map((id, index) => ({ ordinal: at + index, id })))]);
  await seed(pg, places, selected.filter(place => places.includes(place)));
  await pg.exec("ANALYZE");
  if (scenario === "manual" && arg("explain")) {
    const previous = JSON.parse(await readFile(arg("explain"), "utf8")) as { query: string; params: unknown[] };
    const store = await importAt("lib/control-plane/repository/pg-store.ts");
    const current = { query: store.FIELD_MANUAL_SLICE_SQL, params: [...store.fieldManualSliceParams({ role: "SCOUT", state: "az", ocdIds: ["ocd-division/country:us/state:az"], limit: 12 }), null] };
    for (const [version, query] of [["previous", previous], ["current", current]] as const) {
      const plan = (await pg.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query.query}`, query.params)).rows;
      process.stderr.write(`${JSON.stringify({ type: "plan", version, plan })}\n`);
    }
  }
  const fixtureSetupMs = performance.now() - setupStarted;
  process.stderr.write(`${JSON.stringify({ type: "fixture", scenario, divisions: places.length, fixtureSetupMs })}\n`);
  const directory = await mkdtemp(join(tmpdir(), "cp-01-scale-"));
  const { writeFile } = await import("node:fs/promises");
  const selectedFile = join(directory, "selected.json");
  await writeFile(selectedFile, JSON.stringify(selected.filter(place => places.includes(place))));
  const child = fork(import.meta.filename, [...process.argv.slice(2), "--mode=worker", `--copies=${join(directory, "copies")}`, `--selected=${selectedFile}`], {
    cwd: root, execArgv: ["--experimental-strip-types", "--import", join(root, "scripts/register-test-loader.mjs")],
    env: { ...process.env, DATABASE_URL: "", WTP_CONTROL_PLANE_DATABASE_URL: "postgresql://fixture:fixture@ep-cp-scale.us-east-2.aws.neon.tech/fixture", WTP_VITAL_SIGNS_REPORT: "1" },
    stdio: ["ignore", "pipe", "pipe", "ipc"], serialization: "advanced",
  });
  child.stderr!.on("data", data => process.stderr.write(data));
  child.stdout!.on("data", data => process.stderr.write(data));
  const results = await new Promise<RunReport[]>((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", code => { if (code !== 0) reject(new Error(`Scale worker exited ${code}`)); });
    child.on("message", async (message: { type: string; id: number; body: string; results: RunReport[] }) => {
      if (message.type === "done") { resolve(message.results); return; }
      if (message.type === "progress") { process.stderr.write(`${JSON.stringify(message)}\n`); return; }
      if (message.type !== "query") return;
      try {
        const request = JSON.parse(message.body);
        const execute = async (query: { query: string; params?: unknown[] }) => {
          return wire(await pg.query<Record<string, unknown>>(query.query, query.params ?? [], { serializers: { 16: value => String(value) } }));
        };
        const response = request.queries ? { results: await Promise.all(request.queries.map(execute)) } : await execute(request);
        child.send({ id: message.id, body: JSON.stringify(response) });
      } catch (error) { child.send({ id: message.id, error: error instanceof Error ? error.message : String(error) }); }
    });
  });
  const peak = Math.max(...results.map(result => result.peakRssBytes));
  const runnerAvailable = Number(arg("runner-available-bytes", "NaN"));
  const documentedHost = 8 * 1024 ** 3;
  const parentReserve = 2928 * 1024 ** 2;
  const margin = 0.75 * 1024 ** 3;
  const warm = results.at(-1)!;
  console.log(JSON.stringify({ scenario, root, legacy, input: { divisions: places.length, nationalDivisionsAvailable: all.length,
    scopes: [...byState.keys()].sort(), selectedPlaces: selected.filter(place => places.includes(place)).length, historiesPerPlace: history },
    measurement: "Exact serialized fixture-adapter request/response bodies through the production Neon counter; excludes real Neon framing, network latency and database WAL. Database is a separate process from the measured worker.",
    assumptions: { runsPerDay, runnerAvailableBytes: Number.isFinite(runnerAvailable) ? runnerAvailable : null, reserveBytes: margin,
      documentedHostBytes: documentedHost, documentedHostSource: "deploy/runner/README.md", existingParentReserveBytes: parentReserve,
      parentReserveSource: "lib/control-plane/workers/worker-slots.ts", productionHeartbeatAvailable: false },
    fixtureSetupMs, peakRssBytes: peak, workerPeakSource: "/proc/self/status VmHWM", copiesAtMargin: Number.isFinite(runnerAvailable) ? Math.max(0, Math.floor((runnerAvailable - margin) / peak)) : null,
    documentedHostWorkerOnlyCopies: Math.floor((documentedHost - margin) / peak),
    documentedHostCopiesAfterParentReserve: Math.floor((documentedHost - margin - parentReserve) / peak),
    warmResponseBytesPerHour: warm.responseBytes * runsPerDay / 24, warmResponseBytesPerDay: warm.responseBytes * runsPerDay,
    warmRequestBytesPerHour: warm.requestBytes * runsPerDay / 24, warmRequestBytesPerDay: warm.requestBytes * runsPerDay,
    warmRuntimeMsPerDay: warm.ms * runsPerDay, results }, null, 2));
  await pg.close();
  await rm(directory, { recursive: true, force: true });
}

function wire(result: { rows: Record<string, unknown>[]; fields: { name: string; dataTypeID: number }[]; affectedRows?: number }) {
  const encode = (value: unknown, type: number): string | null => {
    if (value === null || value === undefined) return null;
    if (type === 114 || type === 3802) return JSON.stringify(value);
    if (Array.isArray(value)) return `{${value.map(entry => entry === null ? "NULL" : JSON.stringify(String(entry))).join(",")}}`;
    if (value instanceof Date) return value.toISOString();
    return String(value);
  };
  return { command: "SELECT", rowCount: result.affectedRows ?? result.rows.length, rowAsArray: true, fields: result.fields,
    rows: result.rows.map(row => result.fields.map(field => encode(row[field.name], field.dataTypeID))) };
}

async function seed(pg: PGlite, places: string[], selected: string[]) {
  const template = (kind: string) => `INSERT INTO cp_${kind} (id, revision, updated_at, changed_at, value)`;
  if (scenario === "manual") {
    const manual = await importAt("lib/control-plane/field-manual.ts");
    const entry = manual.normalizeEntry(manual.newFieldManualEntry("scale", "template", { role: "SCOUT", kind: "SCOUT_DISCOVERY", title: "Official meeting calendar",
      summary: "The official calendar publishes meetings and links the agenda and minutes for this government.", outcome: "YIELDED", ocdIds: [places[0]], observedAt: now, payload: { route: "official-calendar", result: "agenda and minutes" } }));
    await pg.query(`${template("field_manual_entries")} SELECT 'note-' || p.ordinal || '-' || h.n, 1, $1::timestamptz, $1::timestamptz,
      $2::jsonb || jsonb_build_object('id', 'note-' || p.ordinal || '-' || h.n, 'ocdIds', jsonb_build_array(p.id),
        'reach', jsonb_build_object('places', jsonb_build_array(p.id), 'states', '[]'::jsonb, 'platforms', '[]'::jsonb, 'everywhere', false))
      FROM scale_places p CROSS JOIN generate_series(1,$3::integer) h(n)`, [now, JSON.stringify(entry), history]);
  } else if (scenario === "method") {
    await pg.query(`INSERT INTO cp_fix_map (method_id,place_id,state,tried_at,attempt_id,cause,updated_at)
      SELECT 'scale-method',id,'WORKS',$1::timestamptz,'attempt-' || ordinal,NULL,$1::timestamptz FROM scale_places`, [now]);
    if (!legacy) {
      const map = await importAt("lib/method/fix-map.ts");
      for (const ddl of map.FIX_MAP_DDL) await pg.exec(ddl);
    }
  } else if (scenario === "admin") {
    const admin = await importAt("lib/control-plane/gateway/admin-config.ts");
    const config = admin.defaultAdminConfig(now);
    await pg.query(`${template("admin_config")} SELECT 'current',1,$1::timestamptz,$1::timestamptz,$2::jsonb ||
      jsonb_build_object('settingHistory',(SELECT jsonb_agg(jsonb_build_object('id','setting-' || ordinal,'key','workers','before',1,'after',2,'at',$1::text,'actor','factory')) FROM scale_places),
      'placeTargets',(SELECT jsonb_agg(jsonb_build_object('key',id,'goalPercent',100,'setAt',$1::text,'decidedBy','factory','receiptId','receipt-' || ordinal)) FROM scale_places))`, [now, JSON.stringify(config)]);
    if (!legacy) {
      const state = await importAt("lib/control-plane/repository/admin-config.ts");
      for (const ddl of state.ADMIN_SECTIONS_DDL) await pg.exec(ddl);
      const began = performance.now();
      await state.backfillAdminSections(async (text: string, params?: unknown[]) => (await pg.query(text, params)).rows);
      const count = (await pg.query<{ count: number }>("SELECT (SELECT count(*) FROM cp_admin_setting_history) + (SELECT count(*) FROM cp_admin_place_targets) AS count")).rows[0].count;
      assert.equal(Number(count), places.length * 2);
      process.stderr.write(`${JSON.stringify({ type: "migration", scenario, rows: Number(count), ms: performance.now() - began })}\n`);
      await pg.exec(state.ADMIN_SECTIONS_STRIP_DDL);
    }
  } else if (scenario === "spend") {
    const safety = await importAt("lib/control-plane/fleet-safety.ts");
    const spend = await importAt("lib/control-plane/spend-window.ts");
    const charge = safety.pricedModelCharge(costEntry("template", places[0]), "template");
    if (legacy) {
      await pg.query(`${template("spend_window")} SELECT 'model-charges',1,$1::timestamptz,$1::timestamptz,
        jsonb_build_object('charges', jsonb_agg($2::jsonb || jsonb_build_object('id','charge-' || ordinal,'jurisdiction',id))) FROM scale_places`, [now, JSON.stringify(charge)]);
    } else {
      const model = await importAt("lib/control-plane/repository/model-charges.ts");
      for (const ddl of model.MODEL_CHARGES_DDL) await pg.exec(ddl);
      await pg.query(`INSERT INTO cp_model_charges (id,charged_at,job_id,route_task_id,obligation_id,jurisdiction,attempt_id,usd,known_usd,measured,bounded,assignment_refs,is_scout,scout_usd,cache)
        SELECT 'charge-' || ordinal,$1::timestamptz,'job-' || ordinal,'task-' || ordinal,NULL,id,'attempt-' || ordinal,0.01,0.01,true,false,NULL,
          true,0.01,NULL FROM scale_places`, [now]);
    }
    assert.ok(spend.costRecordId);
  } else if (scenario === "dispatch" || scenario === "coordinator") {
    let continuation: Record<string, unknown> | null = null;
    if (scenario === "coordinator") {
      const fixture = await import(pathToFileURL(join(sourceRoot, "tests/helpers/autonomous-fleet.ts")).href);
      const coordinator = await importAt("lib/control-plane/workers/coordinator.ts");
      const held = await fixture.autonomousHarness();
      const blocked = { ...held.item, autonomousPlan: { ...held.item.autonomousPlan, sources: [], acquisition: [] } };
      assert.equal((await coordinator.nextAutonomousOperation(held.runtime, held.item.id, [blocked])).action, "BLOCKED");
      assert.equal((await coordinator.nextAutonomousOperation(held.runtime, held.item.id)).action, "WORKER");
      continuation = { ...held.item, id: "wi-0-1" };
    }
    for (const kind of ["work_items", "route_tasks", "occurrences"]) {
      let value = kind === "work_items" ? "jsonb_build_object('id','wi-' || p.ordinal || '-' || h.n,'subject',p.id,'state','VERIFIED_COMPLETE')"
        : kind === "route_tasks" ? "jsonb_build_object('id','rt-' || p.ordinal || '-' || h.n,'workItemId','wi-' || p.ordinal || '-' || h.n,'state','DISPOSED','disposition',jsonb_build_object('disposition','YIELDED'))"
          : "jsonb_build_object('id','occ-' || p.ordinal || '-' || h.n,'obligationId','past-' || p.ordinal,'sequence',h.n,'workItemId','wi-' || p.ordinal || '-' || h.n,'routeTaskId','rt-' || p.ordinal || '-' || h.n,'closedAt',$1::text)";
      if (continuation && kind === "work_items") value = `CASE WHEN p.ordinal=0 AND h.n=1 THEN $5::jsonb ELSE ${value}
        || '{"autonomousPlan":{"capability":"officials/offices","acquisition":[],"sources":[],"contract":{"schemaVersion":2,"recordClass":"OFFICIAL_ROSTER"}}}'::jsonb END`;
      const prefix = kind === "work_items" ? "wi-" : kind === "route_tasks" ? "rt-" : "occ-";
      const batch = Math.max(1, Math.floor(1000 / history));
      for (let at = 0; at < places.length; at += batch) await pg.query(`${template(kind)}
        SELECT '${prefix}' || p.ordinal || '-' || h.n,1,$1::timestamptz,$1::timestamptz,${value}
        FROM scale_places p CROSS JOIN generate_series(1,$2::integer) h(n) WHERE p.ordinal >= $3 AND p.ordinal < $4`,
      [now, history, at, at + batch, ...(continuation && kind === "work_items" ? [JSON.stringify(continuation)] : [])]);
    }
    for (let index = 0; index < selected.length; index++) {
      for (const [kind, id, value] of [
        ["work_items", `open-wi-${index}`, { id: `open-wi-${index}`, subject: selected[index], state: "OPEN", ...(scenario === "coordinator" ? { autonomousPlan: { capability: "hunt-packet" } } : {}) }],
        ["route_tasks", `open-rt-${index}`, { id: `open-rt-${index}`, workItemId: `open-wi-${index}`, state: "PENDING", disposition: null }],
        ["occurrences", `open-${index}`, { id: `open-${index}`, obligationId: `o-${index}`, sequence: history + 1, workItemId: `open-wi-${index}`, routeTaskId: `open-rt-${index}`, closedAt: null }],
      ]) await pg.query(`${template(String(kind))} VALUES ($1,1,$2::timestamptz,$2::timestamptz,$3::jsonb)`, [id, now, JSON.stringify(value)]);
    }
    if (!legacy) {
      const dispatch = await importAt("lib/control-plane/repository/dispatch-state.ts");
      for (const ddl of dispatch.DISPATCH_STATE_DDL) await pg.exec(ddl);
      const began = performance.now();
      let archived = 0;
      for (;;) {
        const rows = (await pg.query<{ moved: number }>(dispatch.DISPATCH_ARCHIVE_MOVE_SQL)).rows;
        const moved = Number(rows[0]?.moved ?? 0);
        archived += moved;
        if (moved === 0) break;
      }
      assert.equal(Number((await pg.query<{ n: number }>("SELECT count(*) AS n FROM cp_occurrences WHERE value->>'closedAt' IS NOT NULL")).rows[0].n), 0);
      process.stderr.write(`${JSON.stringify({ type: "migration", scenario, archived, ms: performance.now() - began })}\n`);
    }
  }
}
