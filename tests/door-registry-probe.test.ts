import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryRepositories } from "@/lib/control-plane/repository/memory.ts";
import { firstLook, probeDoors, probeUrlFor, recordProbe, type ProbeFetch } from "@/lib/doors/probe.ts";
import { checkDoorDraft, applyManualEdit, type DoorRecord } from "@/lib/doors/registry.ts";

const T = (n: number) => `2026-10-04T1${n}:00:00.000Z`;

function door(id: string, url: string): DoorRecord {
  const c = checkDoorDraft({ doorId: id, kind: "ical", hosts: ["feeds.example.gov"], config: { feedUrl: url }, holds: ["meetings"] });
  if (!c.ok) throw new Error(c.why);
  return applyManualEdit(null, c.value, T(0));
}

/** A feed served from memory that counts every request it gets. */
function feed(body: () => string, etag: (() => string | null) | null) {
  const log: Record<string, string>[] = [];
  const fetchFn: ProbeFetch = async (_url, headers) => {
    log.push({ ...headers });
    const tag = etag?.() ?? null;
    if (tag !== null && headers["If-None-Match"] === tag) return { status: 304, headers: { get: () => null }, bytes: async () => new Uint8Array() };
    return { status: 200, headers: { get: (n) => (n.toLowerCase() === "etag" ? tag : null) }, bytes: async () => new TextEncoder().encode(body()) };
  };
  return { fetchFn, log };
}

test("with an ETag, no change is one conditional request and a change is a full look", async () => {
  let body = "v1";
  const server = feed(() => body, () => `"${body}"`);
  const first = await firstLook("https://feeds.example.gov/a.ics", null, server.fetchFn, T(1));
  assert.equal(first.verdict, "CHANGED", "nothing earlier to compare with");
  const same = await firstLook("https://feeds.example.gov/a.ics", first.validators, server.fetchFn, T(2));
  assert.equal(same.verdict, "UNCHANGED");
  assert.equal(server.log.at(-1)!["If-None-Match"], '"v1"', "it asked conditionally");
  assert.equal(same.requests, 1);
  body = "v2";
  const changed = await firstLook("https://feeds.example.gov/a.ics", same.validators, server.fetchFn, T(3));
  assert.equal(changed.verdict, "CHANGED");
  assert.equal(changed.validators?.changedAt, T(3));
});

test("with no validators the bytes are hashed", async () => {
  let body = "v1";
  const server = feed(() => body, null);
  const a = await firstLook("https://feeds.example.gov/a.ics", null, server.fetchFn, T(1));
  const b = await firstLook("https://feeds.example.gov/a.ics", a.validators, server.fetchFn, T(2));
  assert.equal(b.verdict, "UNCHANGED");
  assert.equal(b.validators?.changedAt, T(1), "an unchanged look keeps when it last changed");
  body = "v2";
  assert.equal((await firstLook("https://feeds.example.gov/a.ics", b.validators, server.fetchFn, T(3))).verdict, "CHANGED");
});

test("one probe covers every door behind one feed, and a failure is never read as 'unchanged'", async () => {
  const server = feed(() => "x", null);
  const doors = [door("d1", "https://feeds.example.gov/a.ics"), door("d2", "https://feeds.example.gov/a.ics"), door("d3", "https://feeds.example.gov/b.ics")];
  const results = await probeDoors(doors, server.fetchFn, T(1));
  assert.equal(server.log.length, 2, "two feeds, two requests, three doors");
  assert.equal([...results.values()].reduce((n, r) => n + r.requests, 0), 2);

  const failing: ProbeFetch = async () => ({ status: 503, headers: { get: () => null }, bytes: async () => new Uint8Array() });
  assert.equal((await firstLook("https://feeds.example.gov/a.ics", null, failing, T(1))).verdict, "FAILED");
  const throwing: ProbeFetch = async () => { throw new Error("boom"); };
  assert.equal((await firstLook("https://feeds.example.gov/a.ics", null, throwing, T(1))).verdict, "FAILED");

  const noUrl = checkDoorDraft({ doorId: "d9", kind: "x", config: { slug: "s" } });
  if (!noUrl.ok) throw new Error(noUrl.why);
  assert.equal(probeUrlFor(applyManualEdit(null, noUrl.value, T(0))), null);
});

test("what a look saw is stored on the door and is not a hand edit", async () => {
  const repos = createMemoryRepositories();
  const d = door("d1", "https://feeds.example.gov/a.ics");
  await repos.doors.put(d.doorId, d, T(0));
  const server = feed(() => "x", null);
  const result = (await probeDoors([d], server.fetchFn, T(1))).get("d1")!;
  assert.equal(await recordProbe(repos.doors, "d1", result, T(1)), true);
  const stored = (await repos.doors.read("d1"))!.value;
  assert.equal(stored.validators?.checkedAt, T(1));
  assert.equal(stored.editedAt, T(0), "the hand-edit time did not move");
  const next = await firstLook("https://feeds.example.gov/a.ics", stored.validators, server.fetchFn, T(2));
  assert.equal(next.verdict, "UNCHANGED");
});
