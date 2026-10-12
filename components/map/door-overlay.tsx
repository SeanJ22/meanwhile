"use client";

import { MeetingRow } from "@/components/ui/meeting-row";
import { X } from "lucide-react";
import { createContext, useContext } from "react";

import type { CoverageSummary, CoveredBody } from "@/lib/registry/coverage";
import { bodyClassShort } from "@/lib/registry/body-class-labels";
import type { SeatHolder } from "@/lib/officials/lookup";
import type { Meeting } from "@/lib/sources/types";
import {
  districtsSwitchedOffAndEmpty,
  type DrawnDistrict,
} from "@/lib/map/districts";
import { districtDoorRows, governingDoorRows, type DistrictDoorRow } from "@/lib/state/derive";
import { representationForDivision } from "@/lib/registry/representation";
import { projectedRosterGapsForDivision } from "@/lib/registry/body-roster-client";
import { RosterCompletenessGaps } from "@/components/officials/roster-completeness-gap";
import {
  groupOfficials,
  TIER_GROUP_LABELS,
  type TierGroup,
} from "@/lib/officials/tier-grouping";

import { bodyDisplayName } from "@/lib/text/reader-names";



/**
 * The sidebar-count doors: tapping a stat number opens the list it counts as
 * a large surface, closing any other. Bodies with an unsourced name render the
 * division's label; an empty door says why.
 */

export function DoorOverlay({
  door,
  coverage,
  meetings,
  drawnDistricts,
  districtOverlayOn,
  atAddress,
  addressDivisionIds,
  onShowDistricts,
  onOpenOfficial,
  onOpenMeeting,
  onOpenBody,
  onClose,
  embedded = false,
  onShowDistrict,
  showableDistrictIds = [],
}: {
  door: "bodies" | "districts" | "officials";
  coverage: CoverageSummary | null;
  meetings: Meeting[];
  /** The districts the map is drawing; the same list the stat card counts. */
  drawnDistricts: DrawnDistrict[];
  /** Off means the door explains rather than rendering an empty list. */
  districtOverlayOn: boolean;
  /** A street address resolved, so the door can list the districts the reader is in. */
  atAddress: boolean;
  addressDivisionIds?: ReadonlySet<string> | null;
  /** Turns the overlay on from inside the door. */
  onShowDistricts: () => void;
  onOpenOfficial: (
    holder: SeatHolder,
    seatLabel: string | null,
    tier: "local" | "state" | "national",
  ) => void;
  onOpenMeeting: (meeting: Meeting) => void;
  /** A body row opens its card; external links live inside the card. */
  onOpenBody: (body: CoveredBody) => void;
  onClose: () => void;
  /** Rendered inside the design card, which owns the frame and the title. */
  embedded?: boolean;
  /** "Show on the map": fits a drawn district's whole boundary and parks the card. */
  onShowDistrict?: (ocdId: string) => void;
  /** The districts the map is drawing — only those can be fitted. */
  showableDistrictIds?: readonly string[];
}) {
  // "Districts in view", not "here": the list is the whole viewport. The two
  // sections inside carry the specific headings.
  const title =
    door === "bodies"
      ? "Bodies here"
      : door === "districts"
        ? "Districts"
        : "Officials here";

  return (
    // z-1300: a door is a large surface and must sit above the legend (1100).
    <div
      className={
        embedded
          ? "door-overlay mw-embedded"
          : "door-overlay pointer-events-auto fixed inset-0 z-[1300] flex items-center justify-center bg-black/40 p-4"
      }
      role={embedded ? undefined : "dialog"}
      aria-modal={embedded ? undefined : "true"}
      aria-label={embedded ? undefined : title}
      onClick={embedded ? undefined : onClose}
    >
      <div
        className={
          embedded
            ? "door-panel"
            : "door-panel panel max-h-[80vh] w-full max-w-md overflow-y-auto p-4"
        }
        onClick={(e) => e.stopPropagation()}
      >
        <div className={embedded ? "sr-only" : "flex items-center justify-between"}>
          <h2 className="font-mono t-caption uppercase trailing-space-trimmed-20 tracking-[0.2em] text-signal">
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
          // Lists exactly the districts the card counted.
          <ShowDistrictContext.Provider value={{ onShow: onShowDistrict, showable: showableDistrictIds }}>
          <DistrictsDoor
            drawnDistricts={drawnDistricts}
            districtOverlayOn={districtOverlayOn}
            atAddress={atAddress}
            addressDivisionIds={addressDivisionIds}
            onShowDistricts={onShowDistricts}
            coverage={coverage}
            onOpenOfficial={onOpenOfficial}
          />
          </ShowDistrictContext.Provider>
        ) : !coverage ? (
          <p className="mt-3 t-body text-muted">
            We couldn&apos;t resolve who governs this point — enter a zip
            first, or the search may have failed.
          </p>
        ) : door === "bodies" ? (
          <BodiesDoor
            coverage={coverage}
            meetings={meetings}
            onOpenMeeting={onOpenMeeting}
            onOpenBody={onOpenBody}
          />
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
  onOpenBody,
}: {
  coverage: CoverageSummary;
  meetings: Meeting[];
  onOpenMeeting: (meeting: Meeting) => void;
  onOpenBody: (body: CoveredBody) => void;
}) {
  if (coverage.bodies.length === 0) {
    return (
      <p className="mt-3 t-body text-muted">
        No mapped bodies at this point yet.
      </p>
    );
  }
  return (
    <ul className="mt-3 space-y-2">
      {coverage.bodies.map((body) => {
        const label = bodyDisplayName(body);
        /* Matched by exact `bodyId`, never by name. */
        const next = meetings.find(
          (m) => m.status === "SCHEDULED" && m.bodyId !== undefined && m.bodyId === body.bodyId,
        );
        return (
          <li
            key={body.bodyId}
            className="border-b border-[var(--panel-border)] pb-2 last:border-0"
          >
            <div className="flex items-baseline justify-between gap-3">
              {/* The row opens the body's large battlecard. */}
              <button
                type="button"
                onClick={() => onOpenBody(body)}
                title={`More about ${label}`}
                className="cursor-pointer text-left t-body leading-snug hover:text-link hover:underline"
              >
                {label}
              </button>
              <span className="trailing-space-trimmed shrink-0 font-mono t-caption uppercase tracking-[0.15em] text-muted">
                {bodyClassShort(body.bodyClass)}
              </span>
            </div>
            {next && <MeetingRow meeting={next} compact title="Next meeting" onOpen={onOpenMeeting} /> }
          </li>
        );
      })}
    </ul>
  );
}

function DistrictsDoor({
  drawnDistricts,
  districtOverlayOn,
  atAddress,
  addressDivisionIds,
  onShowDistricts,
  coverage,
  onOpenOfficial,
}: {
  drawnDistricts: DrawnDistrict[];
  districtOverlayOn: boolean;
  atAddress: boolean;
  addressDivisionIds?: ReadonlySet<string> | null;
  onShowDistricts: () => void;
  coverage: CoverageSummary | null;
  onOpenOfficial: (
    holder: SeatHolder,
    seatLabel: string | null,
    tier: "local" | "state" | "national",
  ) => void;
}) {
  /*
   * Two sections, always both: "Districts you're in" (boundaries containing
   * the resolved point) and "Districts in view" (what the map draws). Without
   * an address the first renders its named gap; a zip centroid cannot say
   * which districts the reader is in.
   */
  const governingRows =
    atAddress && coverage
      ? governingDoorRows(coverage, (ocdId) =>
          representationForDivision(coverage, ocdId),
        addressDivisionIds)
      : null;

  /* `districtsAreVisible` is the single rule, shared with the stats tile. */
  const drawnRows =
    drawnDistricts.length > 0
      ? districtDoorRows(drawnDistricts, coverage?.seats ?? [])
      : null;

  return (
    <>
      <DoorSection
        heading="Districts you're in"
        count={governingRows?.length ?? null}
      >
        {governingRows ? (
          <>
            <p className="mt-2 t-body text-muted">
              Every district your address sits inside.
            </p>
            <DistrictRows rows={governingRows} coverage={coverage} onOpenOfficial={onOpenOfficial} />
          </>
        ) : (
          // A fact about the limits of a zip, not a claim that the reader is in nothing.
          <p className="mt-2 t-body text-muted">
            A zip code crosses city, county and school district lines, so it
            can&apos;t say which districts you&apos;re in. Adding your street
            address answers this section.
          </p>
        )}
      </DoorSection>

      <div className="mt-4 border-t border-[var(--panel-border)]" />

      <DoorSection heading="Districts in view" count={drawnRows?.length ?? null}>
        {drawnRows ? (
          // Exactly one row per drawn district.
          <DistrictRows rows={drawnRows} coverage={coverage} onOpenOfficial={onOpenOfficial} />
        ) : districtsSwitchedOffAndEmpty(drawnDistricts.length, districtOverlayOn) ? (
          // Reached only when the layer is off and nothing is painted.
          <div className="mt-2">
            <p className="t-body text-muted">
              District boundaries are switched off, so none are drawn and there
              is nothing to count.
            </p>
            <button
              type="button"
              onClick={onShowDistricts}
              className="mt-2 cursor-pointer rounded border border-[var(--panel-border)] px-3 py-1.5 t-body text-paper hover:border-paper"
            >
              Show district boundaries
            </button>
          </div>
        ) : (
          <p className="mt-2 t-body text-muted">
            No district boundaries are drawn in this view yet.
          </p>
        )}
      </DoorSection>
    </>
  );
}

/**
 * One section of the districts door: a heading with its own count. A null
 * count renders no number: "can't tell from a zip" is not "none".
 */
function DoorSection({
  heading,
  count,
  children,
}: {
  heading: string;
  count: number | null;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-3">
      <div className="flex items-baseline gap-2">
        <h3 className="trailing-space-trimmed-16 font-mono t-caption uppercase tracking-[0.16em] text-paper-dim">
          {heading}
        </h3>
        {count !== null && (
          <span className="font-mono t-caption text-muted">{count}</span>
        )}
      </div>
      {children}
    </section>
  );
}

/** The design's "Show on the map" for a district row (see DoorOverlay). */
const ShowDistrictContext = createContext<{
  onShow?: (ocdId: string) => void;
  showable: readonly string[];
}>({ showable: [] });

/** One row per district, shared by both modes so they cannot drift apart. */
function DistrictRows({
  rows,
  coverage,
  onOpenOfficial,
}: {
  rows: DistrictDoorRow[];
  coverage: CoverageSummary | null;
  onOpenOfficial: (
    holder: SeatHolder,
    seatLabel: string | null,
    tier: "local" | "state" | "national",
  ) => void;
}) {
  const showDistrict = useContext(ShowDistrictContext);
  return (
    <ul className="mt-3 space-y-2">
      {rows.map((row) => (
        <li
          key={row.ocdId}
          className="border-b border-[var(--panel-border)] pb-2 last:border-0"
        >
          <div className="flex items-baseline justify-between gap-3">
            <p className="t-body">{row.label}</p>
            <span className="trailing-space-trimmed shrink-0 font-mono t-caption uppercase tracking-[0.15em] text-muted">
              {row.typeLabel}
            </span>
          </div>
          {showDistrict.onShow && showDistrict.showable.includes(row.ocdId) && (
            <button
              type="button"
              className="mw-link-btn mw-row-show"
              onClick={() => showDistrict.onShow?.(row.ocdId)}
            >
              Show the whole boundary on the map
            </button>
          )}
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
              className="mt-0.5 mr-3 cursor-pointer t-detail text-signal underline decoration-dotted"
            >
              {holder.name} →
            </button>
          ))}
          <RosterCompletenessGaps gaps={projectedRosterGapsForDivision(coverage, row.ocdId)} />
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
  // Grouped Local / State / Federal, closest first.
  const groups = groupOfficials(coverage);
  const total = groups.local.length + groups.state.length + groups.federal.length;
  if (total === 0) {
    return (
      <p className="mt-3 t-body text-muted">
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
            <p className={`t-structure ${TIER_HEADER_CLASS[group]}`}>
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
                    className="cursor-pointer t-body text-signal underline decoration-dotted"
                  >
                    {holder.name} →
                  </button>
                  <span className="shrink-0 text-right t-caption text-muted">
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
