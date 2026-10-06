"use client";

import { MeetingRow } from "@/components/ui/meeting-row";
import { CardSourcesContribution } from "@/components/ui/card-sources-contribution";
import { meetingCardSources } from "@/lib/officials/card-sources";
import { useEffect, useMemo, useState } from "react";
import { readerMeetingCount } from "@/lib/meetings/reader-listing-count";
import { MeetingListingNotice } from "./meeting-listing-notice";

import { haversineKm } from "@/lib/geo/distance";
import { orderByUpcomingFirst } from "@/lib/meetings/ordering";
import { concludedGapNote } from "@/lib/meetings/history-gaps";

import { focusList } from "@/lib/state/list-focus";

import { formatMeetingDate, formatMiles, meetingRowTitle } from "@/lib/map/format";
import { JurisdictionPill } from "@/components/address/jurisdiction-pill";
import { useMeetingBadge } from "@/hooks/use-meeting-badge";
import type { JurisdictionBadge } from "@/lib/meetings/jurisdiction-badge";
import { TIER_LABEL } from "@/lib/ocd/tiers";
import { tierForMeeting } from "@/lib/state/derive";
import { useShellData, useMeetingListingIdentity } from "@/lib/state/data";
import { BODY_TYPE_LABEL, bodyTypeOf } from "@/lib/state/derive";
import { useUi, useUiDispatch } from "@/lib/state/provider";
import type { ListGroupBy, ListSort } from "@/lib/state/types";
import type { Meeting } from "@/lib/sources/types";

import { tierVars } from "../shell/tier-style";

/**
 * The full-panel list of what is currently on the map.
 *
 * Ports `toggleAccountListOverlay` from Edia's account-list.js: sort, group-by,
 * collapsible groups, a display cap with a "show more", and rows that open the
 * detail view.
 *
 * The cap matters. Rendering every row of a real ingestion run is how a list
 * view becomes the slowest screen in the app; 200 is enough that no reader
 * scrolls past it by accident, and the count of what is hidden is stated rather
 * than the list just ending.
 */

const PAGE = 200;

const SORTS: { value: ListSort; label: string }[] = [
  { value: "date", label: "Date" },
  { value: "distance", label: "Distance" },
  { value: "body", label: "Body" },
  { value: "jurisdiction", label: "Jurisdiction" },
];

const GROUPS: { value: ListGroupBy; label: string }[] = [
  { value: "none", label: "No grouping" },
  { value: "jurisdiction", label: "Jurisdiction" },
  { value: "body-type", label: "Body type" },
  { value: "district", label: "District" },
  { value: "date", label: "Date" },
];

function groupKeyFor(meeting: Meeting, groupBy: ListGroupBy): string {
  switch (groupBy) {
    case "jurisdiction":
      return meeting.jurisdiction;
    case "body-type": {
      const type = bodyTypeOf(meeting);
      return type ? BODY_TYPE_LABEL[type] : "Other";
    }
    case "district": {
      const tier = tierForMeeting(meeting);
      return tier ? TIER_LABEL[tier] : "Unknown";
    }
    case "date":
      return formatMeetingDate(meeting);
    default:
      return "";
  }
}

export function ListOverlay({
  onPickMeeting,
  embedded = false,
}: {
  onPickMeeting: (meeting: Meeting) => void;
  /** Rendered inside the design card, which owns the frame, Escape and Close. */
  embedded?: boolean;
}) {
  const { meetings, location, result, governing } = useShellData();
  const { badgeOf, bodyClassOf } = useMeetingBadge();
  const listingIdentity = useMeetingListingIdentity();
  const ui = useUi();
  const dispatch = useUiDispatch();
  const [limit, setLimit] = useState(PAGE);

  // M58: the honest line behind an empty Concluded filter.
  const gapNote = useMemo(
    () =>
      concludedGapNote(
        ui.filters.statuses.includes("CONCLUDED"),
        result?.coverage?.bodies ?? [],
      ),
    [ui.filters.statuses, result],
  );

  /*
   * NO pushed history entry (2026-08-14 third session, same diagnosis as
   * official-modal.tsx): pushing {overlay:true} makes Next's App Router
   * re-render the route and remount the islands — the pattern killed the
   * official modal at every phone viewport the moment it opened. The
   * Edia approach assumed a router that leaves history alone; Next
   * doesn't. Escape and the close control close; back navigates.
   */

  useEffect(() => {
    if (!ui.listOverlayOpen || embedded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dispatch({ type: "list/open", open: false });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ui.listOverlayOpen, dispatch, embedded]);

  /*
   * ONE `now` for the whole render.
   *
   * The ordering and the Concluded pill both hang off it, and reading the
   * clock separately in each would let a row sort as upcoming and render as
   * concluded on the same pass. Recomputed when the meetings change, which is
   * the only moment the answer can move.
   */
  const [now, setNow] = useState(0);
  useEffect(() => {
    /*
     * Read in an EFFECT and published on a FRAME.
     *
     * `Date.now()` is impure, so calling it during render makes the same
     * component render differently on two passes with identical props — for
     * this value that means a row could sort as upcoming and paint its
     * Concluded pill on the same commit. And setting state synchronously
     * inside an effect cascades a render, which is the same pattern
     * `state-focus-overlay.tsx` routes through an animation frame for the
     * same reason.
     *
     * Zero until the frame runs puts every meeting in the upcoming block for
     * one paint, which is the safe direction: nothing is labelled finished on
     * the strength of a clock we have not read yet.
     */
    const frame = window.requestAnimationFrame(() => setNow(Date.now()));
    return () => window.cancelAnimationFrame(frame);
  }, [meetings]);

  /*
    * ── ASK-22 ── **AN ANSWER'S SUBJECT REACHES THE LIST IT OPENS.**
    * (2026-08-31.)
    *
    * The owner: *"Meetings near you sends the user hunting."* The pill on an
    * answer about one body opened this overlay with no subject, so a reader who
    * had just been told about the Mayor and Council got all 149 meetings in the
    * ZIP and had to find it again.
    *
    * Applied BEFORE the sort so every sort mode honours it, and NEVER silently:
    * the chip below names the body and clears the focus in one tap. A filter a
    * reader cannot see is how the gaps it creates get read as "no government
    * here" — this file's own `hideUncovered` note says exactly that.
    *
    * A focus that matches NOTHING falls back to the full list rather than
    * rendering an empty overlay. An answer can name a body whose sittings are
    * all outside the current window, and an empty list would tell the reader
    * that body has no meetings — a claim about a government made out of a
    * filter interaction.
    */
   /*
    * 2026-09-23: the same mechanism now carries the district card's "Upcoming
    * N" door — a DIVISION focus narrowed by the very predicate the card counted
    * with. It used to dispatch a Body scope keyed on a bare OCD-ID, which no
    * meeting can match, and this overlay read "0 meetings" under a card that
    * said "Upcoming 3". See lib/state/list-focus.ts.
    */
   const focused = useMemo(
     () => focusList(meetings, ui),
     [meetings, ui],
   );

   const ordered = useMemo(() => {
    const list = [...focused.list];
    const center = ui.nearMe ?? location;

    switch (ui.listSort) {
      case "distance": {
        if (!center) return list;
        /*
         * A meeting held online has no distance (D18), so it cannot be
         * ordered against ones that do. It sorts to the END rather than to
         * the front, because Infinity at the front would read as "nearest"
         * — a number nobody stated, rendered as a claim.
         */
        const km = (m: Meeting) =>
          m.location
            ? haversineKm(center.lat, center.lng, m.location.lat, m.location.lng)
            : Number.POSITIVE_INFINITY;
        return list.sort((a, b) => km(a) - km(b));
      }
      case "body":
        return list.sort((a, b) => a.bodyName.localeCompare(b.bodyName));
      case "jurisdiction":
        return list.sort((a, b) => a.jurisdiction.localeCompare(b.jurisdiction));
      default:
        /*
         * g4 item 11: UPCOMING FIRST, then past — never a plain ascending
         * sort. With ninety days of history in the serving window, ascending
         * put three months of finished meetings above everything a reader
         * could still attend. The rule is shared with every other surface
         * that lists meetings; see lib/meetings/ordering.ts.
         */
        return orderByUpcomingFirst(list, now);
    }
  }, [focused, ui.listSort, ui.nearMe, location, now]);

  /*
   * Meetings of the bodies that govern this ZIP lead; nearby ones follow. The
   * chosen sort still orders each block, so a reader who sorts by date sees
   * their own government's next meeting first rather than a bigger neighbour's
   * ninety. When the division lookup failed (`governing` is null) nothing is
   * known to govern, so nothing is promoted.
   */
  const sorted = useMemo(() => {
    if (!governing) return ordered;
    const rank = (m: Meeting) => {
      const badge = badgeOf(m);
      return badge === "GOVERNS" ? 0 : badge === "COULD_GOVERN" ? 1 : 2;
    };
    return ordered
      .map((meeting, index) => ({ meeting, index, rank: rank(meeting) }))
      .sort((a, b) => a.rank - b.rank || a.index - b.index)
      .map((entry) => entry.meeting);
  }, [ordered, governing, badgeOf]);

  const groups = useMemo(() => {
    if (ui.listGroupBy === "none") {
      return [{ key: "", items: sorted.slice(0, limit) }];
    }

    const map = new Map<string, Meeting[]>();
    for (const meeting of sorted.slice(0, limit)) {
      const key = groupKeyFor(meeting, ui.listGroupBy);
      const list = map.get(key);
      if (list) list.push(meeting);
      else map.set(key, [meeting]);
    }

    return [...map.entries()].map(([key, items]) => ({ key, items }));
  }, [sorted, ui.listGroupBy, limit]);

  if (!ui.listOverlayOpen) return null;

  const hidden = sorted.length - Math.min(limit, sorted.length);
  const center = ui.nearMe ?? location;
  const listingCount = readerMeetingCount(sorted, listingIdentity);

  return (
    <div
      className={embedded ? "al-overlay mw-embedded" : "al-overlay"}
      role={embedded ? undefined : "dialog"}
      aria-label={embedded ? undefined : `Visible ${listingCount.heading.toLowerCase()}`}
      onClick={(e) => {
        if (embedded) return;
        // A large popup, not a takeover (3): clicking the backdrop closes.
        if (e.target === e.currentTarget)
          dispatch({ type: "list/open", open: false });
      }}
    >
      <div className="al-panel">
      <div className="al-overlay-header">
        <span className="al-overlay-count">
          {sorted.length} {listingCount.unit}
        </span>
        {/* ASK-22: the focus is stated and one tap clears it. */}
        {focused.applied && focused.chip && (
          <button
            type="button"
            data-list-focus-clear
            className="al-focus-chip"
            aria-label={`Showing ${focused.chip.replace(/^Only /, "only ")}. Show every meeting.`}
            onClick={() =>
              dispatch({ type: "list/open", open: true, focusBodyId: null, focusBodyName: null, focusDivision: null })
            }
          >
            {focused.chip} · show all ✕
          </button>
        )}
        {focused.unmatched && focused.chip && (
          /*
           * The answer (or the count) named a subject and this window holds none
           * of its sittings. Said out loud, with the full list underneath,
           * because an empty overlay here would read as "that body has no
           * meetings".
           */
          <span className="al-focus-chip" data-list-focus-empty>
            {focused.chip}
          </span>
        )}
        {!embedded && (
        <button
          type="button"
          className="icon-btn al-overlay-close"
          aria-label="Close list"
          onClick={() => dispatch({ type: "list/open", open: false })}
        >
          ✕
        </button>
        )}
      </div>

      <div className="al-overlay-controls">
        <select
          className="scope-select"
          aria-label="Sort by"
          value={ui.listSort}
          onChange={(e) =>
            dispatch({ type: "list/sort", sort: e.target.value as ListSort })
          }
        >
          {SORTS.map((s) => (
            <option key={s.value} value={s.value}>
              Sort: {s.label}
            </option>
          ))}
        </select>

        <select
          className="scope-select"
          aria-label="Group by"
          value={ui.listGroupBy}
          onChange={(e) =>
            dispatch({
              type: "list/groupBy",
              groupBy: e.target.value as ListGroupBy,
            })
          }
        >
          {GROUPS.map((g) => (
            <option key={g.value} value={g.value}>
              Group: {g.label}
            </option>
          ))}
        </select>
      </div>

      <div className="al-overlay-body">
        {/* The unresolved-listing notice lives in this scrolling body, not
            between the pinned header and controls: it grows one line per
            listing group, and outside the scroll region a long one can take
            the panel's whole height cap (`.al-panel` is `overflow: hidden`),
            leaving the rows below it zero height. Same defect, and same fix,
            as the venue panel (components/map/meeting-panel.tsx). */}
        {listingCount.unresolved && <div className="px-4"><MeetingListingNotice groups={listingCount.groups} /></div>}
        {sorted.length === 0 && (
          <p className="al-empty">
            Nothing matches the current filters.
            <br />
            Clearing a filter or turning a tier back on will bring meetings back.
            {/* M58: never a silent empty on the Concluded filter. Where a
                body's system publishes no past meetings, the reader is told
                which body and why — an unexplained empty list reads as
                "this council doesn't meet", which is a false claim about a
                government made by our own plumbing. */}
            {gapNote && (
              <>
                <br />
                <span className="al-empty-gap">{gapNote}</span>
              </>
            )}
          </p>
        )}

        {groups.map((group) => {
          // Closed unless the reader opened it (g4 item 11).
          const collapsed = Boolean(group.key) && !ui.expandedGroups.includes(group.key);

          /*
           * The group's jurisdiction answer, where every meeting in it gets
           * the same one. Null where they disagree, or where the list is
           * ungrouped — in both cases the rows carry their own.
           */
          const groupBadges = group.key
            ? new Set(
                group.items.map((m) => badgeOf(m)),
              )
            : new Set<JurisdictionBadge>();
          const groupBadge: JurisdictionBadge | null =
            // NOT_GOVERNING is worded by each body's class, so its rows carry it.
            groupBadges.size === 1 && !groupBadges.has("NOT_GOVERNING")
              ? [...groupBadges][0]
              : null;

          return (
            <div key={group.key || "all"}>
              {group.key && (
                <button
                  type="button"
                  className="al-group-head"
                  aria-expanded={!collapsed}
                  onClick={() =>
                    dispatch({ type: "list/toggleGroup", key: group.key })
                  }
                >
                  <span>{collapsed ? "▸" : "▾"}</span>
                  {group.key}
                  <span className="al-group-count">{group.items.length}</span>
                </button>
              )}

              {/*
                JUR-4 (2026-08-23) — said ONCE per group rather than on every
                row.

                Read as an image at 430×932: nineteen consecutive rows under
                ROCKAWAY TOWNSHIP, NJ each carrying "Could govern you". That is
                the repetition the author named the headline UX problem of the
                New Jersey pass, and the WGH panel already fixed it the same
                way — one pill for the whole panel, not one per row.

                Only where the group AGREES. A group whose meetings do not all
                get the same answer cannot be answered once, and collapsing it
                would be a claim about rows that do not carry it — so those
                keep their per-row badges and this renders nothing.
              */}
              {!collapsed && <CardSourcesContribution id={`meeting-list:${group.label}`} sources={group.items.flatMap(meeting => meetingCardSources(meeting, []))} />}

              {!collapsed && groupBadge !== null && (
                <p className="al-group-jurisdiction">
                  <JurisdictionPill
                    badge={groupBadge}
                    zip={location?.zip ?? null}
                    detail={false}
                  />
                </p>
              )}

              {!collapsed &&
                group.items.map((meeting) => {
                  const km =
                    center && meeting.location
                      ? haversineKm(
                          center.lat,
                          center.lng,
                          meeting.location.lat,
                          meeting.location.lng,
                        )
                      : null;

                  return (
                    <div key={meeting.id} className="al-row" data-meeting-id={meeting.id} style={tierVars(tierForMeeting(meeting))}>
                      <MeetingRow meeting={meeting} compact sourcesInParent
                        title={meetingRowTitle(meeting, { jurisdictionShown: ui.listGroupBy === "jurisdiction" })}
                        onOpen={() => { onPickMeeting(meeting); dispatch({ type: "list/open", open: false }); }}
                        jurisdiction={groupBadge === null ? <JurisdictionPill badge={badgeOf(meeting)} bodyClass={bodyClassOf(meeting)} zip={location?.zip ?? null} detail={false} /> : undefined}
                        nearby={result?.readerScope?.nearbyMeetingIds.includes(meeting.id)}
                        distance={km !== null ? `${formatMiles(km) < 1 ? "<1" : formatMiles(km)} mi` : null} />
                    </div>
                  );
                })}
            </div>
          );
        })}

        {hidden > 0 && (
          <button
            type="button"
            className="al-more"
            onClick={() => setLimit((n) => n + PAGE)}
          >
            Show {Math.min(hidden, PAGE)} more ({hidden} hidden)
          </button>
        )}
      </div>
      </div>
    </div>
  );
}
