import { readStateAuthorityProjection } from "./state-reader.ts";
import { readPromotedCivicData, type CivicDataReadResult, type PromotedCivicDataReadOptions } from "./read-model.ts";
import { derivedCampaignSitesScope, DERIVED_CAMPAIGN_SITES_RECORD_CLASS, type DerivedCampaignSitesProjection } from "./derived-campaign-sites.ts";

export async function readDerivedCampaignSites(state: string, options: PromotedCivicDataReadOptions = {}): Promise<CivicDataReadResult<DerivedCampaignSitesProjection>> {
  return Object.keys(options).length
    ? readPromotedCivicData<DerivedCampaignSitesProjection>(DERIVED_CAMPAIGN_SITES_RECORD_CLASS, derivedCampaignSitesScope(state), options)
    : (await readStateAuthorityProjection<DerivedCampaignSitesProjection>("candidate-campaign-sites-derived", state)).result;
}

export const refreshDerivedCampaignSites = (state: string, options: PromotedCivicDataReadOptions = {}) => readDerivedCampaignSites(state, options);
