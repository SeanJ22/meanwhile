import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { canonicalJson, type AggregateRepository } from "../lib/control-plane/repository/types.ts";
import { mergeEntry, newFieldManualEntry, saveFieldManualEntries, type FieldManualEntry } from "../lib/control-plane/field-manual.ts";
import { openPlatformMeetingDoors, platformMeetingDoor, retireCensusDuplicates } from "../lib/doors/platform-census.ts";
import { applyDerivedRow, checkDoorDraft, type DoorRecord } from "../lib/doors/registry.ts";
import { CROSSWALK_CITATION, type MeetingBodyCrosswalkRow } from "../lib/civic-data/meeting-body-crosswalk.ts";
import { readMethodKnowledge, readMethodVersion, KNOWLEDGE_SOURCE } from "../lib/method/manual-bridge.ts";
import { markDoorsReadNow, settleReadNow } from "../lib/doors/mission-refresh.ts";

const AT = "2026-10-22T12:00:00.000Z";
const LATER = "2026-10-22T13:00:00.000Z";
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
function metered<T>(repo: AggregateRepository<T>) {
  let received = 0, fullReads = 0;
  const observed = new Proxy(repo, { get(target, member) {
    const method = Reflect.get(target, member);
    if (typeof method !== "function") return method;
    return async (...args: unknown[]) => {
      const value = await method.apply(target, args);
      if (/^(read|list|mustRead)/.test(String(member))) {
        received += bytes(value);
        if (["read", "readMany", "list", "mustRead"].includes(String(member))) fullReads++;
      }
      return value;
    };
  } });
  return { repo: observed, get received() { return received; }, get fullReads() { return fullReads; }, reset() { received = 0; fullReads = 0; } };
}

const entry = (fields: Partial<FieldManualEntry> = {}) => ({ ...newFieldManualEntry("egress-test", "page", {
  role: "SHARED", kind: "SOURCE_PAGE", title: "Government page", summary: "Held source evidence",
  outcome: "YIELDED", states: ["az"], observedAt: AT, payload: { html: "captured source ".repeat(100_000) }, ...fields,
}), ...fields });

test("manual saves merge exactly, without rereading the replaced page; replays check revisions", async t => {
  const base = createMemoryRepositories();
  const first = mergeEntry(null, entry());
  await base.fieldManual.put(first.id, first, AT);
  const meter = metered(base.fieldManual), repos = { fieldManual: meter.repo as typeof base.fieldManual };
  const incoming = entry({ observedAt: LATER, states: ["tx"], payload: { html: "new source ".repeat(100_000) } });
  const expected = mergeEntry(first, incoming), before = bytes(await base.fieldManual.readMany([first.id]));
  assert.deepEqual(await saveFieldManualEntries(repos, [incoming], LATER), { written: 1 });
  assert.equal(canonicalJson((await base.fieldManual.mustRead(first.id)).value), canonicalJson(expected));
  assert.equal(meter.fullReads, 0);
  assert.ok(meter.received < before / 100);
  t.diagnostic(`manual save response bytes: ${before} -> ${meter.received}`);
  meter.reset();
  const revision = (await base.fieldManual.mustRead(first.id)).revision;
  await saveFieldManualEntries(repos, [incoming], LATER);
  assert.equal((await base.fieldManual.mustRead(first.id)).revision, revision);
  assert.equal(meter.fullReads, 0);
  // A second writer changes the row: the saved-input identity must never hide it.
  await base.fieldManual.compareAndSet(first.id, revision, { ...expected, title: "Other writer", observedAt: "2026-10-23" }, LATER);
  await saveFieldManualEntries(repos, [incoming], LATER);
  assert.equal((await base.fieldManual.mustRead(first.id)).value.title, "Other writer");
  assert.ok(meter.fullReads > 0, "a newer stored observation reloads its full payload");
});

test("manual saves preserve cold no-ops, payload-only edits, stale fields and method unions", async () => {
  for (const kind of ["SOURCE_PAGE", "METHOD", "PARSE_FIELDS"]) {
    const base = createMemoryRepositories();
    const prior = mergeEntry(mergeEntry(null, entry({ kind, payload: { original: "kept", places: ["az"], doorEntryIds: ["door-a"], fieldNames: ["date"] } })), entry({ kind }));
    await base.fieldManual.put(prior.id, prior, AT);
    for (const incoming of [
      { ...prior },
      { ...prior, payload: { changed: "at the same time", places: ["tx"], doorEntryIds: ["door-b"], fieldNames: ["time"] } },
      entry({ kind, observedAt: "2026-10-21", states: ["oh"], payload: { stale: true } }),
    ]) {
      const held = await base.fieldManual.mustRead(prior.id), expected = mergeEntry(held.value, incoming);
      await saveFieldManualEntries(base, [incoming], LATER);
      const saved = await base.fieldManual.mustRead(prior.id);
      assert.equal(canonicalJson(saved.value), canonicalJson(expected));
      if (canonicalJson(expected) === canonicalJson(held.value)) assert.equal(saved.revision, held.revision);
    }
  }
});

const crosswalk: MeetingBodyCrosswalkRow = {
  id: "test-calendar", jurisdictionId: "az:city:test", ocdId: "ocd-division/country:us/state:az/place:test",
  bodyId: "test-council", bodyRole: "GOVERNING", bodyName: "Test Council", kind: "ICAL",
  route: "https://test.gov/iCalendar.aspx?catID=1&feed=calendar", officialHost: "test.gov", filter: { feedScope: "category" },
  publishingOrg: "Test City", timeZone: "America/Phoenix", status: "ACTIVE", reviewedBy: "test", reviewedAt: AT,
  authorization: CROSSWALK_CITATION, evidence: { bodyPage: { url: "https://test.gov/", sha256: "a".repeat(64), quote: "Test Council" },
    calendar: { url: "https://test.gov/", sha256: "b".repeat(64), selected: 1, total: 1 }, readAt: AT },
};

test("census opening and retirement retain the same manual board match with far fewer bytes", async t => {
  const base = createMemoryRepositories(), checked = checkDoorDraft(platformMeetingDoor(crosswalk)[0]);
  assert.ok(checked.ok);
  const draft = checked.value;
  const manualConfig = { ...draft.config }; delete manualConfig.crosswalkRowId;
  const manual = applyDerivedRow(null, { ...draft, doorId: "manual", config: manualConfig }, AT, AT)!;
  await base.doors.put(manual.doorId, manual, AT);
  for (let n = 0; n < 200; n++) {
    const door = applyDerivedRow(null, { ...draft, doorId: `unrelated-${n}`, bodyIds: [`other-${n}`],
      hosts: [`other-${n}.gov`], config: { ...draft.config, capture: "old page ".repeat(5000) },
      ...(n % 2 ? { meeting: null } : {}) }, AT, AT)!;
    await base.doors.put(door.doorId, door, AT);
  }
  const duplicate = applyDerivedRow(null, { ...draft, config: { ...draft.config, capture: "must survive retirement" } }, AT, AT)!;
  await base.doors.put(duplicate.doorId, duplicate, AT);
  const before = bytes(await base.doors.list()), meter = metered<DoorRecord>(base.doors);
  assert.deepEqual(await openPlatformMeetingDoors(meter.repo, [crosswalk], LATER), []);
  assert.equal(meter.fullReads, 0);
  assert.ok(meter.received < before / 50);
  t.diagnostic(`census opening response bytes: ${before} -> ${meter.received}`);
  meter.reset();
  assert.deepEqual(await retireCensusDuplicates(meter.repo, LATER), [duplicate.doorId]);
  const saved = (await base.doors.mustRead(duplicate.doorId)).value;
  assert.deepEqual(saved, { ...duplicate, status: "SUSPENDED", readNow: false, notes: "This board is read through manual", updatedAt: LATER });
  assert.ok(meter.received < before / 50);
  t.diagnostic(`census retirement response bytes: ${before} -> ${meter.received}`);
});

test("method versions read only IDs; knowledge reloads changed route revisions and keeps callers isolated", async t => {
  const base = createMemoryRepositories();
  const route = entry({ kind: "ROUTE", source: KNOWLEDGE_SOURCE, payload: {
    id: "route", title: "Original", fields: [], outcomes: [], applicability: {}, detail: "method evidence ".repeat(100_000),
  } });
  const version = entry({ id: "version", kind: "METHOD_VERSION", source: KNOWLEDGE_SOURCE, payload: { version: 4, updatedOn: AT } });
  await base.fieldManual.put(route.id, route, AT); await base.fieldManual.put(version.id, version, AT);
  const meter = metered(base.fieldManual), repos = { fieldManual: meter.repo as typeof base.fieldManual };
  const before = bytes(await base.fieldManual.readMany([route.id, version.id]));
  assert.equal(await readMethodVersion(repos), 4);
  assert.ok(meter.received < before / 100);
  t.diagnostic(`method version response bytes: ${before} -> ${meter.received}`);
  const first = await readMethodKnowledge(repos); first.routes[0].title = "Caller edit";
  meter.reset();
  assert.equal((await readMethodKnowledge(repos)).routes[0].title, "Original");
  assert.ok(meter.received < before / 100);
  t.diagnostic(`unchanged method knowledge response bytes: ${before} -> ${meter.received}`);
  const held = await base.fieldManual.mustRead(route.id);
  await base.fieldManual.compareAndSet(route.id, held.revision, { ...route, payload: { ...route.payload as object, title: "Updated" } }, LATER);
  assert.equal((await readMethodKnowledge(repos)).routes[0].title, "Updated");
});

test("mission marks inspect only selectors, and settlement reads only marked doors", async t => {
  const base = createMemoryRepositories(), checked = checkDoorDraft(platformMeetingDoor(crosswalk)[0]);
  assert.ok(checked.ok);
  const target = applyDerivedRow(null, { ...checked.value, doorId: "selected", readNow: false, config: { kept: "adapter setting" } }, AT, AT)!;
  await base.doors.put(target.doorId, target, AT);
  for (let n = 0; n < 100; n++) await base.doors.put(`elsewhere-${n}`, { ...target, doorId: `elsewhere-${n}`,
    ocdId: "ocd-division/country:us/state:oh", bodyIds: [`oh-body-${n}`], config: { capture: "saved page ".repeat(10_000) } }, AT);
  const before = bytes(await base.doors.list()), meter = metered(base.doors);
  assert.deepEqual(await markDoorsReadNow(meter.repo, [crosswalk.ocdId], LATER),
    { inPlace: 1, marked: 1, alreadyMarked: 0, notRead: 0, raced: 0 });
  assert.ok(meter.received < before / 100);
  t.diagnostic(`mission mark response bytes: ${before} -> ${meter.received}`);
  const marked = await base.doors.mustRead(target.doorId);
  assert.deepEqual(marked.value.config, target.config);
  await base.doors.compareAndSet(marked.id, marked.revision, { ...marked.value, lastSuccessAt: LATER }, LATER);
  meter.reset();
  assert.equal(await settleReadNow(meter.repo, LATER), 1);
  assert.ok(meter.received < before / 100);
  t.diagnostic(`mission settlement response bytes: ${before} -> ${meter.received}`);
  assert.deepEqual((await base.doors.mustRead(target.doorId)).value,
    { ...target, readNow: false, updatedAt: LATER, lastSuccessAt: LATER });
});
