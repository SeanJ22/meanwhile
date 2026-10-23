import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { votingFetchSession } from "../ballot/voting-source-fetch.ts";
import { artifactId, classifyAcquisition, defaultRetention, deriveSanitized, extractionSourceDocument, type Artifact } from "../control-plane/evidence/artifact.ts";
import type { CycleVault } from "../control-plane/scheduler/vault.ts";
import type { ControlPlaneRepositories } from "../control-plane/repository/types.ts";
import { section3Record } from "../control-plane/promotion/section3.ts";
import { readPublicationSourcePolicy } from "../control-plane/promotion/source-settings.ts";
import { extractEmbeddedHtml, extractTextLayer } from "../extract/text-layer.ts";
import { sanitizedErrorDiagnostic } from "../ops/error-diagnostic.ts";
import { ballotNavigationScope, ballotNavigationDivision } from "./ballot-navigation-scope.ts";
import { BALLOT_NAVIGATION_INPUT_DIRECTORY } from "./ballot-navigation-input.ts";
import { publishElectionFields } from "./election-field-publication.ts";
import { electionFieldState, type ElectionFieldInput } from "./election-fields.ts";
import { isOfficialSource, type GovernmentWebsiteDelegation, type OfficialLinkingPage } from "./source-authority.ts";
import type { RoutineDataStore } from "./store.ts";
import type { WorkerPublicationCapture } from "./worker-roster-publication.ts";
import type { CuratedReaderProjection, ManualProjectionPackage } from "./manual-projections.ts";
import { prepareNavigationSuccessor, readNavigationBase } from "./navigation-successor.ts";
import { processNavigationCandidate } from "./promotion.ts";
import { requiredManualProductionContract } from "./manual-contracts.ts";
import { readManualProjectionPrior } from "./manual-projections.ts";
import { manualRecordSourceUrls } from "./manual-source-isolation.ts";
import type { ManualSuccessorCandidate } from "./manual-prior-authority.ts";
import type { ManualSourceReview } from "./types.ts";

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
  const base = await readNavigationBase(store, ballotNavigationScope(config.state));
  if (base && Date.parse(base.record.candidate.temporal.sourceThrough) >= Date.parse(source.sourceThrough)) return null;
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
    const version: Awaited<ReturnType<RoutineDataStore["readCandidate"]>> = await store.readCandidate(versionId);
    for (const source of version?.candidate.retrieval.manualSourceReceipt?.sources ?? []) {
      const url = [source.requestedUrl, source.finalUrl].find(row => owed.has(row));
      if (source.reviewOutcome !== "SUPPORTED" || !url) continue;
      sources.set(url, source); owed.delete(source.requestedUrl); owed.delete(source.finalUrl);
    }
    versionId = (version?.candidate as ManualSuccessorCandidate | undefined)?.manualPriorAuthority?.versionId;
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
  const carried = await readNavigationBase(input.store, ballotNavigationScope(input.state)) === null
    ? await carryNationalRecords(input.state, input.store, input.now) : null;
  const reviewed = config ? await publishReviewedInput(config, input.store, input.now) : null;
  const report = input.report ?? (input.directory ? await readBallotNavigationReport(input.directory, input.state) : configuredReport(config!));
  if (report.state !== input.state) throw new Error("NAVIGATION_INPUT_CROSSES_STATE");
  const gaps: { divisionId: string; kind: string; detail: string }[] = [];
  const sourcePolicy = await readPublicationSourcePolicy(input.repos);
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
        let linkingPage = source.linkingPage ?? authorities.get(new URL(url).hostname);
        if (source.officialFrom) {
          const official = await session.get(source.officialFrom);
          indexAuthorityLinks(authorities, official.url, decode(official.bytes, official.contentType).text);
          linkingPage = authorities.get(new URL(url).hostname);
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
        const facts = new Set([source.requestedUrl, source.finalUrl, url].flatMap(key => bySource.get(key) ?? []));
        for (const key of [source.requestedUrl, source.finalUrl, url]) bySource.delete(key);
        for (const fact of facts) yield { divisionId: fact.divisionId ?? divisionId, kind: fact.kind, value: fact.value, quote: fact.quote, dates: fact.dates,
          electionDate: report.electionDate, phone: fact.phone, navigationUrl: fact.navigationUrl,
          sourceUrl: url, linkingPage, websiteDelegation,
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
  const published = await publishElectionFields({ store: input.store, now: input.now, fields: fields(), verify: section3Record });
  return { candidateId: published.candidateId ?? carried?.candidateId ?? reviewed?.candidateId ?? null,
    promotedVersionId: published.promotedVersionId ?? carried?.promotedVersionId ?? reviewed?.promotedVersionId ?? null,
    fields: [...new Set([...(reviewed?.fields ?? []), ...(carried?.fields ?? []), ...published.fields])], gaps: [...gaps, ...published.gaps] };
}
