import type { MeetingsDiscoveryNeed } from "../../hunt/meetings-discovery.ts";
import type { RouteHint } from "../../hunt/meetings-route-hints.ts";
import { meetingEndpointCandidates, type VerifiableVendor } from "../../hunt/meetings-site-discovery.ts";
import { assertPublicUrl } from "../../hunt/egress.ts";
import { readRouteHints } from "../../doors/route-hints.ts";
import type { FieldManualEntry } from "../field-manual.ts";
import type { ControlPlaneRepositories } from "../repository/types.ts";
import type { ScoutFinding, ScoutResult } from "../scheduler/scout-result.ts";

type HintRepos = Pick<ControlPlaneRepositories, "doors" | "boxFindings" | "scoutResults" | "workItems">;
const routeField = (field: string | undefined) => /^(?:mtg0[12]|(?:meeting)?(?:calendar|agenda)(?:url|source(?:url|ref)?|route)?)$/i.test((field ?? "").replace(/[_. -]/g, ""));
const meetingClass = (value: string) => /meeting|agenda|calendar|^MTG-0[12]$/i.test(value);

function evidenceRoute(input: { url: unknown; body: string; evidence: string; artifactIds: readonly string[];
  at: string | null; by: string }): RouteHint | null {
  if (typeof input.url !== "string" || !input.artifactIds.length || !input.at || !Number.isFinite(Date.parse(input.at))) return null;
  let url: URL;
  try { url = assertPublicUrl(input.url); } catch { return null; }
  const document = /\.pdf$/i.test(url.pathname);
  const witness = /(?:^|\.)(?:youtube\.com|youtu\.be|swagit\.com)$/i.test(url.hostname);
  const candidate = meetingEndpointCandidates(`<a href="${url.href.replace(/"/g, "%22")}"></a>`, url.href)
    .find(row => row.verifiable);
  const vendor: VerifiableVendor | null = document || witness ? null
    : /\.api\.civicclerk\.com$/i.test(url.hostname) ? "civicclerk-api"
    : url.hostname === "webapi.legistar.com" ? "legistar-api"
    : candidate ? candidate.vendor as VerifiableVendor : "official-page-events";
  return { url: input.url, body: input.body, kind: witness ? "WITNESS" : document ? "DOCUMENT" : vendor === "ical" ? "FEED" : "PAGE",
    platform: vendor ?? (witness ? "video" : "pdf"), verifyAs: vendor,
    evidence: `${input.evidence}; saved copies: ${input.artifactIds.join(", ")}`,
    observed: { at: input.at, by: input.by } };
}

export async function readDiscoveryRouteHints(repos: HintRepos, need: MeetingsDiscoveryNeed, entries: readonly FieldManualEntry[]) {
  const publications = await Promise.all([repos.workItems.listWhere(["subject"], need.jurisdictionId),
    repos.workItems.listWhere(["autonomousPlan", "directorySubject", "jurisdiction", "id"], need.jurisdictionId)]);
  const bodyIds = new Set(need.bodyIds);
  for (const row of publications.flat()) {
    const published = row.value.publicationOutcome;
    if (!published || published.status === "HELD") continue;
    for (const bodyId of published.bodyIds ?? []) bodyIds.add(bodyId);
    const bodyId = row.value.autonomousPlan?.publication?.bodyId;
    if (published.status === "PUBLISHED" && bodyId) bodyIds.add(bodyId);
  }
  const subjects = new Set([need.jurisdictionId, ...[...bodyIds].flatMap(id => [id, `${id}#calendar`])]);
  const routes: RouteHint[] = [];
  for (const entry of entries) {
    if (!["SCOUT_DISCOVERY", "ROUTE"].includes(entry.kind) || !entry.recordClasses.some(meetingClass)) continue;
    const payload = entry.payload as { subjectId?: string; jurisdictionId?: string; obligationId?: string;
      evidenceArtifactIds?: string[]; bodyName?: string } | null;
    const subject = payload?.subjectId ?? payload?.jurisdictionId ?? /^freshness:[^:]+:([^#]+)#/.exec(payload?.obligationId ?? "")?.[1];
    if (!subjects.has(subject ?? "") && !(entry.bodyIds ?? []).some(id => subjects.has(id))) continue;
    const route = evidenceRoute({ url: entry.url, body: payload?.bodyName ?? need.name, evidence: `${entry.id}: ${entry.summary}`,
      artifactIds: payload?.evidenceArtifactIds ?? [], at: entry.observedAt, by: entry.id });
    if (route) routes.push(route);
  }
  if (!repos.scoutResults.keysWhere) throw new Error("Scoped hunter results cannot be read");
  const results = new Map<string, ScoutResult>();
  const slices = await Promise.all([...subjects].map(async subject => {
    const [keys, boxed] = await Promise.all([repos.scoutResults.keysWhere!(["subjectId"], subject),
      repos.boxFindings.listWhere(["subjectId"], subject)]);
    const direct = await Promise.all(keys.map(key => repos.scoutResults.readWhere(key, ["subjectId"], subject)));
    return { direct: direct.flat(), boxed };
  }));
  for (const slice of slices) for (const result of slice.direct) results.set(result.attemptId, result);
  for (const slice of slices) for (const row of slice.boxed) for (const origin of row.value.origins) {
    if (origin.kind !== "SCOUT") continue;
    if (origin.reported) {
      if (!routeField(origin.reported.field) && !routeField(origin.missionPart)) continue;
      const route = evidenceRoute({ url: typeof origin.reported.value === "string" && /^https?:\/\//.test(origin.reported.value)
        ? origin.reported.value : row.value.sourceUrl, body: need.name,
        evidence: `${row.id}: ${row.value.exactQuote ?? ""}`, artifactIds: origin.artifactIds,
        at: origin.recordedAt, by: origin.resultId });
      if (route) routes.push(route);
    } else if (!results.has(origin.resultId)) {
      for (const key of await repos.scoutResults.keysWhere(["attemptId"], origin.resultId)) {
        for (const result of await repos.scoutResults.readWhere(key, ["attemptId"], origin.resultId)) results.set(result.attemptId, result);
      }
    }
  }
  for (const result of results.values()) {
    const rejected = new Set(result.sourceDeadEnds?.map(row => row.artifactId));
    for (const finding of result.findings) {
      if (!subjects.has(finding.subjectId ?? result.subjectId) || (!routeField(finding.field) && !routeField(finding.missionPart)) ||
        finding.artifactIds.some(id => rejected.has(id))) continue;
      const route = findingRoute(finding, result, need.name);
      if (route) routes.push(route);
    }
  }
  return readRouteHints(repos.doors, need.jurisdictionId, routes);
}

function findingRoute(finding: ScoutFinding, result: ScoutResult, body: string): RouteHint | null {
  return evidenceRoute({ url: typeof finding.value === "string" && /^https?:\/\//.test(finding.value) ? finding.value : finding.sourceUrl,
    body, evidence: `${result.attemptId}: ${finding.exactQuote ?? finding.summary}`, artifactIds: finding.artifactIds,
    at: result.recordedAt, by: result.attemptId });
}
