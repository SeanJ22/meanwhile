import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryRepositories } from "@/lib/control-plane/repository/memory.ts";
import type { ScoutResult } from "@/lib/control-plane/scheduler/scout-result.ts";
import { recordFoundSources, recordPublishedPages } from "@/lib/doors/page-doors.ts";
import { applyDerivedRow, applyManualEdit, editableFieldsOf, isDoorRecord, listDoors, type DoorRecord, type DoorRepository } from "@/lib/doors/registry.ts";
import { doorSyncLine, readDoorImport, seedAllDoors, syncHeldDoors } from "@/lib/doors/seed-all.ts";

const AT = "2026-10-05T16:00:00.000Z";
const LATER = "2026-10-05T16:05:00.000Z";

/** Hands every stored value back with its keys in reverse order, as a JSON column may. */
function reordering(repo: DoorRepository): DoorRepository {
  const flip = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(flip);
    if (value === null || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).reverse().map(([k, v]) => [k, flip(v)]));
  };
  return Object.assign(Object.create(repo) as DoorRepository, {
    read: async (id: string) => {
      const row = await repo.read(id);
      return row === null ? null : { ...row, value: flip(row.value) as DoorRecord };
    },
    list: async () => (await repo.list()).map((row) => ({ ...row, value: flip(row.value) as DoorRecord })),
  });
}

function scout(over: Partial<ScoutResult>): ScoutResult {
  return {
    formatVersion: 1, attemptId: "at-1", obligationId: "ob-1", routeTaskId: "rt-1", workItemId: "wi-1", subjectId: "s", routeId: null,
    recordClass: "local-jurisdiction", providerId: null, reason: "", outcome: "ROUTE_CANDIDATE", stoppedBy: "MODEL", rungs: [], distinctEvidenceRungs: 0,
    candidates: [], findings: [], nextRungs: [], unverified: [], narrative: "", worker: { provider: "anthropic", model: "m", modelReported: null },
    usage: {} as ScoutResult["usage"], usd: 0, elapsedMs: 0, artifactIds: [], methodCandidateIds: [], refusal: null,
    startedAt: AT, recordedAt: AT, ...over,
  } as ScoutResult;
}

const candidate = (url: string, recordClass = "local-jurisdiction") =>
  ({ routeId: "r", title: "t", url, procedure: "GET", relevance: "", permission: "ALLOWED", permissionReading: "", evidenceArtifactIds: [], observedOn: "2026-10-05", recordClass, deterministic: true, unverified: [] });

test("every pass brings the held doors into an empty registry with no switch, and a second pass writes nothing", async () => {
  const repos = createMemoryRepositories();
  const first = await syncHeldDoors(repos.doors, { now: AT });
  assert.equal(first.synced, true);
  const held = (await listDoors(repos.doors)).doors.length;
  assert.ok(held > 100, `held ${held}`);
  assert.ok(first.synced && first.result.total === held);
  const second = await syncHeldDoors(reordering(repos.doors), { now: LATER });
  assert.ok(second.synced);
  const { imported, meetings, feeds, routeHints } = second.result;
  assert.deepEqual([imported.created + meetings.created + feeds.created + routeHints.created, imported.updated + meetings.updated + feeds.updated + routeHints.updated], [0, 0],
    "settings handed back in another key order are the same settings");
  assert.match(doorSyncLine(second), new RegExp(`^${held} doors held; 0 added, 0 updated this pass; door import: 0 added, 0 updated, ${imported.unchanged} already there, 0 kept their hand edit$`));
});

test("a door that left the registry comes back on the next pass", async () => {
  const repos = createMemoryRepositories();
  await syncHeldDoors(repos.doors, { now: AT });
  const before = (await listDoors(repos.doors)).doors;
  const gone = before.find((door) => door.kind === "route-hints")!;
  const rows = (await repos.doors.list()).filter((row) => row.id !== gone.doorId);
  const fresh = createMemoryRepositories();
  for (const row of rows) await fresh.doors.put(row.id, row.value, AT);
  const out = await syncHeldDoors(fresh.doors, { now: LATER });
  assert.ok(out.synced && out.result.routeHints.created === 1);
  assert.equal((await listDoors(fresh.doors)).doors.length, before.length);
});

test("key order alone never counts as a change", () => {
  const draft = { doorId: "d", kind: "ical", ocdId: null, bodyIds: [], hosts: ["a.gov"], config: { icalUrl: "https://a.gov/c.ics", jurisdiction: "A" },
    holds: ["meetings"], checkEveryMinutes: 60, notes: "", meeting: null, status: "OPEN" as const, readNow: false };
  const stored = applyDerivedRow(null, draft, AT, AT)!;
  const flipped = { ...stored, config: { jurisdiction: "A", icalUrl: "https://a.gov/c.ics" } };
  assert.equal(applyDerivedRow(flipped, editableFieldsOf(stored), LATER, LATER), null);
});

test("sources a Scout or detective found become doors as they are recorded; refused results add none", async () => {
  const repos = createMemoryRepositories();
  const found = await recordFoundSources(repos.doors, [
    scout({ candidates: [candidate("https://www.cochise.az.gov/elections#x"), candidate("ftp://nope")] as ScoutResult["candidates"] }),
    scout({ researchRole: "DETECTIVE", candidates: [candidate("https://clerk.example.gov/agendas", "meetings")] as ScoutResult["candidates"] }),
    scout({ refusal: [{ code: "SCOUT_NO_TOOL_USED", detail: "y" }] as unknown as ScoutResult["refusal"], candidates: [candidate("https://refused.example.gov/")] as ScoutResult["candidates"] }),
  ], AT);
  assert.deepEqual(found, { created: 2, updated: 0, unchanged: 0, skipped: 1 });
  const doors = (await listDoors(repos.doors)).doors;
  assert.deepEqual(doors.map((door) => [door.kind, door.hosts[0], door.config.foundBy, door.lastSuccessAt]).sort(), [
    ["page", "clerk.example.gov", "DETECTIVE", null],
    ["page", "www.cochise.az.gov", "SCOUT", null],
  ]);
  const page = doors.find((door) => door.hosts[0] === "www.cochise.az.gov")!;
  await recordPublishedPages(repos.doors, [{ url: "https://www.cochise.az.gov/elections", retrievedAt: LATER, recordClass: "local-jurisdiction", foundBy: "DETECTIVE" }], LATER);
  const after = (await repos.doors.read(page.doorId))!.value;
  assert.equal(after.config.foundBy, "SCOUT", "the finder stays the one who found it");
  assert.equal(after.lastSuccessAt, LATER, "a fact from it going live marks it as working");
});

test("sources found before this pass are read from the scout log once, while the registry holds none", async () => {
  const repos = createMemoryRepositories();
  let reads = 0;
  const log = { readAll: async () => { reads += 1; return [scout({ candidates: [candidate("https://a.example.gov/x"), candidate("https://a.example.gov/x")] as ScoutResult["candidates"] })]; } };
  const first = await seedAllDoors({ repo: repos.doors, imported: { generatedAt: AT, rows: [] }, derived: [], scoutResults: log, now: AT });
  assert.equal(first.found?.created, 1);
  const second = await seedAllDoors({ repo: repos.doors, imported: { generatedAt: AT, rows: [] }, derived: [], scoutResults: log, now: LATER });
  assert.equal(second.found, null);
  assert.equal(reads, 1);
  assert.ok((await repos.doors.list()).every((row) => isDoorRecord(row.value)));
});

test("the one-time door import adds every hand-wired door once, and keeps a door edited in the registry since", async () => {
  const repos = createMemoryRepositories();
  const file = readDoorImport();
  // An edit made after the rows were taken from code.
  const EDITED = new Date(Date.parse(file.generatedAt) + 60_000).toISOString();
  assert.ok(file.rows.length > 100, `${file.rows.length} rows`);
  const first = await seedAllDoors({ repo: repos.doors, imported: file, derived: [], now: AT });
  assert.deepEqual(first.imported.refused, []);
  assert.ok(first.imported.created >= file.rows.length, "every row becomes at least one door");
  assert.equal(first.imported.updated, 0);
  const door = (await listDoors(repos.doors)).doors.find((d) => d.meeting != null)!;
  const row = (await repos.doors.read(door.doorId))!;
  await repos.doors.compareAndSet(door.doorId, row.revision, applyManualEdit(door, { ...editableFieldsOf(door), notes: "checked by hand" }, EDITED), EDITED);
  const second = await seedAllDoors({ repo: repos.doors, imported: file, derived: [], now: EDITED });
  assert.equal(second.imported.created, 0);
  assert.equal(second.imported.updated, 0);
  assert.equal(second.imported.unchanged + second.imported.keptManualEdit, first.imported.created);
  assert.equal((await repos.doors.read(door.doorId))!.value.notes, "checked by hand");
});
