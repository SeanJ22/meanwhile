"use client";

import { useState } from "react";

import { AddressPrompt } from "@/components/address/address-prompt";
import { useAddressResolution } from "@/components/address/address-resolution-context";
import {
  BADGE_COPY,
  type JurisdictionBadge,
} from "@/lib/meetings/jurisdiction-badge";

/**
 * **`JUR-2` — the meeting badge stops asserting jurisdiction from a zip, and
 * starts doing something about it.** (2026-08-23, the author's 8/22
 * walkthrough, item 12; tracker `PU04`.)
 *
 * ## What the capture showed
 *
 * The Rockaway Township Municipal Building card, at 07866, with a reader who
 * had given nothing but a zip:
 *
 *   Jurisdiction   [ Governs your area ]
 *                  Your address is inside the area this body governs.
 *
 * The app does not have the reader's address. It has a ZCTA centroid, and
 * `CLAUDE.md`'s first geographic rule is that a zip is orientation only —
 * a ZCTA crosses city, county, school district and legislative boundaries and
 * can never resolve a ballot. 07866 holds Rockaway Township, Rockaway Borough
 * and Denville Township. The card picked one and told the reader it was
 * theirs.
 *
 * ## Three surfaces, one component
 *
 * The badge renders in the meeting popup, the meeting panel and the list
 * overlay. All three read the same resolved division set — that part was
 * always right — and all three now read the same PILL, so the claim and the
 * way out of it cannot drift apart on one of them.
 *
 * ## What clicking it does
 *
 * The same thing `CouldGovernNotice` does on the map panel: opens the one
 * address prompt (WGH-5), street only, and on a resolved answer every
 * jurisdiction on the page re-resolves from the response. The badge module
 * already kept `GOVERNS`, `NEARBY` and `NO_BOUNDARY` apart correctly; what it
 * had no route to was the reader settling which applies to them.
 *
 * ## The other three states are NOT clickable, deliberately
 *
 * `GOVERNS` and `NEARBY` off a resolved address are settled facts and an
 * affordance on them would invite a reader to re-answer a question they have
 * already answered — RULING 74 says an address, once given, is never asked for
 * twice. `NO_BOUNDARY` is a fact about the Census, and no address the reader
 * types will publish a boundary.
 */
export function JurisdictionPill({
  badge,
  zip,
  detail = true,
}: {
  badge: JurisdictionBadge;
  /** The zip on screen. Null disables the affordance — nothing to resolve within. */
  zip: string | null;
  /** Whether to render the one-sentence detail beneath. Off in a dense list row. */
  detail?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { onPoint, onResolved, onCleared } = useAddressResolution();
  const copy = BADGE_COPY[badge];

  if (badge !== "COULD_GOVERN" || zip === null) {
    return (
      <>
        <span className="jurisdiction-badge" data-badge={badge}>
          {copy.label}
        </span>
        {detail && <span className="jurisdiction-detail">{copy.detail}</span>}
      </>
    );
  }

  if (open) {
    return (
      <AddressPrompt
        zip={zip}
        startOpen
        trigger={copy.label}
        className="jurisdiction-prompt"
        /*
         * The point is what makes everything re-resolve: it moves the QUERY
         * point, so the next server response carries a new division set and a
         * new partial set, and every badge on the page — this one included —
         * is recomputed from the answer rather than from anything decided
         * here. The street is passed empty for the same reason
         * `coverage-notice.tsx` passes it empty: the camera key only needs the
         * coordinates, and a street name in a view key is a street name in a
         * place it has no business being.
         */
        onPoint={onPoint ? (pt) => onPoint({ ...pt, street: "" }) : undefined}
        onResolved={(scope) => onResolved?.(scope)}
        onCleared={() => {
          setOpen(false);
          onCleared?.();
        }}
      />
    );
  }

  return (
    <>
      <button
        type="button"
        className="jurisdiction-badge jurisdiction-badge-action"
        data-badge={badge}
        data-could-govern="true"
        onClick={() => setOpen(true)}
      >
        {copy.label}
      </button>
      {detail && <span className="jurisdiction-detail">{copy.detail}</span>}
    </>
  );
}
