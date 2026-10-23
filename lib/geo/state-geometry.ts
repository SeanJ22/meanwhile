/**
 * A state's geometry files, read one file at a time and only for the state a reader asks about.
 *
 * No server function packs data/states/<st>/geo: every function would carry every state's polygons, and the special
 * districts alone outgrow Netlify's 250 MB function limit. Each committed file is instead published to the reader
 * edge store under the sha256 of its bytes (`reader/artifacts/<sha256>.json`), and data/derived/state-geometry.json
 * (packed, small) names that sha for each file. A reader:
 *   1. reads that exact artifact from the edge store;
 *   2. otherwise copies the file from this deploy's own static copy (public/states, served by the CDN), checks it
 *      against the manifest's sha and puts it in the edge store for every later reader;
 *   3. otherwise reads the last copy of that file the publisher recorded (an earlier version is better than none);
 *   4. otherwise reads the checkout (local development, tests and the runner hold every file).
 * None of these reads the database.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveReaderArtifactStore, type ReaderArtifactStore } from "../meetings/edge-store.ts";

export const STATE_GEOMETRY_MANIFEST = "data/derived/state-geometry.json";
/** The publisher's record of the newest artifact published for each file. */
export const STATE_GEOMETRY_INDEX_KEY = "reader/state-geometry/index.json";

export interface StateGeometryManifest {
  readonly formatVersion: 1;
  /** Repository path (data/states/<st>/geo/<file>.geojson) to the sha256 and length of its committed bytes. */
  readonly files: Readonly<Record<string, { readonly sha256: string; readonly bytes: number }>>;
}
export interface StateGeometryIndex {
  readonly formatVersion: 1;
  readonly files: Readonly<Record<string, string>>;
}

export function stateGeometryPath(state: string, file: string): string {
  const st = state.toLowerCase();
  if (!/^[a-z]{2}$/.test(st) || !/^[a-z0-9][a-z0-9.-]*\.geojson$/.test(file)) throw new Error(`Invalid state geometry path: ${state}/${file}`);
  return `data/states/${st}/geo/${file}`;
}
export const stateGeometryKey = (sha256: string): string => `reader/artifacts/${sha256}.json`;
const sha256Of = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const text = (bytes: Uint8Array): string => Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("utf8");

export interface StateGeometryReadOptions {
  readonly root?: string;
  readonly store?: ReaderArtifactStore | null;
  /** This deploy's own origin, whose CDN serves public/states; absent off Netlify. */
  readonly siteUrl?: string | null;
  readonly fetchImpl?: typeof fetch;
}

let manifestRead: Promise<StateGeometryManifest> | null = null;
function stateGeometryManifest(root: string): Promise<StateGeometryManifest> {
  // A literal path, so the deployment trace carries the manifest.
  manifestRead ??= readFile(join(root, "data", "derived", "state-geometry.json"), "utf8")
    .then(raw => JSON.parse(raw) as StateGeometryManifest).catch(error => { manifestRead = null; throw error; });
  return manifestRead;
}

const fileReads = new Map<string, Promise<string>>();

/** The committed text of one state geometry file. Throws only when no copy can be read anywhere. */
export function readStateGeometryText(state: string, file: string, options: StateGeometryReadOptions = {}): Promise<string> {
  const path = stateGeometryPath(state, file);
  const held = fileReads.get(path);
  if (held) return held;
  const read = readOnce(path, options).catch(error => { fileReads.delete(path); throw error; });
  fileReads.set(path, read);
  return read;
}

async function readOnce(path: string, options: StateGeometryReadOptions): Promise<string> {
  const root = options.root ?? process.cwd();
  const store = options.store === undefined ? resolveReaderArtifactStore() : options.store;
  const entry = store ? (await stateGeometryManifest(root).catch(() => null))?.files[path] : undefined;
  if (store && entry) {
    const exact = await store.readBytes(stateGeometryKey(entry.sha256)).catch(() => null);
    if (exact && sha256Of(exact) === entry.sha256) return text(exact);
    const siteUrl = options.siteUrl === undefined ? process.env.DEPLOY_URL ?? process.env.URL ?? null : options.siteUrl;
    if (siteUrl) {
      try {
        const response = await (options.fetchImpl ?? fetch)(new URL(path.replace(/^data\//, "/"), siteUrl), { headers: { accept: "application/json" } });
        const bytes = response.ok ? new Uint8Array(await response.arrayBuffer()) : null;
        if (bytes && sha256Of(bytes) === entry.sha256) {
          void store.putImmutable(bytes, "json").catch(() => undefined);
          return text(bytes);
        }
      } catch { /* The static copy is one route; the publisher's record and the checkout remain. */ }
    }
    const latest = (await store.readJsonPointer<StateGeometryIndex>(STATE_GEOMETRY_INDEX_KEY).catch(() => null))?.value.files[path];
    if (latest) {
      const earlier = await store.readBytes(latest).catch(() => null);
      if (earlier && latest === stateGeometryKey(sha256Of(earlier))) return text(earlier);
    }
  }
  const [, st, file] = /^data\/states\/([a-z]{2})\/geo\/(.+)$/.exec(path)!;
  return readFile(join(/* turbopackIgnore: true */ root, "data", "states", st!, "geo", file!), "utf8");
}

/** Puts every committed state geometry file the edge store does not yet hold there, and records the newest of each. */
export async function publishStateGeometry(store: ReaderArtifactStore, root: string = process.cwd()): Promise<{ published: number; current: number; bytes: number }> {
  const manifest = JSON.parse(await readFile(join(/* turbopackIgnore: true */ root, STATE_GEOMETRY_MANIFEST), "utf8")) as StateGeometryManifest;
  let held = await store.readJsonPointer<StateGeometryIndex>(STATE_GEOMETRY_INDEX_KEY);
  const files: Record<string, string> = { ...held?.value.files };
  let published = 0, current = 0, bytes = 0;
  for (const [path, entry] of Object.entries(manifest.files)) {
    const key = stateGeometryKey(entry.sha256);
    if (files[path] === key) { current++; continue; }
    const committed = new Uint8Array(await readFile(join(/* turbopackIgnore: true */ root, path)));
    if (sha256Of(committed) !== entry.sha256) throw new Error(`${path} differs from ${STATE_GEOMETRY_MANIFEST}; run pnpm resolver:manifest`);
    if (await store.putImmutable(committed, "json") !== key) throw new Error(`The edge store filed ${path} under another key`);
    files[path] = key; published++; bytes += committed.byteLength;
  }
  if (published === 0) return { published, current, bytes };
  for (let attempt = 0; attempt < 3; attempt++) {
    const merged = { ...held?.value.files, ...files };
    if ((await store.writeJsonPointer<StateGeometryIndex>(STATE_GEOMETRY_INDEX_KEY, { formatVersion: 1, files: merged }, held?.etag ?? null)).modified) {
      return { published, current, bytes };
    }
    held = await store.readJsonPointer<StateGeometryIndex>(STATE_GEOMETRY_INDEX_KEY);
  }
  throw new Error("The state geometry index changed during publication; the next pass records it");
}

/** For tests: forget files read in this process. */
export function resetStateGeometryReads(): void {
  fileReads.clear();
  manifestRead = null;
}
