"use client";

import { useMemo } from "react";

import { tierForMeeting } from "@/lib/state/derive";
import { useShellData } from "@/lib/state/data";
import { useUi, useUiDispatch } from "@/lib/state/provider";

/**
 * Cascading scope: Jurisdiction → Body.
 *
 * Ports EdiaStratMap's team/rep selectors. Picking a jurisdiction repopulates
 * the body dropdown and clears whatever body was chosen — the reducer does that
 * part, because a body from a different jurisdiction surviving the change is
 * exactly the kind of stale filter that produces an empty map with no
 * explanation.
 *
 * Both values are OCD-IDs. The body option value is `<ocdId>|<bodyName>`
 * because bodies have no identifier of their own until Phase 5 gives them a
 * table; it is still keyed on the division's OCD-ID rather than on the display
 * name alone, so two "Planning Commission" entries in different towns stay
 * distinct.
 */
export function ScopeSelectors() {
  const { allMeetings } = useShellData();
  const { tiers, jurisdiction, body } = useUi();
  const dispatch = useUiDispatch();

  // Only jurisdictions in the active tiers, so the dropdown never offers a
  // choice that would return nothing.
  const jurisdictions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const meeting of allMeetings) {
      const tier = tierForMeeting(meeting);
      if (tier === null || !tiers.includes(tier)) continue;
      // A division-less body (null ocdId) has no identifier to select by;
      // it stays reachable through the body dropdown and search instead.
      if (meeting.ocdId === null) continue;
      if (!seen.has(meeting.ocdId)) seen.set(meeting.ocdId, meeting.jurisdiction);
    }
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [allMeetings, tiers]);

  const bodies = useMemo(() => {
    const seen = new Map<string, string>();
    for (const meeting of allMeetings) {
      const tier = tierForMeeting(meeting);
      if (tier === null || !tiers.includes(tier)) continue;
      if (jurisdiction && meeting.ocdId !== jurisdiction) continue;
      const key = `${meeting.ocdId}|${meeting.bodyName}`;
      if (!seen.has(key)) seen.set(key, meeting.bodyName);
    }
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [allMeetings, tiers, jurisdiction]);

  // The banner slot Edia uses for #smbOppBanner: one line explaining a filter
  // state a reader would otherwise have to infer from an empty map.
  const banner =
    tiers.length === 0
      ? "No tier selected — turn on Local, State, or National to see meetings."
      : jurisdiction && bodies.length === 0
        ? "No bodies with meetings in this jurisdiction for the current filters."
        : null;

  return (
    <div className="scope-selectors">
      <div className="scope-row">
        <label className="scope-label" htmlFor="scope-jurisdiction">
          Jurisdiction
        </label>
        <select
          id="scope-jurisdiction"
          className="scope-select"
          data-active={jurisdiction !== null}
          value={jurisdiction ?? ""}
          onChange={(e) =>
            dispatch({
              type: "scope/jurisdiction",
              ocdId: e.target.value || null,
            })
          }
        >
          <option value="">All jurisdictions</option>
          {jurisdictions.map(([ocdId, label]) => (
            <option key={ocdId} value={ocdId}>
              {label}
            </option>
          ))}
        </select>
      </div>

      <div className="scope-row">
        <label className="scope-label" htmlFor="scope-body">
          Body
        </label>
        <select
          id="scope-body"
          className="scope-select"
          data-active={body !== null}
          value={body ?? ""}
          disabled={bodies.length === 0}
          onChange={(e) =>
            dispatch({ type: "scope/body", ocdId: e.target.value || null })
          }
        >
          <option value="">All bodies</option>
          {bodies.map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {banner && <p className="scope-banner">{banner}</p>}
    </div>
  );
}
