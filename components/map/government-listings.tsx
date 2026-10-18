"use client";

import { useState } from "react";
import { CardSourcesContribution } from "@/components/ui/card-sources-contribution";
import type { RegistrationGovernmentListing } from "@/lib/registration/listings";
import { governmentStateOf } from "@/lib/registration/listings";
import { StateCampaignSection } from "@/components/funding/state-campaign-section";
import { FederalMoneySection } from "@/components/funding/federal-money-section";
import { CardSourceContext, useCardSourceRegistry } from "@/components/ui/card-source-context";
import { CardFooter } from "@/components/ui/card-footer";
import { federalMoneyStateDivision } from "@/lib/federal-money/view";

function Listing({ row }: { row: RegistrationGovernmentListing }) {
  const [open, setOpen] = useState(false);
  const divisionId = row.associations.length === 1 ? row.associations[0].divisionId : federalMoneyStateDivision(typeof row.state === "string" ? row.state : governmentStateOf(row.id));
  const { register, sources, insideCard } = useCardSourceRegistry([{ what: `Government inventory, ${row.sourceVintage}`, provenance: { kind: "OFFICIAL", sourceOrg: row.provenance.sourceOrg, sourceUrl: row.provenance.sourceUrl, collectedAt: row.provenance.collectedAt, verifiedAt: null } }], row.id);
  return <CardSourceContext value={register}><details className="mt-2" data-government-listing={row.id} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className="cursor-pointer t-body text-paper">{row.name}</summary>
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
      <CardSourcesContribution id={`government-listing:${row.id}`} sources={[
        { what: `${row.name} · ${row.sourceVintage}`, provenance: row.provenance },
        ...(row.additionalSources ?? []).map(source => ({ what: `${row.name} · additional listing`, provenance: source })),
        ...(row.govDomains ?? []).map(link => ({ what: `${link.domain} · CISA .gov registry`,
          provenance: { sourceUrl: link.sourceUrl, sourceOrg: "CISA .gov registry", collectedAt: link.checkedAt, verifiedAt: null } })),
      ]} />
      {open && divisionId && <div className="pt-3"><h4 className="t-detail font-medium text-paper">Federal money and records</h4><FederalMoneySection divisionId={divisionId} bodyId={row.id} /></div>}
      {open && row.associations.length === 1 && <StateCampaignSection divisionId={row.associations[0].divisionId} />}
      {!insideCard && <CardFooter gaps={[]} sources={sources} />}
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
