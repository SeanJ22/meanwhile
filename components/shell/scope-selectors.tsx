"use client";

import { useMemo } from "react";

import { bodyScopeKey, type BodyScopeKey } from "@/lib/state/body-scope";
import { readerBodyName, readerText } from "@/lib/text/reader-names";
import { tierForMeeting } from "@/lib/state/derive";
import { useShellData } from "@/lib/state/data";
import { useUi, useUiDispatch } from "@/lib/state/provider";

/**
 * Cascading scope: Jurisdiction → Body. Picking a jurisdiction clears the body
 * (in the reducer). Both values key on the division's OCD-ID; the body option
 * value is `<ocdId>|<bodyName>`.
 */
export function ScopeSelectors({
  onJurisdictionChosen,
}: {
  /** The reader picked a jurisdiction — the map shows its whole boundary. */
  onJurisdictionChosen?: (ocdId: string) => void;
}) {
  const { allMeetings, result } = useShellData();
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
    const seen = new Map<BodyScopeKey, { name: string; jurisdiction: string; bodyId: string | undefined }>();
    for (const meeting of allMeetings) {
      const tier = tierForMeeting(meeting);
      if (tier === null || !tiers.includes(tier)) continue;
      if (jurisdiction && meeting.ocdId !== jurisdiction) continue;
      // The filter's own constructor, so the option offered is the key matched.
      const key = bodyScopeKey(meeting);
      if (!seen.has(key)) {
        seen.set(key, {
          name: readerBodyName(meeting.bodyName),
          jurisdiction: meeting.jurisdiction,
          bodyId: meeting.bodyId,
        });
      }
    }
    // Governing bodies before advisory ones; class joined on body id. Unknown bodies rank with governments.
    const advisory = new Map<string, boolean>();
    for (const covered of result?.coverage?.bodies ?? []) {
      advisory.set(covered.bodyId, covered.bodyClass !== "GOVERNING");
    }
    const rank = (bodyId: string | undefined) => (bodyId && advisory.get(bodyId) ? 1 : 0);
    // Every option names its jurisdiction unless the name already does.
    const named = [...seen.entries()].map(([key, body]): [BodyScopeKey, string, string | undefined] => {
      const place = body.jurisdiction.replace(/,\s*[A-Z]{2}$/, "");
      const name = body.name.toLowerCase();
      const placeLower = place.toLowerCase();
      // Named for its government, not merely containing the word.
      const namesItsGovernment =
        placeLower !== "" && (name.startsWith(placeLower) || name.includes(` of ${placeLower}`));
      const label = namesItsGovernment ? body.name : `${body.name} — ${body.jurisdiction}`;
      return [key, label, body.bodyId];
    });
    return named
      .sort((a, b) => rank(a[2]) - rank(b[2]) || a[1].localeCompare(b[1]))
      .map(([key, label]): [BodyScopeKey, string] => [key, label]);
  }, [allMeetings, tiers, jurisdiction, result]);

  // One line explaining a filter state a reader would otherwise infer from an empty map.
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
          onChange={(e) => {
            const chosen = e.target.value || null;
            dispatch({ type: "scope/jurisdiction", ocdId: chosen });
            if (chosen) onJurisdictionChosen?.(chosen);
          }}
        >
          <option value="">All jurisdictions</option>
          {jurisdictions.map(([ocdId, label]) => (
            <option key={ocdId} value={ocdId}>
              {readerText(label)}
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
            // Resolved back through the offered options rather than cast: the
            // DOM hands back a string, and only a key this list made may scope.
            dispatch({
              type: "scope/body",
              key: bodies.find(([key]) => key === e.target.value)?.[0] ?? null,
            })
          }
        >
          <option value="">All bodies</option>
          {bodies.map(([key, label]) => (
            <option key={key} value={key}>
              {readerText(label)}
            </option>
          ))}
        </select>
      </div>

      {banner && <p className="scope-banner">{banner}</p>}
    </div>
  );
}
