"use client";

import { useEffect, useMemo, useState } from "react";

import { haversineKm } from "@/lib/geo/distance";
import { formatMeetingDate, formatMiles, meetingHeadline } from "@/lib/map/format";
import { TIER_LABEL } from "@/lib/ocd/tiers";
import { tierForMeeting } from "@/lib/state/derive";
import { useShellData } from "@/lib/state/data";
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
}: {
  onPickMeeting: (meeting: Meeting) => void;
}) {
  const { meetings, location } = useShellData();
  const ui = useUi();
  const dispatch = useUiDispatch();
  const [limit, setLimit] = useState(PAGE);

  /*
   * NO pushed history entry (2026-08-14 third session, same diagnosis as
   * official-modal.tsx): pushing {overlay:true} makes Next's App Router
   * re-render the route and remount the islands — the pattern killed the
   * official modal at every phone viewport the moment it opened. The
   * Edia approach assumed a router that leaves history alone; Next
   * doesn't. Escape and the close control close; back navigates.
   */

  useEffect(() => {
    if (!ui.listOverlayOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dispatch({ type: "list/open", open: false });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ui.listOverlayOpen, dispatch]);

  const sorted = useMemo(() => {
    const list = [...meetings];
    const center = ui.nearMe ?? location;

    switch (ui.listSort) {
      case "distance":
        if (!center) return list;
        return list.sort(
          (a, b) =>
            haversineKm(center.lat, center.lng, a.location.lat, a.location.lng) -
            haversineKm(center.lat, center.lng, b.location.lat, b.location.lng),
        );
      case "body":
        return list.sort((a, b) => a.bodyName.localeCompare(b.bodyName));
      case "jurisdiction":
        return list.sort((a, b) => a.jurisdiction.localeCompare(b.jurisdiction));
      default:
        return list.sort(
          (a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt),
        );
    }
  }, [meetings, ui.listSort, ui.nearMe, location]);

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

  return (
    <div
      className="al-overlay"
      role="dialog"
      aria-label="Visible meetings"
      onClick={(e) => {
        // A large popup, not a takeover (3): clicking the backdrop closes.
        if (e.target === e.currentTarget)
          dispatch({ type: "list/open", open: false });
      }}
    >
      <div className="al-panel">
      <div className="al-overlay-header">
        <span className="al-overlay-count">
          {sorted.length} {sorted.length === 1 ? "meeting" : "meetings"}
        </span>
        <button
          type="button"
          className="icon-btn al-overlay-close"
          aria-label="Close list"
          onClick={() => dispatch({ type: "list/open", open: false })}
        >
          ✕
        </button>
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
        {sorted.length === 0 && (
          <p className="al-empty">
            Nothing matches the current filters.
            <br />
            Clearing a filter or turning a tier back on will bring meetings back.
          </p>
        )}

        {groups.map((group) => {
          const collapsed = ui.collapsedGroups.includes(group.key);

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

              {!collapsed &&
                group.items.map((meeting) => {
                  const when = formatMeetingDate(meeting);
                  const km = center
                    ? haversineKm(
                        center.lat,
                        center.lng,
                        meeting.location.lat,
                        meeting.location.lng,
                      )
                    : null;

                  return (
                    <button
                      key={meeting.id}
                      type="button"
                      className="al-row"
                      style={tierVars(tierForMeeting(meeting))}
                      onClick={() => {
                        onPickMeeting(meeting);
                        dispatch({ type: "list/open", open: false });
                      }}
                    >
                      <span className="al-row-title">
                        {/* 3a: what-first, said once — sources that title a
                            sitting with the body's own name must not read
                            the same words twice. */}
                        {meetingHeadline(meeting)}
                        <span className="al-row-sub">
                          {meeting.bodyName !== meeting.title
                            ? `${meeting.bodyName} · ${meeting.jurisdiction}`
                            : meeting.jurisdiction}
                        </span>
                      </span>
                      <span className="al-row-meta">
                        {when}
                        {km !== null &&
                          // Anything under a mile rounds to 0, which reads as
                          // a missing value rather than "very close".
                          ` · ${formatMiles(km) < 1 ? "<1" : formatMiles(km)} mi`}
                      </span>
                    </button>
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
