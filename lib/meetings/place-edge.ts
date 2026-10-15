import { gzipSync, gunzipSync } from "node:zlib";
import { sha256OfJson, READER_ARTIFACT_FORMAT_VERSION, type PlaceAuthorityFamily, type ReaderManifest } from "./edge-artifacts.ts";
import type { PromotedEdgeEntry } from "../civic-data/read-model.ts";
import type { ReaderArtifactStore } from "./edge-store.ts";
import type { PublishReaderEdgeResult } from "./edge-serving.ts";

interface PlaceArtifactEnvelope  {
  readonly formatVersion: typeof READER_ARTIFACT_FORMAT_VERSION;
  readonly versionId: string;
  readonly generatedAt: string;
  readonly family: PlaceAuthorityFamily;
  readonly division: string;
  readonly value: PromotedEdgeEntry;
}

export function readerPlaceManifestKey(family: PlaceAuthorityFamily, division: string): string {
  if (!/^ocd-division\/country:us\/(state|district|territory):[^/]+(?:\/[^/]+)*$/.test(division)) {
    throw new Error("A reader place requires its exact US division.");
  }
  return `reader/places/${family}/${sha256OfJson(division)}.json`;
}

export function readerPlaceManifestMatches(manifest: ReaderManifest | undefined,
  input: { readonly family: PlaceAuthorityFamily; readonly division: string; readonly versionId: string }): boolean {
  return manifest?.formatVersion === READER_ARTIFACT_FORMAT_VERSION && manifest.place?.family === input.family &&
    manifest.place.division === input.division && manifest.place.artifact.version === input.versionId;
}

export async function publishReaderPlaceArtifact(input: {
  readonly family: PlaceAuthorityFamily; readonly division: string; readonly versionId: string;
  readonly read: () => Promise<PromotedEdgeEntry>;
}, options: { readonly store: ReaderArtifactStore; readonly now: string }): Promise<PublishReaderEdgeResult> {
  try {
    const { store, now } = options;
    const manifestKey = readerPlaceManifestKey(input.family, input.division);
    const current = await store.readManifest(manifestKey);
    if (readerPlaceManifestMatches(current?.manifest, input)) {
      return { status: "CURRENT", sequence: current!.manifest.sequence, scopes: 1 };
    }
    const value = await input.read();
    const envelope: PlaceArtifactEnvelope = { formatVersion: READER_ARTIFACT_FORMAT_VERSION,
      family: input.family, division: input.division, versionId: input.versionId, generatedAt: now, value };
    const key = await store.putImmutable(gzipSync(Buffer.from(JSON.stringify(envelope), "utf8")), "json.gz");
    const sequence = (current?.manifest.sequence ?? 0) + 1;
    const manifest: ReaderManifest = { formatVersion: READER_ARTIFACT_FORMAT_VERSION, sequence, generatedAt: now,
      sourceThrough: null, retrievedAt: null, promotedThrough: null, sources: [], scopes: [],
      place: { family: input.family, division: input.division, artifact: { key, version: input.versionId, sha: sha256OfJson(value) } } };
    const result = await store.writeManifest(manifest, current?.etag ?? null, manifestKey);
    return result.modified ? { status: "PUBLISHED", sequence, scopes: 1, meetings: 0 } : { status: "RACED", sequence };
  } catch (error) {
    return { status: "FAILED", error: error instanceof Error ? error.message : String(error) };
  }
}

export function placeArtifactLoader(family: PlaceAuthorityFamily, store: ReaderArtifactStore) {
  const requested = new Map<string, Promise<PromotedEdgeEntry | null>>();
  return (division: string): Promise<PromotedEdgeEntry | null> => {
    const held = requested.get(division);
    if (held) return held;
    const reading = (async (): Promise<PromotedEdgeEntry | null> => {
      try {
        const stored = await store.readManifest(readerPlaceManifestKey(family, division));
        const recordClass = family === "ballot-measures" ? "BALLOT_CANDIDACY" : "CURATED_READER_RECORD";
        const scope = `US:${family}:${division}`;
        if (!stored) return { kind: "NOT_RECORDED", recordClass, scope };
        const manifest = stored.manifest;
        if (manifest.formatVersion !== READER_ARTIFACT_FORMAT_VERSION || manifest.place?.family !== family || manifest.place.division !== division) return null;
        const ref = manifest.place.artifact;
        const bytes = await store.readBytes(ref.key);
        if (!bytes) return null;
        const envelope = JSON.parse(gunzipSync(bytes).toString("utf8")) as PlaceArtifactEnvelope;
        if (envelope.formatVersion !== READER_ARTIFACT_FORMAT_VERSION || envelope.family !== family ||
            envelope.division !== division || envelope.versionId !== ref.version || sha256OfJson(envelope.value) !== ref.sha) return null;
        const pointer = envelope.value.kind === "PROMOTED" ? envelope.value.projection : envelope.value;
        return pointer.recordClass === recordClass && pointer.scope === scope ? envelope.value : null;
      } catch { return null; }
    })();
    requested.set(division, reading);
    return reading;
  };
}
