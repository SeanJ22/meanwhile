import { newestFirst, type WorkInput, type WorkList, type WorkRow } from "../core/work.ts";
import type { Unlock } from "../core/capability.ts";
import { captureProvenance, receiptCapture } from "../facts/capture.ts";
import { bodyNamed, canonicalSubject, ensureGoverningBody, learnDoorChannel, resolvePerson, splitSubject } from "../facts/entities.ts";
import { nameKey } from "../facts/roster-facts.ts";
import { isOfficialSource, type OfficialLinkingPage } from "../civic-data/source-authority.ts";
import { withFactConfirmations } from "../facts/confirmation.ts";
import { publishLoaded, type Clocks, type FactDb, type Query } from "../facts/publish.ts";
import { saveCaptureCopy } from "../facts/source-copy.ts";
import { withBatchedReaderInvalidation, type ReaderCachePurger } from "../reader/cache.ts";
import type { EvidenceStore } from "../control-plane/evidence/store.ts";
import type { ControlPlaneRepositories } from "../control-plane/repository/types.ts";
import type { ProbeFetch } from "../doors/probe.ts";
import { runBoundedWorkPool } from "../ops/bounded-work-pool.ts";
import { sanitizedErrorDiagnostic } from "../ops/error-diagnostic.ts";
import type { Lead, ParsedFact, PlatformParser } from "./parser-hook.ts";
import { platformOf } from "./platform-of.ts";

/** A link that could not be read this many times goes to a detective. */
export const LEAD_ATTEMPTS = 5;
/** The most new links one page can add; a page with more is a listing, and its parser picks the pages worth reading. */
const MAX_LINKS = 500;
export const LEAD_LEASE_MS = 300_000;
const RENEW_MS = 60_000;
/** A page that linked here is evidence of that link however old its copy is. */
const LINKING_PAGE_WINDOW_HOURS = 30 * 24;

export interface LeadDeps {
  readonly list: WorkList;
  readonly facts: FactDb & { readonly query: Query };
  readonly repos: Pick<ControlPlaneRepositories, "artifacts" | "artifactsByCanonicalUrl">;
  readonly vault: EvidenceStore;
  readonly fetch: ProbeFetch;
  readonly clocks: Clocks;
  readonly parsers: ReadonlyMap<string, PlatformParser>;
  readonly now: () => Date;
  readonly purge?: ReaderCachePurger;
}

/** What reading one link did. `again` is a read that may work later; `broke` is a page its parser could not read. */
export type LeadResult =
  | { readonly read: true; readonly published: number; readonly confirmed: number; readonly held: number; readonly refused: number; readonly links: number }
  | { readonly again: string }
  | { readonly broke: string };

/** The page that linked here, when it is the government's own and links this address: that makes the address the government's (rulings §3). */
async function officialLinkingPage(deps: LeadDeps, lead: Lead): Promise<OfficialLinkingPage | null> {
  if (!lead.foundOn) return null;
  const read = await receiptCapture({ url: lead.foundOn, repos: deps.repos, vault: deps.vault, fetch: deps.fetch, now: deps.now().toISOString(), windowHours: LINKING_PAGE_WINDOW_HOURS });
  if ("error" in read) return null;
  const page = { url: read.capture.evidence.canonicalUrl, html: read.capture.evidence.text };
  return isOfficialSource(lead.url, page) ? page : null;
}

const absolute = (href: string, base: string): string | null => {
  try { const url = new URL(href, base); return url.protocol === "http:" || url.protocol === "https:" ? url.href : null; } catch { return null; }
};

/**
 * One link, read once: the page is fetched and saved once (a copy already held within its clock is the copy), the parser says
 * what is on it, each fact goes through the Slide on its exact line, and each new link becomes a new link to read.
 */
export async function readLead(deps: LeadDeps, claim: WorkRow): Promise<LeadResult> {
  const platform = String((claim.value as { platform?: unknown } | null)?.platform ?? "");
  const parser = deps.parsers.get(platform);
  if (!parser || !claim.url) return { again: `NO_PARSER:${platform}` };
  const at = deps.now().toISOString();
  const read = await receiptCapture({ url: claim.url, repos: deps.repos, vault: deps.vault, fetch: deps.fetch, now: at, windowHours: deps.clocks.windowHours("meeting") });
  if ("error" in read) return { again: read.error };
  const { capture } = read;
  const copy = await deps.facts.transaction(query => saveCaptureCopy(query, capture));
  const lead: Lead = { url: claim.url, platform, subjectId: claim.subjectId!, placeId: claim.placeId!, state: claim.state,
    foundOn: (claim.reports[0]?.foundOn as string | undefined) ?? null };
  let parsed;
  try { parsed = await parser.parse({ url: copy.finalUrl, raw: capture.evidence.text, copy }, lead); }
  catch (error) { return { broke: `PARSER_THREW:${sanitizedErrorDiagnostic(error).slice(0, 300)}` }; }

  const tally = { published: 0, confirmed: 0, held: 0, refused: 0 }, unmatched = { count: 0 };
  // A body the page names is the one body of that name under the government the link was found under.
  const bodies = new Map<string, Promise<string | null>>();
  const subjectOf = (hint: string | null) => {
    const name = hint?.trim();
    if (!name) return Promise.resolve(lead.subjectId);
    if (!bodies.has(name)) bodies.set(name, deps.facts.transaction(query => bodyNamed(query, lead.subjectId, null, name)).then(body => body?.id ?? null));
    return bodies.get(name)!;
  };
  // A person on the page is the one person the matcher finds in the seat the page puts them in; two equal matches wait for a detective.
  const bodyHeld = async (id: string) => {
    const subject = await canonicalSubject(deps.facts.query, id);
    const [body] = await deps.facts.query("SELECT id, state, parent_id FROM entity WHERE id = $1 AND kind = 'body'", [subject]);
    const made = body ? null : await ensureGoverningBody(deps.facts.query, subject);
    return body ? { id: String(body.id), state: body.state as string | null, parentId: body.parent_id as string | null } : made;
  };
  const provenance = captureProvenance(capture, []);
  const linkingPage = parsed.facts.length ? await officialLinkingPage(deps, lead) : null;
  if (linkingPage) await deps.facts.transaction(query => learnDoorChannel(query, splitSubject(lead.subjectId).root, lead.url));
  const people = new Map<string, Promise<{ body: string; person: string } | null>>();
  const personOf = (fact: ParsedFact, bodyId: string) => {
    const key = JSON.stringify([bodyId, fact.person]);
    if (!people.has(key)) people.set(key, (async () => {
      const body = await bodyHeld(bodyId);
      if (!body) return null;
      const places = (await deps.facts.query("SELECT place_id, boundary_year, placement_basis FROM entity_place WHERE entity_id = $1", [body.id]))
        .map(row => ({ placeId: String(row.place_id), boundaryYear: Number(row.boundary_year), basis: row.placement_basis as "SERVICE_AREA" | "HOST_COUNTY" }));
      const { name, ids = [] } = fact.person!;
      const found = await resolvePerson(deps.facts, { name, state: body.state, places, placeId: places.length ? null : body.parentId,
        externalIds: [...ids, [`roster-name:${body.id}`, nameKey(name)]] }, deps.clocks.retryMinutes("officeholder"));
      if (typeof found !== "string") return null;
      // A roster on the government's own page is the person's official page too.
      if (linkingPage) await deps.facts.transaction(query => learnDoorChannel(query, found, lead.url));
      return { body: body.id, person: found };
    })());
    return people.get(key)!;
  };
  await withBatchedReaderInvalidation(purge => withFactConfirmations(deps.facts, async () => {
    for (const fact of parsed.facts) {
      let subjectId = await subjectOf(fact.subjectHint), field = fact.field;
      if (subjectId === null) { unmatched.count++; continue; }
      if (fact.person) {
        const seated = await personOf(fact, subjectId);
        if (!seated) { tally.held++; continue; }
        field = field.replaceAll("{person}", seated.person).replaceAll("{body}", seated.body);
        subjectId = fact.on === "body" ? seated.body : seated.person;
      }
      const outcome = await publishLoaded(deps.facts, { subjectId, field, fieldKind: fact.fieldKind, value: fact.value, valueText: fact.valueText,
        quote: fact.quote, provenance, copy, linkingPage, producedBy: `parser:${platform}`, costUsd: 0 },
      () => ({ quote: fact.quote, valueText: fact.valueText }), deps.clocks, deps.now(), { purge });
      if ("refused" in outcome) { if (outcome.refused === "SUBJECT_NOT_FOUND") unmatched.count++; else tally.refused++; }
      else if (outcome.decision === "PUBLISH") tally.published++;
      else if (outcome.decision === "CONFIRM") tally.confirmed++;
      else tally.held++;
    }
  }, purge), deps.purge);

  const found = [...new Set(parsed.links.flatMap(href => absolute(href, copy.finalUrl) ?? []))].filter(url => url !== claim.url && url !== copy.finalUrl).slice(0, MAX_LINKS);
  const links = await deps.list.ensure(found.map((url): WorkInput => ({ kind: "lead", tier: claim.tier, state: claim.state, placeId: claim.placeId!, subjectId: claim.subjectId!, url,
    value: platformOf(url) === null ? null : { platform: platformOf(url) }, priority: newestFirst(at), origin: { from: "loader", workId: claim.id },
    source: { source: `Found on a ${platform} page`, foundOn: copy.finalUrl } })));
  // Every fact left without a body to hold it means the government is not in the store yet; the link is read again once it is.
  return parsed.facts.length > 0 && unmatched.count === parsed.facts.length ? { again: "SUBJECT_NOT_FOUND" } : { read: true, ...tally, links };
}

/** Claims links newest first within each tier, whichever of the installed kinds of website holds the first, and reads each with its parser. */
export async function runParserWorkers(input: { readonly deps: LeadDeps; readonly concurrency: number; readonly maxClaims?: number;
  readonly stopRequested: () => boolean; readonly sleep?: (ms: number) => Promise<void>; readonly log?: (line: string) => void }) {
  const { deps } = input, platforms = [...deps.parsers.keys()];
  const stats = { claimed: 0, read: 0, published: 0, links: 0, again: 0, refused: 0, failed: 0 };
  let reserved = 0;
  const results = await runBoundedWorkPool(Array.from({ length: input.concurrency }, (_, index) => index), input.concurrency, async () => {
    while (!input.stopRequested() && reserved < (input.maxClaims ?? Infinity)) {
      reserved++;
      const platform = await deps.list.firstPlatform(platforms);
      const [claim] = platform === null ? [] : await deps.list.claim("lead", 1, { platform });
      if (!claim) { reserved--; if (!input.sleep) break; await input.sleep(5_000); continue; }
      stats.claimed++;
      const controller = new AbortController();
      let renewing = false;
      const timer = setInterval(() => {
        if (renewing) return;
        renewing = true;
        void deps.list.renew(claim).then(held => { if (!held) controller.abort(new Error("WORK_LEASE_LOST")); })
          .catch(error => controller.abort(error)).finally(() => { renewing = false; });
      }, RENEW_MS);
      try {
        const result = await readLead(deps, claim);
        controller.signal.throwIfAborted();
        const unlock = (kind: Unlock["kind"], text: string): Unlock => ({ kind, platform: platform ?? undefined, text });
        if ("broke" in result) { await deps.list.refuse(claim, result.broke, unlock("parser", result.broke)); stats.refused++; }
        else if ("again" in result && claim.attempts >= LEAD_ATTEMPTS) { await deps.list.refuse(claim, result.again, unlock("method", result.again)); stats.refused++; }
        else if ("again" in result) { await deps.list.later(claim, result.again); stats.again++; }
        else {
          if (!await deps.list.finish(claim)) throw new Error("WORK_LEASE_LOST");
          stats.read++; stats.published += result.published; stats.links += result.links;
        }
      } catch (error) {
        stats.failed++;
        const detail = sanitizedErrorDiagnostic(error);
        await deps.list.later(claim, detail);
        input.log?.(detail);
      } finally { clearInterval(timer); }
    }
  });
  for (const result of results) if (!result.ok) throw new Error(result.error);
  return stats;
}
