import { bodyById } from "../registry/server.ts";
import { fromBodyOffice } from "../officials/office-locations.ts";
import { contactForOfficeLocation, type AskContact } from "./contacts.ts";

/**
 * Where a body's office is, as the contact Ask answers with: the address and
 * phone its own page states (CA-06), with that page as the source. Empty when
 * no page has stated one; Ask then says so rather than guessing a city hall.
 */
export async function officeContactsForBody(bodyId: string, bodyName: string): Promise<AskContact[]> {
  const body = await bodyById(bodyId);
  const location = body && fromBodyOffice({ bodyId, address: body.officeAddress, phone: body.officePhone,
    sourceUrl: body.provenance?.sourceUrl, sourceOrg: body.provenance?.sourceOrg, collectedAt: body.provenance?.collectedAt });
  return location ? [contactForOfficeLocation(location, bodyName, `Office of ${bodyName}`)] : [];
}
