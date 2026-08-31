/**
 * **REAL OBLIGATIONS, DERIVED FROM WHAT THIS PROJECT ACTUALLY HOLDS.**
 * (Session B, W3.5, 2026-08-30.)
 *
 * A shadow cycle over invented obligations proves the loop compiles. A shadow
 * cycle over the committed meeting corpus proves the loop meets the shapes the
 * corpus really has — bodies with a next sitting and bodies without, sources we
 * have graduated and sources we have not, provenance present and provenance
 * absent. Those are the rows that make the difference between a scheduler and
 * a scheduler-shaped object.
 *
 * ## One obligation per BODY, not per meeting
 *
 * A meeting is an event; the obligation is to keep a body's CALENDAR fresh, and
 * that obligation outlives any one sitting. Modelling it per meeting would
 * create obligations that complete and vanish, which is the recurrence-as-
 * WorkItem confusion `obligation.ts` refuses at the top.
 *
 * ## Where each cadence signal comes from, and what is honestly absent
 *
 * ```
 *   readerImpactAt          the body's NEXT SITTING — the moment staleness in
 *                           its calendar starts costing a reader something
 *   observedChangeRateHours NULL. We do not yet hold a change-rate series per
 *                           publisher, and deriving one from a single
 *                           collectedAt would be one observation wearing a
 *                           rate's name. Rows fall to the reader-impact signal
 *                           or to RULING 212's daily default, and SAY which.
 *   lastWorkedAt            the newest provenance timestamp for that body —
 *                           when we last actually read its calendar
 * ```
 *
 * That `observedChangeRateHours` is null for every row today is a fact worth
 * reading in the digest rather than hiding: it means the cadence is currently
 * derived from deadlines and defaults, and the change-rate half of RULING 212
 * has a store to build before it can bind.
 */

import { readSnapshot } from "../../meetings/snapshot.ts";

import type { FreshnessObligation } from "./obligation.ts";

/** The route class a body's meetings came from, where the source names one. */
function routeIdFor(sourceId: string | null | undefined): string | null {
  if (!sourceId) return null;
  return sourceId;
}

/**
 * Build one obligation per body present in the committed meetings snapshot.
 *
 * Returns an empty array when there is no snapshot, and the caller reports the
 * zero. It does NOT invent obligations: a scheduler seeded with rows nothing
 * holds would schedule work against subjects this project has never seen.
 */
export function freshnessObligationsFromMeetings(
  root: string,
  nowIso: string,
): FreshnessObligation[] {
  const snapshot = readSnapshot(root);
  if (!snapshot) return [];

  const nowMs = Date.parse(nowIso);
  const byBody = new Map<
    string,
    {
      subjectId: string;
      routeId: string | null;
      nextSittingMs: number | null;
      lastReadMs: number | null;
    }
  >();

  for (const meeting of snapshot.meetings) {
    const subjectId = meeting.bodyId ?? meeting.ocdId;
    if (!subjectId) continue;
    const row =
      byBody.get(subjectId) ??
      { subjectId, routeId: null, nextSittingMs: null, lastReadMs: null };

    const starts = Date.parse(meeting.startsAt);
    /* Only a FUTURE sitting is a reader deadline. A meeting that has happened
       carries no staleness cost that a refresh could still prevent. */
    if (Number.isFinite(starts) && starts > nowMs) {
      row.nextSittingMs =
        row.nextSittingMs === null ? starts : Math.min(row.nextSittingMs, starts);
    }

    const collected = Date.parse(meeting.provenance?.collectedAt ?? "");
    if (Number.isFinite(collected)) {
      row.lastReadMs = row.lastReadMs === null ? collected : Math.max(row.lastReadMs, collected);
    }

    row.routeId = row.routeId ?? routeIdFor(meeting.provenance?.sourceOrg ?? null);
    byBody.set(subjectId, row);
  }

  return [...byBody.values()]
    .map((row) => ({
      id: `freshness:meetings:${row.subjectId}`,
      recordClass: "meetings",
      subjectId: row.subjectId,
      routeId: row.routeId,
      active: true,
      readerImpactAt: row.nextSittingMs === null ? null : new Date(row.nextSittingMs).toISOString(),
      /*
       * Honestly null. No change-rate series exists per publisher yet, and one
       * derived from a single `collectedAt` would be one observation wearing a
       * rate's name. The rows fall to the reader-impact signal or to RULING
       * 212's daily default, and `cadenceSource` says which — which is the
       * whole point of recording the source per row.
       */
      observedChangeRateHours: null,
      lastWorkedAt: row.lastReadMs === null ? null : new Date(row.lastReadMs).toISOString(),
    }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
