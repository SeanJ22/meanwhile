"use client";

import { useCallback, useState } from "react";

import { AddressPrompt } from "@/components/address/address-prompt";
import { applyBallotContestScope } from "@/lib/ballot/contest-visibility";

/**
 * Marks ballot contests outside the reader's confirmed divisions as
 * `data-scoped-out` (hidden by the stylesheet) and shows how many were set
 * aside with a way back. Only confirmed divisions narrow; a split level
 * contributes nothing until the reader settles it.
 */
export function BallotNarrowing({
  zip,
  /** The class for the trigger pill; never applied to the open form. */
  className = "mt-2",
}: {
  zip: string;
  className?: string;
}) {
  /** How many contests the address set aside. Null means no narrowing applied. */
  const [setAside, setSetAside] = useState<number | null>(null);
  const [ballotUnavailable, setBallotUnavailable] = useState(false);

  /** Mark the sections. The page renders every contest; this hides some. */
  const applyScope = useCallback((contestIds: string[] | null): number => {
    return applyBallotContestScope(document.querySelectorAll<HTMLElement>("[data-contest-id]"), contestIds);
  }, []);

  return (
    <>
      {ballotUnavailable && <p>We couldn&apos;t check the ballot for that address. Everything below stays listed.</p>}
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
        triggerClassName={className}
        /* An address that resolves in another zip is offered, never taken. */
        onSwitchZip={(other) => {
          window.location.href = `/ballot?zip=${other}`;
        }}
        onResolved={({ contestIds, ballotStatus }) => {
          const held = ballotStatus === "HELD" && contestIds.length > 0;
          const count = applyScope(held ? contestIds : null);
          setSetAside(held ? count : null);
          setBallotUnavailable(ballotStatus !== "HELD");
        }}
        onCleared={() => {
          applyScope(null);
          setSetAside(null);
          setBallotUnavailable(false);
        }}
      />
    </>
  );
}
