"use client";

import { useState } from "react";
import type { CardSource } from "@/lib/officials/card-sources";
import type { RegistrationGovernmentListing } from "@/lib/registration/listings";
import { governmentStateOf } from "@/lib/registration/listings";
import { StateCampaignSection } from "@/components/funding/state-campaign-section";
import { FederalMoneySection } from "@/components/funding/federal-money-section";
import { CardSourceContext, useCardSourceRegistry } from "@/components/ui/card-source-context";
import { CardFooter } from "@/components/ui/card-footer";
import { federalMoneyStateDivision } from "@/lib/federal-money/view";
import { readerGovernmentName } from "@/lib/text/reader-names";

/** The saved inventory and contact pages behind this government's listing. */
function listingSources(row: RegistrationGovernmentListing): CardSource[] {
  const year = /^cog-(\d{4})$/.exec(row.sourceVintage)?.[1];
  return [
    { what: year ? `Government name, type and contact information from the ${year} Census of Governments` : "Government name, type and contact information", provenance: row.provenance },
    ...(row.additionalSources ?? []).map(provenance => ({ what: "Government name and contact information", provenance })),
    ...Object.values(row.contactProvenance ?? {}).filter((source): source is NonNullable<typeof source> => Boolean(source)).map(provenance => ({ what: "How to contact this government", provenance })),
    ...(row.govDomains ?? []).map(link => ({ what: "This government's official website", provenance: { sourceUrl: link.sourceUrl, sourceOrg: "Cybersecurity and Infrastructure Security Agency", collectedAt: link.checkedAt, verifiedAt: null } })),
  ];
}

function Listing({ row }: { row: RegistrationGovernmentListing }) {
  const [open, setOpen] = useState(false);
  const divisionId = row.associations.length === 1 ? row.associations[0].divisionId : federalMoneyStateDivision(typeof row.state === "string" ? row.state : governmentStateOf(row.id));
  const { register, sources, insideCard } = useCardSourceRegistry(listingSources(row), row.id);
  return <CardSourceContext value={register}><details className="mt-2" data-government-listing={row.id} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className="cursor-pointer t-body text-paper">{readerGovernmentName(row.name, null)}</summary>
    <div className="mt-1 space-y-1 t-detail text-voice">
      <p>{row.governmentClass}{row.status ? ` · ${row.status}` : ""}</p>
      {row.kind === "DEPENDENT_SCHOOL_SYSTEM" && <p>A dependent school system; this listing does not establish an independent government.</p>}
      {row.associations.length === 0 && <p>We have not connected this listing to a verified service area.</p>}
      {row.contactTitle && <p>Contact: {row.contactTitle}</p>}
      {row.mailingAddress && <p>Mailing address: {row.mailingAddress}</p>}
      {row.officeAddress && <p>Office: {row.officeAddress}</p>}
      {row.officePhone && <p>Office phone: <a href={`tel:${row.officePhone}`} className="text-link">{row.officePhone}</a></p>}
      {row.website && <p><a href={row.website} target="_blank" rel="noopener noreferrer" className="text-link">Official website</a></p>}
      {row.govDomains?.map(link => <p key={link.domain}><a href={link.website} target="_blank" rel="noopener noreferrer" className="text-link">{link.domain}</a></p>)}
      {open && divisionId && <div className="pt-3"><h4 className="t-detail font-medium text-paper">Federal money and records</h4><FederalMoneySection divisionId={divisionId} bodyId={row.id} /></div>}
      {open && row.associations.length === 1 && <StateCampaignSection divisionId={row.associations[0].divisionId} />}
      {!insideCard && <CardFooter sources={sources} />}
    </div>
  </details></CardSourceContext>;
}

function StateInventory({ state }: { state: string }) {
  const [records, setRecords] = useState<RegistrationGovernmentListing[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(0);
  const [status, setStatus] = useState<"IDLE" | "LOADING" | "HELD" | "UNAVAILABLE" | "NOT_HELD">("IDLE");
  async function load() {
    if (status === "LOADING" || nextOffset === null) return;
    setStatus("LOADING");
    try {
      const query = new URLSearchParams({ kind: "governments", state, offset: String(nextOffset) });
      const response = await fetch(`/api/public-records?${query}`);
      if (!response.ok) throw new Error("Listing unavailable");
      const page = await response.json() as { records: RegistrationGovernmentListing[]; nextOffset: number | null; status: "HELD" | "NOT_HELD" };
      setRecords(prior => [...new Map([...prior, ...page.records].map(row => [row.id, row])).values()]);
      setNextOffset(page.nextOffset);
      setStatus(page.status);
    } catch { setStatus("UNAVAILABLE"); }
  }
  return <details className="mt-2" onToggle={event => { if (event.currentTarget.open && status === "IDLE") void load(); }}>
    <summary className="cursor-pointer t-caption text-link">Browse {state} government and school listings</summary>
    <p className="mt-1 t-detail text-voice">These are state inventory records. Being listed here does not mean an agency serves your address.</p>
    {records.map(row => <Listing key={row.id} row={row} />)}
    {status === "NOT_HELD" && <p className="t-detail text-voice">We have not published this inventory yet.</p>}
    {status === "UNAVAILABLE" && <p className="t-detail text-voice">We could not load these listings just now.</p>}
    {status === "LOADING" && <p className="t-detail text-voice">Loading listings…</p>}
    {nextOffset !== null && status !== "LOADING" && <button type="button" className="mt-2 t-caption text-link" onClick={() => void load()}>{status === "UNAVAILABLE" ? "Try again" : "Load more listings"}</button>}
  </details>;
}

export function GovernmentListings({ records, states, unavailableStates = [] }: {
  records: readonly RegistrationGovernmentListing[]; states: readonly string[]; unavailableStates?: readonly string[];
}) {
  if (!records.length && !states.length) return null;
  return <section className="mt-3" aria-label="Government and school listings">
    <p className="t-structure text-local">Government and school listings</p>
    {records.length > 0 && <p className="mt-1 t-detail text-voice">Official inventory records associated with divisions in this area. Meetings and board members are recorded separately.</p>}
    {records.map(row => <Listing key={row.id} row={row} />)}
    {unavailableStates.length > 0 && <p className="mt-1 t-detail text-voice">We could not load the {unavailableStates.join(", ")} inventory just now.</p>}
    {states.map(state => <StateInventory key={state} state={state} />)}
  </section>;
}
