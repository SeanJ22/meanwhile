"use client";

import { useState } from "react";
import type { RegistrationGovernmentListing } from "@/lib/registration/listings";

function Listing({ row }: { row: RegistrationGovernmentListing }) {
  return <details className="mt-2" data-government-listing={row.id}>
    <summary className="cursor-pointer t-body text-paper">{row.name}</summary>
    <div className="mt-1 space-y-1 t-detail text-voice">
      <p>{row.governmentClass}{row.status ? ` · ${row.status}` : ""}</p>
      {row.kind === "DEPENDENT_SCHOOL_SYSTEM" && <p>A dependent school system; this listing does not establish an independent government.</p>}
      {row.associations.length === 0 && <p>We have not connected this listing to a verified service area.</p>}
      {row.officeAddress && <p>Office: {row.officeAddress}</p>}
      {row.officePhone && <p>Office phone: <a href={`tel:${row.officePhone}`} className="text-link">{row.officePhone}</a></p>}
      <details>
        <summary className="cursor-pointer text-link">Sources</summary>
        <p>{row.provenance.sourceUrl
          ? <a href={row.provenance.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-link">{row.provenance.sourceOrg}</a>
          : row.provenance.sourceOrg}{" · "}{row.sourceVintage}</p>
        {row.provenance.collectedAt && <p>Source retrieved {row.provenance.collectedAt.slice(0, 10)}.</p>}
        {row.website && <p><a href={row.website} target="_blank" rel="noopener noreferrer" className="text-link">Website listed by the source</a></p>}
      </details>
    </div>
  </details>;
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
