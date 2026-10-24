import { csvRows } from "../reference/csv.ts";
import { FIPS_TO_STATE } from "../ocd/fips.ts";
import { sourceAcquisitionFailure } from "../civic-data/source-acquisition-error.ts";
import { canonicalCivicDataJson } from "../civic-data/changes.ts";
import type { FederalMoneyCapture, FederalMoneyFact, FederalMoneySource } from "./model.ts";

type Row = Record<string, unknown>;
const orgs: Record<FederalMoneySource, string> = { usaspending: "U.S. Department of the Treasury, USAspending.gov", "federal-audit-clearinghouse": "General Services Administration, Federal Audit Clearinghouse", "sam-gov-entities": "General Services Administration, SAM.gov", openfema: "Federal Emergency Management Agency, OpenFEMA" };
const stateFips = Object.fromEntries(Object.entries(FIPS_TO_STATE).map(([fips, item]) => [item.postal, fips]));
const object = (value: unknown): Row => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
function string(value: unknown): string | null { return typeof value === "string" && value.trim() && !["null", "None"].includes(value) ? value.trim() : typeof value === "number" ? String(value) : null; }
function pick(row: Row, ...keys: string[]): string | null { for (const key of keys) { const value = string(row[key]); if (value !== null) return value; } return null; }
function auditUei(value: string | null): string | null { return value === "GSA_MIGRATION" ? null : value; }
function number(value: unknown): number | null { const text = string(value); if (text === null) return null; const n = Number(text.replace(/,/g, "")); return Number.isFinite(n) ? n : null; }
function date(value: unknown): string | null { const text = string(value); if (!text) return null; const n = Date.parse(text); return Number.isFinite(n) ? new Date(n).toISOString() : null; }
function truth(value: unknown): boolean | null { return value === true || ["Y", "Yes", "true", "1"].includes(String(value)) ? true : value === false || ["N", "No", "false", "0"].includes(String(value)) ? false : null; }
function* rows(body: string, source: FederalMoneySource): Generator<Row> {
  const text = body.replace(/^\uFEFF/, "").trim();
  if (!text.startsWith("{") && !text.startsWith("[")) {
    const values = csvRows(body.replace(/^\uFEFF/, "")), first = values.next(), header = first.done ? undefined : first.value;
    if (!header || header.length < 2) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", `${source}: the response is neither source JSON nor CSV.`);
    for (const value of values) if (value.some(Boolean)) { const row: Row = {}; for (let index = 0; index < header.length; index++) row[header[index]!] = value[index] ?? ""; yield row; }
    return;
  }
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", `${source}: the source JSON could not be decoded.`); }
  const root = object(parsed);
  const values = Array.isArray(parsed) ? parsed : source === "openfema" ? root.DisasterDeclarationsSummaries : source === "sam-gov-entities" ? root.entityData ?? (root.entityRegistration ? [root] : undefined) : root.results;
  if (!Array.isArray(values)) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", `${source}: the expected record array is missing.`);
  if (values.some(value => !value || typeof value !== "object" || Array.isArray(value))) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", `${source}: a source record is not an object.`);
  for (let index = 0; index < values.length; index++) { const row = values[index] as Row; values[index] = null; yield row; }
}
function identifiers(row: Row): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [target, keys] of Object.entries({ uei: ["uei", "auditee_uei", "recipient_uei", "Recipient UEI"], nces_leaid: ["nces_id", "nces_leaid", "leaid"], geoid: ["geoid", "census_geoid"], ocd_id: ["ocd_id", "ocd_division_id"], duns: ["recipient_duns", "auditee_duns", "DUNS"], ein: ["auditee_ein", "EIN"] })) {
    const value = pick(row, ...keys); if (value && !(target === "uei" && auditUei(value) === null)) result[target] = value;
  }
  return result;
}
function geography(state: string, location: Row): FederalMoneyFact["geography"] {
  const fips = stateFips[pick(location, "state_code", "state", "stateOrProvinceCode")?.toUpperCase() ?? state];
  if (!fips) return [];
  const result: { type: "county" | "place" | "school" | "congressional"; geoid: string }[] = [];
  const county = pick(location, "county_code", "county_fips", "fipsCountyCode");
  if (county && /^\d{1,5}$/.test(county) && Number(county) !== 0) result.push({ type: "county", geoid: county.length === 5 ? county : fips + county.padStart(3, "0") });
  const place = pick(location, "city_code", "place_fips", "place_geoid");
  if (place && /^\d{1,7}$/.test(place) && Number(place) !== 0) result.push({ type: "place", geoid: place.length === 7 ? place : fips + place.padStart(5, "0") });
  const congressional = pick(location, "congressional_code", "congressional_district", "congressionalDistrict");
  if (congressional && /^\d{1,4}$/.test(congressional) && !["90", "98", "99"].includes(congressional)) result.push({ type: "congressional", geoid: congressional.length === 4 ? congressional : fips + congressional.padStart(2, "0") });
  const school = pick(location, "nces_leaid", "leaid"); if (school) result.push({ type: "school", geoid: school });
  return result;
}
function fact(source: FederalMoneySource, capture: FederalMoneyCapture, state: string, row: Row, value: Partial<FederalMoneyFact> & Pick<FederalMoneyFact, "sourceId" | "kind" | "title">): FederalMoneyFact {
  const native = identifiers(row);
  return { id: `${source}:${value.sourceId}`, source, state, amount: null, amountLabel: null, period: null, recipient: null, uei: native.uei ?? null, identifiers: native, geography: [], bodyIds: [], divisionIds: [], joinStatus: "UNJOINED", joinReason: "Source identifiers have not matched a held government or division yet.", details: {}, ...value,
    provenance: { sourceUrl: capture.url, sourceOrg: orgs[source], publicationDate: value.provenance?.publicationDate ?? capture.publicationDate, retrievedAt: capture.retrievedAt, official: true, rawHash: capture.rawHash } };
}
function spending(capture: FederalMoneyCapture, state: string, row: Row): FederalMoneyFact {
  const awardType = pick(row, "award_type_code", "assistance_type_code", "assistance_type", "award_type", "contract_award_type_code", "contract_award_type", "Award Type") ?? "";
  const kind = /^(07|08)$|loan/i.test(awardType) ? "LOAN" : /^(02|03|04|05)$|grant|cooperative/i.test(awardType) ? "GRANT" : /^(A|B|C|D)$|contract|purchase|delivery|BPA|^DO$/i.test(awardType) ? "CONTRACT" : null;
  if (!kind) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "USAspending: a transaction has no recognized grant, contract or loan type.");
  const awardId = pick(row, "generated_internal_id", "contract_award_unique_key", "assistance_award_unique_key", "Award ID", "award_id_fain", "award_id_piid", "award_id_uri");
  const mod = pick(row, "modification_number", "Mod") ?? "";
  const actionDate = pick(row, "action_date", "Action Date");
  const sourceId = pick(row, "contract_transaction_unique_key", "assistance_transaction_unique_key", "transaction_unique_id") ?? [awardId, mod, actionDate].filter(Boolean).join(":");
  if (!sourceId) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "USAspending: a transaction has no source-native identifier.");
  const loanValue = number(row.face_value_of_loan ?? row["Loan Value"]);
  const obligation = number(row.federal_action_obligation ?? row["Transaction Amount"]);
  const pop = object(row["Primary Place of Performance"]);
  const locationFips = pick(row, "prime_award_transaction_place_of_performance_state_fips_code");
  const locationCode = pick(row, "primary_place_of_performance_code");
  const locationDistrict = "prime_award_transaction_place_of_performance_cd_current" in row
    ? pick(row, "prime_award_transaction_place_of_performance_cd_current") : pick(row, "primary_place_of_performance_congressional_district");
  const nativeLocation = { state: row.primary_place_of_performance_state_code ?? (locationFips ? FIPS_TO_STATE[locationFips.padStart(2, "0")]?.postal : undefined),
    county_code: row.prime_award_transaction_place_of_performance_county_fips_code ?? row.primary_place_of_performance_county_code,
    city_code: row.primary_place_of_performance_city_code ?? (locationCode && /^[A-Z]{2}\d{5}$/.test(locationCode) ? locationCode.slice(2) : undefined),
    congressional_code: locationDistrict?.replace(/^[A-Z]{2}-/, "") };
  const recipient = pick(row, "recipient_name", "Recipient Name");
  const publicationDate = date(row.last_modified_date ?? row.last_modified ?? row["Last Modified Date"]);
  const provenance = { publicationDate: publicationDate ?? capture.publicationDate } as FederalMoneyFact["provenance"];
  return fact("usaspending", capture, state, row, { sourceId, kind, title: pick(row, "award_description", "transaction_description", "Transaction Description") ?? `${kind === "GRANT" ? "Federal grant" : kind === "LOAN" ? "Federal loan" : "Federal contract"} ${pick(row, "Award ID", "award_id_fain", "award_id_piid") ?? awardId ?? sourceId}`, recipient, amount: obligation, amountLabel: "Federal obligation", period: actionDate, geography: geography(state, Object.keys(pop).length ? pop : nativeLocation), identifiers: { ...identifiers(row), ...(awardId ? { awardId } : {}), transactionId: sourceId },
    details: { awardType, originalCongressionalDistrict: pick(row, "prime_award_transaction_place_of_performance_cd_original"), modification: mod || null, actionDate, awardingAgency: pick(row, "awarding_agency_name", "Awarding Agency"), recipientCity: pick(object(row["Recipient Location"]), "city_name") ?? pick(row, "recipient_city_name"), recipientState: pick(object(row["Recipient Location"]), "state_code") ?? pick(row, "recipient_state_code"), loanFaceValue: loanValue, subsidyCost: number(row.original_loan_subsidy_cost ?? row["Subsidy Cost"]) }, provenance });
}
function audit(capture: FederalMoneyCapture, state: string, row: Row): FederalMoneyFact {
  const url = new URL(capture.url);
  const nativeTable = url.hash ? decodeURIComponent(url.hash.slice(1)) : url.pathname.split("/").filter(Boolean).at(-1) ?? "general";
  const table = /ELECAUDITHEADER/i.test(nativeTable) ? "general" : /ELECAUDITFINDINGS.*TEXT/i.test(nativeTable) ? "findings_text" : /ELECAUDITFINDINGS/i.test(nativeTable) ? "findings" : /ELECCAPTEXT/i.test(nativeTable) ? "corrective_action_plans" : /ELECUEIS/i.test(nativeTable) ? "additional_ueis" : nativeTable;
  const reportId = pick(row, "report_id") ?? [pick(row, "AUDITYEAR"), pick(row, "DBKEY")].filter(Boolean).join(":");
  if (!reportId) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "Federal Audit Clearinghouse: a report has no source-native identifier.");
  const reference = pick(row, "reference_number", "finding_ref_number", "FINDINGSREFNUMS", "FINDINGREFNUMS");
  const awardReference = pick(row, "award_reference", "ELECAUDITSID");
  const requirement = pick(row, "type_requirement", "TYPEREQUIREMENT");
  const extraUei = auditUei(pick(row, "additional_uei", "UEI"));
  const sourceRowId = pick(row, "ELECAUDITFINDINGSID", "ELECAUDITFINDINGSTEXTID", "ELECCAPTEXTID", "ELECUEISID", "id");
  const sourceId = table === "general" ? reportId : [reportId, table, ...(sourceRowId ? [sourceRowId] : [reference, awardReference, extraUei, ...(table === "findings" ? [requirement] : [])])].filter(Boolean).join(":");
  const recipient = pick(row, "auditee_name", "AUDITEENAME");
  const reportedState = pick(row, "auditee_state", "STATE")?.toUpperCase() ?? null;
  const actualState = reportedState ? stateFips[reportedState] ? reportedState : "ZZ" : state;
  const year = pick(row, "audit_year", "AUDITYEAR");
  const type = table === "findings_text" ? "Audit finding" : table === "corrective_action_plans" ? "Corrective action plan" : table === "findings" ? "Audit finding" : table === "additional_ueis" ? "Additional audited entity" : "Federal single audit";
  return fact("federal-audit-clearinghouse", capture, actualState, row, { sourceId, kind: "AUDIT", title: `${type}${reference ? ` ${reference}` : ""}${year ? `, ${year}` : ""}${recipient ? ` — ${recipient}` : ""}`, recipient, uei: extraUei ?? auditUei(pick(row, "auditee_uei")), amount: table === "general" ? number(row.total_amount_expended ?? row.TOTFEDEXPEND) : null, amountLabel: table === "general" ? "Audited federal expenditures" : null, period: year, identifiers: { ...identifiers(row), reportId, ...(sourceRowId ? { sourceRowId } : {}), ...(reference ? { findingReference: reference } : {}), ...(awardReference ? { awardReference } : {}), ...(extraUei ? { uei: extraUei } : {}) },
    details: { table, reportedState, reference, awardReference, findingText: pick(row, "finding_text", "TEXT"), plannedAction: pick(row, "planned_action"), requirement: pick(row, "type_requirement", "TYPEREQUIREMENT"), materialWeakness: truth(row.is_material_weakness ?? row.is_internal_control_material_weakness_disclosed ?? row.MATERIALWEAKNESS), significantDeficiency: truth(row.is_significant_deficiency ?? row.is_internal_control_deficiency_disclosed ?? row.SIGNIFICANTDEFICIENCY), questionedCosts: truth(row.is_questioned_costs ?? row.QCOSTS), repeatFinding: truth(row.is_repeat_finding ?? row.REPEATFINDING), materialNoncompliance: truth(row.is_material_noncompliance_disclosed ?? row.MATERIALNONCOMPLIANCE), modifiedOpinion: truth(row.is_modified_opinion ?? row.MODIFIEDOPINION), otherMatters: truth(row.is_other_matters ?? row.OTHERNONCOMPLIANCE), lowRiskAuditee: truth(row.is_low_risk_auditee ?? row.LOWRISK), priorFindingReferences: pick(row, "prior_finding_ref_numbers", "PRIORFINDINGREFNUMS"), auditeeCity: pick(row, "auditee_city", "CITY") },
    provenance: { publicationDate: date(row.fac_accepted_date ?? row.FACACCEPTEDDATE ?? row.submitted_date) ?? capture.publicationDate } as FederalMoneyFact["provenance"] });
}
function entity(capture: FederalMoneyCapture, state: string, row: Row): FederalMoneyFact {
  const registration = object(row.entityRegistration), core = object(row.coreData), general = object(core.generalInformation), address = object(core.physicalAddress);
  const uei = pick(registration, "ueiSAM") ?? pick(row, "ueiSAM", "uei");
  if (!uei) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "SAM.gov: an entity has no UEI.");
  const recipient = pick(registration, "legalBusinessName") ?? pick(row, "legalBusinessName");
  const businessTypes = object(core.businessTypes).businessTypeList;
  return fact("sam-gov-entities", capture, pick(address, "stateOrProvinceCode")?.toUpperCase() ?? state, row, { sourceId: uei, kind: "ENTITY", title: recipient ?? `Federal registration ${uei}`, recipient, uei, period: pick(registration, "registrationDate"), identifiers: { ...identifiers(row), uei, ...(pick(registration, "cageCode") ? { cage: pick(registration, "cageCode")! } : {}) },
    // Registration location is an address; it never asserts that this entity governs the district.
    geography: [], details: { registrationStatus: pick(registration, "registrationStatus"), samRegistered: truth(registration.samRegistered), registrationExpires: pick(registration, "registrationExpirationDate"), entityType: pick(general, "entityTypeDesc"), entityStructure: pick(general, "entityStructureDesc"), organizationStructure: pick(general, "organizationStructureDesc"), city: pick(address, "city"), state: pick(address, "stateOrProvinceCode"), congressionalDistrict: pick(core, "congressionalDistrict"), businessTypes: Array.isArray(businessTypes) ? businessTypes.map(value => pick(object(value), "businessTypeDesc")).filter(Boolean).join("; ") : null },
    provenance: { publicationDate: date(registration.lastUpdateDate ?? registration.ueiCreationDate) ?? capture.publicationDate } as FederalMoneyFact["provenance"] });
}
function disaster(capture: FederalMoneyCapture, state: string, row: Row): FederalMoneyFact {
  const sourceId = pick(row, "id"); if (!sourceId) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "OpenFEMA: a declaration row has no source-native identifier.");
  const reportedState = pick(row, "state")?.toUpperCase() ?? null;
  const actualState = reportedState ?? state;
  const fips = pick(row, "fipsStateCode");
  const location = { state: fips ? FIPS_TO_STATE[fips.padStart(2, "0")]?.postal : actualState, fipsCountyCode: row.fipsCountyCode };
  return fact("openfema", capture, actualState, row, { sourceId, kind: "DISASTER", title: `${pick(row, "declarationTitle") ?? "Federal disaster declaration"}${pick(row, "designatedArea") ? ` — ${pick(row, "designatedArea")}` : ""}`, period: pick(row, "declarationDate"), identifiers: { ...identifiers(row), declarationId: sourceId, disasterNumber: pick(row, "disasterNumber") ?? "", ...(pick(row, "femaDeclarationString") ? { declaration: pick(row, "femaDeclarationString")! } : {}) }, geography: geography(actualState, location),
    details: { reportedState, declarationType: pick(row, "declarationType"), incidentType: pick(row, "incidentType"), designatedArea: pick(row, "designatedArea"), incidentBegin: pick(row, "incidentBeginDate"), incidentEnd: pick(row, "incidentEndDate"), individualAssistance: truth(row.iaProgramDeclared), individualsHouseholds: truth(row.ihProgramDeclared), publicAssistance: truth(row.paProgramDeclared), hazardMitigation: truth(row.hmProgramDeclared), tribalRequest: truth(row.tribalRequest), lastRefresh: pick(row, "lastRefresh"), placeCode: pick(row, "placeCode") },
    provenance: { publicationDate: date(row.declarationDate) ?? capture.publicationDate } as FederalMoneyFact["provenance"] });
}

export function parseFederalMoney(source: FederalMoneySource, capture: FederalMoneyCapture, state: string, body: string): FederalMoneyFact[] {
  const facts: FederalMoneyFact[] = [], seen = new Map<string, Row>();
  for (const row of rows(body, source)) {
    const parsed = parseFederalMoneyRow(source, capture, state, row);
    if (source === "federal-audit-clearinghouse") {
      const previous = seen.get(parsed.id);
      if (previous) {
        if (canonicalCivicDataJson(previous) !== canonicalCivicDataJson(row)) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "Federal Audit Clearinghouse: distinct source rows share one native finding identity.");
        continue;
      }
      seen.set(parsed.id, row);
    }
    facts.push(parsed);
  }
  return facts;
}
export function parseFederalMoneyRow(source: FederalMoneySource, capture: FederalMoneyCapture, state: string, row: Row): FederalMoneyFact {
  const parse = source === "usaspending" ? spending : source === "federal-audit-clearinghouse" ? audit : source === "sam-gov-entities" ? entity : disaster;
  return parse(capture, state.toUpperCase(), row);
}
