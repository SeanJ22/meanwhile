import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import type { GeographyGeometry, GeographyRef } from "./contract.ts";
import type { BuiltScope } from "./dataset.ts";
import type { GeographySlice } from "../control-plane/admin-view/promoted-slices.ts";
import { resolveReaderArtifactStore, type ReaderArtifactReadStore, type ReaderArtifactStore } from "../meetings/edge-store.ts";
import { boundaryGeometries } from "./geometry-transform.ts";

export interface BoundaryArtifactRef {
  readonly key: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly bounds: readonly [number, number, number, number];
}

interface BoundaryArtifact {
  readonly formatVersion: 1;
  readonly stateFips: string;
  readonly type: string;
  readonly version: string;
  readonly geoid: string;
  readonly accurate: GeographyGeometry;
  readonly display: GeographyGeometry;
}

export interface BoundaryArea {
  readonly points?: readonly (readonly [number, number])[];
  readonly bounds?: readonly number[];
}

function geometryBounds(geometry: GeographyGeometry): [number, number, number, number] {
  const bounds: [number, number, number, number] = [180, 90, -180, -90];
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  for (const polygon of polygons) for (const ring of polygon) for (const [longitude, latitude] of ring) {
    bounds[0] = Math.min(bounds[0], longitude); bounds[1] = Math.min(bounds[1], latitude);
    bounds[2] = Math.max(bounds[2], longitude); bounds[3] = Math.max(bounds[3], latitude);
  }
  return bounds;
}

export async function publishScopeBoundaries(scope: BuiltScope, store: ReaderArtifactStore): Promise<BuiltScope> {
  for (const group of scope.groupings) {
    if (!group.geometry) continue;
    const { accurate, display } = boundaryGeometries(group.geometry);
    const value: BoundaryArtifact = {formatVersion:1,stateFips:group.stateFips,type:scope.type,version:scope.version,geoid:group.geoid,accurate,display};
    const bytes = gzipSync(Buffer.from(JSON.stringify(value)));
    const geometryRef: BoundaryArtifactRef = {key:await store.putImmutable(bytes,"json.gz"),sha256:createHash("sha256").update(bytes).digest("hex"),bytes:bytes.byteLength,bounds:geometryBounds(accurate)};
    // Acquisition transfers these groups to publication; release each polygon after its durable write.
    const owned = group as { geometry?: GeographyGeometry; geometryRef?: BoundaryArtifactRef };
    owned.geometryRef = geometryRef;
    delete owned.geometry;
  }
  return scope;
}

export function boundaryTouchesArea(ref: BoundaryArtifactRef, area: BoundaryArea): boolean {
  const [west,south,east,north] = ref.bounds;
  if (area.points?.some(([longitude,latitude])=>longitude>=west&&longitude<=east&&latitude>=south&&latitude<=north)) return true;
  const bounds = area.bounds;
  if (!bounds || north<bounds[1] || south>bounds[3]) return false;
  if (Math.abs(bounds[2]-bounds[0])>=360) return true;
  // MapLibre retains the displayed world copy in bounds after wrapping its center.
  const wrap = (longitude: number) => ((longitude+180)%360+360)%360-180;
  const left = wrap(bounds[0]), right = wrap(bounds[2]);
  return left>right ? east>=left||west<=right : east>=left&&west<=right;
}

export async function hydrateBoundaryGeometries(slice: GeographySlice, mode: "accurate" | "display", store: ReaderArtifactReadStore | null = resolveReaderArtifactStore(), area?: BoundaryArea): Promise<GeographySlice> {
  const reads = new Map<string, Promise<BoundaryArtifact>>();
  async function read(ref: GeographyRef): Promise<GeographyGeometry> {
    const pointer = ref.geometryRef!;
    if (!store || !/^[a-f0-9]{64}$/.test(pointer.sha256) || !Number.isSafeInteger(pointer.bytes) || pointer.bytes<=0) throw new Error("Representation boundary artifact is unavailable");
    let pending = reads.get(pointer.key);
    if (!pending) {
      pending = (async()=>{
        const bytes = await store.readBytes(pointer.key);
        if (!bytes || bytes.byteLength!==pointer.bytes || createHash("sha256").update(bytes).digest("hex")!==pointer.sha256) throw new Error("Representation boundary artifact digest mismatch");
        return JSON.parse(gunzipSync(bytes,{maxOutputLength:32*1024*1024}).toString("utf8")) as BoundaryArtifact;
      })();
      reads.set(pointer.key,pending);
    }
    const value = await pending;
    if (value.formatVersion!==1 || value.stateFips!==ref.stateFips || value.type!==ref.type || value.version!==ref.version || value.geoid!==ref.geoid) throw new Error("Representation boundary artifact identity mismatch");
    const geometry = value[mode];
    if (!geometry || !["Polygon","MultiPolygon"].includes(geometry.type) || !Array.isArray(geometry.coordinates)) throw new Error("Representation boundary artifact geometry is invalid");
    return geometry;
  }
  const containers = [];
  for (const container of slice.containers) {
    const ref = container.ref;
    if (ref.geometry) throw new Error("Published representation contains inline geometry");
    if (ref.geometryRef && (!area || boundaryTouchesArea(ref.geometryRef,area))) containers.push({...container,ref:{...ref,geometry:await read(ref)}});
    else containers.push(container);
  }
  return {...slice,containers};
}
