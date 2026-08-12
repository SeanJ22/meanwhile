"use client";

import { formatMiles } from "@/lib/map/format";
import type { CoverageTier } from "@/lib/meetings/query";
import type { CoverageSummary, CoveredBody, Seat } from "@/lib/registry/coverage";

/**
 * Says which rung of the cascade produced what's on screen, and — when there is
 * nothing on screen — who governs here anyway.
 *
 * Two failures, one component. A search that quietly widened its radius, or
 * quietly reached into last month, looks exactly like one that found what you
 * asked for. And an empty map reads as "your government does nothing" when the
 * truth is "we have no source for the bodies that govern here". Both are the
 * same bug: an answer that does not say what kind of answer it is.
 *
 * **Nothing here presents a derived body as a sourced fact.** Division labels
 * come off the Census boundary files, so they are sourced and safe to print. The
 * bodies' own names, schedules and members are all unknown, and the copy is
 * written to claim only what the registry actually knows: that a division of
 * this type exists here, and that a division of this type has a governing body.
 */

interface CoverageNoticeProps {
  tier: CoverageTier;
  zip: string;
  radiusKm: number;
  requestedRadiusKm: number;
  count: number;
  coverage: CoverageSummary | null;
}

/** How many bodies to name before collapsing the rest into a count. */
const NAME_LIMIT = 5;

const DIVISION_NOUN: Record<CoveredBody["divisionType"], string> = {
  county: "County",
  place: "Municipal",
  school_district: "School district",
  cd: "Congressional",
  sldu: "State senate",
  sldl: "State house",
};

const TIER_CLASS: Record<CoveredBody["tier"], string> = {
  local: "text-local",
  state: "text-state",
  national: "text-national",
};

function seatPhrase(seats: Seat[]): string | null {
  if (seats.length === 0) return null;
  // Census labels already read as seats — "State Senate District 18", "AZ-6" —
  // so they need no noun bolted on, which also sidesteps naming a chamber whose
  // title varies by state.
  const labels = seats.map((s) => s.label);
  if (labels.length === 1) return labels[0];
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

/**
 * The four states of 4.6.6, in the reader's words.
 *
 * The third row is the one that matters and the one that was missing: a body is
 * known to exist and nothing has its calendar. Saying "no meetings" there is
 * false — it describes us, not them.
 */
function CoverageBody({ zip, coverage }: { zip: string; coverage: CoverageSummary }) {
  const { bodies, seats, unincorporated, counts } = coverage;
  const shown = bodies.slice(0, NAME_LIMIT);
  const hidden = bodies.length - shown.length;
  const seatLine = seatPhrase(seats);

  const lead =
    coverage.state === "UNMAPPED" ? (
      <>
        We haven&apos;t mapped the governing bodies covering {zip} yet. That is a
        gap in our data, not a gap in your government.
      </>
    ) : coverage.state === "NONE_SCHEDULED" ? (
      <>
        Nothing is scheduled for the{" "}
        {counts.total === 1 ? "body" : `${counts.total} bodies`} covering {zip}.
      </>
    ) : coverage.state === "MEETINGS" ? (
      // Meetings are on screen, but not from these bodies' calendars, because
      // none of them has one. Deliberately says nothing about whether what is
      // shown belongs to them — it says what we are missing, which is the part
      // we can stand behind.
      <>
        We don&apos;t have {counts.withoutSource === 1 ? "a calendar" : "calendars"}{" "}
        for the{" "}
        {counts.withoutSource === 1 ? "body" : `${counts.withoutSource} bodies`}{" "}
        that govern the area around {zip}.
      </>
    ) : (
      <>
        {counts.total === 1
          ? "One body governs"
          : `${counts.total} bodies govern`}{" "}
        the area around {zip}
        {counts.withoutSource === counts.total
          ? counts.total === 1
            ? ", and we don't have its calendar yet"
            : ", and we don't have their calendars yet"
          : `, and we're missing ${counts.withoutSource} of their calendars`}
        .
      </>
    );

  return (
    <>
      {unincorporated && (
        <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-paper-dim">
          <span className="text-signal">No city or town government</span> — this
          area is unincorporated.
        </p>
      )}

      <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-paper-dim">
        {lead}
      </p>

      {shown.length > 0 && (
        <ul className="mt-2.5 space-y-1">
          {shown.map((body) => (
            <li
              key={body.bodyId}
              className="flex items-baseline justify-between gap-3 border-b border-[var(--panel-border)] pb-1 last:border-0"
            >
              <span className="text-[0.8125rem] leading-snug">
                {body.divisionLabel}
              </span>
              <span
                className={`shrink-0 font-mono text-[0.5625rem] uppercase tracking-[0.15em] ${TIER_CLASS[body.tier]}`}
              >
                {DIVISION_NOUN[body.divisionType]}
              </span>
            </li>
          ))}
          {hidden > 0 && (
            <li className="pt-0.5 text-[0.75rem] text-muted">
              and {hidden} more
            </li>
          )}
        </ul>
      )}

      {seatLine && (
        <p className="mt-2.5 text-[0.75rem] leading-relaxed text-muted">
          You&apos;re also represented in {seatLine}.
        </p>
      )}

      {counts.withoutSource > 0 && (
        // The honest footnote. The registry knows these divisions exist and that
        // divisions of their type have governing bodies; it does not know those
        // bodies' names, schedules or members, and must not imply otherwise.
        <p className="mt-2.5 text-[0.6875rem] leading-relaxed text-muted">
          We know these bodies exist because the district boundaries do. We
          haven&apos;t sourced their names or meeting schedules yet.
        </p>
      )}
    </>
  );
}

export function CoverageNotice({
  tier,
  zip,
  radiusKm,
  requestedRadiusKm,
  count,
  coverage,
}: CoverageNoticeProps) {
  if (tier === "exact") return null;

  const near = formatMiles(requestedRadiusKm);
  const wide = formatMiles(radiusKm);

  const isEmpty = tier === "none";

  // Show the coverage block whenever it has something true to add: an empty map
  // always, and a widened or concluded one when bodies that govern here have no
  // calendar wired. Staying silent when every body is covered keeps the notice
  // about what is missing rather than restating what is already on screen.
  const showCoverage =
    !!coverage &&
    (isEmpty || coverage.state === "UNMAPPED" || coverage.counts.withoutSource > 0);

  const label = isEmpty
    ? coverage?.state === "UNMAPPED"
      ? "Not mapped yet"
      : coverage
        ? "Coverage gap"
        : "No coverage yet"
    : tier === "widened"
      ? "Radius widened"
      : "Recently concluded";

  const accent = tier === "concluded" ? "text-concluded" : "text-signal";

  return (
    <div className="panel pointer-events-auto max-w-md px-4 py-3.5">
      <p
        className={`font-mono text-[0.625rem] uppercase tracking-[0.2em] ${accent}`}
      >
        {label}
      </p>

      {tier === "widened" && (
        <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-paper-dim">
          Nothing scheduled within {near} miles of {zip}. Showing the{" "}
          {count === 1 ? "one meeting" : `${count} meetings`} within {wide}{" "}
          miles.
        </p>
      )}

      {tier === "concluded" && (
        <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-paper-dim">
          No upcoming meetings within {wide} miles of {zip}. These already
          happened — the agendas still show what was decided.
        </p>
      )}

      {/*
        The coverage block rides *alongside* the cascade's explanation rather
        than replacing it, because the widened rung is where it matters most: a
        reader in Vail is shown fourteen meetings from thirty-seven miles away,
        none of which are their government. Saying which bodies actually govern
        there — and that we hold no calendar for them — is the difference
        between a helpful answer and a misleading one.
      */}
      {coverage && showCoverage ? (
        <CoverageBody zip={zip} coverage={coverage} />
      ) : (
        !coverage &&
        isEmpty && (
          // The registry could not be read. Fall back to what the cascade alone
          // knows rather than inventing a coverage claim.
          <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-paper-dim">
            No meetings on file near {zip} yet. We&apos;re still adding
            jurisdictions, starting with the ones that publish machine-readable
            agendas.
          </p>
        )
      )}
    </div>
  );
}
