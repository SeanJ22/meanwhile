/**
 * Registration's publication identity. One routine contract per state registers its governments from
 * the 2022 Census of Governments. The scope list is the FIPS table (`lib/ocd/fips.ts`), so every state is
 * registered without a code change. The source is pinned to the exact Census ZIP bytes the reference
 * (`data/derived/registration/`) was built from; a different file at that URL is a new vintage, refused
 * by name, leaving every state's prior registration live.
 */
import { FIPS_TO_STATE } from "../ocd/fips.ts";

export const REGISTRATION_RECORD_CLASS = "REGISTRATION" as const;
export const REGISTRATION_SOURCE_ID = "census-governments-registration" as const;
export const REGISTRATION_PARSER_VERSION = "registration/3" as const;
export const REGISTRATION_SCHEMA_VERSION = "registration:2" as const;
export const REGISTRATION_SOURCE_ROUTE_PREFIX = "https://www2.census.gov/programs-surveys/gus/datasets/2022/" as const;
export const REGISTRATION_SOURCE_URL = "https://www2.census.gov/programs-surveys/gus/datasets/2022/govt_units_2022.ZIP" as const;
export const REGISTRATION_SOURCE_SHA256 = "3ef3d93c91697b00d4d53384176dc584db9dacbd0f0a23e45657f0a3a1058c28" as const;
export const REGISTRATION_SOURCE_BYTES = 11_459_763;
/**
 * The Last-Modified census.gov serves with exactly the pinned bytes. Each run asks with
 * If-Modified-Since set to it, so an unchanged file is confirmed by a 304 with no body, and a changed one
 * is refused on its headers.
 */
export const REGISTRATION_SOURCE_LAST_MODIFIED = "Thu, 24 Aug 2023 12:44:48 GMT" as const;
export const REGISTRATION_SOURCE_THROUGH = "2022" as const;

/** A registration candidate over this many escaped JSON bytes is refused (half the 64 MiB Neon response cap). */
export const REGISTRATION_MAX_CANDIDATE_BYTES = 32 * 1024 * 1024;

export interface RegistrationTarget {
  /** Postal code, upper case: "OH". */
  readonly state: string;
  readonly fips: string;
  readonly contractId: string;
  /** `US-OH:registration:v1` */
  readonly scope: string;
  /** `US-OH`, the source authority's jurisdiction. */
  readonly jurisdiction: string;
}

export function registrationTarget(state: string): RegistrationTarget {
  const postal = state.toUpperCase();
  const fips = Object.entries(FIPS_TO_STATE).find(([, s]) => s.postal === postal)?.[0];
  if (fips === undefined) throw new Error(`REGISTRATION_STATE_UNKNOWN:${state}`);
  return { state: postal, fips, contractId: `registration-${postal.toLowerCase()}`, scope: `US-${postal}:registration:v1`, jurisdiction: `US-${postal}` };
}

/** Every state, DC and territory in the FIPS table, in FIPS order. */
export const REGISTRATION_TARGETS: readonly RegistrationTarget[] = Object.entries(FIPS_TO_STATE)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([, s]) => registrationTarget(s.postal));
