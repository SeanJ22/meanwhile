import { createHash } from "node:crypto";
import { readFile, readdir, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { votingFetchSession } from "../ballot/voting-source-fetch.ts";
import { artifactId, classifyAcquisition, defaultRetention, deriveSanitized, extractionSourceDocument, type Artifact } from "../control-plane/evidence/artifact.ts";
import { runPool } from "../control-plane/scheduler/shadow-loop.ts";
import type { CycleVault } from "../control-plane/scheduler/vault.ts";
import type { ControlPlaneRepositories } from "../control-plane/repository/types.ts";
import { linkingPageFrom, section3Record } from "../control-plane/promotion/section3.ts";
import { readPublicationSourcePolicy } from "../control-plane/promotion/source-settings.ts";
import { extractEmbeddedHtml, extractTextLayer } from "../extract/text-layer.ts";
import { sanitizedErrorDiagnostic } from "../ops/error-diagnostic.ts";
import { BALLOT_NAVIGATION_INPUT_PATH } from "./ballot-publication.ts";
import { publishElectionFields } from "./election-field-publication.ts";
import { electionFieldState, type ElectionFieldInput } from "./election-fields.ts";
import { isOfficialSource, type GovernmentWebsiteDelegation, type OfficialLinkingPage } from "./source-authority.ts";
import type { RoutineDataStore } from "./store.ts";
import type { WorkerPublicationCapture } from "./worker-roster-publication.ts";
import { readManualProjectionPrior, type CuratedReaderProjection, type ManualProjectionPackage } from "./manual-projections.ts";
import { prepareManualProjectionScopeTransfer, prepareManualProjectionSuccessor } from "./manual-successor.ts";
import { processRegisteredManualCandidate } from "./promotion.ts";
import { requiredManualProductionContract } from "./manual-contracts.ts";
import { recordRoutineReaderProjectionReadback } from "./reader-verification.ts";
import { readPromotedCivicData } from "./read-model.ts";
import { manualRecordSourceUrls } from "./manual-source-isolation.ts";
import type { ManualSourceSetReceipt } from "./types.ts";

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
  readonly electionDate: string;
  readonly package: ManualProjectionPackage;
  readonly states: readonly Omit<BallotNavigationStateReport, "facts">[];
  readonly scopeTransfers?: readonly string[];
}

const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const decode = (bytes: Uint8Array, contentType = "") => {
  const header = `${contentType}\n${new TextDecoder("latin1").decode(bytes.slice(0, 4096))}`;
  const encoding = /charset\s*=\s*["']?([\w-]+)/i.exec(header)?.[1] ?? "utf-8";
  return { text: new TextDecoder(encoding, { ignoreBOM: true, fatal: true }).decode(bytes), encoding };
};
const divisionFor = (state: string) => `ocd-division/country:us/${state === "DC" ? "district" : "state"}:${state.toLowerCase()}`;

function sourceTime(record: CuratedReaderProjection["records"][number], receipt: ManualSourceSetReceipt): number {
  const value = record.value as Record<string, unknown> | undefined;
  const at = value?.collectedAt ?? record.collectedAt;
  if (typeof at === "string" && Number.isFinite(Date.parse(at))) return Date.parse(at);
  const urls = new Set(manualRecordSourceUrls(record));
  return Math.max(-Infinity, ...receipt.sources.filter(source => urls.has(source.requestedUrl) || urls.has(source.finalUrl))
    .map(source => Date.parse(source.retrievedAt)).filter(Number.isFinite));
}

async function publishReviewedInput(config: BallotNavigationSourceConfig, store: RoutineDataStore, now: string) {
  const source = config.package;
  if (source.contractId !== "ballot-navigation" || !("kind" in source.payload) || source.payload.kind !== "ballot-navigation") throw new Error("NAVIGATION_REVIEWED_INPUT_INVALID");
  const payload = source.payload;
  const prior = await readManualProjectionPrior("ballot-navigation", store, now);
  const before = new Map(((prior?.payload as CuratedReaderProjection | undefined)?.records ?? []).map(row => [row.id, row]));
  const priorCandidate = prior ? await store.readCandidate(prior.versionId) : null;
  const adoption: ManualProjectionPackage = { ...source, version: now,
    sourceThrough: [source.sourceThrough, ...(priorCandidate ? [priorCandidate.candidate.temporal.sourceThrough] : [])]
      .sort((left, right) => Date.parse(left) - Date.parse(right)).at(-1)!,
    sourceReceipt: { ...source.sourceReceipt, reviewedAt: now, reviewedBy: "reviewed-ballot-navigation-input" } };
  const records = payload.records.filter(row => !before.has(row.id) ||
    sourceTime(row, source.sourceReceipt) > sourceTime(before.get(row.id)!, prior!.sourceReceipt));
  let candidateId: string | null = null, promotedVersionId: string | null = null;
  const fields = records.map(row => row.id);
  if (records.length) {
    const prepared = await prepareManualProjectionSuccessor({ ...adoption, payload: { ...payload, records } }, store, now);
    const outcome = await processRegisteredManualCandidate(store, "ballot-navigation", prepared.candidate, now, prepared.expectedBaseVersionId);
    if (!outcome.promoted) throw new Error(`NAVIGATION_REVIEWED_INPUT_HELD:${outcome.candidate.failureDetail ?? outcome.candidate.state}`);
    candidateId = outcome.candidate.candidate.id; promotedVersionId = outcome.promoted.versionId;
  }
  const contract = requiredManualProductionContract("ballot-navigation");
  for (const scope of config.scopeTransfers ?? []) {
    const read = await readPromotedCivicData<CuratedReaderProjection>(contract.recordClass, scope, { store, now, bypassCache: true });
    if (read.kind === "NOT_RECORDED") continue;
    if (read.kind !== "PROMOTED") throw new Error(`NAVIGATION_SCOPE_TRANSFER_UNAVAILABLE:${scope}`);
    const prepared = await prepareManualProjectionScopeTransfer({ ...adoption,
      payload: { ...payload, records: [] } }, store, scope, now);
    let targetVersionId: string;
    if (prepared.candidate.id === prepared.expectedBaseVersionId) {
      const target = await readPromotedCivicData<CuratedReaderProjection>(contract.recordClass, contract.scope,
        { store, now, bypassCache: true });
      if (target.kind !== "PROMOTED" || target.projection.versionId !== prepared.expectedBaseVersionId ||
          (await recordRoutineReaderProjectionReadback(store, contract, target.projection, now))?.status !== "PASS") {
        throw new Error(`NAVIGATION_SCOPE_TRANSFER_READBACK_FAILED:${scope}`);
      }
      targetVersionId = target.projection.versionId;
    } else {
      const outcome = await processRegisteredManualCandidate(store, "ballot-navigation", prepared.candidate, now, prepared.expectedBaseVersionId);
      const readback = outcome.readerReadback ?? (outcome.promoted
        ? await recordRoutineReaderProjectionReadback(store, contract, outcome.promoted, now) : null);
      if (!outcome.promoted || readback?.status !== "PASS") {
        throw new Error(`NAVIGATION_SCOPE_TRANSFER_READBACK_FAILED:${scope}:${outcome.candidate.failureDetail ?? readback?.detail ?? outcome.candidate.state}`);
      }
      targetVersionId = outcome.promoted.versionId;
    }
    if (!store.retireTransferredProjection || !await store.retireTransferredProjection({ recordClass: contract.recordClass,
      sourceScope: scope, sourceVersionId: read.projection.versionId, targetScope: contract.scope,
      targetVersionId, at: now })) throw new Error(`NAVIGATION_SCOPE_RETIREMENT_FAILED:${scope}`);
    candidateId = targetVersionId; promotedVersionId = targetVersionId;
    fields.push(...read.value.records.filter(row => !before.has(row.id)).map(row => row.id));
  }
  return { candidateId, promotedVersionId, fields };
}

function configuredReports(config: BallotNavigationSourceConfig): BallotNavigationStateReport[] {
  const records = (config.package.payload as CuratedReaderProjection).records;
  return config.states.map(state => ({ ...state, facts: records.filter(row => row.kind === "ELECTION_FIELD" &&
    (row.value as Record<string, unknown>).state === state.state).map(row => {
      const value = row.value as import("./election-fields.ts").PublishedElectionField["value"];
      return { kind: value.fieldKind, value: value.text, quote: value.quote, dates: value.dates, sourceUrl: value.url,
        phone: value.phone, navigationUrl: value.navigationUrl };
    }) }));
}

async function sourceArtifact(input: {
  readonly bytes: Uint8Array; readonly url: string; readonly contentType: string; readonly observedAt: string;
  readonly publisher: string; readonly state: string; readonly vault: Pick<CycleVault, "putBytes">;
  readonly repos: Pick<ControlPlaneRepositories, "artifacts">;
  readonly recorded: Set<string>;
  readonly methodRouteId?: string;
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

export async function readBallotNavigationReports(directory: string) {
  const path = await realpath(resolve(directory));
  const relativePath = relative(await realpath(process.cwd()), path);
  if (!isAbsolute(relativePath) && relativePath !== ".." && !relativePath.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) {
    throw new Error("NAVIGATION_REPORTS_MUST_BE_OUTSIDE_REPOSITORY");
  }
  const reports: BallotNavigationStateReport[] = [];
  const gaps: { divisionId: string; kind: string; detail: string }[] = [];
  for (const file of (await readdir(path)).filter(file => /^[a-z]{2}\.json$/i.test(file)).sort()) {
    const state = file.slice(0, 2).toUpperCase();
    try {
      const report = JSON.parse(await readFile(join(path, file), "utf8")) as BallotNavigationStateReport;
      if (report.state !== state) throw new Error("NAVIGATION_REPORT_STATE_MISMATCH");
      reports.push(report);
    } catch (error) { gaps.push({ divisionId: divisionFor(state), kind: "source", detail: sanitizedErrorDiagnostic(error) }); }
  }
  return { reports, gaps };
}

export async function refreshBallotNavigation(input: {
  readonly store: RoutineDataStore;
  readonly repos: Pick<ControlPlaneRepositories, "artifacts" | "adminConfig">;
  readonly vault: Pick<CycleVault, "putBytes">;
  readonly now: string;
  readonly directory?: string;
  readonly reports?: readonly BallotNavigationStateReport[];
  readonly config?: BallotNavigationSourceConfig;
  readonly fetch?: typeof fetch;
}) {
  const loaded = input.directory ? await readBallotNavigationReports(input.directory) : null;
  const config = input.config ?? (!input.reports && !loaded
    ? JSON.parse(await readFile(BALLOT_NAVIGATION_INPUT_PATH, "utf8")) as BallotNavigationSourceConfig : null);
  const reviewed = config ? await publishReviewedInput(config, input.store, input.now) : null;
  const reports = input.reports ?? loaded?.reports ?? configuredReports(config!);
  const gaps = [...loaded?.gaps ?? []];
  const sourcePolicy = await readPublicationSourcePolicy(input.repos);
  const fetcher = input.fetch ?? fetch;
  const runtime = { fetch: fetcher, captureCache: new Map() };
  const fields: ElectionFieldInput[] = [];
  await runPool(reports, 8, async report => {
    const divisionId = divisionFor(report.state);
    if (!electionFieldState(divisionId) || !/^\d{4}-\d{2}-\d{2}$/.test(report.electionDate) ||
        !Array.isArray(report.sources) || !Array.isArray(report.facts) ||
        config && report.electionDate !== config.electionDate) {
      gaps.push({ divisionId, kind: "source", detail: "NAVIGATION_STATE_ELECTION_INVALID" }); return;
    }
    const session = votingFetchSession(runtime);
    const captures = new Map<string, { capture: WorkerPublicationCapture; linkingPage?: OfficialLinkingPage;
      websiteDelegation?: GovernmentWebsiteDelegation }>();
    let recorded: Set<string>;
    try {
      recorded = new Set((await input.repos.artifacts.read(`ballot-navigation:${report.state.toLowerCase()}`))
        .map(row => `${row.artifactId}:${row.recordedAt}`));
    } catch (error) {
      gaps.push({ divisionId, kind: "source", detail: `SOURCE_ARCHIVE_READ_UNAVAILABLE:${sanitizedErrorDiagnostic(error)}` }); return;
    }
    const directAuthority = (source: BallotNavigationSourceReport) => Boolean(source && typeof source.finalUrl === "string" && isOfficialSource(source.finalUrl));
    for (const source of [...report.sources].sort((a, b) => Number(directAuthority(b)) - Number(directAuthority(a)))) {
      if (!source || typeof source.requestedUrl !== "string") {
        gaps.push({ divisionId, kind: "source", detail: "NAVIGATION_SOURCE_URL_INVALID" }); continue;
      }
      try {
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
        let linkingPage = source.linkingPage ?? linkingPageFrom(url,
          [...captures.values()].map(saved => ({ canonicalUrl: saved.capture.evidence.canonicalUrl, text: saved.capture.evidence.text, linkingPage: saved.linkingPage }))) ?? undefined;
        if (source.officialFrom) {
          const official = await session.get(source.officialFrom);
          linkingPage = { url: official.url, html: decode(official.bytes, official.contentType).text };
          await sourceArtifact({ bytes: official.bytes, url: official.url, contentType: official.contentType,
            observedAt: input.now, publisher: source.publisher, state: report.state, vault: input.vault, repos: input.repos, recorded });
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
            methodRouteId: "ballot-navigation:government-dns" });
          websiteDelegation = { governmentUrl: source.websiteDelegation.governmentUrl, html: decode(bytes, contentType).text,
            dns: { url: dnsUrl, text: dns.text, artifactId: dns.artifact.id, contentHash: dns.artifact.contentHash, retrievedAt: dnsAt } };
        }
        if (!isOfficialSource(url, linkingPage, websiteDelegation)) throw new Error("NAVIGATION_SOURCE_NOT_OFFICIAL");
        const saved = await sourceArtifact({ bytes, url, contentType, observedAt, publisher: source.publisher,
          state: report.state, vault: input.vault, repos: input.repos, recorded });
        const capture: WorkerPublicationCapture = { observedAt, httpStatus: 200, transport: "REACHABLE", partial: false, sourcePolicy,
          rawContentHash: saved.rawContentHash,
          evidence: { artifactId: saved.artifact.id, contentHash: saved.artifact.contentHash, text: saved.text,
            canonicalUrl: url, retrievedAt: observedAt, sourceId: source.publisher,
            acquiredByAttemptId: saved.artifact.attemptId, methodRouteId: saved.artifact.methodRouteId,
            ...(saved.sourceDocument ? { sourceDocument: saved.sourceDocument } : {}) } };
        for (const key of [source.requestedUrl, source.finalUrl, url]) captures.set(key, { capture, linkingPage, websiteDelegation });
      } catch (error) { gaps.push({ divisionId, kind: "source", detail: `${source.requestedUrl}:${sanitizedErrorDiagnostic(error)}` }); }
    }
    for (const fact of report.facts) {
      if (!fact || typeof fact.sourceUrl !== "string") {
        gaps.push({ divisionId, kind: "source", detail: "NAVIGATION_FIELD_SOURCE_INVALID" }); continue;
      }
      const saved = captures.get(fact.sourceUrl);
      if (!saved) { gaps.push({ divisionId, kind: fact.kind, detail: `NAVIGATION_SOURCE_UNAVAILABLE:${fact.sourceUrl}` }); continue; }
      const capture = saved.capture;
      fields.push({ divisionId, kind: fact.kind, value: fact.value, quote: fact.quote, dates: fact.dates,
        electionDate: report.electionDate, phone: fact.phone, navigationUrl: fact.navigationUrl,
        sourceUrl: capture.evidence.canonicalUrl, linkingPage: saved.linkingPage, websiteDelegation: saved.websiteDelegation,
        document: { url: capture.evidence.canonicalUrl, text: capture.evidence.text, collectedAt: capture.observedAt, capture } });
    }
    gaps.push(...(report.gaps ?? []).map(gap => typeof gap === "string" ? { divisionId, kind: "source", detail: gap } : { divisionId, ...gap }));
  });
  const published = await publishElectionFields({ store: input.store, now: input.now, fields, verify: section3Record });
  return { candidateId: published.candidateId ?? reviewed?.candidateId ?? null,
    promotedVersionId: published.promotedVersionId ?? reviewed?.promotedVersionId ?? null,
    fields: [...new Set([...(reviewed?.fields ?? []), ...published.fields])], gaps: [...gaps, ...published.gaps] };
}
