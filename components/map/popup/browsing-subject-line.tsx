"use client";

import { useResolvedLocation } from "@/hooks/use-resolved-location";
import { browsingSubject } from "@/lib/state/resolved-location";

/**
 * Names the district card's subject and, where the reader's address can
 * settle it, how their home stands relative to it: `CONFIRMED` (inside),
 * `ELSEWHERE_IN_ZIP` (their address named another district at an exclusive
 * level), `OVERLAP_NOT_RULED_OUT` (another district at a level that can
 * overlap) or `UNSETTLED`. Exclusivity comes from
 * `lib/state/division-levels.ts`. Reads a `BROWSING` location, so it never
 * writes the home store.
 */
export function BrowsingSubjectLine({
  label,
  homeZip,
  ocdId,
}: {
  /** The district on screen, in the reader's words. Never an OCD-ID. */
  label: string;
  /** The zip the reader told us about, if any. */
  homeZip: string | null;
  /** The subject division, for the standing comparison. */
  ocdId: string | null;
}) {
  const home = useResolvedLocation(homeZip);
  const subject = browsingSubject(home, ocdId);

  return (
    <p
      data-browsing-standing={subject.standing}
      className="mt-1 t-caption leading-relaxed text-muted"
    >
      {subject.standing === "CONFIRMED" ? (
        <>You&apos;re looking at {label} — the one your address is in.</>
      ) : subject.standing === "ELSEWHERE_IN_ZIP" ? (
        <>
          You&apos;re looking at {label}. Your address is in a different one —
          this is here because you tapped it, not because it governs you.
        </>
      ) : subject.standing === "OVERLAP_NOT_RULED_OUT" ? (
        /*
         * Their address named a different district of this kind, and this kind
         * can overlap. Nothing tested this boundary against their point, so the
         * line claims neither "not yours" nor "also yours".
         */
        <>
          You&apos;re looking at {label}. Your address is in a different one of
          these — and areas like this can overlap, so this one may cover you as
          well.
        </>
      ) : (
        // Never "this is not your district": nothing has settled that.
        <>You&apos;re looking at {label}. This card is about that district.</>
      )}
    </p>
  );
}
