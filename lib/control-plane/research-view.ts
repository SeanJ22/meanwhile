import { unreachable, type ReadOutcome } from "./admin-data.ts";
import { assertAggregateOnly } from "./owner-surface.ts";
import type { ControlPlaneRepositories } from "./repository/types.ts";
import { INTENT_NOTE_MAX_CHARS, RESEARCH_FORMAT_VERSION, RESEARCH_INTENT_LOG_KEY, type ResearchIntent, type ResearchIntentAction } from "./scheduler/research-policy.ts";

export async function readResearchIntents(
  repos: ControlPlaneRepositories,
): Promise<ReadOutcome<readonly ResearchIntent[]>> {
  try {
    return { kind: "HELD", value: await repos.researchIntents.read(RESEARCH_INTENT_LOG_KEY) };
  } catch (error) {
    return unreachable("the research intent log", error);
  }
}

export type ResearchIntentRecord = Extract<ResearchIntent, { readonly kind: "INTENT" }>;

export function buildResearchIntent(
  action: ResearchIntentAction,
  requestedAt: string,
  adminSessionRef: string,
  note: string | null = null,
  actor = "owner (admin session)",
  budgetUsd: number | null = null,
): ResearchIntentRecord {
  return {
    formatVersion: RESEARCH_FORMAT_VERSION,
    kind: "INTENT",
    intentId: `${action}:${requestedAt}`,
    action,
    requestedAt,
    actor,
    adminSessionRef,
    note,
    ...(action === "DISPATCH" && budgetUsd !== null ? { budgetUsd } : {}),
  };
}

export function validateIntentNote(
  action: ResearchIntentAction,
  raw: unknown,
): { readonly ok: true; readonly note: string | null } | { readonly ok: false; readonly detail: string } {
  const text = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
  if (text.length > INTENT_NOTE_MAX_CHARS) {
    return { ok: false, detail: `the note is longer than ${INTENT_NOTE_MAX_CHARS} characters` };
  }
  if (action === "DISPATCH" && text.length === 0) {
    return { ok: false, detail: "a DISPATCH needs a target — say what the fleet should go do" };
  }
  if (action === "CANCEL_DISPATCH") {
    return /^DISPATCH:\d{4}-\d{2}-\d{2}T[0-9:.]+Z$/.test(text)
      ? { ok: true, note: text }
      : { ok: false, detail: "say which sent instruction to take back (its DISPATCH id)" };
  }
  if (action !== "DISPATCH" && action !== "PAUSE_RUNNER" && action !== "RESUME_RUNNER") {
    return { ok: true, note: null };
  }
  return { ok: true, note: text.length === 0 ? null : text };
}

export async function appendResearchIntent(
  repos: ControlPlaneRepositories,
  intent: ResearchIntentRecord,
  nowIso: string,
): Promise<
  { readonly ok: true; readonly appended: boolean } | { readonly ok: false; readonly detail: string }
> {
  try {
    assertAggregateOnly(intent, "appendResearchIntent");
    const outcome = await repos.researchIntents.append(
      RESEARCH_INTENT_LOG_KEY,
      intent.intentId,
      intent,
      nowIso,
    );
    return { ok: true, appended: outcome.appended };
  } catch (error) {
    return { ok: false, detail: (error as Error)?.message ?? "the append failed" };
  }
}

