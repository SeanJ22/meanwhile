import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { MemoryEvidenceStore, putArtifact } from "../lib/control-plane/evidence/store.ts";
import { recordAcquisition } from "../lib/control-plane/evidence/artifact.ts";
import { beginAttemptFor, claimRouteTask, disposeRouteTask, recordArtifactMetadata, registerRouteTask, registerWorkItem } from "../lib/control-plane/repository/coordinator.ts";
import { createWorkItem } from "../lib/control-plane/work-item.ts";
import { createRouteTask } from "../lib/control-plane/route-task.ts";
import { enqueueHeldSubjectDetails } from "../lib/control-plane/workers/held-subject-worker.ts";
import { isHeldSubjectLinkedSourceTask } from "../lib/control-plane/workers/held-subject-linked-source.ts";
import { productionHeldSubjectDetailsExecutor } from "../lib/control-plane/workers/held-subject-runtime.ts";
import { dispatchWorkerTask, FLEET_POLICY_VERSION, type FleetRuntime } from "../lib/control-plane/workers/runtime.ts";
import { HELD_SUBJECT_SQL } from "../lib/control-plane/scheduler/providers/held-subject-loader.ts";
import { factDb } from "./helpers/fact-db.ts";

const AT = "2026-10-20T07:00:00.000Z", NOW = "2026-10-20T07:01:00.000Z";
const PROFILE = "https://council.example.gov/ada", SOURCE = "https://council.example.gov/statements/budget";
const PERSON = "person:ada", MEMBER = "member:ada", PLACE = "ocd-division/country:us/state:az/place:example", BODY = `${PLACE}#council`;
const profile = '<main><h1>Ada Sample</h1><p>Phone: 520-555-0123</p><ul>' +
  '<li><time datetime="2026-10-19">October 19</time><a href="/statements/budget">Statement on the budget</a></li>' +
  '<li><time datetime="2026-10-19">October 19</time><a href="/remarks/parks">Remarks on parks</a></li></ul></main>';
const article = '<main><h1>Budget statement</h1><article><time datetime="2026-10-18">October 18</time>' +
  '<blockquote>Our public budget will fund the library.</blockquote><cite>Ada Sample</cite></article></main>';

async function fixture() {
  const repos = createMemoryRepositories(), vault = new MemoryEvidenceStore(), facts = await factDb();
  const item = createWorkItem({ project: "freshness", subject: MEMBER, obligation: "Read held official details", why: "Details remain owed",
    contract: { requiresValidation: false, requiresAudit: false }, now: AT });
  await registerWorkItem(repos, item, AT);
  const route = createRouteTask({ workItemId: item.id, routeId: "held-subject-details:profile", routeLabel: "Own profile", target: PROFILE, inherited: false, now: AT });
  await registerRouteTask(repos, route, AT);
  const claim = await claimRouteTask(repos, { routeTaskId: route.id, holder: "profile-source", now: AT, ttlMs: 60_000 });
  const attempt = await beginAttemptFor(repos, { workItemId: item.id, routeTaskId: route.id, lease: claim.lease.value, now: AT,
    methodVersion: 1, policyVersion: FLEET_POLICY_VERSION, worker: { role: "ACQUIRER", provider: "fixture", version: "1", instance: "profile-source" } });
  const { artifact } = recordAcquisition({ canonicalUrl: PROFILE, retrievedAt: AT, httpStatus: 200, contentType: "text/html",
    sourceId: new URL(PROFILE).hostname, methodRouteId: route.routeId, workItemId: item.id, attemptId: attempt.id,
    permission: "ALLOWED", transport: "REACHABLE" }, profile);
  await putArtifact(vault, item.project, artifact, Buffer.from(profile));
  await recordArtifactMetadata(repos, { artifactId: artifact.id, workItemId: item.id, routeTaskId: route.id, attemptId: attempt.id,
    tier: artifact.tier, contentHash: artifact.contentHash, byteLength: artifact.byteLength, contentType: artifact.contentType,
    canonicalUrl: PROFILE, partial: false, recordedAt: AT }, AT);
  await disposeRouteTask(repos, { routeTaskId: route.id, attemptId: attempt.id, now: AT,
    expectedTaskRevision: (await repos.routeTasks.mustRead(route.id)).revision, artifactIds: [artifact.id],
    disposition: { disposition: "INGESTED", attemptId: attempt.id, at: AT, artifactIds: [artifact.id], observation: null,
      permission: "ALLOWED", transport: "REACHABLE", note: "Acquired own profile" } });
  let requests = 0, loads = 0, read: typeof fetch = async resource => {
    assert.equal(String(resource), SOURCE); return new Response(article, { status: 200, headers: { "content-type": "text/html" } });
  };
  let sizeFor: () => { kind: "local-government"; population: number } | null = () => null;
  const db = { ...facts, query: async (text: string, params: readonly unknown[] = []) => {
    if (text !== HELD_SUBJECT_SQL) return facts.query(text, params);
    loads++; assert.deepEqual(params, ["AZ", MEMBER, NOW]);
    return [{ body: { id: BODY, name: "Council", bodyClass: "CITY_COUNCIL", ocdId: PLACE, provenance: { sourceUrl: PROFILE, collectedAt: AT } },
      roster: { bodyId: BODY, bodyName: "Council", sourceUrl: PROFILE, sourceOrg: "Council", collectedAt: AT,
        members: [{ id: MEMBER, personId: PERSON, name: "Ada Sample", officeTitle: "Councilmember", websiteUrl: PROFILE }] },
      executive: null, bridge: null, government: null, person: null, state_division: "ocd-division/country:us/state:az", checked: AT }];
  } };
  const runtime: FleetRuntime = { repos, methodVersion: 1, now: () => NOW,
    readEvidence: async () => { throw Error("GENERAL_PIPELINE_UNUSED"); }, independentContext: async () => { throw Error("NO_MODEL"); },
    roleExecutor: (task, holder) => productionHeldSubjectDetailsExecutor({ repos, vault, db, now: () => NOW,
      purge: async () => ({ purged: true }), sleep: async () => {}, sizeFor: () => sizeFor(),
      fetchImpl: async (...args) => { requests++; return read(...args); } }, task, holder) };
  const parent = await enqueueHeldSubjectDetails(repos, { workItemId: item.id, sourceRouteTaskId: route.id, artifactId: artifact.id,
    state: "AZ", methodVersion: 1, now: NOW });
  assert.ok(parent);
  const parentResult = await dispatchWorkerTask(runtime, parent);
  assert.equal(parentResult.outcome, "WORKED", parentResult.detail);
  const children = (await repos.routeTasks.list()).map(row => row.value).filter(isHeldSubjectLinkedSourceTask);
  const child = children.find(task => task.workerTask!.acquisition!.route.url === SOURCE);
  assert.ok(child);
  return { repos, vault, facts, runtime, item, route, artifact, parent, child, children,
    requests: () => requests, loads: () => loads, setRead: (next: typeof fetch) => { read = next; },
    smallPublisher: () => { sizeFor = () => ({ kind: "local-government", population: 1000 }); } };
}

test("each exact profile statement link becomes one same-official lease and its HTTP capture publishes a verified fact with the missing reader edge named", async () => {
  const f = await fixture();
  try {
    assert.equal(f.children.length, 2);
    assert.equal(new Set(f.children.map(task => task.id)).size, 2);
    assert.ok(f.children.every(task => task.workItemId === f.item.id && task.workerTask!.contract.subjectId === MEMBER));
    assert.equal(f.requests(), 0, "the profile publisher queues sources without walking them in one worker");
    const result = await dispatchWorkerTask(f.runtime, f.child);
    assert.equal(result.outcome, "WORKED", result.detail);
    assert.equal(f.requests(), 1); assert.equal(result.cost?.requestCount, 1);
    assert.equal(result.cost?.bytesFetched, Buffer.byteLength(article)); assert.equal(result.cost?.usd, 0);
    assert.equal(f.loads(), 2, "one exact held official is loaded in each independent worker");
    const statements = await f.facts.query("SELECT value FROM fact WHERE entity_id=$1 AND field LIKE 'statement:%' AND status='live'", [PERSON]);
    assert.equal(statements.length, 1);
    const snapshot = statements[0]!.value as { subjectId: string; url: string; postedOn: string; retrievedAt: string; text: string };
    assert.match(result.detail, /Missing reader edges remain owed/);
    assert.match(result.detail, /lib\/corpus\/data-plane.ts/);
    assert.equal(snapshot.subjectId, PERSON); assert.equal(snapshot.url, SOURCE);
    assert.equal(snapshot.postedOn, "2026-10-18", "the article's date wins over the referrer's October 19 label");
    assert.equal(snapshot.retrievedAt, NOW); assert.equal(snapshot.text, "Our public budget will fund the library.");
    assert.equal((await f.facts.query("SELECT count(*)::int n FROM fact WHERE entity_id=$1 AND field='phone' AND status='live'", [PERSON]))[0]!.n, 1);
    const results = await f.repos.workerResults.read(f.item.id), saved = results.find(row => row.routeTaskId === f.child.id)!;
    assert.deepEqual(saved.inputArtifactIds, [f.artifact.id]);
    assert.equal(saved.result.role, "ACQUIRER");
    if (saved.result.role === "ACQUIRER") {
      assert.equal(saved.result.source.publisherSubjectEvidence[0]!.contentHash, f.artifact.contentHash);
      assert.equal(saved.result.artifacts[0]!.retrievedAt, NOW);
      assert.equal(saved.result.artifacts[0]!.reused, false);
    }
    const original = (await f.repos.artifacts.readWhere(f.item.id, ["artifactId"], f.artifact.id))[0]!;
    assert.equal(original.recordedAt, AT);
    assert.equal((await f.repos.routeTasks.mustRead(f.child.id)).value.state, "RESULT_RECORDED");
  } finally { await f.facts.pg.close(); }
});

test("a forged link cannot spend a request or publish before the exact saved referrer binding is re-extracted", async () => {
  const f = await fixture();
  try {
    const row = await f.repos.routeTasks.mustRead(f.child.id), spec = row.value.workerTask!;
    await f.repos.routeTasks.compareAndSet(row.id, row.revision, { ...row.value, workerTask: { ...spec,
      acquisition: { ...spec.acquisition!, route: { ...spec.acquisition!.route, observation: { ...spec.acquisition!.route.observation, quote: "invented referrer" } } } } }, NOW);
    const result = await dispatchWorkerTask(f.runtime, (await f.repos.routeTasks.mustRead(f.child.id)).value);
    assert.equal(result.outcome, "FAILED"); assert.match(result.detail, /HELD_LINK_NOT_IN_ORIGINAL_PROFILE/);
    assert.equal(f.requests(), 0); assert.equal(result.cost?.requestCount, 0);
    assert.equal((await f.facts.query("SELECT field FROM fact WHERE entity_id=$1 AND field LIKE 'statement:%' AND status='live'", [PERSON])).length, 0);
  } finally { await f.facts.pg.close(); }
});

test("a failed linked response stays owed with its actual cost and preserves previously attached profile contact", async () => {
  const f = await fixture();
  try {
    f.setRead(async () => new Response("Not served", { status: 404, headers: { "content-type": "text/html" } }));
    const result = await dispatchWorkerTask(f.runtime, f.child);
    assert.equal(result.outcome, "FAILED"); assert.match(result.detail, /HELD_LINK_ACQUISITION_FAILED/);
    assert.equal(result.cost?.requestCount, 1); assert.equal(result.cost?.bytesFetched, Buffer.byteLength("Not served"));
    assert.equal((await f.facts.query("SELECT value FROM fact WHERE entity_id=$1 AND field='phone' AND status='live'", [PERSON]))[0]!.value, "520-555-0123");
    assert.equal((await f.facts.query("SELECT field FROM fact WHERE entity_id=$1 AND field LIKE 'statement:%' AND status='live'", [PERSON])).length, 0);
  } finally { await f.facts.pg.close(); }
});

test("shared small-publisher allowance defers a linked source before HTTP instead of resetting with each child", async () => {
  const f = await fixture();
  try {
    f.smallPublisher();
    for (let n = 0; n < 10; n++) await f.repos.websitePacing.take("council.example.gov", 10, Date.parse(NOW));
    const result = await dispatchWorkerTask(f.runtime, f.child);
    assert.equal(result.outcome, "FAILED"); assert.match(result.detail, /WEBSITE_REQUEST_CAP/);
    assert.equal(f.requests(), 0); assert.equal(result.cost?.requestCount, 0); assert.equal(result.cost?.bytesFetched, 0);
  } finally { await f.facts.pg.close(); }
});

test("a linked article without its own exact speaker stays owed while its real captured evidence and profile contact survive", async () => {
  const f = await fixture(), foreignArticle = article.replace("<cite>Ada Sample</cite>", "<cite>Another Official</cite>");
  try {
    f.setRead(async () => new Response(foreignArticle, { status: 200, headers: { "content-type": "text/html" } }));
    const result = await dispatchWorkerTask(f.runtime, f.child);
    assert.equal(result.outcome, "FAILED"); assert.match(result.detail, /ARTICLE_SPEAKER_OR_DATE_NOT_VERIFIED/);
    assert.equal(result.cost?.requestCount, 1); assert.equal(result.cost?.bytesFetched, Buffer.byteLength(foreignArticle));
    assert.equal((await f.facts.query("SELECT field FROM fact WHERE entity_id=$1 AND field LIKE 'statement:%' AND status='live'", [PERSON])).length, 0);
    assert.equal((await f.facts.query("SELECT value FROM fact WHERE entity_id=$1 AND field='phone' AND status='live'", [PERSON]))[0]!.value, "520-555-0123");
    const acquired = await f.repos.artifacts.readWhere(f.item.id, ["routeTaskId"], f.child.id);
    assert.equal(acquired.length, 1); assert.equal(acquired[0]!.recordedAt, NOW);
  } finally { await f.facts.pg.close(); }
});

test("a cross-origin redirect is refused before another host is sent a request", async () => {
  const f = await fixture();
  try {
    f.setRead(async () => new Response("Moved", { status: 302, headers: { location: "https://foreign.example.org/release" } }));
    const result = await dispatchWorkerTask(f.runtime, f.child);
    assert.equal(result.outcome, "FAILED"); assert.match(result.detail, /HELD_LINK_REDIRECT_ORIGIN_REFUSED/);
    assert.equal(f.requests(), 1); assert.equal(result.cost?.requestCount, 1); assert.equal(result.cost?.bytesFetched, 5);
  } finally { await f.facts.pg.close(); }
});

test("a same-origin observed redirect retains its real final URL and the article's own source evidence", async () => {
  const f = await fixture(), finalUrl = "https://council.example.gov/releases/actual-budget";
  try {
    f.setRead(async resource => String(resource) === SOURCE
      ? new Response("Moved", { status: 302, headers: { location: finalUrl } })
      : new Response(article, { status: 200, headers: { "content-type": "text/html" } }));
    const result = await dispatchWorkerTask(f.runtime, f.child);
    assert.equal(result.outcome, "WORKED", result.detail);
    assert.equal(result.cost?.requestCount, 2); assert.equal(result.cost?.bytesFetched, 5 + Buffer.byteLength(article));
    const snapshot = (await f.facts.query("SELECT value FROM fact WHERE entity_id=$1 AND field LIKE 'statement:%' AND status='live'", [PERSON]))[0]!.value as { url: string; retrievedAt: string };
    assert.equal(snapshot.url, finalUrl); assert.equal(snapshot.retrievedAt, NOW);
    const copy = (await f.facts.query("SELECT url,final_url FROM source_copy WHERE final_url=$1", [finalUrl]))[0]!;
    assert.equal(copy.url, finalUrl); assert.equal(copy.final_url, finalUrl);
  } finally { await f.facts.pg.close(); }
});
