/**
 * **B14's missing rung: a link for the candidates who have none.**
 *
 * `pnpm b14:links`
 *
 * ## Why this rung, and not another blurb pass
 *
 * g20 moved blurbs 17 → 36 and reported the finding that matters more than
 * the number: *every candidate the blurb rung reaches already had a link, so
 * the rung is downstream of the one that is missing.* Measured again here:
 * **94 of 136 ballot candidates carry no link at all**, and a blurb rung that
 * reads a campaign site cannot reach a person whose site we have never found.
 *
 * ## The rung
 *
 * The repo already holds 620 sitting officeholders for the three covered
 * states — `lib/registry/officeholders-{04,33,34}.json`, built from Plural
 * Open States (CC-0) — each with the page the LEGISLATURE publishes for them.
 * A ballot candidate who currently sits has an official page we already hold
 * and have never joined to their ballot card. That is a join, not a hunt, and
 * it is the cheapest honest link there is.
 *
 * ## Equal effort, stated rather than assumed
 *
 * This rung structurally favours incumbents, and `CLAUDE.md`'s equal-effort
 * rule is explicit that a thin card tracks incumbency rather than merit. So:
 *
 * * The rung is run for **every one of the 94**, at the same depth, and every
 *   MISS is recorded per candidate with what was tried. A candidate this rung
 *   cannot reach is not left as a blank; the card's standing thin-candidate
 *   line already speaks for them.
 * * It is ONE rung, not the hunt. The recorded miss is what makes the next
 *   session's rung — the campaign site, the social page the
 *   campaign-lives-on-Facebook rule allows — a work item rather than a
 *   silence.
 * * An official page is labelled as what it is. It is the office's page about
 *   the person, never the campaign's own words, and the two are different
 *   source classes on the card.
 *
 * ## The match, and why it is deliberately narrow
 *
 * EXACT normalised full-name match **within the candidate's own state file**.
 * Nothing fuzzy: a near-match across 620 records is how a real person gets
 * another person's page, and the D40 family is the standing warning about
 * joins that collapse. A candidate whose name does not match exactly is a
 * recorded miss, which is the right answer.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { ballotPeople, type BallotPerson } from "./b14-coverage.mts";

const ROOT = process.cwd();
const read = (p: string) => JSON.parse(readFileSync(join(ROOT, p), "utf8"));

// F01-continued session 2, item 0B: the Phoenix day comes from the one
// module that owns it, exactly as `pnpm stamp` does. This file used to
// carry its own byte-identical copy of the formatter — correct on the day
// it was written, and one more place for the rule to drift.
import { today } from "./doc-dates.mjs";
const TODAY = today();

interface Officeholder {
  name: string;
  officeTitle: string;
  websiteUrl: string | null;
  provenance: { sourceUrl: string; sourceOrg: string; collectedAt: string };
}

/** `ballot-az-pima:…` → the state's officeholder file. */
const STATE_FILE: Record<string, string> = {
  "ballot-az-pima": "officeholders-04.json",
  "ballot-nh-merrimack": "officeholders-33.json",
  "ballot-nj-morris": "officeholders-34.json",
  // The Arizona general lineup's contests carry the same prefix.
  "az-general": "officeholders-04.json",
};

function stateFileFor(person: BallotPerson): string | null {
  for (const [prefix, file] of Object.entries(STATE_FILE)) {
    if (person.contestId.startsWith(prefix)) return file;
  }
  return null;
}

/**
 * Normalise a name for comparison ONLY. Never for display, never stored.
 *
 * The ballot files write `Christopher (Chris) RUSSO` and `Munir "Monir"
 * MAMOUN`; the officeholder registry writes `Aaron Márquez`. Case, accents,
 * punctuation, nicknames in brackets or quotes, and suffixes are stripped —
 * and NOTHING else. No initial matching, no surname-only fallback: a loose
 * match across 620 records is how a real person gets another person's page.
 */
export function normaliseName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/"[^"]*"/g, " ")
    .replace(/\b(jr|sr|ii|iii|iv)\b\.?/gi, " ")
    .replace(/[^a-zA-Z\s]/g, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

interface VerifiedLink {
  url: string;
  label: string;
  verification: string;
  attemptedAt: string;
}

interface CandidateLinks {
  official: VerifiedLink | null;
  campaign: VerifiedLink | null;
}

interface RecordedHunt {
  key: string;
  name: string;
  note: string;
  attemptedAt: string;
}

interface LinksFile {
  curatedAt: string;
  note: string;
  links: Record<string, CandidateLinks>;
  hunts: RecordedHunt[];
}

function main() {
  const file = read("data/ballot/candidate-links-2026.json") as LinksFile;
  const people = ballotPeople();

  const holdersByFile = new Map<string, Map<string, Officeholder>>();
  for (const f of new Set(Object.values(STATE_FILE))) {
    const j = read(`lib/registry/${f}`) as { officeholders: Officeholder[] };
    const byName = new Map<string, Officeholder>();
    const collisions = new Set<string>();
    for (const h of j.officeholders) {
      const key = normaliseName(h.name);
      if (byName.has(key)) collisions.add(key);
      byName.set(key, h);
    }
    // A name held by two sitting officials cannot be joined on safely; drop
    // both rather than pick one. Stated, never silent.
    for (const key of collisions) byName.delete(key);
    if (collisions.size > 0) {
      console.log(`  ${f}: ${collisions.size} name(s) held by two officials — not joined`);
    }
    holdersByFile.set(f, byName);
  }

  let alreadyLinked = 0;
  let matched = 0;
  let missed = 0;
  let noStateFile = 0;
  const misses: BallotPerson[] = [];

  for (const person of people) {
    const existing = file.links[person.key];
    if (person.filedSiteUrl || (existing && (existing.official || existing.campaign))) {
      alreadyLinked += 1;
      continue;
    }
    const stateFile = stateFileFor(person);
    if (!stateFile) {
      noStateFile += 1;
      continue;
    }
    const holder = holdersByFile.get(stateFile)!.get(normaliseName(person.name));
    if (!holder || !holder.websiteUrl) {
      missed += 1;
      misses.push(person);
      continue;
    }
    matched += 1;
    file.links[person.key] = {
      // Labelled as what it is: the OFFICE's page about the person. Never the
      // campaign's own words, which is a different source class.
      official: {
        url: holder.websiteUrl,
        label: `${holder.officeTitle} — official page`,
        verification: `Joined on an exact name match to this state's sitting-officeholder registry, built from ${holder.provenance.sourceOrg} and collected ${holder.provenance.collectedAt}; the URL is the one the legislature publishes for this member.`,
        attemptedAt: TODAY,
      },
      campaign: existing?.campaign ?? null,
    };
  }

  /*
   * EVERY MISS IS RECORDED, per candidate, with what was tried. That is the
   * equal-effort rule's mechanism: a candidate this rung cannot reach is a
   * work item with a named next step, never a blank that reads as absence of
   * the candidate.
   */
  // The note opens with MISS on purpose: `tests/candidate-links.test.ts`
  // requires every hunt to say WHICH KIND of absence it is, because a miss
  // and a never-attempted are different claims and a bare blank is neither.
  const noteFor = (_p: BallotPerson) =>
    `MISS — B14 official-page rung, ${TODAY}: no sitting officeholder in this state's registry matches this name exactly, so there is no official page for us to link. NEXT RUNG: the campaign's own site, or the social page CLAUDE.md's campaign-lives-on-Facebook rule allows when authenticity is establishable.`;

  const already = new Set(file.hunts.map((h) => `${h.key}|${h.note.slice(0, 24)}`));
  for (const p of misses) {
    const note = noteFor(p);
    const dedupe = `${p.key}|${note.slice(0, 24)}`;
    if (already.has(dedupe)) continue;
    file.hunts.push({ key: p.key, name: p.name, note, attemptedAt: TODAY });
  }

  file.curatedAt = TODAY;
  writeFileSync(
    join(ROOT, "data", "ballot", "candidate-links-2026.json"),
    `${JSON.stringify(file, null, 2)}\n`,
    "utf8",
  );

  const total = people.length;
  console.log(
    `\nB14 official-page rung — ${TODAY}\n` +
      `  ballot candidates:        ${total}\n` +
      `  already had a link:       ${alreadyLinked}\n` +
      `  rung run against:         ${total - alreadyLinked - noStateFile}\n` +
      `  official page joined:     ${matched}\n` +
      `  recorded miss:            ${missed}\n` +
      `  no state file (skipped):  ${noStateFile}\n` +
      `  hunts recorded in file:   ${file.hunts.length}`,
  );
  if (matched === 0) {
    console.error("REFUSING: the rung joined nothing. An empty success is not a success.");
    process.exit(1);
  }
}

main();
