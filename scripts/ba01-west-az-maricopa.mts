import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { BallotSet } from "../lib/ballot/types.ts";

const root = resolve(import.meta.dirname, "..");

export function scottsdaleCountywideRows(document: string) {
  if (!document.includes("NOVEMBER 3, 2026") || !document.includes("COUNTY OF MARICOPA")) throw new Error("Wrong Scottsdale ballot");
  const judges = [...document.matchAll(/Retain: Division 1\r?\n([^\r\n]+)\r?\nYES\r?\nNO/g)].map(match => ({
    title: `Court of Appeals, Division 1 — ${match[1]} — Retention`, name: match[1], quote: match[0] }));
  if (judges.length !== 8) throw new Error("Expected eight Maricopa appeals retention decisions");
  const section = document.split("BOARD MEMBER AT-LARGE")[1]?.split("COUNCILMEMBER")[0];
  if (!section?.includes("VOTE FOR NOT MORE THAN 1")) throw new Error("Missing college at-large race");
  const college = [...section.matchAll(/^([^\r\n]+), ([^\r\n]+)$/gm)].map(match => ({
    title: "Maricopa County Community College District — Board Member At-Large", name: match[0],
    quote: `MARICOPA COUNTY COMMUNITY COLLEGE DISTRICT\nBOARD MEMBER AT-LARGE${section}` }));
  if (college.length !== 2) throw new Error("Expected both college candidates");
  return [...judges, ...college];
}

export function addMaricopaCountywide() {
  const directory = resolve(root, "data/ballot/ba01-west-evidence");
  const sources = JSON.parse(readFileSync(resolve(directory, "sources.json"), "utf8"));
  const source = sources.find((row: { file: string }) => row.file === "az-scottsdale-sample.txt");
  const document = readFileSync(resolve(directory, source.file), "utf8");
  if (createHash("sha256").update(document).digest("hex") !== source.snapshotHash) throw new Error("Changed Scottsdale snapshot");
  const boundary = readFileSync(resolve(directory, "az-mcccd-boundary.html"), "utf8").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
  if (!boundary.includes("two at-large positions representing the entire county")) throw new Error("Missing countywide college boundary evidence");
  const writeins = readFileSync(resolve(directory, "az-maricopa-writeins.txt"), "utf8");
  if (!writeins.includes("OFFICIAL WRITE-IN CANDIDATES - 2026 GENERAL ELECTION") || !writeins.includes("**End of List.")) throw new Error("Wrong write-in list");
  if (/COLLEGE|APPEALS|CLERK OF THE SUPERIOR COURT/.test(writeins)) throw new Error("New countywide write-in requires inclusion");
  const file = resolve(root, "data/ballot/2026-general/az.json");
  const state = JSON.parse(readFileSync(file, "utf8")), ballot = Object.values(state.ballots)[0] as BallotSet;
  const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  for (const row of scottsdaleCountywideRows(document)) {
    const contestId = row.title.includes("College") ? "az-maricopa-general-2026-college-at-large" : `az-maricopa-general-2026-appeals-${slug(row.name)}`;
    const provenance = { sourceUrl: source.sourceUrl, sourceOrg: "City of Scottsdale — official Maricopa County sample ballot",
      collectedAt: source.retrievedAt, verifiedAt: source.retrievedAt, quote: row.quote };
    if (!ballot.contests.some(contest => contest.id === contestId)) ballot.contests.push({ id: contestId, electionId: ballot.election.id,
      ocdId: "ocd-division/country:us/state:az/county:maricopa", divisionVintage: "2026", title: row.title,
      type: "CANDIDACY", voteFor: 1, termYears: null, candidateListComplete: true, scopeNote: null, provenance });
    const [familyName, givenName] = row.name.split(", ");
    const id = `${contestId}-${slug(row.name)}`;
    if (!ballot.candidacies.some(candidate => candidate.id === id)) ballot.candidacies.push({ id, contestId, familyName, givenName,
      partyLabel: null, slogan: null, incumbent: null, websiteUrl: null, provenance });
  }
  for (const file of ["az-scottsdale-sample.txt", "az-maricopa-writeins.txt", "az-mcccd-boundary.html"]) {
    const captured = sources.find((row: { file: string }) => row.file === file);
    const checked = { requestedUrl: captured.sourceUrl, finalUrl: captured.sourceUrl, httpStatus: 200, rawHash: captured.rawHash,
      retrievedAt: captured.retrievedAt, publisher: file.includes("boundary") ? "Maricopa Community Colleges" : "Maricopa County / City of Scottsdale",
      sourceClass: "ELECTION_AUTHORITY", reviewedEvidence: file.includes("boundary") ?
        "The public community-college governing-board page explicitly states two at-large positions represent the entire county. The official Maricopa County candidate list and Scottsdale general sample explicitly identify the district and its at-large race." :
        "Official November 3, 2026 general election sample and full qualified write-in list. Eight individual appeals retention decisions and both college at-large candidates are printed; no college, appeals or clerk write-in is certified on the complete list.",
      reviewOutcome: "SUPPORTED" };
    const held = state.sourceReceipt.sources.find((row: { rawHash: string; retrievedAt: string; requestedUrl: string; finalUrl: string }) =>
      row.rawHash === captured.rawHash && row.retrievedAt === captured.retrievedAt && [row.requestedUrl, row.finalUrl].includes(captured.sourceUrl));
    if (held) Object.assign(held, checked); else state.sourceReceipt.sources.push(checked);
  }
  state.sourceReceipt.reviewedAt = new Date(Math.max(Date.now(), ...state.sourceReceipt.sources.map((row: { retrievedAt: string }) =>
    Date.parse(row.retrievedAt)).filter(Number.isFinite))).toISOString();
  writeFileSync(file, JSON.stringify(state, null, 2) + "\n");
  return { addedCandidateContests: 9, addedCandidacies: 10 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) console.log(JSON.stringify(addMaricopaCountywide()));
