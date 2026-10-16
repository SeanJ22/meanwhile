import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { authorityRecordSource, publishAuthorityRecords, publishStateAuthorityRecords, readAuthorityRecords, type StateRecordPublication } from "../lib/meetings/authority-records.ts";
import { LocalFileArtifactStore } from "../lib/meetings/edge-store.ts";
import { readerRoute } from "../lib/api/reader-route.ts";
import { currentReaderRoute } from "../lib/db/reader-route.ts";
import { currentReaderSelection, withReaderSelection } from "../lib/db/reader-route.ts";
import { publishReaderEdgeArtifacts, readReaderEdgeMeetings, readAuthorityArtifactValue, ensureReaderAuthorityEdge } from "../lib/meetings/edge-serving.ts";
import { withReaderAuthorityEdge } from "../lib/registry/runtime-edge.ts";
import { getRegistryRuntimeReadModel, readRegistryRuntimeProjection } from "../lib/registry/runtime-read-model.ts";
import type { RegistryRuntimeReadModel } from "../lib/registry/runtime-data-plane.ts";
import { publishRegistryStateAuthority, publishCommentStateAuthority } from "../lib/civic-data/state-authority-publication.ts";
import type { RoutineDataStore } from "../lib/civic-data/store.ts";
import { sha256OfJson } from "../lib/meetings/edge-artifacts.ts";
import { currentCommentAccess, primeCommentAccess } from "../lib/registry/comment-access.ts";
import { installFactReader } from "../lib/facts/db.ts";

test("key-vote cards retain the catalog and held rolls with only the requested member's positions", async () => {
  const dir = mkdtempSync(join(tmpdir(), "site-key-votes-"));
  try {
    const value = { selectionVersion: "v1", snapshot: { entries: [{ id: "held-law", title: "Held law" }] },
      positions: { positions: { "held-law|senate|119-1:1": { "congress:A000001": "YES", "congress:B000002": "NO" }, "held-law|senate|119-1:2": {} } } };
    const store = new LocalFileArtifactStore(dir);
    const index = await publishAuthorityRecords(value, store);
    const read = await readAuthorityRecords(index, store, { keys: new Set(["congress:A000001"]) });
    assert.deepEqual(read, { ...value, positions: { positions: { "held-law|senate|119-1:1": { "congress:A000001": "YES" }, "held-law|senate|119-1:2": {} } } });
    const missing = await readAuthorityRecords(index, store, { keys: new Set(["congress:C000003"]) });
    assert.deepEqual(missing, { ...value, positions: { positions: { "held-law|senate|119-1:1": {}, "held-law|senate|119-1:2": {} } } });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

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
      officialPhotos: { photos: [{ officeholderId: member.id, url: "/portrait.png" }] },
      rosterReaderDispositions: [{ sourceId: member.id, canonicalId: member.id, state: "READER_ELIGIBLE" },
        ...Array.from({ length: 20_000 }, (_, n) => ({ sourceId: `foreign:${n}`, canonicalId: `foreign:${n}`, state: "READER_ELIGIBLE" }))] };
    const index = await publishAuthorityRecords(value, store);
    const reads: string[] = [];
    const counting = new Proxy(store, { get(target, key) {
      if (key === "readBytes") return async (path: string) => { reads.push(path); return target.readBytes(path); };
      const held = Reflect.get(target, key); return typeof held === "function" ? held.bind(target) : held;
    } });
    const selected = await readAuthorityRecords(index, counting, { keys: new Set([pima]) }) as typeof value;
    assert.deepEqual(selected.bodyRosters, [value.bodyRosters[0]]);
    assert.deepEqual(selected.officialPhotos, value.officialPhotos);
    assert.deepEqual(selected.registry.divisions, [value.registry.divisions[0]]);
    assert.deepEqual(selected.rosterReaderDispositions, [value.rosterReaderDispositions[0]]);
    assert.ok(reads.length < 10);
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
    assert.ok(writes <= 9, `one record and its bounded index branch change: ${writes}`);
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

test("opening a page before choosing a place never opens a national family", async () => {
  const dir = mkdtempSync(join(tmpdir(), "site-empty-place-"));
  const previous = process.env.WTP_READER_EDGE_DIR;
  const readBytes = LocalFileArtifactStore.prototype.readBytes;
  let reads = 0;
  try {
    const store = new LocalFileArtifactStore(dir);
    await publishReaderEdgeArtifacts(null, { sourceThrough: null, retrievedAt: null, promotedThrough: null }, {
      store, authority: { "registry-runtime": { value: { rows: [{ id: "foreign-body" }] }, versionId: "unrequested" } },
    });
    process.env.WTP_READER_EDGE_DIR = dir;
    LocalFileArtifactStore.prototype.readBytes = async () => { reads++; throw new Error("A place form opened the country"); };
    const page = readerRoute("/example", async () => "Choose a place", ["registry-runtime"]);
    assert.equal(await page(), "Choose a place");
    assert.equal(reads, 0);
  } finally {
    LocalFileArtifactStore.prototype.readBytes = readBytes;
    if (previous === undefined) delete process.env.WTP_READER_EDGE_DIR; else process.env.WTP_READER_EDGE_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("unique provider identifiers cannot turn the root into a national identity catalog", async () => {
  const root = mkdtempSync(join(tmpdir(), "reader-kinds-"));
  try {
    const division = "ocd-division/country:us/state:ca/place:sample";
    const records = Array.from({ length: 5000 }, (_, n) => ({ id: `provider-${n}:candidate`, ocdId: n === 0 ? division : "ocd-division/country:us/state:tx/place:other" }));
    const store = new LocalFileArtifactStore(root);
    const index = await publishAuthorityRecords({ records }, store);
    assert.ok(Buffer.byteLength(JSON.stringify(index)) < 1024);
    assert.deepEqual(await readAuthorityRecords(index, store, { keys: new Set([division]) }), { records: [records[0]] });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a state's common division prefix costs no serial blob reads", async () => {
  const root = mkdtempSync(join(tmpdir(), "reader-prefix-"));
  try {
    const records = Array.from({ length: 1000 }, (_, n) => ({ ocdId: `ocd-division/country:us/state:ca/place:${n}` }));
    const store = new LocalFileArtifactStore(root);
    const index = await publishAuthorityRecords({ records }, store);
    const read = store.readBytes.bind(store);
    let reads = 0;
    store.readBytes = key => { reads++; return read(key); };
    assert.deepEqual(await readAuthorityRecords(index, store, { keys: new Set([records[0].ocdId]) }), { records: [records[0]] });
    assert.ok(reads <= 5, `${reads} blob reads for one division`);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("reader bundles omit rejected source records from the promotion receipt", async () => {
  const root = mkdtempSync(join(tmpdir(), "reader-receipt-"));
  try {
    const division = "ocd-division/country:us/state:ca/place:sample";
    const body = { id: `${division}#board`, ocdId: division };
    const value = { entries: [{ kind: "PROMOTED", projection: { recordClass: "REGISTRY_RUNTIME_BINDING", scope: "US",
      payload: { bodies: [body] }, receipt: { excludedFacts: Array.from({length: 20000}, (_, n) => ({ key: `rejected:${n}`, detail: `not admitted ${n}` })) } } }] };
    const store = new LocalFileArtifactStore(root);
    const index = await publishAuthorityRecords(value, store);
    let bytes = 0;
    const counted = new Proxy(store, {get(target, key) {
      if (key === "readBytes") return async (path: string) => { const value = await target.readBytes(path); bytes += value?.length ?? 0; return value; };
      const value = Reflect.get(target,key); return typeof value === "function" ? value.bind(target) : value;
    }});
    const result = await readAuthorityRecords(index, counted, {keys: new Set([division])}) as typeof value;
    assert.deepEqual(result.entries[0].projection.payload.bodies, [body]);
    assert.ok(bytes < 10000);
  } finally { rmSync(root,{recursive:true,force:true}); }
});

test("a candidate's derived links and recorded source searches stay scoped to their identity", async () => {
  const root = mkdtempSync(join(tmpdir(), "reader-candidate-"));
  try {
    const own = "ballot-ca:local:person";
    const other = "ballot-tx:foreign:person";
    const value = { records: [{ id: "derived:own", candidacyId: own }, { id: "derived:other", candidacyId: other }],
      cards: { cards: {}, hunts: [{key: own, note: "searched"}, {key: other, note: "searched"}] } };
    const store = new LocalFileArtifactStore(root);
    const index = await publishAuthorityRecords(value,store);
    assert.deepEqual(await readAuthorityRecords(index,store,{keys:new Set([own])}), {
      records: [value.records[0]], cards: {cards: {}, hunts:[value.cards.hunts[0]]},
    });
  } finally { rmSync(root,{recursive:true,force:true}); }
});

test("an uncovered place gets empty verified holdings rather than an unavailable source", async () => {
  const { provenEdgeEntry } = await import("./helpers/promoted-edge-entry.ts");
  const { readVotingSitesProjection } = await import("../lib/ballot/voting-sites-server.ts");
  const { VOTING_SITES_CONTRACT } = await import("../lib/ballot/voting-sites-data-plane.ts");
  const { readExecutiveActionsProjection } = await import("../lib/officials/executive-actions.ts");
  const { AZ_OFFICIAL_ACTIONS_CONTRACT } = await import("../lib/outcomes/data-plane.ts");
  const voting = provenEdgeEntry({ ...VOTING_SITES_CONTRACT, versionId: "held-voting", value: { generatedAt: "2026-10-15", jurisdictions: [] } });
  const actions = provenEdgeEntry({ ...AZ_OFFICIAL_ACTIONS_CONTRACT, versionId: "held-actions", value: { actions: [] } });
  await assert.rejects(() => readVotingSitesProjection({edge: voting}));
  await assert.rejects(() => readExecutiveActionsProjection({edge: actions}));
  await withReaderSelection({keys:new Set(["ocd-division/country:us/state:ak"])}, async () => {
    assert.equal((await readVotingSitesProjection({edge:voting})).kind,"PROMOTED");
    assert.equal((await readExecutiveActionsProjection({edge:actions})).kind,"PROMOTED");
  });
});

test("a member's vote rows carry their descriptions without selecting other members", async () => {
  const root=mkdtempSync(join(tmpdir(),"reader-votes-"));
  try {
    const own="congress:A000001",other="congress:B000002";
    const value={ snapshot:{ votes:[{id:"senate:119:1",title:"Held vote"},{id:"senate:119:2",title:"Other vote"}],
      positions:[{officeholderId:own,voteId:"senate:119:1",position:"YES"},{officeholderId:other,voteId:"senate:119:1",position:"NO"}] } };
    const store=new LocalFileArtifactStore(root);const index=await publishAuthorityRecords(value,store);
    assert.deepEqual(await readAuthorityRecords(index,store,{keys:new Set([own])}), {
      snapshot:{votes:[{...value.snapshot.votes[0],readerPartyVoters:{yes:[own],no:[other]}}],positions:[value.snapshot.positions[0]]},
    });
    const state={rollCalls:[{id:"nj:1",billTitle:"Held"}],positions:[
      {officeholderId:own,rollCallId:"nj:1",position:"YES"},{officeholderId:other,rollCallId:"nj:1",position:"NO"}]};
    const stateIndex=await publishAuthorityRecords(state,store);
    assert.deepEqual(await readAuthorityRecords(stateIndex,store,{keys:new Set([own])}),{rollCalls:state.rollCalls,positions:[state.positions[0]]});
  } finally { rmSync(root,{recursive:true,force:true}); }
});

test("explicit government identities scope a reader before its holding is loaded", async () => {
  const government="government:US-CA:cog:12345";
  const read=readerRoute("/api/ask/grounded",async (_request:Request) => [...currentReaderSelection()?.keys ?? []]);
  assert.deepEqual(await read(new Request("https://example.test/api/ask/grounded",{method:"POST",body:JSON.stringify({governmentIds:[government]})})),[government]);
});

test("a provider's meeting places survive across every selected state", async () => {
  const root=mkdtempSync(join(tmpdir(),"reader-state-places-"));
  try {
    const own="ocd-division/country:us/state:az/county:pima",neighbor="ocd-division/country:us/state:nm/county:hidalgo";
    const store=new LocalFileArtifactStore(root);
    await publishReaderEdgeArtifacts(null,{sourceThrough:null,retrievedAt:null,promotedThrough:null},{store,meetingPlaces:{legistar:[own,neighbor]}});
    const manifest=(await store.readManifest())!.manifest;
    await withReaderSelection({keys:new Set([own,neighbor])},async()=>{
      const edge=await ensureReaderAuthorityEdge({...manifest,authorityArtifacts:{}},store,[]);
      assert.deepEqual(edge.meetingPlaces?.get("legistar"),[own,neighbor]);
    });
  } finally { rmSync(root,{recursive:true,force:true}); }
});

test("fact publication opens only the state that changed, and direct person links locate their state", async () => {
  const root = mkdtempSync(join(tmpdir(), "reader-state-facts-"));
  try {
    const store = new LocalFileArtifactStore(root), ca = "ocd-division/country:us/state:ca/place:sample", tx = "ocd-division/country:us/state:tx/place:other";
    const holding = (division: string, person: string, phone: string) => ({
      registry: { divisions: [{ ocdId: division }], bodies: [{ id: division + "#board", ocdId: division }] },
      bodyRosters: [{ bodyId: division + "#board", members: [{ id: person, personId: person, phone }] }],
      rosterReaderDispositions: [{ sourceId: person, canonicalId: person, state: "READER_ELIGIBLE" }],
    });
    const california = holding(ca, "ocd-person/one", "555-0100"), texas = holding(tx, "ocd-person/two", "555-0200");
    async function* inputs(changed: boolean): AsyncGenerator<StateRecordPublication> {
      const base = authorityRecordSource(california).base;
      yield { state: "ca", version: changed ? "2" : "1", base, replace: !changed, places: async function* () {
        yield { owner: ca, version: changed ? "2" : "1", load: async () => authorityRecordSource(changed ? holding(ca, "ocd-person/one", "555-0300") : california) };
      } };
      yield { state: "tx", version: "1", base, replace: !changed, places: async function* () {
        if (changed) throw new Error("Unchanged state opened");
        yield { owner: tx, version: "1", load: async () => authorityRecordSource(texas) };
      } };
    }
    const first = await publishStateAuthorityRecords(inputs(false), store);
    assert.deepEqual(await readAuthorityRecords(first, store, { keys: new Set(["ocd-person/two"]) }), texas);
    const read = store.readBytes.bind(store);
    store.readBytes = key => { assert.notEqual(key, first.shards.tx.key); return read(key); };
    const next = await publishStateAuthorityRecords(inputs(true), store, first);
    assert.deepEqual(next.shards.tx, first.shards.tx);
    assert.deepEqual(next.aliases, first.aliases);
    assert.deepEqual(await readAuthorityRecords(next, store, { keys: new Set([ca]) }), holding(ca, "ocd-person/one", "555-0300"));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a ballot selection carries only its own election metadata", async () => {
  const directory = mkdtempSync(join(tmpdir(), "site-ballot-frames-"));
  try {
    const store = new LocalFileArtifactStore(directory);
    const own = "ocd-division/country:us/state:ca/place:one";
    const ballots = Object.fromEntries(Array.from({ length: 1000 }, (_, n) => [`election:${n}`, {
      election: { id: `election:${n}`, title: `Official election ${n}`, source: "Source context ".repeat(300) },
      contests: [{ id: `contest:${n}`, ocdId: n === 0 ? own : `ocd-division/country:us/state:tx/place:${n}`, title: `Contest ${n}` }],
      candidacies: [{ id: `candidacy:${n}`, contestId: `contest:${n}`, personId: `person:${n}` }],
    }]));
    const index = await publishAuthorityRecords({ ballots }, store);
    assert.ok(Buffer.byteLength(JSON.stringify(index.base)) < 100);
    const actual = await readAuthorityRecords(index, store, { keys: new Set([own]) }) as { ballots: typeof ballots };
    assert.deepEqual(actual.ballots, { "election:0": { ...ballots["election:0"], districtFamilies: [] } });
    assert.ok(Buffer.byteLength(JSON.stringify(actual)) < 10_000);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("a changed place patches its index without opening the other places in its state", async () => {
  const directory = mkdtempSync(join(tmpdir(), "site-place-update-"));
  try {
    const store = new LocalFileArtifactStore(directory);
    const value = (n: number, phone: string) => ({ bodies: [{ id: `ocd-division/country:us/state:ca/place:${n}#board`, ocdId: `ocd-division/country:us/state:ca/place:${n}`, phone }] });
    const base = { bodies: [] };
    let loads = 0;
    async function* input(changed: boolean): AsyncGenerator<StateRecordPublication> {
      yield { state: "ca", version: changed ? "2" : "1", base, replace: !changed, places: async function* () {
        for (const n of changed ? [17] : Array.from({ length: 300 }, (_, n) => n)) yield {
          owner: `ocd-division/country:us/state:ca/place:${n}`, version: changed ? "2" : "1", load: async () => {
            loads++;
            const source = authorityRecordSource(value(n, changed ? "555-0200" : "555-0100"));
            return { base, records: source.records.map(row => ({ ...row, path: ["bodies", n] })) };
          },
        };
      } };
    }
    const first = await publishStateAuthorityRecords(input(false), store);
    loads = 0;
    const next = await publishStateAuthorityRecords(input(true), store, first);
    assert.equal(loads, 1);
    assert.deepEqual(next.aliases, first.aliases);
    for (const n of [0, 17, 299]) assert.deepEqual(await readAuthorityRecords(next, store, {
      keys: new Set([`ocd-division/country:us/state:ca/place:${n}`]),
    }), value(n, n === 17 ? "555-0200" : "555-0100"));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});


test("uncovered places retain their own state's source reports on a reused reader", async () => {
  const directory = mkdtempSync(join(tmpdir(), "site-empty-states-"));
  try {
    const store = new LocalFileArtifactStore(directory);
    const states = ["az", "nh"];
    const sources = states.map(state => ({ ok: true, error: null, fetched: 0, normalized: 0,
      drops: { placeless: 0, unknownVenue: 0, unplaceableInTime: 0, notConfigured: 0 }, source: `${state}-calendar`,
      bodyId: `ocd-division/country:us/state:${state}#board` }));
    const snapshot = { formatVersion: 1 as const, generatedAt: "2026-10-16T00:00:00Z", meetings: [], agendaDocuments: [], sources, counts: { fresh: 0, carried: 0, total: 0 } };
    assert.equal((await publishReaderEdgeArtifacts(snapshot, { sourceThrough: null, retrievedAt: null, promotedThrough: null }, { store })).status, "PUBLISHED");
    const manifest = (await store.readManifest())!.manifest;
    for (const state of states) {
      const id = `ocd-division/country:us/state:${state}`;
      const read = await withReaderSelection({ keys: new Set([id]) }, () => readReaderEdgeMeetings({ store, manifest,
        states: [state], ocdIds: [id], fallback: async () => { throw new Error("Unexpected miss"); } }));
      assert.ok(read.kind === "PROMOTED" || read.kind === "BOOTSTRAP");
      assert.deepEqual(read.value.sources.map(row => row.source), [`${state}-calendar`]);
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});


test("a new accepted portrait refreshes a place whose geography and facts did not change", async () => {
  const directory = mkdtempSync(join(tmpdir(), "site-portrait-version-"));
  try {
    const artifacts = new LocalFileArtifactStore(directory);
    const own = "ocd-division/country:us/state:az";
    const base = { formatVersion: 1, registry: { bodies: [], divisions: [] }, statewideExecutives: [],
      officialCandidacies: { rows: [] }, officialPhotos: { photos: [] }, rosterPhotos: {} };
    const records = authorityRecordSource({ statewideExecutives: [{ stateOcdId: own, holder: { id: "held-official" } }] }).records;
    let versionId = "one", photoReads = 0, failRead = false, carrying = false;
    const methods = {
      readPromotionIdentity: async () => ({ versionId }),
      readPromotionBase: async () => { assert.equal(carrying, false); return base; },
      listPromotionStates: async () => ["az"],
      listPromotionPlaces: async (_class: unknown, _scope: unknown, _version: unknown, _state: unknown, after: string) => after ? [] : [{ owner: own, version: "same-geography" }],
      readPromotionPlace: async () => { assert.equal(carrying, false); if (failRead) throw new Error("Temporary place read failure"); return { base, records }; },
      readRegistryPhotos: async () => { photoReads++; return { officialPhotos: { photos: [{ officeholderId: "held-official", url: `https://example.gov/${versionId}.jpg` }] }, rosterPhotos: {} }; },
    };
    const store = new Proxy(methods, { get(target, key) { if (key in target) return Reflect.get(target, key); throw new Error(`Unexpected read ${String(key)}`); } }) as unknown as RoutineDataStore;
    const first = await publishRegistryStateAuthority({ store, artifacts, served: undefined, query: null, onFailure: (_state, error) => { throw error; } });
    assert.ok(first && "index" in first);
    const served = { key: await artifacts.putImmutable(gzipSync(Buffer.from(JSON.stringify({ value: first.index }))), "json.gz"),
      sha: sha256OfJson(first.index), version: first.versionId, layout: "places" as const };
    carrying = true; photoReads = 0;
    assert.deepEqual(await publishRegistryStateAuthority({ store, artifacts, served, query: null, onFailure: (_state, error) => { throw error; } }),
      { carried: true, versionId: served.version });
    assert.equal(photoReads, 0);
    carrying = false;
    versionId = "two"; photoReads = 0; failRead = true;
    let failures = 0;
    const partial = await publishRegistryStateAuthority({ store, artifacts, served, query: null, onFailure: () => { failures++; } });
    assert.ok(partial && "index" in partial);
    assert.equal(failures, 1);
    assert.deepEqual(partial.index.shards.az, first.index.shards.az);
    const retained = { key: await artifacts.putImmutable(gzipSync(Buffer.from(JSON.stringify({ value: partial.index }))), "json.gz"),
      sha: sha256OfJson(partial.index), version: partial.versionId, layout: "places" as const };
    failRead = false;
    const next = await publishRegistryStateAuthority({ store, artifacts, served: retained, query: null, onFailure: (_state, error) => { throw error; } });
    assert.ok(next && "index" in next);
    const value = await readAuthorityRecords(next.index, artifacts, { keys: new Set([own]) }) as { officialPhotos: { photos: { url: string }[] } };
    assert.equal(photoReads, 1);
    assert.equal(value.officialPhotos.photos[0].url, "https://example.gov/two.jpg");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("unchanged comment clocks carry the served artifact without opening fact payloads", async () => {
  const directory = mkdtempSync(join(tmpdir(), "site-comment-carry-"));
  try {
    const artifacts = new LocalFileArtifactStore(directory);
    const first = await publishCommentStateAuthority({ artifacts, served: undefined, query: null, onFailure: (_state, error) => { throw error; } });
    assert.ok("index" in first);
    const served = { key: await artifacts.putImmutable(gzipSync(Buffer.from(JSON.stringify({ value: first.index }))), "json.gz"),
      sha: sha256OfJson(first.index), version: first.versionId, layout: "places" as const };
    let queries = 0;
    const carried = await publishCommentStateAuthority({ artifacts, served, query: async sql => {
      queries++;
      assert.match(sql, /^SELECT state,revision::text FROM reader_fact_state_versions/);
      return [];
    }, onFailure: (_state, error) => { throw error; } });
    assert.deepEqual(carried, { carried: true, versionId: served.version });
    assert.equal(queries, 1);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});


test("concurrent places keep their own comment rules after a database miss", async () => {
  let ready = 0;
  let release!: () => void;
  const bothPrimed = new Promise<void>(resolve => { release = resolve; });
  await Promise.all(["az", "nh"].map(state => withReaderSelection({ keys: new Set([`ocd-division/country:us/state:${state}`]) }, async () => {
    const record = { id: state, bodyId: `${state}-board`, ocdId: null, commentPeriod: "YES" as const,
      commentPeriodDetail: null, signup: null, writtenComment: null, attend: null, timeLimit: null,
      sourceUrl: `https://${state}.gov/rules`, collectedAt: "2026-10-16", verifiedAt: "2026-10-16T00:00:00.000Z" };
    primeCommentAccess({ kind: "comment-access", records: [record] });
    if (++ready === 2) release();
    await bothPrimed;
    assert.deepEqual(currentCommentAccess().map(rule => rule.bodyId), [record.bodyId]);
  })));
});
