/**
 * **RECORDING AN OWNER DECISION — the exact-SHA rule, enforced at the write.**
 * (Admin Pass B, 2026-09-06.)
 *
 * Every write names the staging SHA the owner was looking at. The server
 * refetches the manifest (never the cached reading) and refuses the write when
 * the live SHA is not that SHA — STALE_SHA — or when there is no live SHA at
 * all — MANIFEST_UNAVAILABLE. Nothing is silently re-targeted. `APPROVE` on
 * Raised State is refused until a variant is chosen on the same SHA. The
 * composite `OWNER_APPROVED_FOR_PRODUCTION` is refused unless every named
 * condition holds, and it is only ever written by an explicit request for it.
 *
 * The write is an APPEND and nothing else. It does not merge, push, call
 * GitHub or Netlify, run git, promote, or notify. The row is the end of the line.
 *
 * Dependencies are injected so the whole path runs against the in-memory
 * repositories and a fixture manifest in the test suite.
 */
import {
  RAISED_STATE_CHOICES,
  REVIEW_DECISIONS,
  SOFTWARE_RELEASE_REVIEW_FORMAT_VERSION,
  type RaisedStateChoice,
  type ReviewDecision,
  type SoftwareReleaseReviewRecord,
} from "@/lib/control-plane/software-release-review.ts";
import type { AppendOnlyRepository } from "@/lib/control-plane/repository/types.ts";

import { FEEDBACK_MAX_CHARS, RAISED_STATE_SECTION_ID, fullSha, shortSha } from "./contract.ts";
import { buildReviewModel, sectionById, type ManifestReading, type ReviewModel } from "./review-model.ts";

export const WRITE_ACTIONS = ["DECIDE", "FEEDBACK", "RAISED_STATE_CHOICE", "RECORD_OWNER_APPROVAL"] as const;
export type WriteAction = (typeof WRITE_ACTIONS)[number];

export interface WriteInput {
  readonly action: string;
  /** The SHA as displayed to the owner when he clicked. */
  readonly stagingSha: string;
  readonly section: string | null;
  readonly decision: string | null;
  readonly feedback: string | null;
  readonly choice: string | null;
}

export interface WriteDeps {
  readonly reviews: AppendOnlyRepository<SoftwareReleaseReviewRecord>;
  /** The LIVE manifest, fetched now — never a cached reading. */
  readonly readLiveManifest: () => Promise<ManifestReading>;
  readonly now: () => string;
  /** The authenticated owner session reference, e.g. `session:<sid>`. */
  readonly actor: string;
}

export type WriteRefusal =
  | "BAD_REQUEST"
  | "MANIFEST_UNAVAILABLE"
  | "STALE_SHA"
  | "NOT_REVIEWABLE"
  | "RAISED_STATE_CHOICE_REQUIRED"
  | "NOT_RECORDABLE"
  | "ALREADY_RECORDED"
  | "STORE_UNAVAILABLE";

export type WriteOutcome =
  | { readonly ok: true; readonly code: "RECORDED"; readonly rowIds: readonly string[]; readonly detail: string }
  | { readonly ok: false; readonly code: WriteRefusal; readonly detail: string };

const refuse = (code: WriteRefusal, detail: string): WriteOutcome => ({ ok: false, code, detail });

function cleanFeedback(raw: string | null): { ok: true; feedback: string | null } | { ok: false; detail: string } {
  const text = (raw ?? "").replace(/\r\n/g, "\n").trim();
  if (text.length > FEEDBACK_MAX_CHARS) return { ok: false, detail: `feedback is longer than ${FEEDBACK_MAX_CHARS} characters` };
  return { ok: true, feedback: text === "" ? null : text };
}

async function rowsFor(reviews: AppendOnlyRepository<SoftwareReleaseReviewRecord>): Promise<readonly SoftwareReleaseReviewRecord[] | null> {
  try {
    return await reviews.readAll();
  } catch {
    return null;
  }
}

function rowId(sha: string, kind: string, section: string | null, at: string): string {
  return `${sha}:${kind}:${section ?? "-"}:${at}`;
}

export async function recordReview(deps: WriteDeps, input: WriteInput): Promise<WriteOutcome> {
  const action = input.action.trim();
  if (!(WRITE_ACTIONS as readonly string[]).includes(action)) return refuse("BAD_REQUEST", `action must be one of ${WRITE_ACTIONS.join(", ")}`);
  const submittedSha = fullSha(input.stagingSha.trim());
  if (submittedSha === null) return refuse("BAD_REQUEST", "stagingSha must be the full 40-hex SHA that was displayed");
  const feedback = cleanFeedback(input.feedback);
  if (!feedback.ok) return refuse("BAD_REQUEST", feedback.detail);

  // The exact-SHA rule: the LIVE manifest, right now.
  const live = await deps.readLiveManifest();
  if (live.kind !== "OBSERVED" || live.manifest.sha === null) {
    return refuse(
      "MANIFEST_UNAVAILABLE",
      `a decision cannot be recorded against a SHA the Admin cannot currently see (${live.kind === "UNAVAILABLE" ? live.reason : "the manifest carries no full staging SHA"}); nothing was recorded`,
    );
  }
  if (live.manifest.sha !== submittedSha) {
    return refuse(
      "STALE_SHA",
      `staging moved to ${shortSha(live.manifest.sha)} while you were reviewing ${shortSha(submittedSha)}; your decision was not recorded`,
    );
  }

  const rows = await rowsFor(deps.reviews);
  if (rows === null) return refuse("STORE_UNAVAILABLE", "the review store could not be read; nothing was recorded");
  const model: ReviewModel = buildReviewModel({ reading: live, production: null, rows, store: { ok: true } });
  const at = deps.now();
  const manifestNote = {
    prompt3Status: live.manifest.prompt3Status,
    reviewState: live.manifest.reviewState,
    stagingBoundary: live.manifest.stagingBoundary,
    reportedAt: live.manifest.reportedAt,
  };
  const base = {
    formatVersion: SOFTWARE_RELEASE_REVIEW_FORMAT_VERSION,
    stagingSha: submittedSha,
    deployId: live.manifest.deployId,
    actor: deps.actor,
    createdAt: at,
    manifest: manifestNote,
  } as const;

  const append = async (record: SoftwareReleaseReviewRecord): Promise<WriteOutcome> => {
    try {
      await deps.reviews.append(submittedSha, record.id, record, at);
      return { ok: true, code: "RECORDED", rowIds: [record.id], detail: `${record.decision}${record.section ? ` on ${record.section}` : ""} recorded for ${shortSha(submittedSha)}` };
    } catch (error) {
      return refuse("STORE_UNAVAILABLE", `the append failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  if (action === "DECIDE" || action === "FEEDBACK") {
    const sectionId = (input.section ?? "").trim();
    const section = sectionId ? sectionById(model, sectionId) : null;
    if (!section) return refuse("BAD_REQUEST", "section must name a review section on this SHA");
    if (section.availability !== "REVIEWABLE") return refuse("NOT_REVIEWABLE", `${section.name} is ${section.availability} on ${shortSha(submittedSha)}; nothing was recorded`);
    if (action === "FEEDBACK") {
      if (feedback.feedback === null) return refuse("BAD_REQUEST", "feedback alone needs some text");
      return append({ ...base, id: rowId(submittedSha, "FEEDBACK_ONLY", section.id, at), section: section.id, decision: "FEEDBACK_ONLY", raisedStateChoice: null, feedback: feedback.feedback, composedFrom: null });
    }
    const decision = (input.decision ?? "").trim();
    if (!(REVIEW_DECISIONS as readonly string[]).includes(decision)) return refuse("BAD_REQUEST", `decision must be one of ${REVIEW_DECISIONS.join(", ")}`);
    if (section.id === RAISED_STATE_SECTION_ID && decision === "APPROVE" && model.raisedState.choice === null) {
      return refuse("RAISED_STATE_CHOICE_REQUIRED", `APPROVE on Raised State is refused until a variant (${RAISED_STATE_CHOICES.join(" / ")}) is chosen on ${shortSha(submittedSha)}; nothing was recorded`);
    }
    return append({ ...base, id: rowId(submittedSha, decision, section.id, at), section: section.id, decision: decision as ReviewDecision, raisedStateChoice: null, feedback: feedback.feedback, composedFrom: null });
  }

  if (action === "RAISED_STATE_CHOICE") {
    const choice = (input.choice ?? "").trim();
    if (!(RAISED_STATE_CHOICES as readonly string[]).includes(choice)) return refuse("BAD_REQUEST", `choice must be one of ${RAISED_STATE_CHOICES.join(", ")}`);
    const section = sectionById(model, RAISED_STATE_SECTION_ID);
    if (!section || section.availability !== "REVIEWABLE") return refuse("NOT_REVIEWABLE", `Raised State is ${section?.availability ?? "absent"} on ${shortSha(submittedSha)}; the choice was not recorded`);
    return append({ ...base, id: rowId(submittedSha, "RAISED_STATE_CHOICE", RAISED_STATE_SECTION_ID, at), section: RAISED_STATE_SECTION_ID, decision: "RAISED_STATE_CHOICE", raisedStateChoice: choice as RaisedStateChoice, feedback: feedback.feedback, composedFrom: null });
  }

  // RECORD_OWNER_APPROVAL — the composite, on an explicit request only.
  if (model.composite.recorded) return refuse("ALREADY_RECORDED", `OWNER_APPROVED_FOR_PRODUCTION is already recorded for ${shortSha(submittedSha)} at ${model.composite.recorded.createdAt}`);
  const failing = model.composite.conditions.filter((c) => !c.ok);
  if (failing.length > 0) {
    return refuse("NOT_RECORDABLE", `not recordable — ${failing.length} condition(s) fail: ${failing.map((c) => `${c.name} (${c.detail})`).join("; ")}`);
  }
  return append({
    ...base,
    id: rowId(submittedSha, "OWNER_APPROVED_FOR_PRODUCTION", null, at),
    section: null,
    decision: "OWNER_APPROVED_FOR_PRODUCTION",
    raisedStateChoice: model.raisedState.choice,
    feedback: feedback.feedback,
    composedFrom: model.composite.composedFrom,
  });
}

/**
 * The Admin's own note that it saw a manifest: appended once per (SHA,
 * status) change, never counted toward a gate, so the page can say what it
 * last observed when the manifest is unreachable. Best effort: a failure here
 * never blocks a render.
 */
export async function noteObservation(
  reviews: AppendOnlyRepository<SoftwareReleaseReviewRecord>,
  reading: ManifestReading,
  now: string,
): Promise<{ readonly appended: boolean }> {
  if (reading.kind !== "OBSERVED" || reading.manifest.sha === null) return { appended: false };
  const sha = reading.manifest.sha;
  try {
    const existing = (await reviews.read(sha)).filter((r) => r.decision === "MANIFEST_OBSERVED");
    const last = existing[existing.length - 1];
    if (last && last.manifest.prompt3Status === reading.manifest.prompt3Status && last.manifest.reviewState === reading.manifest.reviewState) {
      return { appended: false };
    }
    const record: SoftwareReleaseReviewRecord = {
      formatVersion: SOFTWARE_RELEASE_REVIEW_FORMAT_VERSION,
      id: rowId(sha, "MANIFEST_OBSERVED", null, now),
      stagingSha: sha,
      deployId: reading.manifest.deployId,
      section: null,
      decision: "MANIFEST_OBSERVED",
      raisedStateChoice: null,
      feedback: null,
      actor: "manifest-reader",
      composedFrom: null,
      createdAt: now,
      manifest: {
        prompt3Status: reading.manifest.prompt3Status,
        reviewState: reading.manifest.reviewState,
        stagingBoundary: reading.manifest.stagingBoundary,
        reportedAt: reading.manifest.reportedAt,
      },
    };
    await reviews.append(sha, record.id, record, now);
    return { appended: true };
  } catch {
    return { appended: false };
  }
}
