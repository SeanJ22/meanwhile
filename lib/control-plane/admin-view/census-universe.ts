/**
 * **WHAT THE CENSUS KNOWS ABOUT A STATE, IN WORDS.** (2026-09-23.)
 *
 * Admin tracks every state, registered or not (Sean: "it needs to be able to
 * track and keep up everywhere, not just a small subset"). A state nobody has
 * registered still has a known universe — the Census of Governments units and
 * the ZIP codes that reach it — and that is what its row says instead of a
 * zero, which would claim the system looked. The figures come from
 * `data/derived/state-census-denominators.json`.
 *
 * PURE: no I/O.
 */

export interface CensusStateEntry {
  /** Census of Governments units by type: all of them, and those placed on at least one ZIP. */
  readonly governments: Readonly<Record<string, { readonly total: number; readonly onAZip: number }>>;
  /** ZIP codes whose area reaches the state. */
  readonly zips: number;
}

const KINDS: readonly (readonly [string, string, string])[] = [
  ["COUNTY", "county", "counties"],
  ["MUNICIPAL", "municipality", "municipalities"],
  ["TOWNSHIP", "township", "townships"],
  ["SCHOOL DISTRICT", "school district", "school districts"],
  ["SPECIAL DISTRICT", "special district", "special districts"],
];

function n(x: number): string {
  return x.toLocaleString("en-US");
}

/** Every Census of Governments unit the state holds, of every type. */
export function censusGovernments(entry: CensusStateEntry): number {
  return Object.values(entry.governments).reduce((sum, g) => sum + g.total, 0);
}

/**
 * "The Census lists 3,936 governments in Ohio — 88 counties, 926
 * municipalities, 1,308 townships, 665 school districts and 949 special
 * districts — across 1,234 ZIP codes." A territory the Census of Governments
 * does not survey says so rather than listing none.
 */
export function censusUniverseWords(name: string, entry: CensusStateEntry | null): string {
  if (entry === null) return `The Census figures for ${name} are not on file here.`;
  const zips = `${n(entry.zips)} ZIP ${entry.zips === 1 ? "code" : "codes"}`;
  const total = censusGovernments(entry);
  if (total === 0) return `The Census of Governments does not survey ${name}; its ${zips} are known.`;
  const parts = KINDS.flatMap(([key, one, many]) => {
    const g = entry.governments[key];
    return g !== undefined && g.total > 0 ? [`${n(g.total)} ${g.total === 1 ? one : many}`] : [];
  });
  const list = parts.length <= 1 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  return `The Census lists ${n(total)} ${total === 1 ? "government" : "governments"} in ${name} — ${list} — across ${zips}.`;
}
