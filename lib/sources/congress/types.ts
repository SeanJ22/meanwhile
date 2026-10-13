import type { FederalSourceId } from "./targets.ts";

export interface FederalCapture {
  source: FederalSourceId;
  kind: "members" | "sponsored" | "bill" | "committees" | "text-versions" | "govinfo-summary" | "bill-text" | "rules" | "contributions";
  url: string;
  body: string;
  retrievedAt: string;
  context?: { bioguideId?: string; billId?: string; packageId?: string; publishedAt?: string };
}
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
  /** A registered organization's filed name; individual donors are never projected. */
  organization?: string | null;
  reason?: string;
}
export interface FederalCounts {
  loaded: number;
  joined: number;
  unjoined: number;
  joinReadFailures?: number;
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
