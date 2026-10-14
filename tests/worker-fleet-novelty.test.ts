import { playbookRows } from "./helpers/playbooks.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { autonomousHarness, FIXTURE_URL } from "./helpers/autonomous-fleet.ts";
import { runAutonomousCoordinator } from "../lib/control-plane/workers/coordinator.ts";
import { autonomousStandingRuntime } from "../lib/control-plane/workers/standing-runtime.ts";
import { unknownApplicability, type MethodKnowledge } from "../lib/method/knowledge.ts";
import type { ModelRequest, ModelResponse } from "../lib/control-plane/scheduler/scout-executor.ts";
import { createRouteTask } from "../lib/control-plane/route-task.ts";
import { registerRouteTask } from "../lib/control-plane/repository/coordinator.ts";
import { dispatchOne } from "../lib/control-plane/scheduler/dispatch.ts";
import { FIRST_BACKOFF_MINUTES } from "../lib/control-plane/scheduler/debt.ts";
import { fieldManualEntryId, writeFieldManual } from "../lib/control-plane/field-manual.ts";
import { knowledgeEntries, methodVersionEntry } from "./method-store-fixture.ts";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { manualEdgeEntry } from "./helpers/promoted-edge-entry.ts";
import { withReaderAuthorityEdge, type ReaderAuthorityEdgeBundle } from "../lib/registry/runtime-edge.ts";
import type { PromotedProjection } from "../lib/civic-data/types.ts";

const registry = (JSON.parse(gunzipSync(readFileSync("tests/fixtures/registry-transfer-import.json.gz")).toString("utf8")) as { projection: PromotedProjection }).projection;
const REGISTRY_EDGE: ReaderAuthorityEdgeBundle = { promoted: new Map([[registry.key, manualEdgeEntry("registry-runtime-bindings", registry.payload, registry.versionId)]]) };

async function exhaustPlainRetries(h: Awaited<ReturnType<typeof autonomousHarness>>) {
  for (let failure = 0; failure < 3; failure++) {
    const run = await runAutonomousCoordinator(h.runtime, { maximum: 1, concurrency: 1 });
    assert.equal(run.decisions[0].task?.workerTask?.role, "ACQUIRER", "known routes use plain acquisition before paid investigation");
    assert.equal(run.dispatches[0].outcome, "WORKED", run.dispatches[0].detail);
    if (failure < 2) {
      const record = (await h.repos.workerResults.readAll()).find(row => row.attemptId === run.dispatches[0].attemptId)!;
      h.advanceTo(new Date(Date.parse(record.endedAt) + (2 ** failure * FIRST_BACKOFF_MINUTES + 1) * 60_000).toISOString());
    }
  }
}

test("the actual Scout request inherits a learned method and the failed Hunter route before novelty",async t=>{
  const h=await autonomousHarness({response:{transportError:"socket timeout"}});
  await writeFieldManual(h.repos, playbookRows, h.now());
  await exhaustPlainRetries(h);
  const before=await h.repos.workerResults.readAll();
  const root=await mkdtemp(join(tmpdir(),"fleet-novelty-fixture-"));
  assert.equal(dirname(resolve(root)),resolve(tmpdir()));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const method:MethodKnowledge={version:56,updatedOn:"2026-09-03",routes:[{
    id:"fixture-learned-roster-route",title:"Walk the separately published fixture office register",tier:"A0",fields:["officeholder"],
    applicability:unknownApplicability("Recorded test method; applicability is offered, never assumed"),outcomes:[],subBranches:[],origin:"Recorded test control",learnedAtVersion:55,learnedOn:"2026-09-02"}]};
  await writeFieldManual(h.repos,[...knowledgeEntries(method),methodVersionEntry(method)],h.now());
  // Seed one portable field-manual door so the projection surfaces it for this
  // obligation regardless of its jurisdiction, then assert the walk both READS it
  // in the request and RECORDS it as captured input on the result.
  const doorId=fieldManualEntryId("test-seed","novelty-door");
  const seeded = await writeFieldManual(h.repos,[{
    id:doorId,role:"SHARED",kind:"VENDOR_TENANT",title:"Seeded test door",
    summary:"a portable inherited door for the capture assertion",states:[],recordClasses:[],
    platforms:[],outcome:"YIELDED",url:"https://seeded.example/door",source:"test-seed",
    observedAt:"2026-09-19",tier:null,portable:true,payload:{}}],h.now());
  assert.equal(seeded.written,1);
  const requests:ModelRequest[]=[];
  const searches: string[] = [];
  const runtime=await withReaderAuthorityEdge(REGISTRY_EDGE,()=>autonomousStandingRuntime({root,repos:h.repos,now:h.now,auditCeilingUsd:1,
    search: async input => { searches.push(input.query); return { hits: [], requestCount: 1, bytesFetched: 0, providersUsed: ["offline-fixture"], errors: [] }; },
    transport:async request=>{
    requests.push(request);
    if (requests.length === 1) return { model: request.model, stop_reason: "tool_use", content: [{ type: "tool_use", id: "offline-search", name: "search", input: { query: "fixture clerk alternate official roster", rung: "other:source-discovery", why: "The recorded direct route timed out" } }], usage: { input_tokens: 10, output_tokens: 10 } };
    throw new Error("OFFLINE_REQUEST_CAPTURE_COMPLETE");
  }}));
  const run=await runAutonomousCoordinator(runtime,{maximum:1,concurrency:1,maxScoutDispatches:1});
  assert.equal(run.decisions[0].action,"SCOUT");
  assert.equal(requests.length,2,"the transport is an offline recorder, never a provider call");
  assert.deepEqual(searches, ["fixture clerk alternate official roster"], "an autonomous repair can invoke the same injected guarded search capability");
  const request=JSON.stringify(requests[0]);
  assert.match(request,/Walk the separately published fixture office register/);
  assert.match(request,/Method to try/);
  assert.match(request,/Saved work and remaining leads/);
  assert.doesNotMatch(request,/fourteen retrieval rungs are a floor/);
  assert.ok(request.includes(FIXTURE_URL));
  assert.match(request,/timeout/);
  assert.match(request,/seeded\.example\/door/,"the seeded field-manual door reaches the scout's request brief");
  assert.match(request,/sopapi\/document\/getdocument/,"the first walk receives the route just learned from installed adapter code");
  const result=(await h.repos.scoutResults.readAll()).at(-1)!;
  assert.ok(result.inheritedFieldManualEntryIds?.includes(doorId),"the result records the exact projected door id (captured input)");
  assert.ok(result.inheritedFieldManualEntryIds?.includes(fieldManualEntryId('installed-adapter','sparqdata-policy')),
    "the same walk records the installed guide it received, without a second runtime startup");
  assert.ok(result.inheritedFieldManualLines?.some(l=>l.includes("https://seeded.example/door")),"the result records the exact rendered door line handed to the scout");
  const attempt=(await h.repos.attempts.mustRead(result.attemptId)).value;
  assert.ok(Date.parse(attempt.endedAt!)>=Date.parse(result.recordedAt),"Completion must use the actual post-provider clock, not dispatch admission time.");
  assert.deepEqual(await h.repos.workerResults.readAll(),before,"a Scout transport failure cannot rewrite the prior Hunter evidence");
  assert.notEqual((await h.repos.workItems.mustRead(h.item.id)).value.state,"VERIFIED_COMPLETE");
});

test("one running worker runtime saves a new observed route and hands it to its next Scout", async t => {
  const h = await autonomousHarness({ response: { transportError: "socket timeout" } });
  await writeFieldManual(h.repos, playbookRows, h.now());
  await exhaustPlainRetries(h);
  const root = await mkdtemp(join(tmpdir(), "fleet-new-method-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const empty = { version: 56, updatedOn: "2026-09-03", routes: [] };
  await writeFieldManual(h.repos, [methodVersionEntry(empty)], h.now());
  const discovered = "https://arlingtonvermont.org/town-clerk/";
  const requests: ModelRequest[] = [];
  const runtime = await withReaderAuthorityEdge(REGISTRY_EDGE, () => autonomousStandingRuntime({ root, repos: h.repos, now: h.now, auditCeilingUsd: 1, spaceOut: async () => {},
    openBytes: async ({ url }) => ({ status: 200, bytes: url.endsWith("robots.txt") ? Buffer.from("User-agent: *\nDisallow:\n") : readFileSync("tests/fixtures/voting-sources/vt-arlington-clerk-original.html"), contentType: url.endsWith("robots.txt") ? "text/plain" : "text/html", finalUrl: url, durationMs: 1, transportError: null }),
    transport: async request => {
      requests.push(request);
      if (requests.length > 3) throw new Error("SECOND_WALK_CAPTURED_OFFLINE");
      const observed = JSON.stringify(request.messages).match(/ARTIFACT (ar-[a-f0-9]+) \| url https:\/\/arlingtonvermont\.org\/town-clerk\//);
      const content: ModelResponse["content"] = !observed
        ? [{ type: "tool_use", id: "open", name: "fetch_public", input: { url: discovered, rung: "primary-site-navigation", why: "Read the alternative official roster" } }]
        : [{ type: "tool_use", id: "done", name: "finish", input: { outcome: "ROUTE_CANDIDATE", rungsWalked: [{ index: 0, note: "Observed alternate roster" }], candidates: [{ routeId: "new-official-roster", title: "Alternative official roster", url: discovered, procedure: "GET the public clerk page and parse its HTML records", relevance: "official roster", permission: "ALLOWED", permissionReading: "Recorded public response", evidenceArtifactIds: [observed[1]], observedOn: "2026-09-03", recordClass: "OFFICIAL_ROSTER", deterministic: true, unverified: [] }], findings: [], nextRungs: [], unverified: [], narrative: "Observed a source route; publication remains independently verified." } }];
      return { model: request.model, stop_reason: "tool_use", content, usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } };
    } }));
  await runAutonomousCoordinator(runtime, { maximum: 1, concurrency: 1, maxScoutDispatches: 1 });
  const first = (await h.repos.scoutResults.readAll()).at(-1)!;
  assert.equal(first.refusal, null, JSON.stringify(first.refusal));
  assert.equal(first.candidates.length, 1);
  assert.deepEqual(first.rebuiltExistingRoutes, []);
  const stored = (await h.repos.fieldManual.list()).map(row => row.value);
  const entry = stored.find(e => e.url === discovered && e.kind === "SCOUT_DISCOVERY")!;
  assert.ok(entry, "real runtime write-back persisted the discovered route");
  const item = (await h.repos.workItems.mustRead(h.item.id)).value;
  const task = createRouteTask({ workItemId: item.id, routeId: "reuse-check", routeLabel: "Follow-up route check", target: discovered, inherited: true, now: h.now() });
  await registerRouteTask(h.repos, task, h.now());
  await dispatchOne(h.repos, { obligation: { obligation: { id: task.id, subjectId: item.subject, recordClass: "OFFICIAL_ROSTER", routeId: task.routeId, active: true, readerImpactAt: null, observedChangeRateHours: null, lastWorkedAt: null }, nextDueAt: task.createdAt, cadenceHours: 24, cadenceSource: "DEFAULT_NO_SIGNAL", basis: "Offline reuse proof" }, routeTaskId: task.id, holder: "offline-reuse", now: h.now(), leaseTtlMs: 420000, bound: { maxAttempts: 3, maxWallMs: 300000, maxCostUnits: 400000 }, maturity: () => "UNGRADUATED", executor: runtime.scoutFor!(item, task, []), methodVersion: 56, policyVersion: "offline-proof" });
  assert.equal(requests.length, 4);
  assert.ok(JSON.stringify(requests[2].messages).includes(discovered));
  const second = (await h.repos.scoutResults.readAll()).find(r => r.routeTaskId === task.id)!;
  assert.ok(second.inheritedFieldManualEntryIds?.includes(entry.id));
  assert.ok(second.inheritedFieldManualLines?.some(line => line.includes(discovered)));
  assert.ok(second.usedFieldManualEntryIds?.includes(entry.id), "the next worker actually walked the inherited route");
});
