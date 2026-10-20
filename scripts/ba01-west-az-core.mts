import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { BallotSet } from "../lib/ballot/types.ts";

const root = resolve(import.meta.dirname, "..");

export function pimaStatewideCourt(document: string) {
  if (!document.includes("General Election-November 3, 2026") || !document.includes("Justice of the Arizona Supreme Court")) {
    throw new Error("Wrong official Pima general candidate list");
  }
  const row = /^NONPARTISAN\s+(LOPEZ IV),\s+(JOHN)\s*$/m.exec(document);
  if (!row) throw new Error("Statewide Supreme Court nominee is absent from the source");
  return { familyName: row[1], givenName: row[2], title: "Justice of the Arizona Supreme Court", quote: row[0].trim() };
}

export function pimaGovernorTickets(document: string) {
  if (!document.includes("General Election-November 3, 2026")) throw new Error("Wrong Pima election");
  const office = "Governor and Lieutenant Governor";
  const section = document.split(office)[1]?.split("State Senator")[0];
  if (!section) throw new Error("Missing official joint-ticket section");
  const names = [...section.matchAll(/^(DEM|PND|REP|GRN|NOL)\s+([^,\r\n]+),\s+([^\r\n]+)\s*$/gm)]
    .map(match => ({ name: `${match[3].trim()} ${match[2].trim()}`, partyLabel: match[1], quote: match[0].trim() }));
  if (names.length !== 8) throw new Error("Expected the four printed governor/lieutenant-governor pairs");
  return Array.from({ length: 4 }, (_, index) => ({ lead: names[index * 2], mate: names[index * 2 + 1],
    quote: `${office}\n${names[index * 2].quote}\n${names[index * 2 + 1].quote}` }));
}

export function addArizonaStatewideCourt() {
  const directory = resolve(root, "data/ballot/ba01-west-evidence");
  const document = readFileSync(resolve(directory, "az-pima-general-candidates.txt"), "utf8");
  const sources = JSON.parse(readFileSync(resolve(directory, "sources.json"), "utf8"));
  const source = sources.find((row: { file: string }) => row.file === "az-pima-general-candidates.txt");
  if (createHash("sha256").update(document).digest("hex") !== source.snapshotHash) throw new Error("Changed source snapshot");
  const row = pimaStatewideCourt(document), file = resolve(root, "data/ballot/2026-general/az.json");
  const state = JSON.parse(readFileSync(file, "utf8")), ballot = Object.values(state.ballots)[0] as BallotSet & { candidateTickets?: {
    id: string; leadCandidacyId: string; runningMate: unknown; provenance: unknown;
  }[] };
  const contestId = "az-2026-general-supreme-court-john-lopez-iv";
  const provenance = { sourceUrl: source.sourceUrl, sourceOrg: "Pima County Elections Department", collectedAt: source.retrievedAt,
    verifiedAt: source.retrievedAt, quote: `${row.title}\n${row.quote}` };
  if (!ballot.contests.some(row => row.id === contestId)) ballot.contests.push({ id: contestId, electionId: ballot.election.id,
    ocdId: "ocd-division/country:us/state:az", divisionVintage: "2026", title: row.title, type: "CANDIDACY", voteFor: 1,
    termYears: null, candidateListComplete: true, scopeNote: null, provenance });
  const candidacyId = `${contestId}-john-lopez-iv`;
  if (!ballot.candidacies.some(row => row.id === candidacyId)) ballot.candidacies.push({ id: candidacyId, contestId,
    familyName: row.familyName, givenName: row.givenName, partyLabel: null, slogan: null, incumbent: null, websiteUrl: null, provenance });
  const words = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  ballot.candidateTickets ??= [];
  for (const pair of pimaGovernorTickets(document)) {
    const lead = ballot.candidacies.find(candidate => candidate.contestId === "ballot-az-pima:governor" &&
      words(`${candidate.givenName} ${candidate.familyName}`) === words(pair.lead.name));
    if (!lead) throw new Error(`Missing held lead candidate: ${pair.lead.name}`);
    const id = `az-pima-general-2026-ticket-${slug(pair.lead.name)}`;
    const ticketProvenance = { ...provenance, quote: pair.quote };
    if (!ballot.candidateTickets.some(row => row.id === id)) ballot.candidateTickets.push({ id, leadCandidacyId: lead.id,
      runningMate: { id: `az-pima-general-2026-running-mate-${slug(pair.mate.name)}`, contestId: lead.contestId,
        familyName: pair.mate.name, givenName: "", partyLabel: pair.mate.partyLabel, slogan: null, incumbent: null,
        websiteUrl: null, office: "Lieutenant Governor", provenance: ticketProvenance }, provenance: ticketProvenance });
    const lineup = (ballot as BallotSet & { generalLineup?: { contests: {
      contestId: string; nominees: { name: string; partyLabel: string; provenance?: unknown }[];
    }[] } }).generalLineup?.contests.find(row => row.contestId === lead.contestId);
    const nominee = lineup?.nominees.find(row => words(row.name.split(" / ")[0]) === words(pair.lead.name));
    if (!nominee) throw new Error(`Missing general-lineup lead: ${pair.lead.name}`);
    const displayName = (name: string) => name.toLowerCase().replace(/\b\w/g, letter => letter.toUpperCase());
    nominee.name = `${displayName(pair.lead.name)} / ${displayName(pair.mate.name)}`;
    nominee.provenance = ticketProvenance;
    if (pair.lead.partyLabel !== pair.mate.partyLabel) {
      const labels: Record<string, string> = { DEM: "Democratic", REP: "Republican", GRN: "Green", NOL: "No Labels", PND: "PND" };
      nominee.partyLabel = `${labels[pair.lead.partyLabel]} / ${labels[pair.mate.partyLabel]}`;
    }
    if (words(pair.lead.name) === "teriannhourihan") {
      // The current official general list labels this lead NOL; the held March filing label was older.
      lead.partyLabel = "No Labels";
      lead.provenance = ticketProvenance;
    }
  }
  const checkedSource = {
    requestedUrl: source.sourceUrl, finalUrl: source.sourceUrl, httpStatus: 200, rawHash: source.rawHash,
    retrievedAt: source.retrievedAt, publisher: "Pima County Elections Department", sourceClass: "ELECTION_AUTHORITY",
    reviewedEvidence: `Official Pima County November 3 general candidate list linked by ${source.linkingPage}. Full text saved in az-pima-general-candidates.txt; source names John Lopez IV for the statewide Supreme Court and explicitly prints all four governor/lieutenant-governor pairs.`,
    reviewOutcome: "SUPPORTED" };
  const priorSource = state.sourceReceipt.sources.find((row: { rawHash: string }) => row.rawHash === source.rawHash);
  if (priorSource) Object.assign(priorSource, checkedSource);
  else state.sourceReceipt.sources.push(checkedSource);
  state.sourceReceipt.reviewedAt = source.retrievedAt;
  state.sourceReceipt.reviewedBy = "Codex BA-01 official-source replay";
  writeFileSync(file, JSON.stringify(state, null, 2) + "\n");
  return { contestId, candidacyId };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) console.log(JSON.stringify(addArizonaStatewideCourt()));
