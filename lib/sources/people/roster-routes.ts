import officialRosters from "../../../data/reference/official-legislature-rosters.json" with { type: "json" };

/** A legislature's own current roster pages, kept as data so a moved route needs no code. */
export function officialLegislatureRosterRoutes(state: string): readonly string[] {
  return (officialRosters.rosters as Readonly<Record<string, readonly string[]>>)[state.replace(/^US-/i, "").toUpperCase()] ?? [];
}
