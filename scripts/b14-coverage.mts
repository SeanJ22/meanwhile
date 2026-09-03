/**
 * **B14's denominator, measured rather than quoted** — the blurb-equalization
 * hunt's before-and-after instrument.
 *
 * `pnpm b14:coverage`
 *
 * The equal-effort rule turns on one number: how many ballot candidates carry
 * nothing. A hunt that cannot state that number before and after has not
 * measured anything, and a figure carried forward from a prior session's
 * report is a last-known reading rather than a fact.
 *
 * The universe is the ENUMERATED ballot: every filed candidacy in the three
 * curated county files, plus every certified nominee in the Arizona general
 * lineup. Those two are keyed differently (`candidacyId` vs
 * `contestId|name`) and both are the reader's ballot, so both count.
 */
import { readFileSync } from "node:fs";
import { ballotPath } from "../lib/holdings/files.ts";

import { derivedBlurbFor } from "../lib/candidates/blurbs.ts";
import { join } from "node:path";

const ROOT = process.cwd();
const read = (p: string) => JSON.parse(readFileSync(join(ROOT, p), "utf8"));

export interface BallotPerson {
  key: string;
  name: string;
  contestId: string;
  /** The URL the candidate stated IN the filing — a different claim from a
   *  hunted link, and B14 counts it as a link the reader can follow. */
  filedSiteUrl: string | null;
}

export function ballotPeople(): BallotPerson[] {
  const people: BallotPerson[] = [];
  for (const file of [
    "az-pima-2026.json",
    "nh-merrimack-2026.json",
    "nj-morris-2026.json",
  ]) {
    const j = read(ballotPath(file)) as {
      candidacies: Array<{
        id: string;
        contestId: string;
        givenName: string;
        familyName: string;
        websiteUrl: string | null;
      }>;
    };
    for (const c of j.candidacies) {
      people.push({
        key: c.id,
        name: `${c.givenName} ${c.familyName}`,
        contestId: c.contestId,
        filedSiteUrl: c.websiteUrl ?? null,
      });
    }
  }
  const lineup = read("data/states/az/ballot/az-general-lineup-2026.json") as {
    contests: Array<{ contestId: string; nominees: Array<{ name: string }> }>;
  };
  for (const contest of lineup.contests) {
    for (const n of contest.nominees) {
      people.push({
        key: `${contest.contestId}|${n.name}`,
        name: n.name,
        contestId: contest.contestId,
        filedSiteUrl: null,
      });
    }
  }
  return people;
}

export interface B14Coverage {
  total: number;
  /** A curated bio a session hand-read and wrote down. */
  withCuratedBlurb: number;
  /** The campaign's own one-line self-description, from the corpus. */
  withDerivedBlurb: number;
  /** Either — which is what a reader actually sees on the card. */
  withBlurb: number;
  withPhoto: number;
  withContact: number;
  withLink: number;
  /** Carrying none of the four. B14's headline number. */
  bare: number;
  bareKeys: string[];
}

export function measureCoverage(): B14Coverage {
  const cards = (read("data/ballot/candidate-cards-2026.json") as {
    cards: Record<
      string,
      { photoUrl?: string; bio?: string; email?: string | null; phone?: string | null }
    >;
  }).cards;
  const links = (read("data/ballot/candidate-links-2026.json") as {
    links: Record<string, { official: unknown; campaign: unknown }>;
  }).links;

  const people = ballotPeople();
  const out: B14Coverage = {
    total: people.length,
    withCuratedBlurb: 0,
    withDerivedBlurb: 0,
    withBlurb: 0,
    withPhoto: 0,
    withContact: 0,
    withLink: 0,
    bare: 0,
    bareKeys: [],
  };
  for (const person of people) {
    const card = cards[person.key];
    const link = links[person.key];
    const curated = Boolean(card?.bio);
    // The reader sees one or the other, so the headline counts either.
    const derived = Boolean(derivedBlurbFor(person.key));
    const blurb = curated || derived;
    const photo = Boolean(card?.photoUrl);
    const contact = Boolean(card?.email || card?.phone);
    const anyLink = Boolean(link?.official || link?.campaign || person.filedSiteUrl);
    if (curated) out.withCuratedBlurb += 1;
    if (derived) out.withDerivedBlurb += 1;
    if (blurb) out.withBlurb += 1;
    if (photo) out.withPhoto += 1;
    if (contact) out.withContact += 1;
    if (anyLink) out.withLink += 1;
    if (!blurb && !photo && !contact && !anyLink) {
      out.bare += 1;
      out.bareKeys.push(person.key);
    }
  }
  return out;
}

// Run-as-script guard. An import.meta.url comparison does not survive
// Windows path separators, and a silent no-op is how a measurement stops
// measuring without anybody noticing.
if (process.argv[1]?.includes("b14-coverage")) {
  const c = measureCoverage();
  console.log("=== B14 coverage, measured ===");
  console.log(`  ballot candidates enumerated: ${c.total}`);
  console.log(`  with a sourced blurb:         ${c.withBlurb}`);
  console.log(`    curated by hand:            ${c.withCuratedBlurb}`);
  console.log(`    the campaign own one-liner: ${c.withDerivedBlurb}`);
  console.log(`  with a photo:                 ${c.withPhoto}`);
  console.log(`  with published contact:       ${c.withContact}`);
  console.log(`  with any link (hunted or filed): ${c.withLink}`);
  console.log(`  carrying NONE of the four:    ${c.bare} of ${c.total}`);
}
