/**
 * **A RED FLAG IS FIXED OR PULLED AT ONCE, AND THE LESSON IS KEPT.** (DP-14.)
 *
 * When the live audit finds a published fact whose value is no longer on its
 * page (`live-audit.ts`), the same pass:
 *
 * 1. **pulls it** through the existing publication path (the next published
 *    version leaves it out, DP-15), so a reader stops being shown it;
 * 2. **reopens** the work item that owns it, so a corrected value is fetched
 *    and published when the page says something else;
 * 3. **adds a fix-list item** (the one list of broken things and their repairs);
 * 4. **writes an audit lesson** that carries the platform, so it applies to every
 *    door of that kind and the next detective starts from it.
 *
 * When the pulled fact later audits green again (the corrected value is up), the
 * correction is marked FIXED. Everything that touches a store is passed in, so
 * this is testable without one; the callers wire the real writers.
 */
import { newFieldManualEntry, type FieldManualEntry } from "../field-manual.ts";
import type { AuditCorrection } from "../admin-view/v6-audit-read.ts";
import type { WorkItem } from "../work-item.ts";
import type { LiveAuditResult } from "./live-audit.ts";
import type { WorkerResultRecord } from "./types.ts";

/** Where a published fact came from: the work that owns it and the extraction that produced it. */
export interface FactOrigin {
  readonly workItemId: string;
  readonly parserResultId: string;
  readonly parserAttemptId: string;
  /** The extraction's record IDs behind this published fact (what a pull names). */
  readonly extractionRecordIds: readonly string[];
  /** The vendor platform of the door, when known; a lesson that carries it applies to every door of that kind. */
  readonly platform: string | null;
  readonly recordClass: string;
  readonly state: string | null;
  readonly host: string;
}

export interface FixItem {
  /** Stable per fact and day, so one red flag is one item however many passes see it. */
  readonly id: string;
  readonly kind: "AUDIT_RED_FLAG";
  readonly title: string;
  readonly detail: string;
  readonly factId: string;
  readonly workItemId: string;
  readonly at: string;
}

export interface RedFlagWriters {
  /** Where the fact came from; null when it cannot be traced (it is then reported, not pulled blindly). */
  readonly originOf: (factId: string) => Promise<FactOrigin | null>;
  /** The pull, written where the publishers read audit pulls. */
  readonly pull: (pull: { workItemId: string; parserResultId: string; parserAttemptId: string; recordIds: readonly string[]; result: LiveAuditResult }) => Promise<void>;
  readonly reopenWorkItem: (workItemId: string, why: string) => Promise<void>;
  readonly addFixItem: (item: FixItem) => Promise<void>;
  readonly writeLesson: (entry: FieldManualEntry) => Promise<void>;
  readonly recordCorrection: (correction: AuditCorrection) => Promise<void>;
}

export type RedFlagOutcome =
  | { readonly status: "PULLED_AND_REOPENED"; readonly factId: string; readonly fixItemId: string; readonly lessonId: string }
  | { readonly status: "NOT_RED"; readonly factId: string }
  | { readonly status: "ORIGIN_UNKNOWN"; readonly factId: string; readonly fixItemId: string };

const AUDIT_LESSON_SOURCE = "live-audit-lesson";

/** The lesson a red flag teaches, keyed by platform and record class so it reaches every door of that kind. */
export function redFlagLesson(result: LiveAuditResult, origin: FactOrigin, observedAt: string): FieldManualEntry {
  const failed = result.checks.filter((c) => !c.ok).map((c) => c.field);
  const where = origin.platform ?? origin.host;
  return newFieldManualEntry(AUDIT_LESSON_SOURCE, `${origin.platform ?? origin.host}|${origin.recordClass}|${failed.join(",")}`, {
    role: "AUDITOR", kind: "AUDIT_LESSON",
    title: `${origin.recordClass} on ${where}: a published value left its page`,
    summary: `live audit found ${failed.join(", ") || "values"} no longer on the page; re-read these fields after publishing`,
    outcome: "FAILED", states: origin.state ? [origin.state.toLowerCase()] : [], recordClasses: [origin.recordClass],
    platforms: origin.platform ? [origin.platform] : [], url: result.reread?.url ?? result.sourceUrl, observedAt: observedAt.slice(0, 10),
    payload: { factId: result.factId, fields: failed, host: origin.host, platform: origin.platform, readUrl: result.reread?.url ?? null, reason: result.reason },
  });
}

/** Respond to one live-audit result. Only a red result does anything. */
export async function respondToRedFlag(result: LiveAuditResult, writers: RedFlagWriters, now: string): Promise<RedFlagOutcome> {
  if (result.verdict !== "RED") return { status: "NOT_RED", factId: result.factId };
  const day = now.slice(0, 10);
  const origin = await writers.originOf(result.factId);
  const failed = result.checks.filter((c) => !c.ok).map((c) => c.field);
  if (!origin) {
    // Never pull blind: say it needs a person-free trace, and keep the flag on the one repair list.
    const item: FixItem = { id: `audit-red:${result.factId}:${day}`, kind: "AUDIT_RED_FLAG", title: `A published fact no longer matches its page`,
      detail: `${result.reason} The fact could not be traced to the work that produced it, so it was not pulled automatically.`,
      factId: result.factId, workItemId: "", at: now };
    await writers.addFixItem(item);
    return { status: "ORIGIN_UNKNOWN", factId: result.factId, fixItemId: item.id };
  }
  // The whole extraction's records behind the fact are named, so nothing stale is left beside the wrong value.
  await writers.pull({ workItemId: origin.workItemId, parserResultId: origin.parserResultId, parserAttemptId: origin.parserAttemptId,
    recordIds: origin.extractionRecordIds, result });
  await writers.reopenWorkItem(origin.workItemId, `Live audit: ${failed.join(", ") || "a value"} no longer on ${result.reread?.url ?? result.sourceUrl}.`);
  const item: FixItem = { id: `audit-red:${result.factId}:${day}`, kind: "AUDIT_RED_FLAG",
    title: `A published ${origin.recordClass} fact no longer matches its page`,
    detail: `${result.reason} It was taken off the live page and the work was reopened.`,
    factId: result.factId, workItemId: origin.workItemId, at: now };
  await writers.addFixItem(item);
  const lesson = redFlagLesson(result, origin, now);
  await writers.writeLesson(lesson);
  await writers.recordCorrection({ factId: result.factId, action: "PULLED", at: now,
    summary: `Taken off the page: ${failed.join(", ") || "a value"} no longer matched the source.` });
  return { status: "PULLED_AND_REOPENED", factId: result.factId, fixItemId: item.id, lessonId: lesson.id };
}

/**
 * A pulled fact that audits green again after its pull was fixed: the corrected value is up and right.
 * Returns the FIXED correction rows to record (once each).
 */
export function fixedAfterReaudit(corrections: readonly AuditCorrection[], results: readonly LiveAuditResult[]): AuditCorrection[] {
  const alreadyFixed = new Set(corrections.filter((c) => c.action === "FIXED").map((c) => c.factId));
  const out: AuditCorrection[] = [];
  for (const pulled of corrections.filter((c) => c.action === "PULLED" && !alreadyFixed.has(c.factId))) {
    const back = results.filter((r) => r.factId === pulled.factId && r.verdict === "GREEN" && r.checkedAt > pulled.at)
      .sort((a, b) => a.checkedAt.localeCompare(b.checkedAt))[0];
    if (back) out.push({ factId: pulled.factId, action: "FIXED", at: back.checkedAt, summary: "The corrected value is back on the page and checks out." });
  }
  return out;
}

/**
 * Trace a published reader member back to the work item and extraction that published it, from the
 * publication outcomes the work items already carry (`recordChanges` ties each reader ID to its
 * extraction record). Null when no work item admitted that member.
 */
export function originFromPublications(input: {
  readonly items: readonly WorkItem[];
  readonly parsers: readonly WorkerResultRecord[];
  /** The published reader member ID (the part of the fact ID after the family). */
  readonly memberId: string;
  readonly host: string;
  readonly platform: string | null;
}): FactOrigin | null {
  for (const item of input.items) {
    const outcome = item.publicationOutcome;
    const changes = outcome?.recordChanges?.filter((c) => c.readerId === input.memberId) ?? [];
    if (!outcome || outcome.status === "HELD" || changes.length === 0) continue;
    const parser = input.parsers.find((r) => r.id === outcome.workerResultId && r.result.role === "PARSER");
    if (!parser || parser.result.role !== "PARSER") continue;
    const plan = item.autonomousPlan;
    return { workItemId: item.id, parserResultId: parser.id, parserAttemptId: parser.result.attemptId,
      extractionRecordIds: changes.map((c) => c.recordId), platform: input.platform,
      recordClass: plan?.contract.recordClass ?? "UNKNOWN",
      state: plan?.contract.schemaVersion === 2 ? plan.contract.jurisdiction.state : null, host: input.host };
  }
  return null;
}
