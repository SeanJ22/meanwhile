import { acquireKnownRelease, type KnownRelease } from "../sources/known-release.ts";
import { readSourceApi } from "../control-plane/scheduler/scout-api.ts";
import { portraitHash, type PortraitCapture, type PortraitSources } from "../photos/evidence.ts";
import { storeVerifiedPortrait } from "../photos/store.ts";
import { portraitBindingMatches } from "../photos/binding.ts";
import { imagesIn, pickPortraits } from "../hunt/portrait-pick.ts";
import { isOfficialSource } from "../civic-data/source-authority.ts";
import { isSourceAcquisitionFailure } from "../civic-data/source-acquisition-error.ts";
import { sanitizedErrorDiagnostic } from "../ops/error-diagnostic.ts";
import { runBoundedWorkPool } from "../ops/bounded-work-pool.ts";
import type { RoutineCandidate } from "../civic-data/types.ts";
import type { Officeholder, OfficeholderPhoto } from "./types.ts";
import type { FederalDirectoryReadModel } from "./federal-directory-data-plane.ts";

type PortraitGap = NonNullable<RoutineCandidate["excludedFacts"]>[number];
export interface CongressPortraitResult {
  readonly projection: FederalDirectoryReadModel;
  readonly excludedFacts: readonly PortraitGap[];
  readonly attempted: number;
}
interface CongressPortraitOptions {
  readonly now?: () => string;
  readonly apiKeyConfigured?: boolean;
  readonly acquire?: typeof acquireKnownRelease;
  readonly readApi?: typeof readSourceApi;
  readonly storePortrait?: (personId: string, sources: PortraitSources, at: string, signal: AbortSignal) => Promise<OfficeholderPhoto>;
  readonly previousExcludedFacts?: readonly PortraitGap[];
}

function captureFor(page: KnownRelease): PortraitCapture {
  return { transport: "REACHABLE", partial: false, httpStatus: page.httpStatus, observedAt: page.checkedAt,
    evidence: { retrievedAt: page.retrievedAt, vaultKey: page.vaultKey, canonicalUrl: page.finalUrl,
      sourceId: "Congress member official portrait", contentHash: portraitHash(page.bytes),
      text: new TextDecoder("utf-8", { fatal: true }).decode(page.bytes) } };
}

/** Only the official URL already supplied for this native member is a fallback. */
function officialPage(person: Officeholder): string | null {
  if (!person.websiteUrl) return null;
  try {
    const url = new URL(person.websiteUrl);
    if (url.protocol === "http:") url.protocol = "https:";
    return !url.username && !url.password && isOfficialSource(url.href) ? url.href : null;
  } catch { return null; }
}

/** Finite known members share the existing deadline; a failed portrait never holds a person's other facts. */
export async function congressPortraits(value: FederalDirectoryReadModel, asOf: string, signal?: AbortSignal,
  options: CongressPortraitOptions = {}): Promise<CongressPortraitResult> {
  const now = options.now ?? (() => new Date().toISOString());
  const acquire = options.acquire ?? acquireKnownRelease;
  const readApi = options.readApi ?? readSourceApi;
  const storePortrait = options.storePortrait ?? ((id, sources, at, abort) => storeVerifiedPortrait(id, sources, at, undefined, "officials", abort));
  const sourceSignal = signal ?? AbortSignal.timeout(120_000);
  const apiConfigured = options.apiKeyConfigured ?? Boolean(process.env.CONGRESS_API_KEY?.trim());
  const holders = value.roster.officeholders.map(row => ({ ...row }));
  const lastAttempt = new Map<string, string>();
  for (const fact of options.previousExcludedFacts ?? []) {
    const record = fact.record as { personId?: unknown; attemptedAt?: unknown } | undefined;
    if (fact.code.startsWith("CONGRESS_PORTRAIT_") && typeof record?.personId === "string" &&
      typeof record.attemptedAt === "string" && Number.isFinite(Date.parse(record.attemptedAt)) &&
      record.attemptedAt > (lastAttempt.get(record.personId) ?? "")) lastAttempt.set(record.personId, record.attemptedAt);
  }
  const due = holders.filter(row => !portraitBindingMatches(row.personId ?? row.id, row.photo ?? { url: "" }) ||
    Date.parse(asOf) - Date.parse(row.photo!.verification!.checkedAt) >= 30 * 86_400_000)
    .sort((a, b) => (lastAttempt.get(a.personId ?? a.id) ?? "").localeCompare(lastAttempt.get(b.personId ?? b.id) ?? "") ||
      (a.photo?.verification?.checkedAt ?? "").localeCompare(b.photo?.verification?.checkedAt ?? "") || a.id.localeCompare(b.id));
  const dueKeys = new Set(due.map(person => `${person.personId ?? person.id}:portrait`));
  // The existing per-field receipt is also the continuation order: an unavailable early ID cannot starve untouched members.
  const excludedFacts: PortraitGap[] = (options.previousExcludedFacts ?? []).filter(fact =>
    fact.code.startsWith("CONGRESS_PORTRAIT_") && fact.key && dueKeys.has(fact.key));
  const refreshed = new Set<string>();
  let attempted = 0;
  const gap = (person: Officeholder, sourceUrl: string | null, code: string, detail: string, error?: unknown, page?: KnownRelease) => {
    let diagnostic = error === undefined ? "" : sanitizedErrorDiagnostic(error, 500);
    for (const [key, secret] of Object.entries(process.env)) if (/(?:API_KEY|TOKEN)$/.test(key) && secret) {
      diagnostic = diagnostic.split(secret).join("[REDACTED]").split(encodeURIComponent(secret)).join("[REDACTED]");
    }
    excludedFacts.push({ key: `${person.personId ?? person.id}:portrait`, code,
      detail: `${detail}${diagnostic ? ` ${diagnostic}` : ""}`,
      record: { personId: person.personId ?? person.id, sourceUrl, attemptedAt: now(),
        ...(page ? { httpStatus: page.httpStatus, rawHash: page.sha256, vaultKey: page.vaultKey,
          sourceRetrievedAt: page.retrievedAt, sourceCheckedAt: page.checkedAt } : {}),
        retainedVerifiedPortrait: Boolean(person.photo && portraitBindingMatches(person.personId ?? person.id, person.photo)) } });
  };
  const publish = async (person: Officeholder, page: KnownRelease, imageUrl: string) => {
    const personId = person.personId ?? person.id;
    // Read the verification clock after the asynchronous capture. The source's own vintage stays unchanged.
    person.photo = await storePortrait(personId, { subject: { personId, name: person.name,
      nativeIds: person.nativeIds, profileUrls: [page.finalUrl] }, imageUrl, captures: [captureFor(page)] }, now(), sourceSignal);
    refreshed.add(personId);
  };
  const results = await runBoundedWorkPool(due, 3, async person => {
    if (sourceSignal.aborted) return;
    attempted++;
    for (let i = excludedFacts.length - 1; i >= 0; i--) if (excludedFacts[i].key === `${person.personId ?? person.id}:portrait`) excludedFacts.splice(i, 1);
    const bioguide = /^congress:([A-Z]\d{6})$/.exec(person.id)?.[1];
    if (!bioguide) { gap(person, null, "CONGRESS_PORTRAIT_ID_UNRESOLVED", "Portrait remains owed: native Bioguide identity is invalid."); return; }
    const apiUrl = `https://api.congress.gov/v3/member/${bioguide}?format=json`;
    let apiUnconfigured = false;
    {
      let page: KnownRelease | undefined;
      try {
        page = await acquire({ sourceId: "congress-member", releaseId: bioguide, url: apiUrl,
          parserVersion: "congress-member-portrait/2", maxBytes: 1024 * 1024, checkAfterMs: 7 * 86_400_000, signal: sourceSignal,
          fetchImpl: async (_resource, init) => {
            // Held evidence is reusable without a live key; only an actual API request needs it.
            if (!apiConfigured) { apiUnconfigured = true; throw Error("CONGRESS_API_KEY_UNCONFIGURED"); }
            const result = await readApi("congress_api", { path: `member/${bioguide}`, params: { format: "json" } }, { signal: init?.signal ?? sourceSignal });
            return new Response(result.text, { status: result.status, headers: { "content-type": "application/json" } });
          }, validate: bytes => {
            const row = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)).member;
            if (row?.bioguideId !== bioguide) throw Error("CONGRESS_MEMBER_ID_MISMATCH");
          } });
        const member = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(page.bytes)).member;
        if (typeof member.depiction?.imageUrl === "string") { await publish(person, page, member.depiction.imageUrl); return; }
        gap(person, apiUrl, "CONGRESS_PORTRAIT_IMAGE_NOT_FOUND", "The captured member API response has no depiction; this source did not supply a portrait.", undefined, page);
      } catch (error) {
        if (apiUnconfigured) gap(person, apiUrl, "CONGRESS_PORTRAIT_API_UNCONFIGURED", "No reusable member API capture is held and CONGRESS_API_KEY is not configured; the held official member URL is tried next.");
        else gap(person, apiUrl, isSourceAcquisitionFailure(error) ? "CONGRESS_PORTRAIT_SOURCE_FAILED" : "CONGRESS_PORTRAIT_PROCESSING_FAILED",
          "The member API portrait did not complete; prior verified portrait and person facts are retained.", error, page);
      }
    }
    if (sourceSignal.aborted) return;
    const url = officialPage(person);
    if (!url) { gap(person, null, "CONGRESS_PORTRAIT_OFFICIAL_PAGE_UNRESOLVED", "No usable official member URL is held; no new source route was invented."); return; }
    try {
      const host = new URL(url).hostname.replace(/^www\./, "");
      const page = await acquire({ sourceId: "congress-member-page", releaseId: bioguide, url,
        parserVersion: "congress-member-page-portrait/1", maxBytes: 2 * 1024 * 1024, checkAfterMs: 7 * 86_400_000,
        signal: sourceSignal, allowedHosts: [host, `www.${host}`], headers: { accept: "text/html" } });
      const images = pickPortraits(person.name, imagesIn(new TextDecoder("utf-8", { fatal: true }).decode(page.bytes), page.finalUrl));
      if (!images.length) { gap(person, page.finalUrl, "CONGRESS_PORTRAIT_IMAGE_NOT_FOUND", "The captured official page has no image explicitly labelled with this member's full name; the portrait refresh remains owed.", undefined, page); return; }
      for (const image of images) {
        if (sourceSignal.aborted) return;
        try { await publish(person, page, image.src); return; }
        catch (error) { gap(person, page.finalUrl, "CONGRESS_PORTRAIT_PROCESSING_FAILED", "The official page's named image did not verify or store; prior verified portrait and person facts are retained.", error, page); }
      }
    } catch (error) {
      gap(person, url, isSourceAcquisitionFailure(error) ? "CONGRESS_PORTRAIT_SOURCE_FAILED" : "CONGRESS_PORTRAIT_PROCESSING_FAILED",
        "The held official member page did not complete; prior verified portrait and person facts are retained.", error);
    }
  });
  for (const result of results) if (!result.ok) gap(due[result.index]!, null, "CONGRESS_PORTRAIT_PROCESSING_FAILED",
    "The portrait work item did not complete; the member's accepted facts remain available.", result.error);
  for (let i = 0; i < excludedFacts.length; i++) {
    const personId = (excludedFacts[i].record as { personId?: string } | undefined)?.personId;
    if (personId && refreshed.has(personId)) excludedFacts[i] = { ...excludedFacts[i],
      record: { ...(excludedFacts[i].record as object), portraitStatus: "VERIFIED_FROM_ALTERNATIVE_SOURCE" } };
  }
  if (sourceSignal.aborted && refreshed.size < due.length) excludedFacts.push({ code: "CONGRESS_PORTRAIT_WORK_REMAINS",
    detail: `${due.length - refreshed.size} known portrait refreshes remain after the existing acquisition deadline (${due.length - attempted} not started, ${attempted - refreshed.size} attempted without a newly verified portrait). Verified portraits publish now; the next standing pass prioritizes unattempted native IDs from the retained field receipts.` });
  return { projection: { ...value, roster: { ...value.roster, officeholders: holders } }, excludedFacts, attempted };
}
