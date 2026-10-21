import { getRegistryRuntimeReadModel } from "../registry/runtime-read-model.ts";
import { fromBodyOffice } from "../officials/office-locations.ts";
import { contactForOfficeLocation, type AskContact } from "./contacts.ts";
import { readOfficeLocations } from "../officials/member-offices-read.ts";
import { memberDirectoryReaches } from "../officials/member-directory-scope.ts";
import type { SeatHolder } from "../officials/lookup.ts";
import type { PromotedCivicDataReadOptions } from "../civic-data/read-model.ts";
import { overLengthBudget } from "./length-contract.ts";

/** Current native office records reach Ask as soon as their person's source projection is published. */
export async function officeContactsForMember(holder: Pick<SeatHolder,"id"|"name"|"state">, options:PromotedCivicDataReadOptions = {}): Promise<AskContact[]> {
  if(!memberDirectoryReaches(holder.id,"offices",holder.state)) return [];
  return (await readOfficeLocations(holder.id,holder.state,options))
    .map(location=>contactForOfficeLocation(location,holder.name,`${location.kind === "CAPITOL_OFFICE" ? "Capitol" : "District"} office of ${holder.name}`));
}

/**
 * Where a body's office is, as an Ask contact: the address and phone its own
 * page states, with that page as the source. Empty when no page has stated one.
 */
export async function officeContactsForBody(bodyId: string, bodyName: string): Promise<AskContact[]> {
  const body = getRegistryRuntimeReadModel().registry.bodies.find(body => body.id === bodyId);
  const location = body && fromBodyOffice({ bodyId, address: body.officeAddress, phone: body.officePhone,
    sourceUrl: body.provenance?.sourceUrl, sourceOrg: body.provenance?.sourceOrg, collectedAt: body.provenance?.collectedAt });
  return location ? [contactForOfficeLocation(location, bodyName, `Office of ${bodyName}`)] : [];
}

/** Exact office-location questions need the held address, not a prose writer. */
export function composeBodyOfficeAnswer(question: string, contacts: readonly AskContact[]) {
  if (!/^where(?: (?:is|are)|['’]s)\b[\s\S]+\boffices?\s*[?.!]*$/i.test(question.trim())) return null;
  const offices = contacts.filter(contact => contact.office?.address && contact.sourceUrl);
  if (!offices.length) return { answer: "We don't have that office address yet.", citedUrls: [], missingAnswer: true };
  const answer = [...new Set(offices.map(contact => contact.office!.address))].join("; ") + ".";
  return overLengthBudget(answer) ? null : { answer, citedUrls: [...new Set(offices.map(contact => contact.sourceUrl!))] };
}
