import type { MapTilerClassifier, MapTilerGroup } from "./types.ts";
import { DEFAULT_MAPTILER_ALLOWANCE, MAPTILER_USAGE_FORMAT_VERSION, type MapTilerUsageDay, type MapTilerUsageSnapshot } from "./types.ts";
import type { MapTilerTimeline } from "./client.ts";

/** `estimated_data` is kept and marked, never summed into a measurement. */
export function normalizeTimeline(input: {
  readonly timeline: MapTilerTimeline;
  readonly classifier: MapTilerClassifier;
  readonly group: MapTilerGroup;
}): readonly MapTilerUsageDay[] {
  if (!Array.isArray(input.timeline.datasets) || input.timeline.datasets.length === 0) {
    throw new Error(
      "MAPTILER_TIMELINE_EMPTY: a missing or empty dataset collection is not a usage reading",
    );
  }
  const labels = new Map<string, string>();
  for (const entry of input.timeline.legend ?? []) {
    if (entry.item_id) labels.set(entry.item_id, entry.label ?? entry.item_id);
  }

  const rows: MapTilerUsageDay[] = [];
  for (const dataset of input.timeline.datasets) {
    const itemId = dataset.item_id?.trim() ?? "";
    if (itemId === "") {
      throw new Error("MAPTILER_TIMELINE_ITEM_ID_MISSING: every dataset must name what was counted");
    }
    const label = labels.get(itemId) ?? itemId;
    const group = dataset.group_id ?? input.group;

    const push = (
      point: { readonly date?: string; readonly value?: number } | undefined,
      estimated: boolean,
    ): void => {
      const date = point?.date?.trim() ?? "";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
        throw new Error("MAPTILER_TIMELINE_DATE_INVALID: every point must carry a real ISO date");
      }
      if (typeof point?.value !== "number" || !Number.isFinite(point.value) || point.value < 0) {
        throw new Error(
          "MAPTILER_TIMELINE_COUNT_INVALID: a missing, non-finite, or negative count is not zero",
        );
      }
      const count = point.value;
      rows.push({
        date,
        classifier: input.classifier,
        itemId,
        label,
        group,
        count,
        estimated,
      });
    };

    for (const point of dataset.data ?? []) push(point, false);
    /* MapTiler's `estimated_data` is documented as an object and observed as a
     * list. Both are accepted; neither is merged into a measurement. */
    const estimated: unknown = dataset.estimated_data;
    const estimates = Array.isArray(estimated) ? estimated : estimated ? [estimated] : [];
    for (const point of estimates as { date?: string; value?: number }[]) push(point, true);
  }
  if (rows.length === 0) {
    throw new Error("MAPTILER_TIMELINE_EMPTY: no day row was measured or estimated");
  }
  return rows;
}

function measuredSnapshotIssue(snapshot: MapTilerUsageSnapshot): string | null {
  if (snapshot.connection !== "CONNECTED") return "the provider did not return a complete reading";
  if (
    snapshot.since === null || snapshot.until === null ||
    !/^\d{4}-\d{2}-\d{2}$/.test(snapshot.since) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(snapshot.until) ||
    snapshot.since > snapshot.until
  ) return "the provider did not return one valid billing window";
  const measured = snapshot.days.filter((day) => !day.estimated && day.group === "request");
  if (!measured.some((day) => day.classifier === "api_keys")) {
    return "the key-attribution classifier returned no measured rows";
  }
  if (!measured.some((day) => day.classifier === "services")) {
    return "the service classifier returned no measured rows";
  }
  if (snapshot.days.some((day) => !Number.isFinite(day.count) || day.count < 0)) {
    return "a usage row carried an invalid count";
  }
  return null;
}

/** Promote only a complete reading; a failed or partial attempt is recorded on the retained prior measurement. */
export function retainMapTilerLastKnownGood(input: {
  readonly candidate: MapTilerUsageSnapshot;
  readonly previous: MapTilerUsageSnapshot | null | undefined;
}): MapTilerUsageSnapshot {
  const issue = measuredSnapshotIssue(input.candidate);
  if (issue === null) {
    return {
      ...input.candidate,
      formatVersion: MAPTILER_USAGE_FORMAT_VERSION,
      latestAttempt: input.candidate.latestAttempt ?? {
        attemptedAt: input.candidate.collectedAt,
        connection: "CONNECTED",
        detail: null,
        provenance: input.candidate.provenance,
      },
    };
  }

  const failedCandidate: MapTilerUsageSnapshot = input.candidate.connection === "CONNECTED"
    ? {
        ...input.candidate,
        formatVersion: MAPTILER_USAGE_FORMAT_VERSION,
        connection: "COULD_NOT_ASK",
        detail: `REFUSED PARTIAL MAPTILER READING — ${issue}. This is not a reading of zero.`,
        days: [],
        actors: null,
        actorsDetail: "The provider reading was refused, so the comparison is unknown.",
      }
    : { ...input.candidate, formatVersion: MAPTILER_USAGE_FORMAT_VERSION };
  const failedAttempt = {
    attemptedAt: failedCandidate.collectedAt,
    connection: failedCandidate.connection,
    detail: failedCandidate.detail ?? issue,
    provenance: failedCandidate.provenance,
  } as const;

  if (input.previous && measuredSnapshotIssue(input.previous) === null) {
    return {
      ...input.previous,
      formatVersion: MAPTILER_USAGE_FORMAT_VERSION,
      latestAttempt: failedAttempt,
    };
  }
  return { ...failedCandidate, latestAttempt: failedAttempt };
}

export function allowanceFrom(raw: string | undefined): {
  readonly allowance: number;
  readonly assumed: boolean;
} {
  const parsed = Number.parseInt((raw ?? "").trim(), 10);
  if (Number.isFinite(parsed) && parsed > 0) return { allowance: parsed, assumed: false };
  return { allowance: DEFAULT_MAPTILER_ALLOWANCE, assumed: true };
}
