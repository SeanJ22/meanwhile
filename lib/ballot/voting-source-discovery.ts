import { createHash } from "node:crypto";
import { classifySourceContent, sourceBody, sourceLinks, SOURCE_FAMILIES, type SourceDisposition } from "../doors/source-content.ts";
import { pageAddress } from "../doors/page-doors.ts";
import { extractTextLayer } from "../extract/text-layer.ts";
import type { SiteKind } from "./voting-sites.ts";
import { fingerprintVotingPlatform } from "./voting-source-readers.ts";
import { votingFetchSession } from "./voting-source-fetch.ts";
import { isOfficialSource } from "../civic-data/source-authority.ts";
import type { VotingSourceDoor, VotingSourceRuntime, VotingDoorShape } from "./voting-source-types.ts";

const DIRECTORY = /(?:county|town|local|municipal).{0,35}(?:director|office|clerk|contact|official)|(?:director|contact).{0,35}(?:county|town|local|election)/i;
const IDENTITY = /(?:date\s*of\s*birth|birth\s*date|\bSSN\b|social security)/i;
function votingDoorShape(url: string, label = ""): VotingDoorShape {
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
function votingDoorCoverage(label: string): SiteKind[] {
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
export interface ClassifiedVotingSource {
  source: VotingSourceDoor;
  disposition: SourceDisposition;
  capture: { url: string; contentType: string; bytes: Uint8Array } | null;
  linkingCaptures: { url: string; contentType: string; bytes: Uint8Array }[];
}
interface VotingDiscoveryResult {
  doors: VotingSourceDoor[];
  evidence: ClassifiedVotingSource[];
  sources: ClassifiedVotingSource[];
  skips: { url: string; reason: string }[];
  attempts: ReturnType<typeof votingFetchSession>["attempts"];
  rawBodies: ReturnType<typeof votingFetchSession>["rawBodies"];
}

export async function discoverVotingDoors(root: VotingSourceDoor, runtime: VotingSourceRuntime): Promise<VotingDiscoveryResult> {
  const session = votingFetchSession(runtime);
  const queued = new Set<string>(), finalUrls = new Set<string>();
  const queue: { source: VotingSourceDoor; linkingCaptures: ClassifiedVotingSource["linkingCaptures"] }[] = [];
  const doors: VotingSourceDoor[] = [], evidence: ClassifiedVotingSource[] = [], sources: ClassifiedVotingSource[] = [];
  const skips: VotingDiscoveryResult["skips"] = [];
  const enqueue = (source: VotingSourceDoor, linkingCaptures: ClassifiedVotingSource["linkingCaptures"]) => {
    const key = pageAddress(source.url)?.url;
    if (!key || queued.has(key) || runtime.discoverySeen?.has(key)) return;
    queued.add(key); queue.push({ source, linkingCaptures });
  };
  enqueue({ ...root }, []);
  while (queue.length) {
    const { source, linkingCaptures } = queue.shift()!;
    runtime.discoverySeen?.add(pageAddress(source.url)!.url);
    let capture: ClassifiedVotingSource["capture"] = null;
    let text = "";
    try {
      capture = await session.get(source.url);
      const final = pageAddress(capture.url)!.url;
      if (finalUrls.has(final) || final !== pageAddress(source.url)?.url && runtime.discoverySeen?.has(final)) continue;
      finalUrls.add(final);
      runtime.discoverySeen?.add(final);
      source.url = final;
      text = new TextDecoder().decode(capture.bytes);
      if (/pdf/i.test(capture.contentType) || text.startsWith("%PDF")) {
        const extracted = await extractTextLayer(new Uint8Array(capture.bytes), capture.url);
        text = extracted.items.map(page => page.text).join(" ");
      }
    } catch (error) {
      const disposition: SourceDisposition = { kind: "SKIP", family: null, recordClass: null, quote: "", belongs: false,
        reason: `Source could not be read: ${error instanceof Error ? error.message : String(error)}` };
      const observation = { source, disposition, capture: null, linkingCaptures };
      sources.push(observation); skips.push({ url: source.url, reason: disposition.reason });
      await runtime.onDiscoveredSource?.(observation);
      continue;
    }
    let disposition = classifySourceContent({ url: source.url, text, contentType: capture.contentType,
      names: [source.scope.name, source.publisher], owed: SOURCE_FAMILIES });
    if (source.boundaryLayer && isOfficialSource(source.url, source.officialLinkingPage)) disposition = {
      kind: "DOOR", family: "voting", recordClass: "VOTING_SITE", belongs: true,
      quote: source.title ?? "Precinct boundaries", reason: "The official election page links this precinct-boundary source" };
    const observation = { source, disposition, capture, linkingCaptures };
    sources.push(observation);
    if (disposition.kind === "DOOR" && disposition.family === "voting") {
      doors.push(source);
      await runtime.onDiscoveredDoor?.(source, [...linkingCaptures, capture]);
    } else if (disposition.kind === "EVIDENCE") evidence.push(observation);
    else if (disposition.kind === "SKIP") skips.push({ url: source.url, reason: disposition.reason });
    await runtime.onDiscoveredSource?.(observation);
    if (!/html/i.test(capture.contentType) && !/^\s*<(?:!doctype|html)/i.test(text)) continue;
    if (!disposition.belongs && pageAddress(source.url)?.url !== pageAddress(root.url)?.url) continue;
    const parentText = sourceBody(text).text;
    const linkingPage = { url: capture.url, html: text, linkingPage: source.officialLinkingPage };
    const currentElection = pageNamesElection(parentText, root.electionDate);
    for (const link of sourceLinks(text, capture.url)) {
      const resolved = runtime.resolveScope?.(link.label, link.url, source.scope);
      const clue = `${link.label} ${link.url}`;
      const scope = resolved ?? source.scope;
      enqueue({ id: `voting-${createHash("sha256").update(link.url).digest("hex").slice(0, 20)}`,
        publisher: resolved ? resolved.name : source.publisher, url: link.url,
        shape: votingDoorShape(link.url, link.label), title: link.label || undefined,
        scope, covers: votingDoorCoverage(link.label), platform: fingerprintVotingPlatform(link.url),
        ...(/precinct.{0,40}(?:boundar|geojson|featureserver|mapserver)|(?:boundar|geojson).{0,40}precinct/i.test(clue) ? { boundaryLayer: true } : {}),
        officialLinkingPage: linkingPage, discoveredFrom: capture.url,
        electionDate: root.electionDate, electionPageUrl: currentElection ? capture.url : source.electionPageUrl,
        electionAssociationVerified: currentElection }, [capture]);
    }
  }
  return { doors, evidence, sources, skips, attempts: session.attempts, rawBodies: session.rawBodies };
}
