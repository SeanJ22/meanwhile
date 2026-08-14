"use client";

import { X } from "lucide-react";

import type { CoverageSummary } from "@/lib/registry/coverage";
import type { SeatHolder } from "@/lib/officials/lookup";
import type { Meeting } from "@/lib/sources/types";
import { formatMeetingDate } from "@/lib/map/format";

/**
 * The sidebar-count doors (8a, 2026-08-17): tapping a stat number opens the
 * list it counts, as a LARGE surface following the one-at-a-time rule —
 * opening a door closes any other large surface, and rows lead on to the
 * entity popups (an official's card, a meeting's card).
 *
 * Honesty rules carried through: bodies render the division's label when the
 * body's own name is unsourced; a door with nothing behind it says why
 * rather than rendering empty chrome.
 */

export function DoorOverlay({
  door,
  coverage,
  meetings,
  onOpenOfficial,
  onOpenMeeting,
  onClose,
}: {
  door: "bodies" | "districts" | "officials";
  coverage: CoverageSummary | null;
  meetings: Meeting[];
  onOpenOfficial: (
    holder: SeatHolder,
    seatLabel: string | null,
    tier: "local" | "state" | "national",
  ) => void;
  onOpenMeeting: (meeting: Meeting) => void;
  onClose: () => void;
}) {
  const title =
    door === "bodies"
      ? "Bodies here"
      : door === "districts"
        ? "Districts here"
        : "Officials here";

  return (
    <div
      className="pointer-events-auto fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <div
        className="panel max-h-[80vh] w-full max-w-md overflow-y-auto p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-mono text-[0.6875rem] uppercase tracking-[0.2em] text-signal">
            {title}
          </h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="cursor-pointer rounded p-1 text-muted hover:text-paper"
          >
            <X className="size-4" />
          </button>
        </div>

        {!coverage ? (
          <p className="mt-3 text-[0.8125rem] text-muted">
            We couldn&apos;t resolve who governs this point — enter a zip
            first, or the search may have failed.
          </p>
        ) : door === "bodies" ? (
          <BodiesDoor coverage={coverage} meetings={meetings} onOpenMeeting={onOpenMeeting} />
        ) : door === "districts" ? (
          <DistrictsDoor coverage={coverage} onOpenOfficial={onOpenOfficial} />
        ) : (
          <OfficialsDoor coverage={coverage} onOpenOfficial={onOpenOfficial} />
        )}
      </div>
    </div>
  );
}

function BodiesDoor({
  coverage,
  meetings,
  onOpenMeeting,
}: {
  coverage: CoverageSummary;
  meetings: Meeting[];
  onOpenMeeting: (meeting: Meeting) => void;
}) {
  if (coverage.bodies.length === 0) {
    return (
      <p className="mt-3 text-[0.8125rem] text-muted">
        No mapped bodies at this point yet.
      </p>
    );
  }
  return (
    <ul className="mt-3 space-y-2">
      {coverage.bodies.map((body) => {
        const label = body.name ?? body.divisionLabel;
        const next = meetings.find(
          (m) => m.bodyName === body.name && m.status === "SCHEDULED",
        );
        return (
          <li
            key={body.bodyId}
            className="border-b border-[var(--panel-border)] pb-2 last:border-0"
          >
            <div className="flex items-baseline justify-between gap-3">
              {body.homepageUrl ? (
                <a
                  href={body.homepageUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[0.8125rem] underline decoration-dotted hover:text-signal"
                >
                  {label}
                </a>
              ) : (
                <span className="text-[0.8125rem]">{label}</span>
              )}
              <span className="shrink-0 font-mono text-[0.5625rem] uppercase tracking-[0.15em] text-muted">
                {body.bodyClass === "GOVERNING" ? "Governing" : "Advisory"}
              </span>
            </div>
            {next && (
              <button
                type="button"
                onClick={() => onOpenMeeting(next)}
                className="mt-0.5 cursor-pointer text-[0.75rem] text-signal underline decoration-dotted"
              >
                Next meeting: {formatMeetingDate(next)} →
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function DistrictsDoor({
  coverage,
  onOpenOfficial,
}: {
  coverage: CoverageSummary;
  onOpenOfficial: (
    holder: SeatHolder,
    seatLabel: string | null,
    tier: "local" | "state" | "national",
  ) => void;
}) {
  if (coverage.seats.length === 0) {
    return (
      <p className="mt-3 text-[0.8125rem] text-muted">
        No districts resolved at this point yet.
      </p>
    );
  }
  return (
    <ul className="mt-3 space-y-2">
      {coverage.seats.map((seat) => (
        <li
          key={seat.label}
          className="border-b border-[var(--panel-border)] pb-2 last:border-0"
        >
          <p className="text-[0.8125rem]">{seat.label}</p>
          {seat.representatives.length > 0 ? (
            seat.representatives.map((holder) => (
              <button
                key={holder.id}
                type="button"
                onClick={() =>
                  onOpenOfficial(
                    holder,
                    seat.label,
                    seat.label.toLowerCase().includes("state") ? "state" : "national",
                  )
                }
                className="mt-0.5 mr-3 cursor-pointer text-[0.75rem] text-signal underline decoration-dotted"
              >
                {holder.name} →
              </button>
            ))
          ) : (
            <p className="mt-0.5 text-[0.6875rem] text-muted">
              No sourced officeholder on file yet.
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

function OfficialsDoor({
  coverage,
  onOpenOfficial,
}: {
  coverage: CoverageSummary;
  onOpenOfficial: (
    holder: SeatHolder,
    seatLabel: string | null,
    tier: "local" | "state" | "national",
  ) => void;
}) {
  const seen = new Set<string>();
  const rows: { holder: SeatHolder; seatLabel: string | null; tier: "state" | "national" }[] = [];
  for (const senator of coverage.senators) {
    if (!seen.has(senator.id)) {
      seen.add(senator.id);
      rows.push({ holder: senator, seatLabel: "U.S. Senator", tier: "national" });
    }
  }
  for (const seat of coverage.seats) {
    for (const holder of seat.representatives) {
      if (!seen.has(holder.id)) {
        seen.add(holder.id);
        rows.push({
          holder,
          seatLabel: seat.label,
          tier: seat.label.toLowerCase().includes("state") ? "state" : "national",
        });
      }
    }
  }
  if (rows.length === 0) {
    return (
      <p className="mt-3 text-[0.8125rem] text-muted">
        No sourced officeholders resolved at this point yet.
      </p>
    );
  }
  return (
    <ul className="mt-3 space-y-1.5">
      {rows.map(({ holder, seatLabel, tier }) => (
        <li key={holder.id} className="flex items-baseline justify-between gap-3">
          <button
            type="button"
            onClick={() => onOpenOfficial(holder, seatLabel, tier)}
            className="cursor-pointer text-[0.8125rem] text-signal underline decoration-dotted"
          >
            {holder.name} →
          </button>
          <span className="shrink-0 text-right text-[0.6875rem] text-muted">
            {seatLabel}
          </span>
        </li>
      ))}
    </ul>
  );
}
