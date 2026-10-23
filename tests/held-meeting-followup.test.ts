import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";
import { recordAcquisition } from "../lib/control-plane/evidence/artifact.ts";
import { MemoryEvidenceStore, putArtifact } from "../lib/control-plane/evidence/store.ts";
import { beginAttemptFor, claimRouteTask, disposeRouteTask, recordArtifactMetadata, registerRouteTask, registerWorkItem } from "../lib/control-plane/repository/coordinator.ts";
import { createWorkItem } from "../lib/control-plane/work-item.ts";
import { createRouteTask } from "../lib/control-plane/route-task.ts";
import { enqueueHeldMeetingTask, heldMeetingExecutor, isHeldMeetingTask, productionHeldMeetingExecutor, runHeldMeetingNative, type HeldMeetingWorkerRuntime } from "../lib/control-plane/workers/held-meeting-followup.ts";
import { dispatchWorkerTask, FLEET_POLICY_VERSION, type FleetRuntime } from "../lib/control-plane/workers/runtime.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { meetingPartitionForRow } from "../lib/civic-data/meeting-partitions.ts";
import type { Registry } from "../lib/registry/types.ts";
import { runMeetingIngest } from "../scripts/ingest.ts";
import { FIXTURE_DOOR_ROWS, fixtureDoorRecords, fixtureRepositories, installFixtureDoors } from "./helpers/meeting-doors-fixture.ts";
import { withFetch } from "./helpers/with-fetch.ts";
import { factDb } from "./helpers/fact-db.ts";
import { currentMeetingClock, installMeetingClock } from "../lib/civic-data/contracts.ts";
import { installFactReader } from "../lib/facts/db.ts";
import { defaultAdminConfig } from "../lib/control-plane/gateway/admin-config.ts";
import { installDoorRecords } from "../lib/doors/meeting-doors.ts";
import { readHeldMeetingChildInput } from "../scripts/lib/held-meeting-child-input.ts";
import { runPimaLegistarOutcomeIngest, parsePimaOutcomeIngestArgs } from "../scripts/legistar-outcomes-ingest.mts";
import { findClient } from "../lib/sources/legistar/client-registry.ts";
import { meetingPartitionId } from "../lib/civic-data/meeting-partitions.ts";

async function fixture(source: "ical" | "pima-insite" = "ical") {
  installFixtureDoors();
  const row = FIXTURE_DOOR_ROWS.find(row => source === "ical" ? row.agendaSourceType === "ICAL"
    : Boolean(row.config.insiteHost) && row.config.slug === "pima")!;
  const kind = source === "ical" ? "ical" : "legistar-insite";
  const door = fixtureDoorRecords([row]).find(door => door.kind === kind)!, partition = meetingPartitionForRow(kind, row.bodyId);
  const at = new Date(Date.now() - 60_000).toISOString(), now = new Date().toISOString();
  const starts = new Date(Date.now() + 86_400_000).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const text = source === "ical" ? ["BEGIN:VCALENDAR", "VERSION:2.0", "BEGIN:VEVENT", "UID:held-worker-one", `DTSTART:${starts}`,
    "SUMMARY:Advisory Budget Committee", "END:VEVENT", "END:VCALENDAR"].join("\r\n") : "<html><body>Held Board of Supervisors calendar</body></html>";
  const repos = await fixtureRepositories(FIXTURE_DOOR_ROWS.filter(candidate => candidate.bodyId === row.bodyId)),
    vault = new MemoryEvidenceStore(), store = new MemoryRoutineDataStore(), facts = await factDb();
  const item = createWorkItem({ project: "freshness", subject: row.bodyId, obligation: "Read this held body's calendar", why: "Agenda and changes remain owed",
    contract: { requiresValidation: false, requiresAudit: false }, now: at });
  await registerWorkItem(repos, item, at);
  const route = createRouteTask({ workItemId: item.id, routeId: source === "ical" ? "CALENDAR_STALE" : "OUTCOME_NOT_READ",
    routeLabel: "Held calendar", target: source === "ical" ? row.config.feedUrl! : `https://${row.config.insiteHost}/Calendar.aspx`, inherited: false, now: at });
  await registerRouteTask(repos, route, at);
  const claim = await claimRouteTask(repos, { routeTaskId: route.id, holder: "fixture-source", now: at, ttlMs: 60_000 });
  const attempt = await beginAttemptFor(repos, { workItemId: item.id, routeTaskId: route.id, lease: claim.lease.value, now: at, methodVersion: 1,
    policyVersion: FLEET_POLICY_VERSION, worker: { role: "ACQUIRER", provider: "fixture", version: "1", instance: "fixture-source" } });
  const { artifact } = recordAcquisition({ canonicalUrl: route.target, retrievedAt: at, httpStatus: 200, contentType: "text/calendar",
    sourceId: new URL(route.target).host, methodRouteId: route.routeId, workItemId: item.id, attemptId: attempt.id, permission: "ALLOWED", transport: "REACHABLE" }, text);
  await putArtifact(vault, item.project, artifact, Buffer.from(text));
  const record = { artifactId: artifact.id, workItemId: item.id, routeTaskId: route.id, attemptId: attempt.id,
    tier: artifact.tier, contentHash: artifact.contentHash, byteLength: artifact.byteLength, contentType: artifact.contentType,
    canonicalUrl: route.target, partial: false, recordedAt: at };
  await recordArtifactMetadata(repos, record, at);
  await disposeRouteTask(repos, { routeTaskId: route.id, attemptId: attempt.id, now: at,
    expectedTaskRevision: (await repos.routeTasks.mustRead(route.id)).revision, artifactIds: [artifact.id],
    disposition: { disposition: "INGESTED", attemptId: attempt.id, at, artifactIds: [artifact.id], observation: null,
      permission: "ALLOWED", transport: "REACHABLE", note: "Recorded source fixture" } });
  const registry: Registry = { generatedAt: at, divisions: [], bodies: [{ id: row.bodyId, ocdId: row.ocdId, name: row.config.bodyName!,
    bodyClass: "committee", bodyOrigin: "SOURCED", coverageStatus: "LIVE", agendaSourceType: "ICAL", agendaSourceRef: route.target,
    meetingCadence: null, homepageUrl: null, demandCount: 0, sourceDataset: "GOV_DIRECTORY",
    provenance: { sourceUrl: route.target, sourceOrg: row.publishingOrg, collectedAt: at, verifiedAt: null } }] };
  let inputReads = 0, released = 0, preparedFile = "";
  const runtime: HeldMeetingWorkerRuntime = { root: process.cwd(), repos, vault, store, now: () => now,
    query: async () => { throw Error("UNSCOPED_DATABASE_READ"); },
    environment: { NODE_ENV: "test", WTP_RUNTIME_AUTHORITY_REPO: process.cwd(), WTP_RUNTIME_AUTHORITY_SHA: "a".repeat(40) },
    readInput: async (_query, exact) => { inputReads++; assert.equal(exact.bodyId, row.bodyId); return { partition, registry, previous: null, venues: [] }; },
    slots: { acquire: async entry => { assert.equal(entry, source === "ical" ? `${partition.id}/scripts/ingest.ts`
      : "pima-legistar-outcomes/scripts/legistar-outcomes-ingest.mts"); return () => { released++; }; } },
    launcher: async command => {
      assert.equal(command.executable, process.execPath);
      assert.equal(command.env?.WTP_RUNTIME_AUTHORITY_CAPABILITY, "ROUTINE_CONTRACT");
      assert.equal(command.env?.WTP_RUNTIME_AUTHORITY_CONTRACT, partition.id);
      assert.equal(command.env?.WTP_RUNTIME_AUTHORITY_PARENT_PID, String(process.pid));
      preparedFile = command.args.find(arg => arg.startsWith("--prepared-file="))!.slice("--prepared-file=".length);
      assert.equal((await stat(preparedFile)).mode & 0o777, 0o600);
      const prepared = JSON.parse(await readFile(preparedFile, "utf8"));
      assert.equal(prepared.initialResponse.retrievedAt, at);
      assert.equal(Buffer.from(prepared.initialResponse.base64, "base64").toString(), text);
      assert.equal(prepared.registry.bodies.length, 1);
      const lines: string[] = [], originalLog = console.log;
      console.log = (...args) => { lines.push(args.join(" ")); };
      try {
        const result = await withFetch(async () => { throw Error("REPLAY_MADE_AN_EXTRA_REQUEST"); }, () => runMeetingIngest(
          ["composite", "--promote", `--only-partition=${partition.id}`], { ...prepared, store, facts: { db: facts, vault },
            initialResponse: { ...prepared.initialResponse, bytes: new Uint8Array(Buffer.from(prepared.initialResponse.base64, "base64")) } }));
        lines.push(`DIGGER_RESULT=${JSON.stringify({ ...result, partitions: [] })}`);
        return { id: command.id, status: result.exitCode, signal: null, stdout: lines.join("\n"), stderr: "", termination: "EXITED", errorMessage: null };
      } finally { console.log = originalLog; }
    } };
  return { repos, vault, store, facts, runtime, partition, door, record, item, route, at, registry,
    inputReads: () => inputReads, released: () => released, preparedFile: () => preparedFile };
}

test("an acquired held calendar reaches the native reader through its exact routine authority and ordinary worker lease", async () => {
  const f = await fixture();
  const originalRoute = await f.repos.routeTasks.mustRead(f.route.id);
  await f.repos.routeTasks.compareAndSet(originalRoute.id, originalRoute.revision,
    { ...originalRoute.value, target: f.item.subject }, f.runtime.now());
  const task = await enqueueHeldMeetingTask(f.repos, { item: f.item, artifact: f.record, route: f.route, now: f.runtime.now() });
  assert.ok(task && isHeldMeetingTask(task));
  assert.equal((await f.repos.routeTasks.mustRead(f.route.id)).value.target, f.item.subject,
    "the real standing occurrence retains its body target while native work binds the captured source URL");
  assert.equal((await enqueueHeldMeetingTask(f.repos, { item: f.item, artifact: f.record, route: f.route, now: f.runtime.now() }))?.id, task.id);
  const doorReads: string[] = [];
  const repos = { ...f.repos, doors: { ...f.repos.doors, listWhere: async (path: readonly string[], value: string) => {
    doorReads.push(value);
    assert.deepEqual(path, ["bodyIds", "0"]);
    assert.equal(value, f.item.subject, "the lease reads its body's routed and unrouted source metadata");
    return f.repos.doors.listWhere(path, value);
  }, list: async () => { throw Error("COUNTRY_DOOR_READ_FORBIDDEN"); } } };
  installDoorRecords([], "a newly leased process has no inherited JavaScript source registry");
  const fleet: FleetRuntime = { repos, methodVersion: 1, now: f.runtime.now,
    readEvidence: async () => { throw Error("GENERAL_PARSER_UNUSED"); }, independentContext: async () => { throw Error("MODEL_PIPELINE_UNUSED"); },
    roleExecutor: (work, holder) => heldMeetingExecutor({ ...f.runtime, repos }, work, holder) };
  const result = await dispatchWorkerTask(fleet, task);
  assert.equal(result.outcome, "WORKED", result.detail);
  assert.equal(result.cost?.requestCount, 0);
  assert.equal(result.cost?.bytesFetched, 0);
  assert.equal(result.cost?.usd, 0);
  const projection = await f.store.readPromotion("MEETING", f.partition.scope);
  assert.ok(projection, "the actual registered source candidate moved the reader projection");
  assert.equal((await f.store.readCandidate(projection.versionId))!.candidate.retrieval.retrievedAt, f.at, "the native source clock remains the original read");
  assert.equal((await f.repos.doors.mustRead(f.partition.id)).value.lastSuccessAt, f.at,
    "the exact held body's source clock receives the verified original observation rather than worker completion time");
  assert.ok((await f.facts.query("SELECT id FROM fact WHERE status='live'")).length > 0, "independently verified calendar facts also reach the normal fact publisher");
  const workers = await f.repos.workerResults.read(f.item.id), output = workers[0]!.result;
  assert.equal(output.role, "ACQUIRER");
  if (output.role === "ACQUIRER") {
    assert.equal(output.artifacts[0]!.retrievedAt, f.at);
    assert.equal(output.artifacts[0]!.contentHash, f.record.contentHash);
    assert.equal(output.artifacts[0]!.acquisitionAttemptId, f.record.attemptId);
    assert.equal(output.artifacts[0]!.reused, true);
  }
  assert.equal(f.inputReads(), 1);
  assert.ok(doorReads.length > 0, "the worker rebuilds its exact-body native contract from actual registered door rows");
  assert.equal(f.released(), 1);
  await assert.rejects(stat(f.preparedFile()), /ENOENT/, "the original source payload is removed after the child settles");
  await f.facts.pg.close();
});

test("failed native work retains measured requests, releases memory and removes its private input", async () => {
  const f = await fixture();
  let preparedFile = "";
  const result = await runHeldMeetingNative({ ...f.runtime, launcher: async command => {
    const file = command.args.find(arg => arg.startsWith("--prepared-file="))!.slice("--prepared-file=".length);
    preparedFile = file;
    const prepared = JSON.parse(await readFile(file, "utf8"));
    assert.equal(prepared.initialResponse, undefined, "a sanitized or unavailable raw capture requires normal native acquisition");
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    return { id: command.id, status: 2, signal: null, stdout: `DIGGER_RESULT=${JSON.stringify({ exitCode: 2, sourceSucceeded: false,
      measurement: { requests: 3, bytesRead: 17, peakMemoryBytes: 40, failures: ["publisher refused the source"] } })}`, stderr: "", termination: "EXITED", errorMessage: null };
  } }, { partition: f.partition, contract: f.partition, door: f.door, deadlineMs: Date.now() + 10_000 });
  assert.equal(result.succeeded, false);
  assert.equal(result.measurement?.requests, 3);
  assert.equal(result.measurement?.bytesRead, 17);
  assert.match(result.detail, /publisher refused/);
  assert.equal(f.released(), 1);
  await assert.rejects(stat(preparedFile), /ENOENT/);
  await f.facts.pg.close();
});

test("Pima's held InSite gap invokes its registered API outcome reader with that same body's API door and actual filtered requests", async () => {
  const f = await fixture("pima-insite"), requests: string[] = [];
  try {
    const task = await enqueueHeldMeetingTask(f.repos, { item: f.item, artifact: f.record, route: f.route, now: f.runtime.now() });
    assert.ok(task);
    const runtime: FleetRuntime = { repos: f.repos, methodVersion: 1, now: f.runtime.now,
      readEvidence: async () => { throw Error("GENERAL_PARSER_UNUSED"); }, independentContext: async () => { throw Error("NO_MODEL"); },
      roleExecutor: (work, holder) => heldMeetingExecutor({ ...f.runtime, launcher: async command => {
        assert.equal(command.args[1], "scripts/legistar-outcomes-ingest.mts");
        assert.equal(command.env?.WTP_RUNTIME_AUTHORITY_CONTRACT, "pima-legistar-outcomes");
        const argv = command.args.slice(2), apiDoor = meetingPartitionId("legistar", f.item.subject);
        const prepared = await readHeldMeetingChildInput(argv, apiDoor);
        assert.equal(prepared.door.doorId, apiDoor);
        assert.deepEqual(prepared.door.bodyIds, [f.item.subject]);
        assert.equal(prepared.initialResponse?.requestedUrl, f.route.target, "the original InSite capture remains unchanged, not relabeled as API evidence");
        assert.equal(prepared.initialResponse?.source, "legistar-insite");
        const client = findClient("pima", f.item.subject);
        assert.ok(client);
        const nativeId = client.eventBodyId ?? 77;
        const result = await withFetch(async (input: Parameters<typeof fetch>[0]) => {
          const url = String(input), parsed = new URL(url); requests.push(url);
          assert.equal(parsed.origin, "https://webapi.legistar.com");
          if (parsed.pathname.endsWith("/bodies")) return new Response(JSON.stringify([{ BodyId: nativeId, BodyName: client.eventBodyName }]), { headers: { "content-type": "application/json" } });
          assert.equal(parsed.pathname, "/v1/pima/events");
          assert.match(parsed.searchParams.get("$filter")!, new RegExp(`EventBodyId eq ${nativeId}`));
          return new Response("[]", { headers: { "content-type": "application/json" } });
        }, () => runPimaLegistarOutcomeIngest({ store: f.store, client, initialResponse: prepared.initialResponse,
          args: parsePimaOutcomeIngestArgs(["--dry-run", "--slug", "pima"]), window: { from: "2026-10-01", to: "2026-10-20" }, log: () => {} }));
        assert.equal(result.measurement.requests, requests.length, "unmatched original InSite bytes exclude no actual API requests");
        return { id: command.id, status: result.exitCode, signal: null, stdout: `DIGGER_RESULT=${JSON.stringify({ ...result, sourceSucceeded: result.exitCode === 0 })}`,
          stderr: "", termination: "EXITED", errorMessage: null };
      } }, work, holder) };
    const result = await dispatchWorkerTask(runtime, task);
    assert.equal(result.outcome, "FAILED", "a zero-sitting response remains owed; reaching the source does not invent outcomes");
    assert.match(result.detail, /ZERO_SITTINGS/);
    assert.ok(requests.some(url => new URL(url).pathname === "/v1/pima/events"));
    assert.equal(result.cost?.requestCount, requests.length);
    assert.equal(f.released(), 1);
  } finally { await f.facts.pg.close(); }
});

test("a child success claim without its durable native reader receipt cannot complete the held worker", async () => {
  const f = await fixture();
  const result = await runHeldMeetingNative({ ...f.runtime, launcher: async command => ({ id: command.id, status: 0, signal: null,
    stdout: `DIGGER_RESULT=${JSON.stringify({ exitCode: 0, sourceSucceeded: true, measurement: { requests: 0, failures: [], peakMemoryBytes: 1 } })}`,
    stderr: "", termination: "EXITED", errorMessage: null }) }, { partition: f.partition, contract: f.partition, door: f.door, deadlineMs: Date.now() + 10_000 });
  assert.equal(result.succeeded, false);
  assert.match(result.detail, /receipt missing/);
  assert.equal(f.released(), 1);
  await f.facts.pg.close();
});

test("an interrupted or foreign artifact cannot enqueue a native held-meeting reader", async () => {
  const f = await fixture();
  assert.equal(await enqueueHeldMeetingTask(f.repos, { item: { ...f.item, subject: "curated:az/another#governing" }, artifact: f.record, route: f.route, now: f.runtime.now() }), null);
  assert.equal(await enqueueHeldMeetingTask(f.repos, { item: f.item, artifact: { ...f.record, artifactId: "foreign" }, route: f.route, now: f.runtime.now() }), null);
  assert.equal(await enqueueHeldMeetingTask(f.repos, { item: f.item, artifact: { ...f.record, contentHash: "sha256-" + "a".repeat(64) }, route: f.route, now: f.runtime.now() }), null);
  await f.facts.pg.close();
});

test("a native child that exits without measurement reports its sent requests and bytes as unknown", async () => {
  const f = await fixture();
  const task = await enqueueHeldMeetingTask(f.repos, { item: f.item, artifact: f.record, route: f.route, now: f.runtime.now() });
  assert.ok(task);
  const doorReads: string[] = [];
  const repos = { ...f.repos, doors: { ...f.repos.doors, readMany: undefined, listWhere: async (path: readonly string[], value: string) => {
    doorReads.push(value);
    assert.deepEqual(path, ["bodyIds", "0"]);
    assert.equal(value, f.item.subject);
    return f.repos.doors.listWhere(path, value);
  } } };
  const fleet: FleetRuntime = { repos, methodVersion: 1, now: f.runtime.now,
    readEvidence: async () => { throw Error("GENERAL_PARSER_UNUSED"); }, independentContext: async () => { throw Error("MODEL_PIPELINE_UNUSED"); },
    roleExecutor: (work, holder) => heldMeetingExecutor({ ...f.runtime, repos, launcher: async command => ({ id: command.id,
      status: 1, signal: null, stdout: "", stderr: "source child stopped", termination: "EXITED", errorMessage: null }) }, work, holder) };
  const result = await dispatchWorkerTask(fleet, task);
  assert.equal(result.outcome, "FAILED");
  assert.equal(result.cost?.requestCount, null);
  assert.equal(result.cost?.bytesFetched, null);
  assert.equal(result.cost?.usd, 0);
  assert.ok(doorReads.length > 0);
  assert.equal(f.released(), 1);
  await f.facts.pg.close();
});

test("the production factory applies this pass's actual faster Admin clock before opening its subject reader", async () => {
  const f = await fixture(), clock = currentMeetingClock();
  await f.repos.adminConfig.put("current", { ...defaultAdminConfig(f.runtime.now()), settings: { "meetings.hotEveryMinutes": 30 } }, f.runtime.now());
  const task = await enqueueHeldMeetingTask(f.repos, { item: f.item, artifact: f.record, route: f.route, now: f.runtime.now() });
  assert.ok(task);
  installFactReader(null);
  try {
    const fleet: FleetRuntime = { repos: f.repos, methodVersion: 1, now: f.runtime.now,
      readEvidence: async () => { throw Error("GENERAL_PARSER_UNUSED"); }, independentContext: async () => { throw Error("MODEL_PIPELINE_UNUSED"); },
      roleExecutor: (work, holder) => productionHeldMeetingExecutor(f.runtime, work, holder) };
    const result = await dispatchWorkerTask(fleet, task);
    assert.equal(result.outcome, "FAILED");
    assert.match(result.detail, /READER_STORE_UNAVAILABLE/);
    assert.equal(currentMeetingClock().hotEveryMs, 30 * 60_000);
    assert.equal(result.cost?.requestCount, 0);
  } finally { installFactReader(undefined); installMeetingClock(clock); await f.facts.pg.close(); }
});
