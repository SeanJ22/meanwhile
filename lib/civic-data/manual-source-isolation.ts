import { canonicalCivicDataJson } from "./changes.ts";
import type { ManualSourceReview, ManualSourceSetReceipt } from "./types.ts";
import { manualSourceUrls as sourceUrls, mergeManualSourceCopies } from "./manual-source-urls.ts";

const NON_POSITIVE_URL_CONTAINER = /^(?:superseded|failed|blocked|retired).*urls?$|^failures$/i;
export const NO_SUPPORTED_CURRENT_MEMBER = "The current review supplied no valid member-scoped fact; retained LKG alone cannot turn a failed package into a successful refresh.";

export interface SourceScopedMember<T = unknown> {
  readonly key: string;
  readonly record: T;
}

export interface SourceScopedPrior<T = unknown> {
  readonly members: readonly SourceScopedMember<T>[];
  readonly sourceReceipt: ManualSourceSetReceipt;
}

export interface SourceScopedHeldFact {
  readonly key: string;
  readonly code: string;
  readonly detail: string;
  readonly record?: unknown;
}

export interface SourceScopedReconciliation<T = unknown> {
  readonly members: readonly SourceScopedMember<T>[];
  readonly promotionReceipt: ManualSourceSetReceipt;
  readonly excludedFacts: readonly SourceScopedHeldFact[];
  readonly supportedCurrentSources: number;
  readonly inputMembers: number;
  readonly rejectedCurrentMembers: number;
  readonly acceptedCurrentMembers: number;
}

function sourceOutcome(source: ManualSourceReview): "SUPPORTED" | "BLOCKED" {
  return source.reviewOutcome ?? "SUPPORTED";
}

/** Negative attempts and retired URLs are history, not source support claims. */
export function directPositiveSourceUrls(value: unknown, found: Set<string> = new Set()): Set<string> {
  if (typeof value === "string") {
    if (/^https:\/\/[^\s]+$/.test(value)) found.add(value);
    return found;
  }
  if (Array.isArray(value)) {
    for (const child of value) directPositiveSourceUrls(child, found);
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (NON_POSITIVE_URL_CONTAINER.test(key)) continue;
      directPositiveSourceUrls(child, found);
    }
  }
  return found;
}

export function manualRecordSourceUrls(record: unknown): readonly string[] {
  const row = record as { readonly kind?: string; readonly value?: { readonly url?: string; readonly sourceUrl?: string } } | null;
  if (row?.kind === "ELECTION_FIELD") return row.value?.url ? [row.value.url] : [];
  if ((row?.kind === "REGISTRATION_LINK" || row?.kind === "POLLING_PLACE_LINK") && row.value?.sourceUrl) return [row.value.sourceUrl];
  return [...directPositiveSourceUrls(record)];
}

function sourceIdentity(source: ManualSourceReview): string {
  return `${source.finalUrl}\n${source.rawHash}`;
}

interface ManualSourceReceiptIndex {
  readonly supported: readonly ManualSourceReview[];
  readonly blocked: readonly ManualSourceReview[];
  readonly supportedByUrl: ReadonlyMap<string, readonly ManualSourceReview[]>;
  readonly blockedByUrl: ReadonlyMap<string, readonly ManualSourceReview[]>;
}

function indexSources(receipt: ManualSourceSetReceipt): ManualSourceReceiptIndex {
  const supported = receipt.sources.filter((source) => sourceOutcome(source) === "SUPPORTED");
  const blocked = receipt.sources.filter((source) => sourceOutcome(source) === "BLOCKED");
  const byUrl = (sources: readonly ManualSourceReview[]) => {
    const index = new Map<string, ManualSourceReview[]>();
    for (const source of sources) {
      for (const url of sourceUrls(source)) {
        const rows = index.get(url) ?? [];
        rows.push(source);
        index.set(url, rows);
      }
    }
    return index;
  };
  return {
    supported,
    blocked,
    supportedByUrl: byUrl(supported),
    blockedByUrl: byUrl(blocked),
  };
}

function sourcesSupportingMembers<T>(
  members: readonly SourceScopedMember<T>[],
  receipt: ManualSourceSetReceipt,
  urlsForMember: (member: SourceScopedMember<T>) => readonly string[],
): readonly ManualSourceReview[] {
  const cited = new Set(members.flatMap((member) => urlsForMember(member)));
  // Some reviewed records (for example a phone-only candidate card) carry no
  // URL field of their own. Their prior GOOD source set remains the only exact
  // evidence boundary and must travel with the retained member.
  if (members.some((member) => urlsForMember(member).length === 0)) {
    return receipt.sources.filter((source) => sourceOutcome(source) === "SUPPORTED");
  }
  return receipt.sources.filter((source) =>
    sourceOutcome(source) === "SUPPORTED" && sourceUrls(source).some((url) => cited.has(url))
  );
}

function sourceDisposition<T>(
  member: SourceScopedMember<T>,
  receipt: ManualSourceSetReceipt,
  index: ManualSourceReceiptIndex,
  urlsForMember: (member: SourceScopedMember<T>) => readonly string[],
): { readonly ok: true } | { readonly ok: false; readonly code: string; readonly detail: string } {
  const urls = [...urlsForMember(member)].sort();
  if (urls.length === 0) {
    if (index.supported.length === 1 && index.blocked.length === 0) return { ok: true };
    return {
      ok: false,
      code: "MANUAL_MEMBER_SOURCE_AMBIGUOUS",
      detail: `${member.key} carries no exact source URL and cannot be assigned safely across ${receipt.sources.length} reviewed source attempts.`,
    };
  }
  for (const url of urls) {
    const matchingSupported = index.supportedByUrl.get(url) ?? [];
    const matchingBlocked = index.blockedByUrl.get(url) ?? [];
    if (matchingBlocked.length > 0) {
      return {
        ok: false,
        code: "MANUAL_MEMBER_SOURCE_BLOCKED",
        detail: `${member.key} depends on blocked source ${url}: ${matchingBlocked.map((source) => source.failureDetail).filter(Boolean).join("; ")}.`,
      };
    }
    if (matchingSupported.length === 0) {
      return {
        ok: false,
        code: "MANUAL_MEMBER_SOURCE_NOT_RECEIPTED",
        detail: `${member.key} cites ${url} without a current supported exact-byte review.`,
      };
    }
  }
  return { ok: true };
}

/**
 * Merge independently keyed manual facts without inventing absence.
 *
 * A current member may replace its own prior member only when every source it
 * cites is supported by the current review and its member-local shape passes.
 * Any blocked/malformed member is held alone. Every omitted prior member is
 * retained because open manual packages currently have no non-meeting,
 * validator-recognized positive-removal evidence contract.
 */
export function reconcileSourceScopedMembers<T>(input: {
  readonly current: readonly SourceScopedMember<T>[];
  readonly currentReceipt: ManualSourceSetReceipt;
  readonly prior?: SourceScopedPrior<T> | null;
  readonly memberIssue?: (member: SourceScopedMember<T>) => string | null;
  readonly sourceUrls?: (member: SourceScopedMember<T>) => readonly string[];
}): SourceScopedReconciliation<T> {
  const urlsForMember = input.sourceUrls ?? ((member: SourceScopedMember<T>) =>
    [...directPositiveSourceUrls(member.record)]);
  const currentGroups = new Map<string, SourceScopedMember<T>[]>();
  const currentSourceIndex = indexSources(input.currentReceipt);
  for (const member of input.current) {
    const group = currentGroups.get(member.key) ?? [];
    group.push(member);
    currentGroups.set(member.key, group);
  }
  const selected = new Map<string, SourceScopedMember<T>>();
  const excludedFacts: SourceScopedHeldFact[] = [];
  let rejectedCurrentMembers = 0;
  for (const [key, group] of [...currentGroups].sort(([left], [right]) => left.localeCompare(right))) {
    if (!key || group.length !== 1) {
      rejectedCurrentMembers += group.length;
      excludedFacts.push({
        key,
        code: "MANUAL_MEMBER_KEY_INVALID_OR_DUPLICATED",
        detail: `${key || "An unnamed member"} is empty or appears ${group.length} times; no ambiguous current record was admitted.`,
        record: group.map((member) => member.record),
      });
      continue;
    }
    const member = group[0]!;
    const issue = input.memberIssue?.(member) ?? null;
    if (issue !== null) {
      rejectedCurrentMembers += 1;
      excludedFacts.push({
        key,
        code: "MANUAL_MEMBER_INVALID",
        detail: issue,
        record: member.record,
      });
      continue;
    }
    const disposition = sourceDisposition(member, input.currentReceipt, currentSourceIndex, urlsForMember);
    if (!disposition.ok) {
      rejectedCurrentMembers += 1;
      excludedFacts.push({ key, code: disposition.code, detail: disposition.detail, record: member.record });
      continue;
    }
    selected.set(key, member);
  }

  const retainedPrior: SourceScopedMember<T>[] = [];
  for (const prior of [...(input.prior?.members ?? [])].sort((left, right) => left.key.localeCompare(right.key))) {
    if (selected.has(prior.key)) continue;
    selected.set(prior.key, prior);
    retainedPrior.push(prior);
    const currentHeld = currentGroups.has(prior.key);
    excludedFacts.push({
      key: prior.key,
      code: currentHeld ? "MANUAL_MEMBER_HELD_LKG" : "MANUAL_MEMBER_REMOVAL_EVIDENCE_MISSING",
      detail: currentHeld
        ? `${prior.key} retained its prior GOOD member because the current member lacked member-scoped source/shape proof.`
        : `${prior.key} was omitted, but this open manual family supplied no validator-recognized positive removal evidence; the prior GOOD member remains live.`,
      record: prior.record,
    });
  }

  const currentSupported = input.currentReceipt.sources.filter((source) => sourceOutcome(source) === "SUPPORTED");
  const proofSources = [
    ...currentSupported,
    ...sourcesSupportingMembers(retainedPrior, input.prior?.sourceReceipt ?? {
      contractVersion: 1,
      reviewedAt: input.currentReceipt.reviewedAt,
      reviewedBy: input.currentReceipt.reviewedBy,
      sources: [],
    }, urlsForMember),
  ];
  const deduplicated = new Map<string, ManualSourceReview>();
  for (const source of proofSources) {
    const key = sourceIdentity(source);
    deduplicated.set(key, mergeManualSourceCopies(deduplicated.get(key), source));
  }

  return {
    members: [...selected.values()].sort((left, right) => left.key.localeCompare(right.key)),
    promotionReceipt: {
      contractVersion: 1,
      reviewedAt: input.currentReceipt.reviewedAt,
      reviewedBy: input.currentReceipt.reviewedBy,
      sources: [...deduplicated.values()].sort((left, right) =>
        sourceIdentity(left).localeCompare(sourceIdentity(right))
      ),
    },
    excludedFacts: excludedFacts
      .map((fact) => ({ fact, sortKey: `${fact.key}\n${fact.code}\n${canonicalCivicDataJson(fact.record)}` }))
      .sort((left, right) => left.sortKey.localeCompare(right.sortKey))
      .map(({ fact }) => fact),
    supportedCurrentSources: currentSupported.length,
    inputMembers: input.current.length,
    rejectedCurrentMembers,
    acceptedCurrentMembers: input.current.length - rejectedCurrentMembers,
  };
}
