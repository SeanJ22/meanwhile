/**
 * **THIRTY INCIDENT LINES BECOME FOUR GROUPS WITH ACTIONS.** (ADM-28, ADM-29,
 * ADM-30; §9A.3 of the Admin C brief.)
 *
 * What the owner saw, and said:
 *
 * > *"It says 'incidents,' which has a dropdown of upstream error at candidate
 * > marginalia index. I need these replaced. What does this even mean? How am I
 * > supposed to translate this? 'Refused by host at CFS transaction detail, New
 * > Hampshire, 1 obligation, oldest 118 hours.' Does that mean I need to take
 * > action on something? … There's clearly a ton of information here but it
 * > doesn't give me anything to act on, to make a decision on, or to at least
 * > just be informed."*
 *
 * And on the three headline numbers above them:
 *
 * > *"277 units carrying freshness debt of 2991 registered. What does that even
 * > mean? … I don't know what those numbers represent."*
 *
 * ## What this module decides, and on what authority
 *
 * Every debt cause in `scheduler/debt.ts` is documented there as TRANSIENT and
 * self-retrying — a permanent condition is a DISPOSITION on the obligation, not
 * debt. So the honest default group is *"will retry by itself"*, and the module
 * may not invent a "needs you" out of a cause code alone.
 *
 * What DOES earn the owner's attention is **age**. RULING 218 says a late or
 * failed dispatch is an engineering and freshness defect and never a Needs-Owner
 * escalation by itself; but the spreadsheet's note on ADM-30 is the other half
 * of the same coin: *"The 'oldest 577 h' items are three weeks old. If they need
 * Sean, he should have been told three weeks ago."* A source that has refused
 * every retry for days is no longer retrying its way out of the problem, and
 * saying so is not an escalation of the cause — it is a report about the debt.
 *
 * So: cause decides the GROUP, age decides whether the group is escalated, and
 * the threshold is named here rather than buried.
 *
 * PURE. Incidents and a clock in, groups out.
 */
import { ageWords, count, plainCode, plainMeaning } from "./plain-words.ts";

/** One incident as the owner snapshot carries it. */
export interface IncidentRow {
  readonly cause: string;
  readonly target: string;
  readonly obligationsAffected: number;
  readonly oldestHours: number | null;
}

/**
 * Past this, a self-retrying failure has demonstrably not retried its way out
 * and the owner should know. Three days: long enough that a weekend outage and
 * a slow upstream fix pass without noise, short enough that a three-week-old
 * wall can never again go unmentioned.
 */
export const STUCK_HOURS = 72;

/** The four owner-facing groups, in the order they are shown. */
export const INCIDENT_GROUPS = ["NEEDS_YOU", "WILL_RETRY", "WAITING", "NOT_REACHED"] as const;
export type IncidentGroupKey = (typeof INCIDENT_GROUPS)[number];

export interface IncidentGroup {
  readonly key: IncidentGroupKey;
  /** The group's name on the page. */
  readonly title: string;
  /** One sentence: what this group of incidents is. */
  readonly means: string;
  /** What the owner should do, or null when nothing. */
  readonly action: string | null;
  readonly incidents: readonly IncidentRow[];
  /** Obligations behind this group, summed. */
  readonly obligations: number;
  /** The oldest age in the group, in hours, or null when nothing recorded one. */
  readonly oldestHours: number | null;
  /** The group's headline sentence, already assembled. */
  readonly says: string;
}

/**
 * Which group a cause belongs to before age is considered.
 *
 * `NEVER_DISPATCHED` is its own group because it is not a failure at all: the
 * work was scheduled and the cycle ran out before reaching it. Rendering it
 * beside a host refusal taught the owner that both were breakage.
 */
function baseGroup(cause: string): IncidentGroupKey {
  if (cause === "NEVER_DISPATCHED") return "NOT_REACHED";
  if (cause === "WORKER_LOST") return "WAITING";
  return "WILL_RETRY";
}

const GROUP_TEXT: Readonly<Record<IncidentGroupKey, { title: string; means: string; action: string | null }>> = {
  NEEDS_YOU: {
    title: "Needs you",
    means: `A source has been refusing or failing for more than ${STUCK_HOURS} hours. Retrying has not got past it, so something outside the system has to change — usually access, a credential, or a different route.`,
    action: "put it on the fix queue so a work session takes the wall apart",
  },
  WILL_RETRY: {
    title: "Will retry automatically",
    means: "A source refused us, was slow, or broke while answering. Each of these retries by itself on a schedule that backs off. Nothing was dropped.",
    action: null,
  },
  WAITING: {
    title: "Waiting on another step",
    means: "The work was picked up and the worker holding it went away, so it went back in the queue for the next cycle.",
    action: null,
  },
  NOT_REACHED: {
    title: "Not reached yet",
    means: "These were scheduled and their turn came and went before a cycle got to them. They are still owed and keep their place in line.",
    action: null,
  },
};

/** Group the incidents, escalating a stuck group into `Needs you`. */
export function groupIncidents(incidents: readonly IncidentRow[]): readonly IncidentGroup[] {
  const buckets = new Map<IncidentGroupKey, IncidentRow[]>();
  for (const key of INCIDENT_GROUPS) buckets.set(key, []);
  for (const incident of incidents) {
    const stuck = (incident.oldestHours ?? 0) >= STUCK_HOURS;
    const base = baseGroup(incident.cause);
    const key: IncidentGroupKey = stuck && base === "WILL_RETRY" ? "NEEDS_YOU" : base;
    buckets.get(key)?.push(incident);
  }
  return INCIDENT_GROUPS.map((key) => {
    const rows = (buckets.get(key) ?? []).slice().sort((a, b) => (b.oldestHours ?? 0) - (a.oldestHours ?? 0));
    const obligations = rows.reduce((n, r) => n + r.obligationsAffected, 0);
    const ages = rows.map((r) => r.oldestHours).filter((h): h is number => h !== null);
    const oldestHours = ages.length > 0 ? Math.max(...ages) : null;
    const text = GROUP_TEXT[key];
    const says =
      rows.length === 0
        ? "Nothing here."
        : `${count(rows.length)} source${rows.length === 1 ? "" : "s"}, ${count(obligations)} record${obligations === 1 ? "" : "s"} behind ${rows.length === 1 ? "it" : "them"}` +
          (oldestHours === null ? "." : `; the oldest has been waiting ${ageWords(oldestHours)}.`);
    return { key, title: text.title, means: text.means, action: text.action, incidents: rows, obligations, oldestHours, says };
  }).filter((g) => g.incidents.length > 0);
}

/**
 * One incident line, in the owner's words.
 *
 * The target is a source name and stays as it is — the page renders it through
 * `Name` for its display form. The cause becomes words and the age becomes
 * ordinary time.
 */
export function incidentLine(incident: IncidentRow): { readonly cause: string; readonly says: string } {
  const cause = plainCode(incident.cause);
  const means = plainMeaning(incident.cause);
  const behind = `${count(incident.obligationsAffected)} record${incident.obligationsAffected === 1 ? "" : "s"} behind it`;
  const age = incident.oldestHours === null ? "" : `, waiting ${ageWords(incident.oldestHours)}`;
  return { cause, says: `${means ?? cause} ${behind}${age}.` };
}

/* ------------------------------------------------------- the three numbers */

/**
 * The definitions the summary tiles carry beneath their numbers.
 *
 * ADM-28's note is the reason this is a constant and not three strings inside
 * a component: *"'Obligation' is the load-bearing word of the whole dashboard
 * and it is never defined on the page."* It is defined once, here, and every
 * surface that says the word can say what it means.
 */
export const OBLIGATION_MEANS = "A record the system has promised to keep current.";
export const FRESHNESS_DEBT_MEANS = "Records that are overdue to be checked again.";
export const INCIDENT_MEANS = "One shared reason a group of records cannot be refreshed right now.";

/**
 * What "Other" contains in `Obligations by state` (ADM-29 — the owner red-boxed
 * it and asked *"what is 'other'?"*).
 *
 * Read back from the production control plane on 2026-09-06 after the
 * attribution fix in `unit-state.ts`: `Other` is five obligations from one
 * proof run (`ocd-division/proof:0…4`), which genuinely name no state. The
 * other nine that used to sit here were Arizona campaign-finance work the old
 * matcher could not see. `Other` is a real category and the page names it.
 */
export const OTHER_STATE_MEANS =
  "Work that belongs to no single state — a national source, or a test run that names no place.";
