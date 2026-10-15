
import { parsePlainOrder } from "./orders.ts";
import { readPlaceWords } from "../../hunt/place-words.ts";
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

/** `gateway` is null when no Action Gateway is bound; the console then answers questions and offers no controls. */
export interface ChatDeps {
  readonly gateway: GatewayBinding | null;
  readonly actorRef: string;
}

function canAnswer(deps: ChatDeps): readonly string[] {
  const questions = [...everyQuestion()];
  for (const definition of deps.gateway?.registry ?? []) {
    if (authorityPermits(deps.gateway?.caller ?? CHAT_CALLER, definition.authority)) questions.push(definition.label);
  }
  return questions;
}

/** Classified here and again in `respondToOperator`; the classifier is pure, so the two cannot disagree. */
export function readsFor(text: string, registry: readonly ActionDefinition[]): readonly ContextRead[] {
  const routed = classify(text, registry);
  if (routed.kind === "TOPIC") return requiredReads(routed.topic);
  if (routed.kind === "ACTION") return (routed.actionType === "expansion.scope.set") ? [...ACTION_READS, "config"] : ACTION_READS;
  return [];
}

const NOT_UNDERSTOOD =
  "That is not one of the questions this console answers from its records, and it does not guess. " +
  "Ask one of these, or use the control on the page where the thing you mean is shown.";

/** Prohibitions first, then deterministic questions, then gateway actions, then "I do not answer that". */
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
    if (plain?.type === "fleet.deployHere") {
      const named = await readPlaceWords(String(plain.input.note));
      if (named.state === "CHOICES") return { kind: "REFUSED", actionType: definition.type,
        says: `“${String(plain.input.note)}” names ${named.choices.length} places: ${named.choices.slice(0, 8).map(c => c.label).join("; ")}${named.choices.length > 8 ? "; …" : ""}. Say which one, like “hunt ${named.choices[0]!.words}”.` };
    }
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

    const answer = await gateway.submit(outcome.proposal.request);
    if (!answer.ok) {
      return { kind: "REFUSED", says: answer.says, actionType: definition.type };
    }
    return { kind: "SUBMITTED", proposal: outcome.proposal, outcome: answer.outcome };
  }

  return { kind: "UNROUTED", says: NOT_UNDERSTOOD, canAnswer: canAnswer(deps) };
}
