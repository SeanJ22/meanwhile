/**
 * **PROVIDER THREE — THE TRACKER INTAKE PATH.** (Session C, PART D3, 2026-08-31.)
 *
 * ## What this is for, in one sentence
 *
 * So that *"the owner reported it"* and *"a machine owes it"* stop being two
 * records. A tracker row that LANE TRACKER's triage converts under its state
 * (b) becomes a scheduled obligation through THE SAME REGISTRY the meetings
 * corpus and the campaign-finance portfolios go through — same occurrence, same
 * RouteTask, same Attempt, same disposition, same debt, same persisted
 * next-due. There is no second control plane for owner-reported work.
 *
 * ## THE CONTRACT, stated so a lane can satisfy it without a conversation
 *
 * One file, at `data/tracker/obligation-handoff.json`:
 *
 * ```json
 * {
 *   "generatedAt": "2026-08-31",
 *   "generatedBy": "lane-tracker triage (b)",
 *   "rows": [
 *     {
 *       "trackerId": "AZ21",
 *       "recordClass": "campaign-finance",
 *       "subjectId": "az-easyvote-tenant-list",
 *       "readerImpactAt": null,
 *       "routes": [ { "routeId": "...", "label": "...",
 *                     "executorClass": "DETERMINISTIC",
 *                     "executorReason": "...",
 *                     "open": { "kind": "HTTP_GET", "url": "https://..." },
 *                     "citation": "docs/tracker.md — AZ21" } ]
 *     }
 *   ]
 * }
 * ```
 *
 * `routes` is the same `RouteDescriptor` shape the campaign-finance descriptor
 * files use, unchanged and unabridged — one shape for every route this
 * scheduler works, so a lane that can write one can write the other.
 *
 * The ingestion path is tested against
 * `tests/fixtures/tracker-obligation-handoff.json`, a fixture of exactly the
 * shape above, and this provider reports ABSENT rather than EMPTY when the real
 * file is not present. Those are different sentences and the digest prints the
 * one that is true.
 *
 * ## THE FILE HAS LANDED, AND THE TWO HALVES DID NOT MATCH (2026-08-31)
 *
 * The converting lane shipped it — seven rows — at `docs/tracker-obligation-
 * handoff.json`, under an `obligations` key, with `rowId` and `subject` where
 * this contract says `trackerId` and `subjectId`. Both lanes built to the same
 * paragraph and produced different shapes, which is what a prose contract buys.
 *
 * The result was worse than either half: this provider reported **ABSENT** —
 * *"the converting lane has not shipped one"* — over a file sitting in the
 * repository. The integration owner moved the file to the contract path and
 * taught this reader the other envelope.
 *
 * **None of the seven is schedulable yet**, and that is correct rather than
 * disappointing: every row carries `needsBeforeItCanCarryANextDue` naming what
 * it lacks — an adapter, a second observation, an owner decision. So the honest
 * reading is EMPTY with seven rejections quoting the converting lane's own
 * reasons, and NOT an absence. RULING 208: naming an obligation does not
 * discharge it, and none of these rows is closed by appearing here.
 *
 * ## Absent, unreadable and empty are THREE outcomes
 *
 * ```
 *   ABSENT      no handoff file. The lane has not shipped one. Zero units, and
 *               that zero is expected rather than alarming
 *   UNREADABLE  a file that does not parse, or parses without `rows`. A FAILED
 *               read, reported as a failure — never as an absence
 *   EMPTY       a file that parses and declares `rows: []`. A zero-row
 *               extraction is a FAILED extraction, so this is reported as a
 *               defect in the producing lane and NOT as "the owner reported
 *               nothing"
 * ```
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type {
  ObligationProvider,
  ProvidedObligation,
  ProviderContext,
  ProviderYield,
  RouteDescriptor,
} from "../registry.ts";

export const TRACKER_PROVIDER_ID = "tracker-intake";

/** The contract path. A lane writes here; nothing else reads it. */
export const HANDOFF_PATH = ["data", "tracker", "obligation-handoff.json"] as const;

/** One converted tracker row, as the handoff file carries it. */
export interface TrackerHandoffRow {
  readonly trackerId: string;
  readonly recordClass: string;
  readonly subjectId: string;
  readonly readerImpactAt?: string | null;
  readonly observedChangeRateHours?: number | null;
  readonly declaredCycleHours?: number | null;
  readonly lastWorkedAt?: string | null;
  readonly routes: readonly RouteDescriptor[];
}

export interface TrackerHandoff {
  readonly generatedAt?: string;
  readonly generatedBy?: string;
  readonly rows?: readonly TrackerHandoffRow[];
}

export type IntakeState = "ABSENT" | "UNREADABLE" | "EMPTY" | "INGESTED";

export interface IntakeResult {
  readonly state: IntakeState;
  readonly rows: readonly TrackerHandoffRow[];
  /** Rows the file carried that could not be used, each with the reason. */
  readonly rejected: readonly { readonly trackerId: string; readonly why: string }[];
  readonly detail: string;
  readonly path: string;
}

/**
 * Read one handoff file and say EXACTLY what came back.
 *
 * Exported and tested directly against a fixture, because the three zero-shaped
 * outcomes are the whole of the honesty here and a provider that collapsed them
 * into "no rows" would report a broken lane as a quiet lane.
 */
export function readTrackerHandoff(path: string): IntakeResult {
  if (!existsSync(path)) {
    return {
      state: "ABSENT",
      rows: [],
      rejected: [],
      path,
      detail:
        "no tracker handoff file is present. The converting lane has not shipped one, which is an " +
        "ABSENCE of input and not a statement that no owner-reported work exists.",
    };
  }

  let parsed: TrackerHandoff;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8")) as TrackerHandoff;
  } catch (error) {
    return {
      state: "UNREADABLE",
      rows: [],
      rejected: [],
      path,
      detail:
        `the handoff file exists and did not parse (${
          error instanceof Error ? error.message : String(error)
        }). This is a FAILED read of a file that IS there, and no obligation may be dropped on it.`,
    };
  }

  /*
   * TWO ENVELOPES, BECAUSE TWO LANES BUILT THE TWO HALVES IN PARALLEL.
   *
   * This consumer was written expecting `rows`. The converting lane shipped
   * `obligations`, at a different path, with its own field names — the two
   * halves agreed on a contract in prose and implemented different shapes,
   * which is what happens when a contract is a paragraph rather than a type.
   *
   * Accepting both is NOT leniency. The alternative was this provider reporting
   * ABSENT — "the converting lane has not shipped one" — over a file that was
   * sitting in the repository carrying seven named rows. **A false ABSENT about
   * our own colleague's work is the same defect class as a false absence about
   * a government**, and it is the one this session spent its length on.
   *
   * The rows still have to earn their way in below. Reading the file is not
   * accepting its contents.
   */
  const carried: readonly unknown[] | null = Array.isArray(parsed.rows)
    ? parsed.rows
    : Array.isArray((parsed as { obligations?: unknown }).obligations)
      ? ((parsed as { obligations: readonly unknown[] }).obligations)
      : null;

  if (!carried) {
    return {
      state: "UNREADABLE",
      rows: [],
      rejected: [],
      path,
      detail:
        "the handoff file parsed and carries neither a `rows` nor an `obligations` array. A file " +
        "without the contract's one required key is unreadable against the contract, which is a " +
        "failure and not a zero.",
    };
  }
  const carriedRows = carried as readonly TrackerHandoffRow[];

  if (carriedRows.length === 0) {
    return {
      state: "EMPTY",
      rows: [],
      rejected: [],
      path,
      detail:
        "the handoff file parsed and declares rows: []. A zero-row extraction is a FAILED " +
        "extraction, never an empty document — reported as a defect in the producing lane rather " +
        "than as 'the owner reported nothing'.",
    };
  }

  const rows: TrackerHandoffRow[] = [];
  const rejected: { trackerId: string; why: string }[] = [];
  for (const raw of carriedRows) {
    const row = raw as TrackerHandoffRow & {
      rowId?: string;
      subject?: string;
      needsBeforeItCanCarryANextDue?: readonly string[];
    };
    /* `rowId` is the converting lane's name for the same field. */
    const id =
      typeof row?.trackerId === "string"
        ? row.trackerId
        : typeof row?.rowId === "string"
          ? row.rowId
          : "<unnamed row>";
    const subject =
      typeof row?.subjectId === "string"
        ? row.subjectId
        : typeof row?.subject === "string"
          ? row.subject
          : null;
    if (!subject) {
      rejected.push({ trackerId: id, why: "no subjectId, so nothing names what is owed" });
      continue;
    }
    if (!Array.isArray(row.routes) || row.routes.length === 0) {
      /*
       * The converting lane states, per row, what is missing before the row can
       * carry a next due. Quote it rather than replacing it with our own
       * sentence: the lane that converted the row knows why it is not ready,
       * and a generic "no routes" would throw that away and make the next
       * session rediscover it.
       */
      const stated = Array.isArray(row.needsBeforeItCanCarryANextDue)
        ? row.needsBeforeItCanCarryANextDue.join("; ")
        : null;
      rejected.push({
        trackerId: id,
        why: stated
          ? `not yet schedulable, and the converting lane says why: ${stated}`
          : "no routes. A converted row with no representation to open would schedule an " +
            "obligation whose only possible outcome is NO_ROUTE_TASK",
      });
      continue;
    }
    rows.push({ ...row, trackerId: id, subjectId: subject });
  }

  /*
   * INGESTED MUST NOT NAME A READ THAT YIELDED NOTHING.
   *
   * A file carrying seven rows of which none is schedulable is not an
   * ingestion. Returning `INGESTED` with `rows: []` would put a success word on
   * a zero, which is the exact shape this module's own header refuses three
   * ways above — and the digest prints the state, so the word travels.
   *
   * `EMPTY` is already defined as "parsed, and nothing usable came out", and
   * that is what this is. The `rejected` list carries WHY, per row, in the
   * converting lane's own words.
   */
  const nothingUsable = rows.length === 0 && rejected.length > 0;

  return {
    state: nothingUsable ? "EMPTY" : "INGESTED",
    rows,
    rejected,
    path,
    detail:
      `${rows.length} of ${carriedRows.length} converted row(s) carry a subject and at least one ` +
      `route${parsed.generatedBy ? `; generated by ${parsed.generatedBy}` : ""}` +
      `${parsed.generatedAt ? ` on ${parsed.generatedAt}` : ""}` +
      (nothingUsable
        ? ". NONE is schedulable yet, and each rejected row states what it needs first — this is " +
          "the converting lane's work in progress, not an absence of owner-reported work"
        : ""),
  };
}

export function trackerHandoffPath(root: string): string {
  return join(root, ...HANDOFF_PATH);
}

/**
 * The provider.
 *
 * `pathOverride` exists solely so the test can point it at the committed
 * fixture. Nothing in production passes it, and the default is the contract
 * path.
 */
export function trackerIntakeProvider(pathOverride?: string): ObligationProvider {
  return {
    id: TRACKER_PROVIDER_ID,
    describe:
      "tracker rows the owner reported and a lane converted, scheduled through this same registry " +
      "so 'the owner reported it' and 'a machine owes it' are one record",

    scheduledId: (record, route) => `freshness:tracker:${record.subjectId}#${route.routeId}`,

    enumerate(ctx: ProviderContext): ProviderYield {
      const path = pathOverride ?? trackerHandoffPath(ctx.root);
      const read = readTrackerHandoff(path);

      if (read.state === "ABSENT") {
        return { obligations: [], readFailure: null, emptyReason: read.detail };
      }
      if (read.state === "UNREADABLE" || read.state === "EMPTY") {
        return { obligations: [], readFailure: read.detail, emptyReason: null };
      }

      const obligations: ProvidedObligation[] = read.rows.map((row) => ({
        recordClass: row.recordClass || "tracker",
        subjectId: row.subjectId,
        readerImpactAt: row.readerImpactAt ?? null,
        observedChangeRateHours: row.observedChangeRateHours ?? null,
        ...(row.declaredCycleHours !== undefined && row.declaredCycleHours !== null
          ? { declaredCycleHours: row.declaredCycleHours }
          : {}),
        lastWorkedAt: row.lastWorkedAt ?? null,
        routes: row.routes,
      }));

      return {
        obligations,
        readFailure:
          read.rejected.length === 0
            ? null
            : `${read.rejected.length} converted row(s) were unusable: ` +
              read.rejected.map((r) => `${r.trackerId} (${r.why})`).join("; "),
        emptyReason: null,
      };
    },
  };
}
