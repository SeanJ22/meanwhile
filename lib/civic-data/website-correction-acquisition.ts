/**
 * **EACH WEBSITE CORRECTION, RE-VERIFIED WHEN THE REFERENCE IS PROMOTED.** (C15, 2026-09-24.)
 *
 * `lib/civic-data/website-corrections.ts` holds the reviewed corrections and
 * their evidence. When the owner promotes the jurisdiction reference, each
 * correction is read again at its own sources, robots.txt first:
 *
 * - its homepage must still name the government as reviewed;
 * - its .gov registry row, where it has one, must still list the domain for
 *   that government;
 * - each other government's page it relies on must still name the site.
 *
 * Every response read is receipted (URL, status, time, sha256, bytes). A source
 * that now contradicts the review REFUSES the correction: the Census address
 * stays, and the reason is recorded. A source that could not be read (a
 * timeout, a server error, a refusal to this client, a challenge) is an outage:
 * the reviewed evidence stands, and the correction is applied on it, said so.
 */

import { createHash } from "node:crypto";

import { evaluatePermission } from "../control-plane/scheduler/robots.ts";
import type { JurisdictionReferenceSourceReceipt } from "./jurisdiction-reference-acquisition.ts";
import {
  DOTGOV_REGISTRY_URL,
  governmentNamesMatch,
  homepageStillNamesGovernment,
  registryIsTheSitesOwn,
  registryRowFor,
  type WebsiteCorrection,
} from "./website-corrections.ts";

export type WebsiteCorrectionDisposition =
  /** Every source read now agrees with the review. */
  | "APPLIED_VERIFIED"
  /** A source could not be read now (an outage); nothing read contradicts the review, so it stands. */
  | "APPLIED_ON_REVIEWED_EVIDENCE"
  /** A source read now contradicts the review: the correction is not applied. */
  | "REFUSED";

export interface WebsiteCorrectionOutcome {
  readonly jurisdictionId: string;
  readonly corrected: string;
  readonly disposition: WebsiteCorrectionDisposition;
  readonly detail: string;
}

const USER_AGENT = "we-the-people jurisdiction reference (website correction check)";
const SPACING_MS = 2_000;
/** A known interstitial answered in place of the page: an outage to this client, never a reading of the page. */
const CHALLENGE = /<title>\s*Just a moment\.\.\.\s*<\/title>|window\._cf_chl_opt|Performing security verification|<title>\s*Client Challenge\s*<\/title>/i;

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

type Read =
  | { readonly kind: "READ"; readonly finalUrl: string; readonly status: number; readonly text: string; readonly receipt: JurisdictionReferenceSourceReceipt }
  | { readonly kind: "OUTAGE"; readonly detail: string }
  | { readonly kind: "REFUSED_BY_RULES"; readonly detail: string };

/**
 * Read the website corrections' sources and decide each. `fetchImpl`, `clock` and `sleep` are injected so a test
 * never touches the network; production passes the global fetch.
 */
export async function acquireWebsiteCorrections(
  corrections: readonly WebsiteCorrection[],
  fetchImpl: typeof fetch,
  clock: () => string,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<{ readonly receipts: readonly JurisdictionReferenceSourceReceipt[]; readonly outcomes: readonly WebsiteCorrectionOutcome[] }> {
  const receipts: JurisdictionReferenceSourceReceipt[] = [];
  const lastAt = new Map<string, number>();
  const rules = new Map<string, { readonly text: string | null; readonly status: number | null }>();

  async function get(url: string, accept: string): Promise<{ status: number | null; finalUrl: string; bytes: Uint8Array; error: string | null }> {
    const host = new URL(url).host;
    const wait = (lastAt.get(host) ?? 0) + SPACING_MS - Date.now();
    if (lastAt.has(host) && wait > 0) await sleep(wait);
    lastAt.set(host, Date.now());
    try {
      const response = await fetchImpl(url, { method: "GET", redirect: "follow", headers: { "user-agent": USER_AGENT, accept } });
      const bytes = new Uint8Array(await response.arrayBuffer());
      return { status: response.status, finalUrl: response.url || url, bytes, error: null };
    } catch (error) {
      return { status: null, finalUrl: url, bytes: new Uint8Array(0), error: error instanceof Error ? error.message : String(error) };
    }
  }

  /** robots.txt first, once per origin; then the page, receipted. */
  async function read(url: string, sourceId: `website-correction:${string}`, accept: string): Promise<Read> {
    const origin = new URL(url).origin;
    if (!rules.has(origin)) {
      const got = await get(`${origin}/robots.txt`, "text/plain,*/*;q=0.5");
      rules.set(origin, { text: got.error === null ? new TextDecoder().decode(got.bytes) : null, status: got.status });
    }
    const robots = rules.get(origin)!;
    const verdict = evaluatePermission(
      { robotsText: robots.text, status: robots.status, transportError: robots.status === null ? "not read" : null, contentType: "text/plain" },
      url,
      "we-the-people",
    ).verdict;
    if (verdict === "DISALLOWED") return { kind: "REFUSED_BY_RULES", detail: `${origin}/robots.txt disallows ${new URL(url).pathname}` };
    if (verdict === "CANNOT_TELL") return { kind: "OUTAGE", detail: `${origin}/robots.txt could not be read (${robots.status ?? "transport failure"})` };
    const got = await get(url, accept);
    if (got.error !== null) return { kind: "OUTAGE", detail: `${url}: ${got.error}` };
    const text = new TextDecoder().decode(got.bytes);
    if (got.status === null || got.status < 200 || got.status >= 300) return { kind: "OUTAGE", detail: `${url} answered HTTP ${got.status}` };
    if (CHALLENGE.test(text)) return { kind: "OUTAGE", detail: `${url} answered a challenge in place of the page` };
    const receipt: JurisdictionReferenceSourceReceipt = {
      sourceId,
      requestedUrl: url,
      finalUrl: got.finalUrl,
      httpStatus: got.status,
      retrievedAt: clock(),
      rawHash: sha256(got.bytes),
      byteCount: got.bytes.byteLength,
    };
    receipts.push(receipt);
    return { kind: "READ", finalUrl: got.finalUrl, status: got.status, text, receipt };
  }

  const registry = corrections.some((c) => c.registry !== null && registryIsTheSitesOwn(c))
    ? await read(DOTGOV_REGISTRY_URL, "website-correction:dotgov-registry", "text/csv,text/plain,*/*;q=0.5")
    : null;

  const outcomes: WebsiteCorrectionOutcome[] = [];
  for (const c of corrections) {
    const refusals: string[] = [];
    const outages: string[] = [];
    const bare = new URL(c.corrected).hostname.replace(/^www\./, "");
    if (c.homepage !== null) {
      const home = await read(c.homepage.url, `website-correction:${c.jurisdictionId}:homepage`, "text/html,*/*;q=0.8");
      if (home.kind === "READ") {
        const finalHost = new URL(home.finalUrl).hostname.replace(/^www\./, "");
        if (finalHost !== bare) refusals.push(`the homepage now leaves the site for ${new URL(home.finalUrl).host}`);
        else if (!homepageStillNamesGovernment(home.text, c.homepage.selfName)) refusals.push(`the homepage no longer names ${c.homepage.selfName}`);
      } else if (home.kind === "REFUSED_BY_RULES") refusals.push(home.detail);
      else outages.push(home.detail);
    }
    if (c.registry !== null && registryIsTheSitesOwn(c)) {
      if (registry?.kind === "READ") {
        const row = registryRowFor(registry.text, c.registry.domain);
        if (row === null) refusals.push(`the .gov registry no longer lists ${c.registry.domain}`);
        else if (!governmentNamesMatch(row.organization, c.governmentName)) refusals.push(`the .gov registry now lists ${c.registry.domain} for "${row.organization}"`);
      } else outages.push(registry === null ? "the registry was not read" : registry.detail);
    }
    for (const [i, o] of c.other.entries()) {
      if (o.kind === "RECORDED_HOST_REDIRECT") continue;
      const page = await read(o.url, `website-correction:${c.jurisdictionId}:evidence-${i}`, "text/html,*/*;q=0.8");
      if (page.kind === "READ") {
        if (!page.text.toLowerCase().includes(bare)) refusals.push(`${o.publisher}'s page no longer names ${bare}`);
      } else if (page.kind === "REFUSED_BY_RULES") refusals.push(page.detail);
      else outages.push(page.detail);
    }
    outcomes.push({
      jurisdictionId: c.jurisdictionId,
      corrected: c.corrected,
      disposition: refusals.length > 0 ? "REFUSED" : outages.length > 0 ? "APPLIED_ON_REVIEWED_EVIDENCE" : "APPLIED_VERIFIED",
      detail: refusals.length > 0
        ? `not applied: ${refusals.join("; ")}`
        : outages.length > 0
          ? `applied on the reviewed evidence of ${c.reviewedAt} by ${c.reviewedBy}; not re-read now: ${outages.join("; ")}`
          : `applied: every source read now agrees with the review of ${c.reviewedAt} by ${c.reviewedBy}`,
    });
  }
  return { receipts, outcomes };
}
