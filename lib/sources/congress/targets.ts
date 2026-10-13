/** Native federal publishers; each owns one independent standing clock. */
export const FEDERAL_SOURCE_IDS = ["congress-api", "govinfo", "regulations-gov", "federal-register", "senate-lda"] as const;
export type FederalSourceId = typeof FEDERAL_SOURCE_IDS[number];
export const FEDERAL_PARSER_VERSION = "src-cg/1";
export const FEDERAL_RECORD_CLASS = "FEDERAL_CIVIC_RECORD" as const;
export const FEDERAL_SOURCES = {
  "congress-api": { publisher: "Library of Congress — Congress.gov", url: "https://api.congress.gov/v3/", key: "CONGRESS_API_KEY", everyMs: 60 * 60_000,
    clock: "hourly for Congress.gov's updates during the legislative day", limit: "5,000 requests/hour", limitUrl: "https://github.com/LibraryOfCongress/api.congress.gov", paceMs: 720 },
  govinfo: { publisher: "U.S. Government Publishing Office — govinfo", url: "https://api.govinfo.gov/", key: "DATA_GOV_API_KEY", everyMs: 60 * 60_000,
    clock: "hourly; collection lastModified cursors follow new and corrected bill editions", limit: "1,000 requests/hour by default; response headers govern increased limits", limitUrl: "https://api.data.gov/docs/rate-limits/", paceMs: 3600 },
  "regulations-gov": { publisher: "Regulations.gov", url: "https://api.regulations.gov/v4/", key: "DATA_GOV_API_KEY", everyMs: 60 * 60_000,
    clock: "hourly for agency document updates and comment-period changes", limit: "1,000 requests/hour by default; response headers govern increased limits", limitUrl: "https://open.gsa.gov/api/regulationsgov/", paceMs: 3600 },
  "federal-register": { publisher: "Office of the Federal Register", url: "https://www.federalregister.gov/api/v1/", key: null, everyMs: 24 * 60 * 60_000,
    clock: "daily for the Federal Register's daily edition; re-read all open comment periods", limit: "no published fixed request ceiling; honor Retry-After", limitUrl: "https://www.federalregister.gov/developers/documentation/api/v1", paceMs: 0 },
  "senate-lda": { publisher: "U.S. Senate Office of Public Records — Lobbying Disclosure Act", url: "https://lda.gov/api/v1/", key: "LDA_API_KEY", everyMs: 24 * 60 * 60_000,
    clock: "daily for posted semiannual LD-203 contribution filings and amendments", limit: "120 requests/minute with an API key; 15/minute anonymously", limitUrl: "https://lda.gov/api/tos/", paceMs: 500 },
} as const;
export const federalScope = (source: FederalSourceId, partition = "national") => `${source}:${partition}`;
export function isFederalSource(value: string): value is FederalSourceId {
  return (FEDERAL_SOURCE_IDS as readonly string[]).includes(value);
}
