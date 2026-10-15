import { currentBodyRosters } from "../registry/body-rosters.ts";
import { getRegistryRuntimeReadModel } from "../registry/runtime-read-model.ts";
import type { RegistryRuntimeReadModel } from "../registry/runtime-data-plane.ts";

/**
 * Which body this is, read synchronously off the canonical registry. A
 * division can hold several bodies, so the `bodyId` is the identity and the
 * division is context only; `bodyName` on a meeting is not the body's name.
 *
 * Names fall back in order: the registry's sourced name, the curated roster's
 * (`currentBodyRosters()`), the division's label, then
 * an un-slugging of the id's body half. Nothing here mints an identity.
 *
 * A view of `lib/registry/registry.json`, cached on the file's mtime and never
 * written. `/api/ask/grounded` traces `./lib/registry/*.json` in
 * `next.config.ts`, so the file is in the deployed bundle.
 */

/**
 * One body, as the identity rungs need it. The `bodyId` is the identity; the
 * division is CONTEXT and may never be substituted for it.
 */
export interface CanonicalBodyIdentity {
  sourceUrl?: string | null;
  retrievedAt?: string | null;
  /** The registry's own id. `<ocdId>#<slot>`, or a `curated:`/`wtp-body/` id. */
  bodyId: string;
  /** Reader-safe. Sourced from the registry, or the division's own label. */
  name: string;
  /** WHERE this body sits. Null for a body with no division at all. */
  ocdId: string | null;
  /** The division's type, for the binder's class tie-break. */
  divisionType: string | null;
  /** `GOVERNING`, `ADVISORY`, `COMMISSION`, ... — the registry's own value. */
  bodyClass: string | null;
  /**
   * The division's own sourced label, carried separately so a caller can
   * qualify a body whose own name identifies nothing ("Planning Board").
   */
  divisionLabel: string | null;
  /**
   * True when the name is the body's own (registry or curated roster); false
   * when the division's label stands in for an unnamed derived row.
   */
  nameIsBodysOwn: boolean;
}

interface RegistryBodyRow {
  id: string;
  ocdId: string | null;
  name: string | null;
  bodyClass?: string | null;
  provenance?: { sourceUrl?: string | null; collectedAt?: string | null };
}

interface RegistryDivisionRow {
  ocdId: string;
  divisionType?: string | null;
  label?: string | null;
}

interface RegistryFile {
  bodies?: RegistryBodyRow[];
  divisions?: RegistryDivisionRow[];
}

interface LoadedIndex {
  runtime: RegistryRuntimeReadModel;
  byBodyId: Map<string, CanonicalBodyIdentity>;
}

let cached: LoadedIndex | null = null;

/**
 * A trailing parenthetical acronym ("(DRB)") is stripped from the readable
 * name, because the binder requires every distinctive token. The id is still
 * the identity.
 */
function withoutTrailingAcronym(name: string): string {
  return name.replace(/\s*\([A-Z][A-Za-z0-9&.\-\/ ]{0,15}\)\s*$/, "").trim();
}

/**
 * The curated roster's name for a body, or "". A fallback only: a registry row
 * that names the body wins.
 */
function rosterBodyName(bodyId: string): string {
  const name = rosterNames().get(bodyId);
  return name ?? "";
}

function rosterNames(): Map<string, string> {
  const names = new Map<string, string>();
  for (const roster of currentBodyRosters()) {
    // First writer wins; projection validation separately forbids duplicates.
    if (!names.has(roster.bodyId)) {
      names.set(roster.bodyId, roster.bodyName);
    }
  }
  return names;
}

function buildIndex(runtime: RegistryRuntimeReadModel): Map<string, CanonicalBodyIdentity> {
  const registry = runtime.registry as RegistryFile;

  const divisions = new Map<string, RegistryDivisionRow>();
  for (const division of registry.divisions ?? []) {
    divisions.set(division.ocdId, division);
  }

  const byBodyId = new Map<string, CanonicalBodyIdentity>();

  const add = (row: RegistryBodyRow): void => {
    if (!row?.id || byBodyId.has(row.id)) return;
    const division = row.ocdId ? divisions.get(row.ocdId) ?? null : null;
    const own = row.name ? withoutTrailingAcronym(row.name) : "";
    /* The roster's name, consulted only where the registry row holds none. */
    const roster = own ? "" : rosterBodyName(row.id);
    /*
     * Registry name, roster name, division label, then an un-slugging of the
     * id's body half (never the division half).
     */
    const name =
      own ||
      roster ||
      division?.label ||
      unslugBodySuffix(row.id) ||
      row.id;
    byBodyId.set(row.id, {
      sourceUrl: own ? row.provenance?.sourceUrl ?? null : currentBodyRosters().find((r) => r.bodyId === row.id)?.sourceUrl ?? row.provenance?.sourceUrl ?? null,
      retrievedAt: row.provenance?.collectedAt ?? null,
      bodyId: row.id,
      name,
      ocdId: row.ocdId ?? null,
      divisionType: division?.divisionType ?? null,
      bodyClass: row.bodyClass ?? null,
      divisionLabel: division?.label ?? null,
      nameIsBodysOwn: own.length > 0 || roster.length > 0,
    });
  };

  for (const row of registry.bodies ?? []) add(row);

  return byBodyId;
}

/** The `#slot` half of a body id, un-slugged. Never the division half. */
function unslugBodySuffix(bodyId: string): string {
  const at = bodyId.lastIndexOf("#");
  if (at < 0) return "";
  return bodyId
    .slice(at + 1)
    .replace(/[-_]/g, " ")
    .trim();
}

/** The whole index, cached on the registry file's mtime so a regeneration is picked up. */
export function bodyIdentityIndex(root?: string): Map<string, CanonicalBodyIdentity> {
  if (root !== undefined) throw new Error("Tracked registry roots are test evidence only; initialize the canonical runtime projection instead.");
  const runtime = getRegistryRuntimeReadModel();
  if (cached?.runtime === runtime) return cached.byBodyId;
  const byBodyId = buildIndex(runtime);
  cached = { runtime, byBodyId };
  return byBodyId;
}

/**
 * The canonical identity of one body, or null where the registry holds none.
 * Null never licenses a fallback to the division.
 */
export function canonicalBodyIdentity(
  bodyId: string | null | undefined,
  root?: string,
): CanonicalBodyIdentity | null {
  if (!bodyId) return null;
  return bodyIdentityIndex(root).get(bodyId) ?? null;
}

/** Drop the cache. For tests and for a long-lived process that regenerates. */
export function resetBodyIdentityCache(): void {
  cached = null;
}
