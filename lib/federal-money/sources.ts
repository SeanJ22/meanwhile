import { FIPS_TO_STATE } from "../ocd/fips.ts";
import type { FederalMoneySource } from "./model.ts";

export const FEDERAL_MONEY_STATES = [...new Set(Object.values(FIPS_TO_STATE).map(row => row.postal))];
export const FEDERAL_MONEY_CONFIG: Readonly<Record<FederalMoneySource, {
  readonly publisher: string; readonly route: string; readonly everyMs: number;
  readonly clock: string; readonly clockSource: string; readonly keyEnv: string | null;
}>> = {
  usaspending: { publisher: "U.S. Department of the Treasury · USAspending", route: "https://api.usaspending.gov/api/v2/",
    everyMs: 24 * 60 * 60_000, clock: "daily after USAspending's nightly data refresh",
    clockSource: "https://www.usaspending.gov/data/data-sources-download.pdf", keyEnv: null },
  "federal-audit-clearinghouse": { publisher: "General Services Administration · Federal Audit Clearinghouse", route: "https://api.fac.gov/",
    everyMs: 24 * 60 * 60_000, clock: "daily for newly accepted and revised single-audit submissions",
    clockSource: "https://www.fac.gov/api/", keyEnv: "DATA_GOV_API_KEY" },
  "sam-gov-entities": { publisher: "General Services Administration · SAM.gov", route: "https://api.sam.gov/entity-information/",
    everyMs: 24 * 60 * 60_000, clock: "daily for SAM.gov entity registration updates",
    clockSource: "https://open.gsa.gov/api/entity-api/", keyEnv: "SAM_GOV_API_KEY" },
  openfema: { publisher: "Federal Emergency Management Agency · OpenFEMA", route: "https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries",
    everyMs: 20 * 60_000, clock: "every twenty minutes, matching OpenFEMA's R/PT20M dataset refresh",
    clockSource: "https://www.fema.gov/openfema-data-page/disaster-declarations-summaries-v2", keyEnv: null },
};
