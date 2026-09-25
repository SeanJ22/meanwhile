/**
 * **THE READINESS STANDARD, AS VERSIONED DATA.** (MW-063, 2026-09-25.)
 *
 * What counts as done — the five ordered gates and the capability taxonomy —
 * was code, so a result could not say which bar it was measured against, and
 * raising the bar left no record beside the old one. It now lives in
 * `standard.json`: every version has an id (the same string a published
 * snapshot stamps as its `derivationContract`), an adoption date, the date a
 * later version superseded it, and what it asked. The gates and taxonomy the
 * code runs are LOADED from the current version (`gates.ts`, `catalog.ts`),
 * and a test holds the manifest and the code's contract to each other.
 *
 * A version recorded before the standard was data carries no gates or
 * capabilities here, and says so; a snapshot measured under it stays
 * readable, and is reported against the version it names.
 *
 * Imports nothing from the readiness modules but types: `gates.ts` loads this,
 * and `model.ts` loads `gates.ts`.
 */
import manifest from "./standard.json" with { type: "json" };

export interface StandardGate {
  readonly id: string;
  readonly label: string;
  readonly definition: string;
}

export interface StandardCapability {
  readonly capabilityId: string;
  readonly domain: string;
  readonly label: string;
  readonly level: string;
}

export interface StandardVersion {
  /** The derivation contract string a snapshot measured under this version carries. */
  readonly id: string;
  /** UTC date the version came into force. */
  readonly adoptedOn: string;
  /** UTC date a later version replaced it; null for the version in force. */
  readonly supersededOn: string | null;
  readonly summary: string;
  /** The gates in order, or null for a version recorded before the standard was data. */
  readonly gates: readonly StandardGate[] | null;
  readonly capabilities: readonly StandardCapability[] | null;
  /** Why the gates and capabilities are absent, when they are. */
  readonly notRecorded?: string;
}

export interface ReadinessStandard {
  readonly formatVersion: 1;
  /** The version in force: the contract the publisher stamps and the read path trusts. */
  readonly current: string;
  readonly versions: readonly StandardVersion[];
}

export const READINESS_STANDARD: ReadinessStandard = manifest as ReadinessStandard;

/** A version by its id, or null when the manifest names no such version (a legacy or unknown marker). */
export function standardVersion(id: string | null | undefined): StandardVersion | null {
  return READINESS_STANDARD.versions.find((v) => v.id === id) ?? null;
}

/** The version in force. Throws when the manifest's `current` names no version with gates and capabilities: a standard the code cannot run. */
export function currentStandard(): StandardVersion & { readonly gates: readonly StandardGate[]; readonly capabilities: readonly StandardCapability[] } {
  const v = standardVersion(READINESS_STANDARD.current);
  if (v === null || v.gates === null || v.capabilities === null) {
    throw new Error(`READINESS_STANDARD_UNUSABLE: the manifest's current version ${READINESS_STANDARD.current} is missing or carries no gates and capabilities`);
  }
  return v as StandardVersion & { readonly gates: readonly StandardGate[]; readonly capabilities: readonly StandardCapability[] };
}

/** Every version, newest first, for the page that lists them. */
export function standardHistory(): readonly StandardVersion[] {
  return [...READINESS_STANDARD.versions].sort((a, b) => (a.adoptedOn < b.adoptedOn ? 1 : a.adoptedOn > b.adoptedOn ? -1 : 0));
}
