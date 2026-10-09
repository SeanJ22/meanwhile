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

export function governmentListingEvidence(row: RegistrationGovernmentListing): EvidenceRecord {
  const identity = row.kind === "DEPENDENT_SCHOOL_SYSTEM" ? "dependent school system" : row.kind === "EDUCATION_AGENCY" ? "education agency" : row.governmentClass.toLowerCase();
  return { kind: "BODY", id: `listing:${row.id}`, subjectId: row.id,
    text: `${row.provenance.sourceOrg} lists ${row.name} as a ${identity} in ${row.state} (${row.sourceVintage}).${row.status ? ` Source status: ${row.status}.` : ""}${row.officePhone ? ` Listed office phone: ${row.officePhone}.` : ""}${row.officeAddress ? ` Listed office address: ${row.officeAddress}.` : ""}${row.associations.length === 0 ? " A service area has not been verified for this listing." : " Geographic associations do not establish who sits on its board."}`,
    sourceUrl: row.provenance.sourceUrl, sourceOrg: row.provenance.sourceOrg, retrievedAt: row.provenance.collectedAt };
}
