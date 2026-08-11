"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { isWellFormedZip, resolveZip } from "@/lib/geo/zcta";

import { ZipComb } from "./zip-comb";

/**
 * The first thing anyone sees: a notice posted over the map.
 *
 * It asks for one thing and explains, right there, what that one thing can and
 * cannot do. Zip orients the map. It cannot resolve a ballot, and saying so
 * here is cheaper than un-teaching it later.
 */

const MESSAGES = {
  malformed: "A zip code is five digits.",
  unknown: "No such zip code. Check the digits.",
  uncovered:
    "That zip isn't in our local copy of the Census zip list yet. Try a nearby one.",
} as const;

interface EntryNoticeProps {
  onResolved: (zip: string, lat: number, lng: number) => void;
}

export function EntryNotice({ onResolved }: EntryNoticeProps) {
  const [zip, setZip] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit() {
    const result = resolveZip(zip);

    if (!result.ok) {
      setError(MESSAGES[result.reason]);
      return;
    }

    setError(null);
    onResolved(result.centroid.zip, result.centroid.lat, result.centroid.lng);
  }

  return (
    <div className="pointer-events-auto w-full max-w-lg">
      <div className="panel px-6 py-7 sm:px-9 sm:py-10">
        <p className="notice-eyebrow">Notice of public meetings</p>
        <div className="notice-rule mt-3" />

        <h1 className="display-wide mt-7 text-3xl font-semibold leading-[1.1] text-paper sm:text-[2.6rem]">
          Your government
          <br />
          meets in public.
        </h1>

        <p className="mt-4 max-w-md text-[0.95rem] leading-relaxed text-paper-dim">
          Councils, boards, and commissions decide what happens on your street,
          in rooms anyone can walk into. Enter a zip code to see which ones are
          meeting near you.
        </p>

        <div className="mt-8">
          <p className="mb-2.5 font-mono text-[0.6875rem] uppercase tracking-[0.18em] text-muted">
            Zip code
          </p>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
            <div className="flex-1">
              <ZipComb
                value={zip}
                onChange={(next) => {
                  setZip(next);
                  if (error) setError(null);
                }}
                onSubmit={submit}
                invalid={Boolean(error)}
                describedBy={error ? "zip-error" : "zip-help"}
                autoFocus
              />
            </div>

            <Button
              onClick={submit}
              disabled={!isWellFormedZip(zip)}
              className="h-14 shrink-0 sm:h-16 sm:px-7"
            >
              Show meetings
            </Button>
          </div>

          <p
            id="zip-error"
            role="alert"
            className="mt-3 min-h-5 text-sm text-signal"
          >
            {error ?? ""}
          </p>
        </div>

        <div className="mt-5 border-t border-rule-soft pt-5">
          <p id="zip-help" className="text-[0.8125rem] leading-relaxed text-muted">
            A zip code points the map somewhere. It can&apos;t tell us your
            districts — zip boundaries run straight through cities, counties,
            and school districts. If you later want the ballot you personally
            vote, we&apos;ll ask for a street address and explain why then.
          </p>
        </div>
      </div>
    </div>
  );
}
