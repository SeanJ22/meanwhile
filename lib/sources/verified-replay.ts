import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { temporaryPath } from "../civic-data/temporary-path.ts";

export interface VerifiedReplayReference { readonly path: string; readonly sha256: string; readonly byteLength: number }
type ReplayProperty = { readonly ref: VerifiedReplayReference; readonly encoding: "bytes" | "utf8" };
const directories = new Set<string>();
const properties = new WeakMap<object, ReadonlyMap<string, ReplayProperty>>();
process.once("exit", () => { for (const path of directories) rmSync(temporaryPath(path), { recursive: true, force: true }); });
const digest = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");

function checkedReference(value: VerifiedReplayReference): VerifiedReplayReference {
  if (!value || !/^[a-f0-9]{64}$/.test(value.sha256) || !Number.isSafeInteger(value.byteLength) || value.byteLength < 0 ||
    !basename(dirname(value.path)).startsWith("meanwhile-source-replay-") || basename(value.path) !== value.sha256)
    throw new Error("SOURCE_REPLAY_REFERENCE_INVALID");
  temporaryPath(value.path);
  return value;
}
export function readVerifiedReplay(reference: VerifiedReplayReference): Uint8Array {
  const ref = checkedReference(reference), bytes = readFileSync(ref.path);
  if (bytes.byteLength !== ref.byteLength || digest(bytes) !== ref.sha256) throw new Error("SOURCE_REPLAY_INTEGRITY_MISMATCH");
  return bytes;
}
function replayGetter(property: ReplayProperty): () => string | Uint8Array {
  return () => { const bytes = readVerifiedReplay(property.ref); return property.encoding === "utf8" ? new TextDecoder().decode(bytes) : bytes; };
}
function withReplay<T extends object>(metadata: T, entries: ReadonlyMap<string, ReplayProperty>): T {
  const descriptors: Record<string, PropertyDescriptor> = Object.getOwnPropertyDescriptors(metadata);
  delete descriptors.toJSON;
  for (const [key, property] of entries) descriptors[key] = { enumerable: true, configurable: true, get: replayGetter(property) };
  const record = Object.defineProperties({}, descriptors) as T;
  properties.set(record, entries);
  Object.defineProperty(record, "toJSON", { value: () => {
    const wire: Record<string, unknown> = {};
    for (const key of Object.keys(record)) if (!entries.has(key)) wire[key] = (record as Record<string, unknown>)[key];
    wire.__sourceReplay = Object.fromEntries(entries);
    return wire;
  } });
  return record;
}

/** Pass-local files keep completed source bodies out of every capture array.
 * Each replay checks the captured hash and length; files outlive IPC callbacks
 * and are removed explicitly or when their acquiring process exits. */
export class VerifiedReplayFiles {
  private directory: string | null = null;
  private disposed = false;
  hold(value: Uint8Array | string, expectedHash?: string): VerifiedReplayReference {
    if (this.disposed) throw new Error("SOURCE_REPLAY_DISPOSED");
    const sha256 = digest(value);
    if (expectedHash !== undefined && expectedHash.replace(/^sha256-/, "") !== sha256) throw new Error("SOURCE_REPLAY_IDENTITY_MISMATCH");
    this.directory ??= temporaryPath(mkdtempSync(join(tmpdir(), "meanwhile-source-replay-")));
    directories.add(this.directory);
    const path = temporaryPath(join(this.directory, sha256)), byteLength = typeof value === "string" ? Buffer.byteLength(value) : value.byteLength;
    if (!existsSync(path)) writeFileSync(temporaryPath(path), value, { flag: "wx", mode: 0o600 });
    return { path, sha256, byteLength };
  }
  capture<T extends { readonly bytes: Uint8Array }>(capture: T): T {
    return withReplay(capture, new Map([["bytes", { ref: this.hold(capture.bytes), encoding: "bytes" }]]));
  }
  text<T extends object, K extends keyof T & string>(record: T, key: K, expectedHash?: string): T {
    const value = record[key]; if (typeof value !== "string") throw new Error("SOURCE_REPLAY_TEXT_REQUIRED");
    return withReplay(record, new Map([[key, { ref: this.hold(value, expectedHash), encoding: "utf8" }]]));
  }
  dispose(): void {
    if (this.directory) { rmSync(temporaryPath(this.directory), { recursive: true, force: true }); directories.delete(this.directory); }
    this.disposed = true;
  }
}

/** Alias an already held page's text without copying it into linking evidence. */
export function replayPropertyAs<T extends object, K extends string>(source: object, from: string, to: K, metadata: T): T & Record<K, string> {
  const held = properties.get(source)?.get(from);
  if (held) return withReplay(metadata, new Map([[to, { ...held, encoding: "utf8" }]])) as T & Record<K, string>;
  return Object.defineProperty(metadata, to, { enumerable: true, configurable: true, get: () => {
    const value = (source as Record<string, unknown>)[from]; return typeof value === "string" ? value : new TextDecoder().decode(value as Uint8Array);
  } }) as T & Record<K, string>;
}

/** A linking chain can replay its original UTF-8 body for the raw vault without
 * constructing every ancestor's byte array together. */
export function replayBytesAs<T extends object>(source: object, from: string, metadata: T): T & { readonly bytes: Uint8Array } {
  const held = properties.get(source)?.get(from);
  if (held) return withReplay(metadata, new Map([["bytes", { ...held, encoding: "bytes" }]])) as T & { readonly bytes: Uint8Array };
  return Object.defineProperty(metadata, "bytes", { enumerable: true, configurable: true, get: () => new TextEncoder().encode(String((source as Record<string, unknown>)[from])) }) as T & { readonly bytes: Uint8Array };
}

/** Advanced Node IPC does not call toJSON. Encode the same replay identities
 * explicitly without evaluating a body getter, preserving shared metadata. */
export function encodeVerifiedReplay<T>(value: T): T {
  const seen = new WeakMap<object, unknown>();
  const visit = (input: unknown): unknown => {
    if (input === null || typeof input !== "object" || input instanceof Date || input instanceof ArrayBuffer || ArrayBuffer.isView(input)) return input;
    if (seen.has(input)) return seen.get(input);
    if (Array.isArray(input)) { const result: unknown[] = []; seen.set(input, result); for (const item of input) result.push(visit(item)); return result; }
    const result: Record<string, unknown> = {}, replay = properties.get(input); seen.set(input, result);
    for (const key of Object.keys(input)) if (!replay?.has(key)) result[key] = visit((input as Record<string, unknown>)[key]);
    if (replay) result.__sourceReplay = Object.fromEntries(replay);
    return result;
  };
  return visit(value) as T;
}

/** IPC carries metadata and verified file identities, never all earlier bodies.
 * The broker restores the ordinary source properties for existing validators. */
export function reviveVerifiedReplay<T>(wire: T): T {
  if (wire === null || typeof wire !== "object" || wire instanceof Date || wire instanceof ArrayBuffer || ArrayBuffer.isView(wire)) return wire;
  if (Array.isArray(wire)) return wire.map(value => reviveVerifiedReplay(value)) as T;
  const record: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(wire)) if (key !== "__sourceReplay") record[key] = reviveVerifiedReplay(value);
  const encoded = (wire as Record<string, unknown>).__sourceReplay;
  if (encoded === undefined) return record as T;
  if (!encoded || typeof encoded !== "object" || Array.isArray(encoded)) throw new Error("SOURCE_REPLAY_REFERENCE_INVALID");
  const entries = new Map<string, ReplayProperty>();
  for (const [key, value] of Object.entries(encoded)) {
    const property = value as ReplayProperty;
    if (!["text", "html", "bytes"].includes(key) || !property || !["bytes", "utf8"].includes(property.encoding)) throw new Error("SOURCE_REPLAY_REFERENCE_INVALID");
    checkedReference(property.ref);
    if (key === "text" && typeof record.contentHash === "string" && record.contentHash.replace(/^sha256-/, "") !== property.ref.sha256)
      throw new Error("SOURCE_REPLAY_IDENTITY_MISMATCH");
    entries.set(key, property);
  }
  return withReplay(record, entries) as T;
}
