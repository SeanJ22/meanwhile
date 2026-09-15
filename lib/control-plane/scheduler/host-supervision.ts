import type { HostSupervision } from "./research-policy.ts";

/** Consume the current pilot-task verifier contract; a failed query is not an absent trigger. */
export function readRelaunchTriggerVerification(input: {
  readonly stdout: string;
  readonly status: number | null;
  readonly failedToRun?: boolean;
}): HostSupervision["relaunchTrigger"] {
  const unknown = (reason: string): HostSupervision["relaunchTrigger"] => ({
    present: null,
    detail: `verify-triggers: ${reason} (exit ${input.status ?? "null"}); live supervision remains unverified`,
  });
  if (input.failedToRun || input.status !== 0) return unknown("the verifier did not complete successfully");
  const start = input.stdout.indexOf("{");
  if (start < 0) return unknown("no JSON result was returned");
  let value: unknown;
  try { value = JSON.parse(input.stdout.slice(start)); }
  catch { return unknown("the JSON result was malformed"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) return unknown("the result was not a verification envelope");
  const result = value as Record<string, unknown>;
  // Flat historical task facts did not certify the stable installed launcher
  // and parent identity. They cannot substitute for today's VERIFIED envelope.
  if (result.verdict !== "VERIFIED" || result.stableLauncherVerified !== true || result.processIdentityVerified !== true) {
    return unknown("the installed launcher and parent process were not verified");
  }
  if (!result.facts || typeof result.facts !== "object" || Array.isArray(result.facts)) return unknown("task facts were absent or malformed");
  const facts = result.facts as Record<string, unknown>;
  if (typeof facts.taskPresent !== "boolean" || typeof facts.relaunchTriggerPresent !== "boolean" ||
      typeof facts.state !== "string" || !["Unknown", "Disabled", "Queued", "Ready", "Running"].includes(facts.state)) {
    return unknown("task presence, state or relaunch trigger was absent or malformed");
  }
  if (facts.state === "Unknown") return unknown("the task state was unknown");
  const present = facts.taskPresent && facts.relaunchTriggerPresent && facts.state !== "Disabled";
  return { present, detail: `verify-triggers: taskPresent ${facts.taskPresent}, state ${facts.state}, relaunchTriggerPresent ${facts.relaunchTriggerPresent}; installed launcher and parent process VERIFIED (exit 0)` };
}
