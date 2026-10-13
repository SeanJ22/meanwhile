import { governmentListingById, governmentListingsForDivisions } from "../registry/server.ts";
import type { RegistrationGovernmentListing } from "../registration/listings.ts";
import { bindNamedEntity, type BindableEntity } from "../routing/named-entity.ts";
import type { EvidenceRecord } from "./evidence.ts";

export function governmentListingEntity(row: RegistrationGovernmentListing): BindableEntity {
  return { id: row.id, name: row.name, nameClass: "body", level: "BODY", divisionType: row.governmentClass,
    ocdId: row.associations.length === 1 ? row.associations[0].divisionId : null };
}

/** State-scoped inventory search binds names only; it never establishes residence or a meeting body. */
export async function readerGovernmentListings(question: string, divisionIds: readonly string[], explicitIds: readonly string[]) {
  const inventory = await governmentListingsForDivisions(divisionIds, "STATE_INVENTORY");
  const binding = bindNamedEntity(question, inventory.records.map(governmentListingEntity));
  const named = new Set(binding.kind === "BOUND" ? [binding.entity.id] : binding.kind === "AMBIGUOUS" ? binding.candidates.map(row => row.id) : []);
  const divisions = new Set(divisionIds);
  const held = new Map(inventory.records.filter(row => named.has(row.id) || explicitIds.includes(row.id) ||
    row.associations.some(link => divisions.has(link.divisionId))).map(row => [row.id, row]));
  const exact = await Promise.allSettled(explicitIds.filter(id => id.startsWith("government:US-")).map(governmentListingById));
  for (const read of exact) if (read.status === "fulfilled" && read.value) held.set(read.value.id, read.value);
  return { records: [...held.values()], unavailableStates: inventory.unavailableStates };
}

function contactFactsFrom(row: RegistrationGovernmentListing, source: RegistrationGovernmentListing["provenance"]): string {
  const from = (field: "website" | "mailingAddress" | "officePhone" | "officeAddress") => {
    const held = row.contactProvenance?.[field] ?? row.provenance;
    return held.sourceUrl === source.sourceUrl && held.collectedAt === source.collectedAt ? row[field] : null;
  };
  return `${from("mailingAddress") ? ` Mailing address: ${from("mailingAddress")}.` : ""}${from("website") ? ` Website: ${from("website")}.` : ""}${from("officePhone") ? ` Listed office phone: ${from("officePhone")}.` : ""}${from("officeAddress") ? ` Listed office address: ${from("officeAddress")}.` : ""}`;
}

export function governmentListingEvidence(row: RegistrationGovernmentListing): EvidenceRecord {
  const identity = row.kind === "DEPENDENT_SCHOOL_SYSTEM" ? "dependent school system" : row.kind === "EDUCATION_AGENCY" ? "education agency" : row.governmentClass.toLowerCase();
  return { kind: "BODY", id: `listing:${row.id}`, subjectId: row.id,
    text: `${row.provenance.sourceOrg} lists ${row.name} as a ${identity} in ${row.state} (${row.sourceVintage}).${row.status ? ` Source status: ${row.status}.` : ""}${row.contactTitle ? ` Contact: ${row.contactTitle}.` : ""}${contactFactsFrom(row, row.provenance)}${row.associations.length === 0 ? " A service area has not been verified for this listing." : " Geographic associations do not establish who sits on its board."}`,
    sourceUrl: row.provenance.sourceUrl, sourceOrg: row.provenance.sourceOrg, retrievedAt: row.provenance.collectedAt };
}

/** Independent directory and domain facts keep their own source citations in Ask. */
export function governmentListingEvidenceRecords(row: RegistrationGovernmentListing): EvidenceRecord[] {
  return [governmentListingEvidence(row),
    ...(row.additionalSources ?? []).map((source, index): EvidenceRecord => ({
      kind: "BODY", id: `listing:${row.id}:source:${index}`, subjectId: row.id,
      text: `${source.sourceOrg} supplies the linked school directory or native crosswalk for ${row.name}, NCES LEAID ${row.nativeIds.nces_leaid ?? ""}.${contactFactsFrom(row, source)}`,
      sourceUrl: source.sourceUrl, sourceOrg: source.sourceOrg, retrievedAt: source.collectedAt,
    })),
    ...(row.govDomains ?? []).map((domain): EvidenceRecord => ({
      kind: "BODY", id: `listing:${row.id}:domain:${domain.domain}`, subjectId: row.id,
      text: `The CISA .gov registry lists ${domain.domain} (${domain.website}) for ${row.name} in ${row.state}.`,
      sourceUrl: domain.sourceUrl, sourceOrg: "Cybersecurity and Infrastructure Security Agency", retrievedAt: domain.checkedAt,
    })),
  ];
}
