import { KEY_MATRIX, type KeyIdentityName } from "../../map/key-matrix.ts";
import {
  ownerDigestAttention,
  type MapTilerUsageCollectionOutcome,
  type OwnerDigestRecord,
  type RenderedNumber,
} from "../owner-surface.ts";
import type { MapTilerClassifier, MapTilerGroup } from "./types.ts";
import {
  DEFAULT_MAPTILER_ALLOWANCE,
  MAPTILER_USAGE_FORMAT_VERSION,
  type MapTilerActorCounts,
  type MapTilerUsageDay,
  type MapTilerUsageSnapshot,
} from "./types.ts";
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

export interface KeyRow {
  /** MapTiler's own name for the key. Never its value. */
  readonly label: string;
  readonly identity: KeyIdentityName | "UNCLASSIFIED";
  readonly expectation: KeyExpectation;
  readonly requests: number;
  /** True where a non-zero number is itself the finding. */
  readonly expectedZero: boolean;
  /** What this row licenses the owner to conclude. Never "humans". */
  readonly says: string;
}

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

const SAYS: Readonly<Record<KeyExpectation, string>> = {
  PUBLIC_PRODUCTION:
    "Requests from the public production Reader origins, plus any bounded production probe named " +
    "in docs/maptiler-keys.md. This is public-origin traffic — it is not a count of people, and " +
    "an outside crawler that runs the site is part of it.",
  OWNER_MANUAL_STAGING: "Requests from the staging Reader, which the owner reviews by hand.",
  BOUNDED_SMOKE:
    "Requests from the one opted-in, capped provider smoke. Expected to be small and to match a " +
    "command somebody ran on purpose.",
  UNCLASSIFIED:
    "A key this project does not recognise. Expected to be zero. A number here means a key is " +
    "installed somewhere nobody has declared.",
};

export interface ServiceRow {
  readonly service: string;
  readonly requests: number;
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

export interface ActorComparison {
  readonly state: "MEASURED" | "UNKNOWN";
  readonly counts: MapTilerActorCounts | null;
  /** Defects, not ratios. Empty is the expected state. */
  readonly defects: readonly string[];
  readonly says: string;
}

export interface MapTilerPanel {
  readonly connection: MapTilerUsageSnapshot["connection"];
  readonly readingState: "MEASURED_CURRENT" | "MEASURED_LKG" | "UNKNOWN";
  readonly says: string;
  readonly collectedAt: string;
  readonly since: string | null;
  readonly until: string | null;
  readonly used: number | null;
  readonly estimatedIncluded: number;
  readonly allowance: number | null;
  readonly allowanceIsAssumed: boolean;
  readonly remaining: number | null;
  readonly byKey: readonly KeyRow[];
  readonly byService: readonly ServiceRow[];
  readonly burn: BurnReading | null;
  readonly automationBlocked: boolean;
  readonly automationSays: string;
  readonly actors: ActorComparison | null;
  readonly latestAttemptSays: string | null;
  readonly needsOwner: readonly string[];
}

/** Sum the measured rows of one classifier. Estimates are counted separately. */
function totalFor(days: readonly MapTilerUsageDay[], classifier: MapTilerClassifier): {
  measured: number;
  estimated: number;
} {
  let measured = 0;
  let estimated = 0;
  for (const day of days) {
    if (day.classifier !== classifier) continue;
    if (day.group !== "request") continue;
    if (day.estimated) estimated += day.count;
    else measured += day.count;
  }
  return { measured, estimated };
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

/** Anomaly detection, not a ratio: a declared synthetic run reaching MapTiler is a defect. */
export function compareActors(input: {
  readonly counts: MapTilerActorCounts | null;
  readonly byKey: readonly KeyRow[];
  readonly unknownDetail?: string | null;
}): ActorComparison {
  if (input.counts === null) {
    return {
      state: "UNKNOWN",
      counts: null,
      defects: [],
      says:
        input.unknownDetail ??
        "The standing collector could not measure our Reader-event comparison for this billing " +
          "window. That comparison is unknown, not zero.",
    };
  }
  const defects: string[] = [];
  for (const row of input.byKey) {
    if (row.expectation === "UNCLASSIFIED" && row.requests > 0) {
      defects.push(
        `${row.requests.toLocaleString("en-US")} request(s) landed on "${row.label}", a key this ` +
          "project has not declared. Something is installed somewhere nobody has named.",
      );
    }
  }
  const c = input.counts;
  const total = c.declaredSynthetic + c.undeclaredPublic + c.unattributed + c.author;
  return {
    state: "MEASURED",
    counts: c,
    defects,
    says:
      `Between ${c.since} and ${c.until} the Reader recorded ${total.toLocaleString("en-US")} ` +
      `event(s): ${c.declaredSynthetic.toLocaleString("en-US")} from runs that declared ` +
      `themselves automated, ${c.undeclaredPublic.toLocaleString("en-US")} that declared nothing, ` +
      `${c.author.toLocaleString("en-US")} from the author, and ` +
      `${c.unattributed.toLocaleString("en-US")} that cannot be attributed either way. These are ` +
      "app events, not map sessions, and not a count of people — every session that reaches the " +
      "Reader loads the map, so they move together, but one is not the other.",
  };
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

export function projectPanel(input: {
  readonly snapshot: MapTilerUsageSnapshot;
  readonly burnWindowDays?: number;
}): MapTilerPanel {
  const snap = input.snapshot;
  const needsOwner: string[] = [];
  const latestAttempt = snap.latestAttempt ?? null;
  const latestFailed = latestAttempt !== null && latestAttempt.connection !== "CONNECTED"
    ? latestAttempt
    : null;
  const readingState: MapTilerPanel["readingState"] = snap.connection !== "CONNECTED"
    ? "UNKNOWN"
    : latestFailed === null
      ? "MEASURED_CURRENT"
      : "MEASURED_LKG";
  const latestAttemptSays = readingState === "MEASURED_LKG" && latestFailed !== null
    ? `The latest automatic collection at ${latestFailed.attemptedAt} failed: ` +
      `${latestFailed.detail ?? "MapTiler did not return a complete reading."} ` +
      "The prior measured reading remains live, and the standing runner will retry."
    : null;

  /* No leading "Yes." — the panel puts the verdict in front of this sentence,
   * and the two together read "Yes. Yes." if this one answers as well. */
  const automationSays =
    "Every browser this project opens goes through one place, and that place refuses the map " +
    "provider unless a command explicitly asks for it and the machine running it explicitly " +
    "allows it. Both are required, so a routine job cannot spend the allowance by accident.";

  if (snap.connection !== "CONNECTED") {
    needsOwner.push(
      snap.connection === "NOT_CONNECTED"
        ? "Nobody has asked MapTiler what this account spent, because the read-only credential " +
          "that would let us ask has not been created yet. That is a gap in our setup, not a " +
          "reading of zero — see the technical details below for exactly what to create."
        : "We asked MapTiler and could not get an answer, so there is no reading. That is not " +
          "the same as spending nothing.",
    );
    return {
      connection: snap.connection,
      readingState,
      says:
        snap.detail ??
        "NOT CONNECTED — nobody has asked MapTiler what this account spent. That is not the same " +
          "as spending nothing, and it must never be read as headroom.",
      collectedAt: snap.collectedAt,
      since: snap.since,
      until: snap.until,
      used: null,
      estimatedIncluded: 0,
      allowance: snap.allowance,
      allowanceIsAssumed: snap.allowanceIsAssumed,
      remaining: null,
      byKey: [],
      byService: [],
      burn: null,
      automationBlocked: true,
      automationSays,
      actors: compareActors({ counts: snap.actors, byKey: [], unknownDetail: snap.actorsDetail }),
      latestAttemptSays,
      needsOwner,
    };
  }

  const keyTotals = new Map<string, number>();
  const serviceTotals = new Map<string, number>();
  for (const day of snap.days) {
    if (day.group !== "request" || day.estimated) continue;
    const into = day.classifier === "api_keys" ? keyTotals : day.classifier === "services" ? serviceTotals : null;
    if (into === null) continue;
    into.set(day.label, (into.get(day.label) ?? 0) + day.count);
  }

  const byKey: KeyRow[] = [...keyTotals.entries()]
    .map(([label, requests]) => {
      const { identity, expectation } = classifyKeyLabel(label);
      return {
        label,
        identity,
        expectation,
        requests,
        expectedZero: expectation === "UNCLASSIFIED",
        says: SAYS[expectation],
      };
    })
    .sort((a, b) => b.requests - a.requests || a.label.localeCompare(b.label));

  /* Every declared identity gets a row even at zero; a missing row would read as "not measured". */
  for (const identity of KEY_MATRIX) {
    if (identity.name === "none") continue;
    if (byKey.some((row) => row.identity === identity.name)) continue;
    byKey.push({
      label: identity.name,
      identity: identity.name,
      expectation: EXPECTATION_BY_IDENTITY[identity.name],
      requests: 0,
      expectedZero: false,
      says: SAYS[EXPECTATION_BY_IDENTITY[identity.name]],
    });
  }

  const byService: ServiceRow[] = [...serviceTotals.entries()]
    .map(([service, requests]) => ({ service, requests }))
    .sort((a, b) => b.requests - a.requests || a.service.localeCompare(b.service));

  const keys = totalFor(snap.days, "api_keys");
  const services = totalFor(snap.days, "services");
  /*
   * The two classifiers are two views of one population: the total is the larger of them,
   * never their sum. Larger, because understating a quota reads as headroom.
   */
  const used = Math.max(keys.measured, services.measured);
  const estimatedIncluded = Math.max(keys.estimated, services.estimated);
  const remaining = snap.allowance === null ? null : Math.max(0, snap.allowance - used);
  const burn = burnFrom({ days: snap.days, remaining, windowDays: input.burnWindowDays ?? 7 });

  if (snap.allowanceIsAssumed) {
    needsOwner.push(
      "The allowance shown is an assumption, not a reading — MapTiler does not tell us the plan " +
        "ceiling, so we assume the free tier. Confirm which plan the account is on and the " +
        "figure can be recorded; until then every percentage here is measured against a guess.",
    );
  }
  for (const row of byKey) {
    if (row.expectedZero && row.requests > 0) {
      needsOwner.push(
        `An undeclared key ("${row.label}") spent ${row.requests.toLocaleString("en-US")} ` +
          "request(s). Find where it is installed, or retire it.",
      );
    }
  }
  if (remaining !== null && burn?.exhaustionDate) {
    needsOwner.push(
      `At the measured rate the allowance runs out on ${burn.exhaustionDate}. Decide before then ` +
        "whether to change the plan; nothing in this repository will make that choice.",
    );
  }

  const measuredSays =
    `${used.toLocaleString("en-US")} request(s) this billing period` +
    (snap.allowance === null
      ? ", against an allowance nobody has confirmed."
      : ` of ${snap.allowance.toLocaleString("en-US")}` +
        (snap.allowanceIsAssumed ? " (assumed)" : "") +
        `, leaving ${(remaining ?? 0).toLocaleString("en-US")}.`);
  const says = readingState === "MEASURED_LKG"
    ? `Showing the last-known-good reading collected at ${snap.collectedAt}: ${measuredSays}`
    : measuredSays;

  return {
    connection: snap.connection,
    readingState,
    says,
    collectedAt: snap.collectedAt,
    since: snap.since,
    until: snap.until,
    used,
    estimatedIncluded,
    allowance: snap.allowance,
    allowanceIsAssumed: snap.allowanceIsAssumed,
    remaining,
    byKey,
    byService,
    burn,
    automationBlocked: true,
    automationSays,
    actors: compareActors({ counts: snap.actors, byKey, unknownDetail: snap.actorsDetail }),
    latestAttemptSays,
    needsOwner,
  };
}

/** Admin refuses to render the page if any audited figure lacks a denominator or contract, so the panel feeds `auditRenderedNumbers`. */
export function maptilerSectionNumbers(panel: MapTilerPanel): readonly RenderedNumber[] {
  if (panel.connection !== "CONNECTED" || panel.used === null) return [];
  const numbers: RenderedNumber[] = [];
  const used = panel.used;

  if (panel.allowance !== null) {
    numbers.push({
      label: "map provider requests this billing period",
      value: used,
      denominator: panel.allowance,
      contract:
        `requests MapTiler counted in this billing period, against the allowance the plan ` +
        `carries${panel.allowanceIsAssumed ? " — which nobody has confirmed, so it is an assumption" : ""}. ` +
        "A value above the denominator is an overrun, not an error.",
    });
  }

  for (const row of panel.byKey) {
    numbers.push({
      label: `map provider key ${row.label}`,
      value: row.requests,
      denominator: used,
      contract:
        `requests billed to this key, out of every request this billing period. ` +
        (row.expectedZero
          ? "This key is not declared by this project and is expected to be zero."
          : "Attribution is by the key the provider billed, never by who we think sent it."),
    });
  }

  for (const row of panel.byService) {
    numbers.push({
      label: `map provider service ${row.service}`,
      value: row.requests,
      denominator: used,
      contract:
        "requests this provider service accounted for, out of every request this billing " +
        "period. Services are billed differently and are never summed together.",
    });
  }

  if (panel.burn) {
    numbers.push({
      label: `map provider requests in the last ${panel.burn.windowDays} day(s)`,
      value: Math.round(panel.burn.perDay * panel.burn.windowDays),
      denominator: used,
      contract:
        `measured requests in the ${panel.burn.windowDays} day(s) to ${panel.burn.windowUntil}, ` +
        "out of the period total. The daily average and the exhaustion date are derived from " +
        "this window and from measured days only — never from the provider's own projection.",
    });
  }

  return numbers;
}

export type MapTilerHistoryDisposition =
  | MapTilerUsageCollectionOutcome["disposition"]
  | "INCONSISTENT_RECEIPT";

export interface MapTilerHistoryAttempt {
  readonly digestId: string;
  readonly writtenAt: string;
  readonly outcome: MapTilerUsageCollectionOutcome;
  readonly disposition: MapTilerHistoryDisposition;
  /** Non-null means the row is durable but cannot license a healthy claim. */
  readonly issue: string | null;
}

export interface MapTilerHistoryWindow {
  readonly id: "24h" | "7d" | "30d";
  readonly label: "24 hours" | "7 days" | "30 days";
  readonly since: string;
  readonly through: string;
  readonly attempts: number;
  readonly promotedCurrent: number;
  readonly retainedLkg: number;
  readonly unknownNoLkg: number;
  readonly inconsistent: number;
}

export interface MapTilerAttemptHistory {
  readonly windows: readonly MapTilerHistoryWindow[];
  readonly attempts: readonly MapTilerHistoryAttempt[];
  /** Durable rows whose time is malformed or in the future; never silently omitted. */
  readonly unplaced: readonly MapTilerHistoryAttempt[];
}

const MAPTILER_HISTORY_WINDOWS = [
  { id: "24h", label: "24 hours", milliseconds: 24 * 60 * 60 * 1_000 },
  { id: "7d", label: "7 days", milliseconds: 7 * 24 * 60 * 60 * 1_000 },
  { id: "30d", label: "30 days", milliseconds: 30 * 24 * 60 * 60 * 1_000 },
] as const;

/** A malformed receipt stays visible as inconsistent and is never counted as a successful collection. */
export function projectMapTilerAttemptHistory(
  digests: readonly OwnerDigestRecord[],
  nowIso: string,
): MapTilerAttemptHistory {
  const now = Date.parse(nowIso);
  if (!Number.isFinite(now)) throw new Error("MAPTILER_HISTORY_NOW_INVALID");

  const rows: MapTilerHistoryAttempt[] = digests.flatMap((digest) => {
    const outcome = digest.runtimeOutcome;
    if (outcome?.kind !== "MAPTILER_USAGE_COLLECTION") return [];
    const attention = ownerDigestAttention(digest);
    const finished = Date.parse(outcome.finishedAt);
    const timeIssue = !Number.isFinite(finished)
      ? "The receipt has no readable finish time."
      : finished > now
        ? "The receipt finish time is in the future."
        : null;
    const outcomeIssue = attention.level === "UNKNOWN" ? attention.happened : null;
    const issue = timeIssue ?? outcomeIssue;
    return [{
      digestId: digest.digestId,
      writtenAt: digest.writtenAt,
      outcome,
      disposition: issue === null ? outcome.disposition : "INCONSISTENT_RECEIPT",
      issue,
    }];
  });

  const placed = rows
    .filter((row) => {
      const finished = Date.parse(row.outcome.finishedAt);
      return Number.isFinite(finished) && finished <= now && finished >= now - MAPTILER_HISTORY_WINDOWS[2].milliseconds;
    })
    .sort((left, right) => right.outcome.finishedAt.localeCompare(left.outcome.finishedAt));
  const unplaced = rows.filter((row) => row.issue?.includes("finish time") || row.issue?.includes("future"));

  const windows = MAPTILER_HISTORY_WINDOWS.map((window): MapTilerHistoryWindow => {
    const sinceMs = now - window.milliseconds;
    const inWindow = placed.filter((row) => Date.parse(row.outcome.finishedAt) >= sinceMs);
    return {
      id: window.id,
      label: window.label,
      since: new Date(sinceMs).toISOString(),
      through: new Date(now).toISOString(),
      attempts: inWindow.length,
      promotedCurrent: inWindow.filter((row) => row.disposition === "PROMOTED_CURRENT").length,
      retainedLkg: inWindow.filter((row) => row.disposition === "RETAINED_LKG").length,
      unknownNoLkg: inWindow.filter((row) => row.disposition === "UNKNOWN_NO_LKG").length,
      inconsistent: inWindow.filter((row) => row.disposition === "INCONSISTENT_RECEIPT").length,
    };
  });

  return { windows, attempts: placed, unplaced };
}

export function maptilerHistoryNumbers(history: MapTilerAttemptHistory): readonly RenderedNumber[] {
  return history.windows.flatMap((window) => {
    const denominator = window.attempts;
    const source = `append-only map-provider receipts finished from ${window.since} through ${window.through}`;
    const number = (label: string, value: number, contract: string): RenderedNumber => ({
      label: `map provider ${window.id} ${label}`,
      value,
      denominator,
      contract: `${contract}, out of every ${source}.`,
    });
    return [
      number("attempts", window.attempts, "durable collection attempts recorded"),
      number("promoted current", window.promotedCurrent, "complete attempts that advanced the current reading"),
      number("retained LKG", window.retainedLkg, "failed attempts for which the prior good reading remained live"),
      number("unknown without LKG", window.unknownNoLkg, "failed attempts with no prior good reading to serve"),
      number("inconsistent receipts", window.inconsistent, "receipts that could not license any healthy outcome claim"),
    ];
  });
}

export function allowanceFrom(raw: string | undefined): {
  readonly allowance: number;
  readonly assumed: boolean;
} {
  const parsed = Number.parseInt((raw ?? "").trim(), 10);
  if (Number.isFinite(parsed) && parsed > 0) return { allowance: parsed, assumed: false };
  return { allowance: DEFAULT_MAPTILER_ALLOWANCE, assumed: true };
}
