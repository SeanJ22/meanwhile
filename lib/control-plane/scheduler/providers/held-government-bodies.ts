import { visibleText, decodeEntities } from "../../../extract/visible-text.ts";
import type { Query } from "../../../facts/publish.ts";
import type { WorkerPublicationCapture } from "../../../civic-data/worker-roster-publication.ts";
import type { HeldSubjectDetails } from "./held-subject-enrichment.ts";
import type { HeldDetailFact } from "./held-subject-extraction.ts";

const label = (value: string) => visibleText(value).replace(/\s+/g, " ").trim();
const nameKey = (value: string) => label(value).toLowerCase();
const stateDivision = (value: string) => /^ocd-division\/country:us\/(?:state|district|territory):[a-z]{2}$/i.test(value);
export interface GovernmentBodyAnchor { readonly name: string; readonly url: string; readonly quote: string }
export interface HeldGovernmentBody { readonly bodyId: string; readonly name: string; readonly url: string; readonly divisionId: string }

/** An explicit held jurisdiction is different from the provider's state queue scope. */
export function heldGovernmentDivision(subject: HeldSubjectDetails): string | null {
  if (subject.subjectKind !== "government") return null;
  const divisions = [...new Set(subject.governmentDivisionIds ?? [])];
  if (divisions.length !== 1 || !subject.divisionIds.includes(divisions[0]!)) return null;
  return stateDivision(divisions[0]!) && subject.governmentClass !== "STATE" ? null : divisions[0]!;
}

/** A named body link on this government's own page is a candidate, never a newly registered body. */
export function governmentBodyAnchors(subject: HeldSubjectDetails, capture: WorkerPublicationCapture): GovernmentBodyAnchor[] {
  if (!heldGovernmentDivision(subject) || !subject.sourceUrls.includes(capture.evidence.canonicalUrl)) return [];
  const html = /<main\b[^>]*>([\s\S]*?)<\/main\s*>/i.exec(capture.evidence.text)?.[1] ?? capture.evidence.text;
  const scope = html.replace(/<(nav|footer|aside|script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ");
  const headings = [...scope.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi)];
  const own = headings.filter(h => nameKey(h[2]!) === nameKey(subject.label));
  if (own.length !== 1) return [];
  const heading = own[0]!, end = headings.find(h => h.index! > heading.index! && Number(h[1]) <= Number(heading[1]));
  const about = scope.slice(heading.index!, end?.index ?? scope.length);
  return [...about.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a\s*>/gi)].flatMap(anchor => {
    const name = label(anchor[2]!);
    let url: URL;
    try { url = new URL(decodeEntities(anchor[1]!), capture.evidence.canonicalUrl); }
    catch { return []; }
    if (!name || !["https:", "http:"].includes(url.protocol) || url.username || url.password) return [];
    return [{ name, url: url.href, quote: name }];
  }).filter((anchor, index, all) => all.findIndex(other => other.name === anchor.name && other.url === anchor.url) === index);
}

/** Only source-named candidates and their exact held scope are searched; only unambiguous minimum identities return. */
export const HELD_GOVERNMENT_BODIES_SQL = `WITH runtime AS MATERIALIZED (
    SELECT reader_payload_node(payload) value FROM civic_data_promotions
      WHERE key='REGISTRY_RUNTIME_BINDING:US-'||$1||':reader-registry-runtime'
  ), anchors AS MATERIALIZED (
    SELECT name,url FROM jsonb_to_recordset($3::jsonb) AS a(name text,url text)
  ), held_bodies AS MATERIALIZED (
    SELECT reader_payload_node(b.item)->>'id' id,reader_payload_node(b.item)->>'name' name,
      reader_payload_node(b.item)->>'ocdId' division_id,reader_payload_node(b.item)->>'homepageUrl' homepage,
      reader_payload_node(reader_payload_node(b.item)->'provenance')->>'sourceUrl' source_url
      FROM runtime r,LATERAL reader_payload_members(reader_payload_node(r.value->'registry')->'bodies') b
  ), bodies AS MATERIALIZED (
    SELECT id,name,division_id,homepage,source_url FROM held_bodies
      WHERE homepage IN (SELECT url FROM anchors) OR source_url IN (SELECT url FROM anchors)
        OR trim(regexp_replace(lower(name),'[[:space:]]+',' ','g')) IN (SELECT lower(name) FROM anchors)
  ) SELECT b.id body_id,b.name,a.url,b.division_id FROM bodies b JOIN anchors a
      ON trim(regexp_replace(lower(b.name),'[[:space:]]+',' ','g'))=lower(a.name) AND (b.homepage=a.url OR b.source_url=a.url)
    WHERE b.division_id=$2 AND b.id IS NOT NULL
      AND (SELECT count(*) FROM held_bodies same_id WHERE same_id.id=b.id)=1
      AND (SELECT count(*) FROM bodies same_name WHERE same_name.division_id=$2
        AND trim(regexp_replace(lower(same_name.name),'[[:space:]]+',' ','g'))=lower(a.name))=1
      AND (SELECT count(*) FROM bodies same_url WHERE same_url.homepage=a.url OR same_url.source_url=a.url)=1`;

export async function readHeldGovernmentBodies(query: Query, subject: HeldSubjectDetails, anchors: readonly GovernmentBodyAnchor[]): Promise<HeldGovernmentBody[]> {
  const division = heldGovernmentDivision(subject), state = /\/(?:state|district|territory):([a-z]{2})(?:\/|$)/i.exec(division ?? "")?.[1]?.toUpperCase();
  if (!division || !state || !anchors.length) return [];
  return (await query(HELD_GOVERNMENT_BODIES_SQL, [state, division, JSON.stringify(anchors.map(({ name, url }) => ({ name, url })))]))
    .flatMap(row => typeof row.body_id === "string" && typeof row.name === "string" && typeof row.url === "string" && row.division_id === division
      ? [{ bodyId: row.body_id, name: row.name, url: row.url, divisionId: division }] : []);
}

export function governmentBodyFacts(subject: HeldSubjectDetails, capture: WorkerPublicationCapture, known: readonly HeldGovernmentBody[]): HeldDetailFact[] {
  const division = heldGovernmentDivision(subject);
  return governmentBodyAnchors(subject, capture).flatMap(anchor => {
    const matches = known.filter(body => body.divisionId === division && nameKey(body.name) === nameKey(anchor.name) && body.url === anchor.url);
    if (matches.length !== 1) return [];
    const body = matches[0]!;
    return [{ entityId: subject.subjectId, field: `body:${body.bodyId}`, fieldKind: "officeholder" as const,
      value: { governmentId: subject.subjectId, bodyId: body.bodyId, name: body.name, url: body.url, divisionId: division },
      valueText: anchor.name, quote: anchor.quote, sourceUrl: capture.evidence.canonicalUrl }];
  });
}
