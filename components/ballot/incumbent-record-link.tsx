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
          means the app is broken. Wording is hers, near-verbatim.

          RULE 4g (2026-08-17, the author): the line ends at "them". It used
          to continue "— that's not a bias, it's a record", and the author's
          model is the one-line disclosure at the foot of a Claude chat:
          short, plain, carrying weight without arguing its own case. The
          trailing clause defended against an objection nobody had raised,
          and a disclosure that argues with the reader weakens the neutrality
          it is asserting. State the fact and stop. */}
      <p className="mt-1.5 t-caption leading-relaxed text-muted">
        {holder.name} currently holds this seat, so there&apos;s more
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
 * The candidate's NAME as the door to their large battlecard — g3 item 7
 * (2026-08-16), the click grammar from g2 item 3 applied to the ballot.
 *
 * On the map, a person's name opens their card. On the ballot page a name was
 * inert text with a separate "See their voting record →" link underneath it,
 * so the same reader learned two different grammars for the same gesture on
 * two surfaces of one product. Now the name is the door on both.
 *
 * **It renders as a link only where we actually hold the record.** The
 * incumbent join is exact-key (`lib/ballot/incumbent-record.ts`); a
 * challenger's name stays plain text rather than becoming a link to an empty
 * card, because a door onto nothing is worse than no door. That asymmetry is
 * real and is already named on the card in the sentence above the record
 * link — "there's more information about them" — which is the equal-effort
 * rule's answer to it: the difference is disclosed, not disguised. (The
 * sentence used to go on to argue the point; rule 4g cut it, and the
 * disclosure is the same disclosure without the argument.)
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
        {name}
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
