import { KEY_MATRIX, type KeyIdentityName } from "../../map/key-matrix.ts";
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

export type KeyExpectation =
  | "PUBLIC_PRODUCTION"
  | "OWNER_MANUAL_STAGING"
  | "BOUNDED_SMOKE"
  | "UNCLASSIFIED";

const EXPECTATION_BY_IDENTITY: Readonly<Record<string, KeyExpectation>> = {
  "meanwhile-prod-browser": "PUBLIC_PRODUCTION",
  "meanwhile-staging-browser": "OWNER_MANUAL_STAGING",
  "meanwhile-synthetic-provider-smoke": "BOUNDED_SMOKE",
};

/** Exact, case-insensitive match on the identity name; deliberately not fuzzy. Anything unrecognised is UNCLASSIFIED. */
export function classifyKeyLabel(label: string): {
  readonly identity: KeyIdentityName | "UNCLASSIFIED";
  readonly expectation: KeyExpectation;
} {
  const normalized = label.trim().toLowerCase();
  for (const identity of KEY_MATRIX) {
    if (identity.name === "none") continue;
    if (identity.name.toLowerCase() === normalized) {
      return { identity: identity.name, expectation: EXPECTATION_BY_IDENTITY[identity.name] };
    }
  }
  return { identity: "UNCLASSIFIED", expectation: "UNCLASSIFIED" };
}

export interface BurnReading {
  /** Mean requests per day over the window below. */
  readonly perDay: number;
  readonly windowDays: number;
  readonly windowSince: string;
  readonly windowUntil: string;
  /** The date the allowance runs out at this rate, or null when it does not. */
  readonly exhaustionDate: string | null;
  readonly says: string;
}

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Measured days only: the provider's projection must not be an input to itself. */
export function burnFrom(input: {
  readonly days: readonly MapTilerUsageDay[];
  readonly remaining: number | null;
  readonly windowDays: number;
}): BurnReading | null {
  const byDate = new Map<string, number>();
  for (const day of input.days) {
    if (day.classifier !== "api_keys" || day.group !== "request" || day.estimated) continue;
    byDate.set(day.date, (byDate.get(day.date) ?? 0) + day.count);
  }
  const dates = [...byDate.keys()].sort();
  if (dates.length === 0) return null;

  const window = dates.slice(-input.windowDays);
  const total = window.reduce((n, d) => n + (byDate.get(d) ?? 0), 0);
  const perDay = total / window.length;
  const windowSince = window[0];
  const windowUntil = window[window.length - 1];

  let exhaustionDate: string | null = null;
  if (input.remaining !== null && perDay > 0) {
    exhaustionDate = addDays(windowUntil, Math.max(0, Math.floor(input.remaining / perDay)));
  }

  const says =
    perDay === 0
      ? `No measured requests in the ${window.length} day(s) to ${windowUntil}.`
      : `${Math.round(perDay).toLocaleString("en-US")} request(s) a day over the ${window.length} ` +
        `day(s) to ${windowUntil}` +
        (exhaustionDate === null
          ? ", with no confirmed allowance to run out of."
          : `. At that rate the allowance runs out on ${exhaustionDate}.`);

  return { perDay, windowDays: window.length, windowSince, windowUntil, exhaustionDate, says };
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
