"use client";

import { CardSourcesContribution } from "@/components/ui/card-sources-contribution";
import type { CardSource } from "@/lib/officials/card-sources";
import { telHref } from "@/lib/officials/phone-numbers";
import { LOCAL_ELECTION_OFFICE_FIELDS, type LocalElectionOffice, type LocalElectionOfficeField } from "@/lib/sources/local-election-offices/model";

const fieldLabels: Record<LocalElectionOfficeField, string> = {
  office: "Office name", address: "Street address", phone: "Phone", email: "Email", hours: "Office hours", website: "Office website", pollingPlaceLookup: "Polling-place lookup",
};

/** Keep each field's page and check date in the card's shared Sources section. */
export function localElectionOfficeSources(office: LocalElectionOffice): CardSource[] {
  const fields = LOCAL_ELECTION_OFFICE_FIELDS.flatMap(field => {
    const source = office.fields[field];
    return source && office[field] ? [{ what: `${office.office} — ${fieldLabels[field]}`,
      provenance: { sourceUrl: source.sourceUrl, sourceOrg: source.publisher, collectedAt: source.checkedAt, verifiedAt: null },
      dataAttrs: { "data-office-field": field, "data-document-hash": source.documentHash },
    }] : [];
  });
  const directory = office.directorySource;
  return [...fields, ...(directory ? [{ what: `${office.town ?? office.countyName ?? office.office} — Office jurisdiction`,
    provenance: { sourceUrl: directory.sourceUrl, sourceOrg: directory.publisher, collectedAt: directory.checkedAt, verifiedAt: null },
    dataAttrs: { "data-office-field": "jurisdiction", "data-document-hash": directory.documentHash },
  }] : [])];
}

/** Join the separately sourced jurisdiction and office label without changing either fact. */
export function localElectionOfficeTitle(office: LocalElectionOffice): string {
  const native = office.directoryJurisdiction ?? office.town ?? office.countyName ?? "";
  const jurisdiction = office.town ? native : native.replace(/\s+(?:County|Parish|Borough|Census Area|Municipality)$/i, "");
  const key = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
  return jurisdiction && !key(office.office).includes(key(jurisdiction)) ? `${jurisdiction} ${office.office}` : office.office;
}

/** An office contact helps with the next step and never claims to be a voting site. */
export function LocalElectionOfficeContact({ office }: { office: LocalElectionOffice }) {
  const town = office.town && office.municipalityType && !/^(?:town|township|city|village) of | (?:town|township|city|village)$/i.test(office.town)
    ? `${office.municipalityType[0]}${office.municipalityType.slice(1).toLowerCase()} of ${office.town}` : office.town;
  const phoneParts = office.phone?.split(/([,\n]|\s+(?:or|and|&)\s+)/i) ?? [];
  return <section className="voting-office" data-local-election-office={office.id}>
    <h3 className="voting-jurisdiction-name">{localElectionOfficeTitle(office)}</h3>
    {town && <p>{town}{office.countyName ? ` · ${office.countyName}` : ""}</p>}
    {!town && office.countyName && <p>{office.countyName}</p>}
    {office.address && <p className="voting-office-address">{office.address}</p>}
    {office.phone && <p>Phone: {phoneParts.map((part, index) => /\d/.test(part) ? <a key={index} href={telHref(part)}>{part}</a> : part)}</p>}
    {office.email && <p>Email: <a href={`mailto:${office.email}`}>{office.email}</a></p>}
    {office.hours && <p className="voting-office-hours whitespace-pre-line">Office hours: {office.hours}</p>}
    {office.website && <p><a href={office.website} target="_blank" rel="noreferrer noopener">Election office website</a></p>}
    {office.pollingPlaceLookup && <p><a href={office.pollingPlaceLookup} target="_blank" rel="noreferrer noopener">Find your polling place</a></p>}
    <CardSourcesContribution id={`local-election-office:${office.id}`} sources={localElectionOfficeSources(office)} />
  </section>;
}
