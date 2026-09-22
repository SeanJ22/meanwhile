/**
 * **SMALL RENDERERS SHARED BY THE ASSIGNMENT LIST AND ITS DRILLDOWN.**
 *
 * Each takes an already-projected value from `lib/control-plane/assignment-view.ts`
 * and renders it in the owner's words: a state as its plain label in its
 * colour, a lane as its label, a worker as role and model name ("model not
 * recorded" when it was not), a wait as its age against the render clock.
 * Nothing here reads a store, the environment or a clock of its own.
 */
import {
  LANE_WORDS,
  OWNER_WORDS,
  STATE_WORDS,
  waitingHours,
  type AssignmentLane,
  type AssignmentState,
  type NextStepOwner,
  type WorkerModel,
} from "@/lib/control-plane/assignment-view.ts";
import { ageWords, count, modelName, plainCode } from "@/lib/control-plane/plain-words.ts";

export const ASSIGNMENTS_PATH = "/admin/assignments";

const TONE_CLASS: Record<(typeof STATE_WORDS)[AssignmentState]["tone"], string> = {
  green: "state-green",
  amber: "state-amber",
  red: "state-red",
  unknown: "state-unknown",
  working: "outcome-running",
};

/** A state, in its plain label and its colour, with what it means on hover. */
export function StateWord({ state }: { state: AssignmentState }) {
  const words = STATE_WORDS[state];
  return (
    <span className={TONE_CLASS[words.tone]} title={words.means}>
      {words.label}
    </span>
  );
}

/** A lane, as a chip, with what it means on hover. */
export function LaneChip({ lane }: { lane: AssignmentLane }) {
  return (
    <span className="chip" title={LANE_WORDS[lane].means}>
      {LANE_WORDS[lane].label}
    </span>
  );
}

/** Who owns the next step, in words. */
export function OwnerWord({ owner }: { owner: NextStepOwner }) {
  return <span className={owner === "OWNER" ? "needs-yes" : undefined}>{OWNER_WORDS[owner]}</span>;
}

/** A worker's model as the owner reads it; never an assumed model. */
export function ModelWords({ model }: { model: WorkerModel }) {
  if (model.kind === "MODEL") return <span title={model.id}>{modelName(model.id)}</span>;
  if (model.kind === "PLAIN_CODE") return <span title={model.tool}>plain code, no model</span>;
  return <span className="gap">{model.says}</span>;
}

/** How many attempts, in words; an uncounted number says so and is never shown as a figure. */
export function AttemptWords({ n }: { n: number | null }) {
  if (n === null) return <span className="gap">attempts not counted</span>;
  return (
    <>
      {count(n)} attempt{n === 1 ? "" : "s"}
    </>
  );
}

/** The workers on an assignment: role, model and how many attempts each. */
export function WorkersWords({
  workers,
}: {
  workers: readonly { readonly role: string; readonly model: WorkerModel; readonly attempts: number | null }[] | null;
}) {
  if (workers === null) return <span className="gap">no worker has taken it yet</span>;
  return (
    <>
      {workers.map((w, i) => (
        <span key={`${w.role}-${i}`}>
          {i > 0 ? "; " : ""}
          {plainCode(w.role)} · <ModelWords model={w.model} /> · <AttemptWords n={w.attempts} />
        </span>
      ))}
    </>
  );
}

/** How long something has waited, against the render clock; a wait measured from nothing says so. */
export function AgeWords({ since, nowIso }: { since: string | null; nowIso: string }) {
  const hours = waitingHours({ waiting: { since } }, nowIso);
  if (hours === null) return <span className="note">no wait is measured</span>;
  return <span title={since === null ? undefined : since}>{ageWords(hours)}</span>;
}

/** The href that opens one assignment's full chain. */
export function assignmentHref(id: string): string {
  return `${ASSIGNMENTS_PATH}?id=${encodeURIComponent(id)}`;
}
