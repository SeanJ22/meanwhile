import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { AUTHORITY_FAMILIES, type ReaderManifest } from "../lib/meetings/edge-artifacts.ts";
import {
  publishReaderEdgeArtifacts,
  type PublishAuthority,
  type PublishReaderExtras,
  type PublishRegistrations,
} from "../lib/meetings/edge-serving.ts";
import { LocalFileArtifactStore } from "../lib/meetings/edge-store.ts";
import type { PrepareMeetingSnapshotResult } from "../lib/meetings/prepared-snapshot.ts";
import type { MeetingsSnapshot } from "../lib/meetings/snapshot.ts";
import { readerEdgeCarriesForward } from "../scripts/lib/reader-edge-current.ts";

const GENERATED_AT = "2026-09-25T15:00:00.000Z";
const META = { sourceThrough: null, retrievedAt: null, promotedThrough: null };

function snapshot(generatedAt = GENERATED_AT): MeetingsSnapshot {
  return {
    formatVersion: 1,
    generatedAt,
    counts: { fresh: 0, carried: 0, total: 0, duplicatesCollapsed: 0 },
    sources: [],
    meetings: [],
    agendaDocuments: [],
  };
}

const EXTRAS: PublishReaderExtras = {
  commentAccess: [{ bodyId: "body-1", method: "IN_PERSON" }],
  everydayRouting: { formatVersion: 1, routes: ["r-1"] },
};
const VALUES: PublishAuthority = Object.fromEntries(
  AUTHORITY_FAMILIES.map((family) => [family, { value: { family }, versionId: `${family}-v1` }]),
);
const CARRIED: PublishAuthority = Object.fromEntries(
  AUTHORITY_FAMILIES.map((family) => [family, { versionId: `${family}-v1`, carried: true as const }]),
);
const REGISTRATION_VALUES: PublishRegistrations = {
  az: { value: { state: "az" }, versionId: "reg-az-v1" },
  nh: { value: { state: "nh" }, versionId: "reg-nh-v1" },
};
const REGISTRATIONS_CARRIED: PublishRegistrations = {
  az: { versionId: "reg-az-v1", carried: true },
  nh: { versionId: "reg-nh-v1", carried: true },
};
const CURRENT_PREPARED: PrepareMeetingSnapshotResult = {
  status: "CURRENT",
  sequence: 7,
  coupledPartitions: 3,
  generatedAt: GENERATED_AT,
};

async function servedEdge(): Promise<{ store: LocalFileArtifactStore; manifest: ReaderManifest }> {
  const store = new LocalFileArtifactStore(mkdtempSync(join(tmpdir(), "reader-edge-carry-")));
  const published = await publishReaderEdgeArtifacts(snapshot(), META, {
    store,
    now: GENERATED_AT,
    extras: EXTRAS,
    authority: VALUES,
    registrations: REGISTRATION_VALUES,
  });
  assert.equal(published.status, "PUBLISHED");
  return { store, manifest: (await store.readManifest())!.manifest };
}

test("R28: an unchanged pass carries the served edge forward, exactly where the publish would answer CURRENT", async () => {
  const { store, manifest } = await servedEdge();
  const carry = readerEdgeCarriesForward({
    prepared: CURRENT_PREPARED,
    servedManifest: manifest,
    extras: { ...EXTRAS },
    authority: CARRIED,
    registrations: REGISTRATIONS_CARRIED,
  });
  assert.deepEqual(carry, { current: true, sequence: manifest.sequence });
  // The publish given the prepared row and the same carried inputs changes nothing.
  const publish = await publishReaderEdgeArtifacts(snapshot(), META, {
    store,
    now: "2026-09-25T15:05:00.000Z",
    extras: { ...EXTRAS },
    authority: CARRIED,
    registrations: REGISTRATIONS_CARRIED,
  });
  assert.equal(publish.status, "CURRENT");
  assert.equal("sequence" in publish ? publish.sequence : null, manifest.sequence);
});

test("R28: every condition that could change the edge reads the prepared row and publishes", async () => {
  const { manifest } = await servedEdge();
  const base = {
    prepared: CURRENT_PREPARED,
    servedManifest: manifest,
    extras: EXTRAS as PublishReaderExtras | undefined,
    authority: CARRIED,
    registrations: REGISTRATIONS_CARRIED as PublishRegistrations | undefined,
  };
  const { commentAccess: _served, ...withoutCommentAccess } = manifest;
  const { registrations: _registrations, ...withoutRegistrations } = manifest;
  const cases: readonly [string, Parameters<typeof readerEdgeCarriesForward>[0], RegExp][] = [
    ["the prepared snapshot was republished this pass", { ...base, prepared: { status: "PUBLISHED", sequence: 8, coupledPartitions: 3, generatedAt: GENERATED_AT } }, /PUBLISHED/],
    ["the prepared snapshot raced", { ...base, prepared: { status: "RACED", sequence: 8, coupledPartitions: 3 } }, /RACED/],
    ["the prepared snapshot failed", { ...base, prepared: { status: "FAILED", error: "x", lastValidGeneratedAt: GENERATED_AT } }, /FAILED/],
    ["the prepared snapshot is not composable", { ...base, prepared: { status: "NOT_COMPOSABLE", detail: "x", lastValidGeneratedAt: null } }, /NOT_COMPOSABLE/],
    ["the prepared row has no generation instant", { ...base, prepared: { ...CURRENT_PREPARED, generatedAt: null } }, /generation instant/],
    ["no manifest is served", { ...base, servedManifest: null }, /no served manifest/],
    ["the manifest has another format", { ...base, servedManifest: { ...manifest, formatVersion: 2 as unknown as 1 } }, /format/],
    ["the manifest came from another composition", { ...base, prepared: { ...CURRENT_PREPARED, generatedAt: "2026-09-25T16:00:00.000Z" } }, /generated/],
    ["the embedded families were not read", { ...base, extras: undefined }, /not read/],
    ["comment access changed", { ...base, extras: { ...EXTRAS, commentAccess: [{ bodyId: "body-2" }] } }, /embedded families changed/],
    ["everyday routing changed", { ...base, extras: { ...EXTRAS, everydayRouting: null } }, /embedded families changed/],
    ["the manifest lacks an embedded family", { ...base, servedManifest: withoutCommentAccess as ReaderManifest }, /embedded families changed/],
    ["a family moved and was read", { ...base, authority: { ...CARRIED, "registry-runtime": { value: {}, versionId: "registry-runtime-v2" } } }, /registry-runtime not carried/],
    ["a family could not be read", { ...base, authority: Object.fromEntries(Object.entries(CARRIED).filter(([family]) => family !== "comment-access")) }, /comment-access not carried/],
    ["a carried family is not the served version", { ...base, authority: { ...CARRIED, "meeting-outcomes": { versionId: "meeting-outcomes-v0", carried: true } } }, /meeting-outcomes is not the served version/],
    ["registrations could not be read", { ...base, registrations: undefined }, /registrations were not read/],
    ["the manifest serves no registrations", { ...base, servedManifest: withoutRegistrations as ReaderManifest }, /serves no registrations/],
    ["a state gained a registration", { ...base, registrations: { ...REGISTRATIONS_CARRIED, oh: { value: {}, versionId: "reg-oh-v1" } } }, /registration states changed/],
    ["a served state is gone", { ...base, registrations: { az: REGISTRATIONS_CARRIED.az! } }, /registration states changed/],
    ["a state's registration moved", { ...base, registrations: { ...REGISTRATIONS_CARRIED, nh: { value: {}, versionId: "reg-nh-v2" } } }, /registration nh moved/],
    ["a carried state is not the served version", { ...base, registrations: { ...REGISTRATIONS_CARRIED, az: { versionId: "reg-az-v0", carried: true } } }, /registration az moved/],
  ];
  for (const [label, input, reason] of cases) {
    const carry = readerEdgeCarriesForward(input);
    assert.equal(carry.current, false, label);
    assert.match(carry.current ? "" : carry.reason, reason, label);
  }
});

test("R28: the aggregate child decides the carry before it reads the prepared row, and reads it only to publish", () => {
  const child = readFileSync("scripts/routine-civic-data-reader-repair.mts", "utf8");
  const manifestRead = child.indexOf("await artifactStore.readManifest()");
  const carry = child.indexOf("readerEdgeCarriesForward({ prepared, servedManifest, extras, authority, registrations })");
  const current = child.indexOf("if (carry.current) {");
  const rowRead = child.indexOf("await readPreparedMeetingsProjection({ store })");
  const publish = child.indexOf("await publishReaderEdgeArtifacts(");
  assert.ok(manifestRead > 0 && manifestRead < carry, "the served manifest is read before the decision");
  assert.ok(carry < current && current < rowRead && rowRead < publish, "the prepared row is read only past the carry");
  assert.equal(child.match(/readPreparedMeetingsProjection\(/g)?.length, 1, "one prepared-row read, on the publish path");
  assert.match(child, /if \(artifactStore === null\) \{\s*console\.log\(JSON\.stringify\(\{ readerEdge: "SKIPPED_NO_STORE" \}\)\);/);
});
