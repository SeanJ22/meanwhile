import { createHash } from "node:crypto";
import type { DoorRecord } from "../doors/registry.ts";
import type { KindTable } from "../registry/kinds.ts";
import { registeredKind } from "../registry/kinds.ts";
import { districtGeometryValid, specialDistrictBoundaryIssue, type SpecialDistrictBoundary, type DistrictGeometry } from "../registry/special-district-boundary.ts";
import { readSpecialDistrictBoundaries } from "../registry/special-district-boundary-reader.ts";
import type { WorkerPublicationCapture } from "./worker-roster-publication.ts";
import { captureIntact, section3SourceReceipt } from "./worker-publication-evidence.ts";
import { section3Page, linkingPageFrom } from "../control-plane/promotion/section3.ts";
import type { ManualProjectionPackage, CuratedReaderProjection } from "./manual-projections.ts";
import { prepareManualProjectionSuccessor } from "./manual-successor.ts";
import { processRegisteredManualCandidate } from "./promotion.ts";
import type { RoutineDataStore } from "./store.ts";
import type { ControlPlaneRepositories } from "../control-plane/repository/types.ts";
import type { WorkItem } from "../control-plane/work-item.ts";
import { sanitizedErrorDiagnostic } from "../ops/error-diagnostic.ts";

export const SPECIAL_DISTRICT_BOUNDARY_DOOR_KIND = "special-district-boundaries-geojson";
export interface HeldSpecialDistrict {
  readonly bodyId: string; readonly districtOcdId: string | null; readonly countyOcdId: string;
  readonly kind: string; readonly name: string; readonly sourceGovernmentId: string;
}
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export function specialDistrictBoundaryPackage(input: {
  readonly door: DoorRecord; readonly district: HeldSpecialDistrict; readonly kinds: KindTable;
  readonly capture: WorkerPublicationCapture; readonly linkingCaptures?: readonly WorkerPublicationCapture[]; readonly now: string;
}): ManualProjectionPackage & { readonly payload: CuratedReaderProjection } {
  const { door, district, capture, now } = input;
  if (door.kind !== SPECIAL_DISTRICT_BOUNDARY_DOOR_KIND || door.status === "SUSPENDED" ||
    door.ocdId !== district.countyOcdId || !door.bodyIds.includes(district.bodyId) || !district.sourceGovernmentId ||
    !registeredKind(input.kinds, "division", district.kind)) throw new Error("Boundary must name the admitted district, county, registered kind and source government key.");
  const linking = (input.linkingCaptures ?? []).filter(captureIntact);
  if (!captureIntact(capture) || !door.hosts.includes(new URL(capture.evidence.canonicalUrl).hostname.toLowerCase()) ||
    !section3Page({ url: capture.evidence.canonicalUrl, text: capture.evidence.text, retrievedAt: capture.observedAt,
      sourcePolicy: capture.sourcePolicy, linkingPage: linkingPageFrom(capture.evidence.canonicalUrl, linking.map(row => row.evidence)) }, "PUBLIC_RECORD", now).ok)
    throw new Error("The district GIS layer is incomplete or outside its admitted official source.");
  let layer: { type?: string; features?: { type?: string; properties?: Record<string, unknown>; geometry?: unknown }[]; crs?: unknown };
  let map: { governmentId?: string; governmentName?: string };
  try { layer = JSON.parse(capture.evidence.text); map = JSON.parse(String(door.config.fieldMap)); }
  catch { throw new Error("The saved district GIS layer or its registered field map is unreadable."); }
  if (!layer || layer.type !== "FeatureCollection" || !Array.isArray(layer.features) || !map || typeof map !== "object" || Array.isArray(map) ||
    typeof map.governmentId !== "string" || !map.governmentId || Object.keys(map).some(key => !["governmentId", "governmentName"].includes(key)) ||
    Object.values(map).some(value => typeof value !== "string" || !value)) throw new Error("District boundaries require the registered GeoJSON government-key columns.");
  // RFC 7946 has longitude/latitude coordinates. A legacy explicit CRS must say
  // the same; no projected metres are mistaken for geographic degrees.
  if (layer.crs !== undefined && !["urn:ogc:def:crs:OGC:1.3:CRS84", "urn:ogc:def:crs:EPSG::4326", "EPSG:4326"].includes(
    String((layer.crs as { properties?: { name?: unknown } })?.properties?.name))) throw new Error("The GIS layer's coordinate reference is not geographic longitude/latitude.");
  const selected = layer.features.filter(feature => feature?.type === "Feature" && feature.properties &&
    (typeof feature.properties[map.governmentId!] === "string" || typeof feature.properties[map.governmentId!] === "number" && Number.isSafeInteger(feature.properties[map.governmentId!])) &&
    String(feature.properties[map.governmentId!] ?? "") === district.sourceGovernmentId);
  if (!selected.length) throw new Error("The GIS layer has no boundary for this held publisher government key; membership remains owed.");
  const polygons = selected.flatMap(feature => {
    if (map.governmentName && feature.properties?.[map.governmentName] !== district.name) throw new Error("The GIS government key disagrees with its held district name.");
    if (!districtGeometryValid(feature.geometry)) throw new Error("The district GIS boundary is missing or is not a complete geographic polygon.");
    return feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
  });
  const geometry: DistrictGeometry = polygons.length === 1 ? { type: "Polygon", coordinates: polygons[0] } : { type: "MultiPolygon", coordinates: polygons };
  const rawHash = capture.evidence.contentHash.slice(7);
  const record: SpecialDistrictBoundary = { id: `district-boundary:${hash(`${door.doorId}\n${district.bodyId}\n${district.sourceGovernmentId}`)}`,
    kind: "SPECIAL_DISTRICT_BOUNDARY", ocdId: district.countyOcdId, bodyId: district.bodyId, districtOcdId: district.districtOcdId,
    districtKind: district.kind, sourceGovernmentId: district.sourceGovernmentId, name: district.name,
    geometry, sourceUrl: capture.evidence.canonicalUrl, sourceHash: rawHash, capturedAt: capture.observedAt };
  const issue = specialDistrictBoundaryIssue(record);
  if (issue) throw new Error(issue);
  return { contractId: "special-district-boundaries", version: `district-boundary:${new Date(now).toISOString()}`,
    sourceThrough: capture.observedAt, payload: { kind: "special-district-boundaries", records: [record] },
    sourceReceipt: section3SourceReceipt([capture, ...linking], now, "section3-validator:district-boundaries",
      "Exact saved official GIS polygon coordinates, source government key and held district identity; no geometry inferred from county membership.") };
}
export async function publishSpecialDistrictBoundary(store: RoutineDataStore, input: Parameters<typeof specialDistrictBoundaryPackage>[0]) {
  const built = specialDistrictBoundaryPackage(input);
  const { candidate, expectedBaseVersionId } = await prepareManualProjectionSuccessor(built, store, input.now);
  return processRegisteredManualCandidate(store, built.contractId, candidate, input.now, expectedBaseVersionId);
}
/** The existing admitted source lease invokes this callback on its saved GIS
 * capture. Outcome and retries remain on its work item, with no new clock. */
export async function runSpecialDistrictBoundaryPublication(input: Parameters<typeof specialDistrictBoundaryPackage>[0] & {
  readonly repos: Pick<ControlPlaneRepositories, "workItems">; readonly store: RoutineDataStore;
  readonly workItemId: string; readonly workerResultId: string;
}) {
  const item = await input.repos.workItems.mustRead(input.workItemId), plan = item.value.autonomousPlan;
  if (!plan || plan.contract.schemaVersion !== 2 || plan.contract.recordClass !== "PUBLIC_RECORD" ||
    plan.publication?.contractId !== "special-district-boundaries" || plan.publication.bodyId !== input.district.bodyId ||
    (plan.contract.jurisdiction.canonicalId !== input.district.countyOcdId && !input.district.bodyId.startsWith(`${input.district.countyOcdId}#`)) || !plan.sourceRegistryReferences.includes(input.door.doorId))
    throw new Error("Boundary publication must stay with its admitted exact district work item and door.");
  if (item.value.publicationOutcome?.workerResultId === input.workerResultId && item.value.publicationOutcome.status === "PUBLISHED")
    return { workItemId: input.workItemId, outcome: item.value.publicationOutcome };
  let candidateId: string | null = null, versionId: string | null = null;
  let outcome: NonNullable<WorkItem["publicationOutcome"]>;
  try {
    const built = specialDistrictBoundaryPackage(input), published = await publishSpecialDistrictBoundary(input.store, input);
    candidateId = published.candidate.candidate.id; versionId = published.promoted?.versionId ?? null;
    const read = await readSpecialDistrictBoundaries(input.district.countyOcdId, { store: input.store, now: input.now, bypassCache: true });
    if (!published.promoted || read.kind !== "PROMOTED" || read.metadata.versionId !== versionId) throw new Error(published.candidate.failureDetail ?? "Boundary has not reached its typed reader.");
    outcome = { at: input.now, workerResultId: input.workerResultId, candidateId, versionId, status: "PUBLISHED",
      code: published.confirmed ? "VERIFIED_RESULT_REUSED" : "SPECIAL_DISTRICT_BOUNDARY_PUBLISHED",
      acceptedRecordIds: built.payload.records.map(row => String(row.id)), detail: "Exact official district geometry held; only contained addresses attach to this district." };
  } catch (error) {
    outcome = { at: input.now, workerResultId: input.workerResultId, candidateId, versionId, status: "HELD",
      code: "SPECIAL_DISTRICT_BOUNDARY_HELD", detail: sanitizedErrorDiagnostic(error), recovery: candidateId ? "PUBLISHER" : "WORKER" };
  }
  const latest = await input.repos.workItems.mustRead(input.workItemId);
  if (!await input.repos.workItems.compareAndSet(input.workItemId, latest.revision, { ...latest.value, publicationOutcome: outcome }, input.now)) throw new Error("District boundary outcome changed during retention.");
  return { workItemId: input.workItemId, outcome };
}
