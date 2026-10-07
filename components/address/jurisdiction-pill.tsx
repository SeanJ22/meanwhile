"use client";

import { useState } from "react";

import { AddressPrompt } from "@/components/address/address-prompt";
import { useAddressResolution } from "@/components/address/address-resolution-context";
import {
  badgeCopyFor,
  type JurisdictionBadge,
} from "@/lib/meetings/jurisdiction-badge";
import type { BodyClass } from "@/lib/registry/types";

/**
 * The meeting badge's jurisdiction pill, shared by the meeting popup, panel and
 * list overlay. Only `COULD_GOVERN` is clickable: it opens the address prompt;
 * every other badge is settled and inert.
 */
export function JurisdictionPill({
  badge,
  zip,
  detail = true,
  bodyClass = null,
}: {
  badge: JurisdictionBadge;
  /** The body's class, which words `NOT_GOVERNING`. */
  bodyClass?: BodyClass | null;
  /** The zip on screen. Null disables the affordance — nothing to resolve within. */
  zip: string | null;
  /** Whether to render the one-sentence detail beneath. Off in a dense list row. */
  detail?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { onPoint, onResolved, onCleared } = useAddressResolution();
  const copy = badgeCopyFor(badge, bodyClass);

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
        className="jurisdiction-prompt"
        /* The street is passed empty: the camera key only needs coordinates. */
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
