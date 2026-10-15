import type { RawCaptureRef } from "../../civic-data/raw-capture-vault.ts";
import type { FederalSourceId } from "./targets.ts";

export interface FederalCapture {
  source: FederalSourceId;
  kind: "members" | "sponsored" | "bill" | "committees" | "text-versions" | "govinfo-summary" | "bill-text" | "rules" | "contributions";
  url: string;
  body: string;
  retrievedAt: string;
  context?: { bioguideId?: string; billId?: string; packageId?: string; publishedAt?: string;
    /** Immutable held roster evidence, referenced rather than copied into every filing. */
    honoreeRosterVersionId?: string; honoreeRosterFailure?: string };
}
/** A capture as a candidate holds it: its bytes stay in the raw-capture vault. */
export type HeldFederalCapture = Omit<FederalCapture, "body"> & { raw: RawCaptureRef };
export interface LdaRosterMember {
  bioguideId: string;
  names: string[];
  chamber: "senate" | "house";
  state: string;
  sourceUrl: string;
  sourceOrg: string;
  checkedAt: string;
}
export interface LdaRoster { versionId: string; members: LdaRosterMember[] }
export type LdaHonoreeJoin =
  | { status: "JOINED"; rosterVersionId: string; matchedName: string; nameForm: string; rules: string[];
      chamber: "senate" | "house"; state: string; sourceUrl: string; sourceOrg: string; checkedAt: string }
  | { status: "UNJOINED"; reason: "NO_HONOREE" | "NO_CONTRIBUTIONS" | "ROSTER_UNAVAILABLE" | "NO_MATCH" | "AMBIGUOUS_MATCH"; detail: string };
export interface FederalFact {
  id: string;
  kind: "MEMBER" | "BILL" | "COMMITTEE_REFERRAL" | "BILL_TEXT" | "BILL_TEXT_LINK" | "RULE" | "LOBBYING_CONTRIBUTION" | "UNPARSED";
  source: FederalSourceId;
  nativeId: string;
  title: string;
  sourceUrl: string;
  publisher: string;
  official: true;
  publishedAt: string | null;
  checkedAt: string;
  bioguideId?: string;
  billId?: string;
  committeeId?: string;
  state?: string;
  text?: string;
  action?: string;
  actionDate?: string | null;
  updatedAt?: string | null;
  documentNumber?: string;
  docketId?: string;
  opensAt?: string | null;
  closesAt?: string | null;
  commentUrl?: string | null;
  withdrawn?: boolean;
  acceptsComments?: boolean;
  filingId?: string;
  amount?: string;
  contributionDate?: string;
  recipientId?: string;
  recipientName?: string;
  honoreeName?: string;
  honoreeJoin?: LdaHonoreeJoin;
  /** A registered organization's filed name; individual donors are never projected. */
  organization?: string | null;
  reason?: string;
}
export interface FederalCounts {
  loaded: number;
  joined: number;
  unjoined: number;
  joinReadFailures?: number;
  unjoinedReasons?: Record<string, number>;
  byState: Record<string, { loaded: number; joined: number; unjoined: number }>;
}
export interface FederalProjection {
  formatVersion: 1;
  source: FederalSourceId;
  records: FederalFact[];
  /** A provider cursor advances only after every preceding page was saved and published. */
  cursor?: string;
  counts?: FederalCounts;
}
