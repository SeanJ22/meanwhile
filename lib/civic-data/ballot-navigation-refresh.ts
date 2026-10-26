import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { votingFetchSession } from "../ballot/voting-source-fetch.ts";
import { artifactId, classifyAcquisition, defaultRetention, deriveSanitized, extractionSourceDocument, type Artifact } from "../control-plane/evidence/artifact.ts";
import type { CycleVault } from "../control-plane/scheduler/vault.ts";
import type { ControlPlaneRepositories } from "../control-plane/repository/types.ts";
import { section3Page, section3Record } from "../control-plane/promotion/section3.ts";
import { readPublicationSourcePolicy } from "../control-plane/promotion/source-settings.ts";
import { extractEmbeddedHtml, extractTextLayer } from "../extract/text-layer.ts";
import { sanitizedErrorDiagnostic } from "../ops/error-diagnostic.ts";
import { ballotNavigationScope, ballotNavigationDivision, ballotNavigationTaskId } from "./ballot-navigation-scope.ts";
import { BALLOT_NAVIGATION_INPUT_DIRECTORY } from "./ballot-navigation-input.ts";
import { publishElectionFields } from "./election-field-publication.ts";
import { electionFieldState, type ElectionFieldInput } from "./election-fields.ts";
import { isOfficialSource, type GovernmentWebsiteDelegation, type OfficialLinkingPage } from "./source-authority.ts";
import type { RoutineDataStore } from "./store.ts";
import type { WorkerPublicationCapture } from "./worker-roster-publication.ts";
import type { CuratedReaderProjection, ManualProjectionPackage } from "./manual-projections.ts";
import { prepareNavigationSuccessor } from "./navigation-successor.ts";
import { processNavigationCandidate } from "./promotion.ts";
import { requiredManualProductionContract } from "./manual-contracts.ts";
import { readManualProjectionPrior } from "./manual-projections.ts";
import { manualRecordSourceUrls } from "./manual-source-isolation.ts";
import type { ManualSourceReview } from "./types.ts";
import type { PublishedSourceCheck } from "./source-checks.ts";
import { ballotNavigationSourceKey } from "./ballot-navigation-source-checks.ts";
import { sourceContentHash } from "./source-hash.ts";
import { canonicalCivicDataHash } from "./canonical-hash.ts";
import type { RoutineRunnerReceipt } from "./runner-receipt.ts";
import { ZERO_RELEASE_EVENTS } from "./release.ts";

export interface BallotNavigationSourceReport {
  readonly requestedUrl: string;
  readonly finalUrl: string;
  readonly publisher: string;
  readonly rawPath?: string;
  readonly textPath?: string;
  readonly retrievedAt?: string;
  readonly sha256?: string;
  readonly httpStatus?: number;
  readonly contentType?: string;
  readonly linkingPage?: OfficialLinkingPage;
  readonly officialFrom?: string;
  readonly websiteDelegation?: {
    readonly governmentUrl: string;
    readonly dnsSource: Omit<BallotNavigationSourceReport, "websiteDelegation" | "linkingPage" | "officialFrom">;
  };
}

export interface BallotNavigationStateReport {
  readonly state: string;
  readonly electionDate: string;
  readonly facts: readonly {
    readonly divisionId?: string;
    readonly kind: ElectionFieldInput["kind"];
    readonly value: string;
    readonly quote: string;
    readonly dates: readonly string[];
    readonly sourceUrl: string;
    readonly phone?: string | null;
    readonly navigationUrl?: string | null;
  }[];
  readonly sources: readonly BallotNavigationSourceReport[];
  readonly gaps?: readonly (string | { readonly kind: string; readonly detail: string })[];
}

export interface BallotNavigationSourceConfig {
  readonly state: string;
  readonly electionDate: string;
  readonly package: ManualProjectionPackage;
  readonly sources: readonly BallotNavigationSourceReport[];
  readonly gaps?: BallotNavigationStateReport["gaps"];
}

const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const sourceInputs = (value: unknown): unknown => Array.isArray(value) ? value.map(sourceInputs)
  : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).filter(([key]) =>
    !["checkedAt", "retrievedAt", "collectedAt", "observedAt"].includes(key)).map(([key, row]) => [key, sourceInputs(row)])) : value;
const decode = (bytes: Uint8Array, contentType = "") => {
  const header = `${contentType}\n${new TextDecoder("latin1").decode(bytes.slice(0, 4096))}`;
  const encoding = /charset\s*=\s*["']?([\w-]+)/i.exec(header)?.[1] ?? "utf-8";
  return { text: new TextDecoder(encoding, { ignoreBOM: true, fatal: true }).decode(bytes), encoding };
};


function indexAuthorityLinks(pages: Map<string, OfficialLinkingPage>, url: string, html: string, linkingPage?: OfficialLinkingPage) {
  if (!isOfficialSource(url, linkingPage)) return;
  for (const tag of html.matchAll(/<(?:a|link)\b[^>]*(?:href|src)\s*=[^>]*>/gi)) {
    const href = /\b(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag[0]);
    if (!href) continue;
    try {
      const target = new URL((href[1] ?? href[2] ?? href[3]).replace(/&amp;/g, "&"), url);
      if (!/^https?:$/.test(target.protocol) || isOfficialSource(target.href) || pages.has(target.hostname)) continue;
      // A substring must not keep the fetched page alive.
      const proof = Buffer.from(tag[0], "utf8").toString("utf8");
      pages.set(target.hostname, { url, html: proof, ...(linkingPage ? { linkingPage } : {}) });
    } catch { continue; }
  }
}

async function publishReviewedInput(config: BallotNavigationSourceConfig, store: RoutineDataStore, now: string) {
  const source = config.package;
  if (source.contractId !== "ballot-navigation" || !("kind" in source.payload) || source.payload.kind !== "ballot-navigation") throw new Error("NAVIGATION_REVIEWED_INPUT_INVALID");
  const head = await store.readSourceHead("CURATED_READER_RECORD", ballotNavigationScope(config.state));
  const through = head?.sourceThrough;
  if (typeof through === "string" && Date.parse(through) >= Date.parse(source.sourceThrough)) return null;
  const result = await processNavigationCandidate(store, () => prepareNavigationSuccessor({ ...source, version: now,
    sourceReceipt: { ...source.sourceReceipt, reviewedAt: now, reviewedBy: "reviewed-ballot-navigation-input" } }, store), now);
  return { ...result, fields: source.payload.records.map(record => record.id) };
}

/** Verified navigation published before each state had its own pointer moves into that state's pointer once, with the source reviews it cites.
 * A member the national version held from an earlier version cites a review saved on that earlier version. */
async function carryNationalRecords(state: string, store: RoutineDataStore, now: string) {
  const national = requiredManualProductionContract("ballot-navigation");
  const prior = await readManualProjectionPrior("ballot-navigation", store, now, national.scope);
  const records = ((prior?.payload as CuratedReaderProjection | undefined)?.records ?? [])
    .filter(record => (record.value as { readonly state?: unknown } | undefined)?.state === state);
  if (!prior?.sourceReceipt || !records.length) return null;
  const owed = new Set(records.flatMap(manualRecordSourceUrls)), sources = new Map<string, ManualSourceReview>();
  let versionId: string | undefined = prior.versionId;
  for (let depth = 0; versionId && owed.size && depth < 64; depth++) {
    const reviews = await store.readCandidatePath<readonly ManualSourceReview[]>(versionId, ["retrieval", "manualSourceReceipt", "sources"]);
    for (const source of reviews ?? []) {
      const url = [source.requestedUrl, source.finalUrl].find(row => owed.has(row));
      if (source.reviewOutcome !== "SUPPORTED" || !url) continue;
      sources.set(url, source); owed.delete(source.requestedUrl); owed.delete(source.finalUrl);
    }
    const previous = await store.readCandidatePath<string>(versionId, ["manualPriorAuthority", "versionId"]);
    versionId = typeof previous === "string" ? previous : undefined;
  }
  const result = await processNavigationCandidate(store, () => prepareNavigationSuccessor({ contractId: "ballot-navigation", version: now,
    sourceThrough: prior.temporal?.sourceThrough ?? now, sourceReceipt: { ...prior.sourceReceipt!, sources: [...new Set(sources.values())] },
    payload: { kind: "ballot-navigation", records } }, store), now);
  return { ...result, fields: records.map(record => record.id) };
}

function configuredReport(config: BallotNavigationSourceConfig): BallotNavigationStateReport {
  return { state: config.state, electionDate: config.electionDate, sources: config.sources, gaps: config.gaps,
    facts: (config.package.payload as CuratedReaderProjection).records.filter(row => row.kind === "ELECTION_FIELD").map(row => {
      const value = row.value as import("./election-fields.ts").PublishedElectionField["value"];
      if (value.state !== config.state) throw new Error("NAVIGATION_INPUT_CROSSES_STATE");
      return { divisionId: value.divisionId, kind: value.fieldKind, value: value.text, quote: value.quote, dates: value.dates, sourceUrl: value.url,
        phone: value.phone, navigationUrl: value.navigationUrl };
    }) };
}

async function sourceArtifact(input: {
  readonly bytes: Uint8Array; readonly url: string; readonly contentType: string; readonly observedAt: string;
  readonly publisher: string; readonly state: string; readonly vault: Pick<CycleVault, "putBytes">;
  readonly repos: Pick<ControlPlaneRepositories, "artifacts">;
  readonly recorded: Set<string>;
  readonly methodRouteId?: string;
  readonly deferred?: (() => Promise<void>)[];
}) {
  const contentHash = `sha256-${digest(input.bytes)}`;
  const pdf = /pdf/i.test(input.contentType) || new TextDecoder("latin1").decode(input.bytes.slice(0, 5)) === "%PDF-";
  const { text: textBody, encoding } = pdf ? { text: new TextDecoder().decode(input.bytes), encoding: "utf-8" } : decode(input.bytes, input.contentType);
  const tier = classifyAcquisition(textBody).tier;
  const workItemId = `ballot-navigation:${input.state.toLowerCase()}`;
  const artifact: Artifact = { id: artifactId(tier, contentHash), tier, contentHash, byteLength: input.bytes.length,
    contentType: input.contentType, canonicalUrl: input.url, retrievalUrl: input.url, retrievedAt: input.observedAt,
    httpStatus: 200, headers: {}, sourceId: input.publisher, methodRouteId: input.methodRouteId ?? "ballot-navigation:official-page",
    workItemId, attemptId: `ballot-navigation:${input.state}:${input.observedAt}`, permission: "ALLOWED",
    transport: "REACHABLE", retentionPolicy: defaultRetention(tier) };
  const save = async (row: Artifact, bytes: Uint8Array) => {
    if (input.deferred) { input.deferred.push(() => persist(row, bytes)); return; }
    await persist(row, bytes);
  };
  const persist = async (row: Artifact, bytes: Uint8Array) => {
    const written = await input.vault.putBytes(row, bytes);
    if (!written.stored) throw new Error(written.why);
    const observationId = `${row.id}:${row.retrievedAt}`;
    if (!input.recorded.has(observationId)) {
      await input.repos.artifacts.append(workItemId, observationId, { artifactId: row.id, workItemId,
        attemptId: row.attemptId, routeTaskId: null, tier: row.tier, contentHash: row.contentHash,
        canonicalUrl: row.canonicalUrl, byteLength: row.byteLength, contentType: row.contentType,
        partial: false, recordedAt: row.retrievedAt }, row.retrievedAt);
      input.recorded.add(observationId);
    }
  };
  await save(artifact, input.bytes);
  if (!pdf) {
    let parserArtifact = artifact, parserText = textBody;
    if (tier === "RESTRICTED_RAW") {
      const sanitized = deriveSanitized(artifact, textBody, input.observedAt);
      await save(sanitized.artifact, new TextEncoder().encode(sanitized.text));
      parserArtifact = sanitized.artifact; parserText = sanitized.text;
    }
    const embedded = extractEmbeddedHtml(parserText);
    const text = embedded?.text ?? parserText;
    if (`sha256-${digest(text)}` !== parserArtifact.contentHash) {
      const hash = `sha256-${digest(text)}`;
      const decoded: Artifact = { ...artifact, id: artifactId("EXTRACTED_DERIVED", hash), tier: "EXTRACTED_DERIVED",
        retentionPolicy: defaultRetention("EXTRACTED_DERIVED"), contentHash: hash, contentType: "text/html; charset=utf-8", byteLength: Buffer.byteLength(text),
        extraction: { kind: "HTML_TEXT", version: embedded ? "html-json/1" : "html-decoding/1", complete: true, pages: 1, encoding, parent: parserArtifact } };
      await save(decoded, new TextEncoder().encode(text));
      return { artifact: decoded, text, rawContentHash: artifact.contentHash,
        sourceDocument: extractionSourceDocument(decoded) };
    }
    return { artifact: parserArtifact, text: parserText, rawContentHash: artifact.contentHash, sourceDocument: undefined };
  }
  if (tier !== "RAW") throw new Error("NAVIGATION_PDF_REQUIRES_SANITIZATION");
  const extraction = await extractTextLayer(Uint8Array.from(input.bytes), input.url);
  if (extraction.outcome !== "EXTRACTED") throw new Error(`NAVIGATION_PDF_TRANSCRIPTION_FAILED:${extraction.reason}`);
  const text = extraction.items.map(page => [page.text, ...(page.links ?? []).map(url => `<a href="${url.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"></a>`)].join("\n")).join("\n");
  const derivedHash = `sha256-${digest(text)}`;
  const derived: Artifact = { ...artifact, id: artifactId("EXTRACTED_DERIVED", derivedHash), tier: "EXTRACTED_DERIVED",
    contentHash: derivedHash, contentType: "text/plain", byteLength: Buffer.byteLength(text),
    extraction: { kind: "PDF_TEXT", version: "pdf-transcription/1", complete: true, pages: extraction.counts.pages, parent: artifact } };
  await save(derived, new TextEncoder().encode(text));
  return { artifact: derived, text, rawContentHash: artifact.contentHash,
    sourceDocument: { artifactId: artifact.id, contentHash: artifact.contentHash, kind: "PDF_TEXT" as const } };
}

export async function readBallotNavigationReport(directory: string, state: string) {
  const path = await realpath(resolve(directory));
  const relativePath = relative(await realpath(process.cwd()), path);
  if (!isAbsolute(relativePath) && relativePath !== ".." && !relativePath.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) {
    throw new Error("NAVIGATION_REPORTS_MUST_BE_OUTSIDE_REPOSITORY");
  }
  ballotNavigationScope(state);
  const report = JSON.parse(await readFile(join(path, `${state.toLowerCase()}.json`), "utf8")) as BallotNavigationStateReport;
  if (report.state !== state) throw new Error("NAVIGATION_REPORT_STATE_MISMATCH");
  return report;
}

export async function refreshBallotNavigation(input: {
  readonly store: RoutineDataStore;
  readonly repos: Pick<ControlPlaneRepositories, "artifacts" | "adminConfig">;
  readonly vault: Pick<CycleVault, "putBytes">;
  readonly now: string;
  readonly state: string;
  readonly directory?: string;
  readonly report?: BallotNavigationStateReport;
  readonly config?: BallotNavigationSourceConfig;
  readonly fetch?: typeof fetch;
}) {
  ballotNavigationScope(input.state);
  const config = input.config ?? (!input.report && !input.directory
    ? JSON.parse(await readFile(join(BALLOT_NAVIGATION_INPUT_DIRECTORY, `${input.state.toLowerCase()}.json`), "utf8")) as BallotNavigationSourceConfig : null);
  if (config && config.state !== input.state) throw new Error("NAVIGATION_INPUT_CROSSES_STATE");
  const carried = await input.store.readSourceHead("CURATED_READER_RECORD", ballotNavigationScope(input.state)) === null
    ? await carryNationalRecords(input.state, input.store, input.now) : null;
  const reviewed = config ? await publishReviewedInput(config, input.store, input.now) : null;
  const report = input.report ?? (input.directory ? await readBallotNavigationReport(input.directory, input.state) : configuredReport(config!));
  if (report.state !== input.state) throw new Error("NAVIGATION_INPUT_CROSSES_STATE");
  const gaps: { divisionId: string; kind: string; detail: string }[] = [];
  const sourcePolicy = await readPublicationSourcePolicy(input.repos);
  const scope = ballotNavigationScope(input.state), contract = requiredManualProductionContract("ballot-navigation");
  let head = await input.store.readSourceHead("CURATED_READER_RECORD", scope);
  const sourceKeys = [...new Set((Array.isArray(report.sources) ? report.sources : []).flatMap(source => {
    try { return [ballotNavigationSourceKey(scope, source.requestedUrl)]; } catch { return []; }
  }))];
  const priorChecks = head && head.sourceId === contract.sourceId && !head.imported && head.candidateState === "PROMOTED" &&
    head.acquisitionSucceeded && head.versionId === head.lastKnownGoodVersionId && head.parserVersion === contract.parserNormalizerVersion &&
    head.rawHashBasis === "SOURCE_CONTENT_V1" && input.store.readSourceChecks
    ? await input.store.readSourceChecks("CURATED_READER_RECORD", scope, sourceKeys) : [];
  const checks = new Map(priorChecks.map(check => [check.sourceKey, check]));
  const pending = new Map<string, { check: PublishedSourceCheck; expected: number; valid: number; failed: boolean }>();
  let confirmedSources = 0;
  const saveChecks = async (rows: Iterable<PublishedSourceCheck>) => {
    if (!head || head.sourceId !== contract.sourceId || !head.rawHash || head.rawHashBasis !== "SOURCE_CONTENT_V1" ||
      head.parserVersion !== contract.parserNormalizerVersion || !input.store.recordSourceCheck) return;
    for (const check of rows) try {
      const saved = await input.store.recordSourceCheck({ ...check, sourceHash: head.rawHash, sourceId: head.sourceId,
        recordClass: "CURATED_READER_RECORD", scope, pointerVersionId: head.versionId });
      if (!saved) gaps.push({ divisionId: ballotNavigationDivision(report.state), kind: "source", detail: `NAVIGATION_SOURCE_POINTER_MOVED:${check.sourceKey}` });
    } catch (error) {
      gaps.push({ divisionId: ballotNavigationDivision(report.state), kind: "source", detail: `NAVIGATION_SOURCE_CHECK_FAILED:${sanitizedErrorDiagnostic(error)}` });
    }
  };
  const fields = async function* (): AsyncGenerator<ElectionFieldInput> {
    const divisionId = ballotNavigationDivision(report.state);
    if (!electionFieldState(divisionId) || !/^\d{4}-\d{2}-\d{2}$/.test(report.electionDate) ||
        !Array.isArray(report.sources) || !Array.isArray(report.facts) ||
        config && report.electionDate !== config.electionDate) {
      gaps.push({ divisionId, kind: "source", detail: "NAVIGATION_STATE_ELECTION_INVALID" }); return;
    }
    const session = votingFetchSession({ fetch: input.fetch ?? fetch });
    const authorities = new Map<string, OfficialLinkingPage>();
    const bySource = new Map<string, BallotNavigationStateReport["facts"][number][]>();
    for (const fact of report.facts) {
      if (!fact || typeof fact.sourceUrl !== "string" || fact.divisionId && electionFieldState(fact.divisionId) !== input.state) {
        gaps.push({ divisionId, kind: "source", detail: "NAVIGATION_FIELD_SOURCE_INVALID" }); continue;
      }
      const group = bySource.get(fact.sourceUrl) ?? [];
      group.push(fact); bySource.set(fact.sourceUrl, group);
    }
    const recorded = new Set<string>();
    const directAuthority = (source: BallotNavigationSourceReport) => Boolean(source && typeof source.finalUrl === "string" && isOfficialSource(source.finalUrl));
    const checkedAt = (source: BallotNavigationSourceReport) => {
      try { return Date.parse(checks.get(ballotNavigationSourceKey(scope, source.requestedUrl))?.checkedAt ?? "") || Number.MIN_SAFE_INTEGER; }
      catch { return Number.MIN_SAFE_INTEGER; }
    };
    for (const source of [...report.sources].sort((a, b) => Number(directAuthority(b)) - Number(directAuthority(a)) || checkedAt(a) - checkedAt(b))) {
      if (!source || typeof source.requestedUrl !== "string") {
        gaps.push({ divisionId, kind: "source", detail: "NAVIGATION_SOURCE_URL_INVALID" }); continue;
      }
      try {
        const deferred: (() => Promise<void>)[] = [];
        let bytes: Uint8Array, url: string, contentType: string, observedAt: string;
        if (source.rawPath) {
          bytes = new Uint8Array(await readFile(source.rawPath));
          if (digest(bytes) !== source.sha256?.replace(/^sha256-/, "") || !source.retrievedAt ||
              !Number.isFinite(Date.parse(source.retrievedAt)) || source.httpStatus !== 200) {
            throw new Error("NAVIGATION_SAVED_SOURCE_PROOF_INVALID");
          }
          url = source.finalUrl; contentType = source.contentType ?? "text/html"; observedAt = source.retrievedAt;
        } else {
          const capture = await session.get(source.requestedUrl);
          bytes = capture.bytes; url = capture.url; contentType = capture.contentType; observedAt = input.now;
        }
        let linkingPage = source.linkingPage ?? authorities.get(new URL(url).hostname);
        if (source.officialFrom) {
          const official = await session.get(source.officialFrom);
          indexAuthorityLinks(authorities, official.url, decode(official.bytes, official.contentType).text);
          linkingPage = authorities.get(new URL(url).hostname);
          await sourceArtifact({ bytes: official.bytes, url: official.url, contentType: official.contentType,
            observedAt: input.now, publisher: source.publisher, state: report.state, vault: input.vault, repos: input.repos, recorded, deferred });
        }
        let websiteDelegation: GovernmentWebsiteDelegation | undefined;
        if (source.websiteDelegation) {
          const dnsSource = source.websiteDelegation.dnsSource;
          let dnsBytes: Uint8Array, dnsUrl: string, dnsType: string, dnsAt: string;
          if (dnsSource.rawPath) {
            dnsBytes = new Uint8Array(await readFile(dnsSource.rawPath));
            if (digest(dnsBytes) !== dnsSource.sha256?.replace(/^sha256-/, "") || dnsSource.httpStatus !== 200 ||
                !dnsSource.retrievedAt || !Number.isFinite(Date.parse(dnsSource.retrievedAt))) {
              throw new Error("NAVIGATION_DNS_SOURCE_PROOF_INVALID");
            }
            dnsUrl = dnsSource.finalUrl; dnsType = dnsSource.contentType ?? "application/json"; dnsAt = dnsSource.retrievedAt;
          } else {
            const dns = await session.get(dnsSource.requestedUrl);
            dnsBytes = dns.bytes; dnsUrl = dns.url; dnsType = dns.contentType; dnsAt = input.now;
          }
          const dns = await sourceArtifact({ bytes: dnsBytes, url: dnsUrl, contentType: dnsType, observedAt: dnsAt,
            publisher: dnsSource.publisher, state: report.state, vault: input.vault, repos: input.repos, recorded,
            methodRouteId: "ballot-navigation:government-dns", deferred });
          websiteDelegation = { governmentUrl: source.websiteDelegation.governmentUrl, html: decode(bytes, contentType).text,
            dns: { url: dnsUrl, text: dns.text, artifactId: dns.artifact.id, contentHash: dns.artifact.contentHash, retrievedAt: dnsAt } };
        }
        if (!isOfficialSource(url, linkingPage, websiteDelegation)) throw new Error("NAVIGATION_SOURCE_NOT_OFFICIAL");
        const facts = new Set([source.requestedUrl, source.finalUrl, url].flatMap(key => bySource.get(key) ?? []));
        const sourceKey = ballotNavigationSourceKey(scope, source.requestedUrl);
        const rawHash = sourceContentHash([{ requestedUrl: source.requestedUrl, finalUrl: url, capture: { rawHash: digest(bytes) } }],
          sourceInputs({ state: input.state, electionDate: report.electionDate, facts: [...facts], publisher: source.publisher,
            contentType, linkingPage, websiteDelegation, sourcePolicy, parserVersion: contract.parserNormalizerVersion }));
        const check: PublishedSourceCheck = { sourceKey, rawHash, parserVersion: contract.parserNormalizerVersion, checkedAt: observedAt,
          sourceUrls: [...new Set([source.requestedUrl, source.finalUrl, url])],
          jurisdictionIds: [...new Set([...facts].map(fact => fact.divisionId ?? divisionId))] };
        if (facts.size && checks.get(sourceKey)?.rawHash === rawHash) {
          for (const fact of facts) {
            const kind = fact.kind === "election_office" ? "SERVICE_CONTACT" : fact.kind.endsWith("_lookup") || fact.kind === "registration_page" ? "VOTER_ACCESS_ROUTE" : "BALLOT_CONTEST";
            const page = section3Page({ url, text: "", retrievedAt: observedAt, linkingPage, websiteDelegation, sourcePolicy }, kind, input.now);
            if (!page.ok) throw new Error(page.reason ?? "NAVIGATION_SOURCE_CHECK_INVALID");
          }
          checks.set(sourceKey, check); confirmedSources++;
          await saveChecks([check]);
          for (const key of [source.requestedUrl, source.finalUrl, url]) bySource.delete(key);
          if (!/pdf/i.test(contentType) && new TextDecoder("latin1").decode(bytes.slice(0, 5)) !== "%PDF-") {
            const decoded = decode(bytes, contentType).text;
            indexAuthorityLinks(authorities, url, extractEmbeddedHtml(decoded)?.text ?? decoded, linkingPage);
          } else {
            const extracted = await extractTextLayer(bytes, url);
            if (extracted.outcome === "EXTRACTED") for (const page of extracted.items) indexAuthorityLinks(authorities, url,
              [page.text, ...(page.links ?? []).map(link => `<a href="${link.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"></a>`)].join("\n"), linkingPage);
          }
          console.log("BALLOT_NAVIGATION_CONFIRMED_UNCHANGED=" + JSON.stringify({ state: input.state, sourceKey, checkedAt: observedAt }));
          continue;
        }
        for (const save of deferred) await save();
        const saved = await sourceArtifact({ bytes, url, contentType, observedAt, publisher: source.publisher,
          state: report.state, vault: input.vault, repos: input.repos, recorded });
        const capture: WorkerPublicationCapture = { observedAt, httpStatus: 200, transport: "REACHABLE", partial: false, sourcePolicy,
          rawContentHash: saved.rawContentHash,
          evidence: { artifactId: saved.artifact.id, contentHash: saved.artifact.contentHash, text: saved.text,
            canonicalUrl: url, retrievedAt: observedAt, sourceId: source.publisher,
            acquiredByAttemptId: saved.artifact.attemptId, methodRouteId: saved.artifact.methodRouteId,
            ...(saved.sourceDocument ? { sourceDocument: saved.sourceDocument } : {}) } };
        if (facts.size) pending.set(sourceKey, { check, expected: facts.size, valid: 0, failed: false });
        for (const key of [source.requestedUrl, source.finalUrl, url]) bySource.delete(key);
        for (const [index, fact] of [...facts].entries()) yield { divisionId: fact.divisionId ?? divisionId, kind: fact.kind, value: fact.value, quote: fact.quote, dates: fact.dates,
          electionDate: report.electionDate, phone: fact.phone, navigationUrl: fact.navigationUrl,
          sourceUrl: url, linkingPage, websiteDelegation,
          sourceKey, sourceHash: rawHash, sourceComplete: index === facts.size - 1,
          document: { url, text: capture.evidence.text, collectedAt: observedAt, capture } };
        indexAuthorityLinks(authorities, url, capture.evidence.text, linkingPage);
      } catch (error) { gaps.push({ divisionId, kind: "source", detail: `${source.requestedUrl}:${sanitizedErrorDiagnostic(error)}` }); }
      finally { session.rawBodies.length = 0; }
    }
    for (const [sourceUrl, facts] of bySource) for (const fact of facts) {
      gaps.push({ divisionId, kind: fact.kind, detail: `NAVIGATION_SOURCE_UNAVAILABLE:${sourceUrl}` });
    }
    gaps.push(...(report.gaps ?? []).map(gap => typeof gap === "string" ? { divisionId, kind: "source", detail: gap } : { divisionId, ...gap }));
  };
  const published = await publishElectionFields({ store: input.store, now: input.now, fields: fields(), verify: section3Record, flushCompletedSources: true,
    onPublished: async outcome => {
      const current = await input.store.readSourceHead("CURATED_READER_RECORD", scope);
      // A concurrent publisher cannot inherit checks derived for a different canonical version.
      if (current?.versionId !== outcome.promotedVersionId) return;
      head = current;
      await saveChecks(checks.values());
    },
    onFieldResult: (field, valid) => {
      const source = field.sourceKey ? pending.get(field.sourceKey) : undefined;
      if (!source) return;
      if (valid) source.valid++; else source.failed = true;
      if (!source.failed && source.valid === source.expected) checks.set(source.check.sourceKey, source.check);
    },
    sourceContentHash: () => canonicalCivicDataHash({ parserVersion: contract.parserNormalizerVersion,
      sources: sourceKeys.map(key => [key, checks.get(key)?.rawHash ?? null]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))) }),
  });
  let receipt: RoutineRunnerReceipt | null = null;
  if (!published.promotedVersionId && confirmedSources) {
    const current = await input.store.readSourceHead("CURATED_READER_RECORD", scope);
    if (!current || current.versionId !== head?.versionId || current.rawHash !== head?.rawHash || current.parserVersion !== head?.parserVersion) head = null;
  }
  if (!published.promotedVersionId && confirmedSources && head && !head.imported && head.candidateState === "PROMOTED" &&
    head.acquisitionSucceeded && head.versionId === head.lastKnownGoodVersionId && head.sourceId === contract.sourceId &&
    head.parserVersion === contract.parserNormalizerVersion && head.rawHashBasis === "SOURCE_CONTENT_V1") receipt = {
      source: ballotNavigationTaskId(input.state), candidateId: head.versionId, acquisitionSucceeded: true,
      state: "PROMOTED", decision: "GOOD", promotedVersion: head.versionId, lastKnownGoodVersion: head.lastKnownGoodVersionId,
      structuralReleaseContract: ZERO_RELEASE_EVENTS,
    };
  return { candidateId: published.candidateId ?? carried?.candidateId ?? reviewed?.candidateId ?? receipt?.candidateId ?? null,
    promotedVersionId: published.promotedVersionId ?? carried?.promotedVersionId ?? reviewed?.promotedVersionId ?? receipt?.promotedVersion ?? null,
    receipt, confirmedSources,
    fields: [...new Set([...(reviewed?.fields ?? []), ...(carried?.fields ?? []), ...published.fields])], gaps: [...gaps, ...published.gaps] };
}
