import { brotliCompressSync, brotliDecompressSync, constants } from "node:zlib";
import { createHash } from "node:crypto";
import { resolveReaderArtifactStore, type ReaderArtifactStore } from "../meetings/edge-store.ts";
import type { ZctaCentroid } from "../geo/zcta-core.ts";
import type { PlaceEntry } from "../place-map/reader.ts";
import type { RegistryRuntimeReadModel } from "../registry/runtime-data-plane.ts";
import { serverReaderValue } from "./memory.ts";
import type { PlacePackage } from "./place-types.ts";

/**
 * One file per ZIP in the reader artifact store, packed with brotli: everything a typed ZIP needs, so a reader's visit
 * reads one file and never the database. It holds the three finished answers' inputs as the routes build them.
 *
 * A state's government registry is the same in every ZIP of the state, so it is filed once under its own fingerprint and each ZIP
 * file names it. Only the divisions, which differ by ZIP, stay in the ZIP's file.
 */
const FORMAT = 1;
export const zipAnswerKey = (zip: string): string => `reader/zip/${zip}.json.br`;
const partKey = (hash: string): string => `reader/zip-part/${hash}.json.br`;

/** A state's answer for the ZIP, exactly as `/api/reader/state?state=S&zip=Z` returns it. */
export interface ZipStateAnswer { readonly version: string; readonly body: Record<string, unknown> }

export interface ZipAnswer {
  readonly zip: string;
  /** The body `/api/location/zip` returns. */
  readonly location: Record<string, unknown>;
  /** By state code, for each state the ZIP lies in. */
  readonly states: Readonly<Record<string, ZipStateAnswer>>;
  /** The ZIP's place entry and display point. */
  readonly place: PlaceEntry;
  readonly point: ZctaCentroid;
  /** The territory boards at the point, so a request naming a different point is answered the long way. */
  readonly territoryBodyIds: readonly string[];
  /** The saved pages the package was composed from, which name the answer's cache tags. */
  readonly pageIds: readonly string[];
  /** What `/api/meetings` reads of the saved pages; the meetings themselves are composed against the clock at request time. */
  readonly package: PlacePackage;
}

/** The ZIP file as stored: the registry is replaced by its divisions and the fingerprint of the rest. */
type StoredAnswer = Omit<ZipAnswer, "package"> & { readonly package: Omit<PlacePackage, "registry"> & { readonly registry: { readonly divisions: unknown; readonly shared: string } | null } };

export interface PackedZipAnswer {
  /** Two builds of a ZIP with the same print are the same answer. */
  readonly print: string;
  readonly file: Uint8Array;
  /** The state's registry, filed under its fingerprint; null when the ZIP holds none. */
  readonly part: { readonly key: string; readonly bytes: Uint8Array } | null;
}

const brotli = (text: string): Uint8Array => brotliCompressSync(Buffer.from(text), {
  params: { [constants.BROTLI_PARAM_QUALITY]: 9, [constants.BROTLI_PARAM_SIZE_HINT]: text.length } });

export function packZipAnswer(answer: ZipAnswer): PackedZipAnswer {
  const print = createHash("sha256").update(JSON.stringify(answer)).digest("hex").slice(0, 32);
  const registry = answer.package.registry;
  let part: PackedZipAnswer["part"] = null, stored: StoredAnswer = answer as unknown as StoredAnswer;
  if (registry) {
    // Everything of the registry but its divisions; the divisions' place keeps its key order when they are put back.
    const text = JSON.stringify({ ...registry, registry: { ...registry.registry, divisions: [] } }), hash = createHash("sha256").update(text).digest("hex").slice(0, 32);
    part = { key: partKey(hash), bytes: brotli(text) };
    stored = { ...answer, package: { ...answer.package, registry: { divisions: registry.registry.divisions, shared: hash } } };
  }
  return { print, file: brotli(`{"v":${FORMAT},"print":"${print}","answer":${JSON.stringify(stored)}}`), part };
}

/** Parts are fingerprinted and never change, so a server keeps their packed bytes and decodes a fresh copy for each answer. */
const heldParts = serverReaderValue("zip-answer-parts", () => new Map<string, Uint8Array>());
const HELD_PARTS = 24;

async function readPart(store: ReaderArtifactStore, hash: string): Promise<RegistryRuntimeReadModel | null> {
  let bytes = heldParts.get(hash);
  if (!bytes) {
    bytes = await store.readBytes(partKey(hash), { strong: true }) ?? undefined;
    if (!bytes) return null;
    heldParts.set(hash, bytes);
    for (const oldest of heldParts.keys()) { if (heldParts.size <= HELD_PARTS) break; heldParts.delete(oldest); }
  }
  return JSON.parse(brotliDecompressSync(bytes).toString("utf8")) as RegistryRuntimeReadModel;
}

export async function unpackZipAnswer(store: ReaderArtifactStore, bytes: Uint8Array, zip: string): Promise<(ZipAnswer & { readonly print: string }) | null> {
  const file = JSON.parse(brotliDecompressSync(bytes).toString("utf8")) as { v?: number; print?: string; answer?: StoredAnswer };
  const answer = file.answer;
  if (file.v !== FORMAT || typeof file.print !== "string" || answer?.zip !== zip) return null;
  const held = answer.package.registry;
  if (!held) return { ...(answer as unknown as ZipAnswer), print: file.print };
  const shared = await readPart(store, held.shared);
  if (!shared) return null;
  const registry = { ...shared, registry: { ...shared.registry, divisions: held.divisions } } as RegistryRuntimeReadModel;
  return { ...answer, package: { ...answer.package, registry }, print: file.print };
}

/**
 * The published answer for a ZIP, or null when none is held (or the store cannot be read), so the caller answers from the database as before.
 * Read strongly: a republished ZIP is purged from the CDN right after its write, and the next fetch must find the new file.
 */
export async function readZipAnswer(zip: string, store: ReaderArtifactStore | null = resolveReaderArtifactStore()): Promise<(ZipAnswer & { readonly print: string }) | null> {
  if (!store || !/^\d{5}$/.test(zip)) return null;
  try {
    const bytes = await store.readBytes(zipAnswerKey(zip), { strong: true });
    return bytes ? await unpackZipAnswer(store, bytes, zip) : null;
  } catch { return null; }
}
