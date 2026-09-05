/**
 * **THE FLEET, IN THE OWNER'S FOUR WORDS.** (ADM-7, 9.4.26 admin feedback.)
 *
 * The owner's understanding of Pilot Health is an area to see what all the
 * workers are doing: hunters, detectives, auditors and verifiers — what they
 * are, what they are doing, how many are doing it, and where they are
 * deployed. The control plane records workers under seven canonical roles
 * (`WORKER_ROLES` in attempt.ts). This module is the PROJECTION from those
 * roles onto his words, and it is the only place that mapping lives:
 *
 *   HUNTERS      SCOUT + ACQUIRER      find where a record is, then fetch it
 *   DETECTIVES   DETECTIVE + PARSER    read what was fetched into typed facts
 *   VERIFIERS    VALIDATOR             check a Parser's records before trust
 *   AUDITORS     ADVERSARIAL_AUDITOR   try to break a record from independent evidence
 *   ENGINEERS    ENGINEERING           turn a verified method into reviewable code
 *
 * ENGINEERING is neither a hunter nor a verifier, so it is its own line rather
 * than being folded into one of the four silently — folding it would misreport
 * the fleet. RELEASE_ORCHESTRATOR has never written an Attempt and is not shown.
 *
 * Every number is a `Measured` with its denominator, and "where deployed" is
 * derived from the WorkItem each Attempt belongs to (its subject carries the
 * state in OCD form), never typed. PURE: canonical records in, view out.
 */
import type { Attempt, WorkerRole } from "./attempt.ts";
import { measured, type Measured } from "./owner-surface.ts";
import { US_STATES } from "./readiness/catalog.ts";
import type { RouteTask } from "./route-task.ts";
import { unitCarriesState } from "./scheduler/dispatch-target.ts";
import type { ResearchIntent } from "./scheduler/research-policy.ts";
import type { WorkItem } from "./work-item.ts";

export type FleetGroupKey = "hunters" | "detectives" | "verifiers" | "auditors" | "engineers";

export interface FleetGroupDefinition {
  readonly key: FleetGroupKey;
  readonly name: string;
  readonly roles: readonly WorkerRole[];
  /** What they are, in one plain sentence. */
  readonly what: string;
}

export const FLEET_GROUPS: readonly FleetGroupDefinition[] = [
  {
    key: "hunters",
    name: "Hunters",
    roles: ["SCOUT", "ACQUIRER"],
    what:
      "Find and fetch public records. A Scout works out where a body publishes a record; an Acquirer goes and gets it through the route the Scout found.",
  },
  {
    key: "detectives",
    name: "Detectives",
    roles: ["DETECTIVE", "PARSER"],
    what:
      "Read what was fetched. A Parser pulls typed records out of a document; a Detective settles one question at a time — same body or not, whole list or not, two sources agreeing or not — from evidence alone.",
  },
  {
    key: "verifiers",
    name: "Verifiers",
    roles: ["VALIDATOR"],
    what: "Check a Parser's records against the contract and against an outside authority before anything is trusted.",
  },
  {
    key: "auditors",
    name: "Auditors",
    roles: ["ADVERSARIAL_AUDITOR"],
    what:
      "Try to break a record. They build their own picture from the registry and the vault first, then attack the candidate; a record that survives is one we can stand behind.",
  },
  {
    key: "engineers",
    name: "Engineers",
    roles: ["ENGINEERING"],
    what: "Turn a verified method into code, proved in isolation and proposed for review — never merged on their own.",
  },
];

export interface FleetActivityLine {
  readonly at: string;
  readonly subject: string;
  readonly where: string | null;
  readonly role: WorkerRole;
  readonly outcome: string;
}

export interface FleetGroupView extends FleetGroupDefinition {
  /** Attempts open right now, of every Attempt recorded for these roles. */
  readonly working: Measured;
  /** Tasks waiting for these roles, of every task registered for them. */
  readonly queued: Measured;
  /** Attempts that finished COMPLETED, of every Attempt recorded. */
  readonly completed: Measured;
  /** Where these roles have worked: state names (or the raw subject), most-worked first. */
  readonly deployedAt: readonly { readonly label: string; readonly attempts: number }[];
  /** The newest activity, newest first, capped. */
  readonly latest: readonly FleetActivityLine[];
  /** One plain sentence built from the numbers above. */
  readonly doing: string;
}

export interface FleetView {
  readonly observedAt: string;
  readonly groups: readonly FleetGroupView[];
  /** Attempts whose role is on no group (RELEASE_ORCHESTRATOR today, or an unknown role). */
  readonly unassignedAttempts: number;
  readonly totalAttempts: number;
  readonly workingNow: number;
}

export interface FleetViewInput {
  readonly nowIso: string;
  readonly attempts: readonly Attempt[];
  readonly workItems: readonly WorkItem[];
  readonly routeTasks: readonly RouteTask[];
}

export const FLEET_LATEST_SHOWN = 3;

const STATE_NAME: ReadonlyMap<string, string> = new Map(US_STATES.map((s) => [s.code, s.name]));

/**
 * Where an Attempt worked, from its WorkItem: the state named in an OCD-shaped
 * subject (`state:az`), the plan's jurisdiction, or the subject itself. Null
 * when the WorkItem is not on record — never a guess.
 */
export function whereOf(subject: string | null, planJurisdiction: string | null): string | null {
  const jur = (planJurisdiction ?? "").trim();
  if (jur !== "") {
    const code = jur.toLowerCase();
    return STATE_NAME.get(code) ?? jur;
  }
  const hay = (subject ?? "").toLowerCase();
  // The same state-token rule the dispatch matcher and the publisher use —
  // one reading of "which state is this", never three.
  const state = US_STATES.find((s) => unitCarriesState(hay, s.code));
  if (state) return state.name;
  return subject && subject.trim() !== "" ? subject : null;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function buildFleetView(input: FleetViewInput): FleetView {
  const itemById = new Map(input.workItems.map((w) => [w.id, w]));
  const assigned = new Set<string>();
  let workingNow = 0;

  const groups = FLEET_GROUPS.map((def): FleetGroupView => {
    const roles = new Set<string>(def.roles);
    const attempts = input.attempts
      .filter((a) => roles.has(a.worker.role))
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt) || b.id.localeCompare(a.id));
    for (const a of attempts) assigned.add(a.id);
    const working = attempts.filter((a) => a.outcome === null).length;
    workingNow += working;
    const completed = attempts.filter((a) => a.outcome === "COMPLETED").length;
    const tasks = input.routeTasks.filter((t) => t.workerTask && roles.has(t.workerTask.role));
    const pending = tasks.filter((t) => t.state === "PENDING" || t.state === "RECLAIMABLE").length;

    const places = new Map<string, number>();
    for (const a of attempts) {
      const item = itemById.get(a.workItemId) ?? null;
      const label = whereOf(item?.subject ?? null, item?.autonomousPlan?.jurisdiction ?? null);
      if (label === null) continue;
      places.set(label, (places.get(label) ?? 0) + 1);
    }
    const deployedAt = [...places.entries()]
      .map(([label, n]) => ({ label, attempts: n }))
      .sort((x, y) => y.attempts - x.attempts || x.label.localeCompare(y.label));

    const latest = attempts.slice(0, FLEET_LATEST_SHOWN).map((a): FleetActivityLine => {
      const item = itemById.get(a.workItemId) ?? null;
      return {
        at: a.endedAt ?? a.startedAt,
        subject: item?.subject ?? a.workItemId,
        where: whereOf(item?.subject ?? null, item?.autonomousPlan?.jurisdiction ?? null),
        role: a.worker.role,
        outcome: a.outcome ?? "RUNNING",
      };
    });

    const source = `control-plane Attempts where worker.role in ${def.roles.join("|")}`;
    const doing =
      attempts.length === 0
        ? `No ${def.name.toLowerCase()} have run yet: the control plane holds no Attempt for ${def.roles.join(" or ")}.` +
          (pending > 0 ? ` ${plural(pending, "task")} waiting.` : "")
        : `${working === 0 ? "None working right now" : `${plural(working, "attempt")} open right now`}; ` +
          `${plural(pending, "task")} waiting of ${tasks.length} registered; ` +
          `${completed} of ${attempts.length} recorded attempts finished` +
          (deployedAt.length > 0 ? `; worked in ${deployedAt.slice(0, 3).map((d) => d.label).join(", ")}` : "") +
          ".";

    return {
      ...def,
      working: measured(
        working,
        Math.max(attempts.length, working),
        "Attempts open right now (no outcome yet), out of every Attempt recorded for these roles",
        source,
      ),
      queued: measured(
        pending,
        Math.max(tasks.length, pending),
        "PENDING or RECLAIMABLE tasks for these roles, out of every task registered for them",
        `control-plane RouteTasks where workerTask.role in ${def.roles.join("|")}`,
      ),
      completed: measured(
        completed,
        Math.max(attempts.length, completed),
        "Attempts that ended COMPLETED, out of every Attempt recorded for these roles",
        source,
      ),
      deployedAt,
      latest,
      doing,
    };
  });

  return {
    observedAt: input.nowIso,
    groups,
    unassignedAttempts: input.attempts.filter((a) => !assigned.has(a.id)).length,
    totalAttempts: input.attempts.length,
    workingNow,
  };
}

/** Every Measured the view renders, for the page's self-audit. */
export function fleetRenderedNumbers(view: FleetView): readonly Measured[] {
  return view.groups.flatMap((g) => [g.working, g.queued, g.completed]);
}

/* ------------------------------------------------------------ deployments */

/** One "Deploy fleet" the owner sent (ADM-8), with what became of it. */
export interface DeploymentRow {
  readonly intentId: string;
  readonly requestedAt: string;
  readonly target: string;
  readonly by: string;
  readonly status: "HONORED" | "PENDING";
  readonly honoredAt: string | null;
  readonly honoredBy: string | null;
  /** The runner's own sentence: what matched of what, or why nothing did. */
  readonly detail: string | null;
}

/** Every DISPATCH intent in the log, newest first, with its HONORED record joined. */
export function dispatchHistory(log: readonly ResearchIntent[]): DeploymentRow[] {
  const honored = new Map<string, Extract<ResearchIntent, { readonly kind: "HONORED" }>>();
  for (const r of log) if (r.kind === "HONORED") honored.set(r.honors, r);
  return log
    .filter((r): r is Extract<ResearchIntent, { readonly kind: "INTENT" }> => r.kind === "INTENT" && r.action === "DISPATCH")
    .map((i): DeploymentRow => {
      const h = honored.get(i.intentId) ?? null;
      return {
        intentId: i.intentId,
        requestedAt: i.requestedAt,
        target: i.note ?? "",
        by: i.actor,
        status: h ? "HONORED" : "PENDING",
        honoredAt: h?.honoredAt ?? null,
        honoredBy: h?.honoredBy ?? null,
        detail: h?.detail ?? null,
      };
    })
    .sort((a, b) => (a.requestedAt < b.requestedAt ? 1 : a.requestedAt > b.requestedAt ? -1 : 0));
}
