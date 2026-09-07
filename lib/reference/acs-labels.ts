/**
 * **HOW THE POPULATION FIGURES NAME THEMSELVES.** (ADM-41, §9A.10 / §9A.19.)
 *
 * The source, the vintage and the geography of every population number this
 * product renders, as one definition. They live apart from
 * `lib/reference/acs-population.ts` for one reason: that module reads the
 * committed CSVs and therefore imports `node:fs`, and a client component that
 * has to label a number on the face must not drag a filesystem reader into the
 * browser bundle. These are strings and nothing else — no clock, no fs, no
 * imports at all — so both the publisher and the panel read the same words.
 *
 * §9A.19 is explicit that ZIP/ZCTA population, place/city population, county
 * population, ACS estimates and Population Estimates Program values may never
 * be shown as though they were the same measure. Naming the geography on the
 * face is how that promise is kept, and it is why the geography label is a
 * separate string rather than folded into a sentence somewhere.
 */

/** The agency and programme behind every population figure. */
export const ACS_SOURCE_LABEL = "U.S. Census Bureau, American Community Survey";

/**
 * The release. Measured 2026-09-06 with this repository's key: the API serves
 * `/data/2024/acs/acs5` and answers 404 for 2025, so 2024 is the newest 5-Year
 * release published for the ZCTA geography.
 */
export const ACS_VINTAGE_LABEL = "5-Year estimates, 2024 release";

/** The geography a ZIP row's number is FOR. Not a town, not a county. */
export const ACS_ZCTA_GEOGRAPHY_LABEL = "ZIP Code Tabulation Area (ZCTA5)";

/** The geography a state denominator is for. */
export const ACS_STATE_GEOGRAPHY_LABEL = "state total";
