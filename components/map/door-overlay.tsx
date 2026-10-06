"use client";

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
import { formatMeetingDate } from "@/lib/map/format";
import { bodyDisplayName } from "@/lib/text/reader-names";
import { isOnlineOnly } from "@/lib/meetings/online";
import { MeetingStatusPill } from "@/components/map/meeting-status-pill";

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
  atAddress,
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
  /** The districts the map is drawing — the same list the stat card
   *  counts, rendered row for row (3g). */
  drawnDistricts: DrawnDistrict[];
  /** Whether the overlay is on — off means the card said "Off", and the
   *  door explains rather than rendering an empty list. */
  districtOverlayOn: boolean;
  /** True when a street address has resolved, which is when this door can
   *  honestly list the districts the reader is IN rather than the ones the
   *  camera happens to be over. */
  atAddress: boolean;
  /** Turns the overlay on from inside the door (M57). Sending the reader
   *  to hunt for a checkbox in the sidebar was a hidden entry point. */
  onShowDistricts: () => void;
  onOpenOfficial: (
    holder: SeatHolder,
    seatLabel: string | null,
    tier: "local" | "state" | "national",
  ) => void;
  onOpenMeeting: (meeting: Meeting) => void;
  /**
   * A BODY ROW OPENS ITS CARD (g4 item 9).
   *
   * The sidebar's Bodies door was the last list surface still throwing the
   * reader out of the product: the row was an `<a target="_blank">` straight
   * to `homepageUrl`, so tapping Pima left for pima.gov before the reader had
   * been told anything about Pima at all. The who-governs card's own body
   * rows were converted in g3 and this one was missed, which is exactly why
   * the item asks for an AUDIT rather than a fix.
   *
   * The official site is still one tap away — inside the card, with the
   * roster, the sittings and the sources, which is where every external door
   * on a reader surface belongs.
   */
  onOpenBody: (body: CoveredBody) => void;
  onClose: () => void;
  /** Rendered inside the design card, which owns the frame and the title. */
  embedded?: boolean;
  /**
   * Approved reader design: "Show on the map" on a district the map is
   * drawing — fits its whole boundary and parks the card. Returns nothing;
   * offered only for districts the map can actually fit.
   */
  onShowDistrict?: (ocdId: string) => void;
  /** The districts the map is drawing — only those can be fitted. */
  showableDistrictIds?: readonly string[];
}) {
  // "Districts in view", not "here": this list is what the map is drawing
  // across the whole viewport, so at 85701 it holds Marana and Oro Valley —
  // districts the reader is emphatically not in. The other two doors ARE
  // "here": they come from the coverage summary for the reader's point.
  // M139: the districts door is headed plainly, because its two sections now
  // carry the specific claims ("Districts you're in", "Districts in view").
  // Naming one of them up here too printed the same heading twice on the same
  // panel, which reads as a rendering fault rather than as structure.
  const title =
    door === "bodies"
      ? "Bodies here"
      : door === "districts"
        ? "Districts"
        : "Officials here";

  return (
    // Item 5 (2026-08-15): z-40 → z-1300. Found by the overlap audit, not by
    // eye: a door is a LARGE surface, and every other large surface on this
    // screen sits at 1200–1300, while the map legend is ambient chrome at
    // 1100. A door at 40 therefore rendered UNDERNEATH the legend, which put
    // six words of pin-colour key across a list of a county's officials at
    // 390px. The legend's own rule already says it must never cover a card
    // the reader opened; this is the other half of that rule.
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
          // 3g: this door lists the districts the card counted — the same
          // list, not a different universe. It renders even with no
          // coverage; the drawn overlay is client-side and honest alone.
          <ShowDistrictContext.Provider value={{ onShow: onShowDistrict, showable: showableDistrictIds }}>
          <DistrictsDoor
            drawnDistricts={drawnDistricts}
            districtOverlayOn={districtOverlayOn}
            atAddress={atAddress}
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
        /*
         * PU02's class sweep (NJ Hunt 4 item 3, 2026-08-22). This is the same
         * defect as the autocomplete's: an EXACT string join between the
         * meetings snapshot's `bodyName`, which is whatever a portal published,
         * and the registry's `name`, which a hunt read off the body's own page.
         * `Selectboard` against `Select Board`, `Board of Adjustment` against
         * `Board of Adjustment (BAJ)` — the same body, no match, and a row that
         * reads as having no next sitting while its sittings are in the file.
         *
         * Fixed at the shared path: `sameName` in `lib/search/body-row.ts`,
         * which normalises two spellings of one name and refuses anything
         * looser. The division is checked too — a body name alone is not a key,
         * and "Planning Board" exists in every town in the county.
         */
        /*
         * **NOW AN EXACT KEY** (2026-08-27, Red Control 4).
         *
         * This was `m.ocdId === body.ocdId && sameName(m.bodyName, body.name)`
         * — division plus a normalised name comparison, which was the best key
         * available and is the reason the comment above exists. Meetings carry
         * `bodyId` from the wiring row that produced them now, so the row is a
         * lookup rather than a comparison: no normalisation to get right, no
         * "Planning Board" in nine towns to disambiguate, and a body whose name
         * the source spells a third way still matches.
         *
         * `sameName` stays where it is and keeps its own callers; what changes
         * is that this row no longer depends on two strings agreeing.
         */
        const next = meetings.find(
          (m) => m.status === "SCHEDULED" && m.bodyId !== undefined && m.bodyId === body.bodyId,
        );
        return (
          <li
            key={body.bodyId}
            className="border-b border-[var(--panel-border)] pb-2 last:border-0"
          >
            <div className="flex items-baseline justify-between gap-3">
              {/* g4 item 9: the row opens the body's LARGE BATTLECARD. It
                  used to be an outbound link to `homepageUrl`, so tapping
                  Pima left the product for pima.gov before the reader had
                  been told anything about Pima. The official site is still
                  one tap away — inside the card, beside the roster, the
                  sittings and the sources. */}
              <button
                type="button"
                onClick={() => onOpenBody(body)}
                title={`More about ${label}`}
                className="cursor-pointer text-left t-body leading-snug hover:text-link hover:underline"
              >
                {label}
              </button>
              <span className="trailing-space-trimmed shrink-0 font-mono t-caption uppercase tracking-[0.15em] text-muted">
                {/*
                  **THIS WAS A BINARY, AND THAT WAS THE DEFECT** (RULING 118 /
                  RULING 119, 2026-08-24). `GOVERNING ? "Governing" :
                  "Advisory"` calls EVERY other kind of body advisory — a
                  commission, a private association, an executive department,
                  and, the day one shipped, a sovereign tribal nation. A
                  sovereign government labelled "Advisory" is a false claim
                  about a nation, not a cosmetic slip.
                */}
                {bodyClassShort(body.bodyClass)}
              </span>
            </div>
            {next && (
              <button
                type="button"
                onClick={() => onOpenMeeting(next)}
                className="mt-0.5 cursor-pointer text-left t-detail text-signal underline decoration-dotted"
              >
                Next meeting: {formatMeetingDate(next)} →
                {/*
                  **MTG-14 (2026-08-28): THIS DOOR NEVER SAID SO.** The list
                  overlay has marked an online sitting since D18; this line —
                  one of the two other places a reader first meets a meeting —
                  showed a body and a date and nothing else. A reader who found
                  the sitting here learned there was no room to attend only if
                  they happened to open the card.

                  It is inside the button on purpose: the mark's screen-reader
                  qualifier then reaches the button's accessible name, so the
                  fact is spoken with the thing it is about rather than beside
                  it.
                */}
                {isOnlineOnly(next) && (
                  <span className="ml-1.5 inline-block no-underline">
                    <MeetingStatusPill status="online" />
                  </span>
                )}
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
  atAddress,
  onShowDistricts,
  coverage,
  onOpenOfficial,
}: {
  drawnDistricts: DrawnDistrict[];
  districtOverlayOn: boolean;
  atAddress: boolean;
  onShowDistricts: () => void;
  coverage: CoverageSummary | null;
  onOpenOfficial: (
    holder: SeatHolder,
    seatLabel: string | null,
    tier: "local" | "state" | "national",
  ) => void;
}) {
  /*
   * M139 sub-item 3 (2026-08-18) — TWO SECTIONS, ALWAYS BOTH, NEVER CONFLATED.
   *
   * This door used to be either/or: at a resolved address it showed the
   * governing set and nothing else, and everywhere else it showed the drawn
   * set and nothing else. So the reader at an address could not see what the
   * map was drawing, and the reader at a zip was never told that the question
   * they actually have — which districts am I IN — has an answer they can
   * reach. Two different lists were also wearing one heading depending on
   * where you stood, which is the conflation the row names.
   *
   * They are different claims and they now render as two, each with its own
   * COUNT beside its own heading:
   *
   *   "Districts you're in" — divisions whose boundary CONTAINS the reader's
   *   resolved point. Geometry, not display: it does not depend on whether
   *   boundaries are drawn.
   *
   *   "Districts in view"  — what the map is drawing across the whole
   *   viewport. At 85701 that includes Marana and Oro Valley, which the
   *   reader is emphatically not in.
   *
   * THE ROW'S OWN WORDING WAS "Districts in this zip" AND THAT IS THE ONE
   * THING NOT BUILT, deliberately. `deriveStatsView` already settles it and
   * CLAUDE.md's entry rule settles it above that: a ZCTA crosses city, county
   * and school lines, so a zip centroid can sit in a different town than the
   * reader and a heading claiming otherwise would be the exact overclaim the
   * product forbids. Without an address the first section renders its honest
   * gap instead of a list — a fact about what we cannot know from a zip,
   * named as ours.
   */
  const governingRows =
    atAddress && coverage
      ? governingDoorRows(coverage, (ocdId) =>
          representationForDivision(coverage, ocdId),
        )
      : null;

  /*
   * **MAP-5 (2026-08-30) — THE DOOR NOW READS THE MAP, NOT THE SWITCH.**
   *
   * `districtOverlayOn && drawnDistricts.length > 0` made the SWITCH a veto
   * over the EVIDENCE. `ui.showDistricts` is a mirror of the persisted
   * preference the map reads directly, so it can lag or diverge — and when it
   * did, this door told a reader looking at four named State House districts,
   * beside a tile reading 33, that boundaries were switched off and there was
   * nothing to count.
   *
   * The stats tile was repaired for exactly this on 2026-08-19 and this door
   * was not, which is the same defect surviving inside one file. `districtsAreVisible` is now the single rule and both call it.
   */
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
          // The named gap, in the gap's own register: a fact about the limits
          // of a zip, not a claim that the reader is in nothing.
          <p className="mt-2 t-body text-muted">
            A zip code crosses city, county and school district lines, so it
            can&apos;t say which districts you&apos;re in. Adding your street
            address answers this section.
          </p>
        )}
      </DoorSection>

      {/* The dividing line the row asks for: two sections, visibly two. */}
      <div className="mt-4 border-t border-[var(--panel-border)]" />

      <DoorSection heading="Districts in view" count={drawnRows?.length ?? null}>
        {drawnRows ? (
          // 3g: EXACTLY one row per drawn district — the count stated above.
          <DistrictRows rows={drawnRows} coverage={coverage} onOpenOfficial={onOpenOfficial} />
        ) : districtsSwitchedOffAndEmpty(drawnDistricts.length, districtOverlayOn) ? (
          // M57: the switch is here, not somewhere the reader has to go find.
          // MAP-5: and this branch is reached only when the layer is off AND
          // nothing is painted — the one state in which the sentence is true.
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
 * One section of the districts door: a heading, its own count, its own body.
 *
 * The count sits WITH the heading it belongs to and nowhere else. A single
 * number floating above two lists is how "179 districts" came to read as a
 * claim about the reader's government while the list underneath meant
 * something else entirely — the defect `deriveStatsView` was rewritten for.
 * A null count renders no number at all rather than a zero: "we can't tell
 * you from a zip" and "the answer is none" are different sentences.
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
  // Item 2c (2026-08-14 second session): one derivation for every
  // officials surface, grouped Local / State / Federal, closest-first —
  // the list must not open with the names people already know. The flat
  // mixed list (senators first, no locals at all) was the defect.
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
            {/* Structural label (design pass). */}
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
