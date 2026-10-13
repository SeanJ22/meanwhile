"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { WorkingOnIt } from "@/components/demand/working-on-it";
import { setCivicVoterAddress } from "@/lib/sources/google-civic/session";
import type { CivicFact, CivicJson, CivicLookup } from "@/lib/sources/google-civic/model";
import { GOOGLE_CIVIC_DOCS } from "@/lib/sources/google-civic/targets";

const words = (value: unknown) => typeof value === "string" ? value : "";
const labels: Record<CivicFact["kind"], string> = { ELECTION: "Election", CONTEST: "Contest", POLLING_LOCATION: "Election-day polling place", EARLY_VOTE_SITE: "Early voting", DROP_OFF_LOCATION: "Ballot drop-off" };
export function civicFactTitle(row: CivicFact): string {
  const address = row.value.address as CivicJson | undefined;
  return words(row.value.office) || words(row.value.referendumTitle) || words(address?.locationName) || words(row.value.name) || labels[row.kind];
}
export function GoogleCivicResults({ lookup, selectedSiteId, onSelectSite }: { lookup: CivicLookup; selectedSiteId?: string | null; onSelectSite?: (id: string | null) => void }) {
  const missing = (["CONTEST", "POLLING_LOCATION", "EARLY_VOTE_SITE"] as const).filter(kind => !lookup.rows.some(row => row.kind === kind));
  return <section aria-label="Google Civic address results" className="my-4 space-y-3" data-google-civic-results>
    <h2 className="t-title font-semibold">Google Civic results for your address</h2>
    <p className="t-caption">November 3, 2026 · Checked {lookup.checkedAt.slice(0, 10)}</p>
    {lookup.rows.length === 0 && <Card title="Google Civic voting information" sources={[{ what: "Address lookup", provenance: { sourceUrl: GOOGLE_CIVIC_DOCS, sourceOrg: "Google Civic Information", collectedAt: lookup.checkedAt, verifiedAt: null } }]}>
      <p><WorkingOnIt inline /></p>
    </Card>}
    {lookup.rows.map(row => {
      const address = row.value.address as CivicJson | undefined;
      const candidates = Array.isArray(row.value.candidates) ? row.value.candidates as CivicJson[] : [];
      return <Card key={row.id} title={civicFactTitle(row)} eyebrow={labels[row.kind]} attrs={{ "data-voting-site": row.id, "data-selected": String(row.id === selectedSiteId) }} sources={row.sources.map(source => ({
        what: `${labels[row.kind]} · ${source.official ? "Official government source" : "Source"} · Publication date not supplied`,
        provenance: { sourceUrl: source.sourceUrl, sourceOrg: source.sourceOrg, collectedAt: source.collectedAt, verifiedAt: null, kind: source.official ? "OFFICIAL" : "REFERENCE" },
      }))}>
        {address && <p>{[address.line1, address.line2, address.line3, address.city, address.state, address.zip].map(words).filter(Boolean).join(", ")}</p>}
        {address && <p>
          {onSelectSite && typeof row.value.latitude === "number" && typeof row.value.longitude === "number" && <button type="button" className="voting-site-head" onClick={() => onSelectSite(row.id === selectedSiteId ? null : row.id)}>Show on map</button>}
          <a className="voting-site-directions" href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent([address.line1, address.line2, address.city, address.state, address.zip].map(words).filter(Boolean).join(", "))}`} target="_blank" rel="noreferrer">Directions</a>
        </p>}
        {words(row.value.pollingHours) && <p className="whitespace-pre-line">{words(row.value.pollingHours)}</p>}
        {words(row.value.startDate) && <p>Opens {words(row.value.startDate)}</p>}
        {words(row.value.endDate) && <p>Closes {words(row.value.endDate)}</p>}
        {words(row.value.notes) && <p>{words(row.value.notes)}</p>}
        {words(row.value.referendumText) && <p>{words(row.value.referendumText)}</p>}
        {candidates.length > 0 && <ul>{candidates.map((candidate, index) => <li key={index}>{words(candidate.name) || "Candidate name not supplied"}{words(candidate.party) && ` (${words(candidate.party)})`}</li>)}</ul>}
        {words(row.value.referendumUrl).startsWith("https://") && <p><a href={words(row.value.referendumUrl)}>Read the measure</a></p>}
      </Card>;
    })}
    {lookup.rows.length > 0 && missing.length > 0 && <Card title="More voting information" sources={[{ what: "Address lookup", provenance: { sourceUrl: GOOGLE_CIVIC_DOCS, sourceOrg: "Google Civic Information", collectedAt: lookup.checkedAt, verifiedAt: null } }]}>
      {missing.map(kind => <p key={kind}>{labels[kind]}: <WorkingOnIt inline /></p>)}
    </Card>}
  </section>;
}
export function GoogleCivicAddressLookup() {
  const [address, setAddress] = useState("");
  const [lookup, setLookup] = useState<CivicLookup | null>(null);
  const [working, setWorking] = useState(false);
  const [failed, setFailed] = useState(false);
  return <section className="my-6 space-y-3" aria-label="Address-specific ballot and voting sites">
    <h2 className="t-title font-semibold">Check your ballot and voting sites by address</h2>
    <form onSubmit={async event => {
      event.preventDefault();
      const value = address.trim();
      if (value.length < 3) return;
      setWorking(true); setFailed(false); setLookup(null); setCivicVoterAddress(undefined);
      try {
        const response = await fetch("/api/civic-voterinfo", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: value }), cache: "no-store" });
        if (!response.ok) throw new Error("Lookup failed");
        const result = await response.json() as CivicLookup;
        setLookup(result);
        if (result.status !== "OUTAGE") setCivicVoterAddress(value);
      } catch { setFailed(true); }
      finally { setWorking(false); }
    }} className="voting-panel-form">
      <label className="voting-panel-label">Street address
        <input className="voting-panel-input" value={address} onChange={event => { setAddress(event.target.value); setCivicVoterAddress(undefined); }} autoComplete="off" maxLength={200} disabled={working} required />
      </label>
      <p className="t-caption">Your address is sent to Google Civic Information to find your ballot and voting locations.</p>
      <button type="submit" className="voting-panel-submit" disabled={working}>{working ? "Looking…" : "Show me"}</button>
    </form>
    {failed && <p>We couldn’t check that address. Try again.</p>}
    {lookup && <GoogleCivicResults lookup={lookup} />}
  </section>;
}
