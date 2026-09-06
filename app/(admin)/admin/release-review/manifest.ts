/**
 * **THE MANIFEST AS OBSERVED — a tolerant reading of untrusted input.**
 * (Admin Pass B, 2026-09-06.)
 *
 * The contract is what the live endpoint returned and what its source on
 * `test` (lib/review/release-manifest.ts) can emit: `contractVersion`, `kind`,
 * `sha`, `build{sha,branch,context,deployId,builtAt}`, `reportedAt`,
 * `stagingBoundary`, `milestone`, `prompt3Status`, `reviewState`,
 * `boundaryReason`, `isolation`, `reviewSections[{id,name,url}]`,
 * `raisedState{status,candidates[{id,label,url,…}]}`, `ownership`,
 * `prompt4MayBeginInSeparateSession`. Nothing is renamed, nothing is invented.
 *
 * Every field may be missing or of the wrong shape and the page still
 * renders: a missing field reads as null and the page says so; an unknown
 * top-level field is kept, raw, for the "unrecognized manifest fields"
 * disclosure; a status value never seen before is carried as the string it is.
 * No manifest string is ever rendered as markup, and the only URLs the page
 * follows are anchors to the staging review origin.
 */
import { STAGING_RENDER_ORIGIN } from "@/lib/ops/origins.ts";

import { REVIEW_READY_STATUS, fullSha } from "./contract.ts";

export interface ManifestSection {
  readonly id: string;
  readonly name: string;
  /** The section's review-page link, only when the manifest supplied one on the staging origin. */
  readonly url: string | null;
}

export interface ManifestCandidate {
  readonly id: string;
  readonly label: string;
  readonly url: string | null;
}

export interface UnknownField {
  readonly key: string;
  /** JSON, truncated; rendered as text under a disclosure, never followed. */
  readonly value: string;
}

export interface ObservedManifest {
  /** The exact staging SHA, only when it is a full 40-hex value. */
  readonly sha: string | null;
  /** Whatever `sha` held when it was not a full SHA (rendered as text, never as an identity). */
  readonly shaRaw: string | null;
  readonly deployId: string | null;
  readonly branch: string | null;
  readonly context: string | null;
  readonly builtAt: string | null;
  readonly reportedAt: string | null;
  readonly prompt3Status: string | null;
  readonly reviewState: string | null;
  readonly stagingBoundary: string | null;
  readonly milestone: string | null;
  readonly boundaryReason: string | null;
  readonly contractVersion: string | null;
  readonly kind: string | null;
  readonly isolation: { readonly application: string | null; readonly controlPlane: string | null; readonly productionWritesAllowed: boolean | null } | null;
  readonly prompt4MayBegin: boolean | null;
  readonly ownership: readonly { readonly owner: string; readonly items: readonly string[] }[] | null;
  /** Null when the manifest exposes no section list at all. */
  readonly sections: readonly ManifestSection[] | null;
  readonly raisedState: { readonly status: string | null; readonly candidates: readonly ManifestCandidate[] | null } | null;
  readonly unknownFields: readonly UnknownField[];
  /** True when `prompt3Status` (or, failing that, `reviewState`) equals the review-ready value. */
  readonly reviewReady: boolean;
  /** Which field the readiness was read from. */
  readonly readinessKeyedOn: "prompt3Status" | "reviewState" | null;
}

const KNOWN_KEYS = new Set([
  "contractVersion",
  "kind",
  "sha",
  "build",
  "reportedAt",
  "stagingBoundary",
  "milestone",
  "prompt3Status",
  "reviewState",
  "boundaryReason",
  "isolation",
  "reviewSections",
  "raisedState",
  "ownership",
  "prompt4MayBeginInSeparateSession",
]);

const str = (value: unknown): string | null => (typeof value === "string" && value.trim() !== "" ? value : null);
const bool = (value: unknown): boolean | null => (typeof value === "boolean" ? value : null);
const obj = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

/** A URL the page may render as an anchor: parses, and sits on the staging origin. Anything else is dropped. */
export function safeStagingUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.origin === STAGING_RENDER_ORIGIN && (url.protocol === "https:") ? url.toString() : null;
  } catch {
    return null;
  }
}

function sections(value: unknown): readonly ManifestSection[] | null {
  if (!Array.isArray(value)) return null;
  const out: ManifestSection[] = [];
  for (const item of value) {
    const row = obj(item);
    if (!row) continue;
    const id = str(row.id);
    const name = str(row.name);
    if (!id && !name) continue;
    out.push({ id: id ?? (name as string).toLowerCase().replace(/[^a-z0-9]+/g, "-"), name: name ?? (id as string), url: safeStagingUrl(row.url) });
  }
  return out;
}

function candidates(value: unknown): readonly ManifestCandidate[] | null {
  if (!Array.isArray(value)) return null;
  const out: ManifestCandidate[] = [];
  for (const item of value) {
    const row = obj(item);
    if (!row) continue;
    const id = str(row.id);
    if (!id) continue;
    out.push({ id, label: str(row.label) ?? id, url: safeStagingUrl(row.url) });
  }
  return out;
}

function ownership(value: unknown): readonly { readonly owner: string; readonly items: readonly string[] }[] | null {
  const row = obj(value);
  if (!row) return null;
  const out: { owner: string; items: string[] }[] = [];
  for (const [owner, items] of Object.entries(row)) {
    if (Array.isArray(items)) out.push({ owner, items: items.filter((i): i is string => typeof i === "string") });
    else if (typeof items === "string") out.push({ owner, items: [items] });
  }
  return out;
}

/** The manifest as observed, or null when the body is not a JSON object at all. */
export function parseManifest(raw: unknown): ObservedManifest | null {
  const root = obj(raw);
  if (!root) return null;
  const build = obj(root.build);
  const shaValue = str(root.sha) ?? (build ? str(build.sha) : null);
  const prompt3Status = str(root.prompt3Status);
  const reviewState = str(root.reviewState);
  const readinessKeyedOn = prompt3Status !== null ? "prompt3Status" : reviewState !== null ? "reviewState" : null;
  const readiness = readinessKeyedOn === "prompt3Status" ? prompt3Status : readinessKeyedOn === "reviewState" ? reviewState : null;
  const isolation = obj(root.isolation);
  const raised = obj(root.raisedState);
  const unknownFields: UnknownField[] = [];
  for (const [key, value] of Object.entries(root)) {
    if (KNOWN_KEYS.has(key)) continue;
    let text: string;
    try {
      text = JSON.stringify(value) ?? String(value);
    } catch {
      text = String(value);
    }
    unknownFields.push({ key, value: text.length > 240 ? `${text.slice(0, 240)}…` : text });
  }
  return {
    sha: fullSha(shaValue),
    shaRaw: fullSha(shaValue) ? null : shaValue,
    deployId: build ? str(build.deployId) : null,
    branch: build ? str(build.branch) : null,
    context: build ? str(build.context) : null,
    builtAt: build ? str(build.builtAt) : null,
    reportedAt: str(root.reportedAt),
    prompt3Status,
    reviewState,
    stagingBoundary: str(root.stagingBoundary),
    milestone: str(root.milestone),
    boundaryReason: str(root.boundaryReason),
    contractVersion: root.contractVersion === undefined || root.contractVersion === null ? null : String(root.contractVersion),
    kind: str(root.kind),
    isolation: isolation
      ? { application: str(isolation.application), controlPlane: str(isolation.controlPlane), productionWritesAllowed: bool(isolation.productionWritesAllowed) }
      : null,
    prompt4MayBegin: bool(root.prompt4MayBeginInSeparateSession),
    ownership: ownership(root.ownership),
    sections: sections(root.reviewSections),
    raisedState: raised ? { status: str(raised.status), candidates: candidates(raised.candidates) } : null,
    unknownFields,
    reviewReady: readiness === REVIEW_READY_STATUS,
    readinessKeyedOn,
  };
}
