import { readFileSync } from "node:fs";
import { join } from "node:path";

import { KELLY_FIELDS, statesFor } from "./hunt-state.ts";
import type {
  CandidateHuntFile,
  FieldPresence,
  HuntState,
  KellyField,
  RecordedCandidateHunt,
} from "./hunt-state.ts";

/**
 * The recorded hunt states, read from the committed file (RULING 18, Prompt C
 * item 2).
 *
 * Server-only, because it reads the filesystem. The types and the reconciling
 * logic live in `hunt-state.ts`, which stays client-safe.
 *
 * ## The read that would not have been in the deploy
 *
 * `lib/coverage/zip-tier.ts` built its path in a way Next's tracer could not
 * follow, so the file was absent from the deploy, the read threw, the catch
 * returned null, and every zip would have rendered its honest gap wording. A
 * broken deploy and honest missing data are the same pixels. This read uses
 * the literal-argument shape the tracer DOES follow — the same shape
 * `candidate-cards.ts` uses, whose file is traced into `/ballot` today — and
 * `next.config.ts` names it explicitly as well, because a tracing failure here
 * would silently withhold every contest on the ballot rather than crash.
 *
 * A MISSING FILE IS NOT AN EMPTY ONE. If the read fails, every field reads
 * NOT_HUNTED, which withholds contests — the safe direction. It never reads as
 * a completed hunt.
 */

let cache: CandidateHuntFile | null = null;

function load(): CandidateHuntFile {
  if (!cache) {
    try {
      cache = JSON.parse(
        readFileSync(
          join(process.cwd(), "data", "ballot", "candidate-hunt-state.json"),
          "utf8",
        ),
      ) as CandidateHuntFile;
    } catch {
      // Absence, never an assertion: an unreadable file means nothing is known
      // about any hunt, which withholds. It must never read as "we looked".
      cache = { migratedAt: "", note: "", candidates: {} };
    }
  }
  return cache;
}

export function recordedHuntFor(key: string): RecordedCandidateHunt | undefined {
  return load().candidates[key];
}

/** One candidate's live states, reconciled against what the data holds. */
export function huntStatesFor(
  key: string,
  presence: FieldPresence,
): Record<KellyField, HuntState> {
  return statesFor(presence, recordedHuntFor(key));
}

/** The whole file, for scripts and tests. */
export function allHuntStates(): CandidateHuntFile {
  return load();
}

/** Reset between test cases. */
export function resetHuntStateCache(): void {
  cache = null;
}

export { KELLY_FIELDS };
