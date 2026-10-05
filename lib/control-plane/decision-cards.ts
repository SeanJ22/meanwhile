/**
 * **THE DECISION CARDS THE DASHBOARD PUBLISHES — ONE JOIN, THE SAME JOIN THE
 * OWNER VIEW MAKES.** (ADM-4, 9.4.26 admin feedback.)
 *
 * ## The defect this replaces
 *
 * `pnpm owner:publish` used to build the Needs-Sean cards from
 * `docs/tracker-reconciliation.json` alone, and that file's outcomes carry
 * exactly six keys — `rowId, kind, verdict, why, read, evidence`. Every field
 * the card wanted (title, what is needed, why no machine can decide it, the
 * options, the opened date, the priority) lives somewhere else: the row facts
 * in `docs/tracker-working.csv` and the card text in `lib/tracker/registry.mjs`.
 * So 69 cards rendered "unset · opened on an unrecorded date · age unknown"
 * with "not recorded on this row" under both headings and no buttons at all.
 * The owner could not decide anything from the page that exists so he can.
 *
 * `docs/tracker-owner-view.md` had been making the correct join all along
 * (`lib/tracker/owner-view.mjs`). This module makes the same one, once, for
 * the control plane, and is PURE — it takes the three sources as values and
 * a stamp, so a test pins the join without a filesystem.
 *
 * ## Three kinds of card
 *
 *   DECISION       the registry carries a card: what is needed, why, options
 *   ACKNOWLEDGE    the card's "what is needed" opens with a read-me verb — the
 *                  work is done and the row closes on a read (owner-view's
 *                  INFORMATIONAL split, same regex, one implementation)
 *   BLOCKED_WHILE  the registry carries a predicate: a machine-verifiable wall,
 *                  rechecked every generation; it is not a decision and gets no
 *                  buttons, only what was checked and what it found
 */
import { UNKNOWN } from "../tracker/opened-dates.mjs";
import { isInformational } from "../tracker/owner-view.mjs";
import { ageInDays } from "../tracker/reconcile.mjs";
import type { OwnerDecisionCard, OwnerDecisionCardKind } from "./owner-surface.ts";

/** A row of `docs/tracker-working.csv`, as `readStore` returns it. */
export type TrackerRow = Readonly<Record<string, string>>;

/** A `lib/tracker/registry.mjs` predicate entry: a machine-checked wall. */
export interface RegistryPredicate {
  readonly rowId: string;
  readonly kind: "predicate";
  readonly blocker: string;
}
/** A `lib/tracker/registry.mjs` card entry: a decision for the owner. */
export interface RegistryCard {
  readonly rowId: string;
  readonly kind: string;
  readonly whatIsNeeded: string;
  readonly whyNoMachineCanDecide: string;
  readonly options: readonly { readonly option: string; readonly consequence: string }[];
}
export type RegistryEntry = RegistryPredicate | RegistryCard;

/** The registry marks a predicate by kind AND by carrying a blocker; both are checked. */
export function isRegistryPredicate(entry: RegistryEntry): entry is RegistryPredicate {
  return entry.kind === "predicate" && "blocker" in entry;
}

/** One outcome from `docs/tracker-reconciliation.json`. */
export interface ReconciliationOutcome {
  readonly rowId: string;
  readonly kind: string;
  readonly verdict: string;
  readonly why: string;
  readonly read?: readonly string[];
  readonly evidence?: readonly string[];
}

const CLOSING = new Set(["Resolved", "Conditionally resolved"]);
const PRIORITY_RANK: Record<string, number> = { P1: 0, P2: 1, P3: 2 };

/** Open Needs-Sean rows: the section, and not carrying a closing resolution. */
export function openNeedsSeanRows(rows: readonly TrackerRow[]): TrackerRow[] {
  return rows.filter(
    (r) => (r.Section ?? "").trim() === "needs-sean" && !CLOSING.has((r.Resolution ?? "").trim()),
  );
}

function openedOnOf(row: TrackerRow): string | null {
  const raw = (row["Opened on"] ?? "").trim();
  return raw === "" || raw === UNKNOWN ? null : raw;
}

function blank(value: string | undefined): string | null {
  const v = (value ?? "").trim();
  return v === "" ? null : v;
}

/**
 * Build every card, sorted the way the owner view sorts: priority first, then
 * age OLDEST first (an unrecoverable date sorts as maximally old, never as
 * new), then id. `stamp` is today from `pnpm stamp`.
 */
export function buildDecisionCards(input: {
  readonly rows: readonly TrackerRow[];
  readonly registry: readonly RegistryEntry[];
  readonly outcomes: readonly ReconciliationOutcome[];
  readonly stamp: string;
}): OwnerDecisionCard[] {
  const entryById = new Map(input.registry.map((e) => [e.rowId, e]));
  const outcomeById = new Map(input.outcomes.map((o) => [o.rowId, o]));

  const cards = openNeedsSeanRows(input.rows).map((row): OwnerDecisionCard => {
    const rowId = (row.ID ?? "").trim();
    const entry = entryById.get(rowId) ?? null;
    const outcome = outcomeById.get(rowId) ?? null;
    const openedOn = openedOnOf(row);
    const ageDays = openedOn === null ? null : ageInDays(openedOn, input.stamp);
    const base = {
      rowId,
      title: (row.Title ?? "").trim(),
      // No tracker row carries this count; null says so (never a zero).
      blockedDescendants: null,
      openedOn,
      ageDays: typeof ageDays === "number" ? ageDays : null,
      priority: (row.Priority ?? "").trim() || "unprioritised",
      lastVerified: blank(row["Last verified"]),
    };

    if (entry !== null && isRegistryPredicate(entry)) {
      const kind: OwnerDecisionCardKind = "BLOCKED_WHILE";
      return {
        ...base,
        kind,
        verifiability: "PREDICATE",
        whatIsNeeded: `Blocked while ${entry.blocker}.`,
        whyNoMachineCanDecide:
          "This row is not a decision: it is a wall the machine rechecks on every tracker generation and clears itself when the blocker stops being true.",
        options: [],
        blocker: entry.blocker,
        checkedThisRun: outcome ? outcome.why : null,
      };
    }

    if (entry !== null) {
      const kind: OwnerDecisionCardKind = isInformational(entry) ? "ACKNOWLEDGE" : "DECISION";
      return {
        ...base,
        kind,
        verifiability: "NOT_MACHINE_VERIFIABLE",
        whatIsNeeded: entry.whatIsNeeded,
        whyNoMachineCanDecide: entry.whyNoMachineCanDecide,
        options: entry.options.map((o) => ({ option: o.option, consequence: o.consequence })),
        blocker: null,
        checkedThisRun: null,
      };
    }

    /*
     * A row with no registry entry escalated with no way back down, which
     * RULING 271 prohibits. It is published so the omission is visible on the
     * page rather than silent — the owner-view prints the same sentence.
     */
    const kind: OwnerDecisionCardKind = "DECISION";
    return {
      ...base,
      kind,
      verifiability: "NOT_MACHINE_VERIFIABLE",
      whatIsNeeded:
        "NO DECISION CARD. This row escalated with no card and no predicate, which RULING 271 prohibits; it is listed so the omission is visible.",
      whyNoMachineCanDecide: (row["What this is"] ?? "").trim() || "The row carries no description.",
      options: [],
      blocker: null,
      checkedThisRun: null,
    };
  });

  return cards.sort((a, b) => {
    const pa = PRIORITY_RANK[a.priority] ?? 9;
    const pb = PRIORITY_RANK[b.priority] ?? 9;
    if (pa !== pb) return pa - pb;
    const aa = a.ageDays === null ? Number.MAX_SAFE_INTEGER : a.ageDays;
    const ab = b.ageDays === null ? Number.MAX_SAFE_INTEGER : b.ageDays;
    if (aa !== ab) return ab - aa;
    return a.rowId.localeCompare(b.rowId);
  });
}

export { raiseDecisionOrder, decisionOrders, executeDecisionOrder } from "./decision-orders.ts";
export type { DecisionOrderCard, DecisionOrdersView } from "./decision-orders.ts";
