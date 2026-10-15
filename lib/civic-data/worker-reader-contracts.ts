import checklist from "../coverage/checklist-map.json" with { type: "json" };
import { BALLOT_STATES, parseStateBallotContractId, stateBallotContractId, type StateBallotContractId } from "../ballot/state-scopes.ts";

const WORKER_READER_FAMILIES = {
  "voting-sites": "VOTING_SITE",
  "government-budgets": "ADOPTED_BUDGET",
  "public-records": "PUBLIC_RECORD",
  "ballot-contests": "BALLOT_CONTEST",
  "ballot-measures": "BALLOT_MEASURE",
  "everyday-routing": "SERVICE_CONTACT",
  "ballot-navigation": "VOTER_ACCESS_ROUTE",
  "official-filings": "CANDIDATE_FILING_DOCUMENT",
  stances: "STANCE",
} as const;
type WorkerReaderFamily = keyof typeof WORKER_READER_FAMILIES;
export type WorkerReaderContract = Exclude<WorkerReaderFamily, "ballot-contests" | "voting-sites"> |
  StateBallotContractId<"ballot-contests" | "voting-sites">;
export const WORKER_READER_CLASSES = Object.fromEntries(Object.entries(WORKER_READER_FAMILIES).flatMap(([family, recordClass]) =>
  family === "ballot-contests" || family === "voting-sites"
    ? BALLOT_STATES.map(state => [stateBallotContractId(family, state), recordClass])
    : [[family, recordClass]])) as Readonly<Record<WorkerReaderContract, string>>;
export function workerReaderClassMatches(id: WorkerReaderContract, recordClass: string): boolean {
  return recordClass === WORKER_READER_CLASSES[id] || id === "official-filings" && recordClass === "CAMPAIGN_FINANCE_FILING" ||
    parseStateBallotContractId(id)?.family === "ballot-contests" && recordClass === "BALLOT_MEASURE" ||
    id === "government-budgets" && ["BUDGET_RESPONSIBILITY", "BUDGET_AMENDMENT", "PUBLIC_RECORD"].includes(recordClass);
}
export function isWorkerReaderContract(id: string): id is WorkerReaderContract {
  return Object.hasOwn(WORKER_READER_CLASSES, id);
}

export const COMMENT_RULE_PUBLICATION = "comment-access" as const;
export const WORKER_PUBLICATION_TASK_IDS: readonly string[] = ["registry-runtime-bindings", COMMENT_RULE_PUBLICATION, ...Object.keys(WORKER_READER_CLASSES)];

export const CHECKLIST_PUBLICATION_DOORS = checklist.publicationDoors as readonly {
  readonly family: string; readonly fields: readonly string[]; readonly recordClasses: readonly string[];
  readonly contractId: "registry-runtime-bindings" | typeof COMMENT_RULE_PUBLICATION | WorkerReaderFamily;
}[];
export function workerDoorForRecord(recordClass: string, state?: string) {
  const family = recordClass === "BALLOT_MEASURE" ? "ballot-contests"
    : CHECKLIST_PUBLICATION_DOORS.find(row => row.recordClasses.includes(recordClass))?.contractId
      ?? (Object.entries(WORKER_READER_FAMILIES).find(([, value]) => value === recordClass)?.[0] as WorkerReaderFamily | undefined);
  return family === "ballot-contests" || family === "voting-sites"
    ? state ? stateBallotContractId(family, state) : null : family ?? null;
}
export function checklistPublicationDoors(family: string, field?: string) {
  return CHECKLIST_PUBLICATION_DOORS.filter(row => row.family === family && (field === undefined || row.fields.includes(field)));
}
