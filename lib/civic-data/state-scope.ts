import { US_STATES } from "../control-plane/readiness/catalog.ts";

export const ROUTINE_STATES = ["US", ...US_STATES.map(state => `US-${state.code.toUpperCase()}`)] as const;
export function routineScopeState(scope: string, command: readonly string[] = []): string {
  let decoded = scope;
  try { decoded = decodeURIComponent(scope); } catch {}
  const match = /(?:\bUS-|\/(?:state|district|territory):|^(?:curated:)?)([a-z]{2})(?:[:/#]|$)/i.exec(decoded);
  if (match && match[1]!.toUpperCase() !== "US") return `US-${match[1]!.toUpperCase()}`;
  const argument = command.find(arg => /^--state=(?:US-)?[a-z]{2}$/i.test(arg));
  return argument ? `US-${argument.slice(-2).toUpperCase()}` : "US";
}
