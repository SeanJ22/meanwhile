/**
 * The congress-legislators migration — item 7, 2026-08-16.
 *
 * Reads the SHA-pinned snapshot (`pnpm congress:fetch`) and does two things
 * that must never be confused with each other:
 *
 * ## 1. It DIFFS, it does not overwrite
 *
 * The federal roster already carries a birthday and a term end for all 539
 * members, collected from the same upstream project through its unpinned
 * JSON mirror. The author's ruling demotes those prior rungs to
 * **fallback-and-audit**: where the pinned file and the store disagree, that
 * is a FINDING — an upstream PR to file, or a stale value of ours — written
 * to `docs/congress-legislators-diff.md` for the author to rule on. Nothing
 * is silently replaced.
 *
 * A migration that quietly overwrote 539 birthdays with a second copy of the
 * same claim would look like success and would destroy the only evidence
 * that the two rungs ever disagreed.
 *
 * ## 2. It ADDS what the store never held
 *
 * Official social accounts, district offices, committee memberships. These
 * are new facts, not competing ones, so they are written. Joined by
 * BIOGUIDE, never by name.
 *
 * ## The recency exception, named
 *
 * Official pages win on recency. A death, a resignation or a swearing-in may
 * be corrected from the chamber's own page without waiting for the repo; the
 * repo is the baseline, not the ceiling. This script never reverses such a
 * correction, because it never overwrites.
 *
 *   pnpm congress:migrate
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { carried, provenanceLine, runStamp } from "../lib/ops/freshness.ts";

interface SnapshotMember {
  bioguide: string;
  fecIds: string[];
  name: string;
  birthDate: string | null;
  chamber: string | null;
  state: string | null;
  district: number | null;
  party: string | null;
  termStart: string | null;
  termEnd: string | null;
  phone: string | null;
  url: string | null;
  contactForm: string | null;
  social: Record<string, string | null>;
  districtOffices: {
    city: string | null;
    state: string | null;
    address: string | null;
    zip: string | null;
    phone: string | null;
    lat: number | null;
    lng: number | null;
  }[];
}

interface Snapshot {
  source: {
    project: string;
    repoUrl: string;
    sha: string;
    licence: string;
    licenceUrl: string;
    sourceOrg: string;
    collectedAt: string;
  };
  counts: Record<string, number>;
  members: SnapshotMember[];
  committees: {
    id: string;
    name: string;
    type: string;
    url: string | null;
    jurisdiction: string | null;
    jurisdictionSource: string | null;
  }[];
  memberships: Record<
    string,
    { committeeId: string; name: string; rank: number | null; title: string | null }[]
  >;
}

interface Finding {
  bioguide: string;
  name: string;
  field: string;
  ours: string;
  theirs: string;
}

const ROOT = process.cwd();

function main() {
  /*
   * RULING 107. This was named `collectedAt` and fed the report header, which
   * made a clock date look like a data date: regenerating on 2026-08-23 moved
   * the header from 2026-08-16 to 2026-08-23 with nothing read. It is a RUN
   * date and is now typed and named as one, so it cannot reach a freshness
   * field. The read date is the snapshot's, carried forward below.
   */
  const ranOn = runStamp();
  const snapshot = JSON.parse(
    readFileSync(join(ROOT, "data/congress-legislators/snapshot.json"), "utf8"),
  ) as Snapshot;

  const storePath = join(ROOT, "lib/registry/officeholders-us.json");
  const store = JSON.parse(readFileSync(storePath, "utf8")) as {
    officeholders: {
      id: string;
      name: string;
      birthDate: string | null;
      termStart: string;
      termEnd: string;
      partyLabel: string | null;
      social?: Record<string, string | null>;
      state?: string;
      chamber?: string;
    }[];
  };

  const byBioguide = new Map(snapshot.members.map((m) => [m.bioguide, m]));

  const findings: Finding[] = [];
  let matched = 0;
  let unmatched = 0;
  let socialAdded = 0;

  for (const person of store.officeholders) {
    const bioguide = person.id.startsWith("congress:")
      ? person.id.slice("congress:".length)
      : null;
    const member = bioguide ? byBioguide.get(bioguide) : undefined;

    if (!member) {
      // A member in our store the pinned file does not carry. Counted, never
      // dropped — this is the recency exception's other side, and it is a
      // real state (a mid-cycle swearing-in after the pin).
      unmatched += 1;
      continue;
    }
    matched += 1;

    // ---------------------------------------------------------------
    // DIFF — never overwrite.
    const compare: [string, string | null, string | null][] = [
      ["birthDate", person.birthDate, member.birthDate],
      ["termStart", person.termStart, member.termStart],
      ["termEnd", person.termEnd, member.termEnd],
    ];
    for (const [field, ours, theirs] of compare) {
      if (theirs && ours && ours !== theirs) {
        findings.push({
          bioguide: member.bioguide,
          name: person.name,
          field,
          ours,
          theirs,
        });
      }
    }

    // ---------------------------------------------------------------
    // ADD — official accounts the store never held. Only the handles the
    // file actually carries; an absent channel stays absent, never padded.
    const social: Record<string, string> = {};
    for (const [key, value] of Object.entries(member.social)) {
      if (value) social[key] = String(value);
    }
    if (Object.keys(social).length > 0) {
      person.social = social;
      socialAdded += 1;
    }

    // The identity chips (item 3) need the state and the chamber, and both
    // were derivable only by string-guessing at a seat label before this.
    // They come off the member's current term in the pinned file.
    if (member.state) person.state = member.state;
    if (member.chamber) person.chamber = member.chamber;
  }

  writeFileSync(storePath, JSON.stringify(store, null, 2) + "\n", "utf8");

  // ---------------------------------------------------------------
  // The directory table the battlecard's Committees section and district
  // office rows read. Kept OUT of the officeholder store and out of the
  // coverage payload: 3,891 membership rows and 1,306 offices have no
  // business travelling with every map click.
  const directory = {
    source: snapshot.source,
    counts: {
      members: snapshot.members.length,
      districtOffices: snapshot.counts.districtOffices,
      committees: snapshot.committees.length,
      membershipRows: snapshot.counts.membershipRows,
      membersWithCommittee: snapshot.counts.membersWithCommittee,
    },
    committees: Object.fromEntries(snapshot.committees.map((c) => [c.id, c])),
    byMember: Object.fromEntries(
      snapshot.members.map((m) => [
        m.bioguide,
        {
          districtOffices: m.districtOffices,
          committees: snapshot.memberships[m.bioguide] ?? [],
        },
      ]),
    ),
  };

  const dir = join(ROOT, "data/congress-legislators");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "directory.json"),
    JSON.stringify(directory, null, 2) + "\n",
    "utf8",
  );

  // ---------------------------------------------------------------
  // The tiny client-safe constant the battlecard's Sources section cites.
  //
  // Item 7's clean render: directory facts carry NO per-surface source
  // annotations — full provenance lives in the snapshot and ONE line on the
  // sources page, and the card's Sources section names the project ONCE for
  // all of them rather than once per row. This is that one line, generated
  // rather than typed, so the SHA on the card is the SHA that was fetched.
  writeFileSync(
    join(ROOT, "lib/officials/directory-source.ts"),
    [
      "/**",
      " * GENERATED by `pnpm congress:migrate`. Do not edit by hand.",
      " *",
      " * The one line a federal battlecard's Sources section cites for every",
      " * directory fact on it — roster spine, official accounts, committee",
      " * seats, district offices. Item 7's clean render: these carry no",
      " * per-surface annotation, and this is where the provenance lives on the",
      " * card instead.",
      " *",
      " * The tag names the PROJECT. It is a community-maintained aggregation of",
      " * official sources and is not itself an official record.",
      " */",
      "",
      "export const CONGRESS_DIRECTORY_SOURCE = {",
      `  sourceUrl: ${JSON.stringify(`${snapshot.source.repoUrl}/tree/${snapshot.source.sha}`)},`,
      `  sourceOrg: ${JSON.stringify(snapshot.source.sourceOrg)},`,
      `  collectedAt: ${JSON.stringify(snapshot.source.collectedAt)},`,
      "  verifiedAt: null,",
      "} as const;",
      "",
      `/** The pinned commit, stated so a reader can reproduce the fetch. */`,
      `export const CONGRESS_DIRECTORY_SHA = ${JSON.stringify(snapshot.source.sha)};`,
      "",
    ].join("\n"),
    "utf8",
  );

  // ---------------------------------------------------------------
  // The findings report. Written even when empty, because "we checked and
  // they agree" and "nobody checked" are different facts and only one of
  // them is worth anything.
  const lines: string[] = [
    "# congress-legislators — the migration diff",
    "",
    provenanceLine(
      "pnpm congress:migrate",
      ranOn,
      carried(snapshot.source.collectedAt, "the pinned upstream snapshot records the day it was read"),
    ),
    "",
    `Snapshot pinned at \`${snapshot.source.sha}\`, read ${snapshot.source.collectedAt}.`,
    "",
    "## What this file is",
    "",
    "The federal roster already carried a birthday and a term end for every",
    "member, from the same upstream project through its **unpinned** JSON",
    "mirror. The author's ruling demotes that rung to fallback-and-audit: the",
    "migration DIFFS rather than overwrites, and every disagreement is a",
    "finding here — either an upstream PR for us to file, or a stale value of",
    "ours. **Nothing below was changed automatically.**",
    "",
    "## Counts, with their denominators",
    "",
    `- Store rows matched to the pinned file by bioguide: **${matched}** of ${store.officeholders.length}`,
    `- Store rows the pinned file does not carry: **${unmatched}**`,
    `- Rows that gained official social accounts: **${socialAdded}**`,
    `- Disagreements found: **${findings.length}**`,
    "",
  ];

  if (findings.length === 0) {
    lines.push(
      "## Findings",
      "",
      "None. Every matched row's birthday, term start and term end agree",
      "between our store and the pinned file. That is a real result, not an",
      "absence of checking — the comparison ran over every matched row.",
      "",
    );
  } else {
    lines.push(
      "## Findings — the author rules on each",
      "",
      "| Member | bioguide | Field | Ours | Pinned file |",
      "| --- | --- | --- | --- | --- |",
      ...findings.map(
        (f) => `| ${f.name} | \`${f.bioguide}\` | ${f.field} | ${f.ours} | ${f.theirs} |`,
      ),
      "",
    );
  }

  writeFileSync(
    join(ROOT, "docs/congress-legislators-diff.md"),
    lines.join("\n"),
    "utf8",
  );

  console.log(`matched ${matched} of ${store.officeholders.length} store rows`);
  console.log(`unmatched (not in the pinned file): ${unmatched}`);
  console.log(`social accounts added to: ${socialAdded}`);
  console.log(`findings (diffs, NOT overwritten): ${findings.length}`);
  console.log(`directory.json: ${Object.keys(directory.byMember).length} members`);
}

main();
