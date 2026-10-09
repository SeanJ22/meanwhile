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
}

/** Source-defined plans, not a calculation from the current year. Older saved
 * releases retain these established semantics until republished with metadata. */
export function establishedApplicability(version: string): readonly GeographyApplicability[] {
  switch (version) {
    case "cd:119": return [{ purpose: "representation", from: "2025-01-03", through: "2027-01-03" }];
    case "cd:120": return [
      { purpose: "election", from: "2026-11-03", through: "2026-11-04" },
      { purpose: "representation", from: "2027-01-03", through: "2029-01-03" },
    ];
    // The held 2024 state plans describe representation. Election use needs
    // explicit source applicability; a newer map can take effect mid-cycle.
    case "sldu:2024":
    case "sldl:2024": return [{ purpose: "representation", from: "2025-01-01", through: "2027-01-01" }];
    default: return [];
  }
}

type Selectable = Pick<GeographyVersion, "key" | "type"> & Partial<Pick<GeographyVersion, "applicability" | "retrievalComplete">>;

export function currentRepresentationSelection(now = new Date()): GeographySelection {
  return { purpose: "representation", asOf: now.toISOString().slice(0, 10) };
}

/** Ambiguous plans and incomplete retrievals establish no replacement. */
export function selectGeographyVersion<T extends Selectable>(versions: readonly T[], type: GeographyType, selection: GeographySelection): T | null {
  const day = (selection.purpose === "election" ? selection.electionDate : selection.asOf)?.slice(0, 10);
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const eligible = versions.filter(version => version.type === type && version.retrievalComplete !== false &&
    (version.applicability ?? establishedApplicability(version.key)).some(interval => interval.purpose === selection.purpose &&
      day >= interval.from && (interval.through === undefined || day < interval.through)));
  const unique = new Map(eligible.map(version => [version.key, version]));
  return unique.size === 1 ? unique.values().next().value! : null;
}
