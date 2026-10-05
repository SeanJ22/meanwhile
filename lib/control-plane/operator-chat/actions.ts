/**
 * **THE CHAT'S ACTIONS ARE THE BUTTONS' ACTIONS.** (ADM-C7 through §3.5.)
 *
 * §3.5 of the brief is a single prohibition with a long tail:
 *
 * > Do not create one action path for buttons and another privileged action
 * > path for chat. They must share action schema, authorization, validation,
 * > stale-state handling, idempotency, receipt production, refusal behavior.
 *
 * The way to obey that is not to be careful; it is to leave the chat nothing of
 * its own to be careful with. So this module:
 *
 * - **owns no action list.** Every action it can offer comes from the gateway's
 *   registry of {@link ActionDefinition}, passed in. A type this file does not
 *   know is a type this file cannot invent.
 * - **builds a request and stops.** {@link chatActionRequest} produces an
 *   {@link ActionRequest} and nothing else. The gateway authorizes it, validates
 *   it, decides whether it is stale, dedupes it and writes the receipt.
 * - **writes no receipt, ever.** There is no `ActionReceipt` literal anywhere in
 *   the operator-chat directory, and a test asserts it. That is what makes
 *   "the same receipt semantics as the equivalent UI control" true by
 *   construction: the chat has no receipt semantics of its own to differ with.
 * - **refuses in the gateway's words.** When a refusal is one the gateway
 *   already names — an authority mismatch, an unknown action — the sentence
 *   comes from `refusalSays`, not from a second vocabulary kept here.
 *
 * ## Propose, then confirm, then submit
 *
 * A chat message never submits. It produces a PROPOSAL carrying the exact
 * request, its authority class, what it will do and what it will not do. The
 * owner confirms, and the console re-derives the proposal from the same message
 * text — it does not trust the browser to hand back an action — and submits the
 * request it built itself.
 *
 * ## Idempotency, and why the proposal's own instant is in the key
 *
 * The key is a fingerprint of (type, subject, words, quoted state, the instant
 * the proposal was made). Confirming one proposal twice is one action, because
 * every part of the key is fixed by the proposal. Asking again tomorrow is a
 * new action, because the instant moved — which is the same reasoning the
 * decision log's `<subjectId>:<decidedAt>` and the break-glass incident id are
 * built on. A key derived from content alone would silently swallow a
 * legitimate repeat.
 *
 * PURE. No store, no clock, no environment — the instant arrives as an argument.
 */

import { fingerprint } from "../ids.ts";
import {
  authorityPermits,
  refusalSays,
  type ActionDefinition,
  type ActionOutcome,
  type ActionRequest,
  type CallerAuthority,
} from "../gateway/contract.ts";
import type { OperatorContext } from "./context.ts";
import { CHAT_CALLER, type ActionProposal } from "./contract.ts";

/**
 * What came back from the gateway.
 *
 * A REFUSAL is not this branch: a refusal is an outcome with a receipt, because
 * §3.7 makes it one — the gateway looked, decided and recorded the decision.
 * `ok: false` here is narrower and rarer: the gateway never got to decide,
 * because the door itself would not open. That is a fact about the console and
 * it is said as one, rather than dressed up as a refusal the gateway never made.
 */
export type GatewaySubmission =
  | { readonly ok: true; readonly outcome: ActionOutcome }
  | { readonly ok: false; readonly says: string };

/**
 * The one seam between the chat and the Action Gateway.
 *
 * `registry` is the gateway's own declared actions; `submit` puts a request
 * through the gateway's own door. Both come from the gateway together or
 * neither comes at all, because a registry without a submit would let the
 * console offer a control that nothing carries out.
 */
export interface GatewayBinding {
  readonly registry: readonly ActionDefinition[];
  /** Set only by the authenticated owner route; delegated chat keeps its ceiling. */
  readonly caller?: CallerAuthority;
  readonly submit: (request: ActionRequest) => Promise<GatewaySubmission>;
}

/** The definition for a type, out of the gateway's registry. */
export function definitionFor(
  registry: readonly ActionDefinition[],
  type: string,
): ActionDefinition | null {
  return registry.find((d) => d.type === type) ?? null;
}

/** Why a proposal could not be made. A sentence for the owner, never a code. */
export interface ProposalRefusal {
  readonly says: string;
  readonly actionType: string | null;
}

export type ProposalOutcome =
  | { readonly ok: true; readonly proposal: ActionProposal }
  | { readonly ok: false; readonly refusal: ProposalRefusal };

/**
 * The request the chat would submit for this action.
 *
 * Exported on its own so a test — and any UI control that wants the identical
 * shape — can build one without going through the classifier.
 */
export function chatActionRequest(input: {
  readonly definition: ActionDefinition;
  readonly subject: string;
  readonly words: string;
  readonly stateVersion: string | null;
  readonly actorRef: string;
  readonly proposedAt: string;
  readonly orderInput?: Readonly<Record<string,unknown>>;
  readonly caller?: CallerAuthority;
  readonly willDo?: string;
}): ActionRequest {
  const { definition, subject, words, stateVersion, actorRef, proposedAt } = input;
  return {
    type: definition.type,
    subject,
    /*
     * `note` and not `comment` or `freeText`: the aggregate-only boundary
     * refuses those field names recursively at append time, and `note` is
     * already the field both existing intent paths carry the owner's words in.
     */
    input: input.orderInput ?? { note: words },
    stateVersion: definition.requiresStateVersion ? stateVersion : null,
    idempotencyKey: fingerprint([definition.type, subject, words, stateVersion, proposedAt, JSON.stringify(input.orderInput ?? {note:words}), input.caller ?? CHAT_CALLER]),
    caller: input.caller ?? CHAT_CALLER,
    actorRef,
  };
}

/**
 * Turn a matched action into a proposal, or refuse.
 *
 * The two refusals here are the two the chat can decide by itself:
 *
 *   AUTHORITY   the operator chat may not invoke this authority class. The
 *               sentence is the gateway's own, so the chat and the button say
 *               the same thing when a control is out of reach.
 *   NO STATE    the action must quote the state it was rendered against and
 *               this console could not read that state. Not a gateway refusal —
 *               a gap on the reading side — so it is said as a gap.
 *
 * Everything else — an unknown type, a stale quote, a duplicate, a downstream
 * that says no — is the gateway's to decide, and is decided at submit.
 */
export function proposeAction(input: {
  readonly definition: ActionDefinition;
  readonly subject: string | null;
  readonly words: string;
  readonly context: OperatorContext;
  readonly actorRef: string;
  readonly proposedAt: string;
  readonly orderInput?: Readonly<Record<string,unknown>>;
  readonly caller?: CallerAuthority;
  readonly willDo?: string;
}): ProposalOutcome {
  const { definition, subject, words, context, actorRef, proposedAt } = input;

  if (!authorityPermits(input.caller ?? CHAT_CALLER, definition.authority)) {
    return {
      ok: false,
      refusal: { says: refusalSays("AUTHORITY_MISMATCH", definition.label), actionType: definition.type },
    };
  }

  if (definition.requiresStateVersion && context.stateVersion === null) {
    return {
      ok: false,
      refusal: {
        says:
          `${definition.label} has to quote the state of the console it was asked from, and this console could not read that state. ` +
          "Nothing was proposed, because a control that cannot say what it was looking at cannot be told whether the world has moved since.",
        actionType: definition.type,
      },
    };
  }

  const on = subject ?? "";
  if (on === "") {
    return {
      ok: false,
      refusal: {
        says:
          `${definition.label} acts on one ${definition.subjectKind}, and the message did not name one. ` +
          `Say it again with the ${definition.subjectKind} in it, or use the control on the page where that ${definition.subjectKind} is shown.`,
        actionType: definition.type,
      },
    };
  }

  const request = chatActionRequest({ definition, subject: on, words, stateVersion: context.stateVersion, actorRef, proposedAt, orderInput:input.orderInput, caller:input.caller });
  return {
    ok: true,
    proposal: {
      definition,
      request,
      confirmToken: request.idempotencyKey,
      willDo: input.willDo ?? definition.does,
      willNotDo: definition.doesNot,
    },
  };
}
