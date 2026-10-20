import type { ReadOnlyQuery } from "../control-plane/admin-view/promoted-slices.ts";
import type { JurisdictionRegistry } from "../hunt/jurisdiction-universe.ts";
import { readPublishedArraySlice } from "./published-array-slice.ts";
import { AZ_JURISDICTION_REFERENCE_SCOPE, JURISDICTION_REFERENCE_SCOPE, JURISDICTION_REFERENCE_VERSION,
  OPERATIONAL_REFERENCE_RECORD_CLASS } from "./operational-references.ts";

const scopes = [JURISDICTION_REFERENCE_SCOPE, AZ_JURISDICTION_REFERENCE_SCOPE] as const;
export type OperationalAuthorityRead = <T>(read: () => Promise<T>) => Promise<T>;
const readOnce: OperationalAuthorityRead = read => read();

/** Only state names and authority version IDs cross the connection during planner intake. */
export async function readOperationalReferenceStateIndex(query?: ReadOnlyQuery | null, readAuthority: OperationalAuthorityRead = readOnce) {
  const states = new Set<string>(), versions = new Map<string, string>(), failures: string[] = [];
  let readable = false;
  for (const scope of scopes) {
    try {
      const read = await readAuthority(() => readPublishedArraySlice<readonly string[]>({ recordClass: OPERATIONAL_REFERENCE_RECORD_CLASS,
        scope, path: ["registries"], objectRecord: true, objectKeys: true, statePath: [], statePattern: ".*", query }));
      if (!read) continue;
      if (read.sourceVersion !== JURISDICTION_REFERENCE_VERSION) throw new Error("OPERATIONAL_REFERENCE_VERSION_INVALID");
      readable = true;
      for (const state of read.records[0] ?? []) if (/^[a-z]{2}$/.test(state)) { states.add(state); versions.set(state, read.input.versionId); }
    } catch (error) { failures.push(`${scope}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  if (!readable || states.size === 0) throw new Error(`OPERATIONAL_REFERENCE_READ_NOT_INITIALIZED:${failures.join(";") || "no promoted registry states"}`);
  return { states: [...states].sort(), versions, failures };
}

/** Exact object projection also serves an existing national legacy pointer without decoding its other states. */
export async function readOperationalReferenceState(state: string, query?: ReadOnlyQuery | null, readAuthority: OperationalAuthorityRead = readOnce) {
  const key = state.toLowerCase(); if (!/^[a-z]{2}$/.test(key)) throw new Error("OPERATIONAL_REFERENCE_STATE_INVALID");
  const candidates = key === "az" ? [AZ_JURISDICTION_REFERENCE_SCOPE, JURISDICTION_REFERENCE_SCOPE] : [JURISDICTION_REFERENCE_SCOPE];
  const failures: string[] = [];
  for (const scope of candidates) {
    try {
      const read = await readAuthority(() => readPublishedArraySlice<JurisdictionRegistry>({ recordClass: OPERATIONAL_REFERENCE_RECORD_CLASS,
        scope, path: ["registries", key], objectRecord: true, statePath: ["stateCode"], statePattern: `^${key.toUpperCase()}$|^${key}$`, query }));
      if (!read || !read.records.length) continue;
      if (read.sourceVersion !== JURISDICTION_REFERENCE_VERSION) throw new Error("OPERATIONAL_REFERENCE_VERSION_INVALID");
      return { registry: read.records[0]!, versionId: read.input.versionId, scope };
    } catch (error) { failures.push(`${scope}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  throw new Error(`OPERATIONAL_REFERENCE_STATE_NOT_PROMOTED:${key}:${failures.join(";") || "no exact registry"}`);
}
