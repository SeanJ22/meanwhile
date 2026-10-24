import assert from "node:assert/strict";
import test from "node:test";
import { MemoryEvidenceStore, putArtifact } from "../lib/control-plane/evidence/store.ts";
import { recordAcquisition } from "../lib/control-plane/evidence/artifact.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { beginAttemptFor, claimRouteTask, disposeRouteTask, recordArtifactMetadata, registerRouteTask, registerWorkItem } from "../lib/control-plane/repository/coordinator.ts";
import { createWorkItem } from "../lib/control-plane/work-item.ts";
import { createRouteTask } from "../lib/control-plane/route-task.ts";
import { fingerprint } from "../lib/control-plane/ids.ts";
import { dispatchWorkerTask, FLEET_POLICY_VERSION, type FleetRuntime } from "../lib/control-plane/workers/runtime.ts";
import { enqueueHeldSubjectDetails, heldSubjectDetailsExecutor, isHeldSubjectDetailsTask } from "../lib/control-plane/workers/held-subject-worker.ts";
import { HELD_SUBJECT_SQL } from "../lib/control-plane/scheduler/providers/held-subject-loader.ts";
import { HELD_MEMBER_IDENTITIES_SQL } from "../lib/control-plane/scheduler/providers/held-subject-member-identities.ts";
import { factClocks } from "../lib/facts/clocks.ts";
import { FRESHNESS_HOURS_DEFAULT } from "../lib/facts/clocks.ts";
import { defaultAdminConfig } from "../lib/control-plane/gateway/admin-config.ts";
import { productionHeldSubjectDetailsExecutor } from "../lib/control-plane/workers/held-subject-runtime.ts";
import { factDb } from "./helpers/fact-db.ts";

const AT = "2026-10-20T07:00:00.000Z", NOW = "2026-10-20T07:01:00.000Z";
const URL = "https://council.example.gov/ada", PERSON = "person:ada", MEMBER = "member:ada";
const PLACE = "ocd-division/country:us/state:az/place:example", BODY = `${PLACE}#council`;
const html = "<main><h1>Ada Sample</h1><p>Phone: 520-555-0123</p><p>Office address: 10 Public Plaza</p></main>";

async function fixture(finalUrl = URL, sourceText = html, body = false) {
  const repos = createMemoryRepositories(), vault = new MemoryEvidenceStore(), facts = await factDb();
  const subject = body ? BODY : MEMBER;
  const item = createWorkItem({ project: "freshness", subject, obligation: "Read this held subject's owed details", why: "Verified details reach readers independently.",
    contract: { requiresValidation: false, requiresAudit: false }, now: AT });
  await registerWorkItem(repos, item, AT);
  const route = createRouteTask({ workItemId: item.id, routeId: `held-subject-details:${fingerprint([URL])}`, routeLabel: "Held own profile",
    target: finalUrl === URL ? subject : URL, inherited: false, now: AT });
  await registerRouteTask(repos, route, AT);
  const holder = "fixture-source", claim = await claimRouteTask(repos, { routeTaskId: route.id, holder, now: AT, ttlMs: 60_000 });
  const attempt = await beginAttemptFor(repos, { workItemId: item.id, routeTaskId: route.id, lease: claim.lease.value, now: AT, methodVersion: 1,
    policyVersion: FLEET_POLICY_VERSION, worker: { role: "ACQUIRER", provider: "fixture", version: "1", instance: holder } });
  const { artifact } = recordAcquisition({ canonicalUrl: finalUrl, retrievalUrl: URL, retrievedAt: AT, httpStatus: 200, contentType: "text/html",
    sourceId: new globalThis.URL(finalUrl).hostname, methodRouteId: route.routeId, workItemId: item.id, attemptId: attempt.id, permission: "ALLOWED", transport: "REACHABLE" }, sourceText);
  await putArtifact(vault, item.project, artifact, Buffer.from(sourceText));
  await recordArtifactMetadata(repos, { artifactId: artifact.id, workItemId: item.id, routeTaskId: route.id, attemptId: attempt.id,
    tier: artifact.tier, contentHash: artifact.contentHash, byteLength: artifact.byteLength, contentType: artifact.contentType,
    canonicalUrl: finalUrl, partial: false, recordedAt: AT }, AT);
  await disposeRouteTask(repos, { routeTaskId: route.id, attemptId: attempt.id, now: AT,
    expectedTaskRevision: (await repos.routeTasks.mustRead(route.id)).revision, artifactIds: [artifact.id],
    disposition: { disposition: "INGESTED", attemptId: attempt.id, at: AT, artifactIds: [artifact.id], observation: null,
      permission: "ALLOWED", transport: "REACHABLE", note: "Actual recorded fixture response." } });
  let loadCount = 0;
  const db = { ...facts, query: async (text: string, params: readonly unknown[] = []) => {
    if (text === HELD_MEMBER_IDENTITIES_SQL) { assert.deepEqual(params, ["AZ", BODY]); return []; }
    if (text !== HELD_SUBJECT_SQL) return facts.query(text, params);
    loadCount++;
    assert.deepEqual(params, ["AZ", subject, NOW], "one exact held subject enters the worker");
    return [{ body: { id: BODY, name: "Council", bodyClass: "CITY_COUNCIL", ocdId: PLACE, provenance: { sourceUrl: URL, collectedAt: AT } },
      roster: { bodyId: BODY, bodyName: "Council", sourceUrl: URL, sourceOrg: "Council", collectedAt: AT,
        members: body ? [] : [{ id: MEMBER, personId: PERSON, name: "Ada Sample", officeTitle: "Councilmember", websiteUrl: URL }] },
      executive: null, bridge: null, government: null, person: null, state_division: "ocd-division/country:us/state:az", checked: AT }];
  } };
  const runtime: FleetRuntime = { repos, methodVersion: 1, now: () => NOW,
    readEvidence: async () => { throw Error("GENERAL_EVIDENCE_READER_UNUSED"); },
    independentContext: async () => { throw Error("MODEL_PIPELINE_UNUSED"); },
    roleExecutor: (task, workerHolder) => heldSubjectDetailsExecutor({ repos, vault, db, clocks: factClocks(null), now: () => NOW,
      purge: async () => ({ purged: true }) }, task, workerHolder) };
  const enqueue = (overrides = {}) => enqueueHeldSubjectDetails(repos, { workItemId: item.id, sourceRouteTaskId: route.id,
    artifactId: artifact.id, state: "AZ", methodVersion: 1, now: NOW, ...overrides });
  return { repos, vault, facts, db, item, route, artifact, attempt, runtime, enqueue, loadCount: () => loadCount };
}

test("an exact held artifact queues once, publishes verified facts through the normal worker lease, and preserves original receipt time", async () => {
  const f = await fixture();
  try {
    const task = await f.enqueue();
    assert.ok(task && isHeldSubjectDetailsTask(task));
    assert.equal((await f.enqueue())?.id, task.id);
    const result = await dispatchWorkerTask(f.runtime, task);
    assert.equal(result.outcome, "WORKED", result.detail);
    assert.equal(result.disposition, null, "worker completion does not claim that every detail is now held");
    assert.equal(result.cost?.requestCount, 0);
    assert.equal(result.cost?.bytesFetched, 0);
    assert.equal(result.cost?.usd, 0);
    assert.equal(f.loadCount(), 1);
    assert.deepEqual((await f.facts.query("SELECT field,value FROM fact WHERE entity_id=$1 AND status='live' ORDER BY field", [PERSON]))
      .map(row => [row.field, row.value]), [["office_address", "10 Public Plaza"], ["phone", "520-555-0123"]]);
    assert.equal(String((await f.facts.query("SELECT fetched_at FROM source_copy"))[0]!.fetched_at), String(new Date(AT)));
    assert.match(result.detail, /0 new facts have an existing reader path/);
    assert.match(result.detail, /office_address into Officeholder.offices/);
    assert.match(result.detail, /Missing reader edges remain owed/);
    const held = (await f.repos.artifacts.read(f.item.id))[0]!;
    assert.equal(held.attemptId, f.attempt.id, "content identity never reattributes original acquisition");
    assert.equal(held.recordedAt, AT);
    assert.equal((await f.repos.routeTasks.mustRead(task.id)).value.state, "RESULT_RECORDED");
    const saved = (await f.repos.workerResults.read(f.item.id))[0]!;
    assert.equal(saved.result.role, "ACQUIRER");
    if (saved.result.role === "ACQUIRER") {
      assert.equal(saved.result.artifacts[0]!.reused, true);
      assert.equal(saved.result.artifacts[0]!.acquisitionAttemptId, f.attempt.id);
      assert.equal(saved.result.artifacts[0]!.retrievedAt, AT);
      assert.equal(saved.result.walkState.state, "OPEN");
    }
  } finally { await f.facts.pg.close(); }
});

test("a redirect is read only through the exact held source receipt and its final URL remains the quoted fact source", async () => {
  const finalUrl = "https://official.example.gov/profiles/ada";
  const f = await fixture(finalUrl);
  try {
    const task = (await f.enqueue())!;
    const result = await dispatchWorkerTask(f.runtime, task);
    assert.equal(result.outcome, "WORKED", result.detail);
    assert.equal((await f.facts.query("SELECT url FROM source_copy"))[0]!.url, finalUrl);
    assert.equal((await f.repos.artifacts.read(f.item.id))[0]!.canonicalUrl, finalUrl);
  } finally { await f.facts.pg.close(); }
});

test("the body worker reports independently published member facts to Admin as well as its body details", async () => {
  const f = await fixture(URL, '<main><h1>Council</h1><h2>Members</h2><table><tr><th>Name</th><th>Office</th></tr>' +
    '<tr><td>Ada Sample</td><td>Councilmember</td></tr><tr><td>Sam Example</td><td>Chair</td></tr></table></main>', true);
  try {
    const task = (await f.enqueue())!;
    const result = await dispatchWorkerTask(f.runtime, task);
    assert.equal(result.outcome, "WORKED", result.detail);
    const live = Number((await f.facts.query("SELECT count(*)::int n FROM fact WHERE status='live'"))[0]!.n);
    assert.ok(live > 1, "the verified roster contributes facts beyond the body's name");
    assert.ok(result.detail.includes(`${live} new facts`), result.detail);
    const saved = (await f.repos.workerResults.read(f.item.id))[0]!;
    assert.equal(saved.result.role, "ACQUIRER");
    if (saved.result.role === "ACQUIRER") assert.equal(saved.result.walk[0]!.returnedCount, live);
  } finally { await f.facts.pg.close(); }
});

test("unacquired, foreign, or changed receipts cannot enqueue or publish another subject's page", async () => {
  const f = await fixture();
  try {
    assert.equal(await f.enqueue({ artifactId: "not-held" }), null);
    assert.equal(await f.enqueue({ workItemId: "another-subject" }), null);
    assert.equal(await f.enqueue({ sourceRouteTaskId: "another-source" }), null);
    const task = (await f.enqueue())!, row = await f.repos.routeTasks.mustRead(f.route.id);
    await f.repos.routeTasks.compareAndSet(row.id, row.revision, { ...row.value, target: "https://council.example.gov/someone-else" }, NOW);
    const result = await dispatchWorkerTask(f.runtime, task);
    assert.equal(result.outcome, "FAILED");
    assert.match(result.detail, /HELD_DETAIL_SOURCE_RECEIPT_REFUSED/);
    assert.equal(f.loadCount(), 0);
    assert.equal((await f.facts.query("SELECT count(*)::int n FROM fact"))[0]!.n, 0);
  } finally { await f.facts.pg.close(); }
});

test("the production composition uses current Admin fact clocks before publishing from a saved page", async () => {
  const f = await fixture();
  try {
    await f.repos.adminConfig.put("current", { ...defaultAdminConfig(NOW),
      settings: { "facts.freshnessHours": { ...FRESHNESS_HOURS_DEFAULT, contact: 0.001 } } }, NOW);
    const narrowRead = f.repos.adminConfig.readNarrowed.bind(f.repos.adminConfig);
    f.repos.adminConfig.read = async () => { throw Error("FULL_ADMIN_CONFIG_READ_REFUSED"); };
    f.repos.adminConfig.readNarrowed = async (id, projection) => {
      assert.equal(id, "current");
      assert.deepEqual(projection, { settings: ["facts.freshnessHours", "facts.retryMinutes"] });
      return narrowRead(id, projection);
    };
    const task = (await f.enqueue())!;
    const runtime = { ...f.runtime, roleExecutor: (task: Parameters<typeof heldSubjectDetailsExecutor>[1], holder: string) =>
      productionHeldSubjectDetailsExecutor({ repos: f.repos, vault: f.vault, db: f.db, now: () => NOW,
        purge: async () => ({ purged: true }), fetchImpl: async () => { throw Error("NO_IMAGE_ON_SAVED_PAGE"); } }, task, holder) };
    const result = await dispatchWorkerTask(runtime, task);
    assert.equal(result.outcome, "WORKED", result.detail);
    assert.equal(result.cost?.requestCount, 0);
    assert.equal((await f.facts.query("SELECT count(*)::int n FROM fact WHERE status='live'"))[0]!.n, 0);
    assert.equal((await f.facts.query("SELECT count(*)::int n FROM blank WHERE stage='CHECK'"))[0]!.n, 2);
  } finally { await f.facts.pg.close(); }
});

test("the production portrait path counts the actual failed image response without hiding already verified contact facts", async () => {
  const f = await fixture(URL, html.replace("</main>", `<img src="${URL}.jpg" alt="Ada Sample portrait"></main>`));
  try {
    const task = (await f.enqueue())!, failureBytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7]);
    let requests = 0;
    const runtime = { ...f.runtime, roleExecutor: (task: Parameters<typeof heldSubjectDetailsExecutor>[1], holder: string) =>
      productionHeldSubjectDetailsExecutor({ repos: f.repos, vault: f.vault, db: f.db, now: () => NOW,
        purge: async () => ({ purged: true }), fetchImpl: async resource => {
          requests++;
          const response = new Response(failureBytes, { status: 404, headers: { "content-type": "image/jpeg" } });
          Object.defineProperty(response, "url", { value: String(resource) });
          return response;
        } }, task, holder) };
    const result = await dispatchWorkerTask(runtime, task);
    assert.equal(result.outcome, "WORKED", result.detail);
    assert.equal(requests, 1);
    assert.equal(result.cost?.requestCount, 1);
    assert.equal(result.cost?.bytesFetched, failureBytes.byteLength);
    const saved = (await f.repos.workerResults.read(f.item.id))[0]!;
    assert.equal(saved.result.role, "ACQUIRER");
    if (saved.result.role === "ACQUIRER") {
      assert.equal(saved.result.requestCount, requests);
      assert.equal(saved.result.bytesFetched, failureBytes.byteLength);
    }
    assert.equal((await f.facts.query("SELECT count(*)::int n FROM fact WHERE status='live'"))[0]!.n, 2);
    assert.equal((await f.facts.query("SELECT reason FROM blank WHERE field='portrait'"))[0]!.reason, "PORTRAIT_NOT_VERIFIED");
  } finally { await f.facts.pg.close(); }
});

test("the production factory resolves the sanctioned write URI without changing an inherited readonly DATABASE_URL", async () => {
  const f = await fixture();
  try {
    const task = (await f.enqueue())!, readonly = "postgresql://readonly:fixture@db.example.test/held";
    const writer = "postgresql://writer:fixture@db.example.test/held";
    const environment = { DATABASE_URL: readonly, WTP_PRODUCTION_DATABASE_URL_READONLY: readonly, WTP_PRODUCTION_DATABASE_URL_WRITE: writer };
    const connections: string[] = [];
    const runtime = { ...f.runtime, roleExecutor: (task: Parameters<typeof heldSubjectDetailsExecutor>[1], holder: string) =>
      productionHeldSubjectDetailsExecutor({ repos: f.repos, vault: f.vault, now: () => NOW, environment,
        dbFactory: connection => { connections.push(connection); return f.db; }, purge: async () => ({ purged: true }) }, task, holder) };
    const result = await dispatchWorkerTask(runtime, task);
    assert.equal(result.outcome, "WORKED", result.detail);
    assert.deepEqual(connections, [writer]);
    assert.equal(environment.DATABASE_URL, readonly);
    assert.equal((await f.facts.query("SELECT count(*)::int n FROM fact WHERE status='live'"))[0]!.n, 2);
  } finally { await f.facts.pg.close(); }
});

test("a readonly role in the sanctioned write slot is refused before opening the fact store", async () => {
  const f = await fixture();
  try {
    const task = (await f.enqueue())!;
    let opened = false;
    const runtime = { ...f.runtime, roleExecutor: (task: Parameters<typeof heldSubjectDetailsExecutor>[1], holder: string) =>
      productionHeldSubjectDetailsExecutor({ repos: f.repos, vault: f.vault, now: () => NOW,
        environment: { WTP_PRODUCTION_DATABASE_URL_WRITE: "postgresql://readonly:fixture@db.example.test/held" },
        dbFactory: () => { opened = true; return f.db; }, purge: async () => ({ purged: true }) }, task, holder) };
    const result = await dispatchWorkerTask(runtime, task);
    assert.equal(result.outcome, "FAILED");
    assert.match(result.detail, /connection whose user is read-only/);
    assert.equal(opened, false);
    assert.equal((await f.facts.query("SELECT count(*)::int n FROM fact"))[0]!.n, 0);
  } finally { await f.facts.pg.close(); }
});
