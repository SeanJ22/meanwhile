import { jurisdictionDiscoveryPlan } from "../control-plane/workers/autonomous-plan.ts";
import type { Jurisdiction, JurisdictionSource } from "../hunt/jurisdiction-universe.ts";
import { jurisdictionFromOcdId } from "../coverage/states.ts";

/** The registered governor or legislature door supplies its own route. No
 * state URL, person or source is selected by this general worker contract. */
export function executiveActionDiscoveryPlan(jurisdiction: Jurisdiction, source: JurisdictionSource, routeId: string) {
  const state = jurisdictionFromOcdId(jurisdiction.ocdId ?? "");
  if (!state || jurisdiction.ocdId !== `ocd-division/country:us/${state.prefix}:${state.slug}`) return null;
  const base = jurisdictionDiscoveryPlan(jurisdiction, { ...source, recordClass: "PUBLIC_RECORDS" }, routeId, jurisdiction.ocdId);
  if (!base) return null;
  const fields = ["bodyName", "officeholderName", "officeTitle", "kindLabel", "designation", "sourceSentence"];
  return { ...base, capability: "executive-actions", jurisdiction: state.usps,
    publication: { contractId: "executive-actions" as const, bodyId: jurisdiction.ocdId },
    contract: { ...base.contract, recordClass: "STATE_EXECUTIVE_ACTION", requiredFields: fields,
      identity: { namespace: `${jurisdiction.ocdId}:executive-actions`, keyFields: ["officeholderName", "officeTitle", "designation", "kindLabel"] },
      jurisdiction: { country: "US" as const, state: state.usps, canonicalId: jurisdiction.id } } };
}
