/**
 * **THE CLOSED LIST OF THINGS THE CONSOLE CAN DO.** (Admin Pass C, ADM-C6.)
 *
 * ## Closed is the whole design
 *
 * §3.1–3.4 remove the four generic escape hatches: no unrestricted shell, no
 * arbitrary SQL box, no arbitrary workflow string, no browser-cookie scraping.
 * What is left has to be a NAMED set of typed actions, and a named set is only
 * a safety property if the lookup FAILS CLOSED — an action type that is not in
 * this map is refused rather than passed through to something that might
 * understand it (§3.6). `lookupAction` therefore returns null for anything not
 * declared here, and the gateway turns that into a refusal with a receipt.
 *
 * ## Each entry delegates; none of them implements
 *
 * Every action here is a thin, typed front door onto a path that already
 * exists. `queue.add` and `decision.record` append owner-decision intents
 * through `appendDecisionIntent`. The four runner and fleet controls build
 * research intents through `buildResearchIntent` / `appendResearchIntent`, the
 * same quadruple `/api/admin/research` has used since Level 1 activation.
 * `review.decide` calls the release-review writer that already runs end to end
 * against in-memory repositories. Nothing is reimplemented, so nothing can
 * drift from the path the rest of the console uses (RULING 103).
 *
 * The admin surface still WRITES AND NOTHING ELSE. Every entry below appends a
 * record; not one of them merges, pushes, deploys, promotes, runs git, or edits
 * a generated artifact. That is the constraint all four existing admin routes
 * were built around, and a gateway that executed rather than recorded would
 * have broken it while looking like a tidy-up.
 *
 * ## Two entries refuse on purpose
 *
 * `fleet.retryWorkItem` and `prohibited.promotionOn` are declared so that their
 * refusals are TYPED, PROVABLE and visible on the same surface as everything
 * else. An action that is simply absent produces "the console does not know
 * this action"; an action that is declared and refuses produces the real
 * sentence, and for the retry it names the exact seam that does not exist yet.
 * Inventing a scheduler intent for it would have been the one failure this pass
 * may not commit: a control that looks like it works.
 *
 * SERVER-SIDE. The registry reaches the control plane through the repositories
 * it is handed; it never opens a connection and never reads the environment.
 */

import { appendDecisionIntent, RUNNER_ID, SNAPSHOT_ID } from "../admin-data.ts";
import { ADD_TO_QUEUE_OPTION, fixConsequence, fixSubjectId, parseFixField } from "../fix-queue.ts";
import {
  ANSWERED_IN_OWN_WORDS,
  OWNER_ANSWER_MAX_CHARS,
  OWNER_SURFACE_FORMAT_VERSION,
  type OwnerDecisionIntent,
} from "../owner-surface.ts";
import {
  appendResearchIntent,
  buildResearchIntent,
  validateIntentNote,
} from "../research-view.ts";
import { RESEARCH_STATE_ID } from "../scheduler/research-policy.ts";
import type { ControlPlaneRepositories } from "../repository/types.ts";
import {
  ADMIN_CONFIG_ID,
  defaultAdminConfig,
  fleetSpendCeilingOverrideUsd,
  isAdminConfig,
  withApiFallback,
  withBillingFacts,
  withDiscoverySearch,
  withExpansionScopes,
  withFleetSpendCeiling,
  API_FALLBACK_MISSING_SEAM,
} from "./admin-config.ts";
import {
  billingFactId,
  billingFactsOf,
  factAmountWords,
  factPeriodWords,
  providerDefinition,
  validateBillingFact,
  withFactRecorded,
  withFactRemoved,
  type BillingFact,
} from "../billing-facts.ts";
import { FLEET_SPEND_CEILING_MAX_USD, resolveRollingCeiling } from "../fleet-safety.ts";
import {
  SCOPE_TYPE_WORDS,
  expansionScopesOf,
  scopeKeyOf,
  validateScopeBudget,
  validateScopeGeography,
  validateScopeKey,
  validateScopeNote,
  validateScopePriority,
  withScopeRemoved,
  withScopeSet,
  type ExpansionScopeGeography,
} from "../expansion/scopes.ts";
import { ORIGINAL_LIFETIME_HUNT } from "../scheduler/hunt-continuation.ts";
import { WORK_QUESTION_WORDS, validateWorkQuestions, type WorkQuestion } from "../work-question.ts";
import type { ActionDefinition, ActionRequest, ReceiptOutcome, RefusalCode } from "./contract.ts";

/** How much the runner creates for one Send, in the words every receipt below quotes (MW-028). */
const CREATION_SCOPE = "all missing work for the requested geography";

/* ------------------------------------------------------------------ deps */

/**
 * What an action is allowed to reach, handed in rather than imported.
 *
 * The whole gateway therefore runs against the in-memory repositories, a fixed
 * clock and a stub recorder in the suite — which is what makes the five ADM-C6
 * acceptance points provable rather than asserted.
 */
export interface GatewayDeps {
  readonly repos: ControlPlaneRepositories;
  /** The clock, injected. Nothing under `lib/` reaches for `Date.now()`. */
  readonly now: () => string;
  /** What the world is at now, for the staleness comparison. Null when nothing moves. */
  readonly currentStateVersion: string | null;
  /** The deploy that is running this, for the receipt. Null when the runtime cannot say. */
  readonly codeSha: string | null;
  /**
   * The release-review writer, wired by the route.
   *
   * Structurally typed rather than imported, so `lib/` does not depend on a
   * module under `app/`. The route passes `recordReview` from
   * `app/(admin)/admin/release-review/write.ts` — the existing path, not a copy
   * of it. Null when nothing wired it, and the action then refuses by name
   * instead of pretending the decision was recorded.
   */
  readonly recordReview: ReleaseReviewRecorder | null;
}

export type ReleaseReviewRecorder = (input: {
  readonly action: string;
  readonly stagingSha: string;
  readonly section: string | null;
  readonly decision: string | null;
  readonly feedback: string | null;
  readonly choice: string | null;
}) => Promise<{
  readonly ok: boolean;
  readonly code: string;
  readonly detail: string;
  readonly rowIds?: readonly string[];
}>;

/* --------------------------------------------------------------- results */

/** What an action did, in the words the receipt carries. */
export interface ActionEffect {
  readonly ok: true;
  /** Never `REFUSED` — a refusal is the other branch. */
  readonly outcome: Exclude<ReceiptOutcome, "REFUSED">;
  readonly says: string;
  /** The canonical identity acted on, when it was derived rather than submitted. */
  readonly subject?: string;
  readonly openedWork?: readonly { readonly kind: string; readonly id: string; readonly title: string }[];
  readonly readBackAt?: string | null;
  readonly undo?: string | null;
}

export interface ActionRefusal {
  readonly ok: false;
  readonly refusal: RefusalCode;
  /** One plain sentence. Never a code, never an env var, never a connection string. */
  readonly says: string;
  readonly subject?: string;
}

export type ActionResult = ActionEffect | ActionRefusal;

/** What `validate` hands to `execute`: the action's own checked input. */
export type ValidatedInput = Readonly<Record<string, unknown>>;

export type Validation =
  | { readonly ok: true; readonly value: ValidatedInput }
  | { readonly ok: false; readonly why: string };

/** The context an action gets beyond its input: who asked, and under what receipt. */
export interface ActionContext {
  readonly request: ActionRequest;
  /** The receipt id this action will be recorded under, known before it runs. */
  readonly receiptId: string;
  readonly at: string;
}

export interface RegisteredAction {
  readonly definition: ActionDefinition;
  /** PURE. Shape, bounds and required fields. Never a store, never a clock. */
  readonly validate: (input: Readonly<Record<string, unknown>>) => Validation;
  readonly execute: (
    deps: GatewayDeps,
    context: ActionContext,
    input: ValidatedInput,
  ) => Promise<ActionResult>;
}

/* ------------------------------------------------------------- utilities */

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const collapse = (value: unknown): string => text(value).replace(/\s+/g, " ");
const bad = (why: string): Validation => ({ ok: false, why });
const refuse = (refusal: RefusalCode, says: string): ActionRefusal => ({ ok: false, refusal, says });

/**
 * A store failure, as the one sentence the owner reads.
 *
 * The error NAME and never its message: a driver error's message can contain
 * the connection string, and this text reaches a browser.
 */
function storeRefusal(what: string, error: unknown): ActionRefusal {
  return refuse(
    "DOWNSTREAM_REFUSED",
    `${what} could not be written (${(error as Error)?.name ?? "error"}), so nothing was recorded.`,
  );
}

/** The owner-decision intent both decision-shaped actions append. */
function decisionIntent(input: {
  readonly subjectId: string;
  readonly chosenOption: string;
  readonly consequenceShown: string;
  readonly ownerAnswer: string | null;
  readonly decidedAt: string;
  readonly actorRef: string;
}): OwnerDecisionIntent {
  return {
    formatVersion: OWNER_SURFACE_FORMAT_VERSION,
    // The same derivation the decision route uses: subject plus the moment, so
    // a double-click inside one millisecond is one intent and a later identical
    // click is a new one. The gateway's own idempotency key is the outer guard;
    // this keeps the store's guarantee unchanged for anything that reaches it
    // by another path.
    intentId: `${input.subjectId}:${input.decidedAt}`,
    subjectId: input.subjectId,
    chosenOption: input.chosenOption,
    consequenceShown: input.consequenceShown,
    decidedAt: input.decidedAt,
    state: "PENDING_CANONICALIZATION",
    canonicalRef: null,
    refusedReason: null,
    adminSessionRef: input.actorRef,
    ownerAnswer: input.ownerAnswer,
  };
}

/** Append a research intent for one of the four runner/fleet controls. */
async function appendIntent(
  deps: GatewayDeps,
  context: ActionContext,
  action: "PAUSE" | "PAUSE_RUNNER" | "RESUME_RUNNER" | "RUN_CYCLE_NOW" | "DISPATCH",
  note: string | null,
  said: { readonly says: string; readonly undo: string | null },
  /** MW-021: a DISPATCH's own rolling 24-hour budget for paid work on what it reaches. */
  budgetUsd: number | null = null,
): Promise<ActionResult> {
  const requestedAt = context.at;
  const intent = buildResearchIntent(action, requestedAt, context.request.actorRef, note, undefined, budgetUsd);
  const wrote = await appendResearchIntent(deps.repos, intent, requestedAt);
  if (!wrote.ok) return refuse("DOWNSTREAM_REFUSED", `Nothing was recorded — ${wrote.detail}.`);
  return {
    ok: true,
    outcome: "QUEUED",
    says: said.says,
    subject: intent.intentId,
    openedWork: [],
    readBackAt: "/admin/research",
    undo: said.undo,
  };
}

/* --------------------------------------------------------------- actions */

/**
 * The readback subjects, closed.
 *
 * A readback here is a FRESH READ of what the control plane currently holds for
 * a named subject, taken now and recorded with what it said. It is not a
 * re-derivation from source: the deployed console has no repository, no git and
 * no filesystem, so it cannot re-run the standing publisher or a code-identity
 * readback, and it does not claim to.
 */
const READBACK_SUBJECTS: Readonly<Record<string, { readonly name: string; readonly readBackAt: string }>> = {
  "control-centre": { name: "the control centre snapshot", readBackAt: "/admin" },
  runner: { name: "the runner's heartbeat", readBackAt: "/admin" },
  research: { name: "the research lane's state", readBackAt: "/admin/research" },
};

const REGISTRY: readonly RegisteredAction[] = [
  /* ---------------------------------------------------------- queue.add */
  {
    definition: {
      type: "queue.add",
      label: "Add this to the queue",
      does: "Puts this gap on the fix queue as a decision you have recorded.",
      doesNot: "Does not fix it, open a tracker row, or start any work by itself.",
      authority: "REVERSIBLE_NONPRODUCTION",
      subjectKind: "a gap you saw on a page",
      requiresStateVersion: false,
      refusals: ["INVALID_INPUT", "DOWNSTREAM_REFUSED"],
    },
    validate(input) {
      const combined = text(input.fix);
      if (combined !== "") {
        const parsed = parseFixField(combined);
        if (parsed === null) return bad("the gap needs some words describing what the page said");
        return { ok: true, value: { subjectId: parsed.subjectId, consequenceShown: parsed.consequenceShown } };
      }
      const says = collapse(input.says);
      if (says === "") return bad("the gap needs some words describing what the page said");
      const where = collapse(input.where) || "the control centre";
      return {
        ok: true,
        value: { subjectId: fixSubjectId(where, says), consequenceShown: fixConsequence(where, says) },
      };
    },
    async execute(deps, context, input) {
      const subjectId = String(input.subjectId);
      const intent = decisionIntent({
        subjectId,
        chosenOption: ADD_TO_QUEUE_OPTION,
        consequenceShown: String(input.consequenceShown),
        ownerAnswer: null,
        decidedAt: context.at,
        actorRef: context.request.actorRef,
      });
      const wrote = await appendDecisionIntent(deps.repos, intent, context.at);
      if (!wrote.ok) return refuse("DOWNSTREAM_REFUSED", `Nothing was recorded — ${wrote.detail}.`);
      return {
        ok: true,
        outcome: "QUEUED",
        subject: subjectId,
        says: "It is on the queue. Nothing has been fixed yet — the queue is what you send when you are ready.",
        openedWork: [],
        readBackAt: "/admin",
        undo: "Nothing has happened yet, so there is nothing to undo. Decide it differently and the later decision stands.",
      };
    },
  },

  /* ----------------------------------------------------- decision.record */
  {
    definition: {
      type: "decision.record",
      label: "Record your decision",
      does: "Records what you decided about this row, with the words you were shown when you decided it.",
      doesNot: "Does not change a ruling, a tracker row or any generated file — that happens later, under the gates.",
      authority: "OWNER_DECISION_REQUIRED",
      subjectKind: "a row waiting on you",
      // The card is a rendering of a moving world: it can be closed, superseded
      // or re-worded between the draw and the click, and a decision recorded
      // against words that have changed is a decision nobody can audit.
      requiresStateVersion: true,
      refusals: ["INVALID_INPUT", "STALE_STATE", "DOWNSTREAM_REFUSED"],
    },
    validate(input) {
      const subjectId = text(input.subjectId);
      const chosenOption = collapse(input.chosenOption);
      const answer = typeof input.ownerAnswer === "string" ? input.ownerAnswer.replace(/\r\n/g, "\n").trim() : "";
      if (answer.length > OWNER_ANSWER_MAX_CHARS) {
        return bad(`your answer is longer than ${OWNER_ANSWER_MAX_CHARS} characters`);
      }
      if (chosenOption === "" && answer === "") return bad("pick an option or write an answer");
      return {
        ok: true,
        value: {
          subjectId,
          chosenOption: chosenOption === "" ? ANSWERED_IN_OWN_WORDS : chosenOption,
          consequenceShown: collapse(input.consequenceShown),
          ownerAnswer: answer === "" ? null : answer,
        },
      };
    },
    async execute(deps, context, input) {
      // The subject travels on the request; the input may name it instead when
      // the caller is a chat tool with no rendered control behind it.
      const subjectId = String(input.subjectId) || context.request.subject.trim();
      if (subjectId === "") return refuse("INVALID_INPUT", "The decision did not say which row it was about, so nothing was recorded.");
      const intent = decisionIntent({
        subjectId,
        chosenOption: String(input.chosenOption),
        consequenceShown: String(input.consequenceShown),
        ownerAnswer: input.ownerAnswer === null ? null : String(input.ownerAnswer),
        decidedAt: context.at,
        actorRef: context.request.actorRef,
      });
      const wrote = await appendDecisionIntent(deps.repos, intent, context.at);
      if (!wrote.ok) return refuse("DOWNSTREAM_REFUSED", `Nothing was recorded — ${wrote.detail}.`);
      return {
        ok: true,
        outcome: "DONE",
        subject: subjectId,
        says: "Your decision is recorded. It closes the row on the next sync, and the card will say when that has happened.",
        openedWork: [],
        readBackAt: "/admin",
        undo: "Record a different decision on the same row; the later one stands and neither is deleted.",
      };
    },
  },

  /* ------------------------------------------------------ research.pause */
  {
    definition: {
      type: "research.pause",
      label: "Pause paid research",
      does: "Records a pause for the paid research lane on the runner's next read.",
      doesNot: "Does not stop the runner, cancel work already in flight, or pause plain-code work.",
      authority: "REVERSIBLE_NONPRODUCTION",
      subjectKind: "the paid research lane",
      requiresStateVersion: false,
      refusals: ["INVALID_INPUT", "DOWNSTREAM_REFUSED"],
    },
    validate(input) {
      const note = validateIntentNote("PAUSE", input.note);
      return note.ok ? { ok: true, value: { note: note.note } } : bad(note.detail);
    },
    execute(deps, context, input) {
      return appendIntent(deps, context, "PAUSE", input.note === null ? null : String(input.note), {
        says: "The paid research lane has been asked to pause. New paid work waits when the runner next reads this intent; work already in flight may finish.",
        undo: "A separate paid-research resume intent is required to resume paid work.",
      });
    },
  },

  /* -------------------------------------------------------- runner.pause */
  {
    definition: {
      type: "runner.pause",
      label: "Pause the runner",
      does: "Tells the standing runner to stop starting new cycles.",
      doesNot: "Does not stop work already running, and does not touch the machine.",
      authority: "REVERSIBLE_NONPRODUCTION",
      subjectKind: "the standing runner",
      requiresStateVersion: false,
      refusals: ["INVALID_INPUT", "DOWNSTREAM_REFUSED"],
    },
    validate(input) {
      const note = validateIntentNote("PAUSE_RUNNER", input.note);
      return note.ok ? { ok: true, value: { note: note.note } } : bad(note.detail);
    },
    execute(deps, context, input) {
      return appendIntent(deps, context, "PAUSE_RUNNER", input.note === null ? null : String(input.note), {
        says: "The runner has been asked to pause. It stops at the end of the cycle it is in, and the page says when it has.",
        undo: "Resume the runner.",
      });
    },
  },

  /* ------------------------------------------------------- runner.resume */
  {
    definition: {
      type: "runner.resume",
      label: "Resume the runner",
      does: "Tells the standing runner it may start cycles again.",
      doesNot: "Does not start a cycle immediately, and does not touch the machine.",
      authority: "REVERSIBLE_NONPRODUCTION",
      subjectKind: "the standing runner",
      requiresStateVersion: false,
      refusals: ["INVALID_INPUT", "DOWNSTREAM_REFUSED"],
    },
    validate(input) {
      const note = validateIntentNote("RESUME_RUNNER", input.note);
      return note.ok ? { ok: true, value: { note: note.note } } : bad(note.detail);
    },
    execute(deps, context, input) {
      return appendIntent(deps, context, "RESUME_RUNNER", input.note === null ? null : String(input.note), {
        says: "The runner has been asked to resume. It picks that up on its next look, and the page says when it has.",
        undo: "Pause the runner.",
      });
    },
  },

  /* -------------------------------------------------- runner.runCycleNow */
  {
    definition: {
      type: "runner.runCycleNow",
      label: "Run a cycle now",
      does: "Asks the runner to end its wait and start the next cycle early.",
      doesNot: "Does not add work, change what the cycle does, or override a pause.",
      authority: "REVERSIBLE_NONPRODUCTION",
      subjectKind: "the standing runner",
      requiresStateVersion: false,
      refusals: ["INVALID_INPUT", "DOWNSTREAM_REFUSED"],
    },
    validate(input) {
      const note = validateIntentNote("RUN_CYCLE_NOW", input.note);
      return note.ok ? { ok: true, value: { note: note.note } } : bad(note.detail);
    },
    execute(deps, context) {
      return appendIntent(deps, context, "RUN_CYCLE_NOW", null, {
        says: "The runner has been asked to start the next cycle early. It is waiting to be picked up, and the page says when it has been.",
        undo: "Nothing to undo — a cycle that has started runs to its end.",
      });
    },
  },

  /* ----------------------------------------------------- fleet.deployHere */
  {
    definition: {
      type: "fleet.deployHere",
      label: "Deploy fleet here",
      does:
        "Tells the fleet where to go next, in your words. Where your words name a state, the runner also creates the work " +
        "that state's registry defines and no clock carries yet.",
      doesNot:
        `Does not start paid research, publish anything, or invent work no registry defines, and it creates ${CREATION_SCOPE}. ` +
        "Without a state in your words it only reorders the work the fleet already has.",
      authority: "REVERSIBLE_NONPRODUCTION",
      subjectKind: "where you want the fleet to work",
      requiresStateVersion: false,
      refusals: ["INVALID_INPUT", "DOWNSTREAM_REFUSED"],
    },
    validate(input) {
      // A DISPATCH with no words is refused by the canonical validator: "deploy
      // the fleet" to nowhere is not an instruction.
      const note = validateIntentNote("DISPATCH", input.note);
      if (!note.ok || note.note === null) return bad(note.ok ? "say what the fleet should go do" : note.detail);
      /* MW-021: an optional budget of its own — the same dollar rule, and the same $0-holds-everything meaning, as a geography's. */
      if (input.budgetUsd === undefined || input.budgetUsd === null || input.budgetUsd === "") return { ok: true, value: { note: note.note } };
      const budget = validateScopeBudget(input.budgetUsd);
      return budget.ok ? { ok: true, value: { note: note.note, budgetUsd: budget.value } } : bad(budget.why);
    },
    execute(deps, context, input) {
      const budgetUsd = typeof input.budgetUsd === "number" ? input.budgetUsd : null;
      return appendIntent(
        deps,
        context,
        "DISPATCH",
        String(input.note),
        {
          says:
            "The fleet has been told where to go. The next cycle puts what matches first and records what it matched — including nothing, by name, if nothing is registered there. " +
            `Where your words name a state, it also creates the work that state's registry defines and no clock carries yet (${CREATION_SCOPE}), ` +
            "and its acknowledgement counts what it created, what it reordered and what missing data blocked. Work that needs a model waits for the paid lane." +
            (budgetUsd === null
              ? " It carries no budget of its own, so only the Fleet ceiling bounds paid work on it."
              : ` Paid work on what it reaches may spend $${budgetUsd.toFixed(2)} in any rolling 24 hours; the runner holds it back there once that is spent, and the Fleet ceiling still binds first.`),
          undo: "Send it somewhere else; the later instruction is the one the next cycle reads.",
        },
        budgetUsd,
      );
    },
  },

  /* --------------------------------------------------- fleet.retryWorkItem */
  {
    definition: {
      type: "fleet.retryWorkItem",
      label: "Try this work again",
      does: "Nothing yet — the console refuses this and says why.",
      doesNot: "Does not re-open the work, because nothing in the system can be asked to.",
      authority: "REVERSIBLE_NONPRODUCTION",
      subjectKind: "a piece of work that failed or is being held",
      requiresStateVersion: true,
      refusals: ["INVALID_INPUT", "STALE_STATE", "NOT_SUPPORTED_YET"],
    },
    validate(input) {
      const workItemId = text(input.workItemId);
      if (workItemId === "") return bad("name the piece of work to try again");
      return { ok: true, value: { workItemId } };
    },
    async execute(_deps, _context, input) {
      /*
       * REFUSED HONESTLY, AND THE MISSING SEAM IS NAMED.
       *
       * The scheduler's owner-intent vocabulary is CLOSED — PAUSE, RESUME,
       * RUN_CYCLE_NOW, DISPATCH, PAUSE_RUNNER, RESUME_RUNNER — and there is no
       * member of it that means "re-open this work item". The domain function
       * that would do it (`reclaimRouteTask` in
       * `lib/control-plane/repository/coordinator.ts`) is a runner-side
       * operation on a live lease, and the deployed console has neither the
       * lease nor a path to the runner. Adding a seventh intent and a runner
       * branch that honors it is a real change with a real blast radius, not
       * something a console pass may quietly assume.
       */
      return refuse(
        "NOT_SUPPORTED_YET",
        `Nothing in the system can be asked to try ${String(input.workItemId)} again yet. ` +
          "The missing piece is an owner intent meaning 're-open this work' in the scheduler's " +
          "closed intent list, and a branch in the standing runner that honors it. Until both " +
          "exist, this button would be a light with no wire behind it.",
      );
    },
  },

  /* ------------------------------------------------ fleet.requestReadback */
  {
    definition: {
      type: "fleet.requestReadback",
      label: "Read this back now",
      does: "Reads what the system currently holds about one thing, right now, and records what it said.",
      doesNot: "Does not re-measure anything — it reports what was last written, and when.",
      authority: "READ_ONLY",
      subjectKind: "something the runner publishes",
      requiresStateVersion: false,
      refusals: ["INVALID_INPUT", "DOWNSTREAM_REFUSED"],
    },
    validate(input) {
      const subject = text(input.subject).toLowerCase();
      if (!Object.prototype.hasOwnProperty.call(READBACK_SUBJECTS, subject)) {
        return bad(`there is nothing called '${subject || "that"}' to read back`);
      }
      return { ok: true, value: { subject } };
    },
    async execute(deps, _context, input) {
      const key = String(input.subject);
      const which = READBACK_SUBJECTS[key];
      try {
        const persisted =
          key === "control-centre"
            ? await deps.repos.ownerSnapshots.read(SNAPSHOT_ID)
            : key === "runner"
              ? await deps.repos.runnerHeartbeat.read(RUNNER_ID)
              : await deps.repos.researchState.read(RESEARCH_STATE_ID);
        if (persisted === null) {
          return {
            ok: true,
            outcome: "DONE",
            subject: key,
            says: `Asked just now: the store is reachable and holds nothing for ${which.name} yet. That is the runner not having written it, not a failure to look.`,
            openedWork: [],
            readBackAt: which.readBackAt,
            undo: null,
          };
        }
        return {
          ok: true,
          outcome: "DONE",
          subject: key,
          says: `Asked just now: ${which.name} was last written at ${persisted.updatedAt}, and it has been written ${persisted.revision} time${persisted.revision === 1 ? "" : "s"} in all.`,
          openedWork: [],
          readBackAt: which.readBackAt,
          undo: null,
        };
      } catch (error) {
        return refuse(
          "DOWNSTREAM_REFUSED",
          `We could not ask about ${which.name} (${(error as Error)?.name ?? "error"}). Nothing is being claimed about it either way.`,
        );
      }
    },
  },

  /* --------------------------------------------------- config.setApiFallback */
  {
    definition: {
      type: "config.setApiFallback",
      label: "Allow paid API fallback",
      does: "Records your decision about whether paid API fallback may be used, durably, so a restart cannot lose it.",
      doesNot:
        "Does not itself permit a single paid call: nothing in the running system reads this policy yet, and the refusal names the exact piece that is missing.",
      authority: "OWNER_DECISION_REQUIRED",
      subjectKind: "how the system may spend",
      requiresStateVersion: false,
      refusals: ["INVALID_INPUT", "DOWNSTREAM_REFUSED"],
    },
    validate(input) {
      const enabled = input.enabled;
      const on = enabled === true || enabled === "true" || enabled === "on" || enabled === 1;
      const off = enabled === false || enabled === "false" || enabled === "off" || enabled === 0;
      if (!on && !off) return bad("say whether paid API fallback is allowed or not allowed");
      const confirmed = input.confirmed;
      // §9A.22: "Require an explicit confirmation." Turning it ON is the
      // expensive direction, so that is the one that must be said twice.
      if (on && !(confirmed === true || confirmed === "true" || confirmed === "on" || confirmed === 1)) {
        return bad("turning paid API fallback on needs an explicit confirmation");
      }
      return { ok: true, value: { enabled: on } };
    },
    async execute(deps, context, input) {
      const enabled = input.enabled === true;
      const at = context.at;
      try {
        const existing = await deps.repos.adminConfig.read(ADMIN_CONFIG_ID);
        // A stored value that is not a config at all is treated as no config,
        // which reads as the default — and the default is OFF. There is no path
        // by which a corrupt row turns paid spending on.
        const current = existing !== null && isAdminConfig(existing.value) ? existing.value : defaultAdminConfig(at);
        const next = withApiFallback(current, {
          enabled,
          decidedAt: at,
          decidedBy: context.request.actorRef,
          receiptId: context.receiptId,
        });
        if (existing === null) await deps.repos.adminConfig.put(ADMIN_CONFIG_ID, next, at);
        else await deps.repos.adminConfig.compareAndSet(ADMIN_CONFIG_ID, existing.revision, next, at);
      } catch (error) {
        return storeRefusal("your decision about paid API fallback", error);
      }
      return {
        ok: true,
        outcome: "DONE",
        subject: "paid API fallback",
        says: enabled
          ? "Recorded: you have allowed paid API fallback, and that survives a restart. It does not switch anything on by itself — " +
            API_FALLBACK_MISSING_SEAM
          : "Recorded: paid API fallback is not allowed. That is also the default, and it is what a fresh deploy reads.",
        openedWork: [],
        readBackAt: "/admin",
        undo: enabled ? "Set it back to not allowed." : "Allow it again, with an explicit confirmation.",
      };
    },
  },

  /* ---------------------------------------------- config.setFleetSpendCeiling */
  {
    definition: {
      type: "config.setFleetSpendCeiling",
      label: "Set the Fleet spend ceiling",
      does:
        "Records the rolling 24-hour model-spend ceiling the Fleet runs under, durably, so a restart cannot lose it. The runner reads it at the start of its next cycle.",
      doesNot:
        "Does not start a cycle, deploy, restart, or spend anything by itself — it moves the ceiling the next cycle runs under. A lane paused at the old ceiling resumes on that cycle.",
      authority: "OWNER_DECISION_REQUIRED",
      subjectKind: "how much the Fleet may spend in a rolling day",
      // The record-level compare-and-set on the config row is the version check
      // this write inherits; there is no rendered card whose words can go stale
      // between draw and click, so a page-level staleness quote would only add
      // the quoted-vs-current mismatch that refuses good clicks, not safety.
      requiresStateVersion: false,
      refusals: ["INVALID_INPUT", "DOWNSTREAM_REFUSED"],
    },
    validate(input) {
      const raw = input.rollingCeilingUsd;
      const parsed = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw.trim()) : Number.NaN;
      if (!Number.isFinite(parsed)) return bad("say the new ceiling as a dollar amount");
      if (parsed <= 0) {
        return bad("the ceiling has to be more than $0 — to stop the Fleet, pause the runner instead");
      }
      if (parsed > FLEET_SPEND_CEILING_MAX_USD) {
        return bad(`that ceiling is above the $${FLEET_SPEND_CEILING_MAX_USD} maximum this control allows`);
      }
      // Whole cents; a fraction of a cent is a typo, not a budget.
      return { ok: true, value: { rollingCeilingUsd: Math.round(parsed * 100) / 100 } };
    },
    async execute(deps, context, input) {
      const rollingCeilingUsd = Number(input.rollingCeilingUsd);
      const at = context.at;
      // The ceiling in force the instant before this change — a prior override,
      // or the fallback — captured before the write so the receipt and undo name
      // what it WAS, not what it now is.
      let previousUsd: number;
      try {
        const existing = await deps.repos.adminConfig.read(ADMIN_CONFIG_ID);
        // A stored value that is not a config reads as the default — which
        // carries no override, so the previous ceiling is the built-in fallback.
        const current = existing !== null && isAdminConfig(existing.value) ? existing.value : defaultAdminConfig(at);
        previousUsd = resolveRollingCeiling(fleetSpendCeilingOverrideUsd(current)).rollingCeilingUsd;
        const next = withFleetSpendCeiling(current, {
          rollingCeilingUsd,
          previousUsd,
          decidedAt: at,
          decidedBy: context.request.actorRef,
          receiptId: context.receiptId,
        });
        if (existing === null) await deps.repos.adminConfig.put(ADMIN_CONFIG_ID, next, at);
        else await deps.repos.adminConfig.compareAndSet(ADMIN_CONFIG_ID, existing.revision, next, at);
      } catch (error) {
        return storeRefusal("your Fleet spend ceiling", error);
      }
      return {
        ok: true,
        outcome: "DONE",
        subject: "fleet spend ceiling",
        says:
          `Recorded: the Fleet spend ceiling is now $${rollingCeilingUsd.toFixed(2)} (was $${previousUsd.toFixed(2)}), and that survives a restart. ` +
          "The runner reads it at the start of its next cycle — no deploy, no restart — and a lane paused at the old ceiling resumes on that cycle. " +
          "Raising the ceiling removes a brake; it does not start a run.",
        openedWork: [],
        readBackAt: "/admin",
        undo: `Set it back to $${previousUsd.toFixed(2)}.`,
      };
    },
  },

  /* ------------------------------------------------- config.setDiscoverySearch */
  {
    definition: {
      type: "config.setDiscoverySearch",
      label: "Allow paid discovery search",
      does:
        "Records whether the meetings-discovery walk may send paid search requests (Brave and Exa), durably, so a restart cannot lose it. The runner reads it at the start of its next cycle.",
      doesNot:
        "Does not raise the runner's per-cycle and per-day search caps, resume paid research, or spend anything by itself. The free site walks run either way.",
      authority: "OWNER_DECISION_REQUIRED",
      subjectKind: "how the system may spend",
      // As with the ceiling dial, the compare-and-set on the config row is the
      // version check; no rendered card can go stale between draw and click.
      requiresStateVersion: false,
      refusals: ["INVALID_INPUT", "DOWNSTREAM_REFUSED"],
    },
    validate(input) {
      const enabled = input.enabled;
      const on = enabled === true || enabled === "true" || enabled === "on" || enabled === 1;
      const off = enabled === false || enabled === "false" || enabled === "off" || enabled === 0;
      if (!on && !off) return bad("say whether paid discovery search is allowed or not allowed");
      const confirmed = input.confirmed;
      // Turning it ON spends money, so that is the direction that must be said twice.
      if (on && !(confirmed === true || confirmed === "true" || confirmed === "on" || confirmed === 1)) {
        return bad("turning paid discovery search on needs an explicit confirmation");
      }
      return { ok: true, value: { enabled: on } };
    },
    async execute(deps, context, input) {
      const enabled = input.enabled === true;
      const at = context.at;
      try {
        const existing = await deps.repos.adminConfig.read(ADMIN_CONFIG_ID);
        // A stored value that is not a config reads as the default, which has no
        // decision, which reads OFF: a corrupt row never turns paid search on.
        const current = existing !== null && isAdminConfig(existing.value) ? existing.value : defaultAdminConfig(at);
        const next = withDiscoverySearch(current, {
          enabled,
          decidedAt: at,
          decidedBy: context.request.actorRef,
          receiptId: context.receiptId,
        });
        if (existing === null) await deps.repos.adminConfig.put(ADMIN_CONFIG_ID, next, at);
        else await deps.repos.adminConfig.compareAndSet(ADMIN_CONFIG_ID, existing.revision, next, at);
      } catch (error) {
        return storeRefusal("your decision about paid discovery search", error);
      }
      return {
        ok: true,
        outcome: "DONE",
        subject: "paid discovery search",
        says: enabled
          ? "Recorded: the meetings-discovery walk may now use paid search, inside the runner's per-cycle and per-day caps. " +
            "The runner reads this at the start of its next cycle; every request it sends is charged as DISCOVERY_SEARCH."
          : "Recorded: paid discovery search is off. That is also the default. The free site walks continue.",
        openedWork: [],
        readBackAt: "/admin",
        undo: enabled ? "Turn paid discovery search off." : "Allow it again, with an explicit confirmation.",
      };
    },
  },

  /* ------------------------------------------------------ expansion.scope.set */
  {
    definition: {
      type: "expansion.scope.set",
      label: "Select this geography for expansion",
      does:
        "Records a geography you chose from the Census lookup, with its priority and selected lifetime or rolling 24-hour budget for paid work there, durably. " +
        "When research is enabled, the standing runner wakes promptly for this Send. At the start of its next cycle it creates the work the registry defines there that no clock carries yet, and puts all work there first.",
      doesNot:
        `Does not open the paid lane, add a government or a source no registry defines, or raise any spend limit, and it creates ${CREATION_SCOPE}. ` +
        "Its budget can only hold paid work back.",
      authority: "OWNER_DECISION_REQUIRED",
      subjectKind: "a geography you want worked first",
      // The same reasoning as the spend-ceiling dial: the config row's own
      // compare-and-set is the version check, and a page-level quote would only
      // refuse good clicks.
      requiresStateVersion: false,
      refusals: ["INVALID_INPUT", "DOWNSTREAM_REFUSED"],
    },
    validate(input) {
      const nested = input.geography;
      const geography = validateScopeGeography(
        nested !== null && typeof nested === "object" ? (nested as Readonly<Record<string, unknown>>) : input,
      );
      if (!geography.ok) return bad(geography.why);
      const priority = validateScopePriority(input.priority);
      if (!priority.ok) return bad(priority.why);
      const budget = validateScopeBudget(input.budgetUsd);
      if (!budget.ok) return bad(budget.why);
      const note = validateScopeNote(input.note);
      if (!note.ok) return bad(note.why);
      /* MW-002: the owner's questions travel typed, never folded into the note. */
      const questions = validateWorkQuestions(input.questions);
      if (!questions.ok) return bad(questions.why);
      if (input.huntBudget !== undefined && typeof input.huntBudget !== "boolean") return bad("Choose a budget for this hunt or a rolling budget.");
      if (input.newHunt !== undefined && typeof input.newHunt !== "boolean") return bad("Choose whether this is a separate hunt.");
      return { ok: true, value: { geography: geography.value, priority: priority.value, budgetUsd: budget.value, huntBudget: input.huntBudget === true, newHunt: input.newHunt === true, note: note.value, questions: questions.value } };
    },
    async execute(deps, context, input) {
      const geography = input.geography as ExpansionScopeGeography;
      const priority = Number(input.priority);
      const budgetUsd = Number(input.budgetUsd);
      const questions = (Array.isArray(input.questions) ? input.questions : []) as readonly WorkQuestion[];
      const at = context.at;
      let previous: { readonly priority: number; readonly budgetUsd: number } | null = null;
      let ceilingUsd: number;
      let lifetime = false;
      let originalLifetime = false;
      try {
        const existing = await deps.repos.adminConfig.read(ADMIN_CONFIG_ID);
        const current = existing !== null && isAdminConfig(existing.value) ? existing.value : defaultAdminConfig(at);
        const held = expansionScopesOf(current);
        if (held.malformed > 0) {
          return refuse(
            "DOWNSTREAM_REFUSED",
            `${held.malformed} stored scope entr${held.malformed === 1 ? "y" : "ies"} on your policy row could not be read, so nothing was changed — writing over them would silently drop a budget you set.`,
          );
        }
        ceilingUsd = resolveRollingCeiling(fleetSpendCeilingOverrideUsd(current)).rollingCeilingUsd;
        const next = withScopeSet(held.scopes, {
          geography,
          priority,
          budgetUsd,
          huntBudget: input.huntBudget === true,
          newHunt: input.newHunt === true,
          note: input.note === null ? null : String(input.note),
          questions,
          decidedAt: at,
          decidedBy: context.request.actorRef,
          receiptId: context.receiptId,
        });
        previous = next.previous === null ? null : { priority: next.previous.priority, budgetUsd: next.previous.budgetUsd };
        const selected = next.scopes.find(s => s.key === scopeKeyOf(geography));
        lifetime = Boolean(selected?.budgetStartedAt);
        originalLifetime = selected?.key === ORIGINAL_LIFETIME_HUNT.key && selected.receiptId === ORIGINAL_LIFETIME_HUNT.receiptId &&
          selected.budgetStartedAt === ORIGINAL_LIFETIME_HUNT.budgetStartedAt && selected.budgetUsd === ORIGINAL_LIFETIME_HUNT.budgetUsd;
        const written = withExpansionScopes(current, { scopes: next.scopes, decidedAt: at });
        if (existing === null) await deps.repos.adminConfig.put(ADMIN_CONFIG_ID, written, at);
        else await deps.repos.adminConfig.compareAndSet(ADMIN_CONFIG_ID, existing.revision, written, at);
      } catch (error) {
        return storeRefusal("your expansion scope", error);
      }
      const what = `${geography.label} (${SCOPE_TYPE_WORDS[geography.type].toLowerCase()}, ${geography.stateAbbr})`;
      const was = previous === null ? "newly selected" : `was priority ${previous.priority} with $${previous.budgetUsd.toFixed(2)}`;
      return {
        ok: true,
        outcome: "DONE",
        subject: scopeKeyOf(geography),
        says:
          `Recorded: ${what} is priority ${priority} with a $${budgetUsd.toFixed(2)} ${lifetime ? "Anthropic token budget for this hunt" : "rolling 24-hour budget"} for paid work there (${was}), and that survives a restart. ` +
          "Recording it makes no model call itself. If research is enabled, the standing runner wakes promptly for this Send; if a cycle is already active, it finishes first. At the start of its next cycle the runner creates the work the registry defines there that no clock carries yet " +
          `(${CREATION_SCOPE}) and puts all work there first; the acknowledgement counts what was created, reordered and blocked. ` +
          "Work that needs a model waits: the paid lane stays exactly as it is, " +
          (originalLifetime
            ? `and this exact original $${ORIGINAL_LIFETIME_HUNT.budgetUsd.toFixed(2)} lifetime hunt keeps its instruction receipt and allowance; the $${ceilingUsd.toFixed(2)} Fleet rolling ceiling does not bind its exact work. This action has its own saved receipt.`
            : `and the Fleet ceiling of $${ceilingUsd.toFixed(2)} still binds first${budgetUsd > ceilingUsd ? " — this budget is above it, so the Fleet ceiling is the one that holds" : ""}.`) +
          (questions.length > 0
            ? ` Your questions are kept on it and on every piece of work it reaches: ${questions.map((q) => WORK_QUESTION_WORDS[q]).join(" ")}`
            : ""),
        openedWork: [],
        readBackAt: "/admin/work",
        undo:
          previous === null
            ? "Remove this geography from the expansion list."
            : `Set it back to priority ${previous.priority} with $${previous.budgetUsd.toFixed(2)}.`,
      };
    },
  },

  /* --------------------------------------------------- expansion.scope.remove */
  {
    definition: {
      type: "expansion.scope.remove",
      label: "Remove this geography from expansion",
      does:
        "Takes one geography off your expansion list, durably. The runner stops ordering its work first, creates nothing more there, and drops its budget at the start of its next cycle.",
      doesNot:
        "Does not stop, delete or undo any work, and does not change the Fleet ceiling — work there keeps its normal place in the queue.",
      authority: "OWNER_DECISION_REQUIRED",
      subjectKind: "a geography on your expansion list",
      requiresStateVersion: false,
      refusals: ["INVALID_INPUT", "DOWNSTREAM_REFUSED"],
    },
    validate(input) {
      const key = validateScopeKey(input.key);
      return key.ok ? { ok: true, value: { key: key.value } } : bad(key.why);
    },
    async execute(deps, context, input) {
      const key = String(input.key);
      const at = context.at;
      let removedLabel: string | null = null;
      try {
        const existing = await deps.repos.adminConfig.read(ADMIN_CONFIG_ID);
        const current = existing !== null && isAdminConfig(existing.value) ? existing.value : null;
        if (existing === null || current === null) {
          return { ok: true, outcome: "DONE", subject: key, says: "That geography was not on your expansion list, so nothing changed.", openedWork: [], readBackAt: "/admin/work", undo: null };
        }
        const held = expansionScopesOf(current);
        if (held.malformed > 0) {
          return refuse(
            "DOWNSTREAM_REFUSED",
            `${held.malformed} stored scope entr${held.malformed === 1 ? "y" : "ies"} on your policy row could not be read, so nothing was changed — rewriting the list would silently drop them.`,
          );
        }
        const next = withScopeRemoved(held.scopes, key);
        if (next.removed === null) {
          return { ok: true, outcome: "DONE", subject: key, says: "That geography was not on your expansion list, so nothing changed.", openedWork: [], readBackAt: "/admin/work", undo: null };
        }
        removedLabel = next.removed.geography.label;
        await deps.repos.adminConfig.compareAndSet(ADMIN_CONFIG_ID, existing.revision, withExpansionScopes(current, { scopes: next.scopes, decidedAt: at }), at);
      } catch (error) {
        return storeRefusal("the change to your expansion list", error);
      }
      return {
        ok: true,
        outcome: "DONE",
        subject: key,
        says:
          `Removed: ${removedLabel} is no longer on your expansion list. From the runner's next cycle its work keeps its normal place in the queue, ` +
          "and its budget no longer holds paid work back. Nothing already done is undone.",
        openedWork: [],
        readBackAt: "/admin/work",
        undo: "Select it again from the Census lookup, with the priority and budget you want.",
      };
    },
  },

  /* ---------------------------------------------------- billing.fact.record */
  {
    definition: {
      type: "billing.fact.record",
      label: "Record a billing figure",
      does:
        "Records a figure you read from a provider's console, invoice or export — its amount, the period it covers, the day you read it and where — durably, so the Money screen can show it beside what the system measures itself.",
      doesNot:
        "Does not change any ceiling, budget or runner decision, and is never added to the system's own measured ledger for the same money. Entering the same provider, kind and period again corrects the earlier figure rather than adding a second one.",
      authority: "OWNER_DECISION_REQUIRED",
      subjectKind: "a figure from a bill the system cannot read",
      // The config row's compare-and-set is the version check, exactly as for
      // the spend dial; a figure the owner read does not go stale on the page.
      requiresStateVersion: false,
      refusals: ["INVALID_INPUT", "DOWNSTREAM_REFUSED"],
    },
    validate(input) {
      // The day-read check against today runs again in execute, which has the gateway's clock.
      const checked = validateBillingFact(input, "9999-12-31");
      return checked.ok ? { ok: true, value: { ...checked.value } } : bad(checked.why);
    },
    async execute(deps, context, input) {
      const at = context.at;
      const rechecked = validateBillingFact(input, at.slice(0, 10));
      if (!rechecked.ok) return refuse("INVALID_INPUT", `Nothing was recorded: ${rechecked.why}.`);
      const fact: BillingFact = {
        ...rechecked.value,
        id: billingFactId(rechecked.value),
        decidedAt: at,
        decidedBy: context.request.actorRef,
        receiptId: context.receiptId,
      };
      let previous: BillingFact | null = null;
      try {
        const existing = await deps.repos.adminConfig.read(ADMIN_CONFIG_ID);
        const current = existing !== null && isAdminConfig(existing.value) ? existing.value : defaultAdminConfig(at);
        const held = billingFactsOf(current);
        if (held.malformed > 0) {
          return refuse(
            "DOWNSTREAM_REFUSED",
            `${held.malformed} stored billing figure${held.malformed === 1 ? "" : "s"} on your policy row could not be read, so nothing was changed — rewriting the list would silently drop them.`,
          );
        }
        const next = withFactRecorded(held.facts, fact);
        previous = next.previous;
        const written = withBillingFacts(current, { facts: next.facts, decidedAt: at });
        if (existing === null) await deps.repos.adminConfig.put(ADMIN_CONFIG_ID, written, at);
        else await deps.repos.adminConfig.compareAndSet(ADMIN_CONFIG_ID, existing.revision, written, at);
      } catch (error) {
        return storeRefusal("your billing figure", error);
      }
      const name = fact.label ?? providerDefinition(fact.provider).name;
      return {
        ok: true,
        outcome: "DONE",
        subject: fact.id,
        says:
          `Recorded: ${name}, ${factAmountWords(fact)} (${factPeriodWords(fact).toLowerCase()}), read ${fact.asOf} from ${fact.source}` +
          (previous === null ? "." : `, correcting the ${factAmountWords(previous)} entered for the same slot.`) +
          " It is shown beside the system's own measurements and never added to them.",
        openedWork: [],
        readBackAt: "/admin/money",
        undo: previous === null ? "Remove this figure." : `Enter ${factAmountWords(previous)} again for the same slot.`,
      };
    },
  },

  /* ---------------------------------------------------- billing.fact.remove */
  {
    definition: {
      type: "billing.fact.remove",
      label: "Remove a billing figure",
      does: "Takes one figure you entered off the Money screen, durably.",
      doesNot: "Does not change any ceiling, budget or measurement; the provider's row goes back to saying it has no reading.",
      authority: "OWNER_DECISION_REQUIRED",
      subjectKind: "a billing figure you entered",
      requiresStateVersion: false,
      refusals: ["INVALID_INPUT", "DOWNSTREAM_REFUSED"],
    },
    validate(input) {
      const id = text(input.id);
      if (id === "" || id.length > 200) return bad("say which figure to remove");
      return { ok: true, value: { id } };
    },
    async execute(deps, context, input) {
      const id = String(input.id);
      const at = context.at;
      let removed: BillingFact | null = null;
      try {
        const existing = await deps.repos.adminConfig.read(ADMIN_CONFIG_ID);
        const current = existing !== null && isAdminConfig(existing.value) ? existing.value : null;
        if (existing === null || current === null) {
          return { ok: true, outcome: "DONE", subject: id, says: "That figure was not recorded, so nothing changed.", openedWork: [], readBackAt: "/admin/money", undo: null };
        }
        const held = billingFactsOf(current);
        if (held.malformed > 0) {
          return refuse(
            "DOWNSTREAM_REFUSED",
            `${held.malformed} stored billing figure${held.malformed === 1 ? "" : "s"} on your policy row could not be read, so nothing was changed — rewriting the list would silently drop them.`,
          );
        }
        const next = withFactRemoved(held.facts, id);
        if (next.removed === null) {
          return { ok: true, outcome: "DONE", subject: id, says: "That figure was not recorded, so nothing changed.", openedWork: [], readBackAt: "/admin/money", undo: null };
        }
        removed = next.removed;
        await deps.repos.adminConfig.compareAndSet(ADMIN_CONFIG_ID, existing.revision, withBillingFacts(current, { facts: next.facts, decidedAt: at }), at);
      } catch (error) {
        return storeRefusal("the change to your billing figures", error);
      }
      return {
        ok: true,
        outcome: "DONE",
        subject: id,
        says: `Removed: ${removed.label ?? providerDefinition(removed.provider).name}, ${factAmountWords(removed)} (${factPeriodWords(removed).toLowerCase()}). That row goes back to saying it has no reading.`,
        openedWork: [],
        readBackAt: "/admin/money",
        undo: `Enter ${factAmountWords(removed)} again, read ${removed.asOf} from ${removed.source}.`,
      };
    },
  },

  /* ---------------------------------------------------------- review.decide */
  {
    definition: {
      type: "review.decide",
      label: "Record your review decision",
      does: "Records what you decided about the exact build you were looking at.",
      doesNot: "Does not merge, deploy, promote or notify anyone — the record is the end of the line.",
      authority: "OWNER_DECISION_REQUIRED",
      subjectKind: "one build of the software",
      // The build under review moves on its own. The writer re-fetches the live
      // manifest and refuses a decision aimed at a build that has been replaced,
      // and quoting the render's version here catches the same thing earlier.
      requiresStateVersion: true,
      refusals: ["INVALID_INPUT", "STALE_STATE", "ALREADY_DONE", "DOWNSTREAM_REFUSED"],
    },
    validate(input) {
      const action = text(input.action);
      if (action === "") return bad("say which kind of review decision this is");
      const stagingSha = text(input.stagingSha);
      if (stagingSha === "") return bad("a review decision has to name the exact build it is about");
      return {
        ok: true,
        value: {
          action,
          stagingSha,
          section: text(input.section) || null,
          decision: text(input.decision) || null,
          feedback: typeof input.feedback === "string" ? input.feedback : null,
          choice: text(input.choice) || null,
        },
      };
    },
    async execute(deps, _context, input) {
      if (deps.recordReview === null) {
        return refuse(
          "DOWNSTREAM_REFUSED",
          "The review writer is not wired into this console, so nothing was recorded. " +
            "Nothing has been decided and nothing is pretending otherwise.",
        );
      }
      const outcome = await deps.recordReview({
        action: String(input.action),
        stagingSha: String(input.stagingSha),
        section: input.section === null ? null : String(input.section),
        decision: input.decision === null ? null : String(input.decision),
        feedback: input.feedback === null ? null : String(input.feedback),
        choice: input.choice === null ? null : String(input.choice),
      });
      if (!outcome.ok) {
        /*
         * The writer's refusals are richer than the gateway's, so they are
         * MAPPED rather than flattened: a decision aimed at a build that has
         * been replaced is the gateway's own staleness, and one that is already
         * recorded is its own idempotency. Everything else is honestly "the
         * system that would do this refused".
         */
        const mapped: RefusalCode =
          outcome.code === "STALE_SHA"
            ? "STALE_STATE"
            : outcome.code === "BAD_REQUEST"
              ? "INVALID_INPUT"
              : outcome.code === "ALREADY_RECORDED"
                ? "ALREADY_DONE"
                : "DOWNSTREAM_REFUSED";
        return refuse(mapped, `Nothing was recorded — ${outcome.detail}.`);
      }
      return {
        ok: true,
        outcome: "DONE",
        subject: String(input.stagingSha),
        says: `Recorded against the build you were looking at. ${outcome.detail}.`,
        openedWork: (outcome.rowIds ?? []).map((id) => ({ kind: "review record", id, title: "your review decision" })),
        readBackAt: "/admin/release-review",
        undo: "Record a different decision on the same build; both are kept and the later one is the one that counts.",
      };
    },
  },

  /* ------------------------------------------------- prohibited.promotionOn */
  {
    definition: {
      type: "prohibited.promotionOn",
      label: "Turn promotion on",
      does: "Nothing. This is refused every time, by design, and the refusal is recorded.",
      doesNot: "Does not turn promotion on, ask anyone whether it should, or leave a way to.",
      authority: "PROHIBITED",
      subjectKind: "the nightly promotion door",
      requiresStateVersion: false,
      refusals: ["PROHIBITED_ACTION"],
    },
    validate() {
      // Declared so the refusal is typed and provable. The gateway refuses a
      // PROHIBITED class before it ever validates, so this is unreachable — and
      // it fails closed anyway rather than returning a value nobody checked.
      return bad("this is never allowed from here");
    },
    async execute() {
      return refuse(
        "PROHIBITED_ACTION",
        "Promotion is not something this console can turn on. That is deliberate and there is no version of this button that works.",
      );
    },
  },
];

/**
 * The registry, by type.
 *
 * Built from the list rather than written as a literal so a definition's `type`
 * and its key cannot disagree — a mismatch there would make an action
 * unreachable under its own name while looking present.
 */
export const ACTION_REGISTRY: Readonly<Record<string, RegisteredAction>> = Object.freeze(
  Object.fromEntries(REGISTRY.map((entry) => [entry.definition.type, entry])),
);

/** Every action type the console has, in declaration order. */
export const ACTION_TYPES: readonly string[] = REGISTRY.map((entry) => entry.definition.type);

/**
 * The action, or null.
 *
 * `Object.prototype.hasOwnProperty` rather than a truthiness check, because
 * `ACTION_REGISTRY["toString"]` is a function on any plain object and a lookup
 * that trusted it would have handed the gateway something that is not an
 * action at all.
 */
export function lookupAction(type: string): RegisteredAction | null {
  if (typeof type !== "string") return null;
  return Object.prototype.hasOwnProperty.call(ACTION_REGISTRY, type) ? ACTION_REGISTRY[type] : null;
}

/** The definitions alone, for a surface that renders what a control will do before it is pressed. */
export function actionDefinitions(): readonly ActionDefinition[] {
  return REGISTRY.map((entry) => entry.definition);
}
