import { telHref } from "../officials/phone-numbers.ts";
import { readerText } from "../text/reader-names.ts";
import type { CardSource } from "../officials/card-sources.ts";
import type { CoveredBody } from "./coverage.ts";

export interface BodyContactRow {
  label: string;
  value: string;
  href: string | null;
}

/** Every published contact for this body, kept together in its Contact section. */
export function bodyContactRows(body: CoveredBody): BodyContactRow[] {
  const rows: BodyContactRow[] = [];
  const contact = body.officeContact;
  if (contact?.phone) rows.push({ label: "Phone", value: contact.phone, href: telHref(contact.phone) });
  const sharedPhone = body.readerRoster?.officePhone;
  if (sharedPhone && (!contact?.phone || telHref(contact.phone) !== telHref(sharedPhone.phone))) {
    rows.push({ label: contact?.phone ? "Board office phone" : "Phone", value: sharedPhone.phone, href: telHref(sharedPhone.phone) });
  }
  if (contact?.address) rows.push({ label: "Office address", value: readerText(contact.address, "address"), href: null });
  if (contact?.email) rows.push({ label: "Email", value: contact.email, href: `mailto:${contact.email}` });
  if (body.homepageUrl) {
    rows.push({ label: "Website", value: new URL(body.homepageUrl).hostname.replace(/^www\./, ""), href: body.homepageUrl });
  }
  return rows;
}

/** Contact routes keep their saved publisher pages and checked dates. */
export function bodyContactSources(body: CoveredBody): CardSource[] {
  const sources: CardSource[] = body.homepageUrl && !body.fieldSources?.homepageUrl && body.provenance
    ? [{ what: "This board's website", provenance: body.provenance }] : [];
  const phone = body.readerRoster?.officePhone;
  if (!phone || body.officeContact?.phone && telHref(phone.phone) === telHref(body.officeContact.phone)) return sources;
  const source = body.readerRoster?.members.flatMap(member => [member.fieldSources?.phone, member.provenance]
    .filter(provenance => provenance?.sourceUrl === phone.sourceUrl))
    .sort((a, b) => (b?.collectedAt ?? "").localeCompare(a?.collectedAt ?? ""))[0];
  return [...sources, { what: "How to call this board's office", provenance: {
    sourceUrl: phone.sourceUrl, sourceOrg: phone.sourceOrg, collectedAt: source?.collectedAt ?? "", verifiedAt: source?.verifiedAt ?? null,
  } }];
}
