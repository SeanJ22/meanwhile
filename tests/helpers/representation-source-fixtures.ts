import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { ScopeAccumulator, parseTab20Header, resolveTab20Columns } from "../../lib/census-geography/build.ts";
import { CENSUS_GEO_SOURCES } from "../../lib/census-geography/acquire.ts";
import { establishedApplicability } from "../../lib/census-geography/selection.ts";
import { acquireOverlayScopes } from "../../lib/overlay-geography/acquire.ts";
import { overlaySourceRows } from "../../lib/overlay-geography/reference.ts";
import { AiannhLandAccumulator, aiannhBlockAssignments, buildAiannhScope, CENSUS_AIANNH } from "../../lib/census-geography/aiannh.ts";
import { TRIBAL_SEAT_REFERENCES } from "../../lib/officials/tribal-seats.ts";
import { readBoundaryZip, readZip } from "../../lib/geo/shapefile.ts";
import type { BuiltScope } from "../../lib/census-geography/dataset.ts";

export const SOURCE_FIXTURE_NOW = "2026-10-12T00:00:00Z";
const fixture = (file: string) => readFileSync(new URL(`../fixtures/geography/${file}`, import.meta.url));
let overlays: ReturnType<typeof acquireOverlayScopes> | undefined;

export async function realOverlayScope(): Promise<BuiltScope> {
  const source = overlaySourceRows[0];
  overlays ??= acquireOverlayScopes({ fetchImpl: async input => {
    const url = String(input);
    if (url === source.townDocumentUrl) return new Response("Access Denied", {status:403});
    const file = new Map([[source.fileUrl,"NHHouseDistricts2022_Float.zip"],
      [source.townDocumentMirrors![0],"2022-state-representative-and-delegate-districts.pdf"],
      [source.townBoundaryUrl,"NHPolitDists2022.zip"], [source.partitionBoundaryUrl!,"tl_2024_33_sldl.zip"],
      [source.partitionRelationshipUrl!,"tab20_sldl202420_zcta520_33.txt"]]).get(url);
    assert.ok(file, `Unexpected source: ${url}`);
    return new Response(new Uint8Array(fixture(`overlay/${file}`)));
  } });
  const result = await overlays;
  assert.deepEqual(result.failures, []);
  return result.scopes[0];
}

export function realBaseScope(): BuiltScope {
  const source = CENSUS_GEO_SOURCES.sldl;
  const [header,...lines] = fixture("overlay/tab20_sldl202420_zcta520_33.txt").toString("utf8").trim().split("\n");
  const accumulator = new ScopeAccumulator(source, resolveTab20Columns(parseTab20Header(header),source.geoTag));
  for (const line of lines) accumulator.add(line.split("|"));
  return accumulator.finish({key:source.version,type:source.type,plan:source.plan,zctaTabulation:"2020",effectiveFor:source.effectiveFor,
    applicability:establishedApplicability(source.version), retrievalComplete:true,
    provenance:{sourceUrls:[source.url],sourceDataset:"CENSUS_RELATIONSHIPS",sourceFiles:["tab20_sldl202420_zcta520_natl.txt"],sourceChecksums:[],
      method:"Original state 33 rows, with unchanged Census land measures",computedAt:SOURCE_FIXTURE_NOW}});
}

export function realTribalScope(): BuiltScope {
  const boundary = readBoundaryZip(fixture("aiannh2020-tribal-components.zip")).features;
  const assignments = readZip(fixture("aiannh2020-blockassign-referenced.zip"))[0].data.toString("utf8");
  const codes = new Set(TRIBAL_SEAT_REFERENCES.flatMap(row => row.aiannhAreaIds.map(id=>id.slice(0,4))));
  const land = new AiannhLandAccumulator(aiannhBlockAssignments(assignments,codes));
  for (const line of fixture("aiannh2020-zcta-block-referenced.txt").toString("utf8").split("\n")) land.addLine(line);
  return buildAiannhScope(boundary,land.finish(),TRIBAL_SEAT_REFERENCES,{key:"aiannh:2020",type:"aiannh",plan:"Original TIGER/Line 2020 referenced areas",
    zctaTabulation:"2020",effectiveFor:"Referenced legislative areas",applicability:[{purpose:"representation",from:"2020-01-01"}],retrievalComplete:true,
    provenance:{sourceUrls:[CENSUS_AIANNH.url],sourceDataset:"CENSUS_TIGER_AIANNH2020_FIXTURE",sourceFiles:[],sourceChecksums:[],
      method:"Original selected polygon, BAF and ZCTA/block records",computedAt:SOURCE_FIXTURE_NOW}});
}
