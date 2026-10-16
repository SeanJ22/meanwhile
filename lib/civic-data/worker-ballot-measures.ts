import { parseStateBallotContractId, requireBallotState, stateBallotContractId } from "../ballot/state-scopes.ts";
import { createHash } from "node:crypto";
import type { AutonomousWorkPlan } from "../control-plane/workers/autonomous-plan.ts";
import type { WorkerResultRecord } from "../control-plane/workers/types.ts";
import type { RegistryDivisionMatch } from "./registry-divisions.ts";
import { linkingPageFrom, section3Page } from "../control-plane/promotion/section3.ts";
import { jurisdictionFromOcdId } from "../coverage/states.ts";
import type { BallotSet, Measure } from "../ballot/types.ts";
import { type MeasureRecord, explicitVoteMeanings } from "../ballot/measure-records.ts";
import type { BallotContestMerge } from "./worker-ballot-contests.ts";
import type { WorkerPublicationCapture } from "./worker-roster-publication.ts";
import { captureIntact, requirePublication, verifiedWorkerRecords, section3SourceReceipt } from "./worker-publication-evidence.ts";
import { canonicalCivicDataJson } from "./changes.ts";

const text = (value: unknown) => typeof value === "string" ? value : "";
const words = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const idHash = (parts: readonly string[]) => createHash("sha256").update(canonicalCivicDataJson(parts)).digest("hex").slice(0, 24);

export function mergeWorkerBallotMeasures(input: {
  plan: AutonomousWorkPlan; parser: WorkerResultRecord; captures: readonly WorkerPublicationCapture[];
  registry: { payload: { registry: { divisions: readonly RegistryDivisionMatch[] } } } | null; now: string; results?: readonly WorkerResultRecord[]; checked: ReturnType<typeof verifiedWorkerRecords>;
}, merge: BallotContestMerge) {
  requirePublication(parseStateBallotContractId(input.plan.publication?.contractId ?? "")?.family === "ballot-contests" && input.plan.contract.schemaVersion === 2 &&
    input.plan.contract.recordClass === "BALLOT_MEASURE", "MEASURE_CONTRACT_UNRESOLVED");
  const checked = input.checked, state = requireBallotState(checked.contract.jurisdiction.state);
  requirePublication(input.plan.publication?.contractId === stateBallotContractId("ballot-contests", state), "BALLOT_STATE_SCOPE_MISMATCH");
  const heldContests: string[] = checked.heldRecordIds.map(id => `Unverified source row ${id}`), acceptedCaptures = new Set<WorkerPublicationCapture>();
  let accepted = 0;
  const pages = input.captures.filter(captureIntact);
  const evidence = pages.map(row => row.evidence);
  const pagesByUrl = new Map<string, WorkerPublicationCapture[]>();
  for (const page of pages) {
    const group = pagesByUrl.get(page.evidence.canonicalUrl) ?? [];
    group.push(page); pagesByUrl.set(page.evidence.canonicalUrl, group);
  }
  const divisionsByLabel = new Map<string, NonNullable<typeof input.registry>["payload"]["registry"]["divisions"][number][]>();
  for (const division of input.registry?.payload.registry.divisions ?? []) {
    if (division.state.toUpperCase() !== state) continue;
    const key = words(division.label), group = divisionsByLabel.get(key) ?? [];
    group.push(division); divisionsByLabel.set(key, group);
  }
  const recordKey = (fields: Readonly<Record<string, unknown>>) => canonicalCivicDataJson([
    text(fields.election), words(text(fields.jurisdictionName)), text(fields.number) || text(fields.title)]);
  const counts = new Map<string, number>();
  for (const row of checked.extraction.records) {
    const key = recordKey(row.fields); counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const identities = new Set<string>();
  for (const record of checked.extraction.records) {
    const fields = record.fields, number = text(fields.number), title = text(fields.title) || number, electionName = text(fields.election);
    const jurisdictionName = text(fields.jurisdictionName), questionText = text(fields.questionText), documentUrl = text(fields.textUrl);
    const divisions = divisionsByLabel.get(words(jurisdictionName)) ?? [];
    const documents = (pagesByUrl.get(documentUrl) ?? []).filter(row => row.evidence.text.includes(title) && row.evidence.text.includes(questionText))
      .sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt));
    const document = documents[0];
    const source = document?.evidence;
    const officialStatement = text(fields.officialStatement) || null;
    const designation = number || title;
    const identity = canonicalCivicDataJson([state, electionName, divisions[0]?.ocdId, designation]);
    const repeats = counts.get(recordKey(fields));
    if (!title || !electionName || !/^https:\/\//.test(documentUrl) || divisions.length !== 1 ||
        jurisdictionFromOcdId(divisions[0].ocdId)?.usps !== state || repeats !== 1 || identities.has(identity)) {
      heldContests.push(`${electionName} / ${title || number} / ${jurisdictionName}`); continue;
    }
    identities.add(identity);
    const electionId = `${state.toLowerCase()}-${idHash([state, electionName])}`;
    const contestId = `ballot-measure:${idHash([state, electionId, divisions[0].ocdId, designation])}`;
    const provenance = { sourceUrl: checked.primary.evidence.canonicalUrl, sourceOrg: checked.primary.evidence.sourceId,
      collectedAt: checked.primary.observedAt, verifiedAt: input.now };
    const key = `${state}:${electionId}`;
    const ballot: BallotSet & { measureRecords: MeasureRecord[] } = { election: { id: electionId, state, name: electionName, date: text(fields.electionDate) },
      contests: [], candidacies: [], measures: [], measureRecords: [], absences: [] };
    ballot.contests.push({ id: contestId, electionId, ocdId: divisions[0].ocdId, divisionVintage: divisions[0].sourceDataset,
      title, type: "MEASURE", measureTextUrl: documentUrl, voteFor: null, termYears: null, scopeNote: text(fields.scopeNote) || null, provenance });
    const fullText = questionText && source && !documents.some(row => Date.parse(row.observedAt) === Date.parse(document.observedAt) && row.evidence.contentHash !== source.contentHash) &&
      (!officialStatement || source.text.includes(officialStatement)) &&
      section3Page({ url: documentUrl, text: source.text, retrievedAt: document.observedAt,
        linkingPage: linkingPageFrom(documentUrl, evidence), sourcePolicy: document.sourcePolicy }, "BALLOT_MEASURE", input.now).ok;
    if (!fullText || !document || !source) {
      heldContests.push(`${electionName} / ${title} / full official text remains owed`);
      merge.addBallot(ballot); merge.add(key, "contests", ballot.contests[0]); accepted++; continue;
    }
    acceptedCaptures.add(document);
    const measure: Measure = { id: `${contestId}#question`, contestId, ...(number ? { officialNumber: number } : {}), questionText, officialStatement,
      provenance: { ...provenance, sourceUrl: documentUrl, sourceOrg: source.sourceId, collectedAt: document.observedAt } };
    ballot.measures.push(measure);
    ballot.measureRecords!.push({ contestId, whatItDoes: officialStatement || questionText,
      ...explicitVoteMeanings(`${questionText}\n${officialStatement ?? ""}`), parts: [], sourceUrl: documentUrl,
      sourceHash: (source.sourceDocument?.contentHash ?? source.contentHash).replace(/^sha256-/, ""),
      sourceHashKind: "CAPTURE_BYTES", writtenAt: document.observedAt });
    merge.addBallot(ballot); merge.add(key, "contests", ballot.contests[0]);
    merge.add(key, "measures", measure); merge.add(key, "measureRecords", ballot.measureRecords[0]); accepted++;
  }
  requirePublication(accepted > 0, "NO_SOURCE_BOUND_BALLOT_MEASURE");
  for (const document of acceptedCaptures) {
    const linking = linkingPageFrom(document.evidence.canonicalUrl, evidence);
    if (linking) for (const page of pagesByUrl.get(linking.url) ?? []) acceptedCaptures.add(page);
  }
  return { heldContests, sourceThrough: new Date(Math.max(...[checked.primary, ...acceptedCaptures].map(row => Date.parse(row.observedAt)))).toISOString(), sourceReceipt: section3SourceReceipt([...new Set([checked.primary, ...acceptedCaptures])], input.now,
    "Official ballot measure reader", "Code replayed the exact registered election/jurisdiction/number and held official full text; no paraphrase or inferred vote meaning.") };
}
