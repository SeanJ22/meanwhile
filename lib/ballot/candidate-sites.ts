import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Hunted-and-verified links for ballot candidates (session 2026-08-16, 2b).
 *
 * The filing's own `websiteUrl` field stays what it always was — a URL the
 * candidate stated IN the filing, carried verbatim. This module is the other
 * thing: links we went and FOUND, each verified by fetching it and reading
 * the page. The two are kept apart because they are different claims with
 * different provenance.
 *
 * Shape rules, from the brief:
 * - campaign site AND official site where the person holds office;
 * - both labeled, official primary;
 * - a URL recorded here MUST have been fetched and verified — a 404 or a
 *   generic landing is a MISS and belongs in the hunt log, never here;
 * - a candidate without a found site gets a recorded hunt in
 *   `data/ballot/candidate-links-2026.json`'s `hunts` array, not a blank.
 *
 * Keys: the candidacy id for filed candidates, or `<contestId>|<name>` for
 * certified-lineup nominees (who exist only as canvass names).
 */

export interface VerifiedLink {
  url: string;
  /** What the fetched page showed — the person and the race/office, named. */
  verification: string;
  attemptedAt: string;
}

export interface CandidateLinks {
  /** The person's page in the office they currently hold, if any. */
  official: VerifiedLink | null;
  /** The campaign site. Rendered labeled, after the official link. */
  campaign: VerifiedLink | null;
}

export interface RecordedHunt {
  key: string;
  name: string;
  /** What was searched and what came back — the honest miss. */
  note: string;
  attemptedAt: string;
}

interface CandidateLinksFile {
  curatedAt: string;
  note: string;
  links: Record<string, CandidateLinks>;
  hunts: RecordedHunt[];
}

let cache: CandidateLinksFile | null = null;

function load(): CandidateLinksFile {
  if (!cache) {
    cache = JSON.parse(
      readFileSync(
        join(process.cwd(), "data", "ballot", "candidate-links-2026.json"),
        "utf8",
      ),
    ) as CandidateLinksFile;
  }
  return cache;
}

export function linksForCandidacy(candidacyId: string): CandidateLinks | null {
  return load().links[candidacyId] ?? null;
}

export function linksForNominee(
  contestId: string,
  name: string,
): CandidateLinks | null {
  return load().links[`${contestId}|${name}`] ?? null;
}

export function allCandidateLinks(): CandidateLinksFile {
  return load();
}
