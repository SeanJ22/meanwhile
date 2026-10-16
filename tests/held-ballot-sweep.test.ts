import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import type { ArtifactRecord, ControlPlaneRepositories } from "../lib/control-plane/repository/types.ts";
import type { WorkItem } from "../lib/control-plane/work-item.ts";
import type { CandidateVersionRecord, PromotedProjection } from "../lib/civic-data/types.ts";
import { readRegistryRuntimePrior } from "../lib/registry/runtime-data-plane.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { publishHeldElectionOffices, readHeldInputs, readHeldPointerTimes } from "../lib/civic-data/worker-held-elections.ts";
import { HELD_BALLOT_BATCH, workerPublicationTasks, type HeldInputs, type WorkerPublicationItem } from "../lib/civic-data/worker-publication-tasks.ts";
import { readPublishNowWorkerTasks } from "../lib/civic-data/publish-now.ts";
import type { WorkerPublicationCapture } from "../lib/civic-data/worker-roster-publication.ts";

const CHECKED = "2026-10-14T03:00:00.000Z";
const NEXT_HOUR = "2026-10-14T04:05:00.000Z";
const BEFORE = "2026-10-14T02:00:00.000Z";
const AFTER = "2026-10-14T03:30:00.000Z";

/* The 13 Oct sweep: 1,809 held ballot routes over 603 places, each last read with nothing on its saved pages. */
const route = (n: number, code = "ELECTION_OFFICE_NOT_ON_SAVED_PAGES"): WorkerPublicationItem => ({
  id: `wi-ballot-${String(n).padStart(4, "0")}`, subject: `place-${n % 603}`,
  autonomousPlan: { contract: { recordClass: "VOTER_ACCESS_ROUTE" }, publication: { contractId: "ballot-navigation" } },
  publicationOutcome: { workerResultId: "held:election-offices", status: "HELD", at: CHECKED, recovery: "WORKER", code },
});
const sweep = Array.from({ length: 1809 }, (_, n) => route(n));
const unchanged: HeldInputs = { pagesAt: new Map(Array.from({ length: 603 }, (_, n) => [`place-${n}`, BEFORE])), bodyPagesAt: new Map(), nationalAt: BEFORE, registryAt: BEFORE, routesAt: BEFORE };
const ids = (tasks: ReturnType<typeof workerPublicationTasks>) => tasks.flatMap(task => task.command.at(-1)!.replace(/^--worker-results=/, "").split(","));

test("a held ballot route is read again only when its saved pages or inputs changed since its last outcome, in batches", () => {
  assert.equal(workerPublicationTasks(sweep, [], NEXT_HOUR).length, 1809, "before: every route, one child each, every hour");
  assert.equal(workerPublicationTasks(sweep, [], NEXT_HOUR, unchanged).length, 0, "nothing changed: nothing is read");

  const pages = new Map(unchanged.pagesAt);
  for (const place of ["place-1", "place-2", "place-3"]) pages.set(place, AFTER);
  const three = workerPublicationTasks(sweep, [], NEXT_HOUR, { ...unchanged, pagesAt: pages });
  assert.equal(three.length, 1, "one child for every route whose pages changed");
  assert.deepEqual(ids(three).sort(), sweep.filter(item => ["place-1", "place-2", "place-3"].includes(item.subject!)).map(item => item.id).sort());

  assert.equal(workerPublicationTasks(sweep, [], NEXT_HOUR, { ...unchanged, nationalAt: AFTER }).length, Math.ceil(1809 / HELD_BALLOT_BATCH),
    "a new national office list is an input of every route");
  const all = workerPublicationTasks(sweep, [], NEXT_HOUR, { ...unchanged, nationalAt: AFTER });
  assert.ok(all.every(task => ids([task]).length <= HELD_BALLOT_BATCH));
  assert.equal(new Set(all.map(task => task.id)).size, all.length);
  assert.equal(new Set(ids(all)).size, 1809);

  const mixed = [route(1), route(2, "CANONICAL_BODY_MISSING"), route(3, "MANUAL_PROMOTION_BASE_PROOF_INVALID")];
  assert.deepEqual(ids(workerPublicationTasks(mixed, [], NEXT_HOUR, { ...unchanged, registryAt: AFTER })), [mixed[1]!.id, mixed[2]!.id],
    "a new registry can clear a missing division or our own publication hold, never a page that names no office");
  assert.deepEqual(ids(workerPublicationTasks(mixed, [], NEXT_HOUR, { ...unchanged, routesAt: AFTER })), [mixed[2]!.id],
    "a new published version is an input only of a hold in our own publication step");
  const fresh = { ...route(4), publicationOutcome: undefined };
  assert.deepEqual(ids(workerPublicationTasks([fresh], [], NEXT_HOUR, unchanged)), [fresh.id], "a route never read is read");
});

test("routes read in pages still share batches across pages", async () => {
  const tasks = await readPublishNowWorkerTasks(sweep, async () => [], NEXT_HOUR, { ...unchanged, nationalAt: AFTER });
  assert.equal(tasks.length, Math.ceil(1809 / HELD_BALLOT_BATCH));
});

test("the inputs are two grouped reads and two pointers, never a work item's value", async () => {
  const statements: string[] = [];
  const query = async (sql: string, params: readonly unknown[]) => {
    statements.push(sql);
    if (/GROUP BY/.test(sql)) return (params[0] as string[]).slice(0, 2).map(key => ({ key, at: new Date(AFTER) }));
    return [{ at: BEFORE }];
  };
  const inputs = await readHeldInputs(query, await readHeldPointerTimes(query, async recordClass => recordClass === "REGISTRY_RUNTIME_BINDING" ? BEFORE : null), sweep);
  assert.equal(statements.length, 3, "603 places in two pages of the grouped read, and the national list");
  assert.ok(statements.every(sql => !/SELECT\s+(?:\*|[\w.]*value\s*(?:,|FROM))/i.test(sql)));
  assert.equal(inputs.pagesAt.get("place-0"), AFTER);
  assert.deepEqual([inputs.nationalAt, inputs.registryAt, inputs.routesAt], [BEFORE, BEFORE, null]);
});

test("a batch reads each place once, narrowed, several places at a time", async () => {
  const { record, projection } = JSON.parse(gunzipSync(readFileSync("tests/fixtures/registry-transfer-import.json.gz")).toString("utf8")) as { record: CandidateVersionRecord; projection: PromotedProjection };
  const store = new MemoryRoutineDataStore();
  Object.assign(store, { candidates: new Map([[record.candidate.id, record]]), promotions: new Map([[projection.key, projection]]) });
  const registry = (await readRegistryRuntimePrior(store, CHECKED))!;
  const bodies = registry.payload.registry.bodies.filter(body => body.ocdId?.startsWith("ocd-division/country:us/state:az/")).slice(0, 12);
  const repos = createMemoryRepositories();
  const owed: string[] = [];
  for (const [n, body] of bodies.entries()) {
    for (const copy of [0, 1, 2]) {
      const id = `wi-${n}-${copy}`;
      owed.push(id);
      await repos.workItems.put(id, { id, subject: `place-${n}`, transitions: Array(200).fill({ at: CHECKED, note: "history the sweep never needs" }),
        autonomousPlan: { contract: { subjectId: `place-${n}` }, publication: { bodyId: body.id } } } as unknown as WorkItem, CHECKED);
    }
    const text = `<html><title>Parks</title><p>place ${n}</p></html>`;
    const artifact: ArtifactRecord = { artifactId: `ar-${n}`, workItemId: `wi-${n}-0`, routeTaskId: null, attemptId: "at", tier: "RAW",
      contentHash: `sha256-${createHash("sha256").update(text).digest("hex")}`, byteLength: text.length, contentType: "text/html",
      canonicalUrl: `https://place-${n}.example.gov/parks`, partial: false, recordedAt: CHECKED };
    await repos.artifacts.append(artifact.workItemId, artifact.artifactId, artifact, CHECKED);
  }
  const calls = { listWhere: 0, listWhereNarrowed: 0, read: 0 };
  const counted: ControlPlaneRepositories = { ...repos, workItems: { ...repos.workItems,
    listWhere: (...args) => { calls.listWhere++; return repos.workItems.listWhere(...args); },
    listWhereNarrowed: (...args) => { calls.listWhereNarrowed++; return repos.workItems.listWhereNarrowed(...args); },
    read: (...args) => { calls.read++; return repos.workItems.read(...args); } } };
  let reading = 0, most = 0;
  const outcomes = await publishHeldElectionOffices({ repos: counted, store, workItemIds: owed, now: NEXT_HOUR, readHeld: async (artifact): Promise<WorkerPublicationCapture | null> => {
    reading++; most = Math.max(most, reading);
    await new Promise(resolve => setTimeout(resolve, 5));
    reading--;
    void artifact;
    return null;
  } });
  assert.equal(outcomes.length, owed.length);
  assert.ok(outcomes.every(row => row.outcome.code === "ELECTION_OFFICE_NOT_ON_SAVED_PAGES"));
  assert.deepEqual(calls, { listWhere: 0, listWhereNarrowed: bodies.length, read: 0 }, "each place's work is listed once, narrowed; no whole work item is read for it");
  assert.ok(most > 1 && most <= 8, `${most} places read at once`);
  const written = await repos.workItems.mustRead(owed[0]!);
  assert.equal(written.value.publicationOutcome?.code, "ELECTION_OFFICE_NOT_ON_SAVED_PAGES");
  assert.equal((written.value as unknown as { transitions: unknown[] }).transitions.length, 200, "the outcome write keeps the rest of the item");
});
