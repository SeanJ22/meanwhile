"use client";

import { formatMiles } from "@/lib/map/format";
import type { CoverageTier } from "@/lib/meetings/query";

/**
 * Says which rung of the cascade produced what's on screen.
 *
 * A search that quietly widened its radius, or quietly reached into last month,
 * looks exactly like one that found what you asked for. This is the difference.
 */

interface CoverageNoticeProps {
  tier: CoverageTier;
  zip: string;
  radiusKm: number;
  requestedRadiusKm: number;
  count: number;
}

export function CoverageNotice({
  tier,
  zip,
  radiusKm,
  requestedRadiusKm,
  count,
}: CoverageNoticeProps) {
  if (tier === "exact") return null;

  const near = formatMiles(requestedRadiusKm);
  const wide = formatMiles(radiusKm);

  const body =
    tier === "widened" ? (
      <>
        Nothing scheduled within {near} miles of {zip}. Showing the{" "}
        {count === 1 ? "one meeting" : `${count} meetings`} within {wide} miles.
      </>
    ) : tier === "concluded" ? (
      <>
        No upcoming meetings within {wide} miles of {zip}. These already
        happened — the agendas still show what was decided.
      </>
    ) : (
      <>
        No meetings on file near {zip} yet. We&apos;re still adding
        jurisdictions, starting with the ones that publish machine-readable
        agendas.
      </>
    );

  const label =
    tier === "widened"
      ? "Radius widened"
      : tier === "concluded"
        ? "Recently concluded"
        : "No coverage yet";

  const accent = tier === "concluded" ? "text-concluded" : "text-signal";

  return (
    <div className="panel pointer-events-auto max-w-md px-4 py-3.5">
      <p
        className={`font-mono text-[0.625rem] uppercase tracking-[0.2em] ${accent}`}
      >
        {label}
      </p>
      <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-paper-dim">
        {body}
      </p>
    </div>
  );
}
