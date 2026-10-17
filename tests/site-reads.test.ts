import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { publishAuthorityRecords, readAuthorityRecords } from "../lib/meetings/authority-records.ts";
import { LocalFileArtifactStore } from "../lib/meetings/edge-store.ts";
import { readerRoute } from "../lib/api/reader-route.ts";
import { currentReaderRoute } from "../lib/db/reader-route.ts";
import { currentReaderSelection, withReaderSelection } from "../lib/db/reader-route.ts";
import { authorityPointerKey, ensureReaderAuthorityEdge, readServedPointer, stateFactsPointerKey, writeFactBucket } from "../lib/meetings/edge-serving.ts";
import { publishPointers } from "./helpers/edge-pointers.ts";
import { withReaderAuthorityEdge } from "../lib/registry/runtime-edge.ts";
import { getRegistryRuntimeReadModel, readRegistryRuntimeProjection } from "../lib/registry/runtime-read-model.ts";
import { installFactReader } from "../lib/facts/db.ts";

import { provenEdgeEntry } from "./helpers/promoted-edge-entry.ts";
import type { RegistryRuntimeReadModel } from "../lib/registry/runtime-data-plane.ts";
import { registryTransferImport } from "./helpers/promoted-fixtures.ts";
import { registryJurisdictions } from "../lib/civic-data/state-scopes.ts";
import { stateRegistryRuntimeScope } from "../lib/civic-data/state-scopes.ts";

function stateRegistryArtifacts(versionId: string, states: readonly string[], value: RegistryRuntimeReadModel = registryTransferImport().projection.payload) {
  return Object.fromEntries(states.map(state => [state, { versionId: `${versionId}:${state}`, value: { kind: "PROMOTED_POINTERS" as const,
    entries: [provenEdgeEntry({ recordClass: "REGISTRY_RUNTIME_BINDING", scope: stateRegistryRuntimeScope(state), sourceId: "registry-reviewed-bindings",
      versionId: `${versionId}:${state}`, value: registryFixtureForState(state, value) })] } }]));
}

function registryFixtureForState(state: string, value: RegistryRuntimeReadModel = registryTransferImport().projection.payload): RegistryRuntimeReadModel {
  const own = (id: string | null) => registryJurisdictions(id).includes(state.toUpperCase());
  const bodies = value.registry.bodies.filter(row => own(row.id) || own(row.ocdId) || row.alsoServesOcdIds?.some(own));
  const bodyIds = new Set(bodies.map(row => row.id));
  const bodyRosters = value.bodyRosters.filter(row => bodyIds.has(row.bodyId));
  const statewideExecutives = value.statewideExecutives.filter(row => own(row.stateOcdId));
  const bridge = value.officialCandidacies.rows.filter(row => row.holder.divisions.some(own));
  const holders = new Set([...bodyRosters.flatMap(row => row.members.map(member => member.id)),
    ...statewideExecutives.map(row => row.holder.id), ...bridge.map(row => row.holder.id)]);
  return { ...value, registry: { ...value.registry, bodies,
    divisions: value.registry.divisions.filter(row => row.ocdId === "ocd-division/country:us" || own(row.ocdId)) },
    bodyRosters, statewideExecutives, officialCandidacies: { ...value.officialCandidacies, rows: bridge },
    officialPhotos: { photos: value.officialPhotos.photos.filter(row => holders.has(row.officeholderId)) },
    rosterPhotos: Object.fromEntries(Object.entries(value.rosterPhotos).filter(([id]) => holders.has(id) || own(id))),
    rosterReaderDispositions: value.rosterReaderDispositions.filter(row => own(row.sourceId) || holders.has(row.sourceId) || (row.canonicalId !== null && holders.has(row.canonicalId)) ||
      [...holders].some(id => id.startsWith("roster:") && id.split("#")[0] === row.sourceId.split("#")[0])) };
}


test("a cooked registry edge hit never rereads facts, including an explicit reader refresh", async () => {
  const value = registryFixtureForState("AZ");
  let queries = 0;
  installFactReader(async () => { queries++; throw new Error("Unexpected fact query on an edge hit"); });
  try {
    await withReaderSelection({ keys: new Set(["ocd-division/country:us/state:az/county:pima"]) }, () =>
      withReaderAuthorityEdge({ stateAuthorities: { families: new Set(["registry-runtime"] as const), load: async () => ({ kind: "PROMOTED_POINTERS", entries: [
        provenEdgeEntry({ recordClass: "REGISTRY_RUNTIME_BINDING", scope: "US-AZ:reader-registry-runtime", sourceId: "registry-reviewed-bindings", versionId: "test:fact-edge", value }),
      ] }) } }, async () => {
        const read = await readRegistryRuntimeProjection(["AZ"], { bypassCache: true });
        assert.equal(read.kind, "PROMOTED");
        assert.ok("value" in read);
        assert.deepEqual(read.value, value);
        assert.equal(getRegistryRuntimeReadModel(), read.value);
      }));
    assert.equal(queries, 0);
  } finally { installFactReader(undefined); }
});

test("one body's facts and citations survive while another body's payload is never opened", async () => {
  const dir = mkdtempSync(join(tmpdir(), "site-read-"));
  try {
    const store = new LocalFileArtifactStore(dir);
    const pima = "ocd-division/country:us/state:az/county:pima";
    const foreign = "ocd-division/country:us/state:ny/county:albany";
    const bodyId = `${pima}#board`;
    const member = { id: "roster:pima#one", name: "Recorded member", phone: "555-0100",
      fieldSources: { phone: { quote: "Recorded member 555-0100", sourceUrl: "https://example.gov/board", verifiedAt: "2026-10-13" } } };
    const value = { registry: { divisions: [{ ocdId: pima }, { ocdId: foreign }], bodies: [{ id: bodyId, ocdId: pima }] },
      bodyRosters: [{ bodyId, members: [member] }, { bodyId: `${foreign}#board`, members: [{ id: "other", text: "Unrelated bytes".repeat(50_000) }] }],
      officialPhotos: { photos: [{ officeholderId: member.id, url: "/portrait.png" }] } };
    const index = await publishAuthorityRecords(value, store);
    const unwanted = index.records.find(ref => ref.tags.includes(`${foreign}#board`))!;
    const reads: string[] = [];
    const counting = new Proxy(store, { get(target, key) {
      if (key === "readBytes") return async (path: string) => { reads.push(path); return target.readBytes(path); };
      const held = Reflect.get(target, key); return typeof held === "function" ? held.bind(target) : held;
    } });
    const selected = await readAuthorityRecords(index, counting, { keys: new Set([pima]) }) as typeof value;
    assert.deepEqual(selected.bodyRosters, [value.bodyRosters[0]]);
    assert.deepEqual(selected.officialPhotos, value.officialPhotos);
    assert.deepEqual(selected.registry.divisions, [value.registry.divisions[0]]);
    assert.ok(!reads.includes(unwanted.key));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("inventory pages fetch fifty records, retain the total, and keep their original ordering", async () => {
  const dir = mkdtempSync(join(tmpdir(), "site-list-"));
  try {
    const store = new LocalFileArtifactStore(dir);
    const governments = Array.from({ length: 125 }, (_, n) => ({ id: `government:${n}`, name: `Government ${n}` }));
    const index = await publishAuthorityRecords({ governments }, store);
    const read = await readAuthorityRecords(index, store, { keys: new Set(), governmentWindow: [50, 50] }) as { governments: typeof governments; governmentCount: number };
    assert.deepEqual(read.governments, governments.slice(50, 100));
    assert.equal(read.governmentCount, 125);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a shared district loads its requested ZIP without following other ZIP memberships", async () => {
  const dir = mkdtempSync(join(tmpdir(), "site-zip-"));
  try {
    const store = new LocalFileArtifactStore(dir);
    const index = await publishAuthorityRecords({ containers: [{ ref: { geoid: "04020", ocdId: "ocd-division/country:us/state:az/sldl:20" } }],
      codes: { "85701": [[0, true, 1]], "04020": [[0, true, 1]], "85702": [[0, false, 0.5]] } }, store);
    const selected = await readAuthorityRecords(index, store, { keys: new Set(["85701"]) }) as { codes: Record<string, unknown>; containers: unknown[] };
    assert.deepEqual(Object.keys(selected.codes), ["85701"]);
    assert.equal(selected.containers.length, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("member vote reads keep party labels needed for the displayed totals without reading other members' profiles", async () => {
  const dir = mkdtempSync(join(tmpdir(), "site-party-"));
  try {
    const store = new LocalFileArtifactStore(dir);
    const holders = [{ id: "congress:A000001", partyLabel: "Democratic" }, { id: "congress:B000002", partyLabel: "Republican" }];
    const index = await publishAuthorityRecords({ roster: { officeholders: holders }, directory: { byMember: { A000001: {}, B000002: {} } } }, store);
    const selected = await readAuthorityRecords(index, store, { keys: new Set([holders[0].id, "A000001"]) }) as {
      roster: { officeholders: typeof holders }; partyLabels: Record<string, string>;
    };
    assert.deepEqual(selected.roster.officeholders, [holders[0]]);
    assert.deepEqual(selected.partyLabels, Object.fromEntries(holders.map(row => [row.id, row.partyLabel])));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("overlapping requests keep their route and person selectors apart", async () => {
  const read = readerRoute("/api/example/[subject]", async (_request: Request, context: { params: Promise<{ subject: string }> }) => {
    const subject = (await context.params).subject;
    await Promise.resolve();
    assert.equal(currentReaderRoute(), "/api/example/[subject]");
    assert.ok(currentReaderSelection()?.keys.has(subject));
    return [...currentReaderSelection()!.keys];
  });
  const [one, two] = await Promise.all(["congress:A000001", "congress:B000002"].map(subject => read(
    new Request("https://example.test/api/example/" + subject), { params: Promise.resolve({ subject }) })));
  assert.ok(!one.includes("congress:B000002"));
  assert.ok(!two.includes("congress:A000001"));
});

test("concurrent authority requests retain their own bodies after another request resumes", async () => {
  const values = await Promise.all(["AZ", "NH"].map(state => withReaderSelection({ states: [state], keys: new Set() }, () => {
    const value = registryFixtureForState(state), entry = provenEdgeEntry({ recordClass: "REGISTRY_RUNTIME_BINDING", scope: `US-${state}:reader-registry-runtime`, sourceId: "registry-reviewed-bindings", versionId: "shared-version", value });
    return withReaderAuthorityEdge({ stateAuthorities: { families: new Set(["registry-runtime"] as const), load: async () => ({ kind: "PROMOTED_POINTERS", entries: [entry] }) } }, async () => {
      await readRegistryRuntimeProjection([state]); await Promise.resolve();
      return getRegistryRuntimeReadModel().registry.bodies.map(body => body.id);
    });
  })));
  assert.deepEqual(values, ["AZ", "NH"].map(state => registryFixtureForState(state).registry.bodies.map(body => body.id)));
});

test("a changed fact publishes one record while retaining the unchanged serving records", async () => {
  const dir = mkdtempSync(join(tmpdir(), "site-update-"));
  try {
    const store = new LocalFileArtifactStore(dir);
    const rows = Array.from({ length: 100 }, (_, id) => ({ id: `body:${id}`, name: `Body ${id}` }));
    const old = await publishAuthorityRecords({ rows }, store);
    let writes = 0;
    const counting = new Proxy(store, { get(target, key) {
      if (key === "putImmutable") return async (...args: Parameters<typeof store.putImmutable>) => { writes++; return target.putImmutable(...args); };
      const held = Reflect.get(target, key); return typeof held === "function" ? held.bind(target) : held;
    } });
    const changed = { rows: rows.map(row => row.id === "body:50" ? { ...row, name: "Changed from the source" } : row) };
    const next = await publishAuthorityRecords(changed, counting, old);
    assert.equal(writes, 1);
    assert.deepEqual(await readAuthorityRecords(next, store), changed);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("warm authority reads retain the identifiers needed to load a shown person's facts", async () => {
  const dir = mkdtempSync(join(tmpdir(), "site-warm-"));
  try {
    const store = new LocalFileArtifactStore(dir);
    const bodyId = "ocd-division/country:us/state:az/county:pima#board";
    const value = { registry: { bodies: [{ ...registryFixtureForState("AZ").registry.bodies[0]!, id: bodyId, ocdId: bodyId.split("#")[0] }] }, bodyRosters: [{ bodyId, bodyName: "County board", sourceUrl: "https://example.gov/board", sourceOrg: "County board", collectedAt: "2026-10-16", partisanship: "NONPARTISAN" as const,
      members: [{ id: "roster:one", name: "One", officeTitle: "Board member", termNote: null, email: null, phone: null, websiteUrl: null, fieldSources: {}, membershipSource: { sourceUrl: "https://example.gov/board", sourceOrg: "County board", collectedAt: "2026-10-16" } }] }] };
    await publishPointers(store, { stateAuthorities: { "registry-runtime": stateRegistryArtifacts("warm-version", ["AZ"], {
      ...registryFixtureForState("AZ"), registry: { ...registryFixtureForState("AZ").registry, bodies: value.registry.bodies }, bodyRosters: value.bodyRosters,
    }) } });
    await store.writeJsonPointer(stateFactsPointerKey("AZ"), { state: "AZ", versionId: "warm-facts", buckets: [await writeFactBucket(store, "AZ", 0, "warm-facts",
      await publishAuthorityRecords({ bodies: [{ id: bodyId, division: bodyId.split("#")[0], fields: {},
        roster: value.bodyRosters[0], dispositions: [], comment: null, sittings: [] }] }, store), "2026-10-16T12:00:00.000Z")] }, null);
    for (let visit = 0; visit < 2; visit++) {
      const selection = { keys: new Set([bodyId]) };
      await withReaderSelection(selection, async () => {
        const edge = await ensureReaderAuthorityEdge(null, store, ["registry-runtime"]);
        await withReaderAuthorityEdge(edge, async () => {
          const read = await readRegistryRuntimeProjection(["AZ"]);
          assert.equal(read.kind, "PROMOTED");
          assert.deepEqual(read.value?.bodyRosters, value.bodyRosters);
          assert.ok(selection.keys.has("roster:one"));
        });
      });
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a later named body loads its live facts without reopening the state registry or another state", async () => {
  const dir = mkdtempSync(join(tmpdir(), "site-named-body-"));
  try {
    const store = new LocalFileArtifactStore(dir), division = "ocd-division/country:us/state:az/county:pima";
    const bodyIds = [`${division}#board`, "ocd-division/country:us/state:az/place:vail#board"];
    const bodies = bodyIds.map((id, n) => ({ id, division: id.split("#")[0], fields: {},
      roster: { bodyId: id, bodyName: `Body ${n}`, members: [{ id: `member:${n}`, name: `Member ${n}` }],
        sourceUrl: `https://example.gov/body/${n}`, sourceOrg: `Body ${n}`, collectedAt: "2026-10-16", partisanship: "NONPARTISAN" },
      dispositions: [], comment: null, sittings: [] }));
    const index = await publishAuthorityRecords({ bodies }, store), laterKey = index.records.find(row => row.tags.includes(bodyIds[1]))!.key;
    const payload = { ...registryFixtureForState("AZ"), bodyRosters: [] };
    await publishPointers(store, { stateAuthorities: { "registry-runtime": stateRegistryArtifacts("named-body", ["AZ"], payload) } });
    await store.writeJsonPointer(stateFactsPointerKey("AZ"), { state: "AZ", versionId: "named-facts",
      buckets: [await writeFactBucket(store, "AZ", 0, "named-facts", index, "2026-10-16T12:00:00.000Z")] }, null);
    const registryKey = (await readServedPointer(store, authorityPointerKey("registry-runtime", "AZ")))!.ref.key, reads: string[] = [];
    const counting = new Proxy(store, { get(target, key) {
      if (key === "readBytes") return async (path: string) => { reads.push(path); return target.readBytes(path); };
      const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
    } });
    const selection = { states: ["AZ"], keys: new Set([division]) };
    await withReaderSelection(selection, async () => {
      const edge = await ensureReaderAuthorityEdge(null, counting, ["registry-runtime"]);
      await withReaderAuthorityEdge({ ...edge!, edgeOnly: true }, async () => {
        const first = await readRegistryRuntimeProjection(["AZ"]);
        assert.deepEqual(first.value?.bodyRosters.map(row => row.bodyId), [bodyIds[0]]);
        assert.equal(reads.includes(laterKey), false);
        selection.keys.add(bodyIds[1]);
        const expanded = await readRegistryRuntimeProjection(["AZ"], { bypassCache: true });
        assert.deepEqual(expanded.value?.bodyRosters.map(row => row.bodyId).sort(), bodyIds.toSorted());
        assert.equal(expanded.value?.bodyRosters.find(row => row.bodyId === bodyIds[1])?.sourceUrl, "https://example.gov/body/1");
        assert.equal(reads.includes(laterKey), true);
      });
    });
    assert.equal(reads.filter(key => key === registryKey).length, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
