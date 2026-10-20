import { findHeldCapture, heldVaultIndex, type HeldVaultArtifact } from "../evidence/read-only-vault.ts";
import type { ControlPlaneRepositories } from "../repository/types.ts";
import { CANDIDATE_PUBLICATION_MAX_READS, runCandidatePublicationCycle, type CandidatePublicationCycleReport, type DueCandidatePublication } from "./campaign-publication-cycle.ts";

/** One candidacy's attributed captures, including earlier campaign reads whose
 * saved redirect aliases name a linked page. The country vault is never listed. */
export async function readCandidatePublicationVault(
  repos: Pick<ControlPlaneRepositories, "workItems" | "artifacts">, root: string, candidacyId: string,
  options: { readonly signal?: AbortSignal; readonly locate?: typeof findHeldCapture } = {},
) {
  const locate = options.locate ?? findHeldCapture;
  const work = new Set<string>();
  for (const subject of [candidacyId, `campaign-site:${candidacyId}`, `candidate-publication:${candidacyId}`]) {
    options.signal?.throwIfAborted();
    for (const row of await repos.workItems.listWhere(["subject"], subject)) work.add(row.id);
  }
  const held: HeldVaultArtifact[] = [];
  for (const id of work) {
    options.signal?.throwIfAborted();
    const rows = (await repos.artifacts.read(id)).filter(record => !record.partial && /html/i.test(record.contentType) && record.tier !== "RESTRICTED_RAW");
    for (let at = 0; at < rows.length; at += 8) {
      options.signal?.throwIfAborted();
      const captures = await Promise.all(rows.slice(at, at + 8).map(record => locate(root, record)));
      for (const capture of captures) if (capture) held.push(capture);
    }
  }
  return heldVaultIndex(held);
}

/** Keep the original oldest-link order and read bound while each candidacy's
 * source HTML and vault metadata can be released before the next is loaded. */
export async function runScopedCandidatePublicationCycle(input: Omit<Parameters<typeof runCandidatePublicationCycle>[0], "heldVault" | "onDue" | "onlyReadUrls"> & {
  readonly readVault?: (candidacyId: string) => ReturnType<typeof readCandidatePublicationVault>;
}): Promise<CandidatePublicationCycleReport> {
  const report = { inventoried: 0, due: 0, acquired: 0, deferred: 0, failed: 0, outcomes: [] as CandidatePublicationCycleReport["outcomes"][number][],
    stoppedLoading: undefined as string | undefined };
  const limit = input.maxReads ?? CANDIDATE_PUBLICATION_MAX_READS;
  const plans: DueCandidatePublication[] = [];
  const selectedReports = new Map<string, CandidatePublicationCycleReport>();
  const numeric = ["inventoried", "due", "acquired", "deferred", "failed"] as const;
  const add = (next: CandidatePublicationCycleReport) => {
    for (const key of numeric) report[key] += next[key];
    report.outcomes.push(...next.outcomes);
    if (next.stoppedLoading) report.stoppedLoading = next.stoppedLoading;
  };
  const run = async (candidacyId: string, options: Pick<Parameters<typeof runCandidatePublicationCycle>[0], "maxReads" | "onDue" | "onlyReadUrls">) => {
    const heldVault = await (input.readVault?.(candidacyId) ?? readCandidatePublicationVault(input.repos, input.vaultRoot, candidacyId));
    return runCandidatePublicationCycle({ ...input, ...options, eligibleCandidacyIds: new Set([candidacyId]), heldVault });
  };
  for (const candidacyId of input.eligibleCandidacyIds) {
    if (input.deadlineMs !== undefined && input.clock() >= input.deadlineMs) { report.stoppedLoading = "the next candidacy's attributed captures"; break; }
    const next = await run(candidacyId, { maxReads: 0, onDue: links => {
      for (const link of links) {
        plans.push(link);
        plans.sort((a, b) => (a.lastAttemptAt ?? -Infinity) - (b.lastAttemptAt ?? -Infinity) ||
          `${a.candidacyId}\u0000${a.url}`.localeCompare(`${b.candidacyId}\u0000${b.url}`));
        plans.length = Math.min(plans.length, limit);
      }
    } });
    add(next);
    for (const id of selectedReports.keys()) if (!plans.some(plan => plan.candidacyId === id)) selectedReports.delete(id);
    if (plans.some(plan => plan.candidacyId === candidacyId)) selectedReports.set(candidacyId, next);
    if (next.stoppedLoading) break;
  }
  if (report.stoppedLoading) return report;
  const selected = new Map<string, Set<string>>();
  for (const plan of plans) {
    const urls = selected.get(plan.candidacyId) ?? new Set(); urls.add(plan.url); selected.set(plan.candidacyId, urls);
  }
  for (const [id, urls] of selected) {
    if (input.deadlineMs !== undefined && input.clock() >= input.deadlineMs) { report.stoppedLoading = "the selected candidacy's due publications"; break; }
    const next = await run(id, { maxReads: urls.size, onlyReadUrls: urls });
    const previous = selectedReports.get(id)!;
    for (const key of numeric) report[key] -= previous[key];
    report.outcomes = report.outcomes.filter(outcome => outcome.candidacyId !== id);
    add(next);
    if (next.stoppedLoading) break;
  }
  return report;
}
