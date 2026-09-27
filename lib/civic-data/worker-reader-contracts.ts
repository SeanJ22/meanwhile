/** Existing publication doors and their executable worker record contracts. */
export const WORKER_READER_CLASSES = {
  "comment-access": "PUBLIC_COMMENT_RULE",
  "everyday-routing": "SERVICE_CONTACT",
  "ballot-navigation": "VOTER_ACCESS_ROUTE",
} as const;
export type WorkerReaderContract = keyof typeof WORKER_READER_CLASSES;
export function isWorkerReaderContract(id: string): id is WorkerReaderContract {
  return Object.hasOwn(WORKER_READER_CLASSES, id);
}
