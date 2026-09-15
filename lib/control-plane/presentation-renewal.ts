/**
 * The one-time, explicitly bounded presentation-only renewal — its types, its
 * semantic validator, and the lightweight consistency check the preflight runs.
 *
 * This is a LEAF: it imports only `node:` builtins and `lib/ops/git-facts.ts`
 * (itself node-only), so the cheap preflight can run it on a bare checkout
 * before `pnpm install`, before the expensive suite and the builds.
 *
 * **Evidence creation is elsewhere.** `scripts/reader-presentation-renewal.mjs`
 * writes the artifact (records the integration commit and the browser results at
 * the moment of creation). This module only VERIFIES a recorded artifact: it
 * checks the recorded evidence's ancestry and its exact file/receipt bindings
 * against the candidate tree. It never recomputes the integration commit or the
 * browser head from the current HEAD — committing the renewal, and later merging
 * it, advances HEAD past the recorded commit, and a verifier that regenerated
 * those fields would reject its own unchanged evidence on every later commit.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { containsCommit, headSha } from "../ops/git-facts.ts";

/** The committed artifact, relative to the repo root. */
export const READER_PRESENTATION_RENEWAL_PATH = "docs/evidence/reader-last-mile-lumen-presentation-renewal.json";

const sha256 = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const EXACT_GIT_HEAD = /^[0-9a-f]{40}$/;
const EXACT_SHA256 = /^[0-9a-f]{64}$/;
const uniq = (values: readonly string[]) => [...new Set(values)].sort();
const str = (value: unknown) => (typeof value === "string" ? value : "");

export type ReaderPresentationRenewalFileKind = "STYLESHEET" | "PRESENTATION_COMPONENT" | "PRESENTATION_HELPER";
export type ReaderPresentationRenewalBehavior =
  "DATA_LOADING" | "QUERIES" | "IDENTITY_SELECTION" | "AUTHORIZATION" | "VALIDATION" | "PUBLICATION";

export interface ReaderPresentationRenewalFile {
  readonly path: string;
  /** The exact fingerprint this file carried in the preserved production receipt. */
  readonly baselineSha256: string;
  /** The exact fingerprint of the renewed presentation bytes at the integration commit. */
  readonly renewedSha256: string;
  readonly kind: ReaderPresentationRenewalFileKind;
  /** Why this exact change cannot alter data loading, queries, identity
   * selection, authorization, validation or publication behavior. */
  readonly behaviorReview: string;
}

/**
 * A one-time, explicitly bounded presentation-only renewal, approved by the
 * author for a single integration. Recorded SEPARATELY from the preserved
 * production closure receipt and only ever LINKING to it — the receipt keeps its
 * original source and execution bindings at their original head, and this record
 * never claims the original production execution occurred at the new head.
 */
export interface ReaderPresentationRenewal {
  readonly formatVersion: 1;
  readonly renewalKind: "PRESENTATION_ONLY";
  readonly rationale: string;
  /** The exact integration commit whose reader bytes this renewal describes. */
  readonly integrationCommit: string;
  /** The preserved production receipt this renewal is linked to; never mutated. */
  readonly baselineReceiptPath: string;
  readonly baselineReceiptSha256: string;
  readonly permittedFiles: readonly ReaderPresentationRenewalFile[];
  readonly unchangedBehavior: readonly ReaderPresentationRenewalBehavior[];
  readonly browserVerification: {
    readonly at: string;
    readonly head: string;
    readonly surfaces: readonly {
      readonly surface: string;
      readonly expectedRecords: string;
      readonly changedControls: string;
      readonly result: "RENDERED_AS_EXPECTED";
    }[];
  };
}

/** The minimal shape the validator needs from the preserved receipt. */
export interface ReaderRenewalSourceHash {
  readonly path: string;
  readonly sha256: string;
}

const RENEWAL_BEHAVIORS: readonly ReaderPresentationRenewalBehavior[] =
  ["DATA_LOADING", "QUERIES", "IDENTITY_SELECTION", "AUTHORIZATION", "VALIDATION", "PUBLICATION"];
const RENEWAL_KINDS: readonly ReaderPresentationRenewalFileKind[] =
  ["STYLESHEET", "PRESENTATION_COMPONENT", "PRESENTATION_HELPER"];

/**
 * The admission half of the bounded presentation-only renewal. Pure and
 * git-free: the caller passes `integrationCommitReachable` (an ancestry fact)
 * and `receiptSha256` (the preserved receipt's exact bytes) so this function is
 * deterministically testable without a repository.
 *
 * It admits source-fingerprint drift only on the enumerated presentation files
 * that actually changed after the proof, each bound to the receipt's original
 * bytes (`baselineSha256`), the renewed bytes on disk (`renewedSha256`), an
 * actual change between the two, and a presentation kind. The negative half is
 * mandatory and fails closed: every reader dependency that actually changed MUST
 * be an admitted presentation file, or it stays a hard failure — so a data,
 * query, identity, authorization, validation or publication source change can
 * never ride in under this rule, and neither can a stale or unbound renewal.
 */
export function readerPresentationRenewalProblems(
  root: string,
  receiptSourceHashes: readonly ReaderRenewalSourceHash[],
  renewal: ReaderPresentationRenewal,
  options: {
    readonly receiptPath: string;
    readonly receiptSha256: string;
    readonly integrationCommitReachable: boolean;
    readonly skipPaths?: ReadonlySet<string>;
  },
): { readonly admittedPaths: ReadonlySet<string>; readonly problems: string[] } {
  const problems: string[] = [];
  const admittedPaths = new Set<string>();
  const skip = options.skipPaths ?? new Set<string>();

  if (renewal.formatVersion !== 1) problems.push("Presentation renewal format is not version 1");
  if (renewal.renewalKind !== "PRESENTATION_ONLY") problems.push("Presentation renewal is not a PRESENTATION_ONLY admission");
  if (typeof renewal.rationale !== "string" || renewal.rationale.trim().length === 0) problems.push("Presentation renewal lacks a recorded author rationale");

  // Bound to the exact integration commit: recorded, and reachable from HEAD.
  if (!EXACT_GIT_HEAD.test(str(renewal.integrationCommit))) problems.push("Presentation renewal integration commit is not an exact Git head");
  else if (!options.integrationCommitReachable) problems.push("Presentation renewal integration commit is not part of the integration history");

  // Linked to the preserved production receipt WITHOUT touching it.
  if (renewal.baselineReceiptPath !== options.receiptPath) problems.push("Presentation renewal is not linked to the receipt under validation");
  if (!EXACT_SHA256.test(str(renewal.baselineReceiptSha256))) problems.push("Presentation renewal baseline receipt hash is not a sanitized SHA-256");
  else if (renewal.baselineReceiptSha256 !== options.receiptSha256) problems.push("Presentation renewal does not bind the exact preserved production receipt bytes");

  // The full behavior-class set must be attested unchanged.
  const attested = new Set(Array.isArray(renewal.unchangedBehavior) ? renewal.unchangedBehavior : []);
  for (const behavior of RENEWAL_BEHAVIORS) if (!attested.has(behavior)) problems.push(`Presentation renewal does not attest unchanged ${behavior} behavior`);

  // Fresh focused browser verification, bound to the same integration commit —
  // and PRESERVED as recorded, never recomputed here.
  const browser = renewal.browserVerification;
  if (!browser || !Array.isArray(browser.surfaces) || browser.surfaces.length === 0) problems.push("Presentation renewal lacks focused browser verification of the affected reader surfaces");
  else {
    if (browser.head !== renewal.integrationCommit) problems.push("Presentation renewal browser verification head is not the recorded integration commit");
    for (const surface of browser.surfaces) if (surface.result !== "RENDERED_AS_EXPECTED") problems.push(`Presentation renewal browser verification did not confirm ${str(surface.surface) || "an affected surface"}`);
  }

  const baseline = new Map(receiptSourceHashes.map((source) => [source.path, source.sha256]));
  for (const file of Array.isArray(renewal.permittedFiles) ? renewal.permittedFiles : []) {
    const original = baseline.get(file.path);
    if (original === undefined) { problems.push(`${file.path}: presentation renewal names a file absent from the production receipt fingerprint`); continue; }
    if (file.baselineSha256 !== original) { problems.push(`${file.path}: presentation renewal baseline does not match the preserved production fingerprint`); continue; }
    if (!RENEWAL_KINDS.includes(file.kind)) { problems.push(`${file.path}: presentation renewal kind is not a presentation class`); continue; }
    if (typeof file.behaviorReview !== "string" || file.behaviorReview.trim().length === 0) { problems.push(`${file.path}: presentation renewal lacks a per-file behavior review`); continue; }
    let currentSha: string | null = null;
    try { currentSha = existsSync(join(root, file.path)) ? sha256(readFileSync(join(root, file.path))) : null; } catch { currentSha = null; }
    if (currentSha === null) { problems.push(`${file.path}: presentation-renewed file is missing`); continue; }
    if (currentSha !== file.renewedSha256) { problems.push(`${file.path}: presentation renewal renewed fingerprint does not match the current bytes`); continue; }
    if (file.renewedSha256 === file.baselineSha256) { problems.push(`${file.path}: presentation renewal lists an unchanged file`); continue; }
    admittedPaths.add(file.path);
  }

  // NEGATIVE CHECK — the focused rejection of anything outside the permitted
  // scope: every reader dependency that actually changed must be an admitted
  // presentation file, or it remains a hard "changed after proof" failure.
  for (const source of receiptSourceHashes) {
    if (skip.has(source.path)) continue;
    let changed: boolean;
    try { changed = !existsSync(join(root, source.path)) || sha256(readFileSync(join(root, source.path))) !== source.sha256; } catch { changed = true; }
    if (changed && !admittedPaths.has(source.path)) problems.push(`Reader dependency changed outside the permitted presentation renewal: ${source.path}`);
  }

  return { admittedPaths, problems: uniq(problems) };
}

/**
 * The lightweight consistency check the preflight runs (and the tests reuse).
 *
 * It VERIFIES the recorded artifact against the candidate tree — the receipt
 * bindings, the renewed file bytes, and the integration commit's ancestry of the
 * checkout — reusing the pure validator above. It never regenerates the artifact
 * or manufactures a new browser execution, so a later evidence/documentation
 * commit or a GitHub-style merge, with the bound files unchanged, still passes.
 *
 * A repository with no renewal artifact has nothing to verify and returns clean.
 */
export function renewalConsistencyProblems(
  root: string,
  options: { readonly renewalPath?: string; readonly headRef?: string } = {},
): string[] {
  const renewalPath = options.renewalPath ?? READER_PRESENTATION_RENEWAL_PATH;
  if (!existsSync(join(root, renewalPath))) return [];
  let renewal: ReaderPresentationRenewal;
  try {
    renewal = JSON.parse(readFileSync(join(root, renewalPath), "utf8")) as ReaderPresentationRenewal;
  } catch (error) {
    return [`${renewalPath} is not readable JSON (${(error as Error)?.message ?? "error"})`];
  }
  const receiptPath = str(renewal.baselineReceiptPath);
  if (!receiptPath || !existsSync(join(root, receiptPath))) return [`${renewalPath} names a missing or empty baseline receipt path`];
  let receiptBytes: Buffer;
  let sourceHashes: readonly ReaderRenewalSourceHash[];
  try {
    receiptBytes = readFileSync(join(root, receiptPath));
    const parsed = JSON.parse(receiptBytes.toString("utf8")) as { sourceHashes?: readonly ReaderRenewalSourceHash[] };
    sourceHashes = Array.isArray(parsed.sourceHashes) ? parsed.sourceHashes : [];
  } catch (error) {
    return [`${receiptPath} is not readable JSON (${(error as Error)?.message ?? "error"})`];
  }
  const descendant = options.headRef ?? headSha(root) ?? "HEAD";
  const integrationCommitReachable = EXACT_GIT_HEAD.test(str(renewal.integrationCommit))
    ? containsCommit(renewal.integrationCommit, descendant, root)
    : false;
  return readerPresentationRenewalProblems(root, sourceHashes, renewal, {
    receiptPath,
    receiptSha256: sha256(receiptBytes),
    integrationCommitReachable,
  }).problems;
}
