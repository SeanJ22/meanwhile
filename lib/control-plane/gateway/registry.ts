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
  isAdminConfig,
  withApiFallback,
  API_FALLBACK_MISSING_SEAM,
} from "./admin-config.ts";
import type { ActionDefinition, ActionRequest, ReceiptOutcome, RefusalCode } from "./contract.ts";

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
  action: "PAUSE_RUNNER" | "RESUME_RUNNER" | "RUN_CYCLE_NOW" | "DISPATCH",
  note: string | null,
  said: { readonly says: string; readonly undo: string | null },
): Promise<ActionResult> {
  const requestedAt = context.at;
  const intent = buildResearchIntent(action, requestedAt, context.request.actorRef, note);
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
 * no filesystem, so it cannot re-run `pnpm owner:publish` or a code-identity
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
      does: "Tells the fleet where to go next, in your words.",
      doesNot: "Does not invent work — it reorders the work the fleet already has.",
      authority: "REVERSIBLE_NONPRODUCTION",
      subjectKind: "where you want the fleet to work",
      requiresStateVersion: false,
      refusals: ["INVALID_INPUT", "DOWNSTREAM_REFUSED"],
    },
    validate(input) {
      // A DISPATCH with no words is refused by the canonical validator: "deploy
      // the fleet" to nowhere is not an instruction.
      const note = validateIntentNote("DISPATCH", input.note);
      return note.ok && note.note !== null ? { ok: true, value: { note: note.note } } : bad(note.ok ? "say what the fleet should go do" : note.detail);
    },
    execute(deps, context, input) {
      return appendIntent(deps, context, "DISPATCH", String(input.note), {
        says: "The fleet has been told where to go. The next cycle puts what matches first and records what it matched — including nothing, by name, if nothing is registered there.",
        undo: "Send it somewhere else; the later instruction is the one the next cycle reads.",
      });
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
