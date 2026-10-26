import type { FederalMoneyFact } from "./model.ts";
import type { RegistrationGovernmentListing } from "../registration/listings.ts";
import type { Division, Body } from "../registry/types.ts";
import { federalMoneyStateDivision } from "./view.ts";
import { federalGovernmentName, federalMoneyRecipientName, federalMoneyRecipientState } from "./recipient.ts";

export interface FederalMoneyHeldRecipient {
  readonly uei: string | null;
  readonly identifiers: Readonly<Record<string, string>>;
  readonly bodyIds: readonly string[];
  readonly recipient?: string | null;
  readonly recipientState?: string | null;
}
export interface FederalMoneyHeldAudit extends FederalMoneyHeldRecipient {
  readonly reportId: string;
  readonly divisionIds: readonly string[];
}
export interface FederalMoneyJoinInput {
  readonly divisions: readonly Pick<Division, "ocdId" | "geoid" | "divisionType">[];
  readonly governments: readonly (Pick<RegistrationGovernmentListing, "id" | "nativeIds" | "associations" | "bodyIds"> & Partial<Pick<RegistrationGovernmentListing, "aliases" | "name" | "state">>)[];
  readonly bodies: readonly Pick<Body, "id" | "ocdId" | "censusId">[];
  readonly entities?: readonly FederalMoneyHeldRecipient[];
  readonly auditReports?: readonly FederalMoneyHeldAudit[];
}
const aliases: Readonly<Record<string, string>> = { entity_uei: "uei", nces_id: "nces_leaid", leaid: "nces_leaid", census_id: "census_pid6" };
const recipientNamespaces = new Set(["uei", "nces_leaid", "census_pid6", "ocd_id"]);
const unique = (values: Iterable<string>) => [...new Set(values)].sort();
export function federalMoneyRecipientIds(ids: Readonly<Record<string, string>>): { namespace: string; value: string }[] {
  return Object.entries(ids).flatMap(([name, value]) => {
    const namespace = aliases[name] ?? name;
    return value && recipientNamespaces.has(namespace) ? [{ namespace, value }] : [];
  });
}
const key = (namespace: string, value: string) => JSON.stringify([namespace, value]);
function auditStateLocation(fact: FederalMoneyFact): string[] {
  const state = fact.source === "federal-audit-clearinghouse" && fact.details.reportedState === fact.state
    ? federalMoneyStateDivision(fact.state) : null;
  return state ? [state] : [];
}
function disasterStateLocation(fact: FederalMoneyFact): string[] {
  const state = fact.source === "openfema" && fact.kind === "DISASTER" && fact.details.reportedState === fact.state
    ? federalMoneyStateDivision(fact.state) : null;
  return state ? [state] : [];
}
function append<T>(index: Map<string, Set<T>>, name: string, value: T) {
  const values = index.get(name) ?? new Set<T>();
  values.add(value); index.set(name, values);
}
function divisionType(type: string) {
  return type === "school_district" ? "school" : /congress|^cd$/.test(type) ? "congressional" : type;
}

export function joinFederalMoneyFacts(facts: readonly FederalMoneyFact[], input: FederalMoneyJoinInput): FederalMoneyFact[] {
  const nativeGovernments = new Map<string, Set<string>>();
  const governmentBodies = new Map<string, Set<string>>();
  const bodiesByNative = new Map<string, Set<string>>();
  const bodiesById = new Map(input.bodies.map(body => [body.id, body]));
  const governmentsById = new Map(input.governments.map(government => [government.id, government]));
  const governmentsByName = new Map<string, Set<string>>();
  for (const body of input.bodies) {
    if (body.censusId) append(bodiesByNative, key("census_pid6", body.censusId), body.id);
    if (body.ocdId) append(bodiesByNative, key("ocd_id", body.ocdId), body.id);
  }
  for (const government of input.governments) {
    if (government.name && government.state) append(governmentsByName, `${government.state.toUpperCase()}:${federalGovernmentName(government.name)}`, government.id);
    for (const native of federalMoneyRecipientIds(government.nativeIds)) append(nativeGovernments, key(native.namespace, native.value), government.id);
    for (const body of [government.id, ...government.bodyIds, ...(government.aliases ?? []), ...(bodiesByNative.get(key("census_pid6", government.nativeIds.census_pid6)) ?? [])]) append(governmentBodies, body, government.id);
  }
  const matchGovernments = (identifiers: Readonly<Record<string, string>>, bodyIds: readonly string[] = [], recipient?: string | null, recipientState?: string | null) => {
    const matches = new Set<string>();
    for (const native of federalMoneyRecipientIds(identifiers)) for (const id of nativeGovernments.get(key(native.namespace, native.value)) ?? []) matches.add(id);
    for (const bodyId of bodyIds) for (const id of governmentBodies.get(bodyId) ?? []) matches.add(id);
    if (matches.size === 0 && recipient && recipientState) for (const id of governmentsByName.get(`${recipientState}:${federalGovernmentName(recipient)}`) ?? []) matches.add(id);
    return matches;
  };
  const ueiGovernments = new Map<string, Set<string>>();
  for (const entity of [...(input.entities ?? []), ...facts.filter(row => row.kind === "ENTITY")]) {
    const recipientState = "kind" in entity ? federalMoneyRecipientState(entity) : entity.recipientState;
    if (entity.uei) for (const id of matchGovernments(entity.identifiers, entity.bodyIds, entity.recipient, recipientState)) append(ueiGovernments, entity.uei, id);
  }
  const reports = new Map<string, FederalMoneyHeldAudit[]>();
  for (const report of [...(input.auditReports ?? []), ...facts.flatMap(fact => fact.source === "federal-audit-clearinghouse" && fact.identifiers.reportId && fact.details.table === "general"
    ? [{ reportId: fact.identifiers.reportId, uei: fact.uei, identifiers: fact.identifiers, bodyIds: fact.bodyIds, recipient: fact.recipient, recipientState: federalMoneyRecipientState(fact), divisionIds: unique([...fact.divisionIds, ...auditStateLocation(fact)]) }] : [])]) {
    const held = reports.get(report.reportId) ?? [];
    held.push(report); reports.set(report.reportId, held);
  }
  const geography = new Map<string, Set<string>>();
  for (const division of input.divisions) if (division.geoid) append(geography, key(divisionType(division.divisionType), division.geoid), division.ocdId);
  return facts.map(fact => {
    const auditReports = fact.source === "federal-audit-clearinghouse" ? reports.get(fact.identifiers.reportId) ?? [] : [];
    const reportUeis = unique(auditReports.flatMap(report => report.uei ? [report.uei] : []));
    const recipientUei = fact.uei ?? (reportUeis.length === 1 ? reportUeis[0] : null);
    const recipientMatches = matchGovernments({ ...fact.identifiers, ...(recipientUei ? { uei: recipientUei } : {}) }, fact.bodyIds);
    const recipientName = federalMoneyRecipientName(fact);
    if (recipientMatches.size === 0 && recipientName) for (const id of governmentsByName.get(`${fact.state}:${recipientName}`) ?? []) recipientMatches.add(id);
    if (recipientUei) for (const id of ueiGovernments.get(recipientUei) ?? []) recipientMatches.add(id);
    for (const report of auditReports) for (const id of matchGovernments(report.identifiers, report.bodyIds, report.recipient, report.recipientState)) recipientMatches.add(id);
    const ambiguous = recipientMatches.size > 1 || !fact.uei && reportUeis.length > 1;
    const recipients = ambiguous ? [] : [...recipientMatches].flatMap(id => governmentsById.get(id) ? [governmentsById.get(id)!] : []);
    const exactBodies = federalMoneyRecipientIds(fact.identifiers).flatMap(native => [...(bodiesByNative.get(key(native.namespace, native.value)) ?? [])]);
    const bodyIds = ambiguous ? [] : unique([...recipients.flatMap(row => [row.id, ...row.bodyIds, ...(row.aliases ?? []),
      ...(bodiesByNative.get(key("census_pid6", row.nativeIds.census_pid6)) ?? [])]), ...exactBodies, ...auditReports.flatMap(report => report.bodyIds)]);
    const recipientDivisions = unique([...recipients.flatMap(row => row.associations.map(link => link.divisionId)),
      ...bodyIds.flatMap(id => bodiesById.get(id)?.ocdId ? [bodiesById.get(id)!.ocdId!] : []),
      ...(!ambiguous ? auditReports.flatMap(report => report.divisionIds) : [])]);
    const geographicDivisions = ["GRANT", "CONTRACT", "LOAN", "DISASTER"].includes(fact.kind)
      ? fact.geography.flatMap(geo => [...(geography.get(key(geo.type, geo.geoid)) ?? [])]) : [];
    const divisionIds = unique([...recipientDivisions, ...geographicDivisions, ...auditStateLocation(fact), ...disasterStateLocation(fact)]);
    const joined = bodyIds.length > 0 || divisionIds.length > 0;
    return { ...fact, bodyIds, divisionIds, joinStatus: joined ? "JOINED" : "UNJOINED",
      joinReason: ambiguous ? "Recipient native ids match more than one held government; recipient binding remains open."
        : joined ? bodyIds.length ? "Recipient matched by source-native identity or the unique official legal government name and recipient state. Geographic reach is separate."
          : fact.source === "federal-audit-clearinghouse" ? "Auditee location matched the state named by its official audit report; recipient government remains unjoined."
          : fact.source === "openfema" ? geographicDivisions.length ? "Disaster county matched an exact Census GEOID; the publisher's state association is separate."
            : "Disaster record associated with the state named by OpenFEMA; county association remains open."
          : "Geographic reach matched an exact Census GEOID; recipient government remains unjoined."
        : "No exact source-native government id, UEI crosswalk, or covered Census GEOID is held; row retained." };
  });
}
