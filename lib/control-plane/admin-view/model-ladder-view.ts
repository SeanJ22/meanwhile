/**
 * **THE MODEL LADDER, AS THE OWNER READS IT.** (MW-031, MW-033, 2026-09-25.)
 *
 * The Scout research loop starts on the cheapest suitable class and moves up
 * only for a recorded reason (`scheduler/model-routing.ts`). Each paid Scout
 * result records the class it started on, why, and — when it moved up or was
 * refused a move — the reason, a short evidence line and the cost of every
 * attempt. This file turns those records into the words Admin shows:
 *
 * ```
 *   ladderHeadline   one line for Fleet · Money: how many escalations are on
 *                    record, and, when there are none, why that is honest —
 *                    "Escalations recorded: 0 (paid research paused since Sep 22)"
 *   scoutModelLine   one Scout result: the class chosen, why that class, and
 *                    for an escalated result the evidence and combined cost —
 *                    for an assignment's standing view to call
 * ```
 *
 * Model-routing escalation only. The owner escalations in `work-item.ts`
 * (work handed to a person) are a different thing and are never counted here.
 *
 * PURE.
 */
import { EASTERN_ZONE } from "../eastern-time.ts";
import { modelName } from "../plain-words.ts";
import { MODEL_FOR_CLASS, type ModelClass, type ModelEscalationReason, type ModelEscalationRefusal } from "../scheduler/model-routing.ts";
import type { ScoutResult } from "../scheduler/scout-result.ts";

/** Why the cheaper attempt moved up, in the owner's words. */
export const ESCALATION_REASON_WORDS: Readonly<Record<ModelEscalationReason, string>> = {
  BOUND_EXHAUSTED_WITHOUT_RESULT: "it used up its turns without a usable answer",
  RESULT_REFUSED: "its answer failed our checks and was never fixed",
  NO_TYPED_RESULT: "it stopped without giving an answer",
  CAPABILITY_ERROR: "the provider said that model cannot handle the request",
  PROVIDER_UNAVAILABLE: "the AI service did not answer that model on repeated tries",
};

/** Why a move up was refused, in the owner's words. */
export const ESCALATION_REFUSAL_WORDS: Readonly<Record<ModelEscalationRefusal, string>> = {
  NOT_RESERVED: "no spending hold could be taken for a second try",
  CEILING: "the spending ceiling could not cover a second try",
  UNMEASURED_SPEND: "the first try's cost was not measured",
  WALL_CLOCK: "too little time was left for a second try",
};

/** One escalation (or refused escalation) on record, as the spend store aggregates it. */
export interface EscalationFact {
  readonly role?: "ADVERSARIAL_AUDITOR";
  readonly at: string | null;
  readonly obligationId: string;
  readonly subjectId: string | null;
  /** The class the loop started on. */
  readonly from: string;
  /** Exact recorded model, when the source receipt has it. Never inferred from today's class map. */
  readonly fromModel?: string | null;
  /** The class it moved up to; null when the move was refused. */
  readonly to: string | null;
  readonly toModel?: string | null;
  readonly reason: string;
  readonly evidence: string | null;
  /** The refusal code when the move was refused. */
  readonly refused: string | null;
  /** Each attempt's cost, cheapest first; null where unmeasured. */
  readonly attemptsUsd: readonly (number | null)[];
  /** The combined cost of every attempt; null where any was unmeasured. */
  readonly combinedUsd: number | null;
}

/** The ladder's record across every paid Scout result, aggregated where it is stored. */
export interface LadderFacts {
  /** Results by the class the loop STARTED on. `BEFORE_LADDER` counts results recorded before 2026-09-25, which started on the frontier. */
  readonly startedOn: readonly { readonly modelClass: string; readonly attempts: number }[];
  readonly escalated: number;
  readonly escalationsRefused: number;
  /** The most recent escalations and refused escalations, newest first. */
  readonly latest: readonly EscalationFact[];
}

const DAY = new Intl.DateTimeFormat("en-US", { timeZone: EASTERN_ZONE, month: "short", day: "numeric" });

function day(iso: string): string {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? DAY.format(new Date(t)) : iso;
}

function money(usd: number | null): string {
  return usd === null ? "an unmeasured amount" : `$${usd.toFixed(usd < 1 ? 4 : 2)}`;
}

function className(modelClass: string | null | undefined, recordedModel?: string | null): string {
  if (recordedModel) return modelName(recordedModel);
  if (modelClass === null || modelClass === undefined || modelClass === "") return "an unrecorded class";
  return (MODEL_FOR_CLASS as Readonly<Record<string, string>>)[modelClass] === undefined
    ? modelClass : `the ${modelClass} class (exact model not recorded)`;
}

function reasonWords(reason: string): string {
  return (ESCALATION_REASON_WORDS as Readonly<Record<string, string>>)[reason] ?? reason;
}

function refusalWords(code: string): string {
  return (ESCALATION_REFUSAL_WORDS as Readonly<Record<string, string>>)[code] ?? code;
}

/**
 * THE ONE LINE FOR FLEET · MONEY. Honest about a zero: with no escalation on
 * record it says whether the ladder has run at all, and when paid research is
 * paused it says since when (the last paid charge on the ledger).
 */
export function ladderHeadline(input: {
  readonly ladder: LadderFacts | null;
  /** The last paid charge on the ledger (any model work). */
  readonly lastPaidAt: string | null;
  /** Whether the owner has paused paid research; null when that could not be read. */
  readonly pausedByOwner: boolean | null;
}): string {
  const { ladder } = input;
  if (ladder === null) return "Escalations recorded: not read — the Scout results were not read, which is not the same as none.";
  const ranOnLadder = ladder.startedOn.filter((s) => s.modelClass !== "BEFORE_LADDER").reduce((n, s) => n + s.attempts, 0);
  const since = input.lastPaidAt === null ? null : day(input.lastPaidAt);
  if (ladder.escalated === 0 && ladder.escalationsRefused === 0) {
    const why =
      input.pausedByOwner === true
        ? `paid research paused${since ? ` since ${since}` : ""}`
        : ranOnLadder === 0
          ? `no paid Scout has run since the ladder was switched on${since ? `; the last paid charge was ${since}` : ""}`
          : `${ranOnLadder.toLocaleString("en-US")} paid Scout attempt${ranOnLadder === 1 ? "" : "s"} started on the cheaper class and none needed to move up`;
    return `Escalations recorded: 0 (${why}).`;
  }
  const latest = ladder.latest[0];
  const r = ladder.escalationsRefused;
  const refused = r > 0 ? ` ${r.toLocaleString("en-US")} more ${r === 1 ? "was" : "were"} called for and refused.` : "";
  return (
    `Escalations recorded: ${ladder.escalated.toLocaleString("en-US")}.${refused}` +
    (latest === undefined ? "" : ` Latest: ${escalationSentence(latest)}`)
  );
}

/** One escalation on record, as a sentence. */
export function escalationSentence(e: EscalationFact): string {
  const when = e.at === null ? "" : ` on ${day(e.at)}`;
  const shown = e.evidence ? ` (${e.evidence})` : "";
  if (e.role === "ADVERSARIAL_AUDITOR") return `An independent audit moved from ${modelName(e.from)} to ${modelName(e.to)}${when} because ${reasonWords(e.reason)}${shown}. This attempt cost ${money(e.combinedUsd)}; earlier attempts remain in the spending ledger.`;
  if (e.to === null || e.refused !== null) {
    return (
      `A Scout stayed on ${className(e.from, e.fromModel)}${when} although ${reasonWords(e.reason)}${shown}, because ` +
      `${refusalWords(e.refused ?? "")}; it cost ${money(e.combinedUsd)}.`
    );
  }
  const split = e.attemptsUsd.length > 1 ? ` (${e.attemptsUsd.map(money).join(" + ")})` : "";
  return (
    `A Scout moved from ${className(e.from, e.fromModel)} to ${className(e.to, e.toModel)}${when} because ${reasonWords(e.reason)}${shown}; ` +
    `both tries together cost ${money(e.combinedUsd)}${split}.`
  );
}

/** What an assignment's standing view shows for one Scout result. */
export interface ScoutModelLine {
  /** The class the loop started on, by model name. */
  readonly chosen: string;
  /** Why that class: the step registry's reason, as recorded on the result. */
  readonly why: string;
  /** For a result that moved up or was refused a move: the sentence with the evidence and the combined cost. Null otherwise. */
  readonly escalation: string | null;
}

/**
 * THE CLASS CHOSEN, WHY, AND — FOR AN ESCALATED RESULT — THE EVIDENCE AND THE
 * COMBINED COST. A result recorded before 2026-09-25 carries none of the
 * ladder fields; it started on the frontier by the rule of the day, and says so.
 */
export function scoutModelLine(
  result: Pick<ScoutResult, "worker" | "usd" | "startedAt" | "obligationId" | "subjectId"> &
    Partial<Pick<ScoutResult, "modelClass" | "modelClassWhy" | "escalatedFrom" | "escalationReason" | "escalationEvidence" | "escalationRefused" | "modelAttempts">>,
): ScoutModelLine {
  if (result.modelClass === undefined) {
    return {
      chosen: modelName(result.worker.model),
      why: "Recorded before the ladder (2026-09-25): the research loop then started on the most capable class by standing rule.",
      escalation: null,
    };
  }
  const attempts = result.modelAttempts ?? [];
  const started: ModelClass = attempts[0]?.modelClass ?? result.escalatedFrom ?? result.modelClass;
  const fact: EscalationFact | null =
    result.escalationReason === null || result.escalationReason === undefined
      ? null
      : {
          at: result.startedAt,
          obligationId: result.obligationId,
          subjectId: result.subjectId,
          from: started,
          fromModel: attempts[0]?.model ?? null,
          to: result.escalationRefused ? null : result.modelClass,
          toModel: result.escalationRefused ? null : attempts.at(-1)?.model ?? null,
          reason: result.escalationReason,
          evidence: result.escalationEvidence ?? null,
          refused: result.escalationRefused?.code ?? null,
          attemptsUsd: attempts.map((a) => a.usd),
          combinedUsd: result.usd,
        };
  return {
    chosen: className(started, attempts[0]?.model),
    why: result.modelClassWhy ?? "No reason was recorded for the class.",
    escalation: attempts.some(a => a.escalation) ? attempts.filter(a => a.escalation).map(a => `${a.escalation!.at}: ${a.escalation!.from} → ${a.model}; ${a.escalation!.reason}: ${a.escalation!.evidence}. ${a.accepted ? "Typed result accepted; public delivery requires the linked validation and publication receipts." : "No accepted result."} Cost ${a.usd === null ? "unmeasured" : `$${a.usd.toFixed(4)}`}.`).join(" ") + (result.escalationRefused && fact ? ` ${escalationSentence(fact)}` : "") : fact === null ? null : escalationSentence(fact),
  };
}
