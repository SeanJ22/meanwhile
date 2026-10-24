import { canonicalCivicDataJson } from "./changes.ts";
import type { ManualSourceReview, ManualSourceSetReceipt } from "./types.ts";
import { manualSourceUrls as sourceUrls, mergeManualSourceCopies } from "./manual-source-urls.ts";

const NON_POSITIVE_URL_CONTAINER = /^(?:superseded|failed|blocked|retired).*urls?$|^failures$/i;

export interface SourceScopedMember<T = unknown> {
  readonly key: string;
  readonly record: T;
}

interface SourceScopedPrior<T = unknown> {
  readonly members: readonly SourceScopedMember<T>[];
  readonly sourceReceipt?: ManualSourceSetReceipt;
}

export interface SourceScopedHeldFact {
  readonly key: string;
  readonly code: string;
  readonly detail: string;
  readonly record?: unknown;
}

interface SourceScopedReconciliation<T = unknown> {
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

// Failed and retired URLs describe attempts, not evidence for a published fact.
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

/** An official page's linked lookup is a fact on that page, not another acquired source. */
export function manualRecordSourceUrls(record: unknown): readonly string[] {
  const row = record as { readonly kind?: string; readonly value?: { readonly url?: string } } | null;
  return row?.kind === "ELECTION_FIELD" ? row.value?.url ? [row.value.url] : [] : [...directPositiveSourceUrls(record)];
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
  // A record without its own URL still needs its prior source evidence.
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

interface ReconciliationInput<T> {
  readonly currentReceipt: ManualSourceSetReceipt;
  readonly prior?: SourceScopedPrior<T> | null;
  readonly memberIssue?: (member: SourceScopedMember<T>) => string | null;
  readonly sourceUrls?: (member: SourceScopedMember<T>) => readonly string[];
  readonly onReplace?: (previous: SourceScopedMember<T>, next: SourceScopedMember<T>) => void;
}

// Omission from an open package does not establish that a previously published fact disappeared.
export class SourceScopedReconciler<T> {
  private readonly input: ReconciliationInput<T>;
  private readonly selected: Map<string, SourceScopedMember<T>>;
  private readonly pending: Map<string, SourceScopedMember<T>>;
  private readonly seen = new Set<string>();
  private readonly excludedFacts: SourceScopedHeldFact[] = [];
  private readonly sourceIndex: ManualSourceReceiptIndex;
  private readonly urlsForMember: (member: SourceScopedMember<T>) => readonly string[];
  private inputMembers = 0;
  private rejectedCurrentMembers = 0;

  constructor(input: ReconciliationInput<T>) {
    this.input = { currentReceipt: input.currentReceipt, memberIssue: input.memberIssue, sourceUrls: input.sourceUrls,
      onReplace: input.onReplace, prior: input.prior ? { members: [], sourceReceipt: input.prior.sourceReceipt } : null };
    this.selected = new Map(input.prior?.members.map(member => [member.key, member]));
    this.pending = new Map(this.selected);
    this.sourceIndex = indexSources(input.currentReceipt);
    this.urlsForMember = input.sourceUrls ?? (member => [...directPositiveSourceUrls(member.record)]);
  }

  add(group: readonly SourceScopedMember<T>[]): void {
    if (!group.length) return;
    const key = group[0]!.key;
    if (this.seen.has(key) || group.some(member => member.key !== key)) throw new Error("SOURCE_MEMBER_GROUP_REPEATED");
    this.seen.add(key);
    this.inputMembers += group.length;
    if (!key || group.length !== 1) {
      this.rejectedCurrentMembers += group.length;
      this.excludedFacts.push({ key, code: "MANUAL_MEMBER_KEY_INVALID_OR_DUPLICATED",
        detail: `${key || "An unnamed member"} is empty or appears ${group.length} times; no ambiguous current record was admitted.`,
        record: group.map(member => member.record) });
      return;
    }
    const member = group[0]!;
    const issue = this.input.memberIssue?.(member) ?? null;
    if (issue !== null) {
      this.rejectedCurrentMembers++;
      this.excludedFacts.push({ key, code: "MANUAL_MEMBER_INVALID", detail: issue, record: member.record });
      return;
    }
    const disposition = sourceDisposition(member, this.input.currentReceipt, this.sourceIndex, this.urlsForMember);
    if (!disposition.ok) {
      this.rejectedCurrentMembers++;
      this.excludedFacts.push({ key, code: disposition.code, detail: disposition.detail, record: member.record });
      return;
    }
    const previous = this.pending.get(key);
    if (previous) this.input.onReplace?.(previous, member);
    this.pending.delete(key);
    this.selected.set(key, member);
  }

  finish(): SourceScopedReconciliation<T> {
    const retained = [...this.pending.values()];
    for (const prior of retained) {
      const currentHeld = this.seen.has(prior.key);
      this.excludedFacts.push({ key: prior.key,
        code: currentHeld ? "MANUAL_MEMBER_HELD_LKG" : "MANUAL_MEMBER_REMOVAL_EVIDENCE_MISSING",
        detail: currentHeld
          ? `${prior.key} retained its prior GOOD member because the current member lacked member-scoped source/shape proof.`
          : `${prior.key} was omitted, but this open manual family supplied no validator-recognized positive removal evidence; the prior GOOD member remains live.`,
        record: prior.record });
      this.input.onReplace?.(prior, prior);
    }
    const proofSources = [...this.sourceIndex.supported,
      ...sourcesSupportingMembers(retained, this.input.prior?.sourceReceipt ?? { ...this.input.currentReceipt, sources: [] }, this.urlsForMember)];
    const deduplicated = new Map<string, ManualSourceReview>();
    for (const source of proofSources) {
      const key = sourceIdentity(source);
      deduplicated.set(key, mergeManualSourceCopies(deduplicated.get(key), source));
    }
    const members = [...this.selected.values()].sort((left, right) => left.key.localeCompare(right.key));
    this.pending.clear(); this.selected.clear(); this.seen.clear();
    return { members,
      promotionReceipt: { contractVersion: 1, reviewedAt: this.input.currentReceipt.reviewedAt,
        reviewedBy: this.input.currentReceipt.reviewedBy,
        sources: [...deduplicated.values()].sort((left, right) => sourceIdentity(left).localeCompare(sourceIdentity(right))) },
      excludedFacts: this.excludedFacts.map(fact => ({ fact, sortKey: `${fact.key}\n${fact.code}\n${canonicalCivicDataJson(fact.record)}` }))
        .sort((left, right) => left.sortKey.localeCompare(right.sortKey)).map(({ fact }) => fact),
      supportedCurrentSources: this.sourceIndex.supported.length, inputMembers: this.inputMembers,
      rejectedCurrentMembers: this.rejectedCurrentMembers, acceptedCurrentMembers: this.inputMembers - this.rejectedCurrentMembers };
  }
}

export function reconcileSourceScopedMembers<T>(input: ReconciliationInput<T> & {
  readonly current: readonly SourceScopedMember<T>[];
}): SourceScopedReconciliation<T> {
  const groups = new Map<string, SourceScopedMember<T>[]>();
  for (const member of input.current) {
    const group = groups.get(member.key) ?? [];
    group.push(member); groups.set(member.key, group);
  }
  const reconciler = new SourceScopedReconciler(input);
  for (const group of groups.values()) reconciler.add(group);
  return reconciler.finish();
}
