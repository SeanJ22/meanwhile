import type { Attempt, WorkerRole } from "./attempt.ts";
import { displayNameOf } from "./display-name.ts";
import { measured, type Measured } from "./owner-surface.ts";
import { US_STATES } from "./readiness/catalog.ts";
import type { RouteTask } from "./route-task.ts";
import { stateOfSubjectPlace } from "./unit-state.ts";
import type { ResearchIntent } from "./scheduler/research-policy.ts";
import type { WorkItem } from "./work-item.ts";

export type FleetGroupKey = "hunters" | "detectives" | "verifiers" | "auditors" | "engineers";

export interface FleetGroupDefinition {
  readonly key: FleetGroupKey;
  readonly name: string;
  readonly roles: readonly WorkerRole[];
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
  readonly working: Measured;
  readonly queued: Measured;
  readonly completed: Measured;
  readonly deployedAt: readonly { readonly label: string; readonly attempts: number }[];
  readonly latest: readonly FleetActivityLine[];
  readonly doing: string;
}

export interface FleetView {
  readonly observedAt: string;
  readonly groups: readonly FleetGroupView[];
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

export function whereOf(subject: string | null, planJurisdiction: string | null): string | null {
  const jur = (planJurisdiction ?? "").trim();
  if (jur !== "") {
    const code = jur.toLowerCase();
    return STATE_NAME.get(code) ?? jur;
  }
  const code = stateOfSubjectPlace(subject ?? "");
  if (code) return STATE_NAME.get(code) ?? code;
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
          (deployedAt.length > 0 ? `; worked in ${deployedAt.slice(0, 3).map((d) => displayNameOf(d.label).short).join(", ")}` : "") +
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

export function fleetRenderedNumbers(view: FleetView): readonly Measured[] {
  return view.groups.flatMap((g) => [g.working, g.queued, g.completed]);
}

export interface DeploymentRow {
  readonly intentId: string;
  readonly requestedAt: string;
  readonly target: string;
  readonly by: string;
  readonly status: "HONORED" | "PENDING";
  readonly honoredAt: string | null;
  readonly honoredBy: string | null;
  readonly detail: string | null;
}

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
