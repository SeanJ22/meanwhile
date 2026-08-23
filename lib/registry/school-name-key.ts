/**
 * **THE SCHOOL-DISTRICT NAME KEY — one normalizer, two callers.**
 *
 * Extracted 2026-08-22 (DEF-2, item 11) from
 * `scripts/build-census-nces-crosswalk.mts`, which is where it was written and
 * where it stays in use. It moved here the moment a SECOND caller needed it:
 * `scripts/classify-school-districts.mts` has to reproduce the crosswalk's own
 * key exactly in order to look a district up in it, and a second copy of a
 * normalizer is a copy that drifts — a key that stops matching does not fail,
 * it just quietly stops finding things, which is the shape this project calls a
 * false zero.
 *
 * The comments below are the crosswalk's own, unchanged. They are the record of
 * why each table entry is there, and every one of them was learned by measuring
 * a match rate.
 */
/**
 * THE TWO AGENCIES ABBREVIATE DIFFERENTLY, AND THE FIRST DRAFT OF THIS FILE
 * MATCHED 2,038 OF 13,859 BECAUSE OF IT.
 *
 * Census writes `CASTRO VAL UNIFIED SCH DIST`, `CAYUGA IND SCH DIST 902`,
 * `RAVENA COEYMANS SELKIRK CENTRAL SCH DIST`. CCD writes `Castro Valley
 * Unified`, `ASPERMONT ISD`, `Payson CUSD 1`. Neither is wrong; they are two
 * house styles for the same governments, and a normalizer that does not know
 * both reports a 14% match rate as a finding about the data rather than as a
 * finding about itself. A low match rate that is really a normalizer bug is
 * the same failure as a zero-row join reported as a clean build.
 *
 * Three passes, applied identically to both sides:
 *   1. EXPAND word-level abbreviations (SCH -> SCHOOL, UNIF -> UNIFIED).
 *   2. EXPAND acronyms that stand for a whole district type (ISD, CUSD, UFSD).
 *   3. DROP structural tokens — the words that say what KIND of district this
 *      is rather than WHICH one. What survives is the distinctive name.
 *
 * CITY and COUNTY are deliberately NOT dropped: `Albertville City` and
 * `Marshall County` are different governments and both files keep the word.
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
  /*
   * Added 2026-08-23 (item 2), each from a district the join missed and a
   * human then found by hand in the Census file:
   *   DT      "BRIDGEWATER-RARITAN REG SCH DT"        (NJ)
   *   FT      "FT THOMAS SCHOOL DISTRICT 7"           (AZ)
   *   COOPERATN "HILLSBORO DEERING COOPERATN SCH DIST" (NH)
   *   CNTY    "PASSAIC CNTY-MANCHESTER REG SCHOOL DIST" (NJ)
   *   MTN/MTS "WHITE MTS REGIONAL SCH DIST"           (NH)
   *   DISRICT "ROUND VALLEY UNIFIED SCHOOL DISRICT 10" — a TYPO in the
   *           Census of Governments' own file. It is corrected here rather
   *           than in the committed source, because the source is evidence
   *           and evidence is not edited.
   */
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
    /*
     * **An apostrophe CLOSES rather than splits** (corrected 2026-08-23,
     * item 2). Replacing it with a space turned `Hart's Location School
     * District` into `HART S LOCATION` while the Census wrote `HARTS
     * LOCATION SCHOOL DIST 236`, and the two never met. Every other
     * punctuation mark here separates two words; an apostrophe is inside one.
     */
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
