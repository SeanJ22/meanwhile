import { actionDefinitions } from "../gateway/registry.ts";
import { authorityPermits, type ActionRequest } from "../gateway/contract.ts";
import { CHAT_CALLER } from "./contract.ts";
import type { GatewayBinding, GatewaySubmission } from "./actions.ts";

export type ChatActionDoor = (request: ActionRequest) => Promise<GatewaySubmission>;

export function operatorChatGateway(door: ChatActionDoor | null): GatewayBinding | null {
  if (door === null) return null;
  return { registry: actionDefinitions(), submit: door };
}

/** Filtered by the gateway's own authority ladder. */
export function everyControl(): readonly string[] {
  return actionDefinitions()
    .filter((definition) => authorityPermits(CHAT_CALLER, definition.authority))
    .map((definition) => definition.label);
}
