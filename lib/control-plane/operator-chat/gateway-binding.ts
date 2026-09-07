/**
 * **THE OPERATOR CHAT IS JOINED TO THE ACTION GATEWAY HERE, AND NOWHERE ELSE.**
 * (ADM-C7 through §3.5.)
 *
 * §3.5 forbids a second action path for chat, so this module contains no
 * actions. It contains the registry the gateway itself declares and a hole for
 * the caller to put the gateway's door in.
 *
 * ## The registry is the gateway's, verbatim
 *
 * {@link actionDefinitions} is the gateway's own closed list. The chat matches
 * the owner's words against it and can therefore offer exactly what the buttons
 * offer — no more, and never a name of its own. A control added to the registry
 * becomes askable with no edit here; one removed stops being askable at once.
 * Nothing in `lib/control-plane/operator-chat/` knows an action name, and a
 * test asserts it.
 *
 * ## The door is passed in, because the door lives in `app/`
 *
 * `POST /api/admin/action` is the one entry point every control goes through:
 * a plain form with no JavaScript, a client `fetch`, and a chat confirmation all
 * arrive there and all get the same guard, the same current state version, the
 * same idempotency, the same receipt and the same refusal. The chat therefore
 * does not call `submit()` beside that route with its own copy of the
 * dependency wiring — a second caller of one lock is still two ways in, and the
 * two would drift the first time one of them learned something the other did
 * not. It calls the route.
 *
 * Since nothing under `lib/` may import from `app/`, the route hands itself in
 * as {@link ChatActionDoor} and this module composes it with the registry.
 */

import { actionDefinitions } from "../gateway/registry.ts";
import { authorityPermits, type ActionRequest } from "../gateway/contract.ts";
import { CHAT_CALLER } from "./contract.ts";
import type { GatewayBinding, GatewaySubmission } from "./actions.ts";

/**
 * The gateway's one HTTP door, as a function.
 *
 * The route supplies it. Keeping it a parameter is what lets the whole
 * proposal/confirm path be proven against a recording stub, with no server, no
 * store and no clock.
 */
export type ChatActionDoor = (request: ActionRequest) => Promise<GatewaySubmission>;

/**
 * The binding the chat submits through.
 *
 * The registry comes from the gateway whether or not a door was supplied,
 * because what the console CAN do and what it can do RIGHT NOW are different
 * facts and only the second one depends on the caller.
 */
export function operatorChatGateway(door: ChatActionDoor | null): GatewayBinding | null {
  if (door === null) return null;
  return { registry: actionDefinitions(), submit: door };
}

/**
 * The controls the OPERATOR CHAT may ask for, for the page's list.
 *
 * Filtered by the gateway's own authority ladder rather than by a judgement
 * made here. The registry declares controls a chat message may never invoke —
 * an owner decision, and one that is refused outright by law — and listing
 * those as things you can ask for would be an offer the console then refuses,
 * which is worse than not offering them. Reading the registry is free and needs
 * no door.
 */
export function everyControl(): readonly string[] {
  return actionDefinitions()
    .filter((definition) => authorityPermits(CHAT_CALLER, definition.authority))
    .map((definition) => definition.label);
}
