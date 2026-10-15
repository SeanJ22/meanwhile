import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { retireMeetingArtifacts, transferMeetingArtifacts } from "../lib/db/r4-meeting-artifacts.ts";
import { sha256OfJson, type AuthorityFamily, type ReaderGeoArtifact, type ReaderManifest, type ReaderManifestScope } from "../lib/meetings/edge-artifacts.ts";
import { readAuthorityArtifactValue, readReaderEdgeMeetings } from "../lib/meetings/edge-serving.ts";
import { LocalFileArtifactStore, type ReaderArtifactStore } from "../lib/meetings/edge-store.ts";
import { meetingSettingsFromValues } from "../lib/meetings/settings.ts";
import type { AgendaDocument } from "../lib/meetings/agenda-documents.ts";
import type { Meeting } from "../lib/sources/types.ts";

const savedAt = "2026-10-01T00:00:00.000Z", checkedAt = "2026-10-10T00:00:00.000Z", now = "2026-10-15T00:00:00.000Z";
const division = (state: string, place = "fixture") => `ocd-division/country:us/state:${state}/place:${place}`;
const meeting = (id: string, ocdId = division("az"), extra: Partial<Meeting> = {}): Meeting => ({
  id, ocdId, bodyId: `${ocdId}#governing`, bodyName: "Council", title: id, startsAt: "2026-10-16T12:00:00.000Z",
  timeZone: "America/Phoenix", location: null, agendaUrl: null, jurisdiction: "Fixture", status: "SCHEDULED",
  provenance: { sourceOrg: "Council", sourceUrl: "https://fixture.gov/meetings", collectedAt: savedAt, verifiedAt: savedAt }, ...extra,
});
const document = (row: Meeting): AgendaDocument => ({ id: `${row.id}@hash`, meetingId: row.id, ocdId: row.ocdId,
  documentUrl: "https://fixture.gov/agenda.pdf", contentHash: "hash", contentType: "application/pdf", text: "Saved agenda",
  extraction: "pdf", extractionNote: null, sourceUrl: "https://fixture.gov/meetings", sourceOrg: "Council",
  retrievedAt: savedAt, collectedAt: savedAt, verifiedAt: savedAt });
const manifest = (scopes: readonly ReaderManifestScope[], extra: Partial<ReaderManifest> = {}): ReaderManifest => ({
  formatVersion: 1, sequence: 7, generatedAt: savedAt, sourceThrough: savedAt, retrievedAt: savedAt,
  promotedThrough: savedAt, scopes, sources: [], ...extra,
});
async function saveScope(store: ReaderArtifactStore, scope: string, meetings: Meeting[], agendaDocuments: AgendaDocument[] = [], ocdId?: string) {
  const artifact: ReaderGeoArtifact = { formatVersion: 1, scope, ...(ocdId ? { ocdId } : {}), generatedAt: savedAt,
    counts: { fresh: meetings.filter(row => !row.carried).length, carried: meetings.filter(row => row.carried).length,
      total: meetings.length, duplicatesCollapsed: 0 }, meetings, agendaDocuments };
  const bytes = new TextEncoder().encode(JSON.stringify(artifact)), key = await store.putImmutable(bytes, "json");
  return { scope, ...(ocdId ? { ocdId } : {}), key, sha256: createHash("sha256").update(bytes).digest("hex"),
    meetingCount: meetings.length, generatedAt: savedAt } satisfies ReaderManifestScope;
}
async function authority(store: ReaderArtifactStore, family: AuthorityFamily, value: unknown) {
  const version = `${family}-saved`, key = await store.putImmutable(gzipSync(JSON.stringify({ formatVersion: 1, family,
    versionId: version, generatedAt: savedAt, value })), "json.gz");
  return { key, version, sha: sha256OfJson(value) };
}
async function fixture(run: (store: LocalFileArtifactStore) => Promise<void>) {
  const path = await mkdtemp(join(tmpdir(), "r4-artifact-transfer-"));
  try { await run(new LocalFileArtifactStore(path)); } finally { await rm(path, { recursive: true, force: true }); }
}
async function read(store: ReaderArtifactStore, id: string) {
  const result = await readReaderEdgeMeetings({ store, meetingId: id, now, settings: meetingSettingsFromValues(),
    fallback: async () => { throw new Error("Cutover must serve saved artifacts without a database read"); } });
  assert.equal(result.kind, "PROMOTED");
  if (result.kind !== "PROMOTED") throw new Error("Missing migrated meeting");
  return result;
}

test("expand preserves the root reader while state readers serve saved checks, carried dates and merged IDs", () => fixture(async store => {
  const fresh = meeting("ical:fresh", undefined, { mergedMeetingIds: ["ical:alias"] });
  const carried = meeting("ical:carried", undefined, { carried: { source: "ical", lastFreshAt: savedAt, reason: "SOURCE_UNAVAILABLE" } });
  const other = meeting("ical:other", division("ca"));
  const az = await saveScope(store, "az", [fresh, carried], [document(fresh)]), ca = await saveScope(store, "ca", [other]);
  const registry = { key: "registry", version: "registry-v1", sha: "registry-sha" };
  const original = manifest([az, ca], { freshChecks: { [`ical|${fresh.bodyId}`]: checkedAt, [`ical|${other.bodyId}`]: savedAt },
    commentAccess: [{ bodyId: fresh.bodyId, ocdId: fresh.ocdId }, { bodyId: other.bodyId, ocdId: other.ocdId }],
    authorityArtifacts: { "registry-runtime": registry }, registrations: { az: registry, ca: registry },
    stateLegislators: { "US-AZ": registry, "US-CA": registry } });
  await store.writeManifest(original, null);
  const root = await store.readManifest();
  assert.deepEqual(await transferMeetingArtifacts(store), { states: 2, scopes: 2 });
  assert.deepEqual(await store.readManifest(), root);
  const state = (await store.readManifest("AZ"))!.manifest;
  assert.deepEqual(state.scopes, [az]);
  assert.deepEqual(state.freshChecks, { [`ical|${fresh.bodyId}`]: checkedAt });
  assert.deepEqual(Object.keys(state.registrations!), ["az"]);
  assert.deepEqual(Object.keys(state.stateLegislators!), ["US-AZ"]);
  assert.equal(state.commentAccess!.length, 1);
  assert.equal(state.generatedAt, savedAt);
  assert.equal((await read(store, "ical:alias")).value.meetings[0]!.provenance.collectedAt, checkedAt);
  assert.equal((await read(store, carried.id)).value.meetings[0]!.provenance.collectedAt, savedAt);
  assert.equal((await read(store, fresh.id)).value.agendaDocuments[0]!.collectedAt, savedAt);
  const first = await store.readManifest("AZ");
  await transferMeetingArtifacts(store);
  assert.deepEqual(await store.readManifest("AZ"), first);
  await retireMeetingArtifacts(store);
  const retired = (await store.readManifest())!.manifest;
  assert.deepEqual(retired.scopes, []);
  assert.deepEqual(retired.authorityArtifacts, { "registry-runtime": registry });
  assert.equal(retired.freshChecks, undefined);
  assert.equal(retired.generatedAt, savedAt);
  assert.equal((await read(store, fresh.id)).value.meetings[0]!.title, fresh.title);
  const completed = await store.readManifest();
  assert.deepEqual(await retireMeetingArtifacts(store), { states: 0, scopes: 0 });
  assert.deepEqual(await store.readManifest(), completed);
}));

test("mixed national buckets split by governing place, keep federal meetings and index agenda aliases", () => fixture(async store => {
  const rows = [meeting("ical:az-one"), meeting("ical:az-two", division("az", "second")), meeting("ical:ca", division("ca")),
    meeting("ical:federal", "ocd-division/country:us")];
  const agenda = document(rows[0]!); agenda.ocdId = null;
  await store.writeManifest(manifest([await saveScope(store, "us", rows, [agenda])]), null);
  assert.deepEqual(await transferMeetingArtifacts(store), { states: 3, scopes: 4 });
  assert.equal((await store.readManifest("AZ"))!.manifest.scopes.length, 2);
  for (const [index, state] of ["AZ", "AZ", "CA", "US"].entries()) {
    assert.equal(await store.readMeetingState(rows[index]!.id), state);
    const held = await read(store, rows[index]!.id);
    assert.deepEqual(held.value.meetings, [rows[index]]);
  }
  const scoped = await readReaderEdgeMeetings({ store, ocdIds: [division("az")], now, settings: meetingSettingsFromValues() });
  assert.equal(scoped.kind, "PROMOTED");
  if (scoped.kind === "PROMOTED") assert.deepEqual(scoped.value.meetings.map(row => row.id).sort(), ["ical:az-one", "ical:federal"]);
  assert.equal((await read(store, rows[0]!.id)).value.agendaDocuments[0]!.text, "Saved agenda");
}));

test("local authority copies preserve evidence and dates while root references retain national authority", () => fixture(async store => {
  const az = meeting("ical:az"), ca = meeting("ical:ca", division("ca"));
  const outcome = { generatedOn: "2026-10-01", generatedAt: savedAt, tenants: ["az", "ca"],
    sittings: [az, ca].map((row, index) => ({ meetingId: row.id, bodyId: row.bodyId, ocdId: row.ocdId, slug: index ? "ca" : "az", evidence: "Saved vote" })),
    pointers: [{ contractId: "a", tenant: "az", versionId: "az-v1" }, { contractId: "b", tenant: "ca", versionId: "ca-v1" }] };
  const comments = { kind: "comment-access", records: [az, ca].map(row => ({ bodyId: row.bodyId, ocdId: row.ocdId, checkedAt: savedAt })) };
  const registry = await authority(store, "registry-runtime", { global: true });
  await store.writeManifest(manifest([], { authorityArtifacts: { "registry-runtime": registry,
    "meeting-outcomes": await authority(store, "meeting-outcomes", outcome), "comment-access": await authority(store, "comment-access", comments) } }), null);
  assert.deepEqual(await retireMeetingArtifacts(store), { states: 2, scopes: 0 });
  const state = (await store.readManifest("AZ"))!.manifest;
  assert.deepEqual(await readAuthorityArtifactValue("meeting-outcomes", state.authorityArtifacts!["meeting-outcomes"], store), {
    ...outcome, tenants: ["az"], sittings: [outcome.sittings[0]], pointers: [outcome.pointers[0]] });
  assert.deepEqual(await readAuthorityArtifactValue("comment-access", state.authorityArtifacts!["comment-access"], store), {
    ...comments, records: [comments.records[0]] });
  assert.deepEqual((await store.readManifest())!.manifest.authorityArtifacts, { "registry-runtime": registry });
  assert.equal(state.generatedAt, savedAt);
}));

test("catch-up never replaces a newer state publication or clears a root changed during transfer", () => fixture(async store => {
  const row = meeting("ical:az"), old = await saveScope(store, "az", [row]);
  await store.writeManifest(manifest([old]), null);
  const newer = manifest([{ ...old, scope: "area-az-newer", generatedAt: now }], { generatedAt: now, sequence: 20, meetingLayout: "governing-area",
    freshChecks: { [`ical|${row.bodyId}`]: now } });
  await store.writeManifest(newer, null, "AZ");
  await transferMeetingArtifacts(store);
  const state = (await store.readManifest("AZ"))!.manifest;
  assert.deepEqual(state, newer);
  assert.equal(state.generatedAt, now);
  assert.deepEqual(state.scopes, newer.scopes);
  assert.deepEqual(state.freshChecks, newer.freshChecks);
  const racing = new Proxy(store, { get(target, key) {
    if (key === "writeManifest") return async (next: ReaderManifest, etag: string | null, state?: string) => {
      if (!state) {
        const held = (await target.readManifest())!;
        await target.writeManifest({ ...held.manifest, sequence: held.manifest.sequence + 1, generatedAt: now }, held.etag);
      }
      return target.writeManifest(next, etag, state);
    };
    const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
  } });
  await assert.rejects(retireMeetingArtifacts(racing), /R4_MEETING_ROOT_MANIFEST_MOVED/);
  assert.deepEqual((await store.readManifest())!.manifest.scopes, [old]);
}));

test("missing or unlocated saved artifacts block retirement and leave the root readable", () => fixture(async store => {
  const unknown = meeting("ical:unknown", undefined, { ocdId: null, bodyId: "unlocated-body" });
  const scope = await saveScope(store, "us", [unknown]);
  await store.writeManifest(manifest([scope]), null);
  const root = await store.readManifest();
  await assert.rejects(retireMeetingArtifacts(store), /R4_MEETING_ARTIFACT_STATE_MISSING/);
  assert.deepEqual(await store.readManifest(), root);
  await store.writeManifest(manifest([{ ...scope, key: "missing-artifact" }]), root!.etag);
  const missing = await store.readManifest();
  await assert.rejects(retireMeetingArtifacts(store), /R4_MEETING_ARTIFACT_MISSING/);
  assert.deepEqual(await store.readManifest(), missing);
}));
