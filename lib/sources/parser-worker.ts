import { newestFirst, type WorkInput, type WorkList, type WorkRow } from "../core/work.ts";
import type { Unlock } from "../core/capability.ts";
import { captureProvenance, receiptCapture } from "../facts/capture.ts";
import { bodyNamed, learnDoorChannel, splitSubject } from "../facts/entities.ts";
import { isOfficialSource, type OfficialLinkingPage } from "../civic-data/source-authority.ts";
import { withFactConfirmations } from "../facts/confirmation.ts";
import { publishLoaded, type Clocks, type FactDb, type Query } from "../facts/publish.ts";
import { saveCaptureCopy } from "../facts/source-copy.ts";
import { withBatchedReaderInvalidation, type ReaderCachePurger } from "../reader/cache.ts";
import type { EvidenceStore } from "../control-plane/evidence/store.ts";
import type { ControlPlaneRepositories } from "../control-plane/repository/types.ts";
import type { ProbeFetch } from "../doors/probe.ts";
import { WebsiteWait } from "../doors/probe-fetch.ts";
import { ITEM_READ_MS, runClaimLoop } from "../ops/claim-loop.ts";
import { sanitizedErrorDiagnostic } from "../ops/error-diagnostic.ts";
import type { Lead, PlatformParser } from "./parser-hook.ts";
import { platformOf } from "./platform-of.ts";

/** A link that could not be read this many times goes to a detective. */
export const LEAD_ATTEMPTS = 5;
/** The most new links one page can add; a page with more is a listing, and its parser picks the pages worth reading. */
const MAX_LINKS = 500;
export const LEAD_LEASE_MS = 300_000;
/** The most governments one page is filed under; each is a place that linked to it. */
const MAX_REPORTS = 50;
/** A page that linked here is evidence of that link however old its copy is. */
const LINKING_PAGE_WINDOW_HOURS = 30 * 24;

export interface LeadDeps {
  readonly list: WorkList;
  readonly facts: FactDb & { readonly query: Query };
  readonly repos: Pick<ControlPlaneRepositories, "artifacts" | "artifactsByCanonicalUrl">;
  readonly vault: EvidenceStore;
  /** The reader for a state's websites, which waits for a small publisher's hourly allowance and for any website that asked to be left alone. */
  readonly fetchFor: (state: string) => ProbeFetch;
  readonly clocks: Clocks;
  readonly parsers: ReadonlyMap<string, PlatformParser>;
  readonly now: () => Date;
  readonly purge?: ReaderCachePurger;
}

/** What reading one link did. `again` is a read that may work later; `broke` is a page its parser could not read. */
export type LeadResult =
  | { readonly read: true; readonly published: number; readonly confirmed: number; readonly held: number; readonly refused: number; readonly links: number }
  | { readonly again: string }
  /** A website cannot be asked before this time. The link goes back as it was, due then, and the wait is not an attempt. */
  | { readonly wait: string }
  | { readonly broke: string };

/** The page that linked here, when it is the government's own and links this address: that makes the address the government's (rulings §3). */
async function officialLinkingPage(deps: LeadDeps, lead: Lead, fetch: ProbeFetch): Promise<OfficialLinkingPage | null> {
  if (!lead.foundOn) return null;
  const read = await receiptCapture({ url: lead.foundOn, repos: deps.repos, vault: deps.vault, fetch, now: deps.now().toISOString(), windowHours: LINKING_PAGE_WINDOW_HOURS });
  if ("error" in read) return null;
  const page = { url: read.capture.evidence.canonicalUrl, html: read.capture.evidence.text };
  return isOfficialSource(lead.url, page) ? page : null;
}

const absolute = (href: string, base: string): string | null => {
  try { const url = new URL(href, base); return url.protocol === "http:" || url.protocol === "https:" ? url.href : null; } catch { return null; }
};

/** Each government the link was found under, once, with the first page that linked it there. */
function foundUnder(claim: WorkRow): readonly { readonly subjectId: string; readonly placeId: string; readonly foundOn: string | null }[] {
  const seen = new Map<string, { subjectId: string; placeId: string; foundOn: string | null }>();
  for (const report of claim.reports) {
    const { subjectId, placeId, foundOn } = report as { subjectId?: unknown; placeId?: unknown; foundOn?: unknown };
    if (typeof subjectId === "string" && typeof placeId === "string" && !seen.has(`${placeId}|${subjectId}`)) seen.set(`${placeId}|${subjectId}`, { subjectId, placeId, foundOn: typeof foundOn === "string" ? foundOn : null });
  }
  return [...seen.values()].slice(0, MAX_REPORTS);
}

/**
 * One link, read once: the page is fetched and saved once (a copy already held within its clock is the copy), the parser says
 * what is on it, each fact goes through the Slide on its exact line for every government the link was found under, and each new link
 * becomes a new link to read for each of them.
 */
export async function readLead(deps: LeadDeps, claim: WorkRow): Promise<LeadResult> {
  const platform = String((claim.value as { platform?: unknown } | null)?.platform ?? "");
  const parser = deps.parsers.get(platform);
  if (!parser || !claim.url) return { again: `NO_PARSER:${platform}` };
  const at = deps.now().toISOString();
  let waitUntil: number | null = null;
  const paced = deps.fetchFor(claim.state);
  const fetch: ProbeFetch = async (url, headers) => { try { return await paced(url, headers); } catch (error) { if (error instanceof WebsiteWait) waitUntil = error.until; throw error; } };
  const read = await receiptCapture({ url: claim.url, repos: deps.repos, vault: deps.vault, fetch, now: at, windowHours: deps.clocks.windowHours("meeting") });
  if ("error" in read) return waitUntil === null ? { again: read.error } : { wait: new Date(waitUntil).toISOString() };
  const { capture } = read;
  const copy = await deps.facts.transaction(query => saveCaptureCopy(query, capture));
  const under = foundUnder(claim), first = under[0] ?? { subjectId: claim.subjectId!, placeId: claim.placeId!, foundOn: null };
  const leadFor = (found: typeof first): Lead => ({ url: claim.url!, platform, subjectId: found.subjectId, placeId: found.placeId, state: claim.state, foundOn: found.foundOn });
  let parsed;
  try { parsed = await parser.parse({ url: copy.finalUrl, raw: capture.evidence.text, copy }, leadFor(first)); }
  catch (error) { return { broke: `PARSER_THREW:${sanitizedErrorDiagnostic(error).slice(0, 300)}` }; }

  const tally = { published: 0, confirmed: 0, held: 0, refused: 0 }, unmatched = { count: 0 };
  const provenance = captureProvenance(capture, []);
  for (const found of under.length ? under : [first]) {
    const lead = leadFor(found);
    // A body the page names is the one body of that name under the government the link was found under.
    const bodies = new Map<string, Promise<string | null>>();
    const subjectOf = (hint: string | null) => {
      const name = hint?.trim();
      if (!name) return Promise.resolve(lead.subjectId);
      if (!bodies.has(name)) bodies.set(name, deps.facts.transaction(query => bodyNamed(query, lead.subjectId, null, name)).then(body => body?.id ?? null));
      return bodies.get(name)!;
    };
    const linkingPage = parsed.facts.length ? await officialLinkingPage(deps, lead, fetch) : null;
    if (linkingPage) await deps.facts.transaction(query => learnDoorChannel(query, splitSubject(lead.subjectId).root, lead.url));
    await withBatchedReaderInvalidation(purge => withFactConfirmations(deps.facts, async () => {
      for (const fact of parsed.facts) {
        const subjectId = await subjectOf(fact.subjectHint);
        if (subjectId === null) { unmatched.count++; continue; }
        const outcome = await publishLoaded(deps.facts, { subjectId, field: fact.field, fieldKind: fact.fieldKind, value: fact.value, valueText: fact.valueText,
          quote: fact.quote, provenance, copy, linkingPage, producedBy: `parser:${platform}`, costUsd: 0 },
        () => ({ quote: fact.quote, valueText: fact.valueText }), deps.clocks, deps.now(), { purge });
        if ("refused" in outcome) { if (outcome.refused === "SUBJECT_NOT_FOUND") unmatched.count++; else tally.refused++; }
        else if (outcome.decision === "PUBLISH") tally.published++;
        else if (outcome.decision === "CONFIRM") tally.confirmed++;
        else tally.held++;
      }
    }, purge), deps.purge);
  }

  const found = [...new Set(parsed.links.flatMap(href => absolute(href, copy.finalUrl) ?? []))].filter(url => url !== claim.url && url !== copy.finalUrl).slice(0, MAX_LINKS);
  const next = (under.length ? under : [first]).flatMap(place => found.map((url): WorkInput => ({ kind: "lead", tier: claim.tier, state: claim.state, placeId: place.placeId, subjectId: place.subjectId, url,
    value: platformOf(url) === null ? null : { platform: platformOf(url) }, priority: newestFirst(at), origin: { from: "loader", workId: claim.id },
    source: { source: `Found on a ${platform} page`, foundOn: copy.finalUrl } })));
  let links = 0;
  for (let from = 0; from < next.length; from += 1_000) links += await deps.list.addMany(next.slice(from, from + 1_000));
  // Every fact left without a body to hold it means the government is not in the store yet; the link is read again once it is.
  return parsed.facts.length > 0 && unmatched.count === parsed.facts.length * (under.length || 1) ? { again: "SUBJECT_NOT_FOUND" } : { read: true, ...tally, links };
}

export const parserStats = () => ({ claimed: 0, read: 0, published: 0, links: 0, again: 0, refused: 0, failed: 0, released: 0 });

/** Claims links newest first within each tier, whichever of the installed kinds of website holds the first, and reads each with its parser. */
export async function runParserWorkers(input: { readonly deps: LeadDeps; readonly concurrency: number; readonly maxClaims?: number;
  readonly turnEnd?: AbortSignal; readonly stopRequested: () => boolean; readonly sleep?: (ms: number) => Promise<void>; readonly log?: (line: string) => void;
  readonly stats?: ReturnType<typeof parserStats>; readonly readMs?: number }) {
  const { deps } = input, platforms = [...deps.parsers.keys()], stats = input.stats ?? parserStats(), readMs = input.readMs ?? ITEM_READ_MS;
  await runClaimLoop<LeadResult>({ ...input, stats, list: deps.list, readMs, slow: { again: `READ_TIMED_OUT: the page gave no answer in ${readMs / 1000} s` },
    claim: async () => { const platform = await deps.list.firstPlatform(platforms); return platform === null ? undefined : (await deps.list.claim("lead", 1, { platform }))[0]; },
    work: claim => readLead(deps, claim),
    settle: async (claim, result) => {
      const platform = String((claim.value as { platform?: unknown } | null)?.platform ?? "");
      const unlock = (kind: Unlock["kind"], text: string): Unlock => ({ kind, platform, text });
      if ("wait" in result) { await deps.list.release(claim, result.wait); stats.released++; }
      else if ("broke" in result) { await deps.list.refuse(claim, result.broke, unlock("parser", result.broke)); stats.refused++; }
      else if ("again" in result && claim.attempts >= LEAD_ATTEMPTS) { await deps.list.refuse(claim, result.again, unlock("method", result.again)); stats.refused++; }
      else if ("again" in result) { await deps.list.later(claim, result.again); stats.again++; }
      else {
        if (!await deps.list.finish(claim)) throw new Error("WORK_LEASE_LOST");
        stats.read++; stats.published += result.published; stats.links += result.links;
      }
    } });
  return stats;
}
