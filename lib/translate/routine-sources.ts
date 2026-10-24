import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { BallotSet } from "../ballot/types.ts";
import { registeredVotingSourceDoors } from "../ballot/voting-source-publication.ts";
import { ZERO_COST, type Attempt } from "../control-plane/attempt.ts";
import { recordArtifactMetadata } from "../control-plane/repository/coordinator.ts";
import type { ControlPlaneRepositories } from "../control-plane/repository/types.ts";
import { artifactId, recordAcquisition, type Artifact } from "../control-plane/evidence/artifact.ts";
import { putArtifact, readForParser } from "../control-plane/evidence/store.ts";
import { DurableEvidenceStore } from "../control-plane/evidence/durable-store.ts";
import { evidenceProjection } from "../control-plane/workers/evidence-projection.ts";
import { extractPdf } from "../control-plane/scheduler/scout-tools.ts";
import { VAULT_DIR } from "../control-plane/scheduler/vault.ts";
import type { WorkerPublicationCapture } from "../civic-data/worker-roster-publication.ts";
import { isOfficialSource } from "../civic-data/source-authority.ts";
import { linkingPageFrom } from "../control-plane/promotion/section3.ts";
import { readPublicationSourcePolicy } from "../control-plane/promotion/source-settings.ts";
import { contentHash } from "../control-plane/ids.ts";
import type { VotingSourceDoor } from "../ballot/voting-source-types.ts";
import { hubLinks, measureLabels, measureLinkNames, measureLinks, measureSearchQueries, pageNamesMeasure } from "./routine-measure-pages.ts";
import type { MeasureFind } from "./routine-finds.ts";

/** Pages followed per measure from the election office's own lists, hubs followed once for the whole state, and pages read from search. */
const LINKS_PER_MEASURE = 3, HUBS_PER_STATE = 6, SEARCH_PAGES_PER_MEASURE = 3, DOOR_PAGES_PER_MEASURE = 4;
/** An empty search is not repeated sooner than this. */
export const MEASURE_SEARCH_RETRY_MS = 6 * 60 * 60_000;

export type MeasurePageSearch = (query: string, domains: readonly string[]) => Promise<readonly { readonly url: string; readonly title: string }[]>;

/** Read this state's cited measure sources and their registered official
 * linking pages. Only freshly saved response bytes can establish authority. */
export async function loadRoutineMeasureSources(input: {
  readonly repos: ControlPlaneRepositories;
  readonly root: string;
  readonly state: string;
  readonly ballots: readonly BallotSet[];
  readonly now: () => string;
  readonly open: (url: string) => Promise<Response>;
  /** Pages found earlier for measures with no readable official text, and searches that found nothing. */
  readonly finds?: { readonly read: () => Promise<readonly MeasureFind[]>; readonly save: (find: MeasureFind) => Promise<void> };
  /** Present only while Admin allows paid search. */
  readonly search?: MeasurePageSearch | null;
}) {
  const urls = new Set<string>();
  const doorIds = new Set<string>();
  const blanks: MeasureBlank[] = [];
  for (const ballot of input.ballots) for (const contest of ballot.contests.filter(row => row.type === "MEASURE")) {
    const measure = ballot.measures?.find(row => row.contestId === contest.id);
    const analysis = ballot.measureAnalyses?.analyses.find(row => row.contestId === contest.id);
    const prior = ballot.measureRecords?.find(row => row.contestId === contest.id);
    const citedUrls = [contest.measureTextUrl, prior?.sourceUrl, measure?.provenance.sourceUrl, analysis?.analysisUrl, contest.provenance.sourceUrl];
    const labels = measureLabels({ title: contest.title, questionText: measure?.questionText, officialNumber: measure?.officialNumber, analysisText: analysis?.text });
    blanks.push({ contestId: contest.id, ocdId: contest.ocdId, title: contest.title, labels, designation: measure?.officialNumber ?? null,
      cited: new Set(citedUrls.filter((url): url is string => Boolean(url?.startsWith("https://")))), year: ballot.election.date?.slice(0, 4) ?? "",
      priorUrl: prior?.sourceUrl ?? null, textUrl: contest.measureTextUrl ?? null });
    if (citedUrls.some(url => url?.startsWith("https://") && !isOfficialSource(url))) {
      for (const provenance of [contest.provenance, measure?.provenance]) {
        if (provenance?.doorId) doorIds.add(provenance.doorId);
      }
    }
    for (const url of citedUrls) {
      if (url?.startsWith("https://")) urls.add(url);
    }
  }
  if (doorIds.size) {
    const doors = await registeredVotingSourceDoors(input.repos.doors, input.state);
    for (const door of doors.filter(door => doorIds.has(door.id))) {
      const seen = new Set<string>();
      for (let linking = door.officialLinkingPage; linking && !seen.has(linking.url); linking = linking.linkingPage ?? undefined) {
        seen.add(linking.url);
        if (linking.url.startsWith("https://")) urls.add(linking.url);
      }
    }
  }
  const vault = new DurableEvidenceStore(join(input.root, ...VAULT_DIR));
  const sourcePolicy = await readPublicationSourcePolicy(input.repos);
  const captures: WorkerPublicationCapture[] = [], failures: { url: string; reason: string }[] = [];
  /** Visible bytes of every page read this pass, kept only to follow its links; one state at a time. */
  const pages = new Map<string, string>(), tried = new Set<string>();

  async function acquire(url: string): Promise<string | null> {
    if (tried.has(url)) return pages.get(url) ?? null;
    tried.add(url);
    const at = input.now(), id = `measure-source:${randomUUID()}`;
    const attempt: Attempt = { id, routeTaskId: `measure-translations:${input.state}`, workItemId: id,
      worker: { role: "ACQUIRER", provider: "we-the-people", version: "measure-source/1", instance: input.state },
      leaseId: id, startedAt: at, endedAt: null, outcome: null, abortReason: null,
      artifactIds: [], cost: ZERO_COST, methodVersion: 1, policyVersion: "R7" };
    let saved = (await input.repos.attempts.put(attempt.id, attempt, at)).persisted;
    const artifacts: string[] = [];
    const retain = async (artifact: Artifact, bytes: Uint8Array) => {
      await putArtifact(vault, "freshness", artifact, bytes);
      await recordArtifactMetadata(input.repos, { artifactId: artifact.id, workItemId: id, routeTaskId: attempt.routeTaskId,
        attemptId: id, tier: artifact.tier, contentHash: artifact.contentHash, byteLength: artifact.byteLength,
        contentType: artifact.contentType, canonicalUrl: artifact.canonicalUrl, partial: false, recordedAt: at }, at);
      artifacts.push(artifact.id);
    };
    try {
      const response = await input.open(url);
      if (!response.ok || response.status === 206) throw new Error(`Official text returned HTTP ${response.status}.`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      const base = { canonicalUrl: url, retrievalUrl: response.url || url, retrievedAt: at, httpStatus: response.status,
        sourceId: new URL(url).hostname, methodRouteId: "measure-source/1", workItemId: id, attemptId: id,
        permission: "ALLOWED" as const, transport: "REACHABLE" as const };
      let artifact: Artifact;
      if (Buffer.from(bytes.subarray(0, 5)).toString() === "%PDF-") {
        const originalHash = contentHash(bytes);
        const parent: Artifact = { ...base, id: artifactId("RAW", originalHash), tier: "RAW", contentHash: originalHash,
          byteLength: bytes.byteLength, contentType: "application/pdf", headers: {}, retentionPolicy: "EVIDENCE_PERMANENT" };
        await retain(parent, bytes);
        const extracted = await extractPdf(bytes);
        if (extracted.kind !== "TEXT" || !extracted.complete) throw new Error("The official PDF could not be read completely.");
        const text = extracted.text.replace(/\s+/g, " ").trim();
        const captured = recordAcquisition({ ...base, contentType: "text/plain" }, text).artifact;
        if (captured.tier === "RESTRICTED_RAW") throw new Error("Official text contains restricted material.");
        artifact = { ...captured, id: artifactId("EXTRACTED_DERIVED", captured.contentHash), tier: "EXTRACTED_DERIVED",
          extraction: { kind: "PDF_TEXT", version: "pdf-transcription/1", complete: true, pages: extracted.pages, parent } };
        await retain(artifact, Buffer.from(text));
      } else {
        const text = Buffer.from(bytes).toString("utf8");
        if (!Buffer.from(text).equals(Buffer.from(bytes))) throw new Error("The official document is not valid UTF-8 text.");
        artifact = recordAcquisition({ ...base, contentType: response.headers.get("content-type") ?? "text/plain" }, text).artifact;
        if (artifact.tier === "RESTRICTED_RAW") throw new Error("Official text contains restricted material.");
        await retain(artifact, Buffer.from(text));
      }
      const { input: parserInput } = await readForParser(vault, "freshness", artifact);
      saved = await input.repos.attempts.compareAndSet(id, saved.revision, { ...saved.value, artifactIds: artifacts, endedAt: input.now(), outcome: "COMPLETED" }, input.now());
      const evidence = evidenceProjection(parserInput);
      captures.push({ evidence, sourcePolicy, observedAt: at, partial: false, httpStatus: response.status, transport: "REACHABLE" });
      pages.set(url, evidence.text);
      return evidence.text;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      failures.push({ url, reason });
      await input.repos.attempts.compareAndSet(id, saved.revision, { ...saved.value, artifactIds: artifacts, endedAt: input.now(), outcome: "ABORTED", abortReason: reason }, input.now());
      return null;
    }
  }

  for (const url of urls) await acquire(url);

  // A measure whose cited pages never name it has no readable official text. Its own page on the
  // state or county election office's site is found, saved like any cited source, and the
  // explainer is written from it. Every other measure and state is untouched.
  const discovered = new Map<string, string[]>();
  const named = (blank: MeasureBlank): boolean => [...blank.cited, ...(blank.priorUrl ? [blank.priorUrl] : [])].some(url => {
    const text = pages.get(url);
    return text !== undefined && (url === blank.priorUrl || url === blank.textUrl || pageNamesMeasure(text, blank.labels));
  });
  // The same measure appears in several ballot styles; it is one blank.
  const distinct = new Map<string, MeasureBlank>();
  for (const blank of blanks) {
    const key = JSON.stringify([blank.ocdId, blank.contestId]), seen = distinct.get(key);
    distinct.set(key, seen ? { ...seen, cited: new Set([...seen.cited, ...blank.cited]), priorUrl: seen.priorUrl ?? blank.priorUrl } : blank);
  }
  const open = [...distinct.values()].filter(blank => !named(blank));
  if (open.length) {
    const doors = await registeredVotingSourceDoors(input.repos.doors, input.state).catch((error: unknown) => {
      failures.push({ url: "voting-source-doors", reason: error instanceof Error ? error.message : String(error) });
      return [] as VotingSourceDoor[];
    });
    const finds = await (input.finds?.read() ?? Promise.resolve([] as readonly MeasureFind[])).catch(() => [] as readonly MeasureFind[]);
    const stateName = doors.find(door => door.scope.name)?.scope.name ?? input.state;
    let hubsLeft = HUBS_PER_STATE;
    const heldPages = () => [...pages].map(([url, html]) => ({ url, html }));
    // Official means a .gov page, or one a saved official page links to; the same standing the writer step requires.
    const official = (url: string) => isOfficialSource(url) || linkingPageFrom(url, captures.map(capture => capture.evidence)) !== null;
    const found = async (blank: MeasureBlank, url: string): Promise<boolean> => {
      const text = await acquire(url);
      if (text === null || !pageNamesMeasure(text, blank.labels)) return false;
      discovered.set(blank.contestId, [...new Set([...(discovered.get(blank.contestId) ?? []), url])]);
      return true;
    };
    for (const blank of open) {
      const names = measureLinkNames(blank.labels, blank.title);
      let done = false;
      for (const find of finds.filter(row => row.kind === "FOUND" && row.contestId === blank.contestId && row.url)) done ||= await found(blank, find.url!);
      if (done) continue;
      const scoped = doors.filter(door => door.scope.ocdId === blank.ocdId || door.scope.ocdId === `ocd-division/country:us/${input.state.toLowerCase() === "dc" ? "district" : "state"}:${input.state.toLowerCase()}`);
      for (const door of scoped.slice(0, DOOR_PAGES_PER_MEASURE)) {
        const chain = new Set<string>();
        for (let linking = door.officialLinkingPage; linking && !chain.has(linking.url); linking = linking.linkingPage ?? undefined) chain.add(linking.url);
        for (const url of [...chain, door.electionPageUrl, door.url]) if (url?.startsWith("https://")) await acquire(url);
      }
      const follow = async (): Promise<boolean> => {
        for (const link of measureLinks(heldPages(), names, new Set([...tried, ...blank.cited]), official).slice(0, LINKS_PER_MEASURE)) {
          if (await found(blank, link.url)) return true;
        }
        return false;
      };
      done = await follow();
      for (; !done && hubsLeft > 0;) {
        const hub = hubLinks(heldPages(), tried, official)[0];
        if (!hub) break;
        hubsLeft--;
        await acquire(hub.url);
        done = await follow();
      }
      if (!done && input.search) {
        const searched = finds.find(row => row.kind === "SEARCHED" && row.contestId === blank.contestId);
        if (!searched || Date.parse(input.now()) - Date.parse(searched.at) >= MEASURE_SEARCH_RETRY_MS) {
          const domains = [...new Set(scoped.flatMap(door => { try { return [new URL(door.url).hostname.replace(/^www\./, "")]; } catch { return []; } }))];
          let reads = 0;
          for (const query of measureSearchQueries({ state: stateName, year: blank.year, designation: blank.designation, title: blank.title })) {
            if (done) break;
            let hits: readonly { url: string; title: string }[] = [];
            try { hits = await input.search(query, domains); }
            catch (error) { failures.push({ url: "search", reason: error instanceof Error ? error.message : String(error) }); }
            for (const hit of hits) {
              if (done || reads >= SEARCH_PAGES_PER_MEASURE) break;
              if (!hit.url.startsWith("https://") || !official(hit.url)) continue;
              reads++;
              done = await found(blank, hit.url);
            }
          }
          if (!done) await input.finds?.save({ kind: "SEARCHED", contestId: blank.contestId, url: null, at: input.now() });
        }
      }
      const url = discovered.get(blank.contestId)?.[0];
      if (url && !finds.some(row => row.kind === "FOUND" && row.contestId === blank.contestId && row.url === url)) {
        await input.finds?.save({ kind: "FOUND", contestId: blank.contestId, url, at: input.now() });
      }
    }
  }
  return { captures, failures, discovered };
}

interface MeasureBlank {
  readonly contestId: string;
  readonly ocdId: string;
  readonly title: string;
  readonly labels: readonly string[];
  readonly designation: string | null;
  readonly cited: ReadonlySet<string>;
  readonly year: string;
  readonly priorUrl: string | null;
  readonly textUrl: string | null;
}
