/**
 * Shared HTTP concerns for the census-geography source fetches. Both the tab20
 * acquisition (`acquire.ts`) and the grf/2026 block acquisition (`grf.ts`)
 * identify the importer with the same contact User-Agent, so it lives here once.
 */

/** The contact User-Agent sent on every census-geography source request. */
export function censusGeographyUserAgent(): string {
  const contact = process.env.INGEST_CONTACT_EMAIL?.trim();
  return `we-the-people census-geography importer (${contact ? `contact: ${contact}` : "https://github.com/SeanJ22/we-the-people"})`;
}
