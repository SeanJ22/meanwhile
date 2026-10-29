/** Safe to send to Admin. Key values and encrypted values never enter this view. */
export interface KeyView {
  readonly name: string;
  readonly purpose: string;
  readonly service: KeyService;
  readonly changedAt: string;
  readonly testedAt: string | null;
  readonly working: boolean;
  readonly says: string;
  readonly runnerReadAt: string | null;
}

export const KEY_SERVICES = {
  anthropic: "AI answers and research",
  congress: "Congress members and votes",
  census: "Population and geography",
  fec: "Federal campaign filings",
  openstates: "State officials and bills",
  legiscan: "State bills and votes",
  govinfo: "Federal government documents",
  lda: "Federal lobbying filings",
  socrata: "Government open data",
  civic: "Voting districts and elections",
  sam: "Federal contracts",
  brave: "Web search",
  exa: "Web search and research",
  maptiler: "Maps",
  netlify: "Website files and publishing",
  github: "Software changes",
  postgres: "Database connection",
} as const;
export type KeyService = keyof typeof KEY_SERVICES;

/** Only long-lived credentials are migrated. Process-local worker tokens stay process-local. */
export const KEY_NAMES: Readonly<Record<string, KeyService>> = {
  ANTHROPIC_API_KEY: "anthropic", WTP_WORKERS_ANTHROPIC_API_KEY: "anthropic",
  CONGRESS_API_KEY: "congress", CENSUS_API_KEY: "census", FEC_API_KEY: "fec",
  PLURAL_API_KEY: "openstates", LEGISCAN_API_KEY: "legiscan", DATA_GOV_API_KEY: "govinfo",
  LDA_API_KEY: "lda", SOCRATA_APP_TOKEN: "socrata", GOOGLE_CIVIC_API_KEY: "civic", SAM_GOV_API_KEY: "sam",
  BRAVE_SEARCH_API_KEY: "brave", EXA_API_KEY: "exa", NEXT_PUBLIC_MAPTILER_KEY: "maptiler",
  WTP_BLOBS_TOKEN: "netlify", NETLIFY_BLOBS_TOKEN: "netlify", NETLIFY_API_TOKEN: "netlify",
  NETLIFY_AUTH_TOKEN: "netlify", NETLIFY_TOKEN: "netlify", WTP_GITHUB_READ_TOKEN: "github",
  GH_TOKEN: "github", GITHUB_TOKEN: "github", DATABASE_URL: "postgres",
  WTP_PRODUCTION_DATABASE_URL_WRITE: "postgres", WTP_PRODUCTION_DATABASE_URL_READONLY: "postgres",
  FEEDBACK_DATABASE_URL: "postgres",
};

export function keyName(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z][A-Za-z0-9 _.-]{0,79}$/.test(value.trim())) {
    throw new Error("Give the key a name using letters, numbers, spaces, dots or dashes.");
  }
  return value.trim();
}
