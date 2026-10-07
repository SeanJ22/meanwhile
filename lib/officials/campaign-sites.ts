import {
  currentCuratedReaderRecords,
  type CampaignSiteProjectionRecord,
} from "../civic-data/curated-reader-read-model.ts";

/**
 * Campaign sites, keyed by roster officeholder id. Always shown as a separate
 * labeled link; the primary link is the official page. Only sites verified to
 * name both the person and the office; never constructed from a name.
 */

export interface CampaignSite {
  url: string;
  /** Where the URL was found (search, filing, news page). */
  foundVia: string;
  /** What the fetched page showed — the person and office, named. */
  verification: string;
  attemptedAt: string;
}

/** Seed records; production reads the `campaign-sites` projection. */
export const CAMPAIGN_SITES: Readonly<Record<string, CampaignSite>> = {
  // An absent key means no verified site, not that none exists.
  "congress:C001133": {
    url: "https://juanciscomani.com",
    foundVia: "web search: Juan Ciscomani campaign website",
    verification:
      'Fetched 2026-08-14: site titled "Juan Ciscomani for Congress"; text names him as "elected to the U.S. House of Representatives" for Arizona.',
    attemptedAt: "2026-08-14",
  },
  "congress:G000606": {
    url: "https://www.adelitaforcongress.com",
    foundVia: "web search: Adelita Grijalva campaign website",
    verification:
      'Fetched 2026-08-14: page titled "Adelita Grijalva | Democrat for Congress".',
    attemptedAt: "2026-08-14",
  },
  "congress:K000377": {
    url: "https://www.markkelly.com",
    foundVia: "web search: Mark Kelly campaign website",
    verification:
      'Site serves HTTP 403 to plain clients; its own indexed pages are titled "Mark Kelly for Senate" with the campaign PO box (Phoenix, AZ). Verified from the site\'s indexed content, 2026-08-14.',
    attemptedAt: "2026-08-14",
  },
  "congress:G000574": {
    url: "https://gallegoforarizona.com",
    foundVia: "web search: Ruben Gallego campaign website",
    verification:
      'Fetched 2026-08-14: page titled "Ruben Gallego for Senate", describing his Senate run for Arizona.',
    attemptedAt: "2026-08-14",
  },
  "congress:M001246": {
    url: "https://www.analiliafornj.com",
    foundVia: "web search: Analilia Mejia campaign website",
    verification:
      'Fetched 2026-08-14: page titled "Analilia Mejía for New Jersey | NJ-11 Congressional Candidate 2026".',
    attemptedAt: "2026-08-14",
  },
  "congress:K000394": {
    url: "https://www.andykim.com",
    foundVia: "web search: Andy Kim campaign website",
    verification:
      'Fetched 2026-08-14: tagline "Andy Kim for New Jersey — Restoring Integrity to the US Senate".',
    attemptedAt: "2026-08-14",
  },
  "congress:B001288": {
    url: "https://corybooker.com",
    foundVia: "web search: Cory Booker campaign website",
    verification:
      'Fetched 2026-08-14: header "Stand with Cory Booker — join our campaign for Senate today".',
    attemptedAt: "2026-08-14",
  },
  "congress:G000604": {
    url: "https://maggiefornh.com",
    foundVia: "web search: Maggie Goodlander campaign website",
    verification:
      'Site serves HTTP 403 to plain clients; its own indexed pages are titled "Maggie Goodlander for Congress" for New Hampshire\'s Second District. Verified from the site\'s indexed content, 2026-08-14.',
    attemptedAt: "2026-08-14",
  },
  "congress:H001076": {
    url: "https://maggiehassan.com",
    foundVia: "web search: Maggie Hassan campaign website",
    verification:
      'Site serves HTTP 403 to plain clients; its own indexed pages are titled "Maggie Hassan | U.S. Senator for New Hampshire". Verified from the site\'s indexed content, 2026-08-14.',
    attemptedAt: "2026-08-14",
  },
  "plural:bc52f516-a13b-4490-a12c-7b98fa3969e5": {
    url: "https://lupediazaz.com",
    foundVia: "the author's find (lupediazaz.com), independently verified",
    verification:
      'Fetched 2026-08-13: site titled "Az Representative Lupe Diaz".',
    attemptedAt: "2026-08-13",
  },
  "plural:6dba6afa-b274-4273-b8c6-270d27214eee": {
    url: "https://www.almaforarizona.com",
    foundVia: "web search: Alma Hernandez campaign website",
    verification:
      'Fetched 2026-08-13: site titled "Alma Hernandez for AZ State Senate".',
    attemptedAt: "2026-08-13",
  },
  "plural:81d12f3a-b635-4111-be8d-a71d2f7565f2": {
    url: "https://bettyvillegasaz.com",
    foundVia:
      "the author's example (bettyvillegasaz.com), independently verified",
    verification:
      'Fetched 2026-08-14: page titled "Betty Villegas | LD 20 legislator".',
    attemptedAt: "2026-08-14",
  },
};

export function currentCampaignSites(): Readonly<Record<string, CampaignSite>> {
  const seed: CampaignSiteProjectionRecord[] = Object.entries(CAMPAIGN_SITES).map(([officeholderId, site]) => ({
    id: `campaign-site:${officeholderId}`,
    officeholderId,
    site: site as unknown as Readonly<Record<string, unknown>>,
  }));
  return Object.fromEntries(
    currentCuratedReaderRecords("campaign-sites", seed).map((record) => [
      record.officeholderId,
      record.site as unknown as CampaignSite,
    ]),
  );
}

export function campaignSiteFor(
  officeholderId: string,
  projection?: Readonly<Record<string, CampaignSite>>,
): CampaignSite | null {
  let records = projection;
  if (!records) {
    try {
      records = currentCampaignSites();
    } catch {
      // Campaign links are optional; never block the roster on a read failure.
      records = {};
    }
  }
  return records[officeholderId] ?? null;
}
