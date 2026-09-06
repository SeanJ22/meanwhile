/**
 * **THE REVIEW STATE, DERIVED — from one manifest reading and the rows.**
 * (Admin Pass B, 2026-09-06.)
 *
 * PURE. A manifest reading in (observed or unavailable), the production
 * identity in, the rows in, one model out. Every section's state is keyed by
 * (staging SHA, section): a new SHA starts with no decisions, and a prior
 * SHA's rows appear only under history, labeled with their SHA. The composite
 * is a computed list of named conditions; it is never recorded here.
 */
import {
  REVIEW_DECISIONS,
  type RaisedStateChoice,
  type ReviewDecision,
  type SoftwareReleaseReviewRecord,
} from "@/lib/control-plane/software-release-review.ts";

import { RAISED_STATE_SECTION_ID, REQUIRED_SECTIONS, REVIEW_PAGE_URL, REVIEW_READY_STATUS, shortSha } from "./contract.ts";
import type { ManifestCandidate, ManifestSection, ObservedManifest } from "./manifest.ts";

export type ManifestReading =
  | { readonly kind: "OBSERVED"; readonly manifest: ObservedManifest; readonly observedAt: string; readonly httpStatus: number }
  | { readonly kind: "UNAVAILABLE"; readonly observedAt: string; readonly reason: string; readonly httpStatus: number | null };

export interface ProductionIdentity {
  /** Where the identity came from, named for the page. */
  readonly source: string;
  readonly sha: string | null;
  readonly shaRaw: string | null;
  readonly deployId: string | null;
  readonly branch: string | null;
  readonly context: string | null;
  readonly observedAt: string;
  /** Why there is no identity, when there is none. */
  readonly detail: string | null;
}

export type SectionAvailability = "REVIEWABLE" | "NOT_YET_REVIEWABLE" | "MANIFEST_UNAVAILABLE";

export interface SectionView {
  readonly id: string;
  readonly name: string;
  /** True for the five sections the master brief requires; false for a manifest-only extra. */
  readonly required: boolean;
  readonly manifestSection: ManifestSection | null;
  readonly availability: SectionAvailability;
  /** The review-page link: the manifest's own section URL when it supplied one, else the review page itself. */
  readonly link: string;
  readonly linkIsDeep: boolean;
  readonly current: { readonly decision: ReviewDecision | null; readonly rowId: string | null; readonly at: string | null; readonly feedback: string | null };
  /** Every row for (live SHA, section), newest first. */
  readonly history: readonly SoftwareReleaseReviewRecord[];
}

export interface CompositeCondition {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

export interface ReviewModel {
  readonly reading: ManifestReading;
  readonly production: ProductionIdentity | null;
  readonly liveSha: string | null;
  readonly deployId: string | null;
  readonly status: { readonly prompt3Status: string | null; readonly reviewState: string | null; readonly reviewReady: boolean; readonly keyedOn: string | null };
  /** The Admin's last successful observation of any manifest, from the rows. */
  readonly lastObserved: { readonly sha: string; readonly at: string; readonly prompt3Status: string | null } | null;
  readonly sections: readonly SectionView[];
  readonly extras: readonly SectionView[];
  readonly raisedState: {
    readonly status: "AWAITING_OWNER_CHOICE" | "CHOSEN";
    readonly choice: RaisedStateChoice | null;
    readonly rowId: string | null;
    readonly at: string | null;
    readonly candidates: readonly ManifestCandidate[] | null;
    readonly manifestStatus: string | null;
  };
  readonly composite: {
    readonly recordable: boolean;
    readonly recorded: SoftwareReleaseReviewRecord | null;
    readonly conditions: readonly CompositeCondition[];
    /** The row ids a record would be composed from, in section order, then the variant row. */
    readonly composedFrom: readonly string[];
  };
  readonly writesEnabled: boolean;
  readonly writesDisabledBecause: string | null;
  /** Rows for every OTHER SHA, newest SHA first. */
  readonly history: readonly { readonly sha: string; readonly rows: readonly SoftwareReleaseReviewRecord[] }[];
  readonly store: { readonly ok: true } | { readonly ok: false; readonly detail: string };
}

const isDecision = (value: string): value is ReviewDecision => (REVIEW_DECISIONS as readonly string[]).includes(value);

function normal(value: string): string {
  return value.trim().toLowerCase();
}

/** The manifest section that reconciles to a required one, by id or name. */
export function matchManifestSection(required: { readonly matches: readonly string[] }, exposed: readonly ManifestSection[] | null): ManifestSection | null {
  if (!exposed) return null;
  return exposed.find((s) => required.matches.includes(normal(s.id)) || required.matches.includes(normal(s.name))) ?? null;
}

function newestFirst(rows: readonly SoftwareReleaseReviewRecord[]): SoftwareReleaseReviewRecord[] {
  return [...rows].reverse();
}

function currentDecision(rows: readonly SoftwareReleaseReviewRecord[]): SectionView["current"] {
  for (const row of newestFirst(rows)) {
    if (isDecision(row.decision)) return { decision: row.decision, rowId: row.id, at: row.createdAt, feedback: row.feedback };
  }
  return { decision: null, rowId: null, at: null, feedback: null };
}

export interface ModelInput {
  readonly reading: ManifestReading;
  readonly production: ProductionIdentity | null;
  readonly rows: readonly SoftwareReleaseReviewRecord[];
  readonly store: { readonly ok: true } | { readonly ok: false; readonly detail: string };
}

export function buildReviewModel(input: ModelInput): ReviewModel {
  const { reading, production, rows, store } = input;
  const manifest = reading.kind === "OBSERVED" ? reading.manifest : null;
  const liveSha = manifest?.sha ?? null;
  const exposed = manifest?.sections ?? null;
  const availability: SectionAvailability = reading.kind !== "OBSERVED" || liveSha === null ? "MANIFEST_UNAVAILABLE" : "REVIEWABLE";

  const decisionRows = rows.filter((r) => r.decision !== "MANIFEST_OBSERVED");
  const liveRows = liveSha ? decisionRows.filter((r) => r.stagingSha === liveSha) : [];

  const sections: SectionView[] = REQUIRED_SECTIONS.map((required) => {
    const manifestSection = matchManifestSection(required, exposed);
    const sectionRows = liveRows.filter((r) => r.section === required.id);
    return {
      id: required.id,
      name: required.name,
      required: true,
      manifestSection,
      availability: availability !== "REVIEWABLE" ? availability : manifestSection ? "REVIEWABLE" : "NOT_YET_REVIEWABLE",
      link: manifestSection?.url ?? REVIEW_PAGE_URL,
      linkIsDeep: manifestSection?.url !== null && manifestSection?.url !== undefined,
      current: currentDecision(sectionRows),
      history: newestFirst(sectionRows),
    };
  });

  const matchedIds = new Set(sections.map((s) => s.manifestSection?.id).filter((id): id is string => id !== undefined && id !== null));
  const extras: SectionView[] = (exposed ?? [])
    .filter((s) => !matchedIds.has(s.id))
    .map((s) => {
      const sectionRows = liveRows.filter((r) => r.section === s.id);
      return {
        id: s.id,
        name: s.name,
        required: false,
        manifestSection: s,
        availability,
        link: s.url ?? REVIEW_PAGE_URL,
        linkIsDeep: s.url !== null,
        current: currentDecision(sectionRows),
        history: newestFirst(sectionRows),
      };
    });

  const choiceRow = newestFirst(liveRows).find((r) => r.decision === "RAISED_STATE_CHOICE" && r.raisedStateChoice !== null) ?? null;
  const raisedState: ReviewModel["raisedState"] = {
    status: choiceRow ? "CHOSEN" : "AWAITING_OWNER_CHOICE",
    choice: choiceRow?.raisedStateChoice ?? null,
    rowId: choiceRow?.id ?? null,
    at: choiceRow?.createdAt ?? null,
    candidates: manifest?.raisedState?.candidates ?? null,
    manifestStatus: manifest?.raisedState?.status ?? null,
  };

  const recorded = newestFirst(liveRows).find((r) => r.decision === "OWNER_APPROVED_FOR_PRODUCTION") ?? null;
  const keyedOn = manifest?.readinessKeyedOn ?? null;
  const conditions: CompositeCondition[] = [
    {
      name: "manifest observed with a full staging SHA",
      ok: liveSha !== null,
      detail: liveSha ? `staging SHA ${shortSha(liveSha)} observed ${reading.observedAt}` : reading.kind === "UNAVAILABLE" ? `MANIFEST_UNAVAILABLE — ${reading.reason}` : "the manifest carries no full 40-hex SHA",
    },
    ...sections.map((s) => ({
      name: `${s.name} approved on this SHA`,
      ok: s.current.decision === "APPROVE",
      detail:
        s.availability === "NOT_YET_REVIEWABLE"
          ? "NOT_YET_REVIEWABLE — the manifest has not exposed this section"
          : s.current.decision === null
            ? "no decision recorded on this SHA"
            : `current decision ${s.current.decision} at ${s.current.at}`,
    })),
    {
      name: "Raised State variant chosen on this SHA",
      ok: raisedState.choice !== null,
      detail: raisedState.choice ? `${raisedState.choice} chosen at ${raisedState.at}` : "AWAITING_OWNER_CHOICE",
    },
    {
      name: `manifest status is ${REVIEW_READY_STATUS}`,
      ok: manifest?.reviewReady === true,
      detail: manifest
        ? keyedOn === null
          ? "the manifest carries neither prompt3Status nor reviewState"
          : `${keyedOn} = ${manifest[keyedOn] ?? "absent"}`
        : "no manifest observed",
    },
    { name: "review store reachable", ok: store.ok, detail: store.ok ? "rows read" : store.detail },
    { name: "not already recorded on this SHA", ok: recorded === null, detail: recorded ? `recorded at ${recorded.createdAt}` : "no record yet" },
  ];
  const composedFrom = [
    ...sections.map((s) => s.current.rowId).filter((id): id is string => id !== null),
    ...(raisedState.rowId ? [raisedState.rowId] : []),
  ];

  const observations = rows.filter((r) => r.decision === "MANIFEST_OBSERVED");
  const latestObservation = observations.length > 0 ? observations[observations.length - 1] : null;

  const otherShas = [...new Set(decisionRows.map((r) => r.stagingSha).filter((sha) => sha !== liveSha))];
  const history = otherShas
    .map((sha) => ({ sha, rows: newestFirst(decisionRows.filter((r) => r.stagingSha === sha)) }))
    .sort((a, b) => (b.rows[0]?.createdAt ?? "").localeCompare(a.rows[0]?.createdAt ?? ""));

  const writesDisabledBecause =
    reading.kind === "UNAVAILABLE"
      ? `MANIFEST_UNAVAILABLE — a decision cannot be recorded against a SHA the Admin cannot currently see (${reading.reason})`
      : liveSha === null
        ? "the manifest carries no full staging SHA to record a decision against"
        : !store.ok
          ? `the review store could not be read: ${store.detail}`
          : null;

  return {
    reading,
    production,
    liveSha,
    deployId: manifest?.deployId ?? null,
    status: { prompt3Status: manifest?.prompt3Status ?? null, reviewState: manifest?.reviewState ?? null, reviewReady: manifest?.reviewReady ?? false, keyedOn },
    lastObserved: latestObservation ? { sha: latestObservation.stagingSha, at: latestObservation.createdAt, prompt3Status: latestObservation.manifest.prompt3Status } : null,
    sections,
    extras,
    raisedState,
    composite: { recordable: conditions.every((c) => c.ok), recorded, conditions, composedFrom },
    writesEnabled: writesDisabledBecause === null,
    writesDisabledBecause,
    history,
    store,
  };
}

/** The section view for an id on the live SHA, required or extra. */
export function sectionById(model: ReviewModel, id: string): SectionView | null {
  return model.sections.find((s) => s.id === id) ?? model.extras.find((s) => s.id === id) ?? null;
}

export { RAISED_STATE_SECTION_ID };
