"use client";

import { MeetingRow } from "@/components/ui/meeting-row";
import { CardSourcesContribution } from "@/components/ui/card-sources-contribution";
import { meetingCardSources } from "@/lib/officials/card-sources";
import { useEffect, useMemo, useState } from "react";
import { readerMeetingCount } from "@/lib/meetings/reader-listing-count";
import { MeetingListingNotice } from "./meeting-listing-notice";

import { haversineKm } from "@/lib/geo/distance";
import { orderByUpcomingFirst } from "@/lib/meetings/ordering";
import { concludedGapNoteFor } from "@/lib/meetings/history-gaps";

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
 * The full-panel list of what is on the map: sort, group-by, collapsible
 * groups, and a display cap of 200 with the hidden count stated.
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

  // The line explaining an empty Concluded filter.
  const gapNote = useMemo(
    () =>
      concludedGapNoteFor(
        ui.filters.statuses.includes("CONCLUDED"),
        (result?.coverage?.bodies ?? []).flatMap((body) => body.historyGap ?? []),
      ),
    [ui.filters.statuses, result],
  );

  /*
   * No pushed history entry: pushing one makes the App Router remount the
   * islands. Escape and the close control close; back navigates.
   */

  useEffect(() => {
    if (!ui.listOverlayOpen || embedded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dispatch({ type: "list/open", open: false });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ui.listOverlayOpen, dispatch, embedded]);

  /* One `now` for the whole render, so sort and Concluded pill agree. */
  const [now, setNow] = useState(0);
  useEffect(() => {

    const frame = window.requestAnimationFrame(() => setNow(Date.now()));
    return () => window.cancelAnimationFrame(frame);
  }, [meetings]);

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
        /* Online meetings have no distance and sort to the end, never to "nearest". */
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
        /* Upcoming first, then past; see lib/meetings/ordering.ts. */
        return orderByUpcomingFirst(list, now);
    }
  }, [focused, ui.listSort, ui.nearMe, location, now]);

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
        // Clicking the backdrop closes.
        if (e.target === e.currentTarget)
          dispatch({ type: "list/open", open: false });
      }}
    >
      <div className="al-panel">
      <div className="al-overlay-header">
        <span className="al-overlay-count">
          {sorted.length} {listingCount.unit}
        </span>
        {/* The focus is stated and one tap clears it. */}
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
          /* The subject has no sittings in this window: said, with the full list underneath. */
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
        {/* In the scrolling body: in the pinned header a long notice can take the whole height cap. */}
        {listingCount.unresolved && <div className="px-4"><MeetingListingNotice groups={listingCount.groups} /></div>}
        {sorted.length === 0 && (
          <p className="al-empty">
            Nothing matches the current filters.
            <br />
            Clearing a filter or turning a tier back on will bring meetings back.
            {/* Never a silent empty on the Concluded filter. */}
            {gapNote && (
              <>
                <br />
                <span className="al-empty-gap">{gapNote}</span>
              </>
            )}
          </p>
        )}

        {groups.map((group) => {
          // Closed unless the reader opened it.
          const collapsed = Boolean(group.key) && !ui.expandedGroups.includes(group.key);

          /* The group's shared jurisdiction answer; null where rows disagree or the list is ungrouped. */
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

              {!collapsed && <CardSourcesContribution id={`meeting-list:${group.key}`} sources={group.items.flatMap(meeting => meetingCardSources(meeting, []))} />}

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
                    <div key={meeting.id} className="al-row" style={tierVars(tierForMeeting(meeting))}>
                      <MeetingRow meeting={meeting} compact sourcesInParent
                        title={meetingRowTitle(meeting, { jurisdictionShown: ui.listGroupBy === "jurisdiction" })}
                        onOpen={() => { onPickMeeting(meeting); dispatch({ type: "list/open", open: false }); }}
                        jurisdiction={groupBadge === null ? <JurisdictionPill badge={badgeOf(meeting)} bodyClass={bodyClassOf(meeting)} zip={location?.zip ?? null} detail={false} /> : undefined}
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
