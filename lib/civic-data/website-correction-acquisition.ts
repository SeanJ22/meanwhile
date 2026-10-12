/**
 * @freshness-reads-here: a receipt's retrievedAt is the instant its own read returned.
 *
 * A source that now contradicts the review, or was withdrawn (404/410), refuses the correction. A source that could
 * not be read (timeout, server error, access control) is an outage: the reviewed evidence stands. Robots.txt is
 * recorded and never stops the read; an access control is never bypassed.
 */

import { accessControlIn } from "../hunt/access-control.ts";
import { researchFetch, type ResearchRuntime } from "../hunt/robots-first-fetch.ts";
import type { JurisdictionReferenceSourceReceipt, WebsiteCorrectionSourceId } from "./jurisdiction-reference-acquisition.ts";
import {
  DOTGOV_REGISTRY_URL,
  governmentNamesMatch,
  homepageStillNamesGovernment,
  registryIsTheSitesOwn,
  registryRowFor,
  type WebsiteCorrection,
} from "./website-corrections.ts";

export type WebsiteCorrectionDisposition =
  | "APPLIED_VERIFIED"
  /** A source could not be read now; nothing read contradicts the review, so it stands. */
  | "APPLIED_ON_REVIEWED_EVIDENCE"
  | "REFUSED";

export interface WebsiteCorrectionOutcome {
  readonly jurisdictionId: string;
  readonly recorded: string;
  readonly corrected: string;
  readonly disposition: WebsiteCorrectionDisposition;
  readonly detail: string;
}

type Reading =
  | { readonly kind: "READ"; readonly finalUrl: string; readonly text: string }
  | { readonly kind: "WITHDRAWN"; readonly detail: string }
  | { readonly kind: "NOT_READ"; readonly detail: string };

const bareHost = (url: string): string => new URL(url).hostname.toLowerCase().replace(/^www\./, "");

export async function acquireWebsiteCorrections(
  corrections: readonly WebsiteCorrection[],
  runtime: ResearchRuntime,
): Promise<{ readonly receipts: readonly JurisdictionReferenceSourceReceipt[]; readonly outcomes: readonly WebsiteCorrectionOutcome[] }> {
  const receipts: JurisdictionReferenceSourceReceipt[] = [];

  async function read(url: string, sourceId: WebsiteCorrectionSourceId): Promise<Reading> {
    const got = await researchFetch(url, runtime);
    if (got.outcome === "REFUSED") return { kind: "NOT_READ", detail: `${url} was not read: ${got.reason}` };
    if (got.transportError !== null || got.status === null) return { kind: "NOT_READ", detail: `${url}: ${got.transportError ?? "no response"}` };
    if (got.status === 404 || got.status === 410) return { kind: "WITHDRAWN", detail: `${url} answered ${got.status}: its publisher withdrew it` };
    const text = new TextDecoder().decode(got.body);
    const control = accessControlIn({ status: got.status, text });
    if (control !== null) return { kind: "NOT_READ", detail: `${url}: an access control answered in place of the page (${control.detail})` };
    if (got.status < 200 || got.status >= 300) return { kind: "NOT_READ", detail: `${url} answered HTTP ${got.status}` };
    receipts.push({
      sourceId,
      requestedUrl: url,
      finalUrl: got.finalUrl,
      httpStatus: got.status,
      retrievedAt: new Date(runtime.now()).toISOString(),
      rawHash: got.sha256 ?? "",
      byteCount: got.body.byteLength,
    });
    return { kind: "READ", finalUrl: got.finalUrl, text };
  }

  const registry = corrections.some((c) => registryIsTheSitesOwn(c))
    ? await read(DOTGOV_REGISTRY_URL, "website-correction:dotgov-registry")
    : null;

  const outcomes: WebsiteCorrectionOutcome[] = [];
  for (const c of corrections) {
    const refusals: string[] = [];
    const notRead: string[] = [];
    const site = bareHost(c.corrected);
    if (c.homepage !== null) {
      const home = await read(c.homepage.url, `website-correction:${c.jurisdictionId}:homepage`);
      if (home.kind === "READ") {
        if (bareHost(home.finalUrl) !== site) refusals.push(`the homepage now leaves the site for ${new URL(home.finalUrl).host}`);
        else if (!homepageStillNamesGovernment(home.text, c.homepage.selfName)) refusals.push(`the homepage no longer names ${c.homepage.selfName}`);
      } else (home.kind === "WITHDRAWN" ? refusals : notRead).push(home.detail);
    }
    if (c.registry !== null && registryIsTheSitesOwn(c)) {
      if (registry?.kind === "READ") {
        const row = registryRowFor(registry.text, c.registry.domain);
        if (row === null) refusals.push(`the .gov registry no longer lists ${c.registry.domain}`);
        else if (!governmentNamesMatch(row.organization, c.governmentName)) refusals.push(`the .gov registry now lists ${c.registry.domain} for "${row.organization}"`);
      } else if (registry?.kind === "WITHDRAWN") refusals.push(registry.detail);
      else notRead.push(registry?.detail ?? "the .gov registry was not read");
    }
    for (const [i, o] of c.other.entries()) {
      if (o.kind === "RECORDED_HOST_REDIRECT") continue;
      const page = await read(o.url, `website-correction:${c.jurisdictionId}:evidence-${i}`);
      if (page.kind === "READ") {
        if (!page.text.toLowerCase().includes(site)) refusals.push(`${o.publisher}'s page no longer names ${site}`);
      } else (page.kind === "WITHDRAWN" ? refusals : notRead).push(page.detail);
    }
    outcomes.push({
      jurisdictionId: c.jurisdictionId,
      recorded: c.recorded,
      corrected: c.corrected,
      disposition: refusals.length > 0 ? "REFUSED" : notRead.length > 0 ? "APPLIED_ON_REVIEWED_EVIDENCE" : "APPLIED_VERIFIED",
      detail: refusals.length > 0
        ? `not applied: ${refusals.join("; ")}`
        : notRead.length > 0
          ? `applied on the evidence reviewed ${c.reviewedAt} by ${c.reviewedBy}; not read again now: ${notRead.join("; ")}`
          : `applied: every source read now agrees with the review of ${c.reviewedAt} by ${c.reviewedBy}`,
    });
  }
  return { receipts, outcomes };
}
