import { readFileSync } from "node:fs";
import { join } from "node:path";

import { BALLOT_SOURCES } from "../ballot/registry.ts";
import { contestsForDivisions } from "../sources/ballot-nj-morris/index.ts";
import { lineupForContest } from "../ballot/general-lineup.ts";
import { summaryForContest } from "../ballot/measure-summaries.ts";
import { provisionsForContest } from "../ballot/measure-provisions.ts";
import { positionsFor } from "../candidates/positions.ts";
import { ROSTER_FILES } from "../coverage/artifacts.ts";
import type { BallotAbsence, BallotSet, Contest } from "../ballot/types.ts";

/**
 * **THE SERVER-SIDE READS ASK NEEDS, IN ONE PLACE.**
 * (PR #212 follow-up, 2026-08-28.)
 *
 * `app/api/ask/grounded/route.ts` is the pipeline and this is what it reads
 * from. Split out for two reasons that are both about not duplicating truth:
 *
 * 1. **The ballot is loaded exactly the way `/ballot` loads it** — the same
 *    `BALLOT_SOURCES` registry, the same `contestsForDivisions` filter, the
 *    same committed files. Ask does not hold a copy of ballot truth and cannot
 *    drift from the page that renders it.
 * 2. **A route file that also holds loaders is a route file nothing can test
 *    without standing up a request.** These are ordinary functions.
 *
 * Every read here degrades to EMPTY rather than throwing. An unavailable
 * committed file is a real state and the pipeline reports it as an honest gap;
 * a 500 would take a correct meetings answer down over a ballot file.
 */

export interface BallotForDivisions {
  set: BallotSet | null;
  contests: Contest[];
  absences: BallotAbsence[];
  nominees: (contestId: string) => readonly { name: string; partyLabel?: string | null }[];
  positions: (targetKey: string) => readonly {
    issueLabel: string;
    quote: string;
    documentUrl: string;
    retrievedAt: string;
  }[];
  measureSummary: (contestId: string) => { summary: string; summarizesUrl: string } | null;
  measureProvisions: (contestId: string) => readonly {
    id: string;
    label: string;
    what: string;
    citesUrl: string;
  }[];
}

const EMPTY: BallotForDivisions = {
  set: null,
  contests: [],
  absences: [],
  nominees: () => [],
  positions: () => [],
  measureSummary: () => null,
  measureProvisions: () => [],
};

/**
 * The reader's own ballot, matched to their divisions.
 *
 * The loop is `/ballot`'s: ask each source, take the first that matches
 * anything. A source whose contests touch none of these divisions contributes
 * nothing, which is what makes looping all three safe for a reader near a state
 * line.
 */
export async function loadBallotForDivisions(
  ocdIds: readonly string[],
): Promise<BallotForDivisions> {
  if (ocdIds.length === 0) return EMPTY;
  for (const { source } of BALLOT_SOURCES) {
    try {
      const candidate = source.normalize(await source.fetch());
      const hit = contestsForDivisions(candidate, ocdIds);
      if (hit.contests.length === 0 && hit.absences.length === 0) continue;
      return {
        set: candidate,
        contests: hit.contests,
        absences: hit.absences,
        nominees: (contestId) => lineupForContest(contestId)?.nominees ?? [],
        positions: sourcedPositions,
        measureSummary: (contestId) => {
          const summary = summaryForContest(contestId);
          return summary
            ? { summary: summary.summary, summarizesUrl: summary.summarizesUrl }
            : null;
        },
        measureProvisions: (contestId) =>
          provisionsForContest(contestId).map((p) => ({
            id: p.id,
            label: p.label,
            what: p.what,
            citesUrl: p.citesUrl,
          })),
      };
    } catch {
      /* A source that cannot be read contributes nothing and the next is
         tried. Never a fabricated ballot, and never a 500 for the reader. */
    }
  }
  return EMPTY;
}

/**
 * **A POSITION IS A QUOTE WITH A URL, OR IT IS NOT A POSITION.**
 *
 * Only `MATCHED` answers are returned, and only their verbatim passages. A
 * `SEARCHED_NOTHING_MATCHED` answer is real and useful on the ballot card,
 * where it renders as *what we searched and did not find* — but as an evidence
 * record it would be a row with no statement in it, and the synthesis rung
 * given a row with no statement will describe the absence as though it were
 * one. The named gap in the route says that instead, once, correctly.
 */
function sourcedPositions(targetKey: string) {
  try {
    return positionsFor(targetKey).flatMap((position) =>
      position.answer.kind === "MATCHED"
        ? position.answer.passages.map((passage) => ({
            issueLabel: position.issue.label,
            quote: passage.quote,
            documentUrl: passage.documentUrl,
            retrievedAt: passage.retrievedAt,
          }))
        : [],
    );
  } catch {
    return [];
  }
}

/**
 * The legislators whose districts the reader's divisions actually name.
 *
 * **Selected by DIVISION ID, never by state.** A reader in Arizona has two
 * state senators near them and exactly one who represents the district they are
 * standing in; handing them the state's whole roster and calling it "your
 * senator" would be a false relationship for 29 of 30. The `sldu:`/`sldl:` ids
 * in their own division list are what the geometry already resolved.
 *
 * Congressional and federal rows are deliberately not included: the ballot and
 * the who-governs card already carry them with their own provenance, and an Ask
 * answer about a school board agenda listing a U.S. senator would be a contact
 * with no relationship to the question.
 */
export function readerRepresentatives(ocdIds: readonly string[]): {
  id: string;
  name: string;
  officeTitle: string;
  email: string | null;
  phone: string | null;
  websiteUrl: string | null;
  sourceUrl: string | null;
  sourceOrg: string | null;
  collectedAt: string | null;
}[] {
  const wanted = new Set(ocdIds.filter((id) => /\/(sldu|sldl):/.test(id)));
  if (wanted.size === 0) return [];

  const out: ReturnType<typeof readerRepresentatives> = [];
  const seen = new Set<string>();

  for (const file of ROSTER_FILES) {
    /* The federal roster is keyed on bare state ids and carries no
       `sldu:`/`sldl:` links, so it contributes nothing here and is skipped
       rather than read and discarded. */
    if (file === "officeholders-us.json") continue;
    const set = readRoster(file);
    if (!set) continue;
    const byId = new Map(set.officeholders.map((o) => [o.id, o]));
    for (const link of set.divisions) {
      if (!wanted.has(link.ocdId)) continue;
      const person = byId.get(link.officeholderId);
      if (!person || seen.has(person.id)) continue;
      seen.add(person.id);
      out.push({
        id: person.id,
        name: person.name,
        officeTitle: person.officeTitle,
        email: person.email ?? null,
        phone: person.phone ?? null,
        websiteUrl: person.websiteUrl ?? null,
        sourceUrl: person.provenance?.sourceUrl ?? null,
        sourceOrg: person.provenance?.sourceOrg ?? null,
        collectedAt: person.provenance?.collectedAt ?? null,
      });
    }
  }
  return out;
}

interface RosterFile {
  officeholders: {
    id: string;
    name: string;
    officeTitle: string;
    email?: string | null;
    phone?: string | null;
    websiteUrl?: string | null;
    provenance?: { sourceUrl?: string | null; sourceOrg?: string | null; collectedAt?: string | null } | null;
  }[];
  divisions: { ocdId: string; officeholderId: string }[];
}

const rosterCache = new Map<string, RosterFile | null>();

/**
 * One roster file, cached per process.
 *
 * Read through `process.cwd()` like every other committed artifact, which is
 * why `/api/ask/grounded` names `./lib/registry/*.json` in
 * `outputFileTracingIncludes` — a file reached this way is absent from a
 * serverless bundle unless the tracer is told, and an absent roster would
 * render as "we have not recorded who represents you", which is
 * indistinguishable from honest missing data.
 */
function readRoster(name: string): RosterFile | null {
  if (rosterCache.has(name)) return rosterCache.get(name) ?? null;
  let parsed: RosterFile | null = null;
  try {
    parsed = JSON.parse(
      readFileSync(join(process.cwd(), "lib", "registry", name), "utf8"),
    ) as RosterFile;
  } catch {
    parsed = null;
  }
  rosterCache.set(name, parsed);
  return parsed;
}
