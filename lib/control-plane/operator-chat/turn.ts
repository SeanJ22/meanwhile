/**
 * **ONE MESSAGE IN, ONE TYPED TURN OUT.** (ADM-C7.)
 *
 * The whole surface, in one total function: classify, answer from a read model,
 * propose an action through the Action Gateway, or say plainly that the console
 * does not answer that. Pure with respect to everything except the gateway call
 * it is handed, so the classifier, the read models, the refusals and the
 * proposal shape are all unit-testable without a store, a clock or a network.
 *
 * ## Why this console does not call a model, stated rather than implied
 *
 * The brief permits a model where a deterministic answer does not exist, on one
 * condition: use the existing bounded-worker transport and budget path, and add
 * no new unbudgeted provider call. Measured against this repository, that seam
 * does not reach a web request, and the reasons are structural rather than
 * missing wiring:
 *
 * - the only model transport is `anthropicTransport`, constructed in exactly
 *   three places, all inside the runner's own cycle process;
 * - every construction is wrapped by `FleetSafetyController.guardedModelTransport`,
 *   which reserves and settles spend against the cost ledger for a CYCLE. A web
 *   request has no cycle, no Attempt, no lease and no dispatch, so there is
 *   nothing for a reservation to be charged to;
 * - `assertStepMayInvokeModel` refuses any step not in the closed `SCOUT_STEPS`
 *   registry, and no chat step is in it;
 * - the credential is read by name in the runner's child process only.
 *
 * Wiring a request-path model call would therefore mean a NEW unbudgeted
 * provider call, which the brief forbids in the same paragraph that permits the
 * model. So the chat is fully deterministic, the page says so on its face, and
 * the missing seam is reported rather than papered over. Every answer carries
 * `usedModel: false` for the same reason the brief asked the opposite question:
 * so the owner never has to wonder.
 */

import { parsePlainOrder } from "./orders.ts";
import { classify } from "./router.ts";
import { answerFor } from "./read-models.ts";
import { definitionFor, proposeAction, type GatewayBinding } from "./actions.ts";
import { ACTION_READS, requiredReads, type ContextRead, type OperatorContext } from "./context.ts";
import { authorityPermits, type ActionDefinition } from "../gateway/contract.ts";
import {
  CHAT_CALLER,
  CHAT_MESSAGE_MAX_CHARS,
  PROHIBITION_WORDS,
  everyQuestion,
  type ChatInput,
  type ChatTurn,
} from "./contract.ts";

/**
 * What one turn needs beyond the records.
 *
 * `gateway` is null when this build has no Action Gateway bound. That is a
 * legitimate state and not a degraded one: with no gateway the console answers
 * questions and offers no controls, which is exactly what it should do rather
 * than offer a control nothing carries out.
 */
export interface ChatDeps {
  readonly gateway: GatewayBinding | null;
  /** The admin session reference for the audit record. Never a person's name. */
  readonly actorRef: string;
}

/**
 * The list the console offers when it did not understand.
 *
 * The questions, plus the controls the chat may ACTUALLY ask for — filtered by
 * the gateway's own authority ladder, because offering a control the console
 * would then refuse is worse than not offering it.
 */
function canAnswer(deps: ChatDeps): readonly string[] {
  const questions = [...everyQuestion()];
  for (const definition of deps.gateway?.registry ?? []) {
    if (authorityPermits(deps.gateway?.caller ?? CHAT_CALLER, definition.authority)) questions.push(definition.label);
  }
  return questions;
}

/**
 * Which records this message needs read, before any of them are read.
 *
 * The route calls this, reads exactly that set, and then calls
 * {@link respondToOperator}, which classifies the same text again. Classifying
 * twice is deliberate: the classifier is pure and costs nothing, and the
 * alternative — passing the routing decision from the route into the turn —
 * would let the two disagree about what was asked.
 */
export function readsFor(text: string, registry: readonly ActionDefinition[]): readonly ContextRead[] {
  const routed = classify(text, registry);
  if (routed.kind === "TOPIC") return requiredReads(routed.topic);
  if (routed.kind === "ACTION") return (routed.actionType === "expansion.scope.set" || routed.actionType === "orders.sequence") ? [...ACTION_READS, "config"] : ACTION_READS;
  return [];
}

const NOT_UNDERSTOOD =
  "That is not one of the questions this console answers from its records, and it does not guess. " +
  "Ask one of these, or use the control on the page where the thing you mean is shown.";

/**
 * Answer one message.
 *
 * The order is the router's order and the router's reasons: prohibitions first
 * so no phrasing routes around them, then the closed set of deterministic
 * questions, then the gateway's own registry of actions, then an honest
 * "I do not answer that".
 */
export async function respondToOperator(
  deps: ChatDeps,
  context: OperatorContext,
  input: ChatInput,
): Promise<ChatTurn> {
  const text = input.text.trim();
  if (text === "") {
    return { kind: "UNROUTED", says: NOT_UNDERSTOOD, canAnswer: canAnswer(deps) };
  }
  if (text.length > CHAT_MESSAGE_MAX_CHARS) {
    return {
      kind: "UNROUTED",
      says: `That message is longer than the ${CHAT_MESSAGE_MAX_CHARS} characters this console accepts, so nothing was read from it. Ask one thing at a time.`,
      canAnswer: canAnswer(deps),
    };
  }

  const registry = deps.gateway?.registry ?? [];
  const routed = classify(text, registry);

  if (routed.kind === "PROHIBITED") {
    return { kind: "PROHIBITED", code: routed.code, says: PROHIBITION_WORDS[routed.code] };
  }

  if (routed.kind === "TOPIC") {
    return {
      kind: "ANSWER",
      answer: answerFor(routed.topic, context, routed.normalized, routed.subject?.value ?? null),
    };
  }

  if (routed.kind === "ACTION") {
    const gateway = deps.gateway;
    if (gateway === null) {
      return {
        kind: "REFUSED",
        says: "This console has no controls connected in this build, so nothing can be carried out from here. The questions it answers from its records still work.",
        actionType: routed.actionType,
      };
    }
    const definition = definitionFor(registry, routed.actionType);
    if (definition === null) {
      // The registry answered a moment ago and does not now. Fail closed.
      return {
        kind: "REFUSED",
        says: "The console matched a control and then could not find it, so it did nothing. Use the control on the page instead.",
        actionType: routed.actionType,
      };
    }

    /*
     * The proposal is re-derived from the SAME message text on the confirm, so
     * the console never trusts the browser to hand back an action. Only the
     * instant is carried across, and it is carried because it is in the
     * idempotency key: confirming one proposal twice must be one action.
     */
    const plain = parsePlainOrder(text, context);
    if (plain && "why" in plain) return {kind:"REFUSED",says:plain.why,actionType:definition.type};
    const proposedAt = input.confirm?.proposedAt ?? context.nowIso;
    const outcome = proposeAction({
      definition,
      subject: plain?.subject ?? routed.subject?.value ?? null,
      words: text,
      context,
      actorRef: deps.actorRef,
      proposedAt,
      orderInput: plain?.input, caller: gateway.caller, willDo: plain?.willDo,
    });
    if (!outcome.ok) {
      return { kind: "REFUSED", says: outcome.refusal.says, actionType: outcome.refusal.actionType };
    }

    if (input.confirm === undefined) {
      return { kind: "PROPOSED", proposal: outcome.proposal };
    }
    if (input.confirm.token !== outcome.proposal.confirmToken) {
      return {
        kind: "REFUSED",
        says:
          "The confirmation did not match the proposal this console had made, so nothing was submitted. " +
          "Ask again and confirm the proposal you are shown.",
        actionType: definition.type,
      };
    }

    /*
     * The gateway's answer is returned by reference, unexamined and unedited.
     * Whatever it decided — done, queued, refused, already done — is what the
     * owner reads, in the gateway's words, on the gateway's receipt. The only
     * branch this function takes is the one where the gateway never decided at
     * all, and that is reported as itself rather than as a refusal.
     */
    const answer = await gateway.submit(outcome.proposal.request);
    if (!answer.ok) {
      return { kind: "REFUSED", says: answer.says, actionType: definition.type };
    }
    return { kind: "SUBMITTED", proposal: outcome.proposal, outcome: answer.outcome };
  }

  return { kind: "UNROUTED", says: NOT_UNDERSTOOD, canAnswer: canAnswer(deps) };
}
