import type { ScoutCandidate, ScoutResult } from "../scheduler/scout-result.ts";
import type { AutonomousWorkPlan } from "./autonomous-plan.ts";
import type { ControlPlaneRepositories } from "../repository/types.ts";
import { canonicalJson } from "../repository/types.ts";
import { fingerprint } from "../ids.ts";
import { createWorkItem, type WorkItem } from "../work-item.ts";
import { registerWorkItem } from "../repository/coordinator.ts";
import { assertAutonomousPlanIdentity, registerAutonomousPlan } from "./coordinator.ts";
import type { GeneralizedCivicExtractionContract, RecordExtractionShape, VerificationAuthority, WorkerEvidence } from "./types.ts";
import type { ObservedResearchRoute, ResearchSpan } from "./research-types.ts";
import { parseGeneralizedRecords } from "./generalized-parser.ts";
import { verifyExternalAuthorities } from "./record-verification.ts";
import { assertGeneralizedScope, rosterTableFieldOmissions } from "./record-evidence.ts";
import { createHash } from "node:crypto";
import { PERMISSION_STATES } from "../../workstate/types.ts";
import { WORKER_READER_CLASSES } from "../../civic-data/worker-reader-contracts.ts";

export const PLAN_REPAIR_CLASSES = ["OFFICIAL_DOCUMENT_SITEMAP", "OFFICIAL_BOARD_DIRECTORY", "OFFICIAL_SOURCE_SCHEMA", "CANDIDATE_FILING_DOCUMENT", "OFFICIAL_ROSTER", "CAMPAIGN_FINANCE_FILING", ...Object.values(WORKER_READER_CLASSES)] as const;
export interface PlanRepairLink {
  readonly parentWorkItemId: string; readonly rootWorkItemId: string; readonly depth: number;
  readonly proposalHash: string; readonly scoutAttemptId: string; readonly sourceArtifactId: string;
  readonly retainedEvidenceIds: readonly string[]; readonly admittedAt: string;
  readonly authority: "WORK_INSTRUCTIONS_ONLY"; readonly unresolved: readonly string[];
}
type LinkedWorkItem = WorkItem & { readonly planRepair?: PlanRepairLink; readonly planRepairObservations?: Readonly<Record<string, RepairObservation>> };
export interface RepairObservation { readonly parentWorkItemId: string; readonly scoutAttemptId: string; readonly code: string; readonly successorWorkItemId: string | null; readonly detail: string; }
export function planRepairFailureBrief(item: WorkItem): string[] {
  return Object.values((item as LinkedWorkItem).planRepairObservations ?? {}).filter(row => !row.successorWorkItemId)
    .map(row => `Prior contract repair ${row.scoutAttemptId} was refused: ${row.code}. ${row.detail} Change the failed evidence, route or mapping; do not resubmit the unchanged proposal.`);
}
function requireThat(condition: unknown, code: string): asserts condition { if (!condition) throw new Error(code); }
/** A robots.txt verdict the vault records (ALLOWED, DISALLOWED, CANNOT_TELL, NOT_APPLICABLE). Evidence, never a refusal. */
function isRecordedRobotsVerdict(value: unknown): boolean { return (PERMISSION_STATES as readonly unknown[]).includes(value); }
function origin(value: string): string {
  const url = new URL(value); requireThat(url.protocol === "https:" && !url.username && !url.password && (!url.port || url.port === "443"), "REPAIR_PUBLIC_HTTPS_REQUIRED"); return url.origin;
}
function shape(value: unknown): RecordExtractionShape {
  requireThat(value && typeof value === "object" && !Array.isArray(value), "REPAIR_EXTRACTION_MISSING");
  const candidate = value as RecordExtractionShape;
  requireThat(candidate.format !== "UNSUPPORTED", "REPAIR_ADAPTER_IMPLEMENTATION_REQUIRED");
  requireThat(["JSON_RECORDS", "XML_RECORDS", "HTML_TABLE", "HTML_PROFILE", "DELIMITED_TEXT", "TEXT_BLOCKS"].includes(candidate.format), "REPAIR_ADAPTER_IMPLEMENTATION_REQUIRED");
  requireThat(candidate.fields && Object.keys(candidate.fields).length > 0 && Object.keys(candidate.fields).length <= 32, "REPAIR_MAPPING_BOUND");
  return candidate;
}

/**
 * A proposal that binds the captured source and names no parsing rule (`format: "UNSUPPORTED"`). It is admitted as a bound contract:
 * the Parser then pulls the fields with exact quotes and code confirms each one (model-parser.ts), and the Validator and Auditor replay
 * those quotes against the immutable artifact. Nothing is invented here: no mapping, no fields, no authority is created.
 */
function unmappedShape(value: unknown): (RecordExtractionShape & { readonly format: "UNSUPPORTED" }) | null {
  if (!value || typeof value !== "object" || Array.isArray(value) || (value as { format?: unknown }).format !== "UNSUPPORTED") return null;
  const mediaType = (value as { mediaType?: unknown }).mediaType;
  return { format: "UNSUPPORTED", fields: {}, mediaType: typeof mediaType === "string" && /^[\w.+/-]{1,100}$/.test(mediaType) ? mediaType : "unobserved",
    reason: "Bound to the captured source. No parsing rule exists for this record type, so a model pulls the fields with exact quotes and code confirms each quote is in the saved document." };
}

/** No side effects and no civic receipt: replay only decides whether instructions are executable. */
export function evaluatePlanRepair(input: { plan: AutonomousWorkPlan; candidate: ScoutCandidate; evidence: readonly WorkerEvidence[]; now: string;
  observedAtByArtifact?: ReadonlyMap<string, string>; registeredPublisherAddress?: string | null }) {
  const { plan, candidate, evidence, now } = input;
  requireThat(plan.contract.schemaVersion === 2 && (PLAN_REPAIR_CLASSES as readonly string[]).includes(plan.contract.recordClass), "REPAIR_CLASS_NOT_ADMITTED");
  // The robots.txt verdict is a record, never a gate: any recorded verdict is admitted.
  requireThat(candidate.recordClass === plan.contract.recordClass && isRecordedRobotsVerdict(candidate.permission), "REPAIR_CANDIDATE_SCOPE_MISMATCH");
  requireThat(candidate.contractRepair && Buffer.byteLength(canonicalJson(candidate.contractRepair)) <= 32_768, "REPAIR_PROPOSAL_BOUND");
  const proposal = candidate.contractRepair as { schemaVersion?: unknown; sourceArtifactId?: unknown; extraction?: unknown; authorities?: unknown };
  requireThat(Object.keys(proposal).every(key => ["schemaVersion", "sourceArtifactId", "extraction", "authorities"].includes(key)) && proposal.schemaVersion === 1 && typeof proposal.sourceArtifactId === "string", "REPAIR_PROPOSAL_INVALID");
  requireThat(Array.isArray(proposal.authorities) && proposal.authorities.length <= 16, "REPAIR_AUTHORITY_BOUND");
  const cited = new Set(candidate.evidenceArtifactIds);
  requireThat(cited.size > 0 && cited.size <= 16 && evidence.length === cited.size && evidence.every(row => cited.has(row.artifactId)), "REPAIR_EVIDENCE_BOUND");
  for (const row of evidence) {
    const observedAt = input.observedAtByArtifact?.get(row.artifactId) ?? row.retrievedAt;
    requireThat(Date.parse(observedAt) >= Date.parse(row.retrievedAt), "REPAIR_OBSERVATION_PRECEDES_CAPTURE");
    const age = Date.parse(now) - Date.parse(observedAt);
    requireThat(Number.isFinite(age) && age >= 0 && age <= 24 * 3_600_000, "REPAIR_EVIDENCE_STALE");
    requireThat(/^sha256-[a-f0-9]{64}$/.test(row.contentHash) && row.acquiredByAttemptId && row.text.length > 0, "REPAIR_EVIDENCE_PROVENANCE_MISSING");
    requireThat(row.contentHash === `sha256-${createHash("sha256").update(row.text).digest("hex")}`, "REPAIR_EVIDENCE_HASH_MISMATCH");
  }
  const primary = evidence.find(row => row.artifactId === proposal.sourceArtifactId);
  requireThat(primary && primary.canonicalUrl === candidate.url, "REPAIR_SOURCE_CAPTURE_MISSING");
  const trustedOrigins = [...plan.seedUrls, ...plan.sources.map(source => source.url), ...plan.contract.sourceScope.canonicalUrls].map(origin);
  // A registry homepage over HTTP may match a Scout's HTTPS capture of the same host; it is an identity lead resolved by subject, and the bytes still pass every check below.
  const primaryOrigin = origin(primary.canonicalUrl);
  let registeredOrigin: string | null = null;
  if (!trustedOrigins.includes(primaryOrigin) && input.registeredPublisherAddress) {
    try {
      const registered = new URL(input.registeredPublisherAddress);
      const captured = new URL(primary.canonicalUrl);
      requireThat(["http:", "https:"].includes(registered.protocol) && !registered.username && !registered.password &&
        !registered.port && registered.hostname === captured.hostname, "REPAIR_REGISTERED_PUBLISHER_HOST_MISMATCH");
      registeredOrigin = captured.origin;
    } catch (error) {
      if (error instanceof Error && error.message === "REPAIR_REGISTERED_PUBLISHER_HOST_MISMATCH") throw error;
      throw new Error("REPAIR_REGISTERED_PUBLISHER_ADDRESS_INVALID");
    }
  }
  requireThat(trustedOrigins.includes(primaryOrigin) || registeredOrigin === primaryOrigin, "REPAIR_PUBLISHER_SCOPE_MISMATCH");
  // Neither subject, jurisdiction, class, identity, required fields nor any
  // identity/denominator Detective can be weakened by a model proposal.
  const unmapped = unmappedShape(proposal.extraction);
  // An authority compares mapped record values, so it cannot ride with a source that has no mapping.
  requireThat(!unmapped || (proposal.authorities as unknown[]).length === 0, "REPAIR_ADAPTER_IMPLEMENTATION_REQUIRED");
  const extraction = unmapped ?? shape(proposal.extraction);
  if (plan.contract.recordClass === "OFFICIAL_ROSTER" && !unmapped) {
    const omissions = rosterTableFieldOmissions(primary, extraction);
    requireThat(omissions.length === 0, `REPAIR_SUPPORTED_FIELDS_OMITTED:${omissions.join(",")}`);
  }
  const authorities = proposal.authorities as VerificationAuthority[];
  requireThat(authorities.length >= plan.contract.verification.authorities.length, "REPAIR_VERIFICATION_CANNOT_WEAKEN");
  requireThat(plan.contract.verification.authorities.every(prior => authorities.some(next => canonicalJson(next) === canonicalJson(prior))), "REPAIR_AUTHORITY_CANNOT_REMOVE");
  for (const authority of authorities) {
    requireThat(authority && ["GOVERNMENT_REGISTER", "STATUTORY_RECORD", "OFFICIAL_DENOMINATOR"].includes(authority.type) &&
      ["DISTINCT_AUTHORITY", "INDEPENDENT_OFFICIAL_RECORD"].includes(authority.independenceBasis) &&
      typeof authority.publisher === "string" && authority.publisher.trim().length >= 4 && typeof authority.independenceExplanation === "string" && authority.independenceExplanation.trim().length >= 20,
      "REPAIR_OFFICIAL_AUTHORITY_REQUIRED");
    requireThat(Array.isArray(authority.artifactIds) && authority.artifactIds.length > 0 && Array.isArray(authority.authorityEvidenceArtifactIds) && authority.authorityEvidenceArtifactIds.length > 0 &&
      [...authority.artifactIds, ...authority.authorityEvidenceArtifactIds].every(id => cited.has(id)), "REPAIR_AUTHORITY_EVIDENCE_MISSING");
    requireThat((authority.sourceId !== primary.sourceId || authority.independenceBasis === "INDEPENDENT_OFFICIAL_RECORD") &&
      ["RECORD_VALUES", "RECORD_VALUES_SUBSET"].includes(authority.comparison?.kind) && authority.comparison.fields.length > 0 &&
      [...plan.contract.requiredFields, ...plan.contract.identity.keyFields].every(field => authority.comparison.fields.includes(field)), "REPAIR_AUTHORITY_BURDEN_MISMATCH");
    shape(authority.extraction);
    for (const id of [...authority.artifactIds, ...authority.authorityEvidenceArtifactIds]) {
      const row = evidence.find(entry => entry.artifactId === id)!;
      const host = new URL(row.canonicalUrl).hostname;
      // Public schools and colleges often publish on .org/.edu. Accept their
      // already established publisher, not an arbitrary newly proposed host.
      const knownPublisher = plan.sources.some(source => source.sourceId === authority.sourceId &&
        source.publisher === authority.publisher && origin(source.url) === origin(row.canonicalUrl));
      const samePublisherRecord = authority.independenceBasis === "INDEPENDENT_OFFICIAL_RECORD" &&
        authority.sourceId === primary.sourceId && authority.publisher === plan.contract.sourceScope.publisher &&
        origin(row.canonicalUrl) === origin(primary.canonicalUrl);
      requireThat((host.endsWith(".gov") || host.endsWith(".state.nj.us") || knownPublisher || samePublisherRecord) &&
        row.sourceId === authority.sourceId && row.canonicalUrl !== primary.canonicalUrl && row.contentHash !== primary.contentHash &&
        (authority.independenceBasis === "INDEPENDENT_OFFICIAL_RECORD" || origin(row.canonicalUrl) !== origin(primary.canonicalUrl)),
        "REPAIR_AUTHORITY_NOT_INDEPENDENT");
    }
    requireThat(authority.authorityEvidenceArtifactIds.some(id => evidence.find(row => row.artifactId === id)!.text.includes(authority.publisher)), "REPAIR_AUTHORITY_IDENTITY_UNPROVEN");
  }
  const sourceScope = { ...plan.contract.sourceScope, sourceId: primary.sourceId, canonicalUrls: [primary.canonicalUrl],
    routeIds: [...new Set([candidate.routeId, primary.methodRouteId])], observationArtifactIds: [...cited] };
  const contract: GeneralizedCivicExtractionContract = { ...plan.contract, sourceScope, extraction, verification: { ...plan.contract.verification, authorities } };
  assertGeneralizedScope(contract, primary);
  if (unmapped) {
    return { contract, primary, unresolved: ["EXTRACTION_BY_QUOTED_MODEL", ...(contract.verification.required && !authorities.length ? ["EXTERNAL_VERIFICATION_MISSING"] : [])], profileRoutes: [] as ObservedResearchRoute[],
      proposalHash: fingerprint([canonicalJson(contract), primary.contentHash]) };
  }
  // These local replay IDs are not Attempts and are never written as worker
  // results, counts, verification timestamps or promotion evidence.
  const replay = parseGeneralizedRecords({ attemptId: "contract-instruction-replay", worker: { role: "PARSER", provider: "local-preflight", version: "1", instance: "contract-instruction-replay" }, evidence: primary, contract }, contract);
  requireThat(replay.verdict === "EXTRACTED" && replay.warnings.every(issue => issue.severity === "INFO"), `REPAIR_EXTRACTION_REFUSED:${replay.warnings.map(issue => issue.code).join(",")}`);
  const checks = verifyExternalAuthorities({ attemptId: "contract-instruction-comparison", producerAttemptId: replay.attemptId, candidate: replay,
    evidence: primary, authorityEvidence: evidence, verifiedAt: now }, contract);
  // A profile that contradicts one source row while confirming another holds only that person; identity, source, count and incomplete-capture defects stay global.
  const localSubsetDisagreement = (check: typeof checks[number]) =>
    contract.recordClass === "OFFICIAL_ROSTER" && check.comparison.kind === "RECORD_VALUES_SUBSET" &&
    check.discrepancies.length > 0 && check.discrepancies.every(issue =>
      issue.code === "EXTERNAL_FIELD_MISMATCH" && issue.severity === "BLOCKING" &&
      Boolean(issue.recordId && issue.field && replay.records.some(record => record.id === issue.recordId) &&
        check.comparison.fields.includes(issue.field)));
  requireThat(checks.every(check => check.verdict === "PASS" || localSubsetDisagreement(check)),
    `REPAIR_AUTHORITY_COMPARISON_REFUSED:${checks.flatMap(check => check.discrepancies.map(issue => issue.code)).join(",")}`);
  const contradictedIds = new Set(checks.flatMap(check => check.discrepancies
    .filter(issue => issue.severity !== "INFO" && issue.recordId).map(issue => issue.recordId!)));
  const verifiedIds = new Set(checks.flatMap(check => check.verifiedRecordIds ?? []).filter(id => !contradictedIds.has(id)));
  const rosterUnverified = contract.verification.required && contract.recordClass === "OFFICIAL_ROSTER" ? replay.records.filter(record => !verifiedIds.has(record.id)).length : 0;
  const unresolved = [...(contract.verification.required && !authorities.length ? ["EXTERNAL_VERIFICATION_MISSING"] : []),
    ...(rosterUnverified ? [`UNVERIFIED_ROSTER_MEMBERS:${rosterUnverified}`] : []),
    ...replay.warnings.filter(issue => issue.severity === "INFO" && issue.field).map(issue =>
      `OPTIONAL_FIELD_UNRESOLVED:${issue.recordId}:${issue.field}:${issue.code}`)];
  // A verified source row can itself point to independent official profile
  // pages. The route is grounded in the exact href span; it is an acquisition
  // instruction, never authority evidence or a pre-approved comparison.
  const profileRoutes: ObservedResearchRoute[] = [];
  if (contract.recordClass === "OFFICIAL_ROSTER") {
    const seen = new Set<string>();
    const spans = new Map(replay.spans.map(span => [span.id, span] as const));
    for (const record of replay.records) {
      const url = record.fields.websiteUrl;
      const link = record.evidenceSpanIds.map(id => spans.get(id)).find(span => span?.field === "websiteUrl" && span.jsonPointer.endsWith("/@href"));
      const identity = record.evidenceSpanIds.map(id => spans.get(id)).filter((span): span is NonNullable<typeof span> => span?.field === "name" || span?.field === "office");
      if (typeof url !== "string" || !link || !identity.length || seen.has(url)) continue;
      const hrefs = [...link.quote.matchAll(/<a\b[^>]*\bhref\s*=\s*(["'])(.*?)\1/gi)];
      if (hrefs.length !== 1) continue;
      const locator = hrefs[0]![2]!.replace(/&amp;/gi, "&");
      try { if (new URL(locator, primary.canonicalUrl).href !== url || origin(url) !== origin(primary.canonicalUrl) || url === primary.canonicalUrl) continue; }
      catch { continue; }
      seen.add(url);
      const sourceSpan = (span: typeof link): ResearchSpan => ({ artifactId: span.artifactId, contentHash: span.contentHash,
        start: span.start, end: span.end, quote: span.quote, offsetUnit: "UTF16_CODE_UNITS" });
      profileRoutes.push({ id: `profile:${fingerprint([record.id, url])}`, subjectId: contract.subjectId,
        jurisdiction: plan.jurisdiction, recordClass: contract.recordClass, sourceId: primary.sourceId,
        publisher: contract.sourceScope.publisher, url, observedLocator: locator,
        observedAt: input.observedAtByArtifact?.get(primary.artifactId) ?? primary.retrievedAt, firstObservedAt: primary.retrievedAt,
        methodVersion: contract.methodVersion, permission: candidate.permission, observation: sourceSpan(link),
        publisherSubjectEvidence: identity.map(sourceSpan), applicableBecause: `Official roster links this named member to a separate profile record; acquire it for independent name and office comparison.`,
        nextRouteIds: ["INDEPENDENT_MEMBER_OFFICE_CORROBORATION"], retrieval: "fetch_public" });
    }
  }
  return { contract, primary, unresolved, profileRoutes, proposalHash: fingerprint([canonicalJson(contract), primary.contentHash]) };
}

export function planRepairBrief(plan: AutonomousWorkPlan): string {
  if (plan.contract.schemaVersion !== 2 || !(PLAN_REPAIR_CLASSES as readonly string[]).includes(plan.contract.recordClass)) return "";
  const fields = Object.fromEntries([...new Set([...plan.contract.requiredFields, ...plan.contract.identity.keyFields])].map(name => [name, { source: `/${name}`, type: "STRING" as const }]));
  // Typed examples keep the model-visible grammar tied to the executor types.
  const examples: RecordExtractionShape[] = [
    { format: "JSON_RECORDS", rowsPointer: "/records", fields },
    { format: "XML_RECORDS", rowTag: "record", fields: { [Object.keys(fields)[0]]: { source: "fieldName", type: "STRING" } } },
    { format: "HTML_TABLE", tableIndex: 0, headerRows: 1, fields: { [Object.keys(fields)[0]]: { source: 0, type: "STRING" }, websiteUrl: { source: 0, type: "STRING", attribute: "href" } } },
    { format: "HTML_PROFILE", fields: { name: { source: "heading:detail-title", type: "STRING" }, office: { source: "detail:Title", type: "STRING" } } },
    { format: "DELIMITED_TEXT", delimiter: ",", headerRows: 1, fields: { [Object.keys(fields)[0]]: { source: 0, type: "STRING" } } },
    { format: "TEXT_BLOCKS", recordStart: "Name:", recordEnd: "End of record", fields: { [Object.keys(fields)[0]]: { source: "Name:", type: "STRING" } } },
  ];
  const authority: VerificationAuthority = { id: "replace-with-register-id", type: "GOVERNMENT_REGISTER", publisher: "replace-with-actual-publisher-quoted-in-evidence",
    sourceId: "replace-with-captured-source-id", canonicalUrls: ["https://replace-with-actual-register.gov/records"], artifactIds: ["replace-with-actual-record-artifact-id"],
    authorityEvidenceArtifactIds: ["replace-with-actual-publisher-evidence-artifact-id"], independenceBasis: "DISTINCT_AUTHORITY",
    independenceExplanation: "Replace with the evidenced reason this distinct government authority independently publishes these records.", extraction: examples[0],
    comparison: { kind: "RECORD_VALUES", keyFields: [...plan.contract.identity.keyFields], fields: Object.keys(fields) } };
  const grammar = ` Exact extraction descriptor examples: ${JSON.stringify(examples)}. Replace every example locator with one inspected in retained bytes. JSON rowsPointer is an RFC6901 pointer to an array (empty string selects a root array); optional countPointer locates a published count. JSON field source is an RFC6901 pointer relative to each row. XML rowTag and field source are element names. HTML tableIndex and numeric field source are zero-based indexes; headerRows counts excluded headers. An HTML_TABLE field may use attribute:"href" only when the source cell contains one explicit anchor; its URL resolves against the captured page and remains bound to that exact cell span. HTML_PROFILE reads exactly one visible h2.detail-title and ul.detail-list; field sources are heading:detail-title or detail:Label (for example detail:Title), never script text, image alt, or a guessed address. Delimited text accepts only comma or tab. Every fields entry is {source:string|number,type:STRING|NUMBER|BOOLEAN|SCALAR}; map every required and identity field plus all independently supported contact and profile-link fields, at most32. Do not infer emails from an Email button or assign a shared office phone to a person. Exact authority descriptor example: ${JSON.stringify(authority)}. For independently captured official profile records, RECORD_VALUES_SUBSET with keyFields:["name"] and fields:["name","office"] may corroborate only explicitly matched members; all other members remain unverified. Up to16 separately mapped authorities and16 cited artifacts permit a seven-profile council without a four-source ceiling; continue through linked repair successors when a technical slice is incomplete. Examples are grammar only, never evidence or permission to guess values.`;
  const brief = `CONTRACT REPAIR remains owed. Existing class ${plan.contract.recordClass}; required fields ${plan.contract.requiredFields.join(", ")}; identity ${plan.contract.identity.keyFields.join(", ")}; shape ${plan.contract.extraction.format}; independent authorities ${plan.contract.verification.authorities.length}. Acquire actual official source bytes using the existing tools, then optionally attach contractRepair to a finish candidate: {schemaVersion:1,sourceArtifactId,extraction,authorities}. Extraction uses an implemented JSON_RECORDS, XML_RECORDS, HTML_TABLE, HTML_PROFILE, DELIMITED_TEXT or TEXT_BLOCKS mapping; cite every source/authority artifact in evidenceArtifactIds. For PDFs, cite the retained PDF_TEXT or PDF_TABLES transcription artifact, never the binary id as text. PDF_TABLES uses JSON_RECORDS over /tables/<index>/rows with numeric member pointers and an explicitly observed headerRows count. TEXT_BLOCKS uses exact literal recordStart/recordEnd boundaries and field source labels from retained text; no guessed offsets or regular expressions. Incomplete pages remain unverified and require another source or extraction repair. Each proposed authority needs an actual government register, statutory record or official denominator, exact source identity evidence, sourceId/canonicalUrls/artifactIds/authorityEvidenceArtifactIds, a documented DISTINCT_AUTHORITY or INDEPENDENT_OFFICIAL_RECORD basis, extraction and a RECORD_VALUES comparison covering all required/identity fields. For a roster only, separate official profile captures may use RECORD_VALUES_SUBSET over name and office; this verifies matched members individually and never proves all source rows or the government's full roster. A .org/.edu or other non-government-suffix publisher must already be established by the parent plan with the same source ID, publisher and origin. A separate record from the primary publisher must name that exact publisher and use different captured bytes and a different URL; repeating the source is refused. Keep the parent verification setting and every existing authority. An empty authorities list leaves external verification unresolved only when the parent already requires it. Subject, class, identity and existing Detective burdens cannot change. A replayed proposal creates only linked work instructions; independent workers must still execute every real check.`;
  const unmapped = ` When the retained bytes are real but no honest mapping exists (a PDF, a scanned agenda, a prose page), propose ${JSON.stringify({ schemaVersion: 1, sourceArtifactId: "<the retained artifact id>", extraction: { format: "UNSUPPORTED", mediaType: "<its media type>" }, authorities: [] })}: the Parser will pull the fields with exact quotes and code will confirm each quote is in the retained text. Cite the retained PDF_TEXT transcription for a PDF. Never combine this form with authorities.`;
  return brief + grammar + unmapped;
}

/** A successor may cite the exact retained bytes that its repair chain handed
 * forward, while unrelated work or unhanded ancestor captures remain barred. */
function inheritedRepairCaptures(item: LinkedWorkItem, items: readonly LinkedWorkItem[]): { workItemIds: ReadonlySet<string>; artifactIds: ReadonlySet<string> } {
  const workItemIds = new Set([item.id]);
  const artifactIds = new Set<string>();
  let cursor = item;
  while (cursor.planRepair) {
    const link = cursor.planRepair;
    const prior = items.find(row => row.id === link.parentWorkItemId);
    requireThat(prior && !workItemIds.has(prior.id) && prior.project === item.project && prior.subject === item.subject &&
      link.authority === "WORK_INSTRUCTIONS_ONLY", "REPAIR_LINEAGE_INVALID");
    workItemIds.add(prior.id);
    for (const id of [...link.retainedEvidenceIds, link.sourceArtifactId]) artifactIds.add(id);
    cursor = prior;
  }
  return { workItemIds, artifactIds };
}

/** Consume only completed accepted Scout records; bounded, deduplicated, no acquisition here. */
export async function consumePlanRepairs(input: { repos: ControlPlaneRepositories; scouts: readonly ScoutResult[]; now: string;
  registeredPublisherAddressFor?: (subjectId: string) => string | null;
  /** Exact same-occurrence captures selected and checked by the runtime broker; never model-declared lineage. */
  authorizedSiblingArtifactIdsFor?: (parent: WorkItem) => readonly string[];
  readCapture: (id: string) => Promise<{ evidence: WorkerEvidence; permission: string; transport: string; httpStatus: number | null; partial: boolean }> }): Promise<readonly RepairObservation[]> {
  const observations: RepairObservation[] = [];
  const items = (await input.repos.workItems.list()).map(row => row.value as LinkedWorkItem);
  const attempts = new Map((await input.repos.attempts.list()).map(row => [row.id, row.value]));
  for (const scout of [...input.scouts].reverse()) {
    const candidates = scout.candidates.filter(candidate => candidate.contractRepair !== undefined);
    if (!candidates.length || scout.refusal !== null) continue;
    const parent = items.find(item => item.id === scout.workItemId);
    const proposalAttempt = attempts.get(scout.attemptId);
    if (!parent?.autonomousPlan || proposalAttempt?.outcome !== "COMPLETED" || proposalAttempt.workItemId !== parent.id || proposalAttempt.worker.role !== "SCOUT") continue;
    const replayed = items.find(item => item.planRepair?.parentWorkItemId === parent.id && item.planRepair.scoutAttemptId === scout.attemptId);
    // Completed immutable proposals never consume this cycle's new-work budget.
    // An interrupted older registration must be recovered before it can count.
    if (replayed?.autonomousPlan || (!replayed && parent.planRepairObservations?.[scout.attemptId])) continue;
    if (observations.length >= 7) break;
    let successorWorkItemId: string | null = null;
    try {
      requireThat(candidates.length === 1, "REPAIR_ONE_PROPOSAL_PER_ATTEMPT");
      const candidate = candidates[0];
      const inheritedCaptures = inheritedRepairCaptures(parent, items);
      const authorizedSiblings = new Set(input.authorizedSiblingArtifactIdsFor?.(parent) ?? []);
      const evidence = await Promise.all(candidate.evidenceArtifactIds.map(async id => {
        const capture = await input.readCapture(id);
        // Any recorded robots.txt verdict is admissible; a walled, partial or non-2xx capture never is.
        requireThat(isRecordedRobotsVerdict(capture.permission) && capture.transport === "REACHABLE" && !capture.partial &&
          capture.httpStatus !== null && capture.httpStatus >= 200 && capture.httpStatus < 300, "REPAIR_CAPTURE_NOT_ADMISSIBLE");
        const row = capture.evidence; const acquisition = attempts.get(row.acquiredByAttemptId);
        requireThat(acquisition?.outcome === "COMPLETED" &&
          ((inheritedCaptures.workItemIds.has(acquisition.workItemId) &&
            (acquisition.workItemId === parent.id || inheritedCaptures.artifactIds.has(id))) || authorizedSiblings.has(id)),
          "REPAIR_CAPTURE_COMPLETION_MISSING"); return row;
      }));
      const observedAtByArtifact = new Map<string, string>();
      for (const row of evidence) {
        // Content identity keeps its original time. Only an actual completed
        // network rung can witness a newer observation of those same bytes.
        const observed = scout.rungs.filter(rung => ["fetch_public", "browse"].includes(rung.tool) && rung.target === row.canonicalUrl &&
          rung.artifactIds.includes(row.artifactId) && rung.ok === true && rung.transport === "REACHABLE" &&
          typeof rung.httpStatus === "number" && rung.httpStatus >= 200 && rung.httpStatus < 300 &&
          Date.parse(rung.at) >= Date.parse(proposalAttempt.startedAt) && Date.parse(rung.at) <= Date.parse(proposalAttempt.endedAt!))
          .map(rung => rung.at).sort().at(-1);
        if (observed) observedAtByArtifact.set(row.artifactId, observed);
      }
      const evaluated = evaluatePlanRepair({ plan: parent.autonomousPlan, candidate, evidence, now: input.now, observedAtByArtifact,
        registeredPublisherAddress: input.registeredPublisherAddressFor?.(parent.subject) });
      // A fixed number of failed routes is not the end of the obligation.
      // Continue on new evidence, but never spend on an unchanged ancestor
      // proposal or follow an invalid/cyclic link into another assignment.
      const seen = new Set<string>();
      let ancestor: LinkedWorkItem = parent;
      while (true) {
        requireThat(!seen.has(ancestor.id), "REPAIR_LINEAGE_CYCLE");
        seen.add(ancestor.id);
        const link = ancestor.planRepair;
        if (!link) break;
        requireThat(link.proposalHash !== evaluated.proposalHash, "REPAIR_UNCHANGED_PROPOSAL_NEEDS_NEW_EVIDENCE");
        const prior = items.find(item => item.id === link.parentWorkItemId);
        requireThat(prior && link.authority === "WORK_INSTRUCTIONS_ONLY" && prior.project === parent.project &&
          prior.subject === parent.subject && prior.autonomousPlan?.contract.recordClass === parent.autonomousPlan.contract.recordClass &&
          prior.autonomousPlan.contract.schemaVersion === 2 && parent.autonomousPlan.contract.schemaVersion === 2 &&
          canonicalJson(prior.autonomousPlan.contract.identity) === canonicalJson(parent.autonomousPlan.contract.identity) &&
          Number.isSafeInteger(link.depth) && link.depth === (prior.planRepair?.depth ?? 0) + 1 &&
          link.rootWorkItemId === (prior.planRepair?.rootWorkItemId ?? prior.id), "REPAIR_LINEAGE_INVALID");
        ancestor = prior;
      }
      const previous = items.find(item => item.planRepair?.parentWorkItemId === parent.id);
      if (previous) {
        requireThat(previous.planRepair!.proposalHash === evaluated.proposalHash, "REPAIR_PARENT_HAS_SUCCESSOR_CONTINUE_THERE");
      }
      {
        const primary = evaluated.primary;
        const route = { ...parent.autonomousPlan.sources[0], id: candidate.routeId, url: primary.canonicalUrl, observedLocator: primary.canonicalUrl,
          sourceId: primary.sourceId, publisher: evaluated.contract.sourceScope.publisher, subjectId: parent.subject,
          jurisdiction: parent.autonomousPlan.jurisdiction, recordClass: evaluated.contract.recordClass,
          observedAt: observedAtByArtifact.get(primary.artifactId) ?? primary.retrievedAt, firstObservedAt: primary.retrievedAt, methodVersion: evaluated.contract.methodVersion,
          permission: candidate.permission, retrieval: "fetch_public" as const, nextRouteIds: ["INDEPENDENT_AUTHORITY_AND_CONTRACT_REPAIR"],
          ...(primary.sourceDocument ? { representation: primary.sourceDocument.kind } : {}),
          applicableBecause: "Completed Scout retained and locally replayed this exact official source under the unchanged civic question.",
          observation: { artifactId: primary.artifactId, contentHash: primary.contentHash, start: 0, end: Math.min(primary.text.length, 256), quote: primary.text.slice(0, 256), offsetUnit: "UTF16_CODE_UNITS" as const },
          publisherSubjectEvidence: [{ artifactId: primary.artifactId, contentHash: primary.contentHash, start: 0, end: Math.min(primary.text.length, 256), quote: primary.text.slice(0, 256), offsetUnit: "UTF16_CODE_UNITS" as const }] };
        const link: PlanRepairLink = { parentWorkItemId: parent.id, rootWorkItemId: parent.planRepair?.rootWorkItemId ?? parent.id,
          depth: (parent.planRepair?.depth ?? 0) + 1, proposalHash: evaluated.proposalHash, scoutAttemptId: scout.attemptId, sourceArtifactId: primary.artifactId,
          retainedEvidenceIds: candidate.evidenceArtifactIds, admittedAt: input.now, authority: "WORK_INSTRUCTIONS_ONLY", unresolved: evaluated.unresolved };
        const child: LinkedWorkItem = { ...createWorkItem({ project: parent.project, subject: parent.subject,
          obligation: `${parent.obligation} — source contract successor ${evaluated.proposalHash}`,
          why: `Continue ${parent.id} with evidence-backed executable instructions. The original obligation and all unresolved burdens remain open.`, contract: parent.contract, dependencies: parent.dependencies, now: input.now }), planRepair: link };
        const heldFor = (observed: ObservedResearchRoute) => evidence.filter(row =>
          row.canonicalUrl === observed.url && row.sourceId === observed.sourceId)
          .sort((left, right) => right.retrievedAt.localeCompare(left.retrievedAt)).map(row => ({
          artifactId: row.artifactId, sourceObservationArtifactId: observed.observation.artifactId,
          sourceRouteId: observed.id, immutable: true, partial: false,
          currentUntil: new Date(Date.parse(row.retrievedAt) + 24 * 3_600_000).toISOString(),
          inheritedFromWorkItemId: attempts.get(row.acquiredByAttemptId)!.workItemId,
        }));
        const plan: AutonomousWorkPlan = { ...parent.autonomousPlan, contract: evaluated.contract,
          sources: [route, ...evaluated.profileRoutes], acquisition: [{ route, held: heldFor(route) }, ...evaluated.profileRoutes.map(profile => ({ route: profile, held: heldFor(profile) }))],
          seedUrls: [...new Set([...parent.autonomousPlan.seedUrls, primary.canonicalUrl, ...evaluated.profileRoutes.map(profile => profile.url)])] };
        assertAutonomousPlanIdentity(child, plan);
        if (previous) {
          // Recover a row written by an interrupted older two-step producer.
          requireThat(previous.id === child.id, "REPAIR_SUCCESSOR_IDENTITY_MISMATCH");
          await registerAutonomousPlan(input.repos, previous.id, plan, input.now);
          items[items.findIndex(item => item.id === previous.id)] = { ...previous, autonomousPlan: plan };
        } else {
          // The validated plan and its identity link share a single atomic row.
          await registerWorkItem(input.repos, { ...child, autonomousPlan: plan }, input.now);
          items.push({ ...child, autonomousPlan: plan });
        }
        successorWorkItemId = child.id;
      }
      observations.push({ parentWorkItemId: parent.id, scoutAttemptId: scout.attemptId, code: "REPAIR_SUCCESSOR_REGISTERED", successorWorkItemId,
        detail: evaluated.unresolved.join(", ") || "Instructions replayed; real independent worker execution remains required." });
    } catch (error) {
      observations.push({ parentWorkItemId: parent.id, scoutAttemptId: scout.attemptId, code: error instanceof Error ? error.message : "REPAIR_REFUSED", successorWorkItemId: null,
        detail: "Original plan and blockers retained; obtain the named missing evidence or implemented adapter." });
    }
  }
  for (const observation of observations) {
    const row = await input.repos.workItems.mustRead(observation.parentWorkItemId);
    const value = row.value as LinkedWorkItem & { readonly planRepairObservation?: RepairObservation };
    const next = { ...value, planRepairObservation: observation, planRepairObservations: { ...value.planRepairObservations, [observation.scoutAttemptId]: observation } };
    if (canonicalJson(value.planRepairObservation ?? null) !== canonicalJson(observation)) await input.repos.workItems.compareAndSet(row.id, row.revision, next, input.now);
  }
  return observations;
}
