import type { HostSupervision } from "./research-policy.ts";
import { publisherSizeForState } from "../../sources/publisher-size.ts";

/** Held facts about the website being requested, never the hunt's jurisdiction. */
export interface WebsiteSize {
  readonly kind: "local-government" | "school-district" | "state" | "federal" | "national";
  readonly population?: number | null;
  readonly students?: number | null;
}

export type WebsiteSizeForUrl = (url: string) => WebsiteSize | null | undefined;

/** Resolve the requested publisher across the job's states; shared hosts stay unknown. */
export function websiteSizeFromHoldings(states: readonly string[], root = process.cwd()): WebsiteSizeForUrl {
  const readers = [...new Set(states.map(state => state.toLowerCase()))].map(state => publisherSizeForState(state, root));
  return url => {
    let found: WebsiteSize | null = null;
    for (const read of readers) {
      const size = read(url);
      if (!size) continue;
      if (found) return null;
      found = size;
    }
    return found;
  };
}

/** Sean, October 1: only known small local publishers have a ten-request cap. */
export function websiteRequestLimit(size?: WebsiteSize | null): 10 | null {
  const count = size?.kind === "local-government" ? size.population
    : size?.kind === "school-district" ? size.students : null;
  if (typeof count !== "number" || !Number.isFinite(count) || count < 0) return null;
  return count < (size?.kind === "school-district" ? 5_000 : 10_000) ? 10 : null;
}

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
