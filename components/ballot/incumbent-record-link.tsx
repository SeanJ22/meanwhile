"use client";

import { useState } from "react";

import type { SeatHolder } from "@/lib/officials/lookup";
import type { ReactionViewContext } from "@/lib/reactions/client";
import { OfficialModal } from "@/components/map/popup/official-modal";
import { CardSourceContext } from "@/components/ui/card-source-context";
import { CardGapContext } from "@/components/ui/card-gap-context";

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
        {name}
      </button>
      {open && (
        <CardSourceContext.Provider value={null}><CardGapContext.Provider value={null}><OfficialModal
          holder={holder}
          seatLabel={null}
          tier="national"
          reactionContext={context}
          onClose={() => setOpen(false)}
        /></CardGapContext.Provider></CardSourceContext.Provider>
      )}
    </>
  );
}
