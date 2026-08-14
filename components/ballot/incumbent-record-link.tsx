"use client";

import { useState } from "react";

import type { SeatHolder } from "@/lib/officials/lookup";
import type { ReactionViewContext } from "@/lib/reactions/client";
import { OfficialModal } from "@/components/map/popup/official-modal";

/**
 * "See their voting record" on an incumbent's ballot card (4, 2026-08-19):
 * opens the SAME large official surface the map uses — identity, contact,
 * funding, and the roll-call record with reaction capture — so the record
 * a reader sees is one surface, not a fork. The holder arrived from the
 * exact-key incumbent join (lib/ballot/incumbent-record.ts); this
 * component renders only when that join succeeded.
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
      {/* Item 4 (2026-08-14 second session), the tester's exact warning:
          without this line, readers assume the challenger's thinner card
          means the app is broken. Wording is hers, near-verbatim. */}
      <p className="mt-1.5 text-[0.6875rem] leading-relaxed text-muted">
        {holder.name} currently holds this seat, so there&apos;s more
        information about them — that&apos;s not a bias, it&apos;s a record.
      </p>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-1.5 cursor-pointer text-[0.75rem] text-signal underline decoration-dotted hover:no-underline"
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
