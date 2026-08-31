"use client";

import { useCallback, useState } from "react";

import { AddressPrompt } from "@/components/address/address-prompt";

/**
 * "Show me my actual ballot" (item 2, 2026-08-15) — **rebuilt onto the one
 * address component** (WGH-4, 2026-08-22, the author's 8/22 walkthrough).
 *
 * ## What changed and why it had to
 *
 * This file used to carry its own address form: two side-by-side inputs, a
 * house number that was REQUIRED (`"A house number and a street, please."`),
 * and its own copy of the promise. The map's narrowing chip carried a second
 * implementation of the same feature which promised, in as many words, that no
 * house or apartment number was ever needed.
 *
 * Two implementations of one feature that contradict each other about the
 * central thing in it is not a styling inconsistency. A reader who saw both
 * saw the product not knowing its own mind. **There is now one component, one
 * resolver, one promise** — `components/address/address-prompt.tsx` — and this
 * file is what remains: the page-specific part, which is marking contests.
 *
 * ## What this still owns
 *
 * Nothing is deleted from the page. Contests outside the reader's confirmed
 * divisions are marked `data-scoped-out` and hidden by the stylesheet, and the
 * banner says how many were set aside with a one-tap way back. Hiding rows
 * silently is how a reader ends up believing a contest does not exist, and this
 * feature would otherwise be a very good way to make a ballot look shorter than
 * it is.
 *
 * **Contests are narrowed on CONFIRMED divisions only.** A level the reader's
 * street genuinely crosses contributes nothing until they settle it — narrowing
 * on a jurisdiction we are unsure of would hide contests they may actually vote
 * in.
 */
export function BallotNarrowing({
  zip,
  /**
   * BAL-11 (2026-08-25): the class the page wants on the TRIGGER, so the
   * narrowing renders as one of the ballot pills rather than as an underlined
   * link beside two of them. Passed down rather than set here — where this
   * control sits, and therefore what it should look like, is the page's
   * decision and not this component's.
   */
  className = "mt-2",
}: {
  zip: string;
  className?: string;
}) {
  /** How many contests the address set aside. Null means no narrowing applied. */
  const [setAside, setSetAside] = useState<number | null>(null);

  /** Mark the sections. The page renders every contest; this hides some. */
  const applyScope = useCallback((contestIds: string[] | null): number => {
    const sections = document.querySelectorAll<HTMLElement>("[data-contest-id]");
    let hidden = 0;
    for (const section of sections) {
      const id = section.dataset.contestId ?? "";
      const out = contestIds !== null && !contestIds.includes(id);
      if (out) {
        section.dataset.scopedOut = "true";
        hidden += 1;
      } else {
        delete section.dataset.scopedOut;
      }
      /*
       * RULING 71 + RULING 74. A contest the address CONFIRMS no longer says
       * "could govern you" — the reader has settled it, and repeating the
       * question after it has been answered is the product not paying
       * attention. Restored on undo, because "show the whole zip again" puts
       * the reader back where the question is open.
       */
      if (contestIds === null) {
        if (section.dataset.couldGovernParked === "true") {
          section.dataset.couldGovern = "true";
          delete section.dataset.couldGovernParked;
        }
      } else if (!out && section.dataset.couldGovern === "true") {
        delete section.dataset.couldGovern;
        section.dataset.couldGovernParked = "true";
      }
    }
    return hidden;
  }, []);

  return (
    <>
      {setAside !== null && (
        <div className="ballot-narrowed">
          <p>
            {setAside === 0
              ? "Every contest below is on the ballot at that address."
              : `Narrowed to that address — ${setAside} ${
                  setAside === 1 ? "contest" : "contests"
                } elsewhere in ${zip} ${setAside === 1 ? "is" : "are"} hidden.`}
          </p>
        </div>
      )}
      <AddressPrompt
        zip={zip}
        trigger="Narrow this to where you live"
        /*
         * **BAL-23 (2026-08-25): the pill class places the COLLAPSED CONTROL
         * and never the open form.** It arrives here as `ballot-top-pill`,
         * which is `display: inline-flex; min-height: 40px; border-radius:
         * 999px` — right for a chip, ruinous for a three-block form. Passed as
         * `className` it reached both, and the author's `17-44-49` is the
         * result: the ask wrapped one word per line, the promise overflowed to
         * the right, and the form fought the sibling pill for the same flex
         * row. See the prop's own note in `address-prompt.tsx`.
         */
        triggerClassName={className}
        /*
         * BAL-38 (2026-08-31): an address that resolves in a DIFFERENT zip is
         * offered, never taken. A reader looking at one zip's ballot who is
         * silently moved to another has had their question changed for them,
         * so this is a full navigation the reader asks for by tapping.
         */
        onSwitchZip={(other) => {
          window.location.href = `/ballot?zip=${other}`;
        }}
        onResolved={({ contestIds }) => {
          // An empty confirmed list is a real answer and must not read as a
          // failure: the reader's street resolved nothing we hold a ballot for,
          // so the whole zip stays visible rather than the page going blank.
          setSetAside(contestIds.length > 0 ? applyScope(contestIds) : null);
        }}
        onCleared={() => {
          applyScope(null);
          setSetAside(null);
        }}
      />
    </>
  );
}
