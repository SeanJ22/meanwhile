import type { BoxFinding } from "../control-plane/box.ts";
import type { WorkRow } from "../core/work.ts";
import { CAMPAIGN_SITE_LEAD, CANDIDATE_PROFILE_LEAD, COMMENT_SUMMARY_LEAD } from "../facts/finding-slots.ts";

/**
 * Findings a hunter made that one reader takes whole, each as a `fact` row on the work list named by its reader: a long page about taking
 * part for the comment-rules writer, a campaign site for the campaign-site chain, a candidate's bio, contact or portrait for the
 * candidate-profile writer. The row's value is `{ platform: <reader>, finding }`; the reader claims by its name.
 */
export const HANDOFFS = [["comment-summary", COMMENT_SUMMARY_LEAD], ["campaign-site", CAMPAIGN_SITE_LEAD], ["candidate-profile", CANDIDATE_PROFILE_LEAD]] as const;
export type Handoff = (typeof HANDOFFS)[number][0];

/** The hunter's finding a handed-off row carries. */
export const findingOf = (row: WorkRow): BoxFinding => (row.value as { finding: BoxFinding }).finding;
