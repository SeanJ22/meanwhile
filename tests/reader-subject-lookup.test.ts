import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { knownBodySubjectIds } from "../lib/registry/server.ts";
import { deliveredAskText } from "../lib/ask/answer.ts";
import { withReaderAuthorityEdge } from "../lib/registry/runtime-edge.ts";
import { registryFixtureForState } from "./helpers/promoted-fixtures.ts";
import { provenEdgeEntry } from "./helpers/promoted-edge-entry.ts";
import { stateRegistryRuntimeScope } from "../lib/civic-data/state-scopes.ts";

test("demand checks one published body or alias without loading a state package", async () => {
  const pg = new PGlite();
  try {
    await pg.exec(`CREATE TABLE entity(id text PRIMARY KEY,kind text NOT NULL);
      CREATE TABLE entity_external_id(entity_id text,scheme text,value text);
      INSERT INTO entity VALUES ('body:one','body'),('place:one','place'),('person:one','person');
      INSERT INTO entity_external_id VALUES ('body:one','body-alias','body:old');`);
    let reads = 0;
    const query = async (text: string, params: readonly unknown[] = []) => {
      reads++;
      return (await pg.query<Record<string, unknown>>(text, [...params])).rows;
    };
    for (const id of ['body:one', 'body:old', 'place:one']) assert.deepEqual([...await knownBodySubjectIds(id, query)], [id]);
    for (const id of ['person:one', 'body:unknown']) assert.equal((await knownBodySubjectIds(id, query)).size, 0);
    assert.equal(reads, 5, "one bounded identity query per subject, with no registry or ballot dependency");
    await assert.rejects(() => knownBodySubjectIds('body:one', async () => { throw new Error('database unavailable'); }), /database unavailable/);
  } finally { await pg.close(); }
});

test("the recorded Ask reply includes the labelled AI answer the reader received", () => {
  assert.equal(deliveredAskText({ answer: "We don't have that answer yet.", aiAnswer: "The school board oversees the district." }),
    "We don't have that answer yet.\n\nAI answer\nThe school board oversees the district.");
  assert.equal(deliveredAskText({ answer: "A sourced answer." }), "A sourced answer.");
  assert.equal(deliveredAskText({ answer: null }), null);
});

test("demand uses the installed edge authority without a database subject read", async () => {
  const state = "AZ", scope = stateRegistryRuntimeScope(state), value = registryFixtureForState(state);
  const id = value.registry.bodies[0]!.id;
  const entry = provenEdgeEntry({ recordClass: "REGISTRY_RUNTIME_BINDING", scope, sourceId: "registry-reviewed-bindings",
    versionId: "test:ob01-subject-edge", value });
  let databaseReads = 0;
  await withReaderAuthorityEdge({ edgeOnly: true, selection: { states: [state], keys: new Set([id]) },
    stateAuthorities: { families: new Set(["registry-runtime"]), load: async () => ({ kind: "PROMOTED_POINTERS", entries: [entry] }) } }, async () => {
    const known = await knownBodySubjectIds(id, async () => { databaseReads++; throw new Error("The edge must not read the database"); });
    assert.ok(known.has(id));
  });
  assert.equal(databaseReads, 0);
});
