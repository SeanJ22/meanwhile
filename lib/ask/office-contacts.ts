import { bodyById } from "../registry/server.ts";
import { fromBodyOffice } from "../officials/office-locations.ts";
import { contactForOfficeLocation, type AskContact } from "./contacts.ts";

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
