import type { ContractPublication, PublicationStatusView, PublicationVerdict } from "../../civic-data/publication-status.ts";

/**
 * **admin-v6/publication@1 — PUBLISHED VERSUS READER-VISIBLE, PER ROUTINE CONTRACT.**
 *
 * The narrow publication read (`readRoutinePublicationStatus`): each registered routine contract's promotion pointer,
 * and whether the typed Reader read back exactly that version. It trusts the pointer and the readback event as
 * recorded and re-verifies no payload. This is the publication status the retired Sources page showed, now beside
 * source reliability on Workers. A read that fails is an unread section, never zero counts.
 */
export const ADMIN_V6_PUBLICATION_CONTRACT = "admin-v6/publication@1" as const;
/** The contracts a reader cannot see are listed in full up to this many; the counts above them always cover every contract. */
export const PUBLICATION_EXCEPTION_LIMIT = 40;

export const PUBLICATION_VERDICT_WORDS: Readonly<Record<PublicationVerdict, string>> = {
  READER_VISIBLE: "Published and read back",
  READBACK_FAILED: "Published, readback failed",
  PUBLISHED_NOT_READ_BACK: "Published, not read back",
  PUBLISHED_NO_READER_SURFACE: "Published, no reader page",
  NOT_PUBLISHED: "Not published",
};

const NOT_VISIBLE: readonly PublicationVerdict[] = ["READBACK_FAILED", "PUBLISHED_NOT_READ_BACK", "NOT_PUBLISHED"];

/** Structurally `PublicationView` in app/(admin)/_mw/admin-v6/model.ts. */
export interface AdminV6Publication {
  readonly total: number;
  readonly counts: readonly { readonly verdict: PublicationVerdict; readonly words: string; readonly count: number }[];
  readonly latestAttemptFailing: number;
  /** Contracts a reader cannot see yet, most recently promoted first; `hidden` counts any beyond the limit. */
  readonly notVisible: readonly PublicationRow[];
  readonly notVisibleHidden: number;
}
export interface PublicationRow {
  readonly contract: string;
  readonly verdict: PublicationVerdict;
  readonly words: string;
  readonly publishedAt: string | null;
  readonly readback: { readonly status: "PASS" | "FAIL"; readonly at: string } | null;
  readonly attempt: { readonly state: string; readonly at: string; readonly failureCode: string | null } | null;
}

function safeDecode(value: string): string {
  try { return decodeURIComponent(value); } catch { return value; }
}

function rowOf(c: ContractPublication): PublicationRow {
  return { contract: safeDecode(c.contractId), verdict: c.verdict, words: PUBLICATION_VERDICT_WORDS[c.verdict],
    publishedAt: c.published?.promotedAt ?? null,
    readback: c.readback ? { status: c.readback.status, at: c.readback.at } : null,
    attempt: c.latestAttempt ? { state: c.latestAttempt.state, at: c.latestAttempt.attemptedAt, failureCode: c.latestAttempt.failureCode } : null };
}

export function publicationView(view: PublicationStatusView): AdminV6Publication {
  const hidden = view.contracts.filter((c) => NOT_VISIBLE.includes(c.verdict));
  const ordered = [...hidden].sort((a, b) => (b.published?.promotedAt ?? "").localeCompare(a.published?.promotedAt ?? "") || a.contractId.localeCompare(b.contractId));
  return {
    total: view.contracts.length,
    counts: (Object.keys(PUBLICATION_VERDICT_WORDS) as PublicationVerdict[]).map((verdict) => ({ verdict, words: PUBLICATION_VERDICT_WORDS[verdict], count: view.counts[verdict] })),
    latestAttemptFailing: view.latestAttemptFailing,
    notVisible: ordered.slice(0, PUBLICATION_EXCEPTION_LIMIT).map(rowOf),
    notVisibleHidden: Math.max(0, ordered.length - PUBLICATION_EXCEPTION_LIMIT),
  };
}
