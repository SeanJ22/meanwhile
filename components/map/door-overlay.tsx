"use client";

import { X } from "lucide-react";

import type { CoverageSummary } from "@/lib/registry/coverage";
import type { SeatHolder } from "@/lib/officials/lookup";
import type { Meeting } from "@/lib/sources/types";
import type { DrawnDistrict } from "@/lib/map/districts";
import { districtDoorRows } from "@/lib/state/derive";
import {
  groupOfficials,
  TIER_GROUP_LABELS,
  type TierGroup,
} from "@/lib/officials/tier-grouping";
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
  drawnDistricts,
  districtOverlayOn,
  onShowDistricts,
  onOpenOfficial,
  onOpenMeeting,
  onClose,
}: {
  door: "bodies" | "districts" | "officials";
  coverage: CoverageSummary | null;
  meetings: Meeting[];
  /** The districts the map is drawing — the same list the stat card
   *  counts, rendered row for row (3g). */
  drawnDistricts: DrawnDistrict[];
  /** Whether the overlay is on — off means the card said "Off", and the
   *  door explains rather than rendering an empty list. */
  districtOverlayOn: boolean;
  /** Turns the overlay on from inside the door (M57). Sending the reader
   *  to hunt for a checkbox in the sidebar was a hidden entry point. */
  onShowDistricts: () => void;
  onOpenOfficial: (
    holder: SeatHolder,
    seatLabel: string | null,
    tier: "local" | "state" | "national",
  ) => void;
  onOpenMeeting: (meeting: Meeting) => void;
  onClose: () => void;
}) {
  // "Districts in view", not "here": this list is what the map is drawing
  // across the whole viewport, so at 85701 it holds Marana and Oro Valley —
  // districts the reader is emphatically not in. The other two doors ARE
  // "here": they come from the coverage summary for the reader's point.
  const title =
    door === "bodies"
      ? "Bodies here"
      : door === "districts"
        ? "Districts in view"
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

        {door === "districts" ? (
          // 3g: this door lists the districts the card counted — the same
          // list, not a different universe. It renders even with no
          // coverage; the drawn overlay is client-side and honest alone.
          <DistrictsDoor
            drawnDistricts={drawnDistricts}
            districtOverlayOn={districtOverlayOn}
            onShowDistricts={onShowDistricts}
            coverage={coverage}
            onOpenOfficial={onOpenOfficial}
          />
        ) : !coverage ? (
          <p className="mt-3 text-[0.8125rem] text-muted">
            We couldn&apos;t resolve who governs this point — enter a zip
            first, or the search may have failed.
          </p>
        ) : door === "bodies" ? (
          <BodiesDoor coverage={coverage} meetings={meetings} onOpenMeeting={onOpenMeeting} />
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
  drawnDistricts,
  districtOverlayOn,
  onShowDistricts,
  coverage,
  onOpenOfficial,
}: {
  drawnDistricts: DrawnDistrict[];
  districtOverlayOn: boolean;
  onShowDistricts: () => void;
  coverage: CoverageSummary | null;
  onOpenOfficial: (
    holder: SeatHolder,
    seatLabel: string | null,
    tier: "local" | "state" | "national",
  ) => void;
}) {
  if (!districtOverlayOn) {
    // M57: the switch is here, not somewhere the reader has to go find.
    return (
      <div className="mt-3">
        <p className="text-[0.8125rem] text-muted">
          District boundaries are switched off, so none are drawn and there
          is nothing to count.
        </p>
        <button
          type="button"
          onClick={onShowDistricts}
          className="mt-2 cursor-pointer rounded border border-[var(--panel-border)] px-3 py-1.5 text-[0.8125rem] text-paper hover:border-paper"
        >
          Show district boundaries
        </button>
      </div>
    );
  }
  if (drawnDistricts.length === 0) {
    return (
      <p className="mt-3 text-[0.8125rem] text-muted">
        No district boundaries are drawn in this view yet.
      </p>
    );
  }
  // 3g: EXACTLY one row per drawn district — the count the card stated.
  const rows = districtDoorRows(drawnDistricts, coverage?.seats ?? []);
  return (
    <ul className="mt-3 space-y-2">
      {rows.map((row) => (
        <li
          key={row.ocdId}
          className="border-b border-[var(--panel-border)] pb-2 last:border-0"
        >
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-[0.8125rem]">{row.label}</p>
            <span className="shrink-0 font-mono text-[0.5625rem] uppercase tracking-[0.15em] text-muted">
              {row.typeLabel}
            </span>
          </div>
          {row.holders.map((holder) => (
            <button
              key={holder.id}
              type="button"
              onClick={() =>
                onOpenOfficial(
                  holder,
                  row.label,
                  row.tier === "local" ? "local" : row.tier,
                )
              }
              className="mt-0.5 mr-3 cursor-pointer text-[0.75rem] text-signal underline decoration-dotted"
            >
              {holder.name} →
            </button>
          ))}
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
  // Item 2c (2026-08-14 second session): one derivation for every
  // officials surface, grouped Local / State / Federal, closest-first —
  // the list must not open with the names people already know. The flat
  // mixed list (senators first, no locals at all) was the defect.
  const groups = groupOfficials(coverage);
  const total = groups.local.length + groups.state.length + groups.federal.length;
  if (total === 0) {
    return (
      <p className="mt-3 text-[0.8125rem] text-muted">
        No sourced officeholders resolved at this point yet.
      </p>
    );
  }
  const TIER_HEADER_CLASS: Record<TierGroup, string> = {
    local: "text-local",
    state: "text-state",
    federal: "text-national",
  };
  return (
    <div className="mt-3 space-y-3">
      {(Object.keys(TIER_GROUP_LABELS) as TierGroup[]).map((group) =>
        groups[group].length === 0 ? null : (
          <div key={group}>
            <p
              className={`font-mono text-[0.5625rem] uppercase tracking-[0.15em] ${TIER_HEADER_CLASS[group]}`}
            >
              {TIER_GROUP_LABELS[group]}
            </p>
            <ul className="mt-1 space-y-1.5">
              {groups[group].map(({ holder, seatLabel, tier }) => (
                <li
                  key={holder.id}
                  className="flex items-baseline justify-between gap-3"
                >
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
          </div>
        ),
      )}
    </div>
  );
}
