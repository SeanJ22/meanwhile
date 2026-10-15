import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { publishScopeBoundaries } from "../lib/census-geography/boundary-artifacts.ts";
import type { BuiltScope } from "../lib/census-geography/dataset.ts";
import type { GeographySlice, Slice } from "../lib/control-plane/admin-view/promoted-slices.ts";
import { excludedRepresentationAtPoints, publishedRepresentationGeography, requestRepresentationGeographyReader, supplementPointDivisions } from "../lib/geo/representation-geography.ts";
import { LocalFileArtifactStore } from "../lib/meetings/edge-store-local.ts";
import { LocalFileArtifactReader } from "../lib/meetings/edge-store.ts";
import { withReaderAuthorityEdge } from "../lib/registry/runtime-edge.ts";

const selection = { purpose: "representation" as const, asOf: "2026-10-15" };
const scope: BuiltScope = {
  type: "overlay_district", version: "overlay:constructed-reader", fractionBasis: "area", instanceCount: 2, zctaEdgeCount: 2,
  versionMeta: { key: "overlay:constructed-reader", type: "overlay_district", plan: "Constructed reader geometry",
    zctaTabulation: "2020", effectiveFor: "Constructed test", applicability: [{ purpose: "representation", from: "2022-01-01", through: "2033-01-01" }],
    provenance: { sourceUrls: ["https://publisher.gov/constructed-boundaries"], sourceDataset: "CONSTRUCTED_TEST", sourceFiles: [], sourceChecksums: [], method: "Constructed squares", computedAt: "2026-10-15T00:00:00Z" } },
  groupings: [0, 20].map((offset, index) => ({ geoid: `33EX${index + 1}`, ocdId: null, label: `Constructed district ${index + 1}`,
    stateAbbr: "NH", stateFips: "33", memberStates: ["NH"], chamber: "lower", representation: "overlay",
    geometry: { type: "Polygon", coordinates: [[[offset, offset], [offset + 2, offset], [offset + 2, offset + 2], [offset, offset + 2], [offset, offset]]] },
    overlaps: [{ zcta5: "00001", whole: false, fraction: 0.5 }] })),
};

test("metadata reads fetch no polygons; four address samples share only their matching artifact; other districts exclude by source bounds", async () => {
  const directory = mkdtempSync(join(tmpdir(), "sl02-boundary-reader-"));
  const previousDirectory = process.env.WTP_READER_EDGE_DIR;
  const originalRead = LocalFileArtifactReader.prototype.readBytes;
  try {
    process.env.WTP_READER_EDGE_DIR = directory;
    const published = await publishScopeBoundaries(scope, new LocalFileArtifactStore(directory));
    const slice: Slice<GeographySlice> = { kind: "HELD", versionId: "constructed-reader", value: {
      scopes: [{ type: published.type, version: published.version, plan: published.versionMeta.plan,
        applicability: published.versionMeta.applicability, sourceUrls: published.versionMeta.provenance.sourceUrls,
        observedAt: published.versionMeta.provenance.computedAt }],
      containers: published.groupings.map(group => ({ ref: { ...group, type: published.type, version: published.version }, plan: published.versionMeta.plan, overlaps: null })),
    } };
    for (const container of slice.value.containers) {
      assert.ok(container.ref.geometryRef);
      assert.equal(container.ref.geometry, undefined, "metadata must not carry polygon arrays");
    }
    const reads: string[] = [];
    LocalFileArtifactReader.prototype.readBytes = async function (key) { reads.push(key); return originalRead.call(this, key); };
    let statesRead = 0;
    const edge = { censusDistricts: { versionId: "constructed-reader", loadState: async (state: string) => {
      assert.equal(state, "NH"); statesRead += 1; return slice;
    }, loadZip: async () => ({ kind: "UNREAD" as const, detail: "No ZIP read requested" }) } };
    await withReaderAuthorityEdge(edge, async () => {
      await publishedRepresentationGeography("NH");
      assert.equal(reads.length, 0, "metadata-only consumption downloaded a polygon");
      statesRead = 0;
      const points: [number, number][] = [[0.5, 0.5], [1, 1], [1.5, 1.5], [1.8, 1.8]];
      const reader = requestRepresentationGeographyReader(undefined, { points, selection });
      const samples = await Promise.all(points.map(([lng, lat]) => supplementPointDivisions(lat, lng, [], "NH", reader, [], selection)));
      assert.equal(statesRead, 1, "each sample reopened its state's metadata");
      for (const divisions of samples) assert.deepEqual(divisions.map(division => division.ocdId), ["ocd-division/country:us/state:nh/sldl:ex1"]);
      const near = published.groupings[0].geometryRef!.key, distant = published.groupings[1].geometryRef!.key;
      assert.equal(reads.filter(key => key === near).length, 1, "the four samples must share their one matching polygon read");
      assert.equal(reads.includes(distant), false, "an address downloaded an unrelated district's polygon");
      const held = await reader("NH");
      assert.equal(held.kind, "HELD");
      if (held.kind === "HELD") assert.deepEqual(excludedRepresentationAtPoints(points, held.value, selection), ["ocd-division/country:us/state:nh/sldl:ex2"]);
      const direct = await supplementPointDivisions(1, 1, [], "NH", undefined, [], selection);
      assert.deepEqual(direct.map(division => division.ocdId), ["ocd-division/country:us/state:nh/sldl:ex1"], "default point lookups must hydrate their own accurate area");
      assert.equal(reads.includes(distant), false);
    });
  } finally {
    LocalFileArtifactReader.prototype.readBytes = originalRead;
    if (previousDirectory === undefined) delete process.env.WTP_READER_EDGE_DIR;
    else process.env.WTP_READER_EDGE_DIR = previousDirectory;
    rmSync(directory, { recursive: true, force: true });
  }
});
