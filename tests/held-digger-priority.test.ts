import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { createSourceFile, forEachChild, isVariableDeclaration, isPropertyAssignment, ScriptTarget, ScriptKind, transpileModule, ModuleKind, type Node } from "typescript";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { createWorkItem } from "../lib/control-plane/work-item.ts";
import { occurrenceId, standing } from "../lib/control-plane/scheduler/durable.ts";
import { huntRoundComparator } from "../lib/control-plane/scheduler/shadow-loop.ts";
import { readHeldDiggerWorkItems, readHeldDiggerPriorities, heldDiggerNamedOrder, compareNamedBeforeBackground } from "../lib/control-plane/workers/held-digger-priority.ts";

const AT = "2026-10-20T07:00:00.000Z", LATER = "2026-10-20T08:00:00.000Z";
async function fixture(subject = "official:opaque", recordClass = "held-subject-enrichment") {
  const repos = createMemoryRepositories(), obligationId = `freshness:held:${subject}#profile`;
  const item = createWorkItem({ project: "freshness", subject, obligation: `${obligationId}#1`, why: "Held details remain owed", now: AT });
  const original = standing({ id: obligationId, subjectId: subject, recordClass, routeId: "profile", active: true,
    lastWorkedAt: null, readerImpactAt: null, observedChangeRateHours: null,
    assignments: [{ assignmentKey: "dispatch:one", ref: "old-order", relation: "CREATED", at: AT },
      { assignmentKey: "dispatch:one", ref: "current-order", relation: "REORDERED", at: LATER },
      { assignmentKey: "county:one", ref: "place-order", relation: "REORDERED", at: LATER }] }, AT);
  await repos.obligations.put(original.id, original, AT);
  await repos.occurrences.put(occurrenceId(obligationId, 1), { id: occurrenceId(obligationId, 1), obligationId, sequence: 1,
    dueAt: AT, workItemId: item.id, routeTaskId: "original-http-route", openedAt: AT, closedAt: AT,
    disposition: "INGESTED", unresolvedReason: null }, AT);
  return { repos, item, original };
}

test("exact original deterministic work receives current REORDERED Admin refs without changing its identity, plan or budget", async () => {
  const f = await fixture(), before = JSON.stringify(f.item), reads: string[] = [];
  const repos = { ...f.repos, occurrences: { ...f.repos.occurrences,
    readNarrowed: async (id: string, projection: Parameters<typeof f.repos.occurrences.readNarrowed>[1]) => {
      reads.push(id); return f.repos.occurrences.readNarrowed(id, projection);
    }, list: async () => { throw Error("COUNTRY_OCCURRENCE_READ_FORBIDDEN"); } },
  obligations: { ...f.repos.obligations, list: async () => { throw Error("COUNTRY_OBLIGATION_READ_FORBIDDEN"); } } };
  const map = await readHeldDiggerPriorities({ repos, items: [f.item, f.item] });
  assert.deepEqual(reads, [occurrenceId(f.original.id, 1)]);
  assert.deepEqual(map.get(f.item.id), { originalObligationId: f.original.id,
    assignmentRefs: [{ key: "county:one", ref: "place-order" }, { key: "dispatch:one", ref: "current-order" }] });
  assert.equal(JSON.stringify(f.item), before);
  assert.equal(f.item.autonomousPlan, undefined);
  assert.deepEqual((await f.repos.obligations.mustRead(f.original.id)).value, f.original);
  const row = await f.repos.obligations.mustRead(f.original.id);
  await f.repos.obligations.compareAndSet(row.id, row.revision, { ...row.value, assignments: [...row.value.assignments!,
    { assignmentKey: "dispatch:one", ref: "newer-order", relation: "REORDERED", at: "2026-10-20T09:00:00.000Z" }] }, LATER);
  assert.equal((await readHeldDiggerPriorities({ repos, items: [f.item] })).get(f.item.id)!.assignmentRefs[1]!.ref, "newer-order", "the next invocation does not reuse old order metadata");
});

test("held-only work missing from coordinator selections loads exact narrow metadata before priority ranking", async () => {
  const f = await fixture(), reads: { id: string; projection: unknown }[] = [];
  await f.repos.workItems.put(f.item.id, f.item, AT);
  const repos = { ...f.repos, workItems: { ...f.repos.workItems,
    readNarrowed: async (id: string, projection: Parameters<typeof f.repos.workItems.readNarrowed>[1]) => {
      reads.push({ id, projection }); return f.repos.workItems.readNarrowed(id, projection);
    }, read: async () => { throw Error("FULL_WORK_ITEM_READ_FORBIDDEN"); },
    list: async () => { throw Error("COUNTRY_WORK_ITEMS_READ_FORBIDDEN"); } } };
  const metadata = new Map(await readHeldDiggerWorkItems({ repos, workItemIds: [f.item.id, f.item.id] }));
  assert.deepEqual(reads, [{ id: f.item.id, projection: { id: true, subject: true, project: true,
    obligation: true, autonomousPlan: ["ownerInstructions"] } }]);
  const priorities = await readHeldDiggerPriorities({ repos, items: [...metadata.values()] });
  const order = heldDiggerNamedOrder(priorities.get(f.item.id), { placeOrder: [],
    activeDispatches: [{ key: "dispatch:one", ref: "current-order" }], dispatchPriority: new Set<string>() });
  assert.deepEqual(order, { rank: 0, receiptId: "current-order" });
  assert.equal(compareNamedBeforeBackground(order.rank, Infinity), -1);
});

test("a foreign subject, wrong occurrence owner, non-digger source or absent source gets no invented priority", async () => {
  const f = await fixture(), occurrence = await f.repos.occurrences.mustRead(occurrenceId(f.original.id, 1));
  assert.equal((await readHeldDiggerPriorities({ repos: f.repos, items: [{ ...f.item, subject: "official:other" }] })).size, 0);
  await f.repos.occurrences.compareAndSet(occurrence.id, occurrence.revision, { ...occurrence.value, workItemId: "another-work-item" }, LATER);
  assert.equal((await readHeldDiggerPriorities({ repos: f.repos, items: [f.item] })).size, 0);
  const other = await fixture("source:other", "other-source");
  assert.equal((await readHeldDiggerPriorities({ repos: other.repos, items: [other.item] })).size, 0);
  assert.equal((await readHeldDiggerPriorities({ repos: f.repos, items: [{ ...f.item, obligation: "not-an-occurrence" }] })).size, 0);
});

test("both body and opaque official tasks resolve their real source occurrence while autonomous work keeps its own path", async () => {
  for (const [subject, recordClass] of [["ocd-division/country:us/state:az/county:example#governing", "ask-gap"], ["official:opaque", "held-subject-enrichment"]]) {
    const f = await fixture(subject, recordClass);
    assert.equal((await readHeldDiggerPriorities({ repos: f.repos, items: [f.item] })).get(f.item.id)!.originalObligationId, f.original.id);
    const autonomous = { ...f.item, autonomousPlan: {} as NonNullable<typeof f.item.autonomousPlan> };
    assert.equal((await readHeldDiggerPriorities({ repos: f.repos, items: [autonomous] })).size, 0);
  }
});

test("a standalone actual current direct Send gets the existing HTTP dispatch rank even outside selected places", async () => {
  const f = await fixture(), priority = (await readHeldDiggerPriorities({ repos: f.repos, items: [f.item] })).get(f.item.id);
  const context = { placeOrder: ["some-other-place"], activeDispatches: [{ key: "dispatch:one", ref: "current-order" }], dispatchPriority: new Set<string>() };
  assert.deepEqual(heldDiggerNamedOrder(priority, context), { rank: 1, receiptId: "current-order" });
  assert.deepEqual(heldDiggerNamedOrder(priority, { ...context, placeOrder: ["place-order"] }), { rank: 0, receiptId: "place-order" });
  assert.equal(heldDiggerNamedOrder(priority, { ...context, activeDispatches: [] }).rank, Infinity, "historical assignments cannot select focus themselves");
  assert.equal(heldDiggerNamedOrder(priority, { ...context, activeDispatches: [{ key: "dispatch:one", ref: "old-order" }] }).rank, Infinity);
  assert.equal(heldDiggerNamedOrder(priority, { ...context, activeDispatches: [{ key: "dispatch:different", ref: "current-order" }] }).rank, Infinity, "an equal ref cannot borrow another assignment's scope");
  assert.deepEqual(heldDiggerNamedOrder(priority, { ...context, activeDispatches: [], dispatchPriority: new Set([f.original.id]) }), { rank: 1, receiptId: null }, "current exact matching uses the same fallback as ordinary HTTP placementRank");
});

test("named work precedes every background round while existing round fairness between actual orders stays intact", () => {
  const ids = ["a1", "a2", "b1", "b2", "background1", "background2"];
  const named = (id: string) => id.startsWith("background") ? Infinity : id.startsWith("a") ? 0 : 1;
  const round = huntRoundComparator(ids, id => named(id) === Infinity ? null : id[0]);
  const ordered = [...ids].sort((a, b) => compareNamedBeforeBackground(named(a), named(b)) || round(a, b) || named(a) - named(b));
  assert.deepEqual(ordered, ["a1", "b1", "a2", "b2", "background1", "background2"]);
  assert.equal(compareNamedBeforeBackground(NaN, Infinity), 0);
  assert.equal(compareNamedBeforeBackground(-1, 0), 1);
});


test("the actual standing caller loads held-only identities and both queue paths put current named work first", async () => {
  const f = await fixture();
  const place = createWorkItem({ project: "freshness", subject: "body:current-named-place", obligation: "held-place", why: "Held place", now: AT });
  const background = createWorkItem({ project: "freshness", subject: "official:background", obligation: "background", why: "Background", now: AT });
  for (const item of [f.item, place, background]) await f.repos.workItems.put(item.id, item, AT);
  const tasks = [background, place, f.item].map((item, i) => ({ id: `held-${i}`, workItemId: item.id,
    workerTask: { role: "ACQUIRER", contract: { recordClass: i === 1 ? "HELD_MEETING_DETAILS" : "HELD_SUBJECT_DETAILS" } } }));
  const source = readFileSync(new URL("../scripts/freshness-shadow.mts", import.meta.url), "utf8");
  const parsed = createSourceFile("freshness-shadow.mts", source, ScriptTarget.Latest, true, ScriptKind.TS);
  let queueSource = "", pendingSource = "";
  const visit = (node: Node): void => {
    if (isVariableDeclaration(node) && node.name.getText(parsed) === "readTaskQueue") queueSource = node.initializer!.getText(parsed);
    if (isPropertyAssignment(node) && node.name.getText(parsed) === "orderPending") pendingSource = node.initializer.getText(parsed);
    forEachChild(node, visit);
  };
  visit(parsed); assert.ok(queueSource && pendingSource);
  const first = source.indexOf("  const metadata = ", source.indexOf("async function runAutonomousWave"));
  const last = source.indexOf("  workItemsById.clear();", first);
  assert.ok(first > 0 && last > first);
  const context = { repos: f.repos, held: tasks, plannedTasks: [], taskIds: tasks.map(task => task.id),
    taskWorkIds: new Map(tasks.map(task => [task.id, task.workItemId])), workItemsById: new Map(),
    readHeldDiggerWorkItems, readHeldDiggerPriorities, heldDiggerNamedOrder, compareNamedBeforeBackground, huntRoundComparator,
    placeOrder: ["selected-place-only"], dispatchTargets: [{ kind: "DISPATCH", key: "dispatch:one", ref: "current-order" }],
    dispatchPriority: new Set<string>(), placeRankFor: (subject: string) => subject === place.subject ? 0 : null,
    plannedOrder: new Map<string, number>(), failedTaskIds: new Set<string>(), taskQueue: null,
    refreshPlaceOrder: async () => {}, refreshOwnerSettings: async () => {}, paidWorkerCapacity: () => 1 };
  const compile = (text: string) => transpileModule(text, { compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.CommonJS } }).outputText;
  const loaded = await runInNewContext(compile(`(async () => {${source.slice(first, last)};return {metadata,diggerPriorities};})()`), context);
  assert.equal(loaded.metadata.size, 3, "deterministic held items absent from coordinator selections are actually loaded");
  Object.assign(context, loaded);
  const readTaskQueue = runInNewContext(compile(`(${queueSource})`), context) as () => {
    rank(id: string): number; compare(a: string, b: string): number;
  };
  Object.assign(context, { readTaskQueue });
  const queue = readTaskQueue();
  assert.equal(queue.rank(tasks[2]!.id), 1, "the actual current direct subject order receives a finite rank");
  assert.equal(queue.rank(tasks[0]!.id), Infinity);
  // Execute the script's actual continuous-lane ordering expression and its per-process ordering callback.
  const orderedStart = source.indexOf("const ordered = taskIds.filter", last);
  const orderedEnd = source.indexOf(";", orderedStart);
  Object.assign(context, { queue });
  const continuous = runInNewContext(compile(source.slice(orderedStart, orderedEnd + 1) + "\nordered;"), context) as string[];
  const pending = runInNewContext(compile(`(${pendingSource})`), context) as (ids: string[]) => Promise<string[]>;
  const processOrder = await pending(tasks.map(task => task.id));
  for (const order of [continuous, processOrder]) {
    assert.deepEqual(new Set(order.slice(0, 2)), new Set([tasks[1]!.id, tasks[2]!.id]));
    assert.equal(order.at(-1), tasks[0]!.id, "background cannot win an earlier hunt round over current named work");
  }
  context.dispatchTargets = [{ kind: "DISPATCH", key: "dispatch:one", ref: "old-order" }];
  assert.equal(readTaskQueue().rank(tasks[2]!.id), Infinity, "the caller cannot promote a historical subject order into focus");
});
