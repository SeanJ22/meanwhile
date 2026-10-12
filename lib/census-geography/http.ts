/** The contact User-Agent sent on every census-geography source request. */
export function censusGeographyUserAgent(): string {
  const contact = process.env.INGEST_CONTACT_EMAIL?.trim();
  return `we-the-people census-geography importer (${contact ? `contact: ${contact}` : "https://github.com/SeanJ22/we-the-people"})`;
}
