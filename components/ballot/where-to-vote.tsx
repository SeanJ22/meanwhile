"use client";

import { useCallback, useState } from "react";

import { VotingSitesPanel } from "@/components/map/voting-sites-panel";

/**
 * **"Find your polling place" stops leaving the app.** — F01-continued
 * session 2, item 15, 2026-08-19.
 *
 * ## The defect
 *
 * The author, on device: *"'Find your polling place' leaves the app. The
 * 'where to vote' pill on the map does not. The map pill's behaviour is the
 * standard."*
 *
 * Two affordances answering the same question behaved differently on two
 * surfaces of one product, and the one that left was on the BALLOT — the page
 * a reader is on when they are actually working out how to vote.
 *
 * ## And the app already had the answer
 *
 * This is the part that makes it a defect rather than a preference. On 07866
 * the ballot page handed the reader off to New Jersey's polling-place search
 * tool, while `data/voting-sites.json` holds **six voting locations for
 * Rockaway Township**, retrieved, sourced and dated. The reader was being
 * sent away from an answer we already had. Across the covered jurisdictions
 * the file holds 44 jurisdictions and 292 sites.
 *
 * ## What converges, and where the shared path is
 *
 * This is not a second implementation. It renders the SAME
 * `VotingSitesPanel` the map pill renders, backed by the same
 * `/api/voting-sites` route, with the same address-is-orientation copy at the
 * point of typing and the same honest answers per jurisdiction model — "any
 * registered voter may vote at any of these" in Pima, "you are assigned to
 * one of these" in New London. A reader learns one gesture.
 *
 * The panel lifts its pinnable sites so a MAP can draw them; there is no map
 * here, so that callback is a no-op and is deliberately not removed from the
 * shared component — a prop that exists on one caller and not the other is
 * how two implementations start.
 *
 * ## The honest handoff stays, and is labelled as one
 *
 * The state's own tool does not disappear. It renders BELOW the in-app
 * answer, labelled as leaving, for the reader whose jurisdiction we do not
 * yet hold and for the reader who wants the authority's own word. That is
 * item 15's third clause: where a tool genuinely cannot be presented in-app,
 * it is named honestly at the point of the link rather than being silently a
 * different behaviour from its neighbour.
 */
export function WhereToVote({
  fallback,
}: {
  /**
   * The state's own lookup, for the reader we cannot answer in-app.
   *
   * Always rendered, never as a substitute: the in-app panel is the primary
   * answer and this is the authority's own tool beside it, labelled.
   */
  fallback: { label: string; url: string; sourceOrg: string } | null;
}) {
  const [open, setOpen] = useState(false);
  // No map on this surface, so there is nowhere to drop pins. The callback
  // stays because the shared panel's contract does.
  const onSites = useCallback(() => {}, []);

  return (
    <div data-where-to-vote>
      {open ? (
        <VotingSitesPanel
          onSites={onSites}
          selectedSiteId={null}
          onSelectSite={() => {}}
          onClose={() => setOpen(false)}
        />
      ) : (
        <button
          type="button"
          className="voting-open-button"
          data-where-to-vote-pill
          onClick={() => setOpen(true)}
        >
          {/* The map pill's own words, verbatim. Two surfaces asking the same
              question in two different sentences is the same defect one layer
              up from the behaviour. Playful register — interaction surface. */}
          Where can I vote?
        </button>
      )}

      {/*
        **BAL-2 (2026-08-24, the author's ruling) — the sentence is DELETED,
        because the pill above it already IS that.**

        His words: *delete "or search Arizona Secretary of State's own tool" —
        the pill below it is that.* The line offered the state's lookup as a
        second route; the pill opens the same authority's answer in-app, from
        the same retrieved and sourced data, and a second control pointing at
        the same destination is the duplicate-entry friction `CLAUDE.md` counts
        as a defect.

        **`fallback` is NOT removed from the contract.** The prop is still what
        the caller resolves and still what the panel behind the pill falls back
        to for a jurisdiction we do not hold — item 15's honest handoff is
        intact, and it is a behaviour rather than a paragraph. What the author
        struck is the paragraph.
      */}
    </div>
  );
}
