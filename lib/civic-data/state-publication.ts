import { types } from "node:util";
import { AsyncLocalStorage } from "node:async_hooks";
import { STATE_BALLOT_FAMILIES, stateFromBallotScope } from "../ballot/state-scopes.ts";
import { stateFromRegistryRuntimeScope } from "../registry/state-scopes.ts";
import { canonicalCivicDataHash } from "./canonical-hash.ts";
import type { PromotedProjection, RoutineCandidate } from "./types.ts";

const publicationRead = new AsyncLocalStorage<PromotedProjection>();

export function withStatePublicationRead<T>(projection: PromotedProjection, read: () => Promise<T>): Promise<T> {
  return publicationRead.run(projection, read);
}

export function heldStatePublication(recordClass: string, scope: string): PromotedProjection | null {
  const held = publicationRead.getStore();
  return held?.recordClass === recordClass && held.scope === scope ? held : null;
}

export function statePublicationScope(scope: string): boolean {
  return STATE_BALLOT_FAMILIES.some(family => stateFromBallotScope(scope, family) !== null) ||
    stateFromRegistryRuntimeScope(scope) !== null;
}

const immutableValues = new WeakSet<object>();
const immutableHashes = new WeakMap<object, string>();

export function immutableStateHash(value: unknown): string {
  const owned = value !== null && typeof value === "object" && immutableValues.has(value);
  const saved = owned ? immutableHashes.get(value) : undefined;
  if (saved) return saved;
  const hash = canonicalCivicDataHash(value);
  if (owned) immutableHashes.set(value, hash);
  return hash;
}

export function durableStateHash(value: unknown): string | null {
  try {
    const hash = immutableStateHash(value);
    if (value !== null && typeof value === "object" && immutableValues.has(value)) return hash;
    return hash === canonicalCivicDataHash(value, { durable: true }) ? hash : null;
  } catch { return null; }
}

export function immutableStateCandidate(candidate: RoutineCandidate): RoutineCandidate {
  return immutableStateValue(candidate);
}

export function immutableStateValue<T>(candidate: T): T {
  const omitted = Symbol("omitted"), normalized = new WeakMap<object, unknown>(), parents = new Set<object>();
  const visit = (original: unknown, key: string): unknown => {
    let value = original;
    if (value !== null && (typeof value === "object" || typeof value === "bigint")) {
      const toJSON = (value as { toJSON?: unknown }).toJSON;
      if (typeof toJSON === "function") value = toJSON.call(value, key);
    }
    if (types.isNumberObject(value)) value = Number(value);
    if (types.isStringObject(value)) value = String(value);
    if (types.isBooleanObject(value)) value = Boolean.prototype.valueOf.call(value);
    if (types.isBigIntObject(value)) value = BigInt.prototype.valueOf.call(value);
    if (typeof value === "bigint") throw new TypeError("A state candidate cannot contain a BigInt.");
    if (value === undefined || typeof value === "function" || typeof value === "symbol") return omitted;
    if (typeof value === "number") return Number.isFinite(value) ? value === 0 ? 0 : value : null;
    if (value === null || typeof value !== "object") return value;
    if (immutableValues.has(value)) return value;
    if (parents.has(value)) throw new TypeError("A state candidate cannot contain a circular value.");
    if (normalized.has(value)) return normalized.get(value);
    parents.add(value);
    const array = Array.isArray(value), row = value as Record<string, unknown>;
    let copy: Record<string, unknown> | unknown[] | null = Object.getPrototypeOf(value) === (array ? Array.prototype : Object.prototype)
      ? null : array ? [...value as unknown[]] : { ...row };
    const keys = array ? Array.from({ length: (value as unknown[]).length }, (_, index) => String(index)) : Object.keys(row);
    for (const childKey of keys) {
      const child = visit(row[childKey], childKey), next = child === omitted && array ? null : child;
      if (next === omitted || !Object.is(next, row[childKey]) || Object.getOwnPropertyDescriptor(value, childKey)?.get) {
        copy ??= array ? [...value as unknown[]] : { ...row };
        if (next === omitted) delete (copy as Record<string, unknown>)[childKey];
        else Object.defineProperty(copy, childKey, { value: next, enumerable: true, configurable: true, writable: true });
      }
    }
    parents.delete(value);
    const result = Object.freeze(copy ?? value);
    immutableValues.add(result);
    normalized.set(value, result);
    return result;
  };
  return visit(candidate, "") as T;
}

const PATH = "$civicCandidatePath";
type PayloadPath = readonly string[];

export function encodeStateCandidate(candidate: RoutineCandidate): RoutineCandidate {
  const paths = new WeakMap<object, PayloadPath>();
  const index = (value: unknown, path: PayloadPath): void => {
    if (value === null || typeof value !== "object" || paths.has(value)) return;
    paths.set(value, path);
    for (const key of Object.keys(value)) index((value as Record<string, unknown>)[key], [...path, key]);
  };
  index(candidate.readModel, []);
  const encoded = new WeakMap<object, unknown>();
  const aliases = (value: unknown): unknown => {
    if (value === null || typeof value !== "object") return value;
    const path = paths.get(value);
    if (path) return { [PATH]: path };
    if (encoded.has(value)) return encoded.get(value);
    let copy: Record<string, unknown> | unknown[] | null = null;
    for (const key of Object.keys(value)) {
      const child = (value as Record<string, unknown>)[key], next = aliases(child);
      if (next !== child) {
        copy ??= Array.isArray(value) ? [...value] : { ...value };
        Object.defineProperty(copy, key, { value: next, enumerable: true, configurable: true, writable: true });
      }
    }
    const result = copy ?? value;
    encoded.set(value, result);
    return result;
  };
  return Object.fromEntries(Object.entries(candidate).map(([key, value]) =>
    [key, key === "readModel" ? value : aliases(value)])) as unknown as RoutineCandidate;
}

export function decodeStateCandidate(value: unknown): unknown {
  if (value === null || typeof value !== "object" || !("readModel" in value)) return value;
  const root = value as Record<string, unknown>;
  const resolve = (node: unknown): unknown => {
    if (node === null || typeof node !== "object") return node;
    const row = node as Record<string, unknown>;
    if (Object.keys(row).length === 1 && Array.isArray(row[PATH])) {
      let result = root.readModel;
      for (const key of row[PATH]) {
        if (typeof key !== "string" || result === null || typeof result !== "object" || !Object.hasOwn(result, key))
          throw new Error("CIVIC_CANDIDATE_PATH_INVALID");
        result = (result as Record<string, unknown>)[key];
      }
      return result;
    }
    for (const key of Object.keys(row)) row[key] = resolve(row[key]);
    return node;
  };
  for (const key of Object.keys(root)) if (key !== "readModel") root[key] = resolve(root[key]);
  return root;
}
