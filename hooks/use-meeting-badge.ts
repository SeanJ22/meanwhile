"use client";

import { useCallback, useMemo } from "react";

import { badgeFor, type JurisdictionBadge } from "@/lib/meetings/jurisdiction-badge";
import type { BodyClass } from "@/lib/registry/types";
import type { Meeting } from "@/lib/sources/types";
import { useShellData } from "@/lib/state/data";

/**
 * The jurisdiction badge for a meeting, answered the one way every surface
 * asks it: the reader's divisions, the basis they came from, and the CLASS of
 * the body that is meeting.
 *
 * The popup, the panel and the list each called `badgeFor` with geometry alone,
 * so an advisory board sitting inside the reader's city read "Governs your
 * area". The class rides in the coverage the same response carries, keyed by
 * the meeting's `bodyId`; a meeting whose body is not in that coverage has no
 * class to ask and keeps the geometric answer.
 */
export function useMeetingBadge(): {
  badgeOf: (meeting: Pick<Meeting, "ocdId" | "bodyId">) => JurisdictionBadge;
  bodyClassOf: (meeting: Pick<Meeting, "bodyId">) => BodyClass | null;
} {
  const { governing, basis, zipPartial, result } = useShellData();
  const bodies = result?.coverage?.bodies;

  const classByBodyId = useMemo(() => {
    const map = new Map<string, BodyClass>();
    for (const body of bodies ?? []) map.set(body.bodyId, body.bodyClass);
    return map;
  }, [bodies]);

  const bodyClassOf = useCallback(
    (meeting: Pick<Meeting, "bodyId">) =>
      meeting.bodyId ? (classByBodyId.get(meeting.bodyId) ?? null) : null,
    [classByBodyId],
  );

  const badgeOf = useCallback(
    (meeting: Pick<Meeting, "ocdId" | "bodyId">) =>
      badgeFor(meeting, governing, basis, zipPartial, bodyClassOf(meeting)),
    [governing, basis, zipPartial, bodyClassOf],
  );

  return { badgeOf, bodyClassOf };
}
