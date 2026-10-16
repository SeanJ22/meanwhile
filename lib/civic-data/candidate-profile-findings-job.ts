import { requireBallotState, stateBallotContractId, stateBallotScope } from "../ballot/state-scopes.ts";
import type { GenericBallotProjection } from "../ballot/generic-projection.ts";
import { canonicalCandidacyId, canonicalContestId } from "../hunt/candidate-universe.ts";
import { ADMIN_CONFIG_ID } from "../control-plane/gateway/admin-config.ts";
import type { ControlPlaneRepositories } from "../control-plane/repository/types.ts";
import { factClocks } from "../facts/clocks.ts";
import { CANDIDATE_PROFILE_LEAD } from "../facts/finding-slots.ts";
import type { BoxFinding } from "../control-plane/box.ts";
import type { PortraitRuntime } from "../photos/store.ts";
import type { HeldVaultArtifact } from "../control-plane/evidence/read-only-vault.ts";
import { readPromotedCivicData } from "./read-model.ts";
import { PostgresRoutineDataStore, type RoutineDataStore } from "./store.ts";
import { assertRegisteredRuntimeContract } from "./runtime-authority.ts";
import { readCandidateProfileFindingBatch } from "./campaign-publication-due.ts";
import { routineReceiptFields, type RoutineRunnerReceipt } from "./runner-receipt.ts";
import { ZERO_RELEASE_EVENTS } from "./release.ts";
import { publishCandidateFindings, type CandidateFindingSubject } from "./candidate-profile-findings.ts";

export async function runCandidateProfileFindingsJob(input: {
  readonly state: string;
  readonly store: RoutineDataStore;
  readonly repos: Pick<ControlPlaneRepositories, "boxFindings" | "adminConfig">;
  readonly query: (sql: string, params: unknown[]) => Promise<unknown>;
  readonly readHeld: (ids: readonly string[]) => Promise<(id: string) => Promise<HeldVaultArtifact | null>>;
  readonly now: string;
  readonly portrait?: PortraitRuntime;
}): Promise<{ readonly report: Awaited<ReturnType<typeof publishCandidateFindings>>; readonly receipt: RoutineRunnerReceipt | null }> {
  const state = requireBallotState(input.state), contractId = stateBallotContractId("candidate-profiles", state);
  if (input.store instanceof PostgresRoutineDataStore) assertRegisteredRuntimeContract(contractId, "manual");
  const batch = await readCandidateProfileFindingBatch(state, input.query);
  if (!batch.length) return { report: { published: {}, refused: {}, waiting: 0 }, receipt: null };
  const wanted = new Set(batch.map(row => row.subject));
  const subjects = await findingSubjects();
  const rows = await input.query("SELECT value FROM cp_box_findings WHERE id=ANY($1::text[]) AND value->>'state'='waiting' AND value#>>'{waitingFor,reason}'=$2 ORDER BY id",
    [batch.map(row => row.id), CANDIDATE_PROFILE_LEAD]) as { value: BoxFinding | string }[];
  const findings = rows.map(row => typeof row.value === "string" ? JSON.parse(row.value) as BoxFinding : row.value);
  const held = await input.readHeld(findings.flatMap(row => row.origins.flatMap(origin => origin.artifactIds)));
  const approved = await input.query(`SELECT record#>>'{campaignSite,candidacyId}' candidacy_id,record#>>'{campaignSite,host}' host
    FROM cp_log_promotion_pipeline WHERE record->>'stage'='APPROVED_FOR_PROMOTION'
    AND upper(record#>>'{campaignSite,identity,stateCode}')=$1 AND record#>>'{campaignSite,candidacyId}'=ANY($2::text[])`,
    [state, subjects.map(subject => subject.candidacyId)]) as { candidacy_id: string; host: string }[];
  const campaignHosts = new Map<string, string[]>();
  for (const row of approved) campaignHosts.set(row.candidacy_id, [...campaignHosts.get(row.candidacy_id) ?? [], row.host]);
  let receipt: RoutineRunnerReceipt | null = null;
  const report = await publishCandidateFindings({ boxFindings: input.repos.boxFindings, held, store: input.store, subjects, findings,
    campaignHosts, clocks: factClocks((await input.repos.adminConfig.read(ADMIN_CONFIG_ID))?.value ?? null), now: input.now, portrait: input.portrait,
    onPublished: (candidate, outcome) => { receipt = { source: contractId, ...routineReceiptFields(candidate, outcome), structuralReleaseContract: ZERO_RELEASE_EVENTS }; } });
  return { report, receipt };

  async function findingSubjects(): Promise<CandidateFindingSubject[]> {
    const read = await readPromotedCivicData<GenericBallotProjection>("BALLOT_CANDIDACY", stateBallotScope("ballot-contests", state), { store: input.store, now: input.now, bypassCache: true });
    if (read.kind !== "PROMOTED") throw new Error(`CANDIDATE_FINDINGS_BALLOT_UNAVAILABLE:${state}:${read.kind}`);
    const found = new Map<string, CandidateFindingSubject>();
    for (const ballot of Object.values(read.value.ballots)) {
      const cycle = Number(ballot.election.date.slice(0, 4));
      const contests = new Map([...ballot.contests, ...ballot.heldContests ?? []].map(contest => [contest.id, contest]));
      const selected = new Set<string>();
      for (const candidacies of [ballot.candidacies, ballot.filingCandidacies ?? []]) for (const row of candidacies) {
        const contest = contests.get(row.contestId);
        if (!contest) continue;
        const id = canonicalCandidacyId(canonicalContestId(state, cycle, contest), row.familyName, row.givenName);
        if (wanted.has(id) || wanted.has(row.id)) selected.add(id);
      }
      for (const candidacies of [ballot.candidacies, ballot.filingCandidacies ?? []]) for (const row of candidacies) {
        const contest = contests.get(row.contestId);
        if (!contest) continue;
        const id = canonicalCandidacyId(canonicalContestId(state, cycle, contest), row.familyName, row.givenName);
        if (!selected.has(id)) continue;
        const prior = found.get(id);
        found.set(id, { candidacyId: id, givenName: row.givenName, familyName: row.familyName, officeTitle: contest.title,
          ocdId: contest.ocdId, stateCode: state, cycle, readerKeys: [...new Set([...prior?.readerKeys ?? [], row.id])] });
      }
    }
    return [...found.values()];
  }
}
