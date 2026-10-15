import { createHash } from "node:crypto";
import type { AutonomousWorkPlan } from "../control-plane/workers/autonomous-plan.ts";
import type { WorkerResultRecord } from "../control-plane/workers/types.ts";
import { REGISTRY_RUNTIME_SCOPE, type RegistryRuntimeCarton } from "../registry/runtime-data-plane.ts";
import type { Division } from "../registry/types.ts";
import { readPlacePointerSlice } from "./held-place-slices.ts";
import { linkingPageFrom, section3Page } from "../control-plane/promotion/section3.ts";
import { jurisdictionFromOcdId } from "../coverage/states.ts";
import type { BallotSet, Measure } from "../ballot/types.ts";
import { explicitVoteMeanings } from "../ballot/measure-records.ts";
import type { GenericBallotProjection } from "../ballot/generic-projection.ts";
import type { ManualProjectionPackage } from "./manual-projections.ts";
import type { WorkerPublicationCapture } from "./worker-roster-publication.ts";
import { captureIntact, requirePublication, verifiedWorkerRecords, section3SourceReceipt } from "./worker-publication-evidence.ts";
import { canonicalCivicDataJson } from "./changes.ts";
import { measureSourceReferenceValid } from "../ballot/measure-source-contract.ts";
import { placeMeasureScope, type PlaceMeasureProjection } from "../ballot/place-measures.ts";

const text = (value: unknown) => typeof value === "string" ? value : "";
const words = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const idHash = (parts: readonly string[]) => createHash("sha256").update(canonicalCivicDataJson(parts)).digest("hex").slice(0, 24);
type MeasureRegistry = { readonly payload: { readonly registry: { readonly divisions: readonly Division[] } } };

export async function readMeasureRegistry(plan: AutonomousWorkPlan): Promise<MeasureRegistry | null> {
  const bodyId = plan.publication?.bodyId;
  const division = plan.directorySubject?.divisionId ?? bodyId?.split("#")[0];
  requirePublication(division && jurisdictionFromOcdId(division), "MEASURE_PLACE_IDENTITY_MISSING");
  const read = await readPlacePointerSlice<RegistryRuntimeCarton>("REGISTRY_RUNTIME_BINDING", REGISTRY_RUNTIME_SCOPE, [division], bodyId ? [bodyId] : []);
  return read.kind === "PROMOTED" && read.value ? { payload: read.value } : null;
}

export function workerBallotMeasuresPackage(input: {
  plan: AutonomousWorkPlan; parser: WorkerResultRecord; captures: readonly WorkerPublicationCapture[];
  registry: MeasureRegistry | null; now: string; results?: readonly WorkerResultRecord[];
}): { package: ManualProjectionPackage; heldContests: readonly string[] } {
  requirePublication(input.plan.publication?.contractId === "ballot-contests" && input.plan.contract.schemaVersion === 2 &&
    input.plan.contract.recordClass === "BALLOT_MEASURE", "MEASURE_CONTRACT_UNRESOLVED");
  const checked = verifiedWorkerRecords(input), state = checked.contract.jurisdiction.state;
  const ballots: Record<string, BallotSet> = {}, heldContests: string[] = checked.heldRecordIds.map(id => `Unverified source row ${id}`), acceptedCaptures = new Set<WorkerPublicationCapture>();
  const pages = input.captures.filter(captureIntact);
  const identities = new Set<string>();
  for (const record of checked.extraction.records) {
    const fields = record.fields, number = text(fields.number), title = text(fields.title) || number, electionName = text(fields.election);
    const jurisdictionName = text(fields.jurisdictionName), questionText = text(fields.questionText), documentUrl = text(fields.textUrl);
    const divisions = input.registry?.payload.registry.divisions.filter(row => row.state.toUpperCase() === state && words(row.label) === words(jurisdictionName)) ?? [];
    const documents = pages.filter(row => row.evidence.canonicalUrl === documentUrl && row.evidence.text.includes(title) && row.evidence.text.includes(questionText))
      .sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt));
    const document = documents[0];
    const source = document?.evidence;
    const officialStatement = text(fields.officialStatement) || null;
    const designation = number || title;
    const identity = canonicalCivicDataJson([state, electionName, divisions[0]?.ocdId, designation]);
    const repeats = checked.extraction.records.filter(row => text(row.fields.election) === electionName &&
      words(text(row.fields.jurisdictionName)) === words(jurisdictionName) && (text(row.fields.number) || text(row.fields.title)) === designation).length;
    if (!title || !electionName || !/^https:\/\//.test(documentUrl) || divisions.length !== 1 ||
        jurisdictionFromOcdId(divisions[0].ocdId)?.usps !== state || repeats !== 1 || identities.has(identity)) {
      heldContests.push(`${electionName} / ${title || number} / ${jurisdictionName}`); continue;
    }
    identities.add(identity);
    const electionId = `${state.toLowerCase()}-${idHash([state, electionName])}`;
    const placePrefix = divisions[0].ocdId.split("/").length > 3 ? `${encodeURIComponent(divisions[0].ocdId)}:` : "";
    const contestId = `ballot-measure:${placePrefix}${idHash([state, electionId, divisions[0].ocdId, designation])}`;
    const provenance = { sourceUrl: checked.primary.evidence.canonicalUrl, sourceOrg: checked.primary.evidence.sourceId,
      collectedAt: checked.primary.observedAt, verifiedAt: input.now };
    const key = `${state}:${electionId}`;
    const ballot = ballots[key] ?? { election: { id: electionId, state, name: electionName, date: text(fields.electionDate) },
      contests: [], candidacies: [], measures: [], measureRecords: [], absences: [] };
    requirePublication(!text(fields.electionDate) || !ballot.election.date || text(fields.electionDate) === ballot.election.date, "MEASURE_ELECTION_DATE_CONFLICT");
    ballot.election.date ||= text(fields.electionDate);
    ballot.contests.push({ id: contestId, electionId, ocdId: divisions[0].ocdId, divisionVintage: divisions[0].sourceDataset,
      title, type: "MEASURE", measureTextUrl: documentUrl, voteFor: null, termYears: null, scopeNote: text(fields.scopeNote) || null, provenance });
    const reference = document?.sourceReference;
    const fullText = questionText && source && measureSourceReferenceValid(reference) && reference.sourceUrl === documentUrl &&
      reference.publisher === source.sourceId &&
      reference.sourceHash === source.contentHash.replace(/^sha256-/, "") && reference.retrievedAt === document.observedAt &&
      reference.vault.byteLength === Buffer.byteLength(source.text) &&
      !documents.some(row => Date.parse(row.observedAt) === Date.parse(document.observedAt) && row.evidence.contentHash !== source.contentHash) &&
      (!officialStatement || source.text.includes(officialStatement)) &&
      section3Page({ url: documentUrl, text: source.text, retrievedAt: document.observedAt,
        linkingPage: linkingPageFrom(documentUrl, pages.map(row => row.evidence)), sourcePolicy: document.sourcePolicy }, "BALLOT_MEASURE", input.now).ok;
    if (!fullText || !document || !source || !reference) {
      heldContests.push(`${electionName} / ${title} / full official text remains owed`);
      ballots[key] = ballot; continue;
    }
    acceptedCaptures.add(document);
    const measure: Measure = { id: `${contestId}#question`, contestId, ...(number ? { officialNumber: number } : {}), questionText, officialStatement,
      officialText: reference,
      provenance: { ...provenance, sourceUrl: documentUrl, sourceOrg: source.sourceId, collectedAt: document.observedAt } };
    ballot.measures.push(measure);
    ballot.measureRecords = [...ballot.measureRecords ?? [], { contestId, whatItDoes: officialStatement || questionText,
      ...explicitVoteMeanings(`${questionText}\n${officialStatement ?? ""}`), parts: [], sourceUrl: documentUrl,
      sourceHash: measure.officialText!.sourceHash, writtenAt: document.observedAt }];
    ballots[key] = ballot;
  }
  requirePublication(Object.keys(ballots).length > 0, "NO_SOURCE_BOUND_BALLOT_MEASURE");
  const authorities = new Set<WorkerPublicationCapture>();
  for (const document of acceptedCaptures) {
    const linking = linkingPageFrom(document.evidence.canonicalUrl, pages.map(row => row.evidence));
    if (linking) pages.filter(row => row.evidence.canonicalUrl === linking.url).forEach(row => { acceptedCaptures.add(row); authorities.add(row); });
  }
  const sourceAuthorities = [...authorities].flatMap(capture => capture.sourceReference ? [capture.sourceReference] : []);
  for (const ballot of Object.values(ballots)) ballot.sourceAuthorities = sourceAuthorities;
  const divisions = [...new Set(Object.values(ballots).flatMap(ballot => ballot.contests.map(contest => contest.ocdId)))];
  requirePublication(divisions.length === 1, "MEASURE_JOB_REQUIRES_ONE_PLACE");
  const ocdId = divisions[0], local = ocdId.split("/").length > 3;
  if (local) placeMeasureScope(ocdId);
  const payload: GenericBallotProjection | PlaceMeasureProjection = local ? { kind: "ballot-measures", ocdId, ballots } : { kind: "ballot-contests", ballots };
  return { heldContests, package: { contractId: local ? "ballot-measures" : "ballot-contests", version: `worker:${input.parser.id}`,
    sourceThrough: new Date(Math.max(...[checked.primary, ...acceptedCaptures].map(row => Date.parse(row.observedAt)))).toISOString(), sourceReceipt: section3SourceReceipt([...new Set([checked.primary, ...acceptedCaptures])], input.now,
      "Official ballot measure reader", "Code replayed the exact registered election/jurisdiction/number and held official full text; no paraphrase or inferred vote meaning."),
    payload } };
}
