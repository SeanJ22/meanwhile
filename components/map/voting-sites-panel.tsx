"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { MapPin, X } from "lucide-react";

import { PLACEHOLDER_ADDRESS } from "@/lib/ballot/placeholder-address";
import {
  directionsUrl,
  isPinnable,
  UNPLACED_SITE_LINE,
  type VotingSite,
  type VotingSitesAnswer,
} from "@/lib/ballot/voting-sites";

/**
 * **Where can I vote?** — tracker B19, the reader-facing half.
 *
 * ## What the reader gets, and why it is plural
 *
 * They type an address. The sites they may use drop on the map as violet
 * teardrops, unmistakable against the round meeting dots, and this panel lists
 * the same sites with the sentence that says which model their jurisdiction
 * uses. In Pima County that sentence is *"any registered voter may vote at any
 * of these"*; in New London it is *"you are assigned to one of these"*. The
 * author's ruling is that the reader learning their county works differently
 * is the FEATURE, and it is the stranger test in one sentence.
 *
 * ## The address is orientation, not identity, and the copy says so
 *
 * The address goes to `/api/voting-sites`, which resolves it and keeps
 * nothing — no log row, no store, no cache. That promise is written where the
 * reader types, not buried in a policy, because a promise a reader cannot see
 * is not one they can hold us to.
 *
 * ## Friction that is the product working
 *
 * Exactly one link leaves the app: the directions handoff on a site's own
 * card. Turn-by-turn is not something we do, and pretending otherwise would
 * be worse than handing the reader off honestly. Everything else about a
 * location — its name, its address, the room, which wards it serves, who
 * published it and when we read it — is here.
 */

export interface VotingSitesPanelProps {
  /** Lift the pinnable sites so the map can draw them. */
  onSites: (sites: { id: string; name: string; lat: number; lng: number }[]) => void;
  /** Which pin is selected, so the list can scroll it into view. */
  selectedSiteId: string | null;
  onSelectSite: (id: string | null) => void;
  onClose: () => void;
}

type State =
  | { kind: "idle" }
  | { kind: "asking" }
  | { kind: "failed" }
  | { kind: "answered"; answer: VotingSitesAnswer };

export function VotingSitesPanel({
  onSites,
  selectedSiteId,
  onSelectSite,
  onClose,
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

  // Lift the pins whenever the answer changes, and clear them on unmount so
  // closing the panel never leaves violet pins on a map with no card behind
  // them.
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

  useEffect(() => () => onSitesRef.current([]), []);

  return (
    <section
      className="voting-panel"
      role="dialog"
      aria-label="Where can I vote"
      aria-modal="false"
    >
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
          autoComplete="off"
          inputMode="text"
        />
        {/* F01 1e (2026-08-19, the author, ordered verbatim: "we are going
            to store and log at some point — don't argue about it, just make
            sure it's changed"). The never-store/never-log promise is struck.
            This sentence describes the mechanism as it works today and stops:
            no forward commitment in either direction, because the honest
            version of a promise we may not keep is no promise. Level
            register — a claim surface about a reader's own address. */}
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
          <p className="voting-panel-status">
            {/* BAL-7 (2026-08-24): what is known, then the non-claim, and
                nothing about how we feel about the shortfall. */}
            That address is outside the places this app covers yet — which is
            not a statement about your county.
          </p>
        )}

      {state.kind === "answered" &&
        state.answer.jurisdictions.map((j) => (
          <article key={j.ocdId} className="voting-jurisdiction">
            <h3 className="voting-jurisdiction-name">{j.name}</h3>
            <p className="voting-model">{j.modelSentence}</p>
            {/* B16 — which of these is yours, or why we will not say. A
                refusal renders in the gap's own register with its rungs, not
                as silence and never as a best guess. */}
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

            {j.sites.length > 0 && (
              <ul className="voting-sites">
                {j.sites.map((site) => (
                  <SiteRow
                    key={site.id}
                    site={site}
                    selected={site.id === selectedSiteId}
                    onSelect={() =>
                      onSelectSite(site.id === selectedSiteId ? null : site.id)
                    }
                  />
                ))}
              </ul>
            )}

            <p className="voting-source">
              From {j.sourceOrg}.{" "}
              <a href={j.sourceUrl} target="_blank" rel="noreferrer noopener">
                Their page
              </a>
              , read {j.collectedAt}.
            </p>
          </article>
        ))}
    </section>
  );
}

const KIND_LABEL: Record<VotingSite["kind"], string> = {
  ELECTION_DAY: "Open on election day",
  EARLY_VOTING: "Early voting",
  MOBILE: "Mobile voting site",
};

function SiteRow({
  site,
  selected,
  onSelect,
}: {
  site: VotingSite;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <li className="voting-site" data-selected={selected}>
      <button type="button" className="voting-site-head" onClick={onSelect}>
        <MapPin aria-hidden size={14} className="voting-site-icon" />
        <span className="voting-site-name">{site.name}</span>
      </button>
      <p className="voting-site-address">{site.address}</p>
      {site.room && <p className="voting-site-room">{site.room}</p>}
      <p className="voting-site-kind">{KIND_LABEL[site.kind]}</p>
      {site.serves && <p className="voting-site-serves">{site.serves}</p>}
      {/* A render default may never manufacture a claim: an unlabeled row is
          not evidence that a location is open for the next election, so it
          says whose gap it is instead of borrowing a date. */}
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
