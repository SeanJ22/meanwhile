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

/** `ok: false` means the gateway never got to decide; a gateway refusal is an outcome with a receipt. */
export type GatewaySubmission =
  | { readonly ok: true; readonly outcome: ActionOutcome }
  | { readonly ok: false; readonly says: string };

export interface GatewayBinding {
  readonly registry: readonly ActionDefinition[];
  /** Set only by the authenticated owner route; delegated chat keeps its ceiling. */
  readonly caller?: CallerAuthority;
  readonly submit: (request: ActionRequest) => Promise<GatewaySubmission>;
}

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
    /* `note`, not `comment` or `freeText`: the aggregate-only boundary refuses those field names. */
    input: input.orderInput ?? { note: words },
    stateVersion: definition.requiresStateVersion ? stateVersion : null,
    idempotencyKey: fingerprint([definition.type, subject, words, stateVersion, proposedAt, JSON.stringify(input.orderInput ?? {note:words}), input.caller ?? CHAT_CALLER]),
    caller: input.caller ?? CHAT_CALLER,
    actorRef,
  };
}

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
