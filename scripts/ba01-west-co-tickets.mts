import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { BallotSet, Candidacy } from "../lib/ballot/types.ts";

const root = resolve(import.meta.dirname, "..");

export function denverGovernorTickets(document: string) {
  if (!document.includes("General Election") || !document.includes("November 3, 2026")) throw new Error("Wrong Denver election");
  const section = document.split("Governor/Lieutenant Governor")[1]?.split("Secretary of State")[0];
  if (!section?.includes("Vote for One Pair")) throw new Error("Missing explicit pair-voting section");
  const pairs = [...section.matchAll(/^([^\r\n]+) \/\r?\n([^\r\n]+)$/gm)]
    .map(match => ({ lead: match[1].trim(), mate: match[2].trim(), quote: `Governor/Lieutenant Governor\n(Vote for One Pair)\n${match[0]}` }));
  if (pairs.length !== 7) throw new Error("Expected seven explicitly printed Colorado pairs");
  return pairs;
}

export function addColoradoTickets() {
  const directory = resolve(root, "data/ballot/ba01-west-evidence");
  const document = readFileSync(resolve(directory, "denver-sample-ballot.txt"), "utf8");
  const sources = JSON.parse(readFileSync(resolve(directory, "sources.json"), "utf8"));
  const source = sources.find((row: { file: string }) => row.file === "denver-sample-ballot.txt");
  if (createHash("sha256").update(document).digest("hex") !== source.snapshotHash) throw new Error("Changed Denver snapshot");
  const file = resolve(root, "data/ballot/2026-general/co.json");
  const state = JSON.parse(readFileSync(file, "utf8"));
  const ballot = Object.values(state.ballots)[0] as BallotSet & { candidateTickets?: {
    id: string; leadCandidacyId: string; runningMate: Candidacy & { office: string }; provenance: Candidacy["provenance"];
  }[] };
  const normalize = (name: string) => name.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]/g, "");
  ballot.candidateTickets ??= [];
  for (const pair of denverGovernorTickets(document)) {
    const get = (contestId: string, name: string) => ballot.candidacies.find(candidate => candidate.contestId === contestId &&
      normalize(`${candidate.givenName} ${candidate.familyName}`) === normalize(name));
    const lead = get("co-sos-2026-general-governor-state", pair.lead);
    const mate = get("co-sos-2026-general-lt-governor-state", pair.mate);
    if (!lead || !mate) throw new Error(`Missing existing Colorado ticket: ${pair.lead} / ${pair.mate}`);
    const id = `co-denver-general-2026-ticket-${normalize(pair.lead)}`;
    const provenance = { sourceUrl: source.sourceUrl, sourceOrg: "Denver Elections Division", collectedAt: source.retrievedAt,
      verifiedAt: source.retrievedAt, quote: pair.quote };
    if (!ballot.candidateTickets.some(ticket => ticket.id === id)) ballot.candidateTickets.push({ id, leadCandidacyId: lead.id,
      runningMate: { ...mate, contestId: lead.contestId, office: "Lieutenant Governor", provenance }, provenance });
  }
  writeFileSync(file, JSON.stringify(state, null, 2) + "\n");
  return { tickets: ballot.candidateTickets.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) console.log(JSON.stringify(addColoradoTickets()));
