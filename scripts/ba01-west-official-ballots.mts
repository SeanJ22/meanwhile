import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { BallotSet, Candidacy } from "../lib/ballot/types.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const hash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const plain = (s: string) => s.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
  .replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();

export function coloradoRows(html: string): string[][] {
  return [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(match =>
    [...match[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(cell => plain(cell[1])))
    .filter(row => row.length === 5 && row[0] !== "Candidate name");
}

export function maricopaCountywideRows(document: string) {
  if (!document.includes("OFFICIAL COUNTY CANDIDATES - 2026 GENERAL ELECTION") ||
    !document.includes("JUDGES SEEKING RETENTION - 2026 GENERAL ELECTION")) throw new Error("Wrong Maricopa source");
  return document.split(/\r?\n/).flatMap(line => {
    const clerk = /^CLERK OF THE SUPERIOR COURT\s*\/[^\n]*?\s{2,}COUNTY \/ CONDADO\s{2,}(.+?)\s{2,}(DEM|REP)\s*$/.exec(line);
    const judge = /^JUDGE OF THE SUPERIOR COURT\s*\/[^\n]*?\s{2,}(\d+)\s{2,}(.+?)\s{2,}(NON)\s*$/.exec(line);
    if (clerk) return [{ office: "Clerk of the Superior Court", seat: "", name: clerk[1], party: clerk[2], quote: line.trim() }];
    if (judge) return [{ office: "Judge of the Superior Court", seat: judge[1], name: judge[2], party: judge[3], quote: line.trim() }];
    return [];
  });
}

export function maricopaMeasure(document: string) {
  const section = document.split("BALLOT FORMAT OF PROPOSITION 413").at(-1)!.split("RESOLUTION AND CALL FOR ELECTION")[0];
  const clean = section.replace(/\s+/g, " ").trim();
  const question = /OFFICIAL TITLE: ([\s\S]+?) A "YES" vote/.exec(clean)?.[1];
  const yes = /A "YES" vote shall have the effect of ([\s\S]+?) A "NO"/.exec(clean)?.[1];
  const no = /A "NO" vote shall have the effect of ([\s\S]+?) YES NO/.exec(clean)?.[1];
  if (!question || !yes || !no || !document.includes("November 3, 2026")) throw new Error("Missing official Proposition 413 text");
  return { questionText: `OFFICIAL TITLE: ${question}`, yesMeans: yes, noMeans: no };
}

export function denverCountywideRows(document: string) {
  if (!document.includes("Sample Ballot for the 2026 General Election and") || !document.includes("Tuesday, November 3, 2026")) {
    throw new Error("Wrong Denver sample ballot");
  }
  const vacancy = document.split("Councilmember At-Large - Seat B")[1]?.split("(Write-in / Por escrito)")[0];
  const councilNames = vacancy?.split("(Vote for One / Vote por Uno)")[1]?.trim().split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  if (!councilNames?.length) throw new Error("Missing Denver vacancy candidates");
  const candidates = councilNames.map(name => ({ office: "Councilmember At-Large — Seat B", name, quote: `Councilmember At-Large - Seat B\n${name}` }));
  for (const match of document.matchAll(/Shall Judge ([\s\S]+?) of the ([\s\S]+?)\s+be\s+retained in office\?/g)) {
    const office = match[2].replace(/\s+/g, " ").trim();
    if (!/^(2nd Judicial District(?:\s*\/\s*(?:Juvenile|Probate))?|Denver County Court)$/.test(office)) continue;
    const name = match[1].replace(/\s+/g, " ").trim();
    candidates.push({ office: `${office} — ${name} — Retention`, name, quote: match[0].replace(/\s+/g, " ").trim() });
  }
  const measures = [...document.matchAll(/^(Referred Question (2[HIJK])|Initiated Ordinance (311))\r?\n([\s\S]+?)(?=\r?\n(?:Pregunta remitida|Ordenanza iniciada))/gm)]
    .map(match => ({ title: match[1], number: match[2] || match[3], questionText: match[4].replace(/\s+/g, " ").trim() }));
  return { candidates, measures };
}

type Source = { file: string; sourceUrl: string; rawHash: string; snapshotHash: string; retrievedAt: string; httpStatus: number };
type StateInput = { kind: string; ballots: Record<string, BallotSet & { measureRecords?: unknown[] }>; sourceReceipt: { reviewedAt: string; reviewedBy: string; sources: unknown[] } };

export function applyWestOfficialAdditions() {
  const evidence = resolve(root, "data/ballot/ba01-west-evidence");
  const sources = JSON.parse(readFileSync(resolve(evidence, "sources.json"), "utf8")) as Source[];
  const snapshot = (file: string) => {
    const source = sources.find(row => row.file === file)!;
    const bytes = readFileSync(resolve(evidence, file));
    if (hash(bytes) !== source.snapshotHash) throw new Error(`Changed source snapshot: ${file}`);
    return { source, document: bytes.toString("utf8") };
  };
  const receipt = (source: Source, publisher: string) => ({ requestedUrl: source.sourceUrl, finalUrl: source.sourceUrl,
    httpStatus: source.httpStatus, rawHash: source.rawHash, retrievedAt: source.retrievedAt,
    publisher, sourceClass: "ELECTION_AUTHORITY", reviewedEvidence: `Saved full source document in ${source.file}; code extracted the exact published office, name, party or ballot text.`, reviewOutcome: "SUPPORTED" });
  const provenance = (source: Source, sourceOrg: string, quote: string) => ({ sourceUrl: source.sourceUrl, sourceOrg,
    collectedAt: source.retrievedAt, verifiedAt: source.retrievedAt, quote });
  const load = (state: string) => JSON.parse(readFileSync(resolve(root, `data/ballot/2026-general/${state}.json`), "utf8")) as StateInput;
  const save = (state: string, input: StateInput) => writeFileSync(resolve(root, `data/ballot/2026-general/${state}.json`), JSON.stringify(input, null, 2) + "\n");
  const addReceipt = (input: StateInput, source: Source, publisher: string) => {
    const row = receipt(source, publisher);
    if (!input.sourceReceipt.sources.some(s => {
      const held = s as { rawHash: string; retrievedAt: string; requestedUrl: string; finalUrl: string };
      return held.rawHash === row.rawHash && held.retrievedAt === row.retrievedAt &&
        [held.requestedUrl, held.finalUrl].includes(row.requestedUrl);
    })) input.sourceReceipt.sources.push(row);
    input.sourceReceipt.reviewedAt = new Date(Math.max(Date.now(), ...input.sourceReceipt.sources.map(s =>
      Date.parse((s as { retrievedAt: string }).retrievedAt)).filter(Number.isFinite))).toISOString();
    input.sourceReceipt.reviewedBy = "Codex BA-01 official-source replay";
  };
  const result = { co: { contests: 0, candidacies: 0, measures: 0 }, az: { contests: 0, candidacies: 0, measures: 0 } };
  const co = load("co"), coBallot = Object.values(co.ballots)[0];
  const colorado = snapshot("co-general-candidates.html");
  // Compare the complete official table, including every certified write-in, with each held statewide/legislative race.
  for (const contest of coBallot.contests.filter(row => row.type === "CANDIDACY")) {
    const match = /^(State Senate|State House of Representatives) — District (\d+)$/.exec(contest.title);
    if (!match) continue;
    const listed = coloradoRows(colorado.document).filter(row => row[1] === match[1] && row[2] === match[2]);
    if (!listed.length) continue;
    for (const row of listed) {
      const id = `${contest.id}-${slug(row[0])}`;
      if (coBallot.candidacies.some(candidate => candidate.id === id || candidate.contestId === contest.id &&
        plain(`${candidate.givenName} ${candidate.familyName}`).toLowerCase() === row[0].toLowerCase())) continue;
      const words = row[0].split(" "), familyName = words.pop()!;
      coBallot.candidacies.push({ id, contestId: contest.id, givenName: words.join(" "), familyName,
        partyLabel: row[3] || null, slogan: null, incumbent: null, websiteUrl: null,
        provenance: provenance(colorado.source, "Colorado Secretary of State", row.join(" | ")) });
      result.co.candidacies++;
      contest.provenance = provenance(colorado.source, "Colorado Secretary of State", listed.map(row => row.join(" | ")).join("; "));
    }
  }
  addReceipt(co, colorado.source, "Colorado Secretary of State");
  const denver = snapshot("denver-sample-ballot.txt"), local = denverCountywideRows(denver.document);
  for (const group of Map.groupBy(local.candidates, row => row.office).values()) {
    const row = group[0], id = `co-denver-2026-${slug(row.office)}`;
    const prov = provenance(denver.source, "Denver Elections Division", group.map(row => row.quote).join("\n"));
    if (!coBallot.contests.some(c => c.id === id)) {
      coBallot.contests.push({ id, electionId: coBallot.election.id, ocdId: "ocd-division/country:us/state:co/county:denver", divisionVintage: "2026",
        title: row.office, type: "CANDIDACY", voteFor: 1, termYears: null, candidateListComplete: true, scopeNote: null, provenance: prov });
      result.co.contests++;
    }
    for (const row of group) {
      const name = row.name.split(" "), familyName = name.pop()!, candidateId = `${id}-${slug(row.name)}`;
      if (coBallot.candidacies.some(c => c.id === candidateId)) continue;
      coBallot.candidacies.push({ id: candidateId, contestId: id, familyName, givenName: name.join(" "), partyLabel: null,
        slogan: null, incumbent: null, websiteUrl: null, provenance: provenance(denver.source, "Denver Elections Division", row.quote) });
      result.co.candidacies++;
    }
  }
  for (const measure of local.measures) {
    const id = `co-denver-2026-${slug(measure.title)}`;
    if (coBallot.contests.some(c => c.id === id)) continue;
    const prov = provenance(denver.source, "Denver Elections Division", measure.questionText);
    coBallot.contests.push({ id, electionId: coBallot.election.id, ocdId: "ocd-division/country:us/state:co/county:denver", divisionVintage: "2026",
      title: measure.title, type: "MEASURE", voteFor: null, termYears: null, measureTextUrl: denver.source.sourceUrl, scopeNote: null, provenance: prov });
    coBallot.measures.push({ id: `${id}#question`, contestId: id, officialNumber: measure.number, questionText: measure.questionText,
      officialStatement: null, provenance: prov });
    coBallot.measureRecords ??= [];
    coBallot.measureRecords.push({ contestId: id, whatItDoes: measure.questionText, yesMeans: null, noMeans: null, parts: [],
      sourceUrl: denver.source.sourceUrl, sourceHash: denver.source.rawHash, sourceHashKind: "CAPTURE_BYTES", writtenAt: denver.source.retrievedAt });
    result.co.contests++; result.co.measures++;
  }
  addReceipt(co, denver.source, "Denver Elections Division");
  save("co", co);
  const az = load("az"), ballot = Object.values(az.ballots)[0], electionId = ballot.election.id;
  const maricopa = snapshot("maricopa-candidates.txt");
  const rows = maricopaCountywideRows(maricopa.document), groups = Map.groupBy(rows, row => `${row.office}:${row.seat}`);
  for (const group of groups.values()) {
    const row = group[0], title = row.seat ? `${row.office}, Division ${row.seat} — Retention` : row.office;
    const id = `az-maricopa-2026-${slug(title)}`;
    const prov = provenance(maricopa.source, "Maricopa County Elections Department", group.map(r => r.quote).join("\n"));
    if (!ballot.contests.some(c => c.id === id)) {
      ballot.contests.push({ id, electionId, ocdId: "ocd-division/country:us/state:az/county:maricopa", divisionVintage: "2026",
        title, type: "CANDIDACY", voteFor: 1, termYears: null, candidateListComplete: true, scopeNote: null, provenance: prov });
      result.az.contests++;
    }
    for (const candidate of group) {
      const [familyName, ...given] = candidate.name.split(","), givenName = given.join(",").trim();
      if (!givenName) throw new Error(`Unsplit official candidate name: ${candidate.name}`);
      const candidacy: Candidacy = { id: `${id}-${slug(candidate.name)}`, contestId: id, familyName: familyName.trim(), givenName,
        partyLabel: candidate.party, slogan: null, incumbent: null, websiteUrl: null,
        provenance: provenance(maricopa.source, "Maricopa County Elections Department", candidate.quote) };
      if (!ballot.candidacies.some(c => c.id === candidacy.id)) { ballot.candidacies.push(candidacy); result.az.candidacies++; }
    }
  }
  addReceipt(az, maricopa.source, "Maricopa County Elections Department");
  const pamphlet = snapshot("maricopa-proposition-413.txt"), measure = maricopaMeasure(pamphlet.document);
  const measureId = "az-maricopa-2026-proposition-413";
  if (!ballot.contests.some(c => c.id === measureId)) {
    const prov = provenance(pamphlet.source, "Maricopa County Elections Department", measure.questionText);
    ballot.contests.push({ id: measureId, electionId, ocdId: "ocd-division/country:us/state:az/county:maricopa", divisionVintage: "2026",
      title: "Proposition 413 — Transaction Privilege Tax for Jail Facilities", type: "MEASURE", voteFor: null, termYears: null,
      measureTextUrl: pamphlet.source.sourceUrl, scopeNote: null, provenance: prov });
    ballot.measures.push({ id: `${measureId}#question`, contestId: measureId, officialNumber: "413", questionText: measure.questionText,
      officialStatement: null, provenance: prov });
    ballot.measureRecords ??= [];
    ballot.measureRecords.push({ contestId: measureId, whatItDoes: measure.questionText, yesMeans: measure.yesMeans, noMeans: measure.noMeans,
      parts: [], sourceUrl: pamphlet.source.sourceUrl, sourceHash: pamphlet.source.rawHash, sourceHashKind: "CAPTURE_BYTES", writtenAt: pamphlet.source.retrievedAt });
    result.az.contests++; result.az.measures++;
  }
  addReceipt(az, pamphlet.source, "Maricopa County Elections Department");
  save("az", az);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) console.log(JSON.stringify(applyWestOfficialAdditions()));
