/**
 * **FROM A PROVIDER'S TIMELINE TO A SENTENCE THE OWNER CAN ACT ON**
 * (MAPQ-5, MAPQ-6 and MAPQ-7, 2026-09-07).
 *
 * Pure. Nothing here reads a clock, a network or an environment — the instant
 * and the reading are arguments, so a test can put the clock where it needs it
 * and a projection is exact.
 *
 * ## The four questions, and the one this file refuses to answer
 *
 *   How much did we use?              — summed from the provider's own rows
 *   Which key spent it?               — classified against `lib/map/key-matrix.ts`
 *   Which service spent it?           — kept apart, because Tiles and Rendered
 *                                       maps are billed differently
 *   When does the allowance run out?  — burn rate over a stated window
 *
 * The question it refuses: **"how many humans was that?"** Production-key usage
 * is public-origin usage plus any bounded probe we have named. It is not proof
 * that a request came from a person. An external crawler that genuinely
 * executes the public site is part of public-origin usage and always was. What
 * changed with MAPQ-1 is narrower and worth exactly what it is: OUR declared
 * robots are no longer mixed into that number. Every wording in this file is
 * written to that boundary, and `tests/maptiler-usage.test.ts` asserts the
 * panel never says "human", "person", "reader" or "organic" about it.
 */

import { KEY_MATRIX, type KeyIdentityName } from "../../map/key-matrix.ts";
import type { RenderedNumber } from "../owner-surface.ts";
import type { MapTilerClassifier, MapTilerGroup } from "./types.ts";
import {
  DEFAULT_MAPTILER_ALLOWANCE,
  type MapTilerActorCounts,
  type MapTilerUsageDay,
  type MapTilerUsageSnapshot,
} from "./types.ts";
import type { MapTilerTimeline } from "./client.ts";

/* ------------------------------------------------------------------ *
 * 1. NORMALIZE — the provider's shape into ours, losing nothing
 * ------------------------------------------------------------------ */

/**
 * Flatten one timeline into day rows.
 *
 * `estimated_data` is kept and MARKED rather than dropped or merged. MapTiler
 * projects the remainder of the current billing period, and a projection summed
 * into a measurement produces a number that is neither.
 */
export function normalizeTimeline(input: {
  readonly timeline: MapTilerTimeline;
  readonly classifier: MapTilerClassifier;
  readonly group: MapTilerGroup;
}): readonly MapTilerUsageDay[] {
  const labels = new Map<string, string>();
  for (const entry of input.timeline.legend ?? []) {
    if (entry.item_id) labels.set(entry.item_id, entry.label ?? entry.item_id);
  }

  const rows: MapTilerUsageDay[] = [];
  for (const dataset of input.timeline.datasets ?? []) {
    const itemId = dataset.item_id ?? "";
    if (itemId === "") continue;
    const label = labels.get(itemId) ?? itemId;
    const group = dataset.group_id ?? input.group;

    const push = (
      point: { readonly date?: string; readonly value?: number } | undefined,
      estimated: boolean,
    ): void => {
      if (!point?.date) return;
      const count = typeof point.value === "number" && Number.isFinite(point.value) ? point.value : 0;
      rows.push({
        date: point.date,
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
  return rows;
}

/* ------------------------------------------------------------------ *
 * 2. CLASSIFY — a provider key label against our own matrix
 * ------------------------------------------------------------------ */

/** Where a key's requests are expected to come from, in plain words. */
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

/**
 * Match a provider key label to one of our declared identities.
 *
 * Exact, case-insensitive, on the identity NAME the owner is asked to give the
 * key in `docs/maptiler-keys.md`. Deliberately not a fuzzy match: a key called
 * `meanwhile-prod-browser-old` is a different key, and quietly folding it into
 * production's number is how the first bill became unreadable. Anything we do
 * not recognise is UNCLASSIFIED, is expected to be zero, and is meant to be
 * visually obvious when it is not.
 */
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

/* ------------------------------------------------------------------ *
 * 3. PROJECT — the panel
 * ------------------------------------------------------------------ */

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
  readonly counts: MapTilerActorCounts;
  /** Defects, not ratios. Empty is the expected state after MAPQ-1. */
  readonly defects: readonly string[];
  readonly says: string;
}

export interface MapTilerPanel {
  readonly connection: MapTilerUsageSnapshot["connection"];
  /** The one-line reading. Plain language, and never a claim about people. */
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
  /** MAPQ-1's standing fact: is ordinary automation externally blocked right now? */
  readonly automationBlocked: boolean;
  readonly automationSays: string;
  readonly actors: ActorComparison | null;
  /** Everything that needs the owner, as finished sentences. */
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

/**
 * Burn over the trailing measured window.
 *
 * MEASURED days only: including the provider's own projection for the rest of
 * the period would make the projection an input to itself. The window is
 * stated in the reading, because "average daily burn" without a window is a
 * number nobody can check.
 */
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

/**
 * The comparison MAPQ-7 asks for — and the defect it is looking for.
 *
 * The purpose is anomaly detection, not a ratio to normalize. A declared
 * synthetic run that reached MapTiler after MAPQ-1 is a DEFECT, so it is named
 * as one rather than folded into an expected proportion. The only evidence we
 * can have of that from the provider's side is usage on a key nobody declared,
 * or smoke-key usage on days nobody ran the smoke — both of which are stated,
 * neither of which is inferred from a ratio.
 */
export function compareActors(input: {
  readonly counts: MapTilerActorCounts | null;
  readonly byKey: readonly KeyRow[];
}): ActorComparison | null {
  if (input.counts === null) return null;
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

/**
 * The whole panel, from one published snapshot.
 *
 * `automationBlocked` is a fact about THIS repository at the commit the panel
 * was built from, not something read back from the provider — so it is stated
 * with its evidence rather than asserted: the barrier is a class guard with a
 * test, and the panel names it.
 */
export function projectPanel(input: {
  readonly snapshot: MapTilerUsageSnapshot;
  readonly burnWindowDays?: number;
}): MapTilerPanel {
  const snap = input.snapshot;
  const needsOwner: string[] = [];

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
      actors: compareActors({ counts: snap.actors, byKey: [] }),
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

  /*
   * Every declared identity gets a row even at zero. A key with no traffic is a
   * fact — it is how the panel shows that our automation stopped spending — and
   * a missing row would read as "not measured", which is a different fact.
   */
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
   * The two classifiers are two views of ONE population, so the total is the
   * LARGER of them rather than their sum — adding them would double the bill.
   * Larger rather than either one in particular because the two can disagree,
   * and understating a quota reading is the dangerous direction: a number that
   * is too low reads as headroom. When they disagree the gap is visible in the
   * two tables, which is where an owner can act on it.
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

  const says =
    `${used.toLocaleString("en-US")} request(s) this billing period` +
    (snap.allowance === null
      ? ", against an allowance nobody has confirmed."
      : ` of ${snap.allowance.toLocaleString("en-US")}` +
        (snap.allowanceIsAssumed ? " (assumed)" : "") +
        `, leaving ${(remaining ?? 0).toLocaleString("en-US")}.`);

  return {
    connection: snap.connection,
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
    actors: compareActors({ counts: snap.actors, byKey }),
    needsOwner,
  };
}

/**
 * **THE PANEL'S NUMBERS, HANDED TO THE AUDIT THE REST OF THE CONSOLE USES.**
 * (Found at integration, 2026-09-07, by two independent review dimensions.)
 *
 * `app/(admin)/admin/page.tsx` collects every section's figures into one array,
 * runs `auditRenderedNumbers` over it, and REFUSES TO RENDER THE WHOLE PAGE if
 * any of them lacks a denominator or an interpretation contract. Cost,
 * obligations, intake and the Fleet all feed it. This panel shipped without
 * feeding it, which made it the only section on the owner's home page emitting
 * numbers outside the guarantee the page is built on — a parallel version of a
 * rule that already exists, which `lib/control-plane/owner-surface.ts` says
 * never to build.
 *
 * The contract on each is the sentence the owner is entitled to read the number
 * BY. "9,541 requests" is not information: 9,541 of 100,000 is a Tuesday and
 * 9,541 of 10,000 is an emergency.
 *
 * **A denominator here may be smaller than its value, and that is deliberate.**
 * `auditRenderedNumbers` checks that a denominator EXISTS, not that it bounds
 * the value — and it must not, because the measurement that started all of this
 * was 101,863 requests against an allowance of 100,000. A panel that could not
 * represent an overrun would be useless exactly when it mattered.
 */
export function maptilerSectionNumbers(panel: MapTilerPanel): readonly RenderedNumber[] {
  /* Nothing is rendered as a number when there is no reading, so nothing is
   * declared. An unasked question has no denominator because it has no value. */
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

/** The allowance the reading was taken against, and whether anybody confirmed it. */
export function allowanceFrom(raw: string | undefined): {
  readonly allowance: number;
  readonly assumed: boolean;
} {
  const parsed = Number.parseInt((raw ?? "").trim(), 10);
  if (Number.isFinite(parsed) && parsed > 0) return { allowance: parsed, assumed: false };
  return { allowance: DEFAULT_MAPTILER_ALLOWANCE, assumed: true };
}
