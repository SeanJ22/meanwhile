import checklist from "../coverage/checklist-map.json" with { type: "json" };
/** Existing publication doors and their executable worker record contracts. */
export const WORKER_READER_CLASSES = {
  "ballot-contests": "BALLOT_CONTEST",
  "comment-access": "PUBLIC_COMMENT_RULE",
  "everyday-routing": "SERVICE_CONTACT",
  "ballot-navigation": "VOTER_ACCESS_ROUTE",
  "official-filings": "CANDIDATE_FILING_DOCUMENT",
} as const;
export type WorkerReaderContract = keyof typeof WORKER_READER_CLASSES;
export function workerReaderClassMatches(id: WorkerReaderContract, recordClass: string): boolean {
  return recordClass === WORKER_READER_CLASSES[id] || id === "official-filings" && recordClass === "CAMPAIGN_FINANCE_FILING";
}
export function isWorkerReaderContract(id: string): id is WorkerReaderContract {
  return Object.hasOwn(WORKER_READER_CLASSES, id);
}

/** The publication passes the runner can be asked for by id (`--only=`): the registry door and each reader door. */
export const WORKER_PUBLICATION_TASK_IDS: readonly string[] = ["registry-runtime-bindings", ...Object.keys(WORKER_READER_CLASSES)];

/** Data, shared by work creation, Box builders and the Admin checklist. */
export const CHECKLIST_PUBLICATION_DOORS = checklist.publicationDoors as readonly {
  readonly family: string; readonly fields: readonly string[]; readonly recordClasses: readonly string[];
  readonly contractId: "registry-runtime-bindings" | WorkerReaderContract;
}[];
export function workerDoorForRecord(recordClass: string) {
  return CHECKLIST_PUBLICATION_DOORS.find(row => row.recordClasses.includes(recordClass))?.contractId ?? null;
}
export function checklistPublicationDoors(family: string, field?: string) {
  return CHECKLIST_PUBLICATION_DOORS.filter(row => row.family === family && (field === undefined || row.fields.includes(field)));
}
