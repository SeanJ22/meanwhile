import assert from "node:assert/strict";
import test from "node:test";
import { defaultGrant } from "../lib/control-plane/capability.ts";
import { recordAcquisition, type Artifact } from "../lib/control-plane/evidence/artifact.ts";
import { MemoryEvidenceStore, objectKey, putArtifact } from "../lib/control-plane/evidence/store.ts";
import { contentHash } from "../lib/control-plane/ids.ts";
import { carriesCredential } from "../lib/hunt/access-control.ts";
import { buildScoutToolkit } from "../lib/control-plane/scheduler/scout-tools.ts";
import { RESEARCH_BOUNDS } from "../lib/control-plane/scheduler/research-policy.ts";
import { runAcquirer, type AcquirerWorkerInput, type VaultedResearchEvidence } from "../lib/control-plane/workers/acquirer.ts";
import { assertResearchResult, assertResearchWalk, type ResearchSpan } from "../lib/control-plane/workers/research-types.ts";

const NOW = "2026-09-03T18:00:00.000Z";
const PROJECT = "research-fixture";
const HOST = "https://clerk.example.gov";
const URL = `${HOST}/records.json`;
const SOURCE = `<p>The public clerk publishes official records.</p><a href="${URL}">records</a>`;

async function acquirerFixture(options: { body?: string; status?: number; robots?: string; error?: string } = {}) {
  const store = new MemoryEvidenceStore();
  const metadata = new Map<string, Artifact>();
  const seen: string[] = [];
  const headers: Readonly<Record<string, string>>[] = [];
  const put = async (a: Artifact, body: string) => {
    await putArtifact(store, PROJECT, a, new TextEncoder().encode(body));
    // The immutable store retains original attribution on identical-byte retry.
    if (!metadata.has(a.id)) metadata.set(a.id, a);
    return { stored: true, where: objectKey(PROJECT, a), why: "held" };
  };
  const source = recordAcquisition({ canonicalUrl: HOST, retrievalUrl: HOST, retrievedAt: NOW, httpStatus: 200,
    contentType: "text/html", sourceId: "clerk.example.gov", methodRouteId: "source-observed", workItemId: "wi-source",
    attemptId: "at-source", permission: "ALLOWED", transport: "REACHABLE" }, SOURCE).artifact;
  await put(source, SOURCE);
  const span: ResearchSpan = { artifactId: source.id, contentHash: source.contentHash, start: 0, end: SOURCE.length,
    quote: SOURCE, offsetUnit: "UTF16_CODE_UNITS" };
  const input: AcquirerWorkerInput = { attemptId: "at-acquirer", worker: { role: "ACQUIRER", provider: "test", version: "1", instance: "acquirer-test" },
    project: PROJECT, workItemId: "wi-research", grant: defaultGrant({ role: "ACQUIRER", project: PROJECT, policyVersion: "test", grantedAt: NOW }),
    now: () => NOW, held: [], route: { id: "official-records", subjectId: "ocd-division/country:us/state:az/place:fixture",
      jurisdiction: "AZ", recordClass: "OFFICIAL_ROSTER", sourceId: "clerk.example.gov", publisher: "Public clerk",
      url: URL, observedLocator: URL, observedAt: NOW, firstObservedAt: NOW, methodVersion: 1, permission: "ALLOWED",
      observation: span, publisherSubjectEvidence: [span], applicableBecause: "The official publication names the owed record route.", nextRouteIds: ["publisher-index"], retrieval: "fetch_public" } };
  const toolkit = buildScoutToolkit({ obligation: { obligation: { id: "ob", recordClass: "OFFICIAL_ROSTER", subjectId: input.route.subjectId,
    routeId: input.route.id, active: true, readerImpactAt: null, observedChangeRateHours: null, lastWorkedAt: null },
    nextDueAt: NOW, cadenceHours: 24, cadenceSource: "DEFAULT_NO_SIGNAL", basis: "test" }, route: null, providerId: null,
    attemptId: input.attemptId, workItemId: input.workItemId, routeTaskId: "rt-research", holder: "holder", vault: put,
    spaceOut: async () => {}, bound: RESEARCH_BOUNDS.perDispatch, now: input.now, inherited: { artifactIds: [], summary: "" },
    openOne: async ({ url, headers: sent }) => {
      seen.push(url);
      headers.push(sent);
      const robots = url.endsWith("/robots.txt");
      const body = robots ? options.robots ?? "User-agent: *\nDisallow:\n" : options.body ?? '[{"id":"official:clerk","name":"Clerk"}]';
      const error = robots ? null : options.error ?? null;
      return { status: error ? null : robots ? 200 : options.status ?? 200, bytes: Buffer.byteLength(body),
        body, contentType: robots ? "text/plain" : "application/json", transportError: error, durationMs: 1 };
    } });
  const readVault = async (id: string): Promise<VaultedResearchEvidence> => {
    const artifact = metadata.get(id)!;
    const held = await store.get(objectKey(PROJECT, artifact));
    assert.ok(held);
    return { artifact, key: held.key, bytes: held.bytes };
  };
  return { input, runtime: { toolkit, readVault }, seen, headers, store, metadata };
}

test("Hunter reuses shared permission/fetch/vault and an immutable retry keeps exact artifact identity without network", async () => {
  const f = await acquirerFixture();
  const first = await runAcquirer(f.input, f.runtime);
  assert.equal(first.verdict, "ACQUIRED");
  assert.equal(first.sourceGrounding?.verdict, "OBSERVED");
  assert.deepEqual(f.seen, [`${HOST}/robots.txt`, URL]);
  const a = first.artifacts[0];
  assert.equal(a.acquisitionAttemptId, f.input.attemptId);
  assert.equal(contentHash((await f.runtime.readVault(a.artifactId)).bytes), a.contentHash);
  const objectCount = (await f.store.list(`project/${PROJECT}/`)).length;
  const retry = await runAcquirer({ ...f.input, attemptId: "at-retry", held: [{ artifactId: a.artifactId, sourceRouteId: f.input.route.id,
    sourceObservationArtifactId: f.input.route.observation.artifactId, immutable: true, partial: false, currentUntil: "2026-09-04T18:00:00.000Z" }] }, f.runtime);
  assert.equal(retry.verdict, "ACQUIRED");
  assert.equal(retry.artifacts[0].artifactId, a.artifactId);
  assert.equal(retry.artifacts[0].acquisitionAttemptId, f.input.attemptId);
  assert.equal(retry.requestCount, 0);
  assert.equal(f.seen.length, 2);
  assert.equal((await f.store.list(`project/${PROJECT}/`)).length, objectCount);
});

test("Hunter capability and observed-route failures send no network request", async () => {
  const f = await acquirerFixture();
  const denied = await runAcquirer({ ...f.input, grant: { ...f.input.grant, capabilities: ["VAULT_READ_SANITIZED"] } }, f.runtime);
  assert.equal(denied.blockers[0].code, "CAPABILITY_DENIED");
  const invented = await runAcquirer({ ...f.input, route: { ...f.input.route, url: `${HOST}/invented`, observedLocator: `${HOST}/invented` } }, f.runtime);
  assert.equal(invented.blockers[0].code, "UNGROUNDED_ROUTE");
  assert.equal(invented.sourceGrounding?.verdict, "UNPROVEN");
  assert.deepEqual(f.seen, []);
});

test("Hunter records a robots.txt disallow separately from transport and still acquires the public path (owner decision 2026-09-25)", async () => {
  const f = await acquirerFixture({ robots: "User-agent: *\nDisallow: /records.json\n" });
  const r = await runAcquirer(f.input, f.runtime);
  assert.equal(r.verdict, "ACQUIRED", JSON.stringify(r.blockers));
  assert.deepEqual(r.blockers, [], "robots.txt alone never blocks a public page");
  assert.deepEqual(f.seen, [`${HOST}/robots.txt`, URL], "robots.txt is read FIRST, then the page");
  const permissionStep = r.walk.find(s => s.rung === "permission");
  assert.equal(permissionStep?.permission, "DISALLOWED", "the verdict is recorded on the walk");
  assert.equal(permissionStep?.transport, "REACHABLE", "the robots read's transport is its own fact, apart from the verdict");
  assert.equal(r.walk.at(-1)?.permission, "DISALLOWED", "the retrieval step carries the verdict it ran under");
  assert.equal(r.walk.at(-1)?.outcome, "WALKED_AND_FOUND");
  assert.equal(r.artifacts[0].transport, "REACHABLE");
  /* A route whose recorded verdict is already DISALLOWED or CANNOT_TELL is walked as well: no pre-block, no "no request sent". */
  for (const permission of ["DISALLOWED", "CANNOT_TELL"] as const) {
    const g = await acquirerFixture();
    const recorded = await runAcquirer({ ...g.input, route: { ...g.input.route, permission } }, g.runtime);
    assert.equal(recorded.verdict, "ACQUIRED", `${permission}: ${JSON.stringify(recorded.blockers)}`);
    assert.deepEqual(g.seen, [`${HOST}/robots.txt`, URL]);
    assert.ok(!recorded.walk.some(s => /no request sent/.test(s.observed)), permission);
  }
});

test("Hunter meets an access control as a wall: a 403, a bot challenge or a 429 blocks the route by name after one request, and no request carries a credential", async () => {
  for (const [name, options] of [
    ["403", { status: 403, body: "Forbidden" }],
    ["challenge", { status: 200, body: "<html><head><title>Just a moment...</title></head><body>checking your browser</body></html>" }],
    ["429", { status: 429, body: "slow down" }],
  ] as const) {
    const f = await acquirerFixture(options);
    const r = await runAcquirer(f.input, f.runtime);
    assert.equal(r.verdict, "BLOCKED", name);
    assert.equal(r.blockers[0].code, name === "429" ? "RATE_LIMITED" : "PUBLISHER_AUTHENTICATION", name);
    assert.equal(r.artifacts.length, 0, `${name}: nothing behind a wall is accepted as the record`);
    assert.equal(f.seen.filter(u => u === URL).length, 1, `${name}: requested exactly once, never re-sent to push through`);
    assert.equal(r.walkState.state, "OPEN", `${name}: another public route is still owed`);
    assert.equal(f.headers.length, f.seen.length);
    for (const h of f.headers) assert.equal(carriesCredential(h), false, `${name}: ${JSON.stringify(h)}`);
  }
});

test("Hunter partial bytes, publisher zero rows, zero-byte read and transport failure remain distinct", async () => {
  const partial = await acquirerFixture({ status: 206 });
  const pr = await runAcquirer(partial.input, partial.runtime);
  assert.equal(pr.verdict, "PARTIAL");
  assert.equal(pr.artifacts[0].completeness, "PARTIAL");
  const empty = await acquirerFixture({ body: "[]" });
  const er = await runAcquirer(empty.input, empty.runtime);
  assert.equal(er.verdict, "EMPTY");
  assert.equal(er.walkState.state, "OPEN");
  const zero = await acquirerFixture({ body: "" });
  const zr = await runAcquirer(zero.input, zero.runtime);
  assert.equal(zr.verdict, "BLOCKED");
  assert.equal(zr.artifacts.length, 0);
  assert.equal(zr.walk.at(-1)?.outcome, "WALKED_AND_EMPTY");
  const failed = await acquirerFixture({ error: "socket timeout" });
  const fr = await runAcquirer(failed.input, failed.runtime);
  assert.equal(fr.verdict, "BLOCKED");
  assert.equal(fr.artifacts.length, 0);
  assert.equal(fr.walk.at(-1)?.transport, "TIMEOUT");
  assert.equal(fr.walk.at(-1)?.outcome, "BLOCKED");
});

test("Hunter refuses corrupted cache bytes and cannot reuse another project's artifact", async () => {
  const f = await acquirerFixture();
  const first = await runAcquirer(f.input, f.runtime);
  const cached = { artifactId: first.artifacts[0].artifactId, sourceRouteId: f.input.route.id,
    sourceObservationArtifactId: f.input.route.observation.artifactId, immutable: true, partial: false, currentUntil: "2026-09-04T18:00:00.000Z" };
  const read = f.runtime.readVault;
  const corrupt = await runAcquirer({ ...f.input, held: [cached] }, { ...f.runtime, readVault: async id => {
    const h = await read(id); return id === cached.artifactId ? { ...h, bytes: new Uint8Array([1]) } : h;
  } });
  assert.equal(corrupt.verdict, "BLOCKED");
  assert.equal(corrupt.blockers[0].code, "EVIDENCE_IDENTITY_MISMATCH");
  const crossProject = await runAcquirer({ ...f.input, held: [cached] }, { ...f.runtime, readVault: async id => {
    const h = await read(id); return { ...h, key: h.key.replace(PROJECT, "other-project") };
  } });
  assert.equal(crossProject.verdict, "BLOCKED");
  assert.equal(f.seen.length, 2);
});

test("Research result assertions refuse an invented closed walk", () => {
  assert.throws(() => assertResearchWalk([], { state: "CLOSED", applicableRouteIds: ["missing-route"], terminalRepassAt: NOW,
    terminalRepassOutcome: "NO_FURTHER_APPLICABLE_ROUTE", noFurtherRouteReason: "No rows", absenceArgument: "No rows",
    falsificationConditions: ["Another row"], supportingArtifactIds: ["ar-missing"], stuckProtocolStepSequences: [0, 1, 2, 3, 4],
    twoClickStepSequence: 0, expiresAt: "2026-09-04T18:00:00.000Z" }), /UNPROVEN/);
});
