import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { MEETING_DERIVATION_SOURCE_SQL, readMeetingDerivationSource, meetingDerivationPending,
  confirmMeetingDerivationSource, type MeetingDerivationSource } from "../lib/civic-data/meeting-derivation-source.ts";
import { derivedSourceContentHash } from "../lib/civic-data/derived-source-hash.ts";
import type { SourceHead } from "../lib/civic-data/store.ts";

const at = "2026-10-26T12:00:00.000Z", scope = "US:meeting-body-crosswalk-derived";
const head: SourceHead = { sourceId: "meeting-source-wiring", recordClass: "CURATED_READER_RECORD", scope,
  versionId: "output", lastKnownGoodVersionId: "output", rawHash: null, rawHashBasis: "SOURCE_CONTENT_V1", normalizedHash: "a".repeat(64),
  parserVersion: "meeting-source-wiring/1", promotedAt: at, candidateState: "PROMOTED", acquisitionSucceeded: true, imported: false };

test("meeting derivations transfer source metadata and resume only incomplete or changed governments", async () => {
  const rows = [{ id: "government:a", position: "1", state: "AZ", jurisdiction: "government:a", attempt_id: "walk:a", recorded_at: at,
    routes: ["https://example.gov/calendar"], artifacts: [] }];
  let probe: unknown = null;
  const store = { async readSourceHead(_kind: string, requested: string) { return { ...head, scope: requested, versionId: requested, lastKnownGoodVersionId: requested }; },
    async readCandidatePath<T>(_id: string, path: readonly string[]) { assert.deepEqual(path, ["normalizedPayload", "sourceProbe"]); return probe as T; } };
  const input = { store, query: async () => rows, sourceId: head.sourceId, recordClass: head.recordClass, scope, configHash: "config:a" };
  const first = await readMeetingDerivationSource(input);
  assert.deepEqual(meetingDerivationPending(first), ["government:a"]);
  probe = { formatVersion: 1, sourceId: head.sourceId, complete: true, groups: first.groupHashes, pending: [], normalizationInputHash: first.normalizationInputHash };
  const checked = await readMeetingDerivationSource(input);
  assert.deepEqual(meetingDerivationPending(checked), []);
  assert.deepEqual(meetingDerivationPending(checked, true), ["government:a"]);
  const changed = await readMeetingDerivationSource({ ...input, configHash: "config:b" });
  assert.deepEqual(meetingDerivationPending(changed), ["government:a"]);
  probe = { ...(probe as object), complete: false, pending: ["government:a"] };
  assert.deepEqual(meetingDerivationPending(await readMeetingDerivationSource(input)), ["government:a"]);
  const absent = await readMeetingDerivationSource({ ...input, query: async () => [], groups: { "government:new": "AZ" } });
  assert.deepEqual(meetingDerivationPending(absent), ["government:new"], "a reviewed government with no saved walk remains a dependency");
  assert.deepEqual(absent.groupStates, { "government:new": "AZ" });
});

test("completed metadata confirms the raw source digest; pending work and normalization changes cannot skip", async () => {
  const inputs = [{ kind: "DISCOVERY_ATTEMPT" as const, attemptId: "walk:a", recordId: "1", recordedAt: at }];
  const source: MeetingDerivationSource = { sourceContentInputs: inputs, walks: [], normalizationInputHash: "config", groupHashes: { a: "one" }, groupStates: { a: "AZ" },
    priorProbe: { formatVersion: 1, sourceId: head.sourceId, complete: true, normalizationInputHash: "config", groups: { a: "one" }, pending: [] },
    outputHead: head, dependenciesReady: true };
  let calls = 0;
  const store = { async readSourceHead() { return { ...head, rawHash: derivedSourceContentHash(inputs) }; },
    async confirmUnchanged() { calls++; return { kind: "CONFIRMED" as const, versionId: head.versionId, at }; } };
  const input = { source, store, sourceId: head.sourceId, recordClass: head.recordClass, scope, parserVersion: head.parserVersion, now: at };
  assert.ok(await confirmMeetingDerivationSource(input));
  assert.equal(await confirmMeetingDerivationSource({ ...input, force: true }), null);
  assert.equal(await confirmMeetingDerivationSource({ ...input, source: { ...source, normalizationInputHash: "new-config" } }), null);
  assert.equal(await confirmMeetingDerivationSource({ ...input, source: { ...source, priorProbe: { ...source.priorProbe!, pending: ["a"] } } }), null);
  assert.equal(calls, 1);
});

test("the current-walk query returns no saved discovery body and notices a newly held artifact", async () => {
  const pg = new PGlite();
  try {
    await pg.exec("CREATE TABLE cp_log_discovery_attempts(log_key text,position integer,record jsonb); CREATE TABLE cp_log_artifacts(record jsonb)");
    const attempt = { attemptId: "walk:a", stateCode: "az", jurisdictionId: "government:a", finishedAt: at, secretBody: "never transferred",
      found: [{ artifactId: "artifact:a" }], steps: [{ url: "https://example.gov/calendar", purpose: "endpoint", status: 200, artifactId: "artifact:a" }] };
    await pg.query("INSERT INTO cp_log_discovery_attempts VALUES($1,1,$2::jsonb)", ["government:a", JSON.stringify(attempt)]);
    const before = (await pg.query(MEETING_DERIVATION_SOURCE_SQL, [null])).rows;
    assert.equal(JSON.stringify(before).includes("never transferred"), false);
    assert.deepEqual((before[0] as { artifacts: unknown }).artifacts, []);
    await pg.query("INSERT INTO cp_log_artifacts VALUES($1::jsonb)", [JSON.stringify({ artifactId: "artifact:a", contentHash: `sha256-${"b".repeat(64)}`, tier: "RAW", recordedAt: at })]);
    const after = (await pg.query(MEETING_DERIVATION_SOURCE_SQL, [null])).rows;
    assert.notDeepEqual(after, before);
  } finally { await pg.close(); }
});
