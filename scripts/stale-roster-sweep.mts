/**
 * `pnpm roster:stale` — **THE CERTIFIED RECORD AGAINST THE ENCYCLOPEDIA.**
 * (`NH73`, built 2026-08-24.)
 *
 * ## The named instance this sweeps for
 *
 * Wikipedia's Denville Township article listed Angela Cote and Christopher
 * Golinski on the council. The Morris County Clerk's certified 2025 winners
 * name **Adrienne Zimmermann and Mark Venis** in those seats, and the
 * township's own council page confirms Zimmermann and Venis and does not name
 * Cote or Golinski.
 *
 * That is RULING 87 working exactly as written: the encyclopedia NAMED, the
 * primary source PROVED, and the primary source disagreed. What was owed is
 * the SWEEP — because a defect found by name is the start of a class sweep and
 * never the end of one, and one stale article is very unlikely to be the only
 * stale article.
 *
 * ## What it compares, and what a hit actually means
 *
 * For each Morris municipality it reads the certified winners this project
 * already holds and the roster it holds, and reports:
 *
 * - **CONFIRMED** — a certified winner who appears in our roster.
 * - **MISSING** — a certified winner our roster does not carry. This is the
 *   Denville shape and it is the finding.
 * - **UNCERTIFIED** — somebody in our roster with no certified win in the
 *   cycles held. **This is NOT automatically an error**, and saying so is the
 *   whole of the honesty here: a member may hold a seat from an earlier cycle,
 *   may have been appointed to fill a vacancy, or may sit in a seat that was
 *   not on the 2025 ballot at all. It is a QUESTION, not a verdict.
 *
 * ## Why a name comparison is a LEAD and not proof
 *
 * Names are the only key these two sides share, and this project's own rule is
 * that a join on names always drops rows (RULING 111). "Thomas J. Haynes III"
 * and "Tom Haynes" are one person; "Arnie Davis" and "Erica Davis" are two.
 * So this normalises hard and still reports its matches as CANDIDATES for a
 * person to confirm. **It changes no data.** It produces a work list.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { BODY_ROSTERS } from "../lib/registry/body-rosters.ts";

const ROOT = process.cwd();

interface Winner {
  cycle: string;
  municipality: string | null;
  office: string;
  seat: string | null;
  name: string;
  party: string | null;
}

const certified = JSON.parse(
  readFileSync(join(ROOT, "data", "hunt", "nj-morris-certified-winners.json"), "utf8"),
) as { winners: Winner[]; walkedAt: string; documents?: unknown[] };

/**
 * Normalise a person's name to its comparable core.
 *
 * Generational suffixes go — and that is the `NH-III` lesson (RULING 103):
 * three copies of an initials function each took the LAST token, so
 * "Thomas J. Haynes III" rendered as "TI". A suffix is not a surname.
 */
const key = (name: string): string =>
  name
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\b(JR|SR|II|III|IV|V)\b\.?/g, "")
    .replace(/[^A-Z ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** First + last, so a middle initial on one side does not break the match. */
const ends = (name: string): string => {
  const parts = key(name).split(" ").filter(Boolean);
  if (parts.length < 2) return key(name);
  return `${parts[0]} ${parts[parts.length - 1]}`;
};

const municipalWinners = certified.winners.filter(
  (w) => w.municipality !== null && !/^(GOVERNOR|SENATE|ASSEMBLY|SHERIFF|SURROGATE|COMMISSIONER)$/i.test(w.office),
);

console.log("STALE-ROSTER SWEEP — the certified record against what we hold (NH73)");
console.log(`  certified winners in file:      ${certified.winners.length}`);
console.log(`  of those, MUNICIPAL:            ${municipalWinners.length}`);
console.log(`  certified record walked:        ${certified.walkedAt}`);

/* Everyone this project holds on a Morris body roster, by name key. */
const held = new Map<string, string[]>();
let rosterPeople = 0;
/*
 * `BODY_ROSTERS` is a LIST of bodies, each with its own `members` — not a map
 * of body id to holders. Reading it the other way throws rather than silently
 * counting zero, which is the good direction: a sweep that found nobody would
 * have reported every certified winner as MISSING and read like a catastrophe.
 */
for (const body of BODY_ROSTERS as unknown as {
  bodyId: string;
  members?: { name?: string }[];
}[]) {
  for (const member of body.members ?? []) {
    if (!member?.name) continue;
    rosterPeople += 1;
    const k = ends(member.name);
    held.set(k, [...(held.get(k) ?? []), body.bodyId]);
  }
}
console.log(`  people on rosters we hold:      ${rosterPeople}`);

if (municipalWinners.length === 0 || rosterPeople === 0) {
  console.error(
    "REFUSED: one side of the comparison is empty, so a clean result here would " +
      "mean nothing. A zero-row read is a failed read, never a clean board.",
  );
  process.exit(1);
}

/**
 * **WHICH MUNICIPALITIES DO WE HOLD A ROSTER FOR AT ALL?**
 *
 * This is the split that makes the sweep worth reading, and the first version
 * did not have it. Denville's four "missing" winners looked like a stale
 * roster — the exact shape `NH73` was opened over — and they are not: **this
 * project holds no Denville roster whatsoever.** Zimmermann, Venis and Cote are
 * absent because there is nothing there, not because what is there is wrong.
 *
 * Those two findings demand opposite responses. A stale roster is a
 * CORRECTNESS defect: we are showing a reader a name that is not in the seat.
 * A missing roster is a COVERAGE gap: we are showing them nothing. Reporting
 * them as one number would be RULING 105's failure — a bare count with no way
 * to tell what we decided not to cover from what we failed to reach.
 */
const municipalitiesWeHold = new Set<string>();
for (const body of BODY_ROSTERS as unknown as { bodyId: string }[]) {
  const m = /place:([a-z_]+)/.exec(body.bodyId)?.[1];
  if (m) municipalitiesWeHold.add(m.replace(/_/g, " ").toUpperCase());
}
const weHoldSomethingFor = (municipality: string | null): boolean => {
  if (!municipality) return false;
  const norm = municipality.toUpperCase().replace(/\s+(TOWNSHIP|BOROUGH|TOWN|CITY)$/i, "").trim();
  return [...municipalitiesWeHold].some((h) => h.includes(norm) || norm.includes(h));
};

const confirmed: Winner[] = [];
const possiblyStale: Winner[] = [];
const noRosterHeld: Winner[] = [];
for (const w of municipalWinners) {
  if (held.has(ends(w.name))) confirmed.push(w);
  else if (weHoldSomethingFor(w.municipality)) possiblyStale.push(w);
  else noRosterHeld.push(w);
}

console.log("");
console.log("  CERTIFIED WINNERS AGAINST OUR ROSTERS — a THREE-WAY split (RULING 105)");
console.log(
  `    CONFIRMED       we carry this person:            ${confirmed.length} of ${municipalWinners.length}`,
);
console.log(
  `    POSSIBLY STALE  we hold a roster and NOT them:   ${possiblyStale.length} of ${municipalWinners.length}   <-- the NH73 shape`,
);
console.log(
  `    NO ROSTER HELD  we carry nothing for that place: ${noRosterHeld.length} of ${municipalWinners.length}   (a COVERAGE gap, not a stale roster)`,
);
console.log(
  `    ${confirmed.length} + ${possiblyStale.length} + ${noRosterHeld.length} = ${confirmed.length + possiblyStale.length + noRosterHeld.length}`,
);
if (confirmed.length + possiblyStale.length + noRosterHeld.length !== municipalWinners.length) {
  console.error("REFUSED: the three sides do not partition the certified set.");
  process.exit(1);
}

const byMunicipality = new Map<string, Winner[]>();
for (const w of possiblyStale) {
  const m = w.municipality ?? "(none)";
  byMunicipality.set(m, [...(byMunicipality.get(m) ?? []), w]);
}

console.log("");
console.log(
  "  POSSIBLY STALE, by municipality — we hold a roster for this place and it does",
);
console.log("  NOT name this certified winner. Each is a CANDIDATE for review, never a verdict:");
if (byMunicipality.size === 0) {
  console.log("    none — every place we hold a roster for names its certified winners.");
}
for (const [m, ws] of [...byMunicipality].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`    ${String(ws.length).padStart(3)}  ${m}`);
  for (const w of ws) {
    console.log(`         ${w.name} — ${w.office ?? "office not extracted"}${w.seat ? ` (${w.seat})` : ""} ${w.cycle}`);
  }
}

/*
 * **THE DARK PLACES ARE NAMED, NOT COUNTED.** (2026-08-24, the NJ depth session.)
 *
 * The sweep printed the possibly-stale winners by municipality and gave the
 * no-roster-held side a single number. RULING 105 asks for three numbers each
 * with its denominator AND names the middle one as the half that keeps a report
 * honest — but a count of 90 with no names is not a work list, and this sweep
 * exists to produce a work list. RULING 57 says the same thing from the other
 * end: *a count is not a name, and a village water district disappears into a
 * statistic the moment it is only counted.*
 */
const darkPlaces = new Map<string, Winner[]>();
for (const w of noRosterHeld) {
  const m = w.municipality ?? "(none)";
  darkPlaces.set(m, [...(darkPlaces.get(m) ?? []), w]);
}
console.log("");
console.log("  NO ROSTER HELD, by municipality — this project carries nothing for this place.");
console.log("  A COVERAGE gap, and the work list for closing it:");
if (darkPlaces.size === 0) {
  console.log("    none — every place with a certified winner has a roster here.");
}
for (const [m, ws] of [...darkPlaces].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`    ${String(ws.length).padStart(3)}  ${m}`);
}
console.log(`    ${darkPlaces.size} municipalit(y|ies) dark, holding ${noRosterHeld.length} certified winner(s)`);

console.log("");
console.log(
  "  Neither column is proof on its own. The certified file covers the cycles it\n" +
    "  covers; a member may hold a seat from an earlier cycle or have been appointed\n" +
    "  to a vacancy; and names are the only shared key, which always drops rows\n" +
    "  (RULING 111). This is a WORK LIST. Nothing here changed any data.",
);
