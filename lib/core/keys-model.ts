/** Safe to send to Admin. Key values and encrypted values never enter this view. */
export interface KeyView {
  readonly name: string;
  readonly version: string;
  readonly purpose: string;
  readonly service: KeyService;
  readonly changedAt: string;
  readonly testedAt: string | null;
  readonly working: boolean;
  readonly says: string;
  readonly runnerReadAt: string | null;
  readonly importedFrom: readonly string[];
  readonly label: string;
  readonly deleted: boolean;
  readonly canUndo: boolean;
  readonly history: readonly { readonly at: string; readonly before: string; readonly after: string }[];
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
  signing: "Website sign-in and signed requests",
  googleoauth: "Google sign-in",
  "anthropic-admin": "AI spending reports",
  "exa-admin": "Research spending reports",
  neon: "Database spending reports",
  "maptiler-service": "Map spending reports",
  "google-client": "Google sign-in application",
  prlarchive: "PRL source archive",
  other: "Other service",
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
  FEEDBACK_DATABASE_URL: "postgres", WTP_STAGING_DATABASE_URL_READONLY: "postgres",
  WTP_CONTROL_PLANE_DATABASE_URL_READONLY: "postgres", WTP_CONTROL_PLANE_POST_DEPLOY_DATABASE_URL: "postgres",
  WTP_ADMIN_SECRET: "signing", WTP_ADMIN_SESSION_KEY: "signing", WTP_STAGING_MANIFEST_COOKIE: "signing",
  GOOGLE_OAUTH_CLIENT_SECRET: "googleoauth", ANTHROPIC_ADMIN_API_KEY: "anthropic-admin",
  EXA_SERVICE_API_KEY: "exa-admin", NEON_BILLING_API_KEY: "neon", NEON_API_KEY: "neon",
  GITHUB_BILLING_TOKEN: "github", NETLIFY_BILLING_TOKEN: "netlify",
  MAPTILER_SERVICE_TOKEN: "maptiler-service", GOOGLE_OAUTH_CLIENT_ID: "google-client",
  PRL_ARCHIVE_S3_ACCESS_KEY_ID: "prlarchive", PRL_ARCHIVE_S3_SECRET_ACCESS_KEY: "prlarchive", WTP_MAPTILER_SMOKE_KEY: "maptiler",
};

export function knownKeyService(name: string): KeyService | undefined {
  const base = name.replace(/\.(runner|website)$/, "");
  return Object.hasOwn(KEY_NAMES, base) ? KEY_NAMES[base] : undefined;
}

const KEY_LABELS: Readonly<Record<string, string>> = {
  ANTHROPIC_API_KEY: "Anthropic AI", WTP_WORKERS_ANTHROPIC_API_KEY: "Research worker AI",
  CONGRESS_API_KEY: "Congress.gov", CENSUS_API_KEY: "Census", FEC_API_KEY: "Federal Election Commission",
  PLURAL_API_KEY: "Open States", LEGISCAN_API_KEY: "LegiScan", DATA_GOV_API_KEY: "Government documents",
  LDA_API_KEY: "Federal lobbying", SOCRATA_APP_TOKEN: "Government open data", GOOGLE_CIVIC_API_KEY: "Google voting information",
  SAM_GOV_API_KEY: "Federal contracts", BRAVE_SEARCH_API_KEY: "Brave search", EXA_API_KEY: "Exa research",
  NEXT_PUBLIC_MAPTILER_KEY: "MapTiler maps", WTP_MAPTILER_SMOKE_KEY: "MapTiler test maps",
  WTP_BLOBS_TOKEN: "Evidence vault", NETLIFY_BLOBS_TOKEN: "Website file storage", NETLIFY_API_TOKEN: "Website publishing",
  NETLIFY_AUTH_TOKEN: "Netlify account", NETLIFY_TOKEN: "Netlify deployment", WTP_GITHUB_READ_TOKEN: "Software change reports",
  GH_TOKEN: "GitHub commands", GITHUB_TOKEN: "GitHub access", DATABASE_URL: "Website database",
  WTP_PRODUCTION_DATABASE_URL_WRITE: "Database publishing", WTP_PRODUCTION_DATABASE_URL_READONLY: "Database reading",
  WTP_STAGING_DATABASE_URL_READONLY: "Staging database reading",
  WTP_CONTROL_PLANE_DATABASE_URL_READONLY: "Operations database reading", WTP_CONTROL_PLANE_POST_DEPLOY_DATABASE_URL: "Release checks database",
  FEEDBACK_DATABASE_URL: "Feedback database", WTP_ADMIN_SECRET: "Emergency Admin sign-in", WTP_ADMIN_SESSION_KEY: "Admin sign-in",
  WTP_STAGING_MANIFEST_COOKIE: "Staging sign-in", GOOGLE_OAUTH_CLIENT_SECRET: "Google sign-in secret",
  GOOGLE_OAUTH_CLIENT_ID: "Google sign-in application", ANTHROPIC_ADMIN_API_KEY: "Anthropic spending",
  EXA_SERVICE_API_KEY: "Exa spending", NEON_BILLING_API_KEY: "Database spending", NEON_API_KEY: "Neon account",
  GITHUB_BILLING_TOKEN: "GitHub spending", NETLIFY_BILLING_TOKEN: "Netlify spending", MAPTILER_SERVICE_TOKEN: "MapTiler spending",
  PRL_ARCHIVE_S3_ACCESS_KEY_ID: "Research archive account", PRL_ARCHIVE_S3_SECRET_ACCESS_KEY: "Research archive secret",
};

export function keyLabel(name: string, service: KeyService): string {
  const [base, runtime] = name.split(".");
  if (!knownKeyService(name)) return name;
  const label = KEY_LABELS[base] ?? KEY_SERVICES[service];
  const use = runtime === "runner" ? "Runner" : runtime === "website" ? "Website" : null;
  return use ? `${label} (${use})` : label;
}

export function keyName(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z][A-Za-z0-9 _.-]{0,79}$/.test(value.trim())) {
    throw new Error("Give the key a name using letters, numbers, spaces, dots or dashes.");
  }
  return value.trim();
}
