import type { GeographyType, GeographyVersion } from "./contract.ts";

export interface GeographySelection {
  readonly purpose: "representation" | "election";
  readonly asOf: string;
  readonly electionDate?: string;
}

export interface GeographyApplicability {
  readonly purpose: GeographySelection["purpose"];
  readonly from: string;
  /** Exclusive end; omitted only when the source establishes no end yet. */
  readonly through?: string;
  readonly exceptStates?: readonly string[];
}

// Census grf/2026 CDCURFP vs tab20 CD119, measured in docs/census-geography.md:
// https://www2.census.gov/geo/docs/maps-data/data/grf/2026/
export const CD_REDRAWN_FOR_2026 = ["AL", "CA", "FL", "LA", "MO", "NC", "OH", "TN", "TX", "UT"] as const;
// Census grf/2026 SLDUST (grfn LSY=2026) vs tab20 SLDU2024:
// https://www2.census.gov/geo/docs/maps-data/data/grf/2026/
export const SLDU_REDRAWN_FOR_2026 = ["AL", "MI", "SD"] as const;
// Census grf/2026 SLDLST (grfn LSY=2026) vs tab20 SLDL2024:
// https://www2.census.gov/geo/docs/maps-data/data/grf/2026/
export const SLDL_REDRAWN_FOR_2026 = ["SD"] as const;

/** Source-established intervals correct earlier saved copies on every read. */
export function establishedApplicability(version: string): readonly GeographyApplicability[] {
  switch (version) {
    case "cd:119": return [
      { purpose: "representation", from: "2025-01-03", through: "2027-01-03" },
      { purpose: "representation", from: "2027-01-03", exceptStates: CD_REDRAWN_FOR_2026 },
      { purpose: "election", from: "2024-11-05", exceptStates: CD_REDRAWN_FOR_2026 },
    ];
    case "cd:120": return [
      { purpose: "election", from: "2026-11-03" },
      { purpose: "representation", from: "2027-01-03" },
    ];
    case "sldu:2024":
    case "sldl:2024": {
      const exceptStates = version === "sldu:2024" ? SLDU_REDRAWN_FOR_2026 : SLDL_REDRAWN_FOR_2026;
      return [
        { purpose: "representation", from: "2025-01-01", through: "2027-01-01" },
        { purpose: "representation", from: "2027-01-01", exceptStates },
        { purpose: "election", from: "2024-11-05", exceptStates },
      ];
    }
    case "sldu:2026":
    case "sldl:2026": return [
      { purpose: "election", from: "2026-11-03" },
      { purpose: "representation", from: "2027-01-01" },
    ];
    default: return [];
  }
}

type Selectable = Pick<GeographyVersion, "key" | "type"> & Partial<Pick<GeographyVersion, "applicability" | "retrievalComplete" | "states">>;

export function applicabilityOf(version: Pick<Selectable, "key" | "applicability">): readonly GeographyApplicability[] {
  const established = establishedApplicability(version.key);
  return established.length ? established : version.applicability ?? [];
}

export function currentRepresentationSelection(now = new Date()): GeographySelection {
  return { purpose: "representation", asOf: now.toISOString().slice(0, 10) };
}

/** Ambiguous plans and incomplete retrievals establish no replacement. */
export function selectGeographyVersion<T extends Selectable>(versions: readonly T[], type: GeographyType, selection: GeographySelection, state?: string): T | null {
  const day = (selection.purpose === "election" ? selection.electionDate : selection.asOf)?.slice(0, 10);
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const held = versions.filter(version => version.type === type && version.retrievalComplete !== false &&
    (!state || !version.states || version.states.some(heldState => heldState.toUpperCase() === state.toUpperCase())))
    .flatMap(version => applicabilityOf(version)
      .filter(interval => interval.purpose === selection.purpose &&
        (!state || !interval.exceptStates?.some(excluded => excluded.toUpperCase() === state.toUpperCase())))
      .map(interval => ({ version, interval })));
  // A continuation belongs to the plan that first began earlier. A successor
  // can start when that continuation starts; two plans first starting together
  // remain ambiguous.
  const starts = new Map<string, string>();
  for (const { version, interval } of held) {
    const first = starts.get(version.key);
    if (first === undefined || interval.from < first) starts.set(version.key, interval.from);
  }
  const eligible = held.filter(({ version, interval }) => day >= interval.from &&
    (interval.through === undefined ? !held.some(next => next.version.key !== version.key &&
      starts.get(next.version.key)! > starts.get(version.key)! && next.interval.from <= day)
      : day < interval.through)).map(({ version }) => version);
  const unique = new Map(eligible.map(version => [version.key, version]));
  return unique.size === 1 ? unique.values().next().value! : null;
}
