/**
 * The school-district name key: one normalizer shared by every caller that joins Census and NCES school
 * system names, so the keys cannot drift.
 */
/**
 * The two agencies abbreviate differently (`CASTRO VAL UNIFIED SCH DIST` vs `Castro Valley Unified`).
 * Three passes, applied identically to both sides:
 *   1. Expand word-level abbreviations (SCH -> SCHOOL, UNIF -> UNIFIED).
 *   2. Expand acronyms that stand for a whole district type (ISD, CUSD, UFSD).
 *   3. Drop structural tokens: the words that say what kind of district this is rather than which one.
 * CITY and COUNTY are not dropped: `Albertville City` and `Marshall County` are different governments.
 */
const EXPAND: Record<string, string> = {
  SCH: "SCHOOL",
  SCHS: "SCHOOLS",
  DIST: "DISTRICT",
  DISTR: "DISTRICT",
  IND: "INDEPENDENT",
  INDEP: "INDEPENDENT",
  UNIF: "UNIFIED",
  ELEM: "ELEMENTARY",
  CONS: "CONSOLIDATED",
  CONSOL: "CONSOLIDATED",
  COMM: "COMMUNITY",
  CMTY: "COMMUNITY",
  REG: "REGIONAL",
  CTY: "COUNTY",
  CO: "COUNTY",
  TWP: "TOWNSHIP",
  ST: "SAINT",
  MT: "MOUNT",
  JT: "JOINT",
  BORO: "BOROUGH",
  VAL: "VALLEY",
  SPGS: "SPRINGS",
  HTS: "HEIGHTS",
  PUB: "PUBLIC",
  CENT: "CENTRAL",
  CTR: "CENTER",
  SUPV: "SUPERVISORY",
  // Abbreviations seen in the Census file, including a typo in it (DISRICT); corrected here because the
  // source is evidence and is not edited.
  DT: "DISTRICT",
  FT: "FORT",
  COOPERATN: "COOPERATIVE",
  /*
   * Directional single letters. `CALDWELL-W CALDWELL SCH DIST` is the Census's
   * name for the district the registry calls `Caldwell-West Caldwell`. A single
   * letter that is really an initial would be expanded wrongly here, and the
   * one-to-one rule in `census-school-systems.ts` is what makes that safe: a
   * key that then resolves to two rows answers nothing rather than guessing.
   */
  N: "NORTH",
  S: "SOUTH",
  E: "EAST",
  W: "WEST",
  DISRICT: "DISTRICT",
  CNTY: "COUNTY",
  MTN: "MOUNTAIN",
  MTNS: "MOUNTAINS",
  MTS: "MOUNTAINS",
};

const ACRONYM: Record<string, string> = {
  ISD: "INDEPENDENT SCHOOL DISTRICT",
  CISD: "CONSOLIDATED INDEPENDENT SCHOOL DISTRICT",
  CUSD: "COMMUNITY UNIT SCHOOL DISTRICT",
  CCSD: "COMMUNITY CONSOLIDATED SCHOOL DISTRICT",
  USD: "UNIFIED SCHOOL DISTRICT",
  SD: "SCHOOL DISTRICT",
  UFSD: "UNION FREE SCHOOL DISTRICT",
  CSD: "CENTRAL SCHOOL DISTRICT",
  RSD: "REGIONAL SCHOOL DISTRICT",
  ESD: "ELEMENTARY SCHOOL DISTRICT",
  MSD: "METROPOLITAN SCHOOL DISTRICT",
  PSD: "PUBLIC SCHOOL DISTRICT",
  LSD: "LOCAL SCHOOL DISTRICT",
};

/** What KIND of district, never WHICH one. */
const STRUCTURAL = new Set([
  "SCHOOL",
  "SCHOOLS",
  "DISTRICT",
  "DISTRICTS",
  "INDEPENDENT",
  "UNIFIED",
  "CONSOLIDATED",
  "COMMUNITY",
  "UNIT",
  "CENTRAL",
  "UNION",
  "FREE",
  "REGIONAL",
  "LOCAL",
  "PUBLIC",
  "ELEMENTARY",
  "SECONDARY",
  "HIGH",
  "JOINT",
  "SYSTEM",
  "SYSTEMS",
  "CORPORATION",
  "CORP",
  "AREA",
  "METROPOLITAN",
  "THE",
  "OF",
  "AND",
]);

export type NormalizedName = {
  /** The distinctive name, structural words removed. */
  core: string;
  /**
   * Trailing district numbers, held SEPARATELY rather than in the key.
   * Illinois carries them on both sides (`Payson CUSD 1`), Texas carries them
   * on the Census side only (`CAYUGA IND SCH DIST 902` / `Cayuga ISD`). In
   * the key they would break Texas; discarded outright they would merge
   * Illinois districts 1 and 2. So they sit here and are used only to break a
   * tie the core could not.
   */
  num: string;
};

export function normalizeName(raw: string): NormalizedName {
  const cleaned = raw
    .toUpperCase()
    // An apostrophe closes rather than splits (`Hart's` -> `HARTS`); every other punctuation mark here
    // separates two words.
    .replace(/['\u2018\u2019\u02bc]/g, "")
    .replace(/[.,"()/]/g, " ")
    .replace(/&/g, " AND ")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const expanded = cleaned
    .split(" ")
    .flatMap((t) => (ACRONYM[t] ? ACRONYM[t]!.split(" ") : [EXPAND[t] ?? t]));

  const num = expanded.filter((t) => /^\d+$/.test(t)).join(" ");
  const core = expanded
    .filter((t) => !/^\d+$/.test(t) && !STRUCTURAL.has(t))
    .join(" ")
    .trim();

  return { core, num };
}

/** The join key both sides of the crosswalk are built on. */
export const schoolNameKey = (fips: string, name: string): string =>
  `${fips}|${normalizeName(name).core}`;
