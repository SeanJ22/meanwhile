import { test } from "node:test";
import assert from "node:assert/strict";

import { emptyFieldManual, fieldManualEntryId, foldEntries, type FieldManualEntry, type FieldManualStore } from "../lib/control-plane/field-manual.ts";

const upsert = (store: FieldManualStore, entries: readonly FieldManualEntry[]) => ({ entries: foldEntries([...store.entries, ...entries]) });
import { KNOWLEDGE_SOURCE, learnedRouteIds } from "../lib/method/manual-bridge.ts";
import { knowledgeEntries, methodFixture, methodVersionEntry } from "./method-store-fixture.ts";

test("the fixture folds into the manual with every route kept whole, and routing reads the same routes back", () => {
  const store = methodFixture();
  const entries = knowledgeEntries(store);
  assert.equal(entries.length, store.routes.length);
  assert.ok(entries.every((e) => e.source === KNOWLEDGE_SOURCE && e.id === fieldManualEntryId(KNOWLEDGE_SOURCE, (e.payload as { id: string }).id)));
  const manual = ({ entries: foldEntries(entries) });
  assert.deepEqual([...learnedRouteIds(manual)].sort(), store.routes.map((r) => r.id).sort());
});

test("a route an agent writes as a ROUTE entry is learned on the next read, with no human step", () => {
  const store = methodFixture();
  let manual = ({ entries: foldEntries(knowledgeEntries(store)) });
  assert.equal(learnedRouteIds(manual).has("agent-found-route"), false);
  manual = upsert(manual, [{
    id: fieldManualEntryId("agent", "agent-found-route"), role: "SCOUT", kind: "ROUTE", title: "found by an agent", summary: "x",
    states: [], recordClasses: [], platforms: [], outcome: "YIELDED", url: null, source: "agent", observedAt: "2026-09-29", tier: null,
    payload: { routeId: "agent-found-route" },
  }]);
  assert.equal(learnedRouteIds(manual).has("agent-found-route"), true);
});

test("the method version lives in the manual: the frozen store's number, plus one per route an agent learns, never double counted", async () => {
  const { methodVersionFromManual, readMethodVersion } = await import("../lib/method/manual-bridge.ts");
  const { createMemoryRepositories } = await import("../lib/control-plane/repository/memory.ts");
  const { writeFieldManual } = await import("../lib/control-plane/field-manual.ts");
  const store = methodFixture();
  const agentRoute = (id: string, source = "agent") => ({
    id: fieldManualEntryId(source, id), role: "SCOUT" as const, kind: "ROUTE", title: id, summary: "x", states: [], recordClasses: [], platforms: [],
    outcome: "YIELDED" as const, url: null, source, observedAt: "2026-09-30", tier: null, payload: { routeId: id } });

  assert.equal(methodVersionFromManual(emptyFieldManual()), null, "an unseeded manual says so instead of guessing");
  let manual = ({ entries: foldEntries([...knowledgeEntries(store), methodVersionEntry(store)]) });
  assert.equal(methodVersionFromManual(manual), store.version, "seeded, it equals the file's number");

  manual = upsert(manual, [agentRoute("agent-route-a"), agentRoute("agent-route-b")]);
  assert.equal(methodVersionFromManual(manual), store.version + 2);
  manual = upsert(manual, [{ ...agentRoute("agent-route-a"), summary: "updated in place" }]);
  assert.equal(methodVersionFromManual(manual), store.version + 2, "rewriting a route is not a new route");
  manual = upsert(manual, [agentRoute(store.routes[0]!.id, "another-source")]);
  assert.equal(methodVersionFromManual(manual), store.version + 2, "a route the frozen store already held is not new");

  const repos = createMemoryRepositories();
  assert.equal(await readMethodVersion(repos), null);
  await writeFieldManual(repos, [...knowledgeEntries(store), methodVersionEntry(store), agentRoute("agent-route-a")], "2026-09-30");
  assert.equal(await readMethodVersion(repos), store.version + 1, "read back through the live aggregate");
});

test("the method knowledge the floor reads comes from the manual: every folded route whole, plus whole route records an agent wrote, never a bare pointer", async () => {
  const { methodKnowledgeFromManual, readMethodKnowledge } = await import("../lib/method/manual-bridge.ts");
  const { createMemoryRepositories } = await import("../lib/control-plane/repository/memory.ts");
  const { writeFieldManual } = await import("../lib/control-plane/field-manual.ts");
  const store = methodFixture();
  const seeded = [...knowledgeEntries(store), methodVersionEntry(store)];
  const entry = (id: string, payload: unknown) => ({ id: fieldManualEntryId("agent", id), role: "SCOUT" as const, kind: "ROUTE", title: id, summary: "x", states: [], recordClasses: [],
    platforms: [], outcome: "YIELDED" as const, url: null, source: "agent", observedAt: "2026-09-30", tier: null, payload });
  const whole = { ...store.routes[0]!, id: "agent-whole-route", title: "whole" };

  assert.equal(methodKnowledgeFromManual(emptyFieldManual()), null);
  const manual = ({ entries: foldEntries([...seeded, entry("agent-whole-route", whole), entry("agent-pointer", { routeId: "agent-pointer" })]) });
  const knowledge = methodKnowledgeFromManual(manual)!;
  assert.deepEqual(knowledge.routes.slice(0, store.routes.length), store.routes, "the frozen routes come back exactly as they were stored");
  assert.ok(knowledge.routes.some((r) => r.id === "agent-whole-route"));
  assert.ok(!knowledge.routes.some((r) => r.id === "agent-pointer"), "a pointer is not a route record");
  assert.equal(knowledge.version, store.version + 2, "both agent routes count toward the version, only the whole one is a record");

  const repos = createMemoryRepositories();
  await assert.rejects(readMethodKnowledge(repos), /has not been seeded/);
  await writeFieldManual(repos, seeded, "2026-09-30");
  assert.equal((await readMethodKnowledge(repos)).routes.length, store.routes.length);
});

test("dispatch routes differently after an agent writes a route: UNGRADUATED before, GRADUATED after, no human step", async () => {
  const { methodMaturityFromManual } = await import("../lib/control-plane/scheduler/maturity.ts");
  const { decideExecutor } = await import("../lib/control-plane/scheduler/dispatch.ts");
  const { createMemoryRepositories } = await import("../lib/control-plane/repository/memory.ts");
  const { newFieldManualEntry, writeFieldManual } = await import("../lib/control-plane/field-manual.ts");

  const repos = createMemoryRepositories();
  await assert.rejects(methodMaturityFromManual(repos,["agent-found-route"]), /holds no learned routes/);

  await writeFieldManual(repos, knowledgeEntries(methodFixture()), "2026-09-29");
  repos.fieldManual.select=async()=>{throw new Error("Maturity read route payloads");};
  const before = await methodMaturityFromManual(repos,["agent-found-route"]);
  const descriptor = { executorClass: "BOUNDED_MODEL_WORKER" as const, open: { kind: "HTTP_GET" } };
  assert.equal(decideExecutor({ routeId: "agent-found-route", descriptor, maturity: before }).kind, "BOUNDED_MODEL_WORKER");

  await writeFieldManual(repos, [newFieldManualEntry("agent", "agent-found-route", {
    role: "SCOUT", kind: "ROUTE", title: "found by an agent", summary: "answers with the agenda list", outcome: "YIELDED",
    payload: { routeId: "agent-found-route" },
  })], "2026-09-29");

  const after = await methodMaturityFromManual(repos,["agent-found-route"]);
  assert.equal(decideExecutor({ routeId: "agent-found-route", descriptor, maturity: after }).kind, "DETERMINISTIC");
});
