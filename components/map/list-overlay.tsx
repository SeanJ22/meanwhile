"use client";

import { useEffect, useMemo, useState } from "react";

import { haversineKm } from "@/lib/geo/distance";
import { hasConcluded, orderByUpcomingFirst } from "@/lib/meetings/ordering";
import { concludedGapNote } from "@/lib/meetings/history-gaps";
import { isOnlineOnly } from "@/lib/meetings/online";
import { MeetingStatusPill } from "@/components/map/meeting-status-pill";
import {
  formatMeetingDate,
  formatMiles,
  meetingRowTitle,
  meetingSubline,
} from "@/lib/map/format";
import { JurisdictionPill } from "@/components/address/jurisdiction-pill";
import {
  badgeFor,
  type JurisdictionBadge,
} from "@/lib/meetings/jurisdiction-badge";
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
  const { meetings, location, result, governing, zipPartial, basis } = useShellData();
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
    if (!ui.listOverlayOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dispatch({ type: "list/open", open: false });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ui.listOverlayOpen, dispatch]);

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
   const focused = useMemo(() => {
     if (!ui.listFocusBodyId) return { list: meetings, applied: false, matched: 0 };
     const hit = meetings.filter((m) => m.bodyId === ui.listFocusBodyId);
     return hit.length > 0
       ? { list: hit, applied: true, matched: hit.length }
       : { list: meetings, applied: false, matched: 0 };
   }, [meetings, ui.listFocusBodyId]);

   const sorted = useMemo(() => {
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
        {/* ASK-22: the focus is stated and one tap clears it. */}
        {focused.applied && ui.listFocusBodyName && (
          <button
            type="button"
            data-list-focus-clear
            className="al-focus-chip"
            aria-label={`Showing only ${ui.listFocusBodyName}. Show every meeting.`}
            onClick={() =>
              dispatch({ type: "list/open", open: true, focusBodyId: null, focusBodyName: null })
            }
          >
            Only {ui.listFocusBodyName} · show all ✕
          </button>
        )}
        {ui.listFocusBodyId && !focused.applied && ui.listFocusBodyName && (
          /*
           * The answer named a body and this window holds none of its sittings.
           * Said out loud, with the full list underneath, because an empty
           * overlay here would read as "that body has no meetings".
           */
          <span className="al-focus-chip" data-list-focus-empty>
            No {ui.listFocusBodyName} sittings in this window — showing every meeting
          </span>
        )}
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
          const collapsed = !ui.expandedGroups.includes(group.key);

          /*
           * The group's jurisdiction answer, where every meeting in it gets
           * the same one. Null where they disagree, or where the list is
           * ungrouped — in both cases the rows carry their own.
           */
          const groupBadges = group.key
            ? new Set(
                group.items.map((m) => badgeFor(m, governing, basis, zipPartial)),
              )
            : new Set<JurisdictionBadge>();
          const groupBadge: JurisdictionBadge | null =
            groupBadges.size === 1 ? [...groupBadges][0] : null;

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
                  const when = formatMeetingDate(meeting);
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
                        {meetingRowTitle(meeting, {
                          jurisdictionShown: ui.listGroupBy === "jurisdiction",
                        })}
                        {/* MTG-2 (2026-08-23): only what the headline does not
                            already say. Twenty Morris County rows each printed
                            the same two facts twice, reordered — the old guard
                            asked whether the sitting had a distinct title, when
                            the question is whether the HEADLINE already carries
                            the words about to go under it. An empty subline
                            renders nothing rather than an empty line. */}
                        {meetingSubline(meeting) && (
                          <span className="al-row-sub">{meetingSubline(meeting)}</span>
                        )}
                        {/*
                          MTG-1, second pass (2026-08-23). The badge used to
                          live in the meta line beside the date, where it
                          painted over it. Giving the meta line a flex gap
                          stopped the overlap and revealed the real problem:
                          "Could govern you" is wider than "Governs your area"
                          was, and at 430px it squeezed the body name down to
                          "Rockaway Tow…" — READ AS AN IMAGE, which is the only
                          way that was ever going to be caught.

                          A truncated body name is worse than the overlap it
                          replaced: a reader scanning nineteen rows cannot tell
                          which body is meeting. So the badge leaves the meta
                          line entirely and sits under the title, where the
                          meeting panel has always put it, and the title gets
                          the width back.
                        */}
                        {/* Only where the GROUP could not answer for all of
                            its rows — see the group pill above. */}
                        {groupBadge === null && (
                          <span className="al-row-jurisdiction">
                            <JurisdictionPill
                              badge={badgeFor(meeting, governing, basis, zipPartial)}
                              zip={location?.zip ?? null}
                              detail={false}
                            />
                          </span>
                        )}
                      </span>
                      <span className="al-row-meta">
                        {/*
                          g4 item 11: a finished sitting says so, and a
                          cancelled one says so in its own shade. A filled
                          pill rather than a word in the metadata line,
                          because the point is that a reader scanning the past
                          half of the list can tell at a glance which rows are
                          history and which were called off.
                        */}
                        {meeting.status === "CANCELED" ? (
                          <MeetingStatusPill status="canceled" />
                        ) : hasConcluded(meeting, now) ? (
                          <MeetingStatusPill status="concluded" />
                        ) : null}
                        {/*
                          D18: a meeting held online has no pin, so the LIST is
                          the only place a reader can find it — and it has to
                          say why it is not on the map.

                          **MTG-14 (2026-08-28) CORRECTS THIS COMMENT.** It used
                          to claim "an outline pill rather than a filled one",
                          and the stylesheet has always rendered
                          `[data-status="online"]` FILLED. The code and its
                          comment disagreed, and the CSS is what ships, so the
                          CSS wins — an outline `--online` measures 5.73:1 dark
                          and 5.06:1 light as TEXT, under the 7:1 sun bar. The
                          difference in KIND — these two are claims about what
                          happened to the sitting, this is a claim about where
                          it is — is carried by the mark and the word instead.
                          See components/map/meeting-status-pill.tsx.
                        */}
                        {isOnlineOnly(meeting) && <MeetingStatusPill status="online" />}
                        {/*
                          M81. Impact is jurisdiction MEMBERSHIP, not distance
                          — a meeting forty miles away at the county seat
                          governs the reader and the next town's select board
                          four miles away does not. So this sits AHEAD of the
                          mileage, and the mileage stays as the secondary
                          fact it should always have been.
                        */}
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
