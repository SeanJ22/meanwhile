import { FIPS_TO_STATE } from "../../ocd/fips.ts";

export const GOOGLE_CIVIC_SOURCE_ID = "google-civic-voterinfo" as const;
export const GOOGLE_CIVIC_CONTRACT_ID = GOOGLE_CIVIC_SOURCE_ID;
export const GOOGLE_CIVIC_PARSER_VERSION = "google-civic-voterinfo/1";
export const GOOGLE_CIVIC_RECORD_CLASS = "GOOGLE_CIVIC_VOTERINFO" as const;
export const GOOGLE_CIVIC_SCOPE = "US:2026-11-03";
export const GOOGLE_CIVIC_ELECTION_DAY = "2026-11-03";
export const GOOGLE_CIVIC_API = "https://www.googleapis.com/civicinfo/v2/";
export const GOOGLE_CIVIC_DOCS = "https://developers.google.com/civic-information/docs/v2/elections/voterInfoQuery";
export const GOOGLE_CIVIC_STATES = Object.values(FIPS_TO_STATE).map(row => row.postal);
export const civicStateScope = (state: string) => `${GOOGLE_CIVIC_SOURCE_ID}:US-${state.toUpperCase()}`;
export const civicGovernmentScope = (id: string) => `${GOOGLE_CIVIC_SOURCE_ID}:${id}`;
