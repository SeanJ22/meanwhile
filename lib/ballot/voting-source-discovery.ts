import { createHash } from "node:crypto";
import { isOfficialSource } from "../civic-data/source-authority.ts";
import type { SiteKind } from "./voting-sites.ts";
import { fingerprintVotingPlatform } from "./voting-source-readers.ts";
import { sourceText } from "./voting-source-tables.ts";
import { votingFetchSession } from "./voting-source-fetch.ts";
import type { VotingSourceDoor, VotingSourceRuntime, VotingDoorShape, VotingSourceBlank } from "./voting-source-types.ts";

const ELECTION_ROUTE = /elect|vot(?:e|ing|er)|poll|precinct|absentee|ballot|drop.?box|satellite|clerk|auditor|registrar/i;
const DIRECTORY = /(?:county|town|local|municipal).{0,35}(?:director|office|clerk|contact|official)|(?:director|contact).{0,35}(?:county|town|local|election)/i;
const IDENTITY = /(?:date\s*of\s*birth|birth\s*date|\bSSN\b|social security)/i;
export function votingDoorShape(url: string, label = ""): VotingDoorShape {
  const clue = `${url} ${label}`;
  if (IDENTITY.test(label)) return "identity-locked-lookup";
  if (/(?:FeatureServer|MapServer)\/\d+/i.test(clue)) return "map-service";
  if (/\.(?:csv|tsv|xlsx?|pdf)(?:[?#]|$)/i.test(url) || /download|spreadsheet|\bPDF\b|\bCSV\b/i.test(label)) return "file";
  if (DIRECTORY.test(clue)) return "county-directory";
  if (/address.{0,25}(?:lookup|search)|(?:lookup|search).{0,25}address/i.test(label)) return "address-lookup";
  if (fingerprintVotingPlatform(url)) return "vendor-platform";
  if (/\.json(?:[?#]|$)|\/api\//i.test(url)) return "json";
  return "list-page";
}
export function votingDoorCoverage(label: string): SiteKind[] {
  const kinds: SiteKind[] = [];
  if (/poll|precinct|election.?day/i.test(label)) kinds.push("ELECTION_DAY");
  if (/vote.?cent[er]{2}/i.test(label)) kinds.push("VOTE_CENTER");
  if (/early|advance|in.person.absentee/i.test(label)) kinds.push("EARLY_VOTING");
  if (/satellite|tribal/i.test(label)) kinds.push("SATELLITE");
  if (/drop.?box|ballot.?return/i.test(label)) kinds.push("DROP_BOX");
  return kinds;
}
function pageNamesElection(text: string, date: string): boolean {
  const [year, month, day] = date.split("-");
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const name = months[Number(month) - 1]!;
  return text.includes(date) || new RegExp(`(?:${name}|${name.slice(0, 3)}\\.?)\\s+0?${Number(day)}(?:st|nd|rd|th)?(?:,|\\s)*${year}|0?${Number(month)}[/-]0?${Number(day)}[/-]${year}`, "i").test(text);
}
export interface VotingDiscoveryResult {
  doors: VotingSourceDoor[];
  attempts: ReturnType<typeof votingFetchSession>["attempts"];
  rawBodies: ReturnType<typeof votingFetchSession>["rawBodies"];
  blanks: VotingSourceBlank[];
}
/** Start only from the supplied chief-office / registered delegated-office root. No search engine. */
export async function discoverVotingDoors(root: VotingSourceDoor, runtime: VotingSourceRuntime): Promise<VotingDiscoveryResult> {
  const session = votingFetchSession(runtime), doors = new Map<string, VotingSourceDoor>([[root.url, root]]), visited = new Set<string>(), queue = [root], blanks: VotingSourceBlank[] = [];
  while (queue.length) {
    const parent = queue.shift()!; if (visited.has(parent.url)) continue; visited.add(parent.url);
    if (["identity-locked-lookup", "address-lookup", "file", "map-service", "json"].includes(parent.shape)) continue;
    try {
      const capture = await session.get(parent.url), html = new TextDecoder().decode(capture.bytes);
      if (!/html/.test(capture.contentType) && !/^\s*</.test(html)) continue;
      const text = sourceText(html), currentElection = pageNamesElection(text, root.electionDate);
      const linkingPage = { url: capture.url, html, linkingPage: parent.officialLinkingPage };
      const links = [...html.matchAll(/<(?:a|iframe)\b[^>]*(?:href|src)=["']([^"']+)["'][^>]*>([\s\S]*?)(?:<\/a>|<\/iframe>|$)/gi)].map(match => ({ href: match[1]!, label: sourceText(match[2] ?? "").slice(0, 400) }));
      // Data requests visible in page/script configuration; do not guess private APIs.
      for (const match of html.matchAll(/["']((?:https?:\/\/|\/)[^"'\s<>]+(?:FeatureServer\/\d+|MapServer\/\d+|\.json(?:\?[^"'\s<>]*)?))["']/gi)) links.push({ href: match[1]!, label: "Published map or JSON data" });
      for (const link of links) {
        let url: URL; try { url = new URL(link.href.replace(/&amp;/g, "&"), capture.url); } catch { continue; }
        url.hash = "";
        if (!["http:", "https:"].includes(url.protocol) || /(?:^|\.)(?:google|bing|duckduckgo|yahoo)\.com$/i.test(url.hostname)) continue;
        if (doors.has(url.href)) continue;
        const clue = `${link.label} ${url.href}`;
        const shape = votingDoorShape(url.href, link.label);
        const isDirectoryEntry = parent.shape === "county-directory" && !/privacy|accessibility|facebook|twitter|instagram|youtube|linkedin/i.test(clue);
        if (!ELECTION_ROUTE.test(clue) && !isDirectoryEntry && !["map-service", "json"].includes(shape)) continue;
        if (!isOfficialSource(url.href, linkingPage)) continue;
        const covers = votingDoorCoverage(clue);
        const resolvedScope = isDirectoryEntry || parent.scopeUnresolved ? runtime.resolveScope?.(link.label, url.href, parent.scope) : undefined;
        if (isDirectoryEntry && !resolvedScope) blanks.push({ id: `${parent.id}:scope:${createHash("sha256").update(url.href).digest("hex").slice(0, 12)}`, doorId: parent.id, scope: parent.scope, status: "open", reason: "missing-sites", owed: `Match the delegated office ${link.label || url.hostname} to its registered county or town`, tried: [capture.url, url.href], next: ["Match this official directory entry against the jurisdiction registry, then acquire its public voting lists"] });
        const door: VotingSourceDoor = {
          ...parent, id: `voting-${createHash("sha256").update(`${root.scope.ocdId}\0${url.href}`).digest("hex").slice(0, 20)}`,
          url: url.href, shape, title: link.label || undefined, scope: resolvedScope ?? parent.scope, scopeUnresolved: !resolvedScope && (isDirectoryEntry || parent.scopeUnresolved), covers: !resolvedScope && (isDirectoryEntry || parent.scopeUnresolved) ? [] : covers.length ? covers : parent.covers,
          platform: fingerprintVotingPlatform(url.href), officialLinkingPage: linkingPage, discoveredFrom: capture.url,
          electionPageUrl: currentElection ? capture.url : parent.electionPageUrl,
          electionAssociationVerified: currentElection,
          // A newly found layout has its own extraction mapping; never inherit columns from another file.
          extraction: undefined, changeNotices: undefined,
        };
        doors.set(url.href, door);
        if (runtime.onDiscoveredDoor) await runtime.onDiscoveredDoor(door, [capture]);
        if (["list-page", "county-directory", "vendor-platform"].includes(shape)) queue.push(door);
      }
    } catch (error) {
      blanks.push({ id: `${parent.id}:discovery`, doorId: parent.id, scope: parent.scope, status: "open", reason: "access", owed: "Public voting locations and official delegated-office routes", tried: [`${parent.url}: ${String(error)}`], next: ["Walk the registered county or town election offices", "Read the chief election office's other files and map services"] });
    }
  }
  return { doors: [...doors.values()], attempts: session.attempts, rawBodies: session.rawBodies, blanks };
}
