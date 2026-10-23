"use client";

import { readerText } from "@/lib/text/reader-names";
import { useState } from "react";

import type { SeatHolder } from "@/lib/officials/lookup";
import type { ReactionViewContext } from "@/lib/reactions/client";
import { OfficialModal } from "@/components/map/popup/official-modal";

/**
 * Opens the same large official surface the map uses. Renders only when the
 * exact-key incumbent join (`lib/ballot/incumbent-record.ts`) succeeded.
 */
export function IncumbentRecordLink({
  holder,
  context,
}: {
  holder: SeatHolder;
  context: ReactionViewContext | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <p className="mt-1.5 t-caption leading-relaxed text-muted">
        {readerText(holder.name, "name")} currently holds this seat, so there&apos;s more
        information about them.
      </p>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-1.5 cursor-pointer t-detail text-signal underline decoration-dotted hover:no-underline"
      >
        See their voting record →
      </button>
      {open && (
        <OfficialModal
          holder={holder}
          seatLabel={null}
          tier="national"
          reactionContext={context}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

/**
 * The candidate's name as the door to their battlecard, only where we hold the
 * record; otherwise plain text.
 */
export function IncumbentNameLink({
  holder,
  name,
  context,
}: {
  holder: SeatHolder;
  /** The name AS FILED, which is what the ballot must show — never the roster's. */
  name: string;
  context: ReactionViewContext | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        data-candidate-card
        onClick={() => setOpen(true)}
        className="cursor-pointer text-left t-heading font-semibold tracking-tight underline decoration-dotted underline-offset-2 hover:text-link hover:decoration-solid"
      >
        {readerText(name, "name")}
      </button>
      {open && (
        <OfficialModal
          holder={holder}
          seatLabel={null}
          tier="national"
          reactionContext={context}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
