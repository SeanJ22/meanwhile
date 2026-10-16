import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { publishAuthorityRecords, readAuthorityRecords } from "../lib/meetings/authority-records.ts";
import { LocalFileArtifactStore } from "../lib/meetings/edge-store-local.ts";
import { readerRoute } from "../lib/api/reader-route.ts";
import { currentReaderRoute } from "../lib/db/reader-route.ts";
import { currentReaderSelection, withReaderSelection } from "../lib/db/reader-route.ts";
import { publishReaderEdgeArtifacts, readAuthorityArtifactValue } from "../lib/meetings/edge-serving.ts";
import { withReaderAuthorityEdge } from "../lib/registry/runtime-edge.ts";
import { getRegistryRuntimeReadModel, readRegistryRuntimeProjection } from "../lib/registry/runtime-read-model.ts";
import type { RegistryRuntimeReadModel } from "../lib/registry/runtime-data-plane.ts";
import { installFactReader } from "../lib/facts/db.ts";

test("a cooked registry edge hit never rereads facts, including an explicit reader refresh", async () => {
  const fixture = JSON.parse(gunzipSync(readFileSync(new URL("./fixtures/registry-transfer-import.json.gz", import.meta.url))).toString("utf8")) as {
    projection: { payload: RegistryRuntimeReadModel };
  };
  const value = fixture.projection.payload;
  let queries = 0;
  installFactReader(async () => { queries++; throw new Error("Unexpected fact query on an edge hit"); });
  try {
    await withReaderSelection({ keys: new Set(["ocd-division/country:us/state:az/county:pima"]) }, () =>
      withReaderAuthorityEdge({ registryRuntime: { value, versionId: "test:fact-edge" } }, async () => {
        const read = await readRegistryRuntimeProjection({ bypassCache: true });
        assert.equal(read.kind, "BOOTSTRAP");
        assert.ok("value" in read);
        assert.equal(read.value, value);
        assert.equal(getRegistryRuntimeReadModel(), value);
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
  const values = await Promise.all(["pima", "albany"].map(id => withReaderSelection({ keys: new Set([id]) }, () => withReaderAuthorityEdge({
    registryRuntime: { versionId: "shared-version", value: { registry: { bodies: [{ id }] } } as RegistryRuntimeReadModel },
  }, async () => {
    await Promise.resolve();
    return getRegistryRuntimeReadModel().registry.bodies[0].id;
  }))));
  assert.deepEqual(values, ["pima", "albany"]);
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
    const value = { registry: { bodies: [{ id: bodyId }] }, bodyRosters: [{ bodyId, members: [{ id: "roster:one", name: "One" }] }] };
    await publishReaderEdgeArtifacts(null, { sourceThrough: null, retrievedAt: null, promotedThrough: null }, {
      store, authority: { "registry-runtime": { value, versionId: "warm-version" } },
    });
    const ref = (await store.readManifest())!.manifest.authorityArtifacts!["registry-runtime"];
    for (let visit = 0; visit < 2; visit++) {
      const selection = { keys: new Set([bodyId]) };
      await withReaderSelection(selection, async () => {
        assert.deepEqual(await readAuthorityArtifactValue("registry-runtime", ref, store), value);
        assert.ok(selection.keys.has("roster:one"));
      });
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
