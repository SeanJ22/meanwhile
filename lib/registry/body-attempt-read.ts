import type { AttemptFamily } from "./attempt-families.ts";

export interface PublicBodyAttempt {
  readonly bodyId:string; readonly at:string;
  /** The kind of fact the attempt was for; null on a snapshot published before families were kept. */
  readonly family:AttemptFamily|null;
  readonly status:"PUBLISHED"|"PARTIALLY_PUBLISHED"|"HELD";
  readonly code:string; readonly sourceUrl:string|null;
  readonly acceptedCount:number|null; readonly versionId:string|null;
}
