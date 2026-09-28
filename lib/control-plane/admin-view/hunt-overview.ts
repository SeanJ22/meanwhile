import type { AssignmentView } from "../assignment-view.ts";
import type { ExpansionScopeDecision } from "../expansion/scopes.ts";
import type { BillingAttribution } from "../provider-billing-attribution.ts";
import { latestServedWitnesses, SERVED_READER_MAX_AGE_MS, type ServedReaderReadback } from "../served-reader.ts";
import { displayNameOf } from "../display-name.ts";
import { PUBLIC_SITE_ORIGIN } from "../../ops/origins.ts";
import { exactInstructionMembership } from "./instruction-membership.ts";
import { rankedWorkBlockers } from "./work-view.ts";

/** Exact saved-instruction projection. A publication is not a public result;
 * a successful older check cannot override a newer failed check of that key. */
export function huntOverview(input: {
  decision: ExpansionScopeDecision; assignments: AssignmentView | null;
  billing: BillingAttribution | null; reader: ServedReaderReadback | null; now: string;
}) {
  const { decision } = input;
  const membership = exactInstructionMembership(input.assignments, decision.key, decision.receiptId);
  const counts = membership.counts;
  const index = membership.index;
  const reconciled = counts !== null && index !== null && Object.entries(counts)
    .every(([state, count]) => index.filter(row => row.state === state).length === count);
  const newest = latestServedWitnesses(input.reader);
  const readAge = Date.parse(input.now) - Date.parse(input.reader?.checkedAt ?? "");
  const deliveryReadComplete = input.reader !== null && input.reader.errors.length === 0 &&
    Number.isFinite(readAge) && readAge >= 0 && readAge <= SERVED_READER_MAX_AGE_MS && membership.bodyAttempts !== null;
  const delivered = new Map<string, { readerKey: string; versionId: string; url: string; checkedAt: string; workItemId: string;
    label: string; change: "NEW" | "UPDATED" | "REUSED" | "NOT_RECORDED" }>();
  for (const publication of membership.bodyAttempts ?? []) {
    if (publication.status === "HELD" || !publication.versionId) continue;
    for (const witness of newest) {
      if (witness.itemId !== publication.workItemId || witness.approvalId !== publication.workerResultId ||
          witness.versionId !== publication.versionId || witness.state !== "CONFIRMED" ||
          !/^[a-f0-9]{64}$/.test(witness.responseSha256 ?? "")) continue;
      const age = Date.parse(input.now) - Date.parse(witness.checkedAt);
      if (!Number.isFinite(age) || age < 0 || age > SERVED_READER_MAX_AGE_MS) continue;
      let url: URL;
      try { url = new URL(witness.url); } catch { continue; }
      // Recorded public links only. An Admin URL or credential-bearing query
      // cannot become a reader link through an otherwise valid receipt.
      if (url.origin !== PUBLIC_SITE_ORIGIN || url.username || url.password ||
          /^\/(?:api\/)?admin(?:\/|$)/.test(url.pathname) ||
          [...url.searchParams.keys()].some(key => /token|secret|password|credential|api.?key|auth/i.test(key))) continue;
      const key = JSON.stringify([witness.versionId, witness.readerKey]);
      const old = delivered.get(key);
      if (old && Date.parse(old.checkedAt) >= Date.parse(witness.checkedAt)) continue;
      delivered.set(key, { readerKey: witness.readerKey, versionId: witness.versionId, url: url.href, checkedAt: witness.checkedAt,
        workItemId: publication.workItemId,
        label: index?.find(row => row.id === publication.workItemId)?.subjectName ||
          index?.find(row => row.id === publication.workItemId)?.label || displayNameOf(publication.bodyId).short,
        change: publication.recordChanges?.find(change => change.readerId === witness.readerKey)?.change ?? "NOT_RECORDED" });
    }
  }
  const money = input.billing?.hunts?.find(row => row.key === decision.key && row.receiptId === decision.receiptId &&
    row.startedAt === decision.budgetStartedAt) ?? null;
  const priorities = rankedWorkBlockers(index ?? [], input.now);
  return { decision, counts: reconciled ? counts : null, totalsReconciled: reconciled,
    knownWork: reconciled ? index.length : null,
    unfinished: reconciled ? index.filter(row => !["SUCCEEDED", "RETIRED"].includes(row.state)).length : null,
    money, moneyAt: money ? input.billing!.readAt : null,
    readerReadAt: input.reader?.checkedAt ?? null,
    deliveryReadComplete,
    delivered: [...delivered.values()].sort((a, b) => b.checkedAt.localeCompare(a.checkedAt)),
    priorities, ownerDecisions: priorities.filter(row => row.category === "NEEDS_OWNER_DECISION"),
  };
}
