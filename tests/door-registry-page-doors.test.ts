import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryRepositories } from "@/lib/control-plane/repository/memory.ts";
import { FRESHNESS_WINDOW_HOURS } from "@/lib/control-plane/promotion/section3.ts";
import { listDoors, applyManualEdit, editableFieldsOf, isDoorRecord } from "@/lib/doors/registry.ts";
import { checkEveryFor, pageAddress, pageDoorDraft, pageDoorId, recordPublishedPages } from "@/lib/doors/page-doors.ts";
import { recordPublishedPageDoor } from "@/lib/civic-data/worker-page-doors.ts";

const READ = "2026-10-04T10:00:00.000Z";
const NOW = "2026-10-04T12:00:00.000Z";
const page = (over: Record<string, unknown> = {}) => ({
  url: "https://www.example.gov/council/members#top?utm_source=x", retrievedAt: READ, recordClass: "OFFICIAL_ROSTER", bodyId: "body-1", foundBy: "SCOUT" as const, ...over,
});

test("a published roster page becomes a page door: host, what it holds, due every freshness window, who found it", async () => {
  const repos = createMemoryRepositories();
  const result = await recordPublishedPages(repos.doors, [page()], NOW);
  assert.deepEqual(result, { created: 1, updated: 0, unchanged: 0, skipped: 0 });
  const [door] = (await listDoors(repos.doors)).doors;
  assert.equal(door.kind, "page");
  assert.deepEqual(door.hosts, ["www.example.gov"]);
  assert.deepEqual(door.holds, ["official-roster"]);
  assert.deepEqual(door.bodyIds, ["body-1"]);
  assert.equal(door.checkEveryMinutes, FRESHNESS_WINDOW_HOURS.OFFICIAL_ROSTER * 60);
  assert.equal(door.config.foundBy, "SCOUT");
  assert.equal(door.lastSuccessAt, READ, "its last good read is when the page was read");
  assert.equal(door.status, "OPEN");
  assert.equal(door.origin, "DERIVED");
});

test("the same page published again changes nothing; a detective re-reading it does not take the credit", async () => {
  const repos = createMemoryRepositories();
  await recordPublishedPages(repos.doors, [page()], NOW);
  const again = await recordPublishedPages(repos.doors, [page({ foundBy: "DETECTIVE", retrievedAt: "2026-10-04T11:00:00.000Z" })], "2026-10-04T13:00:00.000Z");
  assert.equal(again.unchanged, 1);
  const doors = (await listDoors(repos.doors)).doors;
  assert.equal(doors.length, 1);
  assert.equal(doors[0].config.foundBy, "SCOUT");
  assert.equal(doors[0].lastSuccessAt, "2026-10-04T11:00:00.000Z");
});

test("tracking noise and fragments do not make a second door, but a different page does", async () => {
  const a = pageAddress("https://WWW.Example.gov/council/members/?utm_campaign=y&b=2&a=1#x")!;
  const b = pageAddress("https://www.example.gov/council/members?a=1&b=2")!;
  assert.equal(a.url, b.url);
  assert.notEqual(pageDoorId("OFFICIAL_ROSTER", a), pageDoorId("OFFICIAL_ROSTER", pageAddress("https://www.example.gov/council/staff")!));
  assert.notEqual(pageDoorId("OFFICIAL_ROSTER", a), pageDoorId("SERVICE_CONTACT", a));
});

test("a hand edit newer than the reading stands", async () => {
  const repos = createMemoryRepositories();
  await recordPublishedPages(repos.doors, [page()], NOW);
  const [door] = (await listDoors(repos.doors)).doors;
  const edited = applyManualEdit(door, { ...editableFieldsOf(door), checkEveryMinutes: 90 }, "2026-10-04T11:30:00.000Z");
  const row = (await repos.doors.read(door.doorId))!;
  await repos.doors.compareAndSet(door.doorId, row.revision, edited, "2026-10-04T11:30:00.000Z");
  const result = await recordPublishedPages(repos.doors, [page({ retrievedAt: READ })], "2026-10-04T14:00:00.000Z");
  assert.equal(result.unchanged, 1);
  assert.equal((await listDoors(repos.doors)).doors[0].checkEveryMinutes, 90);
});

test("an unknown record class falls back to the default window; addresses that are not web pages add no door", async () => {
  assert.equal(checkEveryFor("SOMETHING_NEW"), 7 * 24 * 60);
  assert.equal(pageDoorDraft(page({ url: "ftp://example.gov/x" })), null);
  assert.equal(pageDoorDraft(page({ url: "not a url" })), null);
  const repos = createMemoryRepositories();
  const result = await recordPublishedPages(repos.doors, [page({ url: "mailto:a@b.gov" })], NOW);
  assert.deepEqual(result, { created: 0, updated: 0, unchanged: 0, skipped: 1 });
  assert.equal((await listDoors(repos.doors)).doors.length, 0);
});

test("the publisher call adds a door only when a fact went live, and names a detective from the attempt that read the page", async () => {
  const repos = createMemoryRepositories();
  const capture = { evidence: { artifactId: "a1", contentHash: "h", text: "", acquiredByAttemptId: "att-1", canonicalUrl: "https://city.example.gov/clerk/contact", retrievedAt: READ, sourceId: "s", methodRouteId: "m" },
    observedAt: READ, httpStatus: 200, transport: "HTTP", partial: false };
  await recordPublishedPageDoor({ repos, page: capture, recordClass: "SERVICE_CONTACT", published: 0, now: NOW });
  assert.equal((await listDoors(repos.doors)).doors.length, 0, "a held reading adds no door");
  await recordPublishedPageDoor({ repos, page: null, recordClass: "SERVICE_CONTACT", published: 3, now: NOW });
  assert.equal((await listDoors(repos.doors)).doors.length, 0);
  await recordPublishedPageDoor({ repos, page: capture, recordClass: "SERVICE_CONTACT", published: 3, now: NOW });
  const [door] = (await listDoors(repos.doors)).doors;
  assert.equal(door.config.foundBy, undefined, "no attempt on record: the finder is left unsaid, not guessed");
  assert.ok(isDoorRecord(door));
  const roles = [["att-d", "DETECTIVE", "https://city.example.gov/clerk/rules"], ["att-p", "PARSER", "https://city.example.gov/clerk/hours"]] as const;
  for (const [id, role, url] of roles) {
    await repos.attempts.put(id, { id, worker: { role, provider: "p", version: "v", instance: "i" } } as never, READ);
    await recordPublishedPageDoor({ repos, page: { ...capture, evidence: { ...capture.evidence, acquiredByAttemptId: id, canonicalUrl: url } }, recordClass: "PUBLIC_COMMENT_RULE", published: 1, now: NOW });
  }
  const byUrl = new Map((await listDoors(repos.doors)).doors.map((d) => [d.config.url, d.config.foundBy]));
  assert.equal(byUrl.get("https://city.example.gov/clerk/rules"), "DETECTIVE");
  assert.equal(byUrl.get("https://city.example.gov/clerk/hours"), "SCOUT");
});
