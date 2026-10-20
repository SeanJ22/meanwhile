import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createFileRepositories } from "../lib/control-plane/repository/file-store.ts";
import { mergeEntry, normalizeEntry, newFieldManualEntry, type FieldManualEntry } from "../lib/control-plane/field-manual.ts";

import { verifyFieldManualMerge } from "./helpers/field-manual-merge-cases.ts";

const NOW = "2026-10-20T12:00:00Z";
async function fixture() { const root = await mkdtemp(join(tmpdir(), "manual-file-merge-")); return { root, repos: await createFileRepositories(root) }; }

test("file merges a place observation while retaining the country's held history and opaque winner on disk", async t => {
  const { root, repos } = await fixture(); t.after(() => rm(root, { recursive: true, force: true }));
  const prior = normalizeEntry(newFieldManualEntry("test", "method", { role: "SCOUT", summary: "Official source method", kind: "METHOD", title: "Official roster parser", outcome: "YIELDED", observedAt: NOW,
    states: ["AZ"], platforms: ["legistar"], recordClasses: ["meetings"], foundBy: "DETECTIVE", portable: true,
    ocdIds: ["ocd-division/country:us/state:az/county:pima"],
    placeResults: Array.from({ length: 2_000 }, (_, n) => ({ place: `body:city-${n}`, outcome: "YIELDED" as const, observedAt: "2026-10-01" })),
    payload: { opaque: "held-country-record".repeat(100_000), places: ["second", "first"], doorEntryIds: ["old-door"], untouched: { raw: true } } }));
  await repos.fieldManual.put(prior.id, prior, NOW);
  const read = repos.fieldManual.read.bind(repos.fieldManual);
  repos.fieldManual.read = async () => { throw new Error("the national prior must not be loaded by the writer"); };
  repos.fieldManual.readMany = async () => { throw new Error("country readMany forbidden"); };
  const incoming = normalizeEntry({ ...prior, title: "Older observation", observedAt: "2026-10-02", portable: false, foundBy: "SCOUT",
    states: ["nh"], ocdIds: ["ocd-division/country:us/state:nh/city:concord"], bodyIds: ["own-body"],
    placeResults: [{ place: "body:city-1999", outcome: "FAILED", observedAt: "2026-10-02" }],
    payload: { places: ["first", "third"], doorEntryIds: ["new-door"], opaque: "incoming own-place" } });
  const expected = mergeEntry(prior, incoming);
  const saved = await repos.fieldManual.compareAndSetMergedEntry(prior.id, 1, incoming, NOW);
  assert.deepEqual(saved, { revision: 2, changed: true });
  const held = (await read(prior.id))!;
  assert.deepEqual(held.value, expected);
  assert.equal(held.value.placeResults?.length, 2_000);
  assert.deepEqual(await repos.fieldManual.compareAndSetMergedEntry(prior.id, 2, incoming, NOW), { revision: 2, changed: false });
  await assert.rejects(repos.fieldManual.compareAndSetMergedEntry(prior.id, 1, incoming, NOW), /modified concurrently/);
  await assert.rejects(repos.fieldManual.compareAndSetMergedEntry(prior.id, null, incoming, NOW), /modified concurrently/);
});

test("file merge preserves partial implicit results, same-time failures, newest opaque values, empty class wildcard and null payload", async t => {
  const { root, repos } = await fixture(); t.after(() => rm(root, { recursive: true, force: true }));
  const cases: [FieldManualEntry, Partial<FieldManualEntry>][] = [
    [newFieldManualEntry("test", "partial", { role: "SCOUT", title: "Partial method", summary: "Partial source method", kind: "METHOD", observedAt: NOW, outcome: "YIELDED", states: ["az"],
      bodyIds: ["one", "two"], placeResultsPartial: true, placeResults: [{ place: "body:one", outcome: "FAILED", observedAt: NOW }], payload: null }),
      { observedAt: NOW, outcome: "BLOCKED", bodyIds: ["three"], states: ["nh"], recordClasses: [],
        placeResults: [{ place: "body:two", outcome: "FAILED", observedAt: NOW }], payload: { places: ["new"] } }],
    [newFieldManualEntry("test", "parse", { role: "PARSER", title: "Parse method", summary: "Parse source method", outcome: "REFERENCE", kind: "PARSE_FIELDS", observedAt: "2026-10-01", payload: { fieldNames: ["z", "a"], old: "discarded newest wins" } }),
      { observedAt: NOW, payload: { fieldNames: ["a", "b"], raw: { new: true } } }],
    [newFieldManualEntry("test", "legacy-array", { role: "SCOUT", title: "Legacy array", summary: "Legacy shape", kind: "METHOD", outcome: "REFERENCE", observedAt: NOW, payload: ["one", { raw: true }] }),
      { observedAt: "2026-10-01", payload: { places: ["new"] } }],
    [newFieldManualEntry("test", "legacy-string", { role: "SCOUT", title: "Legacy string", summary: "Legacy shape", kind: "METHOD", outcome: "REFERENCE", observedAt: NOW, payload: "escaped \\ \"quote\" ☃😀" }),
      { observedAt: "2026-10-01", payload: null }],
    [newFieldManualEntry("test", "opaque", { role: "SCOUT", title: "Opaque method", summary: "Opaque source method", outcome: "REFERENCE", kind: "REFERENCE", observedAt: NOW, payload: { original: true } }),
      { observedAt: "2026-10-21", payload: null }],
  ];
  for (const [raw, patch] of cases) {
    const prior = normalizeEntry(raw), incoming = normalizeEntry({ ...prior, ...patch });
    assert.deepEqual(await repos.fieldManual.compareAndSetMergedEntry(prior.id, null, prior, NOW), { revision: 1, changed: true });
    await repos.fieldManual.compareAndSetMergedEntry(prior.id, 1, incoming, NOW);
    assert.deepEqual((await repos.fieldManual.mustRead(prior.id)).value, JSON.parse(JSON.stringify(mergeEntry(prior, incoming))));
  }
});


test("native file merge matches the shared reference corpus, including duplicate and partial result ordering", async t => {
  const { root, repos } = await fixture(); t.after(() => rm(root, { recursive: true, force: true }));
  await verifyFieldManualMerge(repos.fieldManual);
});
