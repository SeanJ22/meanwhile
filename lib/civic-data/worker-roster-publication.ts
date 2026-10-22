import { stateRegistryRuntimeContractId, stateFromRegistryRuntimeContractId } from "./state-scopes.ts";
import { recordPublicationFlow, saveWorkerPublicationOutcome } from "./publication-flow.ts";
import { SECTION3_MINIMUMS } from "../control-plane/promotion/section3.ts";
import { isQuotedExtraction, quotedSourceFindings } from "../control-plane/workers/quoted-proof.ts";
import { parserFieldSources } from "./field-sources.ts";
import { createHash } from "node:crypto";
import { canonicalJson } from "../control-plane/repository/types.ts";
import type { ArtifactRecord, ControlPlaneRepositories } from "../control-plane/repository/types.ts";
import type { WorkerEvidence, WorkerResultRecord } from "../control-plane/workers/types.ts";
import type { RegistryRuntimeCarton, RegistryRuntimePrior } from "../registry/runtime-data-plane.ts";
import type { WorkItem } from "../control-plane/work-item.ts";
import { readRegistryRuntimePrior, registryRuntimeCandidate, acceptedRegistryPrior } from "../registry/runtime-data-plane.ts";
import type { RoutineDataStore } from "./store.ts";
import { processRegisteredManualCandidate } from "./promotion.ts";
import { recordRoutineReaderProjectionReadback } from "./reader-verification.ts";
import { requiredManualProductionContract } from "./manual-contracts.ts";
import { sanitizedErrorDiagnostic } from "../ops/error-diagnostic.ts";
import { heldDirectoryReading, materializeBodyDirectoryWork, publishBodyOffice, workerBodyDirectoryPackage, type DirectoryReading } from "./worker-body-directory.ts";
import { runtimeKinds } from "../registry/kinds-runtime.ts";
import { publicationRecordChanges } from "./publication-record-changes.ts";
import { auditPull, capturesForPublication, captureIntact, jobWorkerResults, latestParserResult, validatorObservation } from "./worker-publication-evidence.ts";
import { readValidatorManual, writeValidatorLessons, type ValidatorObservation } from "../control-plane/promotion/validator-manual.ts";
import { readHeldRoster } from "./worker-held-roster.ts";
import { heldBodySchedule, type HeldBodySchedule } from "./worker-held-meetings.ts";
import { publicationCaptureReaders } from "./worker-publication-context.ts";
import { type OfficialLinkingPage } from "./source-authority.ts";
import { linkingPageFrom, pageWords, section3Page } from "../control-plane/promotion/section3.ts";
import { inventoryRecordEvidence } from "../control-plane/workers/record-evidence.ts";
import { compareCandidateWithSource } from "../control-plane/workers/record-verification.ts";
import { recordPublishedPageDoor, withPageDoor } from "./worker-page-doors.ts";
import { factClocks } from "../facts/clocks.ts";
import type { Clocks, FactDb, Query } from "../facts/publish.ts";
import { publishBodyFacts, publishRosterFacts, type RosterFactsReport } from "../facts/roster-facts.ts";
import { openBlank } from "../facts/publish.ts";
import { learnOfficialHost } from "../facts/entities.ts";

export interface WorkerPublicationCapture {
  readonly campaign?: import("../control-plane/promotion/section3.ts").Section3Page["campaign"];
  readonly sourcePolicy?: import("../control-plane/promotion/source-kinds.ts").SourcePolicy;
  readonly evidence: WorkerEvidence;
  /** Latest successful network observation, not the time an old blob was replayed. */
  readonly observedAt: string;
  readonly httpStatus: number | null;
  readonly transport: string;
  readonly partial: boolean;
}

export interface RosterReading {
  readonly id: string;
  readonly capture: WorkerPublicationCapture;
  readonly linkingPage: OfficialLinkingPage | null;
  readonly members: readonly { readonly recordId: string; readonly fields: Readonly<Record<string, unknown>>; readonly fieldSources?: Record<string, import("../sources/types.ts").Provenance> }[];
  /** Every member row on the page was read, so a prior member absent from it has left. */
  readonly complete: boolean;
  readonly method: string;
}

const requireThat = (value: unknown, reason: string): void => { if (!value) throw new Error(reason); };
const digest = (text: string) => createHash("sha256").update(text).digest("hex");

const words = (text: string) => text.replace(/<[^>]*>/g, " ").replace(/&(?:amp|nbsp);/g, " ").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const titleOf = (html: string) => words([/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "", ...[...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map(m => m[1])].join(" "));
const GOVERNING = /\b(council|mayor|select ?board|selectmen|board of (supervisors|commissioners|aldermen|selectmen)|township committee|commission(ers)?)\b/;
const SCHOOL_BOARD = /\b(governing board|school board|board of (education|trustees)|board members?|trustees)\b/;
const BODY_NAME = [/\b(city|town|village|borough|township) (council|commission|committee)\b/, /\bboard of (supervisors|commissioners|education|trustees|aldermen|selectmen)\b/,
  /\b(governing board|school board|select ?board|township committee)\b/, /\bcouncil\b/];
const titleCase = (text: string) => text.replace(/\b\p{L}/gu, c => c.toUpperCase());
const governmentOf = <D extends { readonly ocdId: string }>(divisions: readonly D[], { ocdId }: { readonly ocdId: string | null }): D | null =>
  divisions.find(row => row.ocdId === ocdId) ?? null;

/** A page read in code must name the body in its title or main heading: a city page's navigation names many bodies. */
export function pageIsAboutBody(html: string, body: { readonly id: string; readonly name: string | null }, divisionLabel: string | null, inTitle = true): boolean {
  const seat = /\/(?:sldl|sldu|cd):([a-z0-9-]+)#seat$/.exec(body.id)?.[1];
  if (seat) return seat === "at-large" ? ` ${words(html)} `.includes(" at large ") : ` ${words(html)} `.includes(` district ${seat.replace(/^0+/, "")} `);
  if (!inTitle && body.name) return words(html).includes(words(body.name));
  const title = titleOf(html);
  if (body.name) {
    const own = words(divisionLabel ? body.name.replace(new RegExp(divisionLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), "") : body.name);
    if (own.length > 0 && title.includes(own)) return true;
        // A bare "Commission" title is another body once the governing body has a name.
    return body.id.endsWith("#governing") && GOVERNING.test(title.replace(/\bcommission\b/g, ""));
  }
  if (body.id.endsWith("#governing")) return GOVERNING.test(title);
  if (body.id.endsWith("#board")) return SCHOOL_BOARD.test(title);
  return false;
}

export function bodyNameFromPage(html: string, divisionLabel: string): string | null {
  const text = pageWords(html);
  for (const pattern of BODY_NAME) {
    const match = pattern.exec(text);
    if (match) return `${divisionLabel} ${titleCase(match[0])}`;
  }
  return null;
}

function parserReading(parser: WorkerResultRecord, contract: NonNullable<WorkItem["autonomousPlan"]>["contract"], captures: readonly WorkerPublicationCapture[]): RosterReading | null {
  if (parser.result.role !== "PARSER" || contract.schemaVersion !== 2) return null;
  const extraction = parser.result;
  const capture = captures.find(c => c.evidence.artifactId === extraction.artifactId);
  if (!capture) return null;
  const replay = isQuotedExtraction(contract, extraction)
    ? quotedSourceFindings(extraction, { ...contract, requiredFields: SECTION3_MINIMUMS[contract.recordClass] ?? contract.requiredFields }, capture.evidence)
    : compareCandidateWithSource(extraction, contract, capture.evidence, inventoryRecordEvidence(capture.evidence, contract.extraction));
  if (replay.some(f => !f.recordId && !f.code.startsWith("COMPLETENESS_") && f.code !== "DECLARED_COUNT_MISMATCH")) return null;
  return { id: parser.id, capture, linkingPage: linkingPageFrom(capture.evidence.canonicalUrl, captures.map(c => c.evidence)),
    members: extraction.records.filter(record => !replay.some(f => f.recordId === record.id && (!f.field || ["name", "office"].includes(f.field))))
      .map(record => ({ recordId: record.id, fields: record.fields, fieldSources: parserFieldSources(record.id, record.fields, extraction.spans, captures, parser.endedAt) })),
    complete: !isQuotedExtraction(contract, extraction) && !replay.some(f => f.code.startsWith("COMPLETENESS_") || f.code === "DECLARED_COUNT_MISMATCH"), method: `Parser result ${parser.id}` };
}

export async function heldRosterReading(input: {
  readonly bodyId: string; readonly prior: RegistryRuntimePrior; readonly now: string;
  readonly artifacts: readonly ArtifactRecord[];
  readonly readHeld: (record: ArtifactRecord) => Promise<WorkerPublicationCapture | null>;
  readonly limit?: number;
}): Promise<RosterReading | null> {
  const body = input.prior.payload.registry.bodies.find(row => row.id === input.bodyId);
  if (!body) return null;
  const division = governmentOf(input.prior.payload.registry.divisions, body);
  const seen = new Set<string>();
  const candidates = [...input.artifacts].filter(a => !a.partial && /html/i.test(a.contentType) && a.canonicalUrl.startsWith("https://"))
    .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))
    .filter(a => !seen.has(a.contentHash) && Boolean(seen.add(a.contentHash)))
    .slice(0, input.limit ?? 40);
  for (const record of candidates) {
    const capture = await input.readHeld(record);
    if (!capture || !captureIntact(capture)) continue;
    const page = { url: capture.evidence.canonicalUrl, text: capture.evidence.text, retrievedAt: capture.observedAt, sourcePolicy: capture.sourcePolicy, campaign: capture.campaign };
    if (!section3Page(page, "OFFICIAL_ROSTER", input.now).ok || !pageIsAboutBody(capture.evidence.text, body, division?.label ?? null)) continue;
    const roster = readHeldRoster(capture.evidence.text, capture.evidence.canonicalUrl);
    if (!roster?.rows.length) continue;
    return { id: `held:${capture.evidence.artifactId}`, capture, linkingPage: null, complete: roster.complete, method: `Saved page ${capture.evidence.artifactId} read in code`,
      members: roster.rows.map(row => ({ recordId: `held:${digest(`${row.nameAsWritten}\n${row.office}`).slice(0, 16)}`,
        fields: Object.fromEntries(Object.entries(row).filter(([, v]) => v !== null)) })) };
  }
  return null;
}

type PublicationReport = readonly { workItemId: string; outcome: NonNullable<WorkItem["publicationOutcome"]> }[];

/** One body's roster reading as facts: only a page about this body counts, and an unnamed body takes the name its own page gives it. */
export async function publishBodyRoster(facts: FactDb & { readonly query: Query }, input: {
  readonly body: { readonly id: string; readonly name: string | null; readonly ocdId: string | null };
  readonly division: { readonly label: string } | null; readonly state: string | null;
  readonly reading: RosterReading; readonly schedule?: HeldBodySchedule | null; readonly clocks: Clocks; readonly now: Date;
}): Promise<RosterFactsReport> {
  const { body, division, reading } = input;
  const text = reading.capture.evidence.text;
  if (!pageIsAboutBody(text, body, division?.label ?? null, reading.id.startsWith("held:"))) {
    await openBlank(facts.query, { entityId: body.id, field: "members", stage: "CHECK", reason: "ROSTER_PAGE_NOT_THIS_BODY",
      detail: reading.capture.evidence.canonicalUrl, retryMinutes: input.clocks.retryMinutes("officeholder") });
    throw new Error("ROSTER_PAGE_NOT_THIS_BODY");
  }
  await learnOfficialHost(facts.query, body.id, reading.capture.evidence.canonicalUrl);
  const tally = await publishRosterFacts(facts, { body: { id: body.id, name: body.name, state: input.state, parentId: body.ocdId },
    capture: reading.capture, members: reading.members, complete: reading.complete, producedBy: reading.id }, input.clocks, input.now);
  const named = body.name === null && division ? bodyNameFromPage(text, division.label) : null;
  const own = named && division ? named.split(new RegExp(division.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")).join(" ").replace(/\s+/g, " ").trim() : "";
  if (named && own) await publishBodyFacts(facts, { bodyId: body.id, capture: reading.capture, producedBy: reading.id,
    facts: [{ field: "name", value: named, quote: own }] }, input.clocks, input.now);
  const schedule = input.schedule;
  if (schedule) await publishBodyFacts(facts, { bodyId: body.id, capture: schedule.capture, producedBy: `held-schedule:${schedule.capture.evidence.artifactId}`,
    facts: [["meeting_cadence", schedule.schedule.cadence], ["agenda_url", schedule.schedule.agendaUrl]].flatMap(([field, value]) =>
      value ? [{ field: field as "meeting_cadence" | "agenda_url", value, quote: value }] : []) }, input.clocks, input.now);
  return tally;
}

async function itemsOf(repos: ControlPlaneRepositories, rule: (item: WorkItem) => boolean, paths: readonly (readonly [readonly string[], string])[], ids: readonly string[] = []) {
  const rows = [...(await Promise.all(paths.map(([path, value]) => repos.workItems.listWhere(path, value)))).flat(),
    ...(await Promise.all(ids.map(id => repos.workItems.read(id)))).filter(row => row !== null)];
  return [...new Map(rows.map(row => [row.id, row.value])).entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, value]) => value).filter(rule);
}

/** Each owed roster becomes facts on its own; a member or field that fails its check stays a blank with the reason. */
export async function publishOwedRosterFacts(input: {
  readonly repos: ControlPlaneRepositories; readonly store: RoutineDataStore; readonly facts: FactDb & { readonly query: Query };
  readonly workItemIds: readonly string[]; readonly now: string;
  readonly readCapture: (id: string, results: readonly WorkerResultRecord[]) => Promise<WorkerPublicationCapture>;
  readonly readHeld?: (record: ArtifactRecord) => Promise<WorkerPublicationCapture | null>;
}): Promise<PublicationReport> {
  if (!input.workItemIds.length) return [];
  const clocks = factClocks((await input.repos.adminConfig.read("current"))?.value ?? null);
  const captureReaders = await publicationCaptureReaders(input.repos, input.readCapture, input.readHeld);
  const { readHeld } = captureReaders;
  const { results: records, readCapture } = await jobWorkerResults(input.repos, input.workItemIds, captureReaders.readCapture);
  const manual = await readValidatorManual(input.repos);
  const report: { workItemId: string; outcome: NonNullable<WorkItem["publicationOutcome"]> }[] = [];
  const heldByBody = new Map<string, Promise<RosterReading | null>>();
  for (const id of [...new Set(input.workItemIds)]) {
    const item = (await input.repos.workItems.mustRead(id)).value;
    const plan = item.autonomousPlan;
    if (!plan?.publication || !stateFromRegistryRuntimeContractId(plan.publication.contractId) || plan.contract.schemaVersion !== 2 || plan.contract.recordClass !== "OFFICIAL_ROSTER") continue;
    const bodyId = plan.publication.bodyId;
    const prior = await readRegistryRuntimePrior(input.store, input.now, plan.contract.jurisdiction.state);
    const body = prior?.payload.registry.bodies.find(row => row.id === bodyId);
    let outcome: NonNullable<WorkItem["publicationOutcome"]>;
    let reading: RosterReading | null = null;
    try {
      if (!body || !prior) throw new Error("ROSTER_BODY_UNREGISTERED");
      const parser = latestParserResult(records, id);
      const pull = parser ? auditPull(records, parser) : null;
      if (pull?.all) await input.facts.query(`INSERT INTO owner_flag(fact_id,kind,reason,source_url)
        SELECT f.id,'AUDIT_LOOKS_WRONG','The audit challenged this published roster.',s.url FROM fact f
        JOIN source_copy s ON s.id=f.source_copy_id WHERE f.entity_id=$1 AND f.field LIKE 'member:%' AND f.status='live'
        AND NOT EXISTS(SELECT 1 FROM owner_flag o WHERE o.fact_id=f.id AND o.resolved IS NULL)`,[bodyId]);
      const captures = parser ? await capturesForPublication({ repos: input.repos, workItemId: id, primaryId: (parser.result as { artifactId: string }).artifactId,
        results: records, readCapture, officialLinks: manual.officialLinks }) : [];
      reading = parser && !pull?.all ? parserReading(parser, plan.contract, captures) : null;
      if (reading && pull) {
        for (const member of reading.members.filter(member=>pull.recordIds.has(member.recordId))) {
          const name=String(member.fields.name ?? "");
          await input.facts.query(`INSERT INTO owner_flag(fact_id,kind,reason,source_url)
            SELECT f.id,'AUDIT_LOOKS_WRONG','The audit challenged this published member.',s.url FROM fact f
            JOIN source_copy s ON s.id=f.source_copy_id WHERE f.entity_id=$1 AND f.field LIKE 'member:%' AND f.status='live'
            AND f.value->>'name'=$2 AND NOT EXISTS(SELECT 1 FROM owner_flag o WHERE o.fact_id=f.id AND o.resolved IS NULL)`,[bodyId,name]);
        }
        reading = { ...reading,complete:false,members:reading.members.filter(member => !pull.recordIds.has(member.recordId)) };
      }
      if (!reading) {
        if (!heldByBody.has(bodyId)) heldByBody.set(bodyId, (async () => {
          const siblings = await itemsOf(input.repos, other => other.autonomousPlan?.publication?.bodyId === bodyId, [[["autonomousPlan", "publication", "bodyId"], bodyId]]);
          const artifacts = (await Promise.all(siblings.map(other => input.repos.artifacts.read(other.id)))).flat();
          return heldRosterReading({ bodyId, prior, now: input.now, artifacts, readHeld });
        })());
        reading = await heldByBody.get(bodyId)!;
      }
      if (reading && pull?.all) reading = {...reading,complete:false};
      if (!reading) throw new Error("ROSTER_NO_READABLE_SAVED_PAGE:No extraction yet, and no saved page for this body has a member table");
      if (item.publicationOutcome?.workerResultId === reading.id && item.publicationOutcome.status !== "HELD" && !(pull && pull.at > item.publicationOutcome.at)) {
        report.push({ workItemId: id, outcome: item.publicationOutcome });
        continue;
      }
      const division = governmentOf(prior.payload.registry.divisions, body);
      const siblings = await itemsOf(input.repos, other => other.autonomousPlan?.publication?.bodyId === bodyId || other.autonomousPlan?.contract.subjectId === plan.contract.subjectId,
        [[["autonomousPlan", "publication", "bodyId"], bodyId], [["autonomousPlan", "contract", "subjectId"], plan.contract.subjectId]]);
      const schedule = await heldBodySchedule({ body: { id: bodyId, name: body.name }, divisionLabel: division?.label ?? null,
        artifacts: (await Promise.all(siblings.map(other => input.repos.artifacts.read(other.id)))).flat(), readHeld, now: input.now });
      const tally = await publishBodyRoster(input.facts, { body, division, state: plan.jurisdiction.toUpperCase().slice(0, 2), reading, schedule, clocks, now: new Date(input.now) });
      const live = tally.live + tally.confirmed + tally.held;
      outcome = await withPageDoor(input.repos, { at: input.now, workerResultId: reading.id, status: live === 0 ? "HELD" : tally.blanks ? "PARTIALLY_PUBLISHED" : "PUBLISHED",
        code: live === 0 ? "ROSTER_FACTS_BLANK" : tally.live ? "VERIFIED_RESULT_PUBLISHED" : "VERIFIED_RESULT_REUSED",
        detail: `${tally.live} new and ${tally.confirmed} confirmed facts from ${reading.capture.evidence.canonicalUrl}; ${tally.blanks} stay open as blanks with their reasons` +
          (tally.departed ? `; ${tally.departed} no longer on the official roster.` : "."),
        records: { added: tally.live, changed: 0, reused: tally.confirmed },
        ...(live === 0 ? { recovery: "WORKER" as const } : {}), candidateId: null, versionId: null }, reading.capture, plan.contract.recordClass);
    } catch (error) {
      const detail = sanitizedErrorDiagnostic(error);
      outcome = { at: input.now, workerResultId: reading?.id ?? "none", status: "HELD", code: detail.split(":")[0]!, detail, recovery: "WORKER", candidateId: null, versionId: null };
    }
    // Written even when unchanged: a held roster is read again only for a page newer than this outcome's time.
    const current = await input.repos.workItems.mustRead(id);
    await saveWorkerPublicationOutcome(input.repos, current, outcome, input.now);
    report.push({ workItemId: id, outcome });
    if (outcome.code !== "VERIFIED_RESULT_REUSED" && reading) await recordPublishedPageDoor({ repos: input.repos, page: reading.capture, recordClass: plan.contract.recordClass, bodyId,
      ocdId: plan.contract.jurisdiction.canonicalId, workItemId: id, published: outcome.status === "HELD" ? 0 : 1, now: input.now });
  }
  return report;
}

/** A government's saved directory page publishes its boards and commissions and opens each one's own work. */
export async function publishWorkerDirectoryResults(input: {
  readonly repos: ControlPlaneRepositories; readonly store: RoutineDataStore; readonly facts: FactDb & { readonly query: Query };
  readonly workItemIds: readonly string[]; readonly now: string;
  readonly readCapture: (id: string, results: readonly WorkerResultRecord[]) => Promise<WorkerPublicationCapture>;
  readonly readHeld?: (record: ArtifactRecord) => Promise<WorkerPublicationCapture | null>;
}): Promise<PublicationReport> {
  if (!input.workItemIds.length) return [];
  const config = (await input.repos.adminConfig.read("current"))?.value ?? null;
  const kinds = runtimeKinds(config), clocks = factClocks(config);
  const captureReaders = await publicationCaptureReaders(input.repos, input.readCapture, input.readHeld);
  const { readHeld } = captureReaders;
  const { results: records, readCapture } = await jobWorkerResults(input.repos, input.workItemIds, captureReaders.readCapture);
  const report: { workItemId: string; outcome: NonNullable<WorkItem["publicationOutcome"]> }[] = [];
  let registry: RegistryRuntimePrior | null | undefined, registryState: string | undefined;
  const heldDirectories = new Map<string, Promise<DirectoryReading | null>>();
  const publishedByBody = new Map<string, NonNullable<WorkItem["publicationOutcome"]>>();
  const manual = await readValidatorManual(input.repos);
  const learned: ValidatorObservation[] = [];
  for (const id of [...new Set(input.workItemIds)]) {
    const item = (await input.repos.workItems.mustRead(id)).value;
    const plan = item.autonomousPlan;
    if (!plan?.publication || !stateFromRegistryRuntimeContractId(plan.publication.contractId) || plan.contract.schemaVersion !== 2 || plan.contract.recordClass !== "OFFICIAL_BOARD_DIRECTORY") continue;
    const bodyId = plan.publication.bodyId;
    let outcome: NonNullable<WorkItem["publicationOutcome"]>;
    let candidateId: string | null = null, versionId: string | null = null, readingId: string | null = null, parserId: string | null = null;
    let captures: WorkerPublicationCapture[] = [], heldDirectory: DirectoryReading | null = null, wentLive = 0;
    try {
      const state = plan.contract.jurisdiction.state;
      if (registryState !== state) { registry = undefined; registryState = state; }
      if (registry === undefined) registry = await readRegistryRuntimePrior(input.store, input.now, state);
      const prior = registry;
      if (!prior) throw new Error("ROSTER_PRIOR_READER_AUTHORITY_MISSING");
      const parser = latestParserResult(records, id);
      parserId = parser?.id ?? null;
      captures = parser ? await capturesForPublication({ repos: input.repos, workItemId: id, primaryId: (parser.result as { artifactId: string }).artifactId, results: records, readCapture, officialLinks: manual.officialLinks }) : [];
      if (!parser) {
        const government = plan.directorySubject?.jurisdiction.id ?? id;
        if (!heldDirectories.has(government)) heldDirectories.set(government, (async () => {
          const siblings = await itemsOf(input.repos, other => (other.autonomousPlan?.directorySubject?.jurisdiction.id ?? other.id) === government,
            [[["autonomousPlan", "directorySubject", "jurisdiction", "id"], government]], [government]);
          const artifacts = (await Promise.all(siblings.map(other => input.repos.artifacts.read(other.id)))).flat();
          return heldDirectoryReading({ plan, prior, now: input.now, artifacts, readHeld });
        })());
        heldDirectory = await heldDirectories.get(government)!;
        if (!heldDirectory) throw new Error("DIRECTORY_NO_READABLE_SAVED_PAGE:No saved official page for this government lists a board or commission that passes §3 yet");
      }
      readingId = parser?.id ?? heldDirectory!.id;
      const brokeAfter = parser ? auditPull(records, parser) : null;
      if (item.publicationOutcome?.workerResultId === readingId && item.publicationOutcome.sourceObservedAt && item.publicationOutcome.status !== "HELD" && !(brokeAfter && brokeAfter.at > item.publicationOutcome.at)) { report.push({ workItemId: id, outcome: item.publicationOutcome }); continue; }
      const already = publishedByBody.get(`${bodyId}\n${readingId}`);
      if (already) throw Object.assign(new Error("REUSED"), { reused: already });
      const directoryPackage = parser ? workerBodyDirectoryPackage({ plan, parser, captures, prior, now: input.now, results: records, kinds })
        : workerBodyDirectoryPackage({ plan, held: heldDirectory!, prior, now: input.now, kinds });
      const prepared = directoryPackage.prepared;
      const bodyFacts = (row: RegistryRuntimeCarton["registry"]["bodies"][number]) => ({ name: row.name, bodyClass: row.bodyClass, ocdId: row.ocdId, homepageUrl: row.homepageUrl });
      const changes = publicationRecordChanges({ previousVersionId: prior.versionId, accepted: prepared.payload.registry.bodies.map(body => {
        const previous = prior.payload.registry.bodies.find(row => row.id === body.id);
        return { recordId: body.id, readerId: body.id, value: bodyFacts(body), previous: previous ? bodyFacts(previous) : undefined };
      }) });
      const candidate = registryRuntimeCandidate(prepared, { prior });
      requireThat(prepared.payload.registry.bodies.every(body => canonicalJson(body) ===
        canonicalJson((candidate.readModel as RegistryRuntimeCarton).registry.bodies.find(row => row.id === body.id))), "WORKER_PUBLICATION_DIRECTORY_READER_FACTS_HELD");
      candidateId = candidate.id;
      const published = await processRegisteredManualCandidate(input.store, stateRegistryRuntimeContractId(state), candidate, input.now, prior.versionId);
      if (published.candidate.receipt?.decision === "GOOD") await recordPublicationFlow(input.repos, published.candidate.candidate.id,
        { workerResultId: readingId, stage: "CHECKED", records: changes.recordChanges.length,
          changedRecords: changes.records.added + changes.records.changed, versionId: null }, input.now);
      if (!published.promoted) { if (published.candidate.failureCode === "PROMOTION_BASE_CHANGED") registry = undefined; throw new Error(`${published.candidate.failureCode === "PROMOTION_BASE_CHANGED" ? "PROMOTION_BASE_CHANGED" : "DIRECTORY_READER_GATE_HELD"}:${published.candidate.failureDetail ?? published.candidate.state}`); }
      versionId = published.promoted.versionId;
      registry = undefined;
      if (!published.confirmed) {
        const readback = published.readerReadback ?? await recordRoutineReaderProjectionReadback(input.store,
          requiredManualProductionContract(stateRegistryRuntimeContractId(state)), published.promoted, input.now);
        if (readback?.status !== "PASS") throw new Error(`DIRECTORY_READER_READBACK_FAILED:${readback?.detail ?? "missing typed reader receipt"}`);
      }
      await recordPublicationFlow(input.repos, published.candidate.candidate.id,
        { workerResultId: readingId, stage: "LIVE", records: changes.recordChanges.length,
          changedRecords: published.confirmed ? 0 : changes.records.added + changes.records.changed, versionId }, input.now);
      registry = await acceptedRegistryPrior(input.store, published);
      for (const contact of directoryPackage.contacts) {
        await publishBodyOffice(input.facts, prepared.payload.registry.bodies.find(row => row.id === contact.bodyId)!, contact, readingId, clocks, new Date(input.now));
      }
      const count = prepared.payload.registry.bodies.length;
      const unresolved = directoryPackage.unresolved;
      outcome = { at: input.now, workerResultId: readingId, status: unresolved.length ? "PARTIALLY_PUBLISHED" : "PUBLISHED",
        code: unresolved.length ? "DIRECTORY_ROWS_REQUIRE_REPAIR" : published.confirmed ? "VERIFIED_RESULT_REUSED" : "VERIFIED_RESULT_PUBLISHED",
        detail: `§3 passed for ${count} reader bodies; the registry door accepted ${versionId} and typed reader readback passed.` +
          (unresolved.length ? ` ${unresolved.length} row(s) stay open as work: ${unresolved.join(", ")}.` : " Remaining information stays open as work."),
        ...(unresolved.length ? { recovery: "WORKER" as const } : {}), candidateId, versionId, ...changes, bodyIds: prepared.payload.registry.bodies.map(body => body.id) };
      try { await materializeBodyDirectoryWork({ repos: input.repos, parent: { ...item, publicationOutcome: outcome }, bodies: prepared.payload.registry.bodies, now: input.now }); }
      catch { throw new Error("DIRECTORY_DOWNSTREAM_WRITE_FAILED:Verified bodies remain published; recover their downstream assignments on the next publisher cycle"); }
      wentLive = count;
      publishedByBody.set(`${bodyId}\n${readingId}`, outcome);
    } catch (error) {
      const reused = (error as { reused?: NonNullable<WorkItem["publicationOutcome"]> }).reused;
      if (reused) outcome = reused.status === "HELD" ? { ...reused, at: input.now } : { ...reused, at: input.now, code: "VERIFIED_RESULT_REUSED",
        detail: `The same verified reading was published for this body in this pass (${reused.versionId}). ${reused.detail}` };
      else {
        const detail = sanitizedErrorDiagnostic(error);
        const code = detail.split(":")[0]!;
        const recovery = code.startsWith("WORKER_PUBLICATION_") || code === "DIRECTORY_NO_READABLE_SAVED_PAGE" ? "WORKER" : "PUBLISHER";
        outcome = { at: input.now, workerResultId: readingId ?? parserId ?? "none", status: "HELD", code,
          detail: `${detail}. ${recovery === "WORKER" ? "Continue source work through the existing worker" : "Retry the publication with the verified evidence retained"}; no owner approval is required.`, recovery, candidateId, versionId };
        if (readingId && code !== "PROMOTION_BASE_CHANGED") publishedByBody.set(`${bodyId}\n${readingId}`, outcome);
      }
    }
    const current = await input.repos.workItems.mustRead(id);
    const pages = captures.length ? captures : [heldDirectory?.checked.primary].filter((c): c is WorkerPublicationCapture => Boolean(c));
    outcome = await withPageDoor(input.repos, outcome, pages[0], plan.contract.recordClass);
    await saveWorkerPublicationOutcome(input.repos, current, outcome, input.now);
    report.push({ workItemId: id, outcome });
    if (outcome.code !== "VERIFIED_RESULT_REUSED") await recordPublishedPageDoor({ repos: input.repos, page: pages[0], recordClass: plan.contract.recordClass, bodyId, ocdId: plan.contract.jurisdiction.canonicalId, workItemId: id, published: wentLive, now: input.now });
    if (outcome.code !== "VERIFIED_RESULT_REUSED") learned.push(validatorObservation({ plan, workItemId: id, page: pages[0], captures: pages, published: wentLive, outcome }));
  }
  await writeValidatorLessons(input.repos, learned, input.now);
  return report;
}
