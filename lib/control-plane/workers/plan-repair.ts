/** The repair marks older work items carry, read by the work history and Admin's fix history. */
export interface PlanRepairLink {
  readonly parentWorkItemId: string; readonly rootWorkItemId: string; readonly depth: number;
  readonly proposalHash: string; readonly scoutAttemptId: string; readonly sourceArtifactId: string;
  readonly retainedEvidenceIds: readonly string[]; readonly admittedAt: string;
  readonly authority: "WORK_INSTRUCTIONS_ONLY"; readonly unresolved: readonly string[];
}
export interface RepairObservation { readonly parentWorkItemId: string; readonly scoutAttemptId: string; readonly code: string; readonly successorWorkItemId: string | null; readonly detail: string; }
