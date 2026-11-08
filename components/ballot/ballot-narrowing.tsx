"use client";

import { useCallback, useEffect, useState } from "react";

import { AddressPrompt } from "@/components/address/address-prompt";

/** Loading the enhancer waits until the existing ballot has painted and accepts input. */
export function afterBallotReady(start: () => void): () => void {
  let stopped = false, queued = false, firstFrame = 0, secondFrame = 0, idle: number | undefined;
  const run = () => { if (!stopped) { performance.mark("ballot-results-ready"); start(); } };
  const check = () => {
    if (stopped || queued || document.readyState !== "complete" || !document.querySelector("article[data-contest-id]")) return;
    const pills = [...document.querySelectorAll<HTMLButtonElement>("[data-battlecard-pill]")];
    const controls = pills.length ? pills : [...document.querySelectorAll<HTMLButtonElement>('[data-kind="pick"] button')];
    if (controls.length && !controls.some(node => !node.disabled && node.getClientRects().length > 0)) return;
    queued = true;
    observer.disconnect();
    window.removeEventListener("load", check);
    firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        if (stopped) return;
        if ("requestIdleCallback" in window) idle = window.requestIdleCallback(run, { timeout: 1_000 });
        else run();
      });
    });
  };
  const observer = new MutationObserver(check);
  observer.observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["disabled"] });
  window.addEventListener("load", check);
  check();
  return () => {
    stopped = true;
    observer.disconnect();
    window.removeEventListener("load", check);
    cancelAnimationFrame(firstFrame);
    cancelAnimationFrame(secondFrame);
    if (idle !== undefined) window.cancelIdleCallback(idle);
  };
}

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
  useEffect(() => {
    const controller = new AbortController();
    let dispose: (() => void) | undefined;
    const cancel = afterBallotReady(() => {
      void import("./deferred-result-enhancer").then(async module => {
        if (controller.signal.aborted) return;
        const cleanup = await module.enhanceBallotResults(controller.signal);
        if (controller.signal.aborted) cleanup();
        else dispose = cleanup;
      }).catch(() => { /* A result-cache failure never removes the ballot. */ });
    });
    return () => { controller.abort(); cancel(); dispose?.(); };
  }, [zip, electionDate]);

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
