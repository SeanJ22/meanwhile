/**
 * **THE WEBSITE CORRECTION METHOD, ONE GOVERNMENT AT A TIME.** (C15, 2026-09-24.)
 *
 * The owner authorized one way to correct a government's website on record (the website field only): the official
 * homepage and the federal .gov registry must identify the same government, and where the site is not .gov, or the
 * registry names a parent, another government's own publication must name the site. This command gathers that
 * evidence and applies that rule; it writes nothing.
 *
 *   pnpm website:check <jurisdictionId> <https://candidate-origin> --name "<the government's name>"
 *     [--evidence "<KIND>|<publisher>|<url>"]...   (KIND: STATE_LISTING, COUNTY_PAGE, MEMBER_TOWN_PAGE, FEDERAL_LISTING)
 *
 * 1. Reads the candidate homepage robots-first (`researchFetch`): its final URL, title, sha256, and whether it
 *    prints the government's name. A challenge is not a reading.
 * 2. Reads CISA's .gov registry file robots-first and finds the candidate's own row, when it is .gov.
 * 3. Reads each named evidence page robots-first and quotes where it names the site.
 * 4. Prints a draft `WebsiteCorrection` with the owner's rule applied (`websiteCorrectionIssues`).
 *
 * The session that checked the draft reviews it, records itself as the reviewer and commits it to
 * `WEBSITE_CORRECTIONS`, where the tests hold it to the rule and the reference promotion reads its sources again.
 * A draft with issues is an unresolved case: it is reported by name, never committed.
 */
import { challengeIn } from "../lib/sources/http.ts";
import { memoryInProcess, nodeResearchGet, researchFetch, type ResearchRuntime } from "../lib/hunt/robots-first-fetch.ts";
import { recordedMeetingsDiscovery, GAP_LEDGER_PATH } from "../lib/hunt/meetings-discovery.ts";
import {
  DOTGOV_REGISTRY_URL,
  registryRowFor,
  websiteCorrectionIssues,
  type OtherEvidence,
  type WebsiteCorrection,
} from "../lib/civic-data/website-corrections.ts";
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const [jurisdictionId, candidate] = args.filter((a, i) => !a.startsWith("--") && (i === 0 || !args[i - 1]!.startsWith("--")));
const name = args[args.indexOf("--name") + 1];
const evidenceArgs = args.flatMap((a, i) => (a === "--evidence" && args[i + 1] !== undefined ? [args[i + 1]!] : []));
if (!jurisdictionId || !candidate || !/^https:\/\/[^/]+$/.test(candidate) || args.indexOf("--name") < 0 || !name) {
  process.stderr.write('usage: pnpm website:check <jurisdictionId> <https://origin> --name "<government name>" [--evidence "<KIND>|<publisher>|<url>"]...\n');
  process.exit(1);
}

const recorded = (() => {
  const read = recordedMeetingsDiscovery(JSON.parse(readFileSync(GAP_LEDGER_PATH, "utf8")));
  if ("unreadable" in read) return null;
  const need = read.needs.find((n) => n.jurisdictionId === jurisdictionId);
  return need?.addressCorrection?.recorded ?? need?.ownWebAddress ?? null;
})();

const runtime: ResearchRuntime = {
  get: nodeResearchGet,
  memory: memoryInProcess(),
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};
const text = (body: Uint8Array): string => new TextDecoder().decode(body);
const bare = new URL(candidate).hostname.toLowerCase().replace(/^www\./, "");
const notes: string[] = [];

async function page(url: string) {
  const got = await researchFetch(url, runtime);
  if (got.outcome === "REFUSED") {
    notes.push(`${url}: not read (${got.reason})`);
    return null;
  }
  if (got.status === null || got.status < 200 || got.status >= 300) {
    notes.push(`${url}: ${got.transportError ?? `HTTP ${got.status}`}`);
    return null;
  }
  const body = text(got.body);
  const challenge = challengeIn(body);
  if (challenge !== null) {
    notes.push(`${url}: a ${challenge} answered in place of the page; not a reading`);
    return null;
  }
  return { finalUrl: got.finalUrl, body, sha256: got.sha256!, at: new Date(runtime.now()).toISOString() };
}

const home = await page(`${candidate}/`);
const title = home === null ? "" : (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(home.body)?.[1] ?? "").replace(/\s+/g, " ").trim();
const flat = (s: string): string => s.replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ").toLowerCase();
const namesIt = home !== null && flat(home.body).includes(flat(name));
if (home !== null && !namesIt) notes.push(`the homepage does not print "${name}"; read its title (${title}) and name the government as the page does`);
if (home !== null && new URL(home.finalUrl).hostname.toLowerCase().replace(/^www\./, "") !== bare) notes.push(`the homepage left the site for ${home.finalUrl}`);

const csv = bare.endsWith(".gov") ? await page(DOTGOV_REGISTRY_URL) : null;
const labels = bare.split(".");
const registryDomain = [bare, ...labels.slice(1).map((_, i) => labels.slice(i + 1).join("."))].find((d) => d.endsWith(".gov") && csv !== null && registryRowFor(csv.body, d) !== null) ?? null;
const row = registryDomain === null || csv === null ? null : registryRowFor(csv.body, registryDomain);

const other: OtherEvidence[] = [];
for (const arg of evidenceArgs) {
  const [kind, publisher, url] = arg.split("|");
  if (!kind || !publisher || !url || !["STATE_LISTING", "COUNTY_PAGE", "MEMBER_TOWN_PAGE", "FEDERAL_LISTING"].includes(kind)) {
    notes.push(`--evidence "${arg}" is not KIND|publisher|url`);
    continue;
  }
  const got = await page(url);
  if (got === null) continue;
  const plain = got.body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const at = plain.toLowerCase().indexOf(bare);
  if (at < 0) {
    notes.push(`${url} does not name ${bare}`);
    continue;
  }
  other.push({ kind: kind as OtherEvidence["kind"], publisher, url, quote: plain.slice(Math.max(0, at - 80), at + bare.length + 40).trim(), sha256: got.sha256, readAt: got.at });
}

const draft: WebsiteCorrection = {
  jurisdictionId,
  governmentName: name,
  recorded: recorded ?? "(no address on record)",
  corrected: candidate,
  registry: row === null || csv === null
    ? null
    : { domain: registryDomain!, domainType: row.domainType, organization: row.organization, city: row.city, state: row.state, source: { url: DOTGOV_REGISTRY_URL, sha256: csv.sha256, readAt: csv.at } },
  homepage: home === null || !namesIt ? null : { url: home.finalUrl, title, selfName: name, sha256: home.sha256, readAt: home.at },
  other,
  reviewedBy: "<the session that checked this draft>",
  reviewedAt: new Date(runtime.now()).toISOString(),
};
process.stdout.write(`${JSON.stringify({ draft, issues: websiteCorrectionIssues(draft), notes }, null, 1)}\n`);
