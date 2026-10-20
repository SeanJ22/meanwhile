import type { ReadOnlyQuery } from "../control-plane/admin-view/promoted-slices.ts";
import type { Jurisdiction, JurisdictionRegistry, JurisdictionSource } from "../hunt/jurisdiction-universe.ts";
import { readPublishedArraySlice, type PublishedArraySlice } from "./published-array-slice.ts";
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

const exactIds = (ids: readonly string[]) => ids.length ? `^(?:${ids.map(id => id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})$` : "(?!)";

/** A lease worker reads its subjects before transfer, retaining the original GOOD publication identity. */
export async function readOperationalReferenceSubjects(state: string, subjectIds: readonly string[], query?: ReadOnlyQuery | null) {
  const key = state.toLowerCase(); if (!/^[a-z]{2}$/.test(key)) throw new Error("OPERATIONAL_REFERENCE_STATE_INVALID");
  const ids = [...new Set(subjectIds.filter(Boolean))];
  if (!ids.length) throw new Error("OPERATIONAL_REFERENCE_SUBJECT_REQUIRED");
  const candidates = key === "az" ? [AZ_JURISDICTION_REFERENCE_SCOPE, JURISDICTION_REFERENCE_SCOPE] : [JURISDICTION_REFERENCE_SCOPE];
  const failures: string[] = [];
  for (const scope of candidates) {
    try {
      const slice = <T>(path: readonly string[], extra: { objectRecord?: boolean; keepKeys?: readonly string[]; statePath?: readonly string[]; statePattern?: string } = {}) =>
        readPublishedArraySlice<T>({ recordClass: OPERATIONAL_REFERENCE_RECORD_CLASS, scope, path, statePath: [], statePattern: ".*", ...extra, query });
      const header = await slice<Pick<JurisdictionRegistry, "formatVersion" | "stateCode" | "generatedBy" | "generatedOn">>(["registries", key],
        { objectRecord: true, keepKeys: ["formatVersion", "stateCode", "generatedBy", "generatedOn"], statePath: ["stateCode"], statePattern: `^${key.toUpperCase()}$|^${key}$` });
      if (!header?.records.length) continue;
      if (header.sourceVersion !== JURISDICTION_REFERENCE_VERSION) throw new Error("OPERATIONAL_REFERENCE_VERSION_INVALID");
      const checked = <T>(read: PublishedArraySlice<T> | null): readonly T[] => {
        if (!read || read.input.versionId !== header.input.versionId || read.input.readModelSha256 !== header.input.readModelSha256)
          throw new Error("OPERATIONAL_REFERENCE_POINTER_CHANGED");
        return read.records;
      };
      const jurisdictions = checked(await slice<Jurisdiction>(["registries", key, "jurisdictions"], { statePath: ["id"], statePattern: exactIds(ids) }));
      const sourceCatalog: Record<string, JurisdictionSource> = {};
      for (const id of new Set(jurisdictions.flatMap(row => row.sourceIds))) {
        const source = checked(await slice<JurisdictionSource>(["registries", key, "sourceCatalog", id], { objectRecord: true }));
        if (source.length !== 1) throw new Error(`OPERATIONAL_REFERENCE_SOURCE_MISSING:${id}`);
        sourceCatalog[id] = source[0]!;
      }
      const enumerationSources = jurisdictions.length ? checked(await slice<JurisdictionRegistry["enumerationSources"][number]>(["registries", key, "enumerationSources"],
        { statePath: ["id"], statePattern: exactIds(jurisdictions.map(row => row.enumeratedFrom)) })) : [];
      const counts: Record<string, number> = {};
      for (const row of jurisdictions) counts[row.govClass] = (counts[row.govClass] ?? 0) + 1;
      const registry: JurisdictionRegistry = { ...header.records[0]!, jurisdictions, sourceCatalog, enumerationSources, counts, _note: [], disagreements: [] };
      return { registry, input: header.input, versionId: header.input.versionId, scope };
    } catch (error) { failures.push(`${scope}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  throw new Error(`OPERATIONAL_REFERENCE_STATE_NOT_PROMOTED:${key}:${failures.join(";") || "no exact registry"}`);
}
