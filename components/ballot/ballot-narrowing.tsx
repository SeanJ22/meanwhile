"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { useSessionAddressScope } from "@/hooks/use-session-address";

import { AddressPrompt } from "@/components/address/address-prompt";

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
  const address = useSessionAddressScope(zip);
  const router = useRouter();
  /** How many contests the address set aside. Null means no narrowing applied. */
  const [setAside, setSetAside] = useState<number | null>(null);

  /** Mark the sections. The page renders every contest; this hides some. */
  const applyScope = useCallback((scope: { contestIds: string[]; excludedContestIds: string[] } | null): number => {
    const sections = document.querySelectorAll<HTMLElement>("[data-contest-id]");
    let hidden = 0;
    for (const section of sections) {
      const id = section.dataset.contestId ?? "";
      const out = scope !== null && scope.excludedContestIds.includes(id);
      if (out) {
        section.dataset.scopedOut = "true";
        hidden += 1;
      } else {
        delete section.dataset.scopedOut;
      }
      /* A confirmed contest drops its "could govern" mark; undo restores it. */
      if (scope === null) {
        if (section.dataset.couldGovernParked === "true") {
          section.dataset.couldGovern = "true";
          delete section.dataset.couldGovernParked;
        }
      } else if (scope.contestIds.includes(id) && section.dataset.couldGovern === "true") {
        delete section.dataset.couldGovern;
        section.dataset.couldGovernParked = "true";
      }
    }
    return hidden;
  }, []);

  useEffect(() => {
    const hidden = applyScope(address ? { contestIds: address.contestIds, excludedContestIds: address.excludedContestIds ?? [] } : null);
    const timer = window.setTimeout(() => setSetAside(address ? hidden : null), 0);
    return () => { window.clearTimeout(timer); applyScope(null); };
  }, [address, applyScope]);

  return (
    <>
      {setAside !== null && (
        <div className="ballot-narrowed">
          <p>
            {setAside === 0
              ? "Every contest remains listed. We are still checking any districts we could not settle."
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
          router.push(`/ballot?zip=${other}`);
        }}
      />
    </>
  );
}
