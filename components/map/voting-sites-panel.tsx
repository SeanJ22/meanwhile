"use client";

import { CardSourcesContribution } from "@/components/ui/card-sources-contribution";
import type { CivicLookup } from "@/lib/sources/google-civic/model";
import { GoogleCivicResults } from "@/components/ballot/google-civic-results";
import { setCivicVoterAddress } from "@/lib/sources/google-civic/session";
import { WorkingOnIt } from "@/components/demand/working-on-it";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { MapPin, X } from "lucide-react";

import { PLACEHOLDER_ADDRESS } from "@/lib/ballot/placeholder-address";
import { pollingLookupFallbacks } from "@/lib/ballot/polling-lookup-fallback";
import { PollingLookupFallback } from "@/components/ballot/polling-lookup-fallback";
import {
  directionsUrl,
  isPinnable,
  UNPLACED_SITE_LINE,
  type VotingSite,
  type VotingSitesAnswer,
  milesLabel,
  sitesNearestFirst,
} from "@/lib/ballot/voting-sites";

/**
 * Where can I vote? The address goes to `/api/voting-sites`; the sites drop on
 * the map as pins and list here with the sentence naming the jurisdiction's
 * voting model. The only link out is a site's directions handoff.
 */

export interface VotingSitesPanelProps {
  /** Lift the pinnable sites so the map can draw them. */
  onSites: (sites: { id: string; name: string; lat: number; lng: number }[]) => void;
  /** Lift the resolved point (never the address) so the map can draw the ten-mile ring. */
  onAddressPoint?: (point: { lat: number; lng: number } | null) => void;
  /** Which pin is selected, so the list can scroll it into view. */
  selectedSiteId: string | null;
  onSelectSite: (id: string | null) => void;
  onClose: () => void;
  /** Inside the design popup, which owns the title and the close control. */
  embedded?: boolean;
}

type State =
  | { kind: "idle" }
  | { kind: "asking" }
  | { kind: "failed" }
  | { kind: "answered"; answer: VotingSitesAnswer };

export function VotingSitesPanel({
  onSites,
  onAddressPoint,
  selectedSiteId,
  onSelectSite,
  onClose,
  embedded = false,
}: VotingSitesPanelProps) {
  const [address, setAddress] = useState("");
  const [googleCivic, setGoogleCivic] = useState<CivicLookup | null>(null);
  const lookupRequest = useRef<AbortController | null>(null);
  const [state, setState] = useState<State>({ kind: "idle" });
  const inputId = useId();
  const onSitesRef = useRef(onSites);
  useEffect(() => {
    onSitesRef.current = onSites;
  }, [onSites]);

  const submit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      const value = address.trim();
      if (value.length < 3) return;
      lookupRequest.current?.abort();
      const controller = new AbortController();
      lookupRequest.current = controller;
      setState({ kind: "asking" });
      setGoogleCivic(null);
      setCivicVoterAddress(undefined);
      // Both publishers answer independently; source data is usable as soon as it arrives.
      const civicRead = fetch("/api/civic-voterinfo", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ address: value }), cache: "no-store", signal: controller.signal,
      }).then(async response => {
        if (!response.ok) return;
        const lookup = await response.json() as CivicLookup;
        if (controller.signal.aborted) return;
        setGoogleCivic(lookup);
        if (lookup.status !== "OUTAGE") setCivicVoterAddress(value);
      }).catch(() => undefined);
      try {
        const res = await fetch("/api/voting-sites", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ address: value }),
          cache: "no-store",
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        if (!res.ok) {
          setState({ kind: "failed" });
          return;
        }
        const answer = (await res.json()) as VotingSitesAnswer;
        if (!controller.signal.aborted) setState({ kind: "answered", answer });
      } catch {
        if (!controller.signal.aborted) setState({ kind: "failed" });
      } finally {
        await civicRead;
      }
    },
    [address],
  );

  // Lift the pins on each answer and clear them on unmount.
  useEffect(() => {
    const civicPins = civicVotingPins(googleCivic);
    if (state.kind !== "answered") {
      onSitesRef.current(civicPins);
      return;
    }
    onSitesRef.current([
      ...civicPins,
      ...state.answer.jurisdictions
        .flatMap((j) => j.sites)
        .filter(isPinnable)
        .map((s) => ({ id: s.id, name: s.name, lat: s.lat, lng: s.lng })),
    ]);
  }, [state, googleCivic]);

  // The ring appears with an answer and clears when the panel closes.
  useEffect(() => {
    onAddressPoint?.(state.kind === "answered" ? state.answer.point : null);
  }, [state, onAddressPoint]);

  useEffect(() => () => onAddressPoint?.(null), [onAddressPoint]);

  useEffect(() => () => { lookupRequest.current?.abort(); onSitesRef.current([]); }, []);

  return (
    <section
      className={embedded ? "voting-panel mw-voting-panel" : "voting-panel"}
      role={embedded ? undefined : "dialog"}
      aria-label={embedded ? undefined : "Where can I vote"}
      aria-modal={embedded ? undefined : "false"}
    >
      {!embedded && (
      <header className="voting-panel-head">
        <h2 className="voting-panel-title">Where can I vote?</h2>
        <button
          type="button"
          className="voting-panel-close"
          onClick={onClose}
          aria-label="Close"
        >
          <X aria-hidden size={16} />
        </button>
      </header>
      )}

      <form onSubmit={submit} className="voting-panel-form">
        <label htmlFor={inputId} className="voting-panel-label">
          Your street address
        </label>
        <input
          id={inputId}
          className="voting-panel-input"
          value={address}
          onChange={(e) => { setAddress(e.target.value); setCivicVoterAddress(undefined); }}
          placeholder={PLACEHOLDER_ADDRESS}
          // The design popup opens with the cursor in the address field.
          autoFocus={embedded}
          autoComplete="off"
          inputMode="text"
        />
        {/* Describes the mechanism as it works today, with no forward commitment. */}
        <p className="voting-panel-note">
          Your address is used to find your voting locations. It passes through
          our server to Google Civic Information for election data and to the
          Census Bureau to place it on the map.
        </p>
        <button type="submit" className="voting-panel-submit">
          Show me
        </button>
      </form>

      {state.kind === "asking" && (
        <p className="voting-panel-status">Looking&hellip;</p>
      )}

      {state.kind === "failed" && (
        <p className="voting-panel-status">
          Something went wrong on our end. Try again.
        </p>
      )}

      {state.kind === "answered" && !state.answer.match && (
        <p className="voting-panel-status">
          We could not turn that into a location. Try including the town and
          state.
        </p>
      )}

      {state.kind === "answered" &&
        state.answer.match &&
        state.answer.outsideCoverage && (
          <p className="voting-panel-status">
            <WorkingOnIt inline />
          </p>
        )}

      <PollingLookupFallback links={pollingLookupFallbacks(state.kind, state.kind === "answered" ? state.answer : undefined)} />

      {googleCivic && state.kind !== "answered" && <GoogleCivicResults lookup={googleCivic} selectedSiteId={selectedSiteId} onSelectSite={onSelectSite} />}
      {state.kind === "answered" && <VotingJurisdictionRecords answer={{ ...state.answer, googleCivic: googleCivic ?? undefined }} selectedSiteId={selectedSiteId} onSelectSite={onSelectSite} />}
    </section>
  );
}


/** Source coordinates identify published public sites; they do not infer a precinct or an address assignment. */
export function civicVotingPins(lookup: CivicLookup | null) {
  return (lookup?.rows ?? []).flatMap(row => {
    if (row.kind === "CONTEST" || row.kind === "ELECTION") return [];
    const lat = row.value.latitude, lng = row.value.longitude;
    if (typeof lat !== "number" || typeof lng !== "number" || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return [];
    const address = row.value.address as { locationName?: unknown } | undefined;
    return [{ id: row.id, name: typeof address?.locationName === "string" ? address.locationName : "Voting location", lat, lng }];
  });
}

/** The actual answered jurisdiction/site body shared by both panel entry paths. */
export function VotingJurisdictionRecords({ answer, selectedSiteId, onSelectSite }: { answer: VotingSitesAnswer; selectedSiteId: string | null; onSelectSite: (id: string | null) => void }) {
  return <>
      {answer.googleCivic && <GoogleCivicResults lookup={answer.googleCivic} selectedSiteId={selectedSiteId} onSelectSite={onSelectSite} />}
      {answer.jurisdictions.map((j) => (
          <article key={j.ocdId} className="voting-jurisdiction" data-voting-jurisdiction={j.ocdId}>
            <h3 className="voting-jurisdiction-name">{j.name}</h3>
            <p className="voting-model">{j.modelSentence}</p>
            {/* Which site is yours, or the refusal with its rungs; never a best guess. */}
            <p
              className="voting-narrowing"
              data-kind={j.narrowing.kind.toLowerCase()}
            >
              {j.narrowing.sentence}
            </p>
            {j.narrowing.kind === "REFUSED" && j.narrowing.rungs.length > 0 && (
              <details className="voting-narrowing-rungs">
                <summary>What we tried</summary>
                <ol className="voting-rungs">
                  {j.narrowing.rungs.map((r, i) => (
                    <li key={`${r.rung}-${i}`}>
                      <span className="voting-rung-what">{r.what}</span>
                      <span className="voting-rung-result">{r.result}</span>
                      <span className="voting-rung-when">{r.attemptedAt}</span>
                    </li>
                  ))}
                </ol>
              </details>
            )}
            {j.election && (
              <p className="voting-election">
                Published for the {j.election}.
              </p>
            )}

            {j.refusal && (
              <div className="voting-refusal">
                <p>{j.refusalLine}</p>
                <p className="voting-refusal-wall">{j.refusal.wall}</p>
                <details>
                  <summary>What we tried</summary>
                  <ol className="voting-rungs">
                    {j.refusal.rungs.map((r, i) => (
                      <li key={`${r.rung}-${i}`}>
                        <span className="voting-rung-what">{r.what}</span>
                        <span className="voting-rung-result">{r.result}</span>
                        <span className="voting-rung-when">{r.attemptedAt}</span>
                      </li>
                    ))}
                  </ol>
                </details>
              </div>
            )}

            {/* Nearest first, a sort and never a filter: every site in the county stays. */}
            {j.sites.length > 0 && (
              <ul className="voting-sites">
                {sitesNearestFirst(j.sites, answer.point).map(({ site, miles }) => (
                  <SiteRow
                    key={site.id}
                    site={site}
                    miles={miles}
                    selected={site.id === selectedSiteId}
                    onSelect={() =>
                      onSelectSite(site.id === selectedSiteId ? null : site.id)
                    }
                  />
                ))}
              </ul>
            )}

            <CardSourcesContribution id={`voting-sites:${j.name}`} sources={[{ what: "Published voting locations", provenance: { sourceUrl: j.sourceUrl, sourceOrg: j.sourceOrg, collectedAt: j.collectedAt, verifiedAt: null } }]} />
          </article>
        ))}
  </>;
}

const KIND_LABEL: Record<VotingSite["kind"], string> = {
  ELECTION_DAY: "Open on election day",
  EARLY_VOTING: "Early voting",
  MOBILE: "Mobile voting site",
};

function SiteRow({
  site,
  miles,
  selected,
  onSelect,
}: {
  site: VotingSite;
  /** Miles from the address the reader typed, or null if unplaceable. */
  miles: number | null;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <li className="voting-site" data-selected={selected} data-voting-site={site.id}>
      <button type="button" className="voting-site-head" onClick={onSelect}>
        <MapPin aria-hidden size={14} className="voting-site-icon" />
        <span className="voting-site-name">{site.name}</span>
      </button>
      <p className="voting-site-address">{site.address}</p>
      {/* A null distance renders nothing; an unplaced site carries its own gap below. */}
      {miles !== null && <p className="voting-site-distance">{milesLabel(miles)}</p>}
      {site.room && <p className="voting-site-room">{site.room}</p>}
      <p className="voting-site-kind">{KIND_LABEL[site.kind]}</p>
      {site.serves && <p className="voting-site-serves">{site.serves}</p>}
      {/* An unlabeled row is not evidence a location is open for the next election. */}
      {site.election === null && (
        <p className="voting-site-gap">
          The authority did not say which election this location is for.
        </p>
      )}
      {!isPinnable(site) && (
        <p className="voting-site-gap">{UNPLACED_SITE_LINE}</p>
      )}
      <a
        className="voting-site-directions"
        href={directionsUrl(site)}
        target="_blank"
        rel="noreferrer noopener"
      >
        Directions
      </a>
    </li>
  );
}
