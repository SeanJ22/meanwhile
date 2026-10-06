/**
 * **ONE LIVE-AUDIT CYCLE, CONNECTED.** (DP-13, DP-14, DP-16.)
 *
 * The runtime around `runLiveAuditPass`: it reads the week's results so a fact
 * just checked is not checked again, records every result in the live-audit log
 * (`live-audit-log.ts`), answers each red flag at once (`respondToRedFlag`: the
 * pull, the reopened work, the fix-list item, the lesson and the correction),
 * and marks FIXED the pulled facts that now audit green again.
 *
 * A fact that cannot be traced to the work that published it is never pulled
 * blind; it goes on the fix list with the reason. The curated Reader families
 * are published from manual contracts, not from work items, so until a family
 * gives a trace (`originOf`) its red flags reach the fix list and the lesson
 * store, not an automatic pull.
 */
import { AUDIT_POLICY_SETTING, LIVE_AUDIT_DEFAULT_POLICY, type LiveAuditPolicy } from "../audit-policy.ts";
import { addFixItem } from "../fix-list.ts";
import { ADMIN_CONFIG_ID, isAdminConfig } from "../gateway/admin-config.ts";
import { readSetting } from "../settings.ts";
import { writeFieldManual } from "../field-manual.ts";
import {
  readAuditWeek, recordAuditCorrection, recordLiveAuditPull, recordLiveAuditResult, type LiveAuditRepos,
} from "../live-audit-log.ts";
import { transitionWorkItem } from "../repository/coordinator.ts";
import type { ControlPlaneRepositories } from "../repository/types.ts";
import { readCompletedWorkerResults } from "../repository/worker-completion.ts";
import {
  runLiveAuditPass, type LiveAuditPassDeps, type LiveAuditPassSummary, type LiveAuditResult, type LiveFactCatalog,
} from "./live-audit.ts";
import {
  fixedAfterReaudit, originFromPublications, respondToRedFlag, type FactOrigin, type RedFlagOutcome, type RedFlagWriters,
} from "./live-audit-response.ts";

/** Who the fix list names as having found a red flag. */
export const LIVE_AUDIT_FINDER = "The live audit";

export type LiveAuditCycleRepos = LiveAuditRepos & Pick<ControlPlaneRepositories, "adminConfig" | "fieldManual">;

export interface LiveAuditCycleDeps extends Omit<LiveAuditPassDeps, "lastAuditedAt" | "record"> {
  readonly repos: LiveAuditCycleRepos;
  /** Trace a fact to the work that published it and reopen that work. Absent: red flags go to the fix list unpulled. */
  readonly trace?: {
    readonly originOf: (factId: string) => Promise<FactOrigin | null>;
    readonly reopenWorkItem: (workItemId: string, why: string) => Promise<void>;
  };
}

export interface LiveAuditCycleOutcome {
  readonly summary: LiveAuditPassSummary;
  readonly redFlags: readonly RedFlagOutcome[];
  readonly fixed: number;
  /** Lessons the bank refused to take; the red flag was still answered. */
  readonly lessonErrors: readonly string[];
}

/**
 * The trace for worker-published facts: the work item whose publication admitted the fact's member, read
 * only when a red flag needs it (once per cycle), and the reopen as a recorded REOPENED transition, the way a
 * BROKE audit reopens its work. `hostOf` gives the fact's page host for the lesson.
 */
export function workItemTrace(repos: ControlPlaneRepositories, hostOf: (factId: string) => string | null): NonNullable<LiveAuditCycleDeps["trace"]> {
  let held: Promise<{ items: import("../work-item.ts").WorkItem[]; parsers: readonly import("./types.ts").WorkerResultRecord[] }> | null = null;
  const load = () => (held ??= (async () => {
    const [items, parsers] = await Promise.all([repos.workItems.list(), readCompletedWorkerResults(repos)]);
    return { items: items.map((row) => row.value), parsers };
  })());
  return {
    originOf: async (factId) => {
      const memberId = factId.slice(factId.indexOf(":") + 1);
      const { items, parsers } = await load();
      return originFromPublications({ items, parsers, memberId, host: hostOf(factId) ?? "unknown", platform: null });
    },
    reopenWorkItem: async (workItemId, why) => {
      await transitionWorkItem(repos, { workItemId, to: "REOPENED", by: `live-audit:${workItemId}`, why, now: new Date().toISOString() });
    },
  };
}

/** Several families' catalogs as one: an area is every family's facts filed under it. */
export function combinedCatalog(catalogs: readonly LiveFactCatalog[]): LiveFactCatalog {
  return {
    areas: async () => [...new Set((await Promise.all(catalogs.map((c) => c.areas()))).flat())],
    factsInArea: async (area, limit) => (await Promise.all(catalogs.map((c) => c.factsInArea(area, limit)))).flat().slice(0, limit),
  };
}

/** The owner's audit policy from Admin (`audit.policy`); unset, invalid or unreadable reads the code default. */
export async function auditPolicyFrom(repos: Pick<ControlPlaneRepositories, "adminConfig">): Promise<LiveAuditPolicy> {
  const row = await repos.adminConfig.read(ADMIN_CONFIG_ID).catch(() => null);
  const fallback: LiveAuditPolicy & { readonly [key: string]: number } = { ...LIVE_AUDIT_DEFAULT_POLICY };
  return readSetting(row && isAdminConfig(row.value) ? row.value : null, AUDIT_POLICY_SETTING, fallback);
}

export async function runLiveAuditCycle(deps: LiveAuditCycleDeps): Promise<LiveAuditCycleOutcome> {
  const { repos, now } = deps;
  const policy = deps.policy ?? await auditPolicyFrom(repos);
  const week = await readAuditWeek(repos, now);
  const lastAudited = new Map<string, string>();
  for (const result of week.results) {
    const held = lastAudited.get(result.factId);
    if (!held || result.checkedAt > held) lastAudited.set(result.factId, result.checkedAt);
  }
  const lessonErrors: string[] = [];
  const writers: RedFlagWriters = {
    originOf: deps.trace?.originOf ?? (async () => null),
    pull: async (pull) => recordLiveAuditPull(repos, { workItemId: pull.workItemId, parserResultId: pull.parserResultId,
      parserAttemptId: pull.parserAttemptId, recordIds: pull.recordIds, factId: pull.result.factId, at: now, reason: pull.result.reason }),
    reopenWorkItem: deps.trace?.reopenWorkItem ?? (async () => { throw new Error("A traced fact needs a work-item reopen."); }),
    addFixItem: async (item) => { await addFixItem(repos, { where: item.factId, says: `${item.title}. ${item.detail}`, by: LIVE_AUDIT_FINDER, at: item.at }); },
    writeLesson: async (entry) => {
      const wrote = await writeFieldManual(repos, [entry], now);
      if (wrote.error) lessonErrors.push(`${entry.id}: ${wrote.error}`);
    },
    recordCorrection: (correction) => recordAuditCorrection(repos, correction),
  };
  const fresh: LiveAuditResult[] = [];
  const redFlags: RedFlagOutcome[] = [];
  const summary = await runLiveAuditPass({
    ...deps,
    policy,
    lastAuditedAt: (factId) => lastAudited.get(factId) ?? null,
    record: async (result) => {
      await recordLiveAuditResult(repos, result);
      fresh.push(result);
      if (result.verdict === "RED") redFlags.push(await respondToRedFlag(result, writers, now));
    },
  });
  const pulledNow = redFlags.flatMap((o) => (o.status === "PULLED_AND_REOPENED"
    ? [{ factId: o.factId, action: "PULLED" as const, at: now, summary: "" }] : []));
  const fixed = fixedAfterReaudit([...week.corrections, ...pulledNow], [...week.results, ...fresh]);
  for (const correction of fixed) await recordAuditCorrection(repos, correction);
  return { summary, redFlags, fixed: fixed.length, lessonErrors };
}
