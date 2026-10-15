/**
 * The one-time copy of the single-document field manual into one row per
 * entry: every entry kept, re-tagged with the place its record names, the rest
 * reported; methods' recorded results into the fix map; the document kept
 * under a new id; a later write by old code copied by the next start.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { BANK_WRITE_HEALTH_ID } from "../lib/control-plane/bank-write-health.ts";
import { copiedReach, copyBriefLine, copyFieldManualDocument, copyReportId, retagForRows, type SingleDocumentManual } from "../lib/control-plane/field-manual-copy.ts";
import { ADMIN_CONFIG_ID, type AdminConfig } from "../lib/control-plane/gateway/admin-config.ts";
import { updateRecords } from "../lib/control-plane/updates.ts";
import { fieldManualEntryId, type FieldManualEntry } from "../lib/control-plane/field-manual.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import type { Persisted } from "../lib/control-plane/repository/types.ts";

const NOW = "2026-10-07T12:00:00.000Z";
const PIMA = "ocd-division/country:us/state:az/county:pima";
const MORRIS = "ocd-division/country:us/state:nj/county:morris";

const old = (id: string, over: Partial<FieldManualEntry> = {}): FieldManualEntry => ({
  id, role: "SHARED", kind: "LESSON_NOTE", title: id, summary: id, states: [], recordClasses: [], platforms: [], outcome: "YIELDED",
  url: null, source: "old", observedAt: "2026-09-01", tier: null, payload: {}, ...over,
});

function documentTable(entries: readonly FieldManualEntry[], errors?: number) {
  const rows = new Map<string, Persisted<{ entries: readonly FieldManualEntry[] }>>([["live", { id: "live", revision: 9, updatedAt: NOW, value: { entries } }]]);
  if (errors !== undefined) rows.set("write-errors", { id: "write-errors", revision: 2, updatedAt: NOW, value: { entries: [old("count", { payload: { count: errors } })] } });
  const table: SingleDocumentManual & { rows: typeof rows } = {
    rows,
    read: async (id) => rows.get(id) ?? null,
    retire: async (id, revision, as) => {
      const row = rows.get(id);
      if (!row || row.revision !== revision) return false;
      rows.delete(id);
      rows.set(as, { ...row, id: as });
      return true;
    },
  };
  return table;
}

const SAMPLE = [
  old("investigation", { kind: "INVESTIGATION_RESULT", payload: { subjectId: `${PIMA}#governing` } }),
  old("door", { kind: "SCOUT_DISCOVERY", role: "SCOUT", url: "https://pima.gov/meetings", states: ["az"], payload: { subjectId: PIMA } }),
  old("reliability", { kind: "SOURCE_RELIABILITY", url: "https://pima.gov/meetings" }),
  old("playbook", { kind: "PLAYBOOK", role: "SCOUT", payload: { text: "walk" } }),
  old("fingerprint", { kind: "PLATFORM_FINGERPRINT", platforms: ["legistar"] }),
  old("tier", { kind: "TIER_VOCAB", states: ["nh"] }),
  old("orphan", { kind: "SOURCE_RELIABILITY", url: "https://somewhere.example/feed", title: "Somewhere" }),
  old("method", { kind: "METHOD", platforms: ["legistar"], states: ["az", "nj"], payload: { places: [PIMA, MORRIS], doorEntryIds: [] },
    placeResults: [{ place: "state:az", outcome: "YIELDED", observedAt: "2026-09-01" }] }),
  old("route", { kind: "ROUTE", payload: { id: "r", outcomes: [{ jurisdiction: PIMA, outcome: "FAILED", observedOn: "2026-09-02" }] } }),
];

test("re-tagging reads the place from the record, then from another entry with the same address, then class-wide kinds; the rest names no place", () => {
  const out = retagForRows(SAMPLE);
  const byId = new Map(out.entries.map((e) => [e.id, e] as const));
  assert.deepEqual(byId.get("investigation")!.reach!.places, [PIMA]);
  assert.deepEqual(byId.get("reliability")!.reach!.places, [PIMA], "the same address as Pima's own door");
  assert.equal(byId.get("playbook")!.reach!.everywhere, true);
  assert.equal(copiedReach(byId.get("fingerprint")!), "PLATFORM");
  assert.equal(copiedReach(byId.get("tier")!), "STATE");
  assert.equal(copiedReach(byId.get("orphan")!), "NOWHERE");
  assert.equal(copiedReach(byId.get("method")!), "METHOD");
  assert.deepEqual([out.fromRecord, out.fromSameAddress], [3, 1], "the investigation, the door's subject and the route's outcome; the reliability by address");
  assert.deepEqual(out.everywhereByKind, { PLAYBOOK: 1 });
});

test("the copy saves every entry as a row, records method results, keeps the document under a new id, and reports", async () => {
  const repos = createMemoryRepositories();
  const table = documentTable(SAMPLE, 4);
  const report = (await copyFieldManualDocument(table, repos, NOW))!;
  assert.equal(report.entries, SAMPLE.length);
  assert.equal(report.saved, SAMPLE.length);
  assert.deepEqual(report.reach, { PLACE: 3, METHOD: 2, PLATFORM: 1, STATE: 1, EVERYWHERE: 1, NOWHERE: 1 });
  assert.deepEqual(report.nowhere.map((n) => [n.id, n.kind, n.url]), [["orphan", "SOURCE_RELIABILITY", "https://somewhere.example/feed"]]);
  assert.deepEqual(report.nowhereByKind, { SOURCE_RELIABILITY: 1 });
  assert.equal(report.writeErrorsCarried, 4);
  assert.equal(report.sourceRevision, 9);
  assert.deepEqual([...table.rows.keys()].sort(), [`copied:${NOW}`, `copied:${NOW}:write-errors`]);
  const rows = new Map((await repos.fieldManual.list()).map((r) => [r.id, r.value] as const));
  for (const e of SAMPLE) assert.ok(rows.has(e.id), e.id);
  assert.equal((rows.get(BANK_WRITE_HEALTH_ID)!.payload as { count: number }).count, 4);
  assert.equal(rows.get(copyReportId(NOW))!.kind, "COPY_REPORT");
  const fix = new Map([...(await repos.fixMap.forPlace(PIMA)), ...(await repos.fixMap.forPlace(MORRIS))].map((r) => [`${r.methodId}@${r.placeId}`, r.state] as const));
  assert.deepEqual(Object.fromEntries(fix), { [`method@${PIMA}`]: "WORKS", [`method@${MORRIS}`]: "WORKS", [`route@${PIMA}`]: "FAILS" });
  assert.equal(await copyFieldManualDocument(table, repos, "2026-10-07T12:05:00.000Z"), null, "the next start finds nothing to copy");
  const lines = updateRecords((await repos.adminConfig.read(ADMIN_CONFIG_ID))!.value as AdminConfig).filter((u) => u.id.startsWith("field-manual-copy:"));
  assert.equal(lines.length, 1, "one line for the daily brief");
  assert.equal(lines[0]!.what, copyBriefLine(report));
  assert.equal(lines[0]!.what, "The field manual now keeps each lesson on its own: 9 lessons copied — 3 for one place, 1 for a state, 1 for a website platform, " +
    "2 methods offered anywhere they fit, 1 for everywhere; 4 lessons got their place back from the record, and 1 lesson names no place yet and is listed for review.");
});

test("a document the old code writes again is copied by the next start, merged so nothing is lost", async () => {
  const repos = createMemoryRepositories();
  const table = documentTable([old("tier", { kind: "TIER_VOCAB", states: ["nh"] })]);
  await copyFieldManualDocument(table, repos, NOW);
  table.rows.set("live", { id: "live", revision: 1, updatedAt: NOW, value: { entries: [old("tier", { kind: "TIER_VOCAB", states: ["vt"], observedAt: "2026-10-08" }), old("new", { states: ["vt"] })] } });
  const later = "2026-10-08T00:00:00.000Z";
  const report = (await copyFieldManualDocument(table, repos, later))!;
  assert.equal(report.entries, 2);
  const tier = (await repos.fieldManual.read("tier"))!.value;
  assert.deepEqual(tier.reach!.states, ["nh", "vt"], "the row keeps both states");
  assert.ok(await repos.fieldManual.read("new"));
});

test("a document written while the copy ran stays for the next start; two starts copying at once carry the error count once", async () => {
  const repos = createMemoryRepositories();
  const table = documentTable([old("a", { states: ["az"] })], 2);
  const racing: SingleDocumentManual = { ...table, read: async (id) => {
    const row = await table.read(id);
    if (id === "live" && row) table.rows.set("live", { ...row, revision: row.revision + 1, value: { entries: [...(row.value.entries ?? []), old("b", { states: ["az"] })] } });
    return row;
  } };
  assert.equal(await copyFieldManualDocument(racing, repos, NOW), null, "the document moved on, so it is not retired");
  assert.ok(table.rows.has("live"));
  const both = await Promise.all([copyFieldManualDocument(table, repos, "2026-10-07T13:00:00.000Z"), copyFieldManualDocument(table, repos, "2026-10-07T13:00:00.000Z")]);
  assert.equal(both.filter((r) => r !== null).length, 1, "one start retires the document");
  assert.ok(await repos.fieldManual.read("b"));
  assert.equal(((await repos.fieldManual.read(BANK_WRITE_HEALTH_ID))!.value.payload as { count: number }).count, 2);
  assert.equal(fieldManualEntryId("field-manual-copy", NOW), copyReportId(NOW));
});
