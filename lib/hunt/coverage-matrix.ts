/**
 * **THE COVERAGE MATRIX — one row per candidate, one column per fact, every
 * cell a STATE with its provenance.** (2026-08-25, Item 12; governed by
 * RULING 149.)
 *
 * ## Why this module exists rather than a second script
 *
 * `pnpm kelly` already answers "is this candidate done", and the brief is
 * explicit that the matrix's Kelly verdict must equal `pnpm kelly` EXACTLY. Two
 * programs computing one judgement is the thing that can disagree — RULING 103,
 * and `kellyFieldHeld`'s own note records that two such implementations already
 * did disagree once in this repo.
 *
 * So the loading and the row-building live HERE, and BOTH the scoreboard and
 * the matrix call them. They cannot drift, because there is nothing to drift
 * from: the matrix's `kellyVerdict` column is the scoreboard's `done` field,
 * not a recomputation of it.
 *
 * ## Cell states, and why none of them is a boolean
 *
 * A boolean can say "we have it" and "we do not", and this project needs to
 * tell apart at least seven things that all look like "we do not":
 *
 * - `HELD` — the fact is on the record and renders.
 * - `ABSENT` — an ARGUED absence: a five-move stuck protocol under RULING 94,
 *   dated, carrying an expiry, and linked to the walls it was built on where
 *   RULING 144 applies. It is a measurement with a shelf life.
 * - `OWED` — nobody has established anything. This is OUR gap and it reads as
 *   one.
 * - `LEAD` — something was found and its citation is not confirmed. RULING 87:
 *   Wikipedia names the person, the citation proves them, and an unconfirmed
 *   lead is never a `HELD`.
 * - `REFUSED` — a host said no, with the reason. A wall is a fact about a
 *   route, never about a candidate (RULING 90 item 4).
 * - `PENDING_REVIEW` — held, decoded, staged, and waiting on the author. A
 *   portrait in his queue is not a portrait a reader can see.
 * - `N/A` — structurally inapplicable, with the reason. A challenger has no
 *   voting record, and that is not a gap.
 *
 * **`OWED` and `ABSENT` collapsing into one number is the thing this instrument
 * exists to prevent** — it is the three-way split of RULING 105, widened.
 *
 * ## It reads the stores and adds nothing to them
 *
 * RULING 149. The collection minimum is untouched: an instrument that had to
 * collect something in order to measure would have changed the thing it
 * measures. Every value here comes from a committed artifact.
 */

import { existsSync, readFileSync } from "node:fs";
import { ballotPath } from "../holdings/files.ts";
import { join } from "node:path";
import { DEFAULT_SOCIAL_PLATFORMS } from "../officials/social-platforms.ts";

import {
  KELLY_FIELDS,
  absenceStands,
  kellyFieldHeld,
  type ArguedAbsence,
  type FieldState,
  type KellyField,
  type KellyReading,
} from "./kelly-depth.ts";

/* -------------------------------------------------------------- the ballots */

/**
 * Which ballot, by zip. Moved here from `scripts/kelly-scoreboard.mts` so the
 * matrix and the scoreboard cannot disagree about which file a zip means.
 */
export const BALLOTS: Record<
  string,
  { file: string; label: string; contacts?: string }
> = {
  "07866": {
    file: "nj-morris-2026.json",
    label: "07866 (Morris County, New Jersey)",
    contacts: "nj-morris-2026-contacts.json",
  },
  "03255": {
    file: "nh-merrimack-2026.json",
    label: "03255 (Merrimack County, New Hampshire)",
  },
};

export interface Candidacy {
  id: string;
  contestId: string;
  familyName: string;
  givenName: string;
  partyLabel?: string | null;
  incumbent?: boolean | null;
}

export interface CandidateCard {
  photoUrl?: string | null;
  phone?: string | null;
  email?: string | null;
  /* The candidate's own words, with the source class the blurb rule requires. */
  bio?: string | null;
  bioSourceUrl?: string | null;
  bioSourceLabel?: string | null;
}

export interface KellyInputs {
  zip: string;
  label: string;
  contests: { id: string; title: string }[];
  candidacies: Candidacy[];
  cards: Record<string, CandidateCard>;
  links: Record<string, { official?: { url: string }; campaign?: { url: string } }>;
  filedEmail: Map<string, string | null>;
  absenceFor: Map<string, ArguedAbsence>;
  absenceCount: number;
  photoOnDisk: (url: string) => boolean;
}

function readJson<T>(path: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return fallback;
  }
}

/** Every committed artifact a Kelly reading needs, loaded once. */
export function loadKellyInputs(root: string, zip: string): KellyInputs {
  const chosen = BALLOTS[zip];
  if (!chosen) throw new Error(`no ballot registered for ${zip}`);

  const ballot = readJson<{
    contests: { id: string; title: string }[];
    candidacies: Candidacy[];
  }>(join(root, ballotPath(chosen.file)), { contests: [], candidacies: [] });

  const cards = readJson<{ cards: Record<string, CandidateCard> }>(
    join(root, "data", "ballot", "candidate-cards-2026.json"),
    { cards: {} },
  ).cards;

  const links = readJson<{
    links: Record<string, { official?: { url: string }; campaign?: { url: string } }>;
  }>(join(root, "data", "ballot", "candidate-links-2026.json"), { links: {} }).links;

  /* A contacts file is a per-zip artifact and not every zip has one; where it
     is absent the card is the only source, which is a smaller claim honestly
     made rather than a guessed one. */
  const contactsPath = chosen.contacts
    ? join(root, ballotPath(chosen.contacts))
    : null;
  const filedEmail = new Map<string, string | null>(
    contactsPath && existsSync(contactsPath)
      ? readJson<{ contacts: { candidacyId: string; email?: string | null }[] }>(
          contactsPath,
          { contacts: [] },
        ).contacts.map((c) => [c.candidacyId, c.email ?? null])
      : [],
  );

  const absences = readJson<{ rows: ArguedAbsence[] }>(
    join(root, "data", "hunt", `argued-absences-${zip}.json`),
    { rows: [] },
  ).rows;
  const absenceFor = new Map<string, ArguedAbsence>();
  for (const a of absences) absenceFor.set(`${a.candidacyId}|${a.field}`, a);

  return {
    zip,
    label: chosen.label,
    contests: ballot.contests,
    candidacies: ballot.candidacies,
    cards,
    links,
    filedEmail,
    absenceFor,
    absenceCount: absences.length,
    photoOnDisk: (url) => existsSync(join(root, "public", url.replace(/^\//, ""))),
  };
}

/**
 * The Kelly reading for every candidate on a ballot.
 *
 * **This is the scoreboard's own loop, moved here verbatim.** `pnpm kelly` and
 * `pnpm matrix` call it, so the matrix's Kelly verdict IS the scoreboard's
 * answer rather than an agreement between two of them.
 */
export function kellyRows(inputs: KellyInputs, today: string): KellyReading[] {
  const rows: KellyReading[] = [];
  for (const c of inputs.candidacies) {
    const fields = {} as Record<KellyField, FieldState>;
    const owed: KellyField[] = [];
    for (const f of KELLY_FIELDS) {
      const h = kellyFieldHeld(f, {
        card: inputs.cards[c.id],
        links: inputs.links[c.id],
        filedEmail: inputs.filedEmail.get(c.id) ?? null,
        photoOnDisk: inputs.photoOnDisk,
      });
      if (h.yes) {
        fields[f] = { state: "HELD", evidence: h.evidence };
        continue;
      }
      const a = inputs.absenceFor.get(`${c.id}|${f}`);
      if (a) {
        const verdict = absenceStands(a, today);
        if (verdict.stands) {
          fields[f] = { state: "ARGUED_ABSENT", at: a.at, expiresOn: a.expiresOn };
          continue;
        }
        fields[f] = { state: "OWED", why: verdict.why };
        owed.push(f);
        continue;
      }
      fields[f] = { state: "OWED", why: h.evidence };
      owed.push(f);
    }
    rows.push({
      candacyId: c.id,
      subject: `${c.givenName} ${c.familyName}`.replace(/\s+/g, " ").trim(),
      contestId: c.contestId,
      fields,
      done: owed.length === 0,
      owed,
    });
  }
  return rows;
}

/* --------------------------------------------------------------- the matrix */

export const CELL_STATES = [
  "HELD",
  "ABSENT",
  "OWED",
  "LEAD",
  "REFUSED",
  "PENDING_REVIEW",
  "N/A",
] as const;
export type CellState = (typeof CELL_STATES)[number];

export interface Cell {
  state: CellState;
  /** Where the value came from, or what was walked. Never empty. */
  source: string;
  /** The date this cell was last established. Never invented. */
  date: string;
  /** For ABSENT: when it stops standing. */
  expiresOn?: string;
  /** For ABSENT built on walls (RULING 144): which walls, so it can expire early. */
  walls?: string[];
  /** For REFUSED and N/A: why. */
  reason?: string;
}

/** The social platforms a campaign presence is looked for on (RULING 145). */
export const SOCIAL_PLATFORMS = [...DEFAULT_SOCIAL_PLATFORMS.map((p) => p.id), "other"] as const;
export type SocialPlatform = string;

export interface MatrixRow {
  /* identity */
  candidacyId: string;
  name: string;
  contestId: string;
  contestTitle: string;
  district: string;
  party: string;
  incumbent: boolean;
  zip: string;
  cycle: string;
  /* every measured fact */
  cells: Record<string, Cell>;
  /* computed */
  kellyVerdict: "DONE" | "OWED";
  kellyOwed: string[];
}

/** The column order the CSV is written in. One place, so the header cannot drift. */
export const MATRIX_COLUMNS = [
  // Kelly
  "photo",
  "phone",
  "contact",
  "verifiedPage",
  "campaignSite",
  // social, per platform (RULING 145)
  ...SOCIAL_PLATFORMS.map((p) => `social.${p}`),
  // beyond Kelly
  "ownWords",
  "slogan",
  "campaignMoney",
  "votingRecord",
  "committees",
  // the questionnaire, shipped empty (RULING 112)
  "questionnaire.invited",
  "questionnaire.reminded",
  "questionnaire.responded",
  "questionnaire.declined",
  "questionnaire.bounced",
] as const;

/**
 * A Kelly `FieldState` becomes a matrix `Cell`.
 *
 * The mapping is deliberately NOT one-to-one: Kelly's `ARGUED_ABSENT` is the
 * matrix's `ABSENT`, and the matrix has states Kelly has no use for. Doing this
 * in one function means the two vocabularies are related in exactly one place.
 */
export function cellFromKelly(field: KellyField, state: FieldState, fallbackDate: string): Cell {
  if (state.state === "HELD") {
    return { state: "HELD", source: state.evidence, date: fallbackDate };
  }
  if (state.state === "ARGUED_ABSENT") {
    return {
      state: "ABSENT",
      source: `argued absence, RULING 94 protocol on file for ${field}`,
      date: state.at,
      expiresOn: state.expiresOn,
    };
  }
  return { state: "OWED", source: state.why, date: fallbackDate };
}

/**
 * **THE CONTEST ASYMMETRY FLAG.**
 *
 * The equal-effort rule is a HUNT discipline and it has never had an
 * instrument. This is one: within a single contest, how far apart are the
 * best-covered and worst-covered candidates, counted in HELD cells?
 *
 * It is a flag on a CONTEST and never on a candidate — a per-candidate
 * completeness number is the composite score this product does not compute, and
 * RULING 149 is why this artifact never reaches a reader at all.
 *
 * The threshold is STATED rather than tuned: a contest where one candidate has
 * three more established facts than another is a contest worth looking at.
 */
export const ASYMMETRY_THRESHOLD = 3;

export interface AsymmetryFlag {
  contestId: string;
  contestTitle: string;
  best: { name: string; held: number };
  worst: { name: string; held: number };
  spread: number;
}

export function asymmetryFlags(rows: MatrixRow[]): AsymmetryFlag[] {
  const byContest = new Map<string, MatrixRow[]>();
  for (const row of rows) {
    const list = byContest.get(row.contestId) ?? [];
    list.push(row);
    byContest.set(row.contestId, list);
  }

  const flags: AsymmetryFlag[] = [];
  for (const [contestId, list] of byContest) {
    // A contest with one candidate cannot be asymmetric between candidates.
    if (list.length < 2) continue;
    const counted = list.map((row) => ({
      name: row.name,
      held: Object.values(row.cells).filter((c) => c.state === "HELD").length,
    }));
    counted.sort((a, b) => b.held - a.held);
    const best = counted[0];
    const worst = counted[counted.length - 1];
    const spread = best.held - worst.held;
    if (spread >= ASYMMETRY_THRESHOLD) {
      flags.push({
        contestId,
        contestTitle: list[0].contestTitle,
        best,
        worst,
        spread,
      });
    }
  }
  return flags.sort((a, b) => b.spread - a.spread);
}

/** Every cell state, counted, per column. The census RULING 105 asks for. */
export function cellCensus(rows: MatrixRow[]): Record<string, Record<CellState, number>> {
  const out: Record<string, Record<CellState, number>> = {};
  for (const column of MATRIX_COLUMNS) {
    const counts = Object.fromEntries(CELL_STATES.map((s) => [s, 0])) as Record<CellState, number>;
    for (const row of rows) {
      const cell = row.cells[column];
      if (cell) counts[cell.state] += 1;
    }
    out[column] = counts;
  }
  return out;
}
