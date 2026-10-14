"use client";

import { useCallback, useState } from "react";

import { AddressPrompt } from "@/components/address/address-prompt";

export function BallotNarrowing({
  zip,
  electionDate,
  /** The class for the trigger pill; never applied to the open form. */
  className = "mt-2",
}: {
  zip: string;
  electionDate: string | null;
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
      /* A confirmed contest drops its "could govern" mark; undo restores it. */
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
        selection={electionDate ? { purpose: "election", asOf: new Date().toISOString().slice(0, 10), electionDate } : undefined}
        trigger="Narrow this to where you live"
        triggerClassName={className}
        /* An address that resolves in another zip is offered, never taken. */
        onSwitchZip={(other) => {
          window.location.href = `/ballot?zip=${other}`;
        }}
        onResolved={({ contestIds }) => {
          // An empty confirmed list keeps the whole zip visible.
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
