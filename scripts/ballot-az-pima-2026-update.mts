/**
 * `pnpm ballot:az-pima-update` — bring the curated Arizona ballot up to the
 * documents the 85641 detective session read. (2026-08-27.)
 *
 * ## What was wrong with the file, and how each was found
 *
 * 1. **LD 17 was missing entirely.** The file carried State Senate and House
 *    for districts 19 and 20 only. `states/az/85641.md` measured 44 of 96
 *    sampled points in ZIP 85641 inside **LD 17** — so nearly half that ZIP's
 *    readers were shown NO state legislative race at all, which reads as "you
 *    have no legislator on the ballot".
 *
 * 2. **Corporation Commissioner was deliberately omitted**, and the file said
 *    why: "the filing does not state how many of the five seats are scheduled
 *    this cycle, and a guessed seat count is a claim". The Pima County Official
 *    Candidate List states it — **Vote for not more than 2** — so the absence
 *    is answered by a document rather than by a guess.
 *
 * 3. **Zero measures**, on a ballot that has five local ones. Proposition 425
 *    (county), 423 (Vail Unified), 428 (Sahuarita Unified) and 429 (Tanque
 *    Verde Unified) are added with their divisions. Proposition 427 is NOT,
 *    for a measured reason — see below.
 *
 * 4. **Every contest still listed all primary FILERS.** The primary was
 *    certified on 2026-07-30 and the canvass names the winners, so the file's
 *    own stated plan — "when it publishes, this list narrows to the nominees" —
 *    is now executable from the canvass rather than pending.
 *
 * ## Why Proposition 427 is a coverage note and not a contest
 *
 * The $250,000,000 Pima County JTED No. 11 bond is on an 85641 ballot: every
 * one of the 44 probed points in that ZIP is inside JTED territory. It is not
 * added as a contest because **there is no division to hang it on that is
 * true**. Measured against the county's own JTED territory layer and the
 * Census county boundary:
 *
 * - JTED No. 11 covers 188,264,038,476 of Pima County's 256,132,068,484 square
 *   units — about 73%, so `county:pima` would show the bond to roughly a
 *   quarter of the county that does not vote on it, and
 * - four sampled points inside JTED territory are **in PINAL COUNTY**, so
 *   `county:pima` would also HIDE it from readers who do vote on it.
 *
 * That is the Mescal-J6 finding in a new class: a district named for one county
 * governs territory in another. A contest attached to the wrong division is a
 * false claim about somebody's ballot in both directions, so it goes in
 * `coverageNotes`, which the reader surface renders distinctly.
 *
 * ## What it refuses to do
 *
 * It never invents a question text. A measure whose official text the authority
 * has not published — Proposition 427's, which the district's own Request for
 * Arguments says is "available by request" — is not paraphrased into one.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { floored, floorLine } from "../lib/ops/denominator-floor.ts";
import { today } from "./doc-dates.mjs";

const FILE = join(process.cwd(), "data", "ballot", "az-pima-2026.json");
const STAMP = today();

const AZ = "ocd-division/country:us/state:az";
const VINTAGE = "TIGER_GENZ2025";

/** The county's own list of what was printed on the July 21 primary ballot. */
const CANDIDATE_LIST = {
  sourceUrl:
    "https://content.civicplus.com/api/assets/az-pimacounty/e3efef88-46d4-421c-817b-50200031aef3",
  sourceOrg: "Pima County Elections Department, 2026 Primary Election Official Candidate List (updated 2026-05-21)",
  collectedAt: STAMP,
  verifiedAt: STAMP,
};

/** The certified canvass — the record of who WON each contested primary. */
const CANVASS = {
  sourceUrl: "https://apps.azsos.gov/election/2026/canvass/2026_Primary_Canvass_Pima.pdf",
  sourceOrg:
    "Pima County Elections Department, Official Canvass of the July 21, 2026 Primary Election, certified 2026-07-30",
  collectedAt: STAMP,
  verifiedAt: STAMP,
};

interface Cand {
  family: string;
  given: string;
  party: string;
}

/**
 * The general-election candidates, each one a certified primary winner.
 *
 * A party's nominee is the winner of its primary where the primary was
 * contested, and the sole filer where it was not — both read off the two
 * documents above, neither inferred.
 */
const NEW_CONTESTS: Array<{
  id: string;
  ocdId: string;
  title: string;
  voteFor: number;
  termYears: number | null;
  scopeNote: string;
  candidates: Cand[];
  provenance: typeof CANDIDATE_LIST;
}> = [
  {
    id: "ballot-az-pima:state-senate-17",
    ocdId: `${AZ}/sldu:17`,
    title: "State Senator, District 17",
    voteFor: 1,
    termYears: 2,
    scopeNote:
      "Christopher King won the Republican primary 17,498 to Anthony Dunham's 10,576; Edgar Soto was the only Democrat to file and is the party's nominee without a contest.",
    candidates: [
      { family: "King", given: "Christopher", party: "Republican" },
      { family: "Soto", given: "Edgar", party: "Democratic" },
    ],
    provenance: CANVASS,
  },
  {
    id: "ballot-az-pima:state-house-17",
    ocdId: `${AZ}/sldl:17`,
    title: "State Representative, District 17",
    voteFor: 2,
    termYears: 2,
    scopeNote:
      "Arizona legislative districts elect two representatives. Two Democrats and two Republicans filed for two nominations each, so all four are their parties' nominees without a contest.",
    candidates: [
      { family: "Keshel", given: 'Rachel "Jones"', party: "Republican" },
      { family: "Winchester", given: "John", party: "Republican" },
      { family: "Lyon", given: 'Hollace "Holly"', party: "Democratic" },
      { family: "Volk", given: "Kevin", party: "Democratic" },
    ],
    provenance: CANDIDATE_LIST,
  },
  {
    id: "ballot-az-pima:corporation-commissioner",
    ocdId: AZ,
    title: "Corporation Commissioner",
    voteFor: 2,
    termYears: 4,
    scopeNote:
      "Two seats are scheduled this cycle. The Pima County Official Candidate List states the seat count — 'Vote for not more than 2' — which is the document the earlier omission was waiting on. Kevin Thompson (39,906) and Nicholas Myers (35,108) won the Republican primary ahead of Ralph Heap (31,857); Clara Pratte and Jonathon Hill were the only Democrats to file for two nominations.",
    candidates: [
      { family: "Thompson", given: "Kevin", party: "Republican" },
      { family: "Myers", given: 'Nicholas "Nick"', party: "Republican" },
      { family: "Pratte", given: "Clara", party: "Democratic" },
      { family: "Hill", given: "Jonathon", party: "Democratic" },
    ],
    provenance: CANVASS,
  },
];

/**
 * The local measures, with their official text VERBATIM.
 *
 * Proposition 425's full ballot language is published by the county. The three
 * school-district propositions are named and numbered by the Pima County School
 * Superintendent, who is their filing officer; where that office has published
 * the statutory notice the fiscal terms come from it, and where the official
 * question text is not yet published the measure says so rather than inventing
 * one. The Superintendent's own page lists a Voter Information Pamphlet for
 * each with no link behind it as of 2026-08-27.
 */
const MEASURES: Array<{
  id: string;
  ocdId: string;
  title: string;
  questionText: string;
  officialStatement: string | null;
  scopeNote: string;
  provenance: { sourceUrl: string; sourceOrg: string; collectedAt: string; verifiedAt: string };
}> = [
  {
    id: "ballot-az-pima:prop-425",
    ocdId: `${AZ}/county:pima`,
    title: "Proposition 425: Permanent Base Adjustment",
    questionText:
      "Pursuant to the Arizona State Constitution, Pima County seeks voter approval to permanently adjust the expenditure base of the County as determined by the Economic Estimates Commission. The County seeks an adjustment of $70,000,000. A “YES” vote shall have the effect of allowing Pima County to adjust its 1979-80 base expenditure limit. A “NO” vote shall have the effect of not allowing Pima County to adjust its 1979-80 base expenditure limit.",
    officialStatement:
      "Official Title: A resolution proposing a permanent adjustment to the state-imposed 1979-80 expenditure base for Pima County. Summary analysis: if approved, the County’s 1979-80 base expenditure limitation will be increased by $70,000,000 adjusted each future year for population and inflation growth since 1979-80. With voter approval, in fiscal year 2027-2028 the County’s expenditure limitation will increase by $610,086,481, from $817,131,286 to $1,427,217,767. Referred to the people by the Pima County Board of Supervisors by resolution 2026-23, passed 2026-04-21.",
    scopeNote: "Every Pima County voter. Voting runs October 7 to November 3, 2026.",
    provenance: {
      sourceUrl:
        "https://content.civicplus.com/api/assets/az-pimacounty/55aa379c-bc22-47fe-8b7c-d10dab0ade8c/permanent-base-adjustment-proposition-pdf.pdf",
      sourceOrg: "Pima County, Permanent Base Adjustment — Ballot Language",
      collectedAt: STAMP,
      verifiedAt: STAMP,
    },
  },
  {
    id: "ballot-az-pima:prop-423",
    ocdId: `${AZ}/school_district:vail_unified_district`,
    title: "Proposition 423: Vail Unified School District budget override continuation",
    questionText:
      "BUDGET OVERRIDE CONTINUATION, YES / NO — whether Vail Unified School District No. 20 of Pima County, Arizona may continue to exceed the revenue control limit by not more than 12.5% per fiscal year, for fiscal years 2027/2028 and the next six fiscal years.",
    officialStatement:
      "From the district’s statutory Notice of Election: a special election consolidated with the General Election of November 3, 2026, under A.R.S. § 15-481(P). The budget effect is approximately $5,102,762 above the alternate budget for 2027/2028, at an estimated continuation of $1.61 per $100 of secondary assessed valuation. The governing board adopted the calling resolution on 2026-06-02. Arguments were due to the Pima County School Superintendent by 5:00 p.m. on 2026-08-07.",
    scopeNote:
      "Voters of Vail Unified School District No. 20. The proposition number is the Pima County School Superintendent’s; the fiscal terms are the district’s own Notice of Election.",
    provenance: {
      sourceUrl: "https://www.schools.pima.gov/",
      sourceOrg:
        "Pima County School Superintendent, 2026 School District Special Elections (proposition number); Vail Unified School District No. 20 Notice of Election (question and fiscal terms)",
      collectedAt: STAMP,
      verifiedAt: STAMP,
    },
  },
  {
    id: "ballot-az-pima:prop-428",
    ocdId: `${AZ}/school_district:sahuarita_unified_district`,
    title: "Proposition 428: Sahuarita Unified School District budget override continuation",
    questionText:
      "A 15% Maintenance and Operations Budget Override Continuation for Sahuarita Unified School District, to be considered by the voters of the district at the election of November 3, 2026.",
    officialStatement: null,
    scopeNote:
      "Voters of Sahuarita Unified School District No. 30. The question as titled by the Pima County School Superintendent, who is the filing officer for school-district ballot measures in this county. The district’s own Notice of Election has not been read, so the fiscal terms are not stated here rather than estimated.",
    provenance: {
      sourceUrl: "https://www.schools.pima.gov/",
      sourceOrg: "Pima County School Superintendent, 2026 School District Special Elections",
      collectedAt: STAMP,
      verifiedAt: STAMP,
    },
  },
  {
    id: "ballot-az-pima:prop-429",
    ocdId: `${AZ}/school_district:tanque_verde_unified_district`,
    title: "Proposition 429: Tanque Verde Unified School District budget override continuation",
    questionText:
      "A 15% Maintenance and Operations Budget Override Continuation for Tanque Verde Unified School District, to be considered by the voters of the district at the election of November 3, 2026.",
    officialStatement: null,
    scopeNote:
      "Voters of Tanque Verde Unified School District No. 13. The question as titled by the Pima County School Superintendent, who is the filing officer for school-district ballot measures in this county. The district’s own Notice of Election has not been read, so the fiscal terms are not stated here rather than estimated.",
    provenance: {
      sourceUrl: "https://www.schools.pima.gov/",
      sourceOrg: "Pima County School Superintendent, 2026 School District Special Elections",
      collectedAt: STAMP,
      verifiedAt: STAMP,
    },
  },
];

/**
 * The authority's own statements of absence.
 *
 * These are not our gaps. Pima County's Board of Supervisors CANCELLED the
 * uncontested school-district governing board elections on 2026-08-11 and
 * appointed the people who filed, so a reader in these districts has no school
 * board race — a fact they need, and one that would otherwise read as our
 * missing data.
 */
const CANCELLATION = {
  sourceUrl: "https://pima.legistar.com/LegislationDetail.aspx?ID=21690",
  sourceOrg:
    "Pima County Board of Supervisors, agenda item 25 of 2026-08-11 (File ID 20624, matter 21690), “2026 General Election — School District Cancellations”, requested by the School Superintendent and APPROVED 2026-08-11",
  collectedAt: STAMP,
  verifiedAt: STAMP,
};

const ABSENCES = [
  {
    ocdId: `${AZ}/school_district:vail_unified_district`,
    divisionVintage: VINTAGE,
    statement:
      "There is no Vail Unified School District governing board race on the November 3, 2026 ballot. Two positions were up and only two people filed, so the Board of Supervisors cancelled the election as uncontested on 2026-08-11 and appointed Andrea Black and Edward Buster to the seats.",
    provenance: CANCELLATION,
  },
  {
    ocdId: `${AZ}/school_district:empire_elementary_district`,
    divisionVintage: VINTAGE,
    statement:
      "There is no Empire Elementary School District No. 37 governing board race on the November 3, 2026 ballot. Three positions were up and nobody filed, so the Board of Supervisors cancelled the election on 2026-08-11 and recorded THREE (3) VACANCIES on the district’s governing board.",
    provenance: CANCELLATION,
  },
  {
    ocdId: `${AZ}/school_district:sahuarita_unified_district`,
    divisionVintage: VINTAGE,
    statement:
      "Sahuarita Unified School District No. 30 has a governing board race on the November 3, 2026 ballot: two positions, with John Sparks and Raul Rodriguez having filed. It is not among the districts whose election the Board of Supervisors cancelled as uncontested on 2026-08-11.",
    provenance: CANCELLATION,
  },
];

interface BallotFile {
  formatVersion: number;
  curatedAt: string;
  curatorNote: string;
  election: unknown;
  contests: Record<string, unknown>[];
  candidacies: Record<string, unknown>[];
  measures: Record<string, unknown>[];
  absences: Record<string, unknown>[];
  coverageNotes?: string[];
}

function main(): void {
  const file = JSON.parse(readFileSync(FILE, "utf8")) as BallotFile;
  const before = {
    contests: file.contests.length,
    candidacies: file.candidacies.length,
    measures: file.measures.length,
    absences: file.absences.length,
  };

  const have = new Set(file.contests.map((c) => c.id as string));

  for (const c of NEW_CONTESTS) {
    if (have.has(c.id)) {
      console.log(`  already present   ${c.id}`);
      continue;
    }
    file.contests.push({
      id: c.id,
      electionId: "az-2026-11-03",
      ocdId: c.ocdId,
      divisionVintage: VINTAGE,
      title: c.title,
      type: "CANDIDACY",
      voteFor: c.voteFor,
      termYears: c.termYears,
      scopeNote: c.scopeNote,
      provenance: c.provenance,
    });
    for (const k of c.candidates) {
      file.candidacies.push({
        id: `${c.id}:${k.family.toLowerCase().replace(/\W+/g, "-")}`,
        contestId: c.id,
        familyName: k.family,
        givenName: k.given,
        partyLabel: k.party,
        slogan: null,
        incumbent: null,
        websiteUrl: null,
        provenance: c.provenance,
      });
    }
    console.log(`  ADDED contest     ${c.id}  (${c.candidates.length} candidate(s))`);
  }

  const haveMeasureContest = new Set(file.contests.map((c) => c.id as string));
  for (const m of MEASURES) {
    if (haveMeasureContest.has(m.id)) {
      console.log(`  already present   ${m.id}`);
      continue;
    }
    file.contests.push({
      id: m.id,
      electionId: "az-2026-11-03",
      ocdId: m.ocdId,
      divisionVintage: VINTAGE,
      title: m.title,
      type: "MEASURE",
      voteFor: 1,
      termYears: null,
      scopeNote: m.scopeNote,
      provenance: m.provenance,
    });
    file.measures.push({
      id: `${m.id}:question`,
      contestId: m.id,
      questionText: m.questionText,
      officialStatement: m.officialStatement,
      provenance: m.provenance,
    });
    console.log(`  ADDED measure     ${m.id}`);
  }

  const haveAbsence = new Set(file.absences.map((a) => `${a.ocdId}|${String(a.statement).slice(0, 40)}`));
  for (const a of ABSENCES) {
    const key = `${a.ocdId}|${a.statement.slice(0, 40)}`;
    if (haveAbsence.has(key)) continue;
    file.absences.push(a);
    console.log(`  ADDED absence     ${a.ocdId}`);
  }

  const notes = new Set(file.coverageNotes ?? []);
  notes.delete(
    "The Arizona Corporation Commission contest is omitted until the Secretary of State's general-election list states how many seats are scheduled this cycle.",
  );
  notes.add(
    "Proposition 427, a $250,000,000 bond for Pima County Joint Technical Education District No. 11, is on the ballot of every voter in that district — which includes all of ZIP 85641 — and is not shown as a contest because no division in this registry matches the district's territory. Measured 2026-08-27 against the county's own JTED layer: the district covers about 73% of Pima County AND contains sampled points in Pinal County, so attaching it to the county would both show it to voters who do not vote on it and hide it from voters who do. Its estimated average tax rate is $0.14 per $100 of net assessed limited property value; its question text is not published — the district's Request for Arguments says the text is available by request from the district at 2855 West Master Pieces Drive, Tucson.",
  );
  notes.add(
    "Justice of the Peace and Constable are elected by justice precinct, and this registry has no justice-precinct division. ZIP 85641 spans Precincts 7 and 8. On the November 3, 2026 ballot, Precinct 7 elects a Justice of the Peace (Raymond Carroll won the Republican primary 7,077 to Kara Egbert's 4,773; no Democrat filed) and Precinct 8 elects a Justice of the Peace (Kristel Ann Foster, Democratic, and William Parven, Republican). Neither precinct has a Constable race this cycle: the only Constable contests on the county's official candidate list are Precincts 2, 3 and 9.",
  );
  notes.add(
    "Pima County's elected county offices — Sheriff, Assessor, Recorder, Treasurer, County Attorney, School Superintendent — and Board of Supervisors Districts 2 and 4 are NOT on the November 3, 2026 ballot. This is read from the county's Official Candidate List, which prints uncontested races and lists only Board of Supervisors District 5 among supervisor seats; it is not a gap in this file.",
  );
  file.coverageNotes = [...notes];

  file.curatedAt = STAMP;
  file.curatorNote =
    "Transcribed from the Arizona Secretary of State's partisan candidate filing for the 2026 primary and the Legislative Council's 2026 ballot-measure analyses, then extended on 2026-08-27 from three documents the earlier curation did not have: the Pima County Official Candidate List for the July 21 primary (the county's own record of what was PRINTED, which unlike the canvass includes uncontested races), the certified Pima County primary canvass of 2026-07-30 (which names the winners and is the only document carrying party), and the Pima County School Superintendent's 2026 School District Special Elections page (which numbers the local propositions). Added: State Senate and House District 17, which were missing although 44 of 96 sampled points in ZIP 85641 sit in LD 17; Corporation Commissioner, whose seat count the Official Candidate List states as two; and Propositions 425, 423, 428 and 429. The statewide contests below still list every primary FILER and narrow to nominees when the Secretary of State publishes the general-election list; the contests added on 2026-08-27 carry nominees, sourced per contest in scopeNote.";

  writeFileSync(FILE, `${JSON.stringify(file, null, 1)}\n`, "utf8");

  /*
   * RULING 159: every count against the population this run actually offered.
   * "7 contests added" and "0 contests added" print identically as a headline
   * and mean opposite things — the second says the file already held every
   * record this script carries, which is the answer a RE-RUN should give and a
   * first run should not.
   */
  const offeredContests = NEW_CONTESTS.length + MEASURES.length;
  console.log(
    `\n${floorLine(
      floored(
        "contests new to the file",
        "the contests this update carries",
        offeredContests,
        file.contests.length - before.contests,
      ),
    )}`,
  );
  console.log(
    `${floorLine(
      floored(
        "measures new to the file",
        "the measures this update carries",
        MEASURES.length,
        file.measures.length - before.measures,
      ),
    )}`,
  );
  console.log(
    `${floorLine(
      floored(
        "authority absences new to the file",
        "the absences this update carries",
        ABSENCES.length,
        file.absences.length - before.absences,
      ),
    )}`,
  );
  console.log(
    `  candidacies ${before.candidacies} -> ${file.candidacies.length}` +
      `   coverageNotes ${file.coverageNotes.length}`,
  );
}

main();
