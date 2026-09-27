/**
 * **ASSIGNMENTS, AS THE DESIGN DRAWS THEM.** (Admin redesign, 2026-09-23 —
 * Fleet · Work.)
 *
 * Two kinds of assignment share one list and one reference scheme:
 *
 * ```
 *   your instructions   a geography you selected (the policy row), with its
 *                       priority, budget and your words; the runner reads it
 *                       each cycle and says so in its expansion reading
 *   standing work       every unit of work the system owes on its own — a
 *                       standing obligation, a created work item, a routine
 *                       contract — from the published assignment view
 * ```
 *
 * The acknowledgement of an instruction (MW-026) is derived, never invented:
 * saved is the decision's own time and receipt; read by the runner is the
 * expansion reading of a cycle that started after the decision; placed first,
 * running and blocked come from that reading, the assignment states in the
 * geography and the paid lane's standing. "Completed" has no rule for a
 * geography yet (MW-015), so it is never shown as reached.
 *
 * PURE.
 */
import {
  OWNER_WORDS,
  STATE_WORDS,
  type AssignmentListRow,
  type AssignmentRow,
  type AssignmentState,
  type WorkerModel,
} from "../assignment-view.ts";
import type { ExpansionCycleReading, ExpansionScopeReading } from "../expansion/reading.ts";
import { SCOPE_TYPE_WORDS, scopeKeyOf, type ExpansionScopeDecision } from "../expansion/scopes.ts";
import type { DispatchWorkReading } from "../expansion/dispatch-work.ts";
import { assignmentsInScope, runnerViewFor, scopeCreationSentence, scopeCreationView, type ScopeAssignmentView } from "../expansion/view.ts";
import { PUBLIC_SITE_ORIGIN } from "../../ops/origins.ts";
import { formatEastern } from "../eastern-time.ts";
import type { AssignmentReading } from "../expansion/assignment-budget.ts";
import { modelName } from "../plain-words.ts";
import { WORK_QUESTION_WORDS } from "../work-question.ts";
import { assignmentCompletionWords } from "../assignment-completion.ts";
import type { ScoutResult } from "../scheduler/scout-result.ts";
import type { BodyView } from "./bodies.ts";
import { latestScout, scoutDeadEnd, type DeadEndGaps } from "./dead-ends.ts";
import { scoutModelLine } from "./model-ladder-view.ts";

export type Tone = "teal" | "gold" | "amber" | "cyan" | "slate" | "stone";

export const STATE_PILL: Readonly<Record<AssignmentState, { readonly pill: string; readonly tone: Tone }>> = {
  WORKING: { pill: "RUNNING", tone: "teal" },
  BLOCKED: { pill: "BLOCKED", tone: "amber" },
  FAILED: { pill: "FAILED · RETRIES ITSELF", tone: "amber" },
  WAITING: { pill: "QUEUED", tone: "cyan" },
  SUCCEEDED: { pill: "LAST ROUND DONE", tone: "teal" },
  RETIRED: { pill: "RETIRED", tone: "slate" },
  UNKNOWN: { pill: "CAN'T TELL", tone: "gold" },
};

function money(usd: number): string {
  return `$${usd.toFixed(2)}`;
}

/** The plain-English class on the face, the real model in the detail (settled decision 6). */
export function modelClassOf(model: WorkerModel): { readonly pill: string; readonly tone: Tone; readonly detail: string } {
  if (model.kind === "PLAIN_CODE") return { pill: "NO AI NEEDED", tone: "slate", detail: "plain code" };
  if (model.kind === "NOT_RECORDED") return { pill: "MODEL NOT RECORDED", tone: "gold", detail: model.says };
  const id = model.id.toLowerCase();
  const name = modelName(model.id);
  if (id.includes("haiku")) return { pill: "CHEAPEST AI", tone: "cyan", detail: name };
  if (id.includes("sonnet")) return { pill: "MID AI", tone: "cyan", detail: name };
  if (id.includes("opus")) return { pill: "MOST CAPABLE AI", tone: "stone", detail: name };
  return { pill: "AI", tone: "cyan", detail: name };
}

export interface CardView {
  readonly id: string;
  readonly kind: "INSTRUCTION" | "STANDING";
  readonly pill: string;
  readonly tone: Tone;
  readonly title: string;
  readonly summary: string;
}

/** One standing-work row as the list card draws it. */
export function standingCard(row: AssignmentListRow): CardView {
  const p = STATE_PILL[row.state];
  const cost =
    row.cost.kind === "MEASURED" && row.cost.usd
      ? ` ${money(row.cost.usd.value)} across ${row.cost.attempts ?? "an uncounted number of"} attempts${row.cost.retries ? `, ${row.cost.retries} of them retries` : ""}.`
      : row.cost.kind === "PLAIN_CODE"
        ? " Plain code: no model cost."
        : row.cost.kind === "UNMEASURED"
          ? " Its model cost was not reported — unknown, not zero."
          : "";
  return {
    id: row.id,
    kind: "STANDING",
    pill: p.pill,
    tone: p.tone,
    title: row.subjectName ? `${row.title} — ${row.subjectName}` : row.title,
    summary: `${row.stateSays}${cost}`,
  };
}

export interface LaneCard {
  readonly name: string;
  readonly pill: string;
  readonly tone: Tone;
  readonly rows: readonly (readonly [string, string])[];
  readonly note: string;
}

export interface ModelLine {
  readonly pill: string;
  readonly tone: Tone;
  readonly step: string;
  readonly model: string;
  readonly cost: string;
  readonly why: string;
}

export interface OutcomeCell {
  readonly key: string;
  readonly label: string;
  readonly value: number | null;
  readonly unknown: string;
  readonly tone: "text" | "muted" | "gold";
}

export interface TrailLine {
  readonly pill: string;
  readonly tone: Tone;
  readonly title: string;
  readonly trail: readonly (readonly [string, string])[];
}

export interface Unsettled {
  readonly pill: string;
  readonly title: string;
  readonly ruledOut: string | null;
  readonly wouldSettle: string | null;
  readonly whoMoves: string | null;
  /** Why a null field is missing, named (MW-016). */
  readonly gaps?: DeadEndGaps;
}

export interface AssignmentDetailView {
  readonly words: string | null;
  readonly wordsNote: string;
  readonly addresses: readonly { readonly id: string; readonly text: string; readonly pill: string; readonly tone: Tone }[];
  readonly addressesNote: string;
  readonly lanes: readonly LaneCard[];
  readonly models: readonly ModelLine[];
  readonly modelsNote: string;
  readonly outcomes: readonly OutcomeCell[];
  readonly promoted: readonly TrailLine[];
  readonly promotedNote: string | null;
  readonly unsettled: readonly Unsettled[];
  readonly costLine: string;
}

const ROLE_WORDS: Readonly<Record<string, string>> = {
  SCOUT: "Research a way in (the Scout)",
  ACQUIRER: "Fetch the record from its source",
  PARSER: "Read the fetched document",
  VALIDATOR: "Check the record",
  ADVERSARIAL_AUDITOR: "Audit the finding adversarially",
  DETECTIVE: "Settle a contradiction",
  ENGINEERING: "Engineering work",
  RELEASE_ORCHESTRATOR: "Release orchestration",
};

/**
 * MW-035: why this work reached the paid Scout, in the executor decision's own
 * words (`ScoutResult.reason` is the decision's `why`, recorded when the walk
 * was sent), never a fixed standing-rule sentence. Where the reasons of the
 * walks differ, the latest leads and the count of others is said.
 */
function scoutDecisionWords(scouts: readonly ScoutResult[] | null, latest: ScoutResult | null): string {
  if (scouts === null) return "Why the executor sent this to a paid Scout was not read with it.";
  if (latest === null) return "No Scout walk is on record, so why the executor chose a paid model is not recorded here.";
  const reason = latest.reason.trim();
  if (reason === "") return `The executor sent it to a paid Scout (walk of ${formatEastern(latest.recordedAt)}); its reason was not recorded on the result.`;
  const others = new Set(scouts.map((s) => s.reason.trim()).filter((r) => r !== "" && r !== reason)).size;
  return `Executor decision: a bounded model worker (the Scout), because ${reason.replace(/\.$/, "")}.${others > 0 ? ` Earlier walks were sent for ${others} other ${others === 1 ? "reason" : "reasons"}.` : ""}`;
}

/**
 * MW-031/MW-033: which class the latest Scout walk started on, why, and — when
 * it moved up or was refused a move — the evidence and what the tries cost
 * together, in the ladder's own words (`scoutModelLine`). Never a fixed claim
 * about where the loop starts.
 */
function scoutClassWords(scouts: readonly ScoutResult[] | null, latest: ScoutResult | null): string {
  if (scouts === null) return "Which class it started on was not read with it.";
  if (latest === null) return "";
  const line = scoutModelLine(latest);
  /* A walk recorded before the ladder carries no class of its own; say when it ran, not a rule as though it still held. */
  if (latest.modelClass === undefined) return `Ran on ${line.chosen}: this walk was recorded before the ladder (Sep 25), when the research loop always started on the most capable class.`;
  return `Started on ${line.chosen}: ${line.why.replace(/\.$/, "")}. ${line.escalation ?? "It did not move up a class."}`;
}

/** MW-031: the model-routing escalations this work's Scout walks recorded, counted from the walks themselves. */
function routingEscalationWords(scouts: readonly ScoutResult[] | null): string {
  if (scouts === null) return "Model-routing escalations: not read with this work.";
  if (scouts.length === 0) return "Model-routing escalations: none — no Scout walk is on record for this work.";
  const moved = scouts.filter((s) => s.escalatedFrom !== null && s.escalatedFrom !== undefined && !s.escalationRefused);
  const refused = scouts.filter((s) => s.escalationRefused !== null && s.escalationRefused !== undefined);
  if (moved.length === 0 && refused.length === 0) {
    return `Model-routing escalations: none — ${scouts.length === 1 ? "its Scout walk" : `all ${scouts.length} Scout walks`} finished on the class ${scouts.length === 1 ? "it" : "they"} started on.`;
  }
  const newest = latestScout([...moved, ...refused]);
  const said = newest === null ? null : scoutModelLine(newest).escalation;
  return (
    `Model-routing escalations: ${moved.length} on record for this work` +
    (refused.length > 0 ? `, and ${refused.length} more called for and refused` : "") +
    `.${said ? ` Latest: ${said}` : ""}`
  );
}

/**
 * The opened standing assignment, from its full row (read live by id), and
 * the Scout results read with it. Those results say why the work reached a
 * paid model (MW-035) and what its dead ends ruled out and would settle
 * (MW-016); absent, each says it was not read rather than borrowing a rule.
 */
export function standingDetail(row: AssignmentRow, evidence: { readonly scouts?: readonly ScoutResult[] | null } = {}): AssignmentDetailView {
  const scouts = evidence.scouts ?? null;
  const latest = scouts === null ? null : latestScout(scouts);
  const d = row.discovery.discovered.held ? row.discovery.discovered.value : null;
  const dl = row.discovery.downloaded.held ? row.discovery.downloaded.value : null;
  const pipeline = row.verification.pipeline.held ? row.verification.pipeline.value : null;
  const parsed = row.parsing.parsed.held ? row.parsing.parsed.value : null;
  const workers = row.what.workers.held ? row.what.workers.value : [];

  const lanes: LaneCard[] = [
    {
      name: "Discovery",
      pill: d === null ? "NOT RUN" : d.routes + d.records + d.pointers > 0 ? "FOUND" : "NOTHING FOUND",
      tone: d === null ? "slate" : d.routes + d.records + d.pointers > 0 ? "teal" : "gold",
      rows: d
        ? [
            ["Routes", String(d.routes)],
            ["Records", String(d.records)],
            ["Pointers", String(d.pointers)],
          ]
        : [["Rounds", row.discovery.rounds === null ? "not counted" : String(row.discovery.rounds)]],
      note: d?.says ?? (row.discovery.discovered.held ? "" : row.discovery.discovered.gap.says),
    },
    {
      name: "Acquisition",
      pill: dl === null ? "NOT RUN" : dl.count > 0 ? "DOWNLOADED" : "NOTHING DOWNLOADED",
      tone: dl === null ? "slate" : dl.count > 0 ? "teal" : "gold",
      rows: dl
        ? [
            ["Documents", String(dl.count)],
            ["Complete", `${dl.complete.value} of ${dl.complete.denominator}`],
            ["Parsed", parsed ? `${parsed.succeeded} ok · ${parsed.failed} failed` : "no parse ran"],
          ]
        : [["Attempts", row.discovery.attempts === null ? "not counted" : String(row.discovery.attempts)]],
      note: dl?.says ?? (row.discovery.downloaded.held ? "" : row.discovery.downloaded.gap.says),
    },
    {
      name: "Validation",
      pill: pipeline === null ? "NOT RUN" : pipeline.rejected.value > 0 && pipeline.passed.value === 0 ? "BLOCKED" : pipeline.passed.value > 0 ? "PASSED" : "WAITING",
      tone: pipeline === null ? "slate" : pipeline.rejected.value > 0 && pipeline.passed.value === 0 ? "amber" : pipeline.passed.value > 0 ? "teal" : "cyan",
      rows: pipeline
        ? [
            ["Passed", String(pipeline.passed.value)],
            ["Needs evidence", String(pipeline.needsMoreEvidence.value)],
            ["Rejected", String(pipeline.rejected.value)],
          ]
        : [],
      note: pipeline?.says ?? (row.verification.pipeline.held ? "" : row.verification.pipeline.gap.says),
    },
  ];

  const measuredUsd = row.cost.dollars.kind === "MEASURED" ? row.cost.dollars.amount : null;
  const models: ModelLine[] = workers.map((w) => {
    const c = modelClassOf(w.model);
    const isModel = w.model.kind === "MODEL";
    return {
      pill: c.pill,
      tone: c.tone,
      step: ROLE_WORDS[w.role] ?? w.role,
      model: c.detail,
      cost: isModel ? (measuredUsd !== null ? money(measuredUsd) : "not reported") : "no cost",
      why: isModel
        ? w.role === "SCOUT"
          ? [scoutDecisionWords(scouts, latest), scoutClassWords(scouts, latest), `${w.attempts ?? "An uncounted number of"} attempts.`].filter((s) => s !== "").join(" ")
          : `${w.attempts ?? "An uncounted number of"} attempts.`
        : `Plain code can do this, so it cannot reach a model at all. ${w.attempts ?? "An uncounted number of"} attempts.`,
    };
  });

  const refusedCount = (pipeline?.rejected.value ?? 0) + row.verification.refusedFinishCount;
  const outcomes: OutcomeCell[] = [
    { key: "new", label: "New", value: row.delivery.records?.added ?? null, unknown: "NOT COMPARED", tone: "text" },
    { key: "changed", label: "Changed", value: row.delivery.records?.changed ?? null, unknown: "NOT COMPARED", tone: "text" },
    { key: "unchanged", label: "Reused", value: row.delivery.records?.reused ?? null, unknown: "NOT COMPARED", tone: "text" },
    { key: "refused", label: "Refused", value: refusedCount, unknown: "", tone: refusedCount > 0 ? "gold" : "muted" },
    { key: "unsettled", label: "Unsettled", value: pipeline ? pipeline.needsMoreEvidence.value : null, unknown: "NOT RUN", tone: pipeline && pipeline.needsMoreEvidence.value > 0 ? "gold" : "muted" },
  ];

  const promotedTrail: TrailLine[] = [];
  const promoted = row.delivery.promoted.held ? row.delivery.promoted.value : null;
  const available = row.delivery.publiclyAvailable.held ? row.delivery.publiclyAvailable.value : null;
  if (promoted && promoted.state === "PROMOTED") {
    promotedTrail.push({
      pill: available?.state === "CONFIRMED" ? "CONFIRMED PUBLIC" : "PROMOTED, NOT CONFIRMED",
      tone: available?.state === "CONFIRMED" ? "teal" : "gold",
      title: row.what.title,
      trail: [
        ["Promoted", `${promoted.at ? formatEastern(promoted.at) : "at no recorded time"}${promoted.versionId ? `, version ${promoted.versionId}` : ""}`],
        ["Says", promoted.says],
        ["Public destination", available ? `${available.says}${available.at ? ` (checked ${formatEastern(available.at)})` : ""}` : row.delivery.publiclyAvailable.held ? "" : row.delivery.publiclyAvailable.gap.says],
        ["Never proves", "That a person actually viewed it. Available is not read."],
      ],
    });
  }
  const promotedNote =
    promotedTrail.length > 0
      ? null
      : `Nothing from this assignment reached the public site. ${promoted?.says ?? (row.delivery.promoted.held ? "" : row.delivery.promoted.gap.says)}${row.delivery.blockers.length > 0 ? ` ${row.delivery.blockers.join(" ")}` : ""}`;

  /*
   * MW-016: a dead end reads its three fields from the latest Scout walk —
   * failed rungs, next rungs, the outcome's owner — and falls back to the
   * row's own next action and owner only where no walk answers. A field
   * neither can answer stays null with its gap named.
   */
  const unsettled: Unsettled[] = [];
  const w = row.waiting;
  const notRead = "the Scout results for this work were not read with it";
  if (row.state === "BLOCKED" || row.state === "FAILED" || row.state === "UNKNOWN") {
    const walk = scouts === null ? null : scoutDeadEnd(latest, { retryAt: w.retryAt });
    const wouldSettle = walk?.wouldSettle ?? (w.nextAction || null);
    const whoMoves = walk?.whoMoves ?? `${OWNER_WORDS[w.owner]}${w.backoff ? ` — ${w.backoff.says}` : ""}`;
    unsettled.push({
      pill: row.state === "BLOCKED" ? "BLOCKED" : row.state === "FAILED" ? "FAILED" : "CAN'T TELL",
      title: w.blocker.kind === "NAMED" ? w.blocker.says : w.blocker.kind === "UNKNOWN" ? w.blocker.gap.says : row.stateSays,
      ruledOut: walk?.ruledOut ?? null,
      wouldSettle,
      whoMoves,
      gaps: {
        ...(walk?.ruledOut ? {} : { ruledOut: walk?.gaps.ruledOut ?? notRead }),
        ...(wouldSettle !== null ? {} : { wouldSettle: walk?.gaps.wouldSettle ?? "no next action is recorded for this work" }),
      },
    });
  }
  for (const r of row.verification.refusedFinishes.slice(0, 3)) {
    /* The refused walk itself: its rungs are machine-derived, so what it ruled out and named next still stand. */
    const walk = scouts === null ? null : scoutDeadEnd(scouts.find((s) => s.attemptId === r.attemptId) ?? null);
    unsettled.push({
      pill: "REFUSED",
      title: `A finish was refused on ${formatEastern(r.at)}: ${r.says}`,
      ruledOut: walk?.ruledOut ?? null,
      wouldSettle: walk?.wouldSettle ?? null,
      whoMoves: walk?.whoMoves ?? OWNER_WORDS[w.owner],
      gaps: walk === null ? { ruledOut: notRead, wouldSettle: notRead } : walk.gaps,
    });
  }

  const c = row.cost;
  const costLine =
    c.dollars.kind === "MEASURED"
      ? `${money(c.dollars.amount)} measured across ${c.attempts ?? "an uncounted number of"} attempts in ${c.rounds ?? "an uncounted number of"} rounds; ${c.retries ?? "an uncounted number of"} retries. ${c.unmeasured + c.attemptsWithoutCostRow > 0 ? `${c.unmeasured + c.attemptsWithoutCostRow} model attempts reported no cost — unknown, not zero. ` : ""}Escalations to you: ${c.escalations.toOwner}. ${routingEscalationWords(scouts)}`
      : c.dollars.kind === "PLAIN_CODE"
        ? `${c.dollars.says} ${c.attempts ?? "An uncounted number of"} attempts, ${c.retries ?? "uncounted"} retries.`
        : c.dollars.kind === "UNMEASURED"
          ? `${c.dollars.gap.says} ${c.attempts ?? "An uncounted number of"} attempts.`
          : c.dollars.says;

  /* MW-001: the owner's Sends recorded on the work itself; MW-002: the question its latest round asks. */
  const sends = row.what.assignments ?? [];
  const createdBy = sends.find((a) => a.relation === "CREATED") ?? null;
  const why = `${row.what.why.says}${row.what.why.cadence ? ` (${row.what.why.cadence})` : ""}`;
  const question = row.what.question ?? null;
  return {
    words: null,
    wordsNote:
      createdBy !== null
        ? `Your instruction ${createdBy.assignmentKey} created this on ${formatEastern(createdBy.at)}: the registry defined it and no clock carried it. It is owed from then on like any standing work: ${why}.`
        : sends.length > 0
          ? `No instruction of yours created this; ${sends.length === 1 ? "one" : String(sends.length)} put it first (below). It is standing work the system owes: ${why}.`
          : `No instruction of yours created this. It is standing work the system owes: ${why}.`,
    addresses: [
      {
        id: row.what.recordClass ?? row.kind,
        text: `${row.what.subjectName ?? row.what.subject ?? "no subject recorded"}${row.what.where.held ? ` · ${row.what.where.value.name}` : ""}`,
        pill: row.what.why.band ? `BAND ${row.what.why.band.band}` : "NO BAND",
        tone: row.what.why.band?.band === 1 ? "amber" : "slate",
      },
      {
        id: "QUESTION",
        text: question !== null ? WORK_QUESTION_WORDS[question] : "Not recorded: no round of this work recorded which of the six questions it asks.",
        pill: question !== null ? "ITS QUESTION" : "NOT RECORDED",
        tone: question !== null ? "teal" : "gold",
      },
      ...sends.map((a) => ({
        id: a.assignmentKey,
        text:
          `${a.relation === "CREATED" ? "Created by" : "Put first by"} your instruction, recorded ${formatEastern(a.at)} (receipt ${a.ref})` +
          (a.questions && a.questions.length > 0 ? `. You asked: ${a.questions.map((q) => WORK_QUESTION_WORDS[q]).join(" ")}` : ""),
        pill: a.relation,
        tone: (a.relation === "CREATED" ? "cyan" : "slate") as Tone,
      })),
    ],
    addressesNote:
      sends.length > 0
        ? "Each instruction of yours that reached this work is recorded on the work itself, with how it reached it. Scouts receive its questions in their task brief; verified deterministic methods and publication checks still apply."
        : "No instruction of yours has reached this work. The record class, the subject and the question above are what it is for.",
    lanes,
    models,
    modelsNote:
      models.length === 0
        ? "No worker has taken it yet, so no model — or plain code — has run."
        : "Where a job reaches a model, its class and model are the ones recorded on its attempts. A Scout walk also records the class it started on and why, and any move up a class with the evidence for it and what both tries cost (MW-031).",
    outcomes,
    promoted: promotedTrail,
    promotedNote,
    unsettled,
    costLine,
  };
}

/* ==================================================================== *
 * YOUR INSTRUCTIONS — a selected geography, with its acknowledgement
 * ==================================================================== */

export interface AckFact {
  readonly pill: string;
  readonly tone: Tone;
  readonly text: string;
  /** ISO time, or null when the fact has not happened. */
  readonly at: string | null;
}

/**
 * MW-001: what this instruction reached, READ FROM THE WORK ITSELF — every
 * obligation that records it, created or reordered — never joined by place.
 */
export interface InstructionReach {
  readonly created: number;
  readonly reordered: number;
  /** Obligation ids to open, up to the runner's list cap; `more` counts the rest. */
  readonly createdIds: readonly string[];
  readonly reorderedIds: readonly string[];
  readonly createdMore: number;
  readonly reorderedMore: number;
  readonly says: string;
}

/** MW-021: this instruction's own budget, as the runner holds it — spent, held and left, with its window. */
export interface InstructionBudget {
  readonly rows: readonly (readonly [string, string])[];
  readonly says: string;
}

export interface InstructionView {
  readonly card: CardView;
  readonly decision: ExpansionScopeDecision;
  readonly reading: ExpansionScopeReading | null;
  readonly readingAt: string | null;
  /** Null until a runner that keeps instructions on the work has read it; `reachWhyNot` says why. */
  readonly reach: InstructionReach | null;
  readonly reachWhyNot: string | null;
  readonly budget: InstructionBudget | null;
  /**
   * The earlier join by place — standing work about governments in the
   * geography. Kept only as a labeled fallback: it covers work recorded before
   * instructions were kept on the work, and it is not what the instruction reached.
   */
  readonly inScope: ScopeAssignmentView | null;
  /** Why the assignments here are not counted, when they are not — the real reason, never a generic one. */
  readonly inScopeWhyNot: string | null;
  readonly ack: readonly AckFact[];
  readonly lanes: readonly LaneCard[];
  readonly spend: string;
}

function reachOf(a: AssignmentReading): InstructionReach {
  const m = a.members;
  return {
    created: m.created,
    reordered: m.reordered,
    createdIds: m.createdSample,
    reorderedIds: m.reorderedSample,
    createdMore: Math.max(0, m.created - m.createdSample.length),
    reorderedMore: Math.max(0, m.reordered - m.reorderedSample.length),
    says:
      `${m.created} piece${m.created === 1 ? "" : "s"} of work ${m.created === 1 ? "was" : "were"} created by this instruction and ` +
      `${m.reordered} already on a clock ${m.reordered === 1 ? "was" : "were"} put first by it — as recorded on the work itself. ` +
      "Work it reached on an existing clock is recorded a bounded number per cycle, so the reordered count can trail what was put first.",
  };
}

function budgetOf(a: AssignmentReading, readAt: string | null): InstructionBudget | null {
  const b = a.budget;
  if (b === null) return null;
  const window = b.lifetime ? `Anthropic tokens for this hunt, since ${formatEastern(b.since)}` : `rolling ${b.windowHours} hours to ${formatEastern(b.until)}`;
  const spent = b.spentUsd === null ? "unknown — a charge on its work reported no dollar figure, so it is held" : money(b.spentUsd);
  const left = b.leftUsd === null ? "unknown" : b.leftUsd < 0 ? `none — over by ${money(-b.leftUsd)}` : money(b.leftUsd);
  return {
    rows: [
      ["Budget", `${money(b.budgetUsd)}, ${window}`],
      ["Spent", spent],
      ["Held for work in flight", money(b.heldUsd)],
      ["Left", left],
      ["Scouts admitted under it", String(b.admitted)],
      ["Scouts it held back", String(b.refused)],
    ],
    says:
      `As the runner held it${readAt ? ` at ${formatEastern(readAt)}` : ""}: every charge on work this instruction reached, from when it reached it${b.bySubjectRows > 0 ? `; ${b.bySubjectRows} of those charges named no piece of work and are counted by their government, which can only hold more back` : ""}. ` +
      "A charge on work several instructions share counts in full toward each.",
  };
}

const REACH_NOT_READ = "Not read yet: the runner has not recorded, on the work itself, what this instruction reached.";

export function instructionKey(d: ExpansionScopeDecision): string {
  return `scope:${scopeKeyOf(d.geography)}`;
}

export function instructionView(input: {
  readonly decision: ExpansionScopeDecision;
  readonly reading: ExpansionCycleReading | null;
  readonly rows: readonly AssignmentListRow[] | null;
  readonly totalAssignments: number | null;
  readonly paidLaneClosedBecause: string | null;
  readonly runnerPaused: { readonly since: string | null } | null;
  /** MW-001/MW-021: this instruction as the runner read it from the work (research state `assignments`); null when not recorded. */
  readonly assignment?: AssignmentReading | null;
  readonly assignmentAt?: string | null;
  /** The research state's MW-028 reading: what the Send created here, and where its governments came from. */
  readonly dispatchWork?: DispatchWorkReading | null;
}): InstructionView {
  const d = input.decision;
  const budgetDescription = d.budgetStartedAt
    ? `${money(d.budgetUsd)} Anthropic token budget for this hunt`
    : `${money(d.budgetUsd)} paid-model budget in any rolling 24 hours`;
  const rv = runnerViewFor(d, input.reading);
  const assignment = input.assignment ?? null;
  const sendBudget = assignment === null ? null : budgetOf(assignment, input.assignmentAt ?? null);
  const creation = input.dispatchWork === undefined ? null : scopeCreationView(d, input.dispatchWork);
  const read = rv.kind === "READ" ? rv.reading : null;
  const inScope =
    read && read.work && input.rows ? assignmentsInScope(input.rows, new Set(read.work.subjectIds), input.totalAssignments, !read.work.subjectIdsComplete) : null;
  const blocked = inScope?.byState.find((s) => s.state === "BLOCKED")?.count ?? 0;
  const failed = inScope?.byState.find((s) => s.state === "FAILED")?.count ?? 0;
  const working = inScope?.byState.find((s) => s.state === "WORKING")?.count ?? 0;

  const ack: AckFact[] = [
    { pill: "SAVED", tone: "slate", text: `Your instruction was written down${d.note ? ", with your words kept verbatim" : ""}, receipt ${d.receiptId}`, at: d.decidedAt },
    rv.kind === "READ"
      ? { pill: "READ BY THE RUNNER", tone: "teal", text: `The runner read it at the start of a cycle and resolved ${read?.resolution.kind === "RESOLVED" ? `${read.resolution.zctaCount} codes` : "nothing (it could not resolve the geography)"}`, at: rv.at }
      : { pill: "NOT YET READ", tone: "stone", text: rv.says, at: null },
    read && read.work
      ? {
          pill: "PLACED FIRST",
          tone: "cyan",
          text: `${read.work.registeredObligations} pieces of standing work are about governments here; ${read.work.dueThisCycle} were due that cycle and ${read.work.scoutRowsPlacedFirst} paid rows were placed ahead of the rest`,
          at: input.reading?.at ?? null,
        }
      : { pill: "NOT YET PLACED", tone: "stone", text: "Placed once the runner has resolved this geography.", at: null },
    ...(creation === null
      ? []
      : [
          creation.kind === "READ"
            ? { pill: creation.planOnly === null ? "CREATED" : "PLANNED ONLY", tone: "slate" as Tone, text: `${scopeCreationSentence(creation.target)}${creation.planOnly === null ? "" : ` Nothing was written: ${creation.planOnly}.`}`, at: creation.at }
            : { pill: "NOT YET CREATED", tone: "stone" as Tone, text: creation.says, at: null },
        ]),
    working > 0
      ? { pill: "RUNNING", tone: "teal", text: `${working} of the listed assignments here hold a worker now`, at: null }
      : { pill: "NOT RUNNING NOW", tone: "stone", text: "No listed assignment in this geography holds a worker at the moment. Queued is not running.", at: null },
  ];
  if (input.paidLaneClosedBecause !== null || blocked + failed > 0) {
    ack.push({
      pill: "PARTLY BLOCKED",
      tone: "amber",
      text: [
        input.paidLaneClosedBecause ? `Paid research is ${input.paidLaneClosedBecause.replace(/^closed: /, "closed: ")}` : null,
        blocked + failed > 0 ? `${blocked} blocked and ${failed} failed assignments sit in this geography.` : null,
      ]
        .filter(Boolean)
        .join(" "),
      at: input.reading?.at ?? null,
    });
  }
  if (input.runnerPaused) ack.push({ pill: "PAUSED", tone: "stone", text: "The runner is paused by you; nothing here moves until you resume it.", at: input.runnerPaused.since });
  /* MW-015: visited is not finished. The runner evaluates each Send from its members' own records;
     until it has, the instruction is never shown as finished. */
  const completion = assignment?.completion ?? null;
  if (completion === null) {
    ack.push({ pill: "NOT COMPLETE", tone: "gold", text: "Not evaluated yet: the runner has not recorded whether the work this instruction reached is finished, so it is never shown as finished.", at: null });
  } else if (completion.kind === "COMPLETE") {
    ack.push({ pill: "TRACKED WORK COMPLETE", tone: "teal", text: `${assignmentCompletionWords(completion)} This covers the registered work this instruction reached. It does not establish that every applicable body and information family has been discovered and delivered.`, at: input.assignmentAt ?? null });
  } else {
    const named = completion.kind === "NOT_COMPLETE"
      ? completion.exceptions.slice(0, 3).map((e) => `${e.obligationId}: ${e.says}`).join("; ")
      : "";
    ack.push({ pill: "NOT COMPLETE", tone: "gold", text: `${assignmentCompletionWords(completion)}${named ? ` For example — ${named}.` : ""}`, at: input.assignmentAt ?? null });
  }

  const lanes: LaneCard[] = read
    ? [
        {
          name: "Discovery (paid research)",
          pill: input.paidLaneClosedBecause ? "CLOSED" : read.work?.scoutAdmitted ? "RUNNING" : "WAITING",
          tone: input.paidLaneClosedBecause ? "amber" : "teal",
          rows: [
            ["Admitted", read.work?.scoutAdmitted === null || read.work === null ? "not counted yet" : String(read.work.scoutAdmitted)],
            ["Held by the geography's budget", read.heldThisCycle === null ? "not counted yet" : String(read.heldThisCycle)],
            ["Held by this instruction's budget", assignment?.budget ? String(assignment.budget.refused) : "not counted yet"],
            ["Placed first", read.work ? String(read.work.scoutRowsPlacedFirst) : "—"],
          ],
          note: `${read.budgetSays} Both counts are for the runner's last cycle.`,
        },
        {
          name: "Acquisition and validation (plain code)",
          pill: "RUNS ON THE CLOCK",
          tone: "teal",
          rows: [
            ["Standing work here", read.work ? String(read.work.registeredObligations) : "—"],
            ["Due that cycle", read.work ? String(read.work.dueThisCycle) : "—"],
            ["Governments with work", read.coverage ? `${read.coverage.withWork} of ${read.coverage.registeredJurisdictions}` : "—"],
          ],
          note: "Plain-code reads use no Anthropic tokens. Search and other provider costs are tracked separately. Validation before promotion is preserved per record.",
        },
      ]
    : [];

  const spend =
    read?.spend
      ? `Geographic activity: ${read.spend.rolling24hUsd === null ? "unknown (a charge reported no cost)" : money(read.spend.rolling24hUsd)} in the rolling 24 hours and ${read.spend.sevenDayUsd === null ? "unknown" : money(read.spend.sevenDayUsd)} in 7 days on work about governments there. These activity windows do not reset the ${budgetDescription}; its accounting and reservations are shown separately.`
      : `In the geography: nothing measured yet. The instruction has a ${budgetDescription}.`;

  const pill = rv.kind === "READ" ? (input.paidLaneClosedBecause ? { p: "READ · PARTLY BLOCKED", t: "gold" as Tone } : { p: "READ BY RUNNER", t: "teal" as Tone }) : { p: "SAVED · NOT YET READ", t: "cyan" as Tone };
  return {
    card: {
      id: instructionKey(d),
      kind: "INSTRUCTION",
      pill: pill.p,
      tone: pill.t,
      title: `${d.geography.label} — ${SCOPE_TYPE_WORDS[d.geography.type].toLowerCase()}, priority ${d.priority}`,
      summary:
        rv.kind === "READ"
          ? `Read by the runner at its cycle start. ${read?.work ? `${read.work.registeredObligations} ${read.work.registeredObligations === 1 ? "piece" : "pieces"} of standing work ${read.work.registeredObligations === 1 ? "is" : "are"} about governments here.` : read?.resolution.kind === "UNRESOLVED" ? `It could not be resolved: ${read.resolution.why}` : "What is in it was not recorded."}${assignment ? ` It created ${assignment.members.created} and put ${assignment.members.reordered} first, as recorded on the work.` : ""} This instruction has a ${budgetDescription}.`
          : `${rv.says} This instruction has a ${budgetDescription}.`,
    },
    decision: d,
    reading: read,
    readingAt: rv.kind === "READ" ? rv.at : null,
    reach: assignment === null ? null : reachOf(assignment),
    reachWhyNot: assignment === null ? REACH_NOT_READ : null,
    budget: sendBudget,
    inScope,
    inScopeWhyNot:
      inScope !== null
        ? null
        : read === null
          ? "Counted once the runner has read this geography at a cycle start."
          : read.resolution.kind === "UNRESOLVED"
            ? `Not counted: the geography could not be resolved — ${read.resolution.why}`
            : input.rows === null
              ? "Not counted: the assignment list is not published on the current snapshot, so nothing here can be matched to it."
              : "Not counted: the runner recorded no work reading for this geography.",
    ack,
    lanes,
    spend,
  };
}

export const STATE_LABEL = (s: AssignmentState): string => STATE_WORDS[s].label;

/* ==================================================================== *
 * ROUTINE MEETING READS — one assignment per watched body's source
 * ==================================================================== */


const BODY_PILL: Readonly<Record<string, { readonly pill: string; readonly tone: Tone }>> = {
  WORKING: { pill: "RUNNING", tone: "teal" },
  "NEEDS ATTENTION": { pill: "NEEDS ATTENTION", tone: "gold" },
  STUCK: { pill: "STUCK", tone: "amber" },
  "NOT READ YET": { pill: "NOT READ YET", tone: "slate" },
};

export function routineCard(body: BodyView, contractId: string): CardView {
  const p = BODY_PILL[body.status];
  return {
    id: `routine:${contractId}`,
    kind: "STANDING",
    pill: p.pill,
    tone: p.tone,
    title: `Meetings of ${body.name}`,
    summary: `${body.summary} Plain code on the standing clock: no model cost.`,
  };
}

type TrailRow = readonly [string, string];

function destinationWords(body: BodyView): string {
  const where = body.publicZip;
  if (where.kind === "ZIP") return `${new URL(PUBLIC_SITE_ORIGIN).host}/?zip=${where.zip} — its meetings list`;
  if (where.kind === "NONE") return "No indexed ZIP carries this body's division, so no page is named";
  return "The ZIP index was not read this time, so no page is named";
}

function countWords(c: { readonly added: number; readonly changed: number; readonly removed: number; readonly held: number }): string {
  return `${c.added} added, ${c.changed} changed, ${c.removed} removed${c.held > 0 ? `; ${c.held} held back` : ""} (a record is a meeting or one of its agenda documents)`;
}

/**
 * Acceptance 1.10's audit trail, for the latest version that changed what
 * readers are served: later reads that changed nothing move the version
 * pointer on, so the version serving now is named beside it, never instead.
 */
/** ". New meetings: A, January 20, 2027, 5:30 PM ET; and 2 more" — or nothing when none is named. */
function meetingList(label: string, meetings: readonly { readonly title: string; readonly startsAt: string | null }[], total: number): string {
  if (meetings.length === 0) return "";
  const more = total - meetings.length;
  const names = meetings.map((m) => `${m.title}${m.startsAt ? `, ${formatEastern(m.startsAt, { year: true })}` : ""}`);
  return `. ${label}${total === 1 ? "" : "s"}: ${names.join("; ")}${more > 0 ? `; and ${more} more` : ""}`;
}

function changeTrail(body: BodyView, c: NonNullable<BodyView["lastChange"]>): TrailRow[] {
  const now = c.servedNow;
  return [
    ["Source", `${c.source.charAt(0).toUpperCase()}${c.source.slice(1)}${c.sourceUrl ? ` — ${c.sourceUrl}` : ""}`],
    ["Retrieved", `${formatEastern(c.retrievedAt)} — the read that found the change`],
    ["What changed", `${countWords(c)}${meetingList("New meeting", c.named, c.meetingsAdded)}${meetingList("Changed meeting", c.changedNamed, c.meetingsChanged)}`],
    ["Validation", c.validatedAt ? `Passed ${formatEastern(c.validatedAt)} — every applicable check` : "Passed — a version is promoted only after it validates; the check's own time is not recorded"],
    ["Promoted", `Version ${c.versionId.slice(0, 15)}…${c.promotedAt ? ` at ${formatEastern(c.promotedAt)}` : " — its promotion time is not recorded"}`],
    ["Public destination", destinationWords(body)],
    [
      "Checked",
      c.readback
        ? `${formatEastern(c.readback.at)}${c.readback.passed ? "" : " — and the readback failed"}, through the reader's own projection — the public page itself was not fetched`
        : "No readback of that version is recorded",
    ],
    [
      "Serving now",
      now === null
        ? "No version of this source is recorded as serving readers now"
        : now.versionId === c.versionId
          ? `This version${now.readback ? `, last read back ${formatEastern(now.readback.at)}` : ""}`
          : `Version ${now.versionId.slice(0, 15)}…, promoted ${formatEastern(now.promotedAt)} by a later read that changed nothing${now.readback ? `; read back ${formatEastern(now.readback.at)}${now.readback.passed ? "" : ", and that readback failed"}` : "; no readback of it is recorded"}`,
    ],
    ["Never proves", "That a person actually viewed it. Available is not read."],
  ];
}

/**
 * The trail when no changing version is on record — the version serving now,
 * as it is — or when the change history was not read, which it says first.
 */
function currentTrail(body: BodyView): TrailRow[] {
  return [
    ...(body.changeRead
      ? []
      : ([["Last change", "Not read this time: the change history did not answer, so when a record last reached readers is not shown. The version below may only re-confirm what readers already had."]] as const)),
    ["Source", body.schedule.find(([k]) => k === "Last look")?.[1] ?? "no read recorded"],
    ...(body.current
      ? ([
          ["Version", `${body.current.versionId.slice(0, 15)}… promoted ${formatEastern(body.current.promotedAt)}`],
          ["What changed", body.current.outcome === "UNCHANGED" ? "Nothing — this version re-confirmed what readers already had" : countWords(body.current)],
          ["Validation", "Passed — a version is promoted only after it validates"],
        ] as const)
      : []),
    ["Public destination", destinationWords(body)],
    ["Checked", body.readback ? `${formatEastern(body.readback.at)}, through the reader's own projection — the public page itself was not fetched` : "No readback is recorded"],
    ["Never proves", "That a person actually viewed it. Available is not read."],
  ];
}

/** The opened routine assignment, from the same body facts Fleet · Now shows. */
export function routineDetail(body: BodyView): AssignmentDetailView {
  const outcomes: OutcomeCell[] = [
    { key: "new", label: "New · 24h", value: body.day ? body.day.added : null, unknown: "NOT READ IN 24H", tone: "text" },
    { key: "changed", label: "Changed · 24h", value: body.day ? body.day.changed : null, unknown: "NOT READ IN 24H", tone: "text" },
    { key: "unchanged", label: "Held now", value: body.records, unknown: "NOTHING HELD", tone: "text" },
    { key: "refused", label: "Held back", value: body.held, unknown: "NOTHING HELD", tone: body.held ? "gold" : "muted" },
    { key: "unsettled", label: "No agenda (past)", value: body.noAgendaLink, unknown: "NOTHING HELD", tone: body.noAgendaLink ? "gold" : "muted" },
  ];
  return {
    words: null,
    wordsNote: "No instruction of yours created this. It is a registered meeting source the standing runner reads on its own clock.",
    addresses: body.questions.map((q) => ({ id: q.pill, text: `${q.text} — ${q.detail}`, pill: q.pill, tone: q.tone })),
    addressesNote: "The six standing questions for this body, answered from its own reads. No requirement instance is recorded against it yet (MW-063).",
    lanes: body.lanes.map((l) => ({ name: l.name, pill: l.pill, tone: l.tone, rows: [["Now", l.counts]], note: l.note })),
    models: body.activity.slice(0, 3).map((a) => ({ pill: a.pill, tone: a.tone, step: a.what, model: "plain code", cost: a.cost, why: "Plain code can do this, so it cannot reach a model at all." })),
    modelsNote: body.escalationNote,
    outcomes,
    promoted:
      body.readerVisible !== null
        ? [
            {
              pill: "CONFIRMED PUBLIC",
              tone: "teal",
              title: `${body.records} meetings from ${body.name}`,
              trail: body.lastChange ? changeTrail(body, body.lastChange) : currentTrail(body),
            },
          ]
        : [],
    promotedNote:
      body.readerVisible !== null ? null : body.records === null ? "Nothing from this body has been published for a reader." : "A version is published, and no readback of it is recorded, so whether a reader can open it is not confirmed.",
    unsettled: body.deadEnd
      ? [{ pill: body.deadEnd.pill, title: body.deadEnd.title, ruledOut: body.deadEnd.ruledOut, wouldSettle: body.deadEnd.wouldSettle, whoMoves: body.deadEnd.whoMoves, ...(body.deadEnd.gaps ? { gaps: body.deadEnd.gaps } : {}) }]
      : [],
    costLine: "Plain code: meeting reads never reach a paid model. The database and host they use are shared and not split per body.",
  };
}
