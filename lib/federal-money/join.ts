import type { FederalMoneyFact } from "./model.ts";
import type { RegistrationGovernmentListing } from "../registration/listings.ts";
import type { Division, Body } from "../registry/types.ts";

export interface FederalMoneyJoinInput {
  readonly divisions: readonly Pick<Division, "ocdId" | "geoid" | "divisionType">[];
  readonly governments: readonly RegistrationGovernmentListing[];
  readonly bodies: readonly Pick<Body, "id" | "ocdId" | "censusId">[];
  /** Previously held SAM rows provide UEI crosswalks established by native ids. */
  readonly entities?: readonly FederalMoneyFact[];
}
const aliases: Readonly<Record<string, string>> = { uei: "uei", entity_uei: "uei", nces_id: "nces_leaid", leaid: "nces_leaid", census_pid6: "census_pid6", census_id: "census_pid6", ocd_id: "ocd_id" };
const unique = (values: readonly string[]) => [...new Set(values)].sort();
function idsMatch(native: Readonly<Record<string, string>>, ids: Readonly<Record<string, string>>) {
  return Object.entries(ids).some(([key, value]) => {
    const canonical = aliases[key] ?? key;
    // Location codes and a registration's legal name cannot establish recipient identity.
    return ["uei", "nces_leaid", "census_pid6", "ocd_id"].includes(canonical) && value !== "" &&
      Object.entries(native).some(([held, v]) => (aliases[held] ?? held) === canonical && v === value);
  });
}
function divisionType(type: string) {
  return type === "school_district" ? "school" : /congress|^cd$/.test(type) ? "congressional" : type;
}

/** Native source ids alone link recipients. Geographic reach never assigns a
 * county's audit or a private company's award to the county government. */
export function joinFederalMoneyFacts(facts: readonly FederalMoneyFact[], input: FederalMoneyJoinInput): FederalMoneyFact[] {
  const reportUeis = new Map<string, Set<string>>();
  for (const fact of facts) if (fact.source === "federal-audit-clearinghouse" && fact.identifiers.reportId && fact.uei && fact.details.table === "general") {
    const set = reportUeis.get(fact.identifiers.reportId) ?? new Set<string>();
    set.add(fact.uei); reportUeis.set(fact.identifiers.reportId, set);
  }
  const governments = input.governments.map(government => ({ ...government, bodyIds: unique([...government.bodyIds,
    ...input.bodies.filter(body => Boolean(body.censusId) && body.censusId === government.nativeIds.census_pid6).map(body => body.id)]) }));
  const ueiGovernments = new Map<string, Set<string>>();
  for (const government of governments) {
    const uei = government.nativeIds.uei;
    if (uei) ueiGovernments.set(uei, new Set([...(ueiGovernments.get(uei) ?? []), government.id]));
  }
  for (const entity of [...(input.entities ?? []), ...facts.filter(row => row.kind === "ENTITY")]) {
    if (!entity.uei) continue;
    const matches = governments.filter(government => idsMatch(government.nativeIds, entity.identifiers) ||
      entity.bodyIds.some(id => government.bodyIds.includes(id)));
    ueiGovernments.set(entity.uei, new Set([...(ueiGovernments.get(entity.uei) ?? []), ...matches.map(row => row.id)]));
  }
  return facts.map(fact => {
    const reportIds = fact.source === "federal-audit-clearinghouse" ? reportUeis.get(fact.identifiers.reportId) : undefined;
    const recipientUei = fact.uei ?? (reportIds?.size === 1 ? [...reportIds][0] : null);
    const recipientMatches = governments.filter(government => idsMatch(government.nativeIds, {
      ...fact.identifiers, ...(recipientUei ? { uei: recipientUei } : {}),
    }) || Boolean(recipientUei && ueiGovernments.get(recipientUei)?.has(government.id)));
    const ambiguous = recipientMatches.length > 1;
    const recipient = ambiguous ? [] : recipientMatches;
    const directOcd = fact.identifiers.ocd_id;
    const exactBodies = input.bodies.filter(body => directOcd && body.ocdId === directOcd ||
      fact.identifiers.census_pid6 && body.censusId === fact.identifiers.census_pid6);
    const bodyIds = ambiguous ? [] : unique([...recipient.flatMap(row => [row.id, ...row.bodyIds]), ...exactBodies.map(row => row.id)]);
    const recipientDivisions = unique([...recipient.flatMap(row => row.associations.map(link => link.divisionId)),
      ...input.bodies.filter(body => bodyIds.includes(body.id)).flatMap(body => body.ocdId ? [body.ocdId] : [])]);
    const geographicDivisions = ["GRANT", "CONTRACT", "LOAN", "DISASTER"].includes(fact.kind)
      ? input.divisions.filter(division => fact.geography.some(geo => geo.geoid === division.geoid && geo.type === divisionType(division.divisionType))).map(division => division.ocdId)
      : [];
    const divisionIds = unique([...recipientDivisions, ...geographicDivisions]);
    const joined = bodyIds.length > 0 || divisionIds.length > 0;
    return { ...fact, bodyIds, divisionIds, joinStatus: joined ? "JOINED" : "UNJOINED",
      joinReason: ambiguous ? "Recipient native ids match more than one held government; recipient binding remains open."
        : joined ? bodyIds.length ? "Recipient matched by source-native government id or UEI crosswalk. Geographic reach is separate."
          : "Geographic reach matched an exact Census GEOID; recipient government remains unjoined."
        : "No exact source-native government id, UEI crosswalk, or covered Census GEOID is held; row retained." };
  });
}
