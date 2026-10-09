import { bodyById } from "../registry/server.ts";
import { fromBodyOffice } from "../officials/office-locations.ts";
import { contactForOfficeLocation, type AskContact } from "./contacts.ts";
import { readOfficeLocations } from "../officials/member-offices-read.ts";
import { memberDirectoryReaches } from "../officials/member-directory-scope.ts";
import type { SeatHolder } from "../officials/lookup.ts";
import type { PromotedCivicDataReadOptions } from "../civic-data/read-model.ts";

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
  const body = await bodyById(bodyId);
  const location = body && fromBodyOffice({ bodyId, address: body.officeAddress, phone: body.officePhone,
    sourceUrl: body.provenance?.sourceUrl, sourceOrg: body.provenance?.sourceOrg, collectedAt: body.provenance?.collectedAt });
  return location ? [contactForOfficeLocation(location, bodyName, `Office of ${bodyName}`)] : [];
}
