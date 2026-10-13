"use client";

import { Card } from "@/components/ui/card";
import { CardSourcesContribution } from "@/components/ui/card-sources-contribution";
import { CardGapContribution } from "@/components/ui/card-gap-context";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { MapPin } from "lucide-react";

import { PLACEHOLDER_ADDRESS } from "@/lib/ballot/placeholder-address";
import { pollingLookupFallbacks } from "@/lib/ballot/polling-lookup-fallback";
import { PollingLookupFallback } from "@/components/ballot/polling-lookup-fallback";
import {
  directionsUrl,
  isPinnable,
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
      setState({ kind: "asking" });
      try {
        const res = await fetch("/api/voting-sites", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ address: value }),
          cache: "no-store",
        });
        if (!res.ok) {
          setState({ kind: "failed" });
          return;
        }
        const answer = (await res.json()) as VotingSitesAnswer;
        setState({ kind: "answered", answer });
      } catch {
        setState({ kind: "failed" });
      }
    },
    [address],
  );

  // Lift the pins on each answer and clear them on unmount.
  useEffect(() => {
    if (state.kind !== "answered") {
      onSitesRef.current([]);
      return;
    }
    onSitesRef.current(
      state.answer.jurisdictions
        .flatMap((j) => j.sites)
        .filter(isPinnable)
        .map((s) => ({ id: s.id, name: s.name, lat: s.lat, lng: s.lng })),
    );
  }, [state]);

  // The ring appears with an answer and clears when the panel closes.
  useEffect(() => {
    onAddressPoint?.(state.kind === "answered" ? state.answer.point : null);
  }, [state, onAddressPoint]);

  useEffect(() => () => onAddressPoint?.(null), [onAddressPoint]);

  useEffect(() => () => onSitesRef.current([]), []);

  return (
    <section
      className={embedded ? "voting-panel mw-voting-panel" : "voting-panel"}
      role={embedded ? undefined : "dialog"}
      aria-label={embedded ? undefined : "Where can I vote"}
      aria-modal={embedded ? undefined : "false"}
    >
      <Card title="Where can I vote?" titleVisible={!embedded} onClose={embedded ? undefined : onClose} sources={[]} className={embedded ? "[&>.reader-card-header]:sr-only [&>.reader-card-body]:p-0" : undefined}>

      <form onSubmit={submit} className="voting-panel-form">
        <label htmlFor={inputId} className="voting-panel-label">
          Your street address
        </label>
        <input
          id={inputId}
          className="voting-panel-input"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder={PLACEHOLDER_ADDRESS}
          // The design popup opens with the cursor in the address field.
          autoFocus={embedded}
          autoComplete="off"
          inputMode="text"
        />
        {/* Describes the mechanism as it works today, with no forward commitment. */}
        <p className="voting-panel-note">
          Your address is used to find your voting locations. It passes through
          our server to the Census Bureau&rsquo;s geocoder, which turns it into
          a point on the map.
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
          <CardGapContribution id="voting-locations" label="voting locations for this address" />
        )}

      <PollingLookupFallback links={pollingLookupFallbacks(state.kind, state.kind === "answered" ? state.answer : undefined)} />

      {state.kind === "answered" && <VotingJurisdictionRecords answer={state.answer} selectedSiteId={selectedSiteId} onSelectSite={onSelectSite} />}
      </Card>
    </section>
  );
}


/** The actual answered jurisdiction/site body shared by both panel entry paths. */
export function VotingJurisdictionRecords({ answer, selectedSiteId, onSelectSite }: { answer: VotingSitesAnswer; selectedSiteId: string | null; onSelectSite: (id: string | null) => void }) {
  return <>
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
      {site.address && <p className="voting-site-address">{site.address}</p>}
      {/* A null distance renders nothing; an unplaced site carries its own gap below. */}
      {miles !== null && <p className="voting-site-distance">{milesLabel(miles)}</p>}
      {site.room && <p className="voting-site-room">{site.room}</p>}
      <p className="voting-site-kind">{KIND_LABEL[site.kind]}</p>
      {site.serves && <p className="voting-site-serves">{site.serves}</p>}
      {site.election === null && <CardGapContribution id={`voting-election:${site.id}`} label="election dates" unit="voting location" kind="not-posted" />}
      {!isPinnable(site) && <CardGapContribution id={`voting-map:${site.id}`} label="map locations" unit="voting location" />}
      {site.address && <a
        className="voting-site-directions"
        href={directionsUrl(site)}
        target="_blank"
        rel="noreferrer noopener"
      >
        Directions
      </a>}
    </li>
  );
}
