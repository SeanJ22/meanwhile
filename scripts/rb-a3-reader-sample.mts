import { neon } from "@neondatabase/serverless";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { selectedPointerSql } from "../lib/reader/selected-entry.ts";
import { FIPS_TO_STATE } from "../lib/ocd/fips.ts";
import { isOfficialUrl } from "../lib/facts/check.ts";
import { isSourceApiUrl } from "../lib/control-plane/scheduler/scout-api.ts";
import { pageLinksSource } from "../lib/civic-data/source-authority.ts";

type Row = Record<string, unknown>;
interface Family { recordClass: string; path: string[]; kind: string; fields: string[] }
const families: readonly Family[] = [
  { recordClass: "REGISTRATION", path: ["governments"], kind: "government", fields: ["name", "website", "officePhone", "officeAddress", "mailingAddress", "contactTitle", "status", "governmentClass"] },
  { recordClass: "REGISTRATION", path: ["divisions"], kind: "place", fields: ["label", "divisionType", "geoid"] },
  { recordClass: "REGISTRY_RUNTIME_BINDING", path: ["registry", "bodies"], kind: "body", fields: ["name", "website", "phone", "address"] },
  { recordClass: "STATE_LEGISLATOR", path: ["roster", "officeholders"], kind: "person", fields: ["name", "partyLabel", "email", "phone", "websiteUrl", "termStart", "termEnd"] },
  { recordClass: "FEDERAL_DIRECTORY", path: ["roster", "officeholders"], kind: "person", fields: ["name", "partyLabel", "email", "phone", "websiteUrl", "termStart", "termEnd"] },
  { recordClass: "MEETING", path: ["meetings"], kind: "meeting", fields: ["title", "name", "startsAt", "start", "location", "url", "agendaUrl", "minutesUrl"] },
  { recordClass: "MEETING", path: ["agendaDocuments"], kind: "agenda_item", fields: ["title", "documentUrl"] },
  { recordClass: "FEDERAL_MONEY", path: ["records"], kind: "statement", fields: ["title", "amount", "recipient", "period", "amountLabel", "details.auditeeCity", "details.lowRiskAuditee", "details.materialWeakness", "details.materialNoncompliance", "details.significantDeficiency", "details.questionedCosts", "details.findingText", "details.plannedAction", "details.repeatFinding"] },
  { recordClass: "FEDERAL_CIVIC_RECORD", path: ["records"], kind: "bill", fields: ["title", "number", "summary", "text"] },
  { recordClass: "STATE_BILL", path: ["records"], kind: "bill", fields: ["title", "number", "summary", "text"] },
  { recordClass: "CURATED_READER_RECORD", path: ["records"], kind: "statement", fields: ["title", "name", "text", "value", "description"] },
  { recordClass: "BALLOT_CANDIDACY", path: ["ballots", "candidacies"], kind: "candidacy", fields: ["givenName", "familyName", "partyLabel", "websiteUrl"] },
  { recordClass: "MEETING_OUTCOME", path: ["sittings"], kind: "meeting", fields: ["title", "bodyName", "minutesUrl", "videoUrl"] },
  { recordClass: "STATE_EXECUTIVE_ACTION", path: ["actions"], kind: "statement", fields: ["title", "date", "effectiveDate", "url"] },
];
const at = (record: unknown, path: string): unknown => path.split(".").reduce<unknown>((v, k) => v && typeof v === "object" ? (v as Row)[k] : undefined, record);
const nodePath = (path: readonly string[]) => path.reduce((v, k) => `reader_payload_node(${v})->'${k}'`, "pointer.payload");

export interface ReaderSampleValue {
  table: "civic_data_promotions"; pointer: string; version: string; recordClass: string;
  subjectId: string; subjectKind: string; subjectName: string; field: string; value: unknown;
  sourceUrl: string; observedAt: string; sourceRecord: Row; sourcePath: string; hosts?: string[]; parentId?: string;
  linkingPage?: { url: string; file: string };
  heldApiHost?: string;
  sourceBodyId?: string;
}
export interface ReaderSample { state: string; capturedAt: string; values: ReaderSampleValue[]; families: Row[];
  copies: Record<string, { file: string; observedAt: string; sha256: string }>; context?: Row; copyFailures?: Row[] }

export interface HeldApiDoor { body_ids: string[]; api_base: string; portal_base: string | null }
export function bindHeldApiSources(sample: Pick<ReaderSample, "values">, sourceDoors: readonly HeldApiDoor[]): void {
  for (const value of sample.values) {
    const body = /:body:([^:]+)/.exec(value.pointer)?.[1];
    value.sourceBodyId = typeof value.sourceRecord.bodyId === "string" ? value.sourceRecord.bodyId : body ? decodeURIComponent(body) : undefined;
    const sourceDoor = sourceDoors.find(d => d.portal_base && new URL(d.portal_base).hostname === new URL(value.sourceUrl).hostname);
    if (sourceDoor) {
      value.heldApiHost = `${new URL(sourceDoor.api_base).hostname}/v1`;
      value.hosts = [...new Set([...value.hosts ?? [], value.heldApiHost])];
    }
  }
}

if (process.argv[1]?.endsWith("rb-a3-reader-sample.mts")) {
  const directory = resolve(process.argv[2] ?? ".scratch/rb-a3/snapshots/reader");
  if (!directory.includes("/.scratch/rb-a3/")) throw Error("Production copies belong in the approved ignored local directory");
  const url = process.env.WTP_PRODUCTION_DATABASE_URL_READONLY;
  if (!url || new URL(url).username !== "readonly") throw Error("The reader readonly connection is required");
  const sql = neon(url);
  const query = async (text: string, params: unknown[]) => (await sql.transaction([sql.query(text, params)], { readOnly: true }))[0] as Row[];
  const [connection] = await query("SELECT current_user AS role,current_setting('transaction_read_only') AS read_only", []);
  if (connection.role !== "readonly" || connection.read_only !== "on") throw Error("The production connection must be read-only");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const delegationCache = new Map<string, ReaderSampleValue["linkingPage"]>();
  const delegation = async (value: ReaderSampleValue): Promise<ReaderSampleValue["linkingPage"]> => {
    if (!/civicclerk|legistar|boarddocs|boardbook|primegov|novus|granicus/i.test(new URL(value.sourceUrl).hostname)) return;
    const key = JSON.stringify([new URL(value.sourceUrl).hostname, value.hosts]);
    if (delegationCache.has(key)) return delegationCache.get(key);
    for (const host of (value.hosts ?? []).filter(h => !h.includes("/")).slice(0, 3)) {
      const pending = [`https://${host}/`], visited = new Set<string>();
      while (pending.length && visited.size < 4) {
        const url = pending.shift()!; if (visited.has(url)) continue; visited.add(url);
        try {
          const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
          if (!response.ok) continue;
          const html = await response.text(), page = { url: response.url, html };
          if (!isOfficialUrl(page.url, value.hosts ?? [])) continue;
          if (pageLinksSource(value.sourceUrl, page)) {
            const file = `pages/delegation-${createHash("sha256").update(page.url).digest("hex")}.html`;
            writeFileSync(resolve(directory, file), html, { mode: 0o600 });
            const saved = { url: page.url, file }; delegationCache.set(key, saved); return saved;
          }
          for (const match of html.matchAll(/\bhref\s*=\s*["']([^"']+)["']/gi)) {
            if (!/meeting|agenda|calendar/i.test(match[1]) || !URL.canParse(match[1], page.url)) continue;
            const link = new URL(match[1], page.url);
            if (isOfficialUrl(link.href, [host]) && !visited.has(link.href)) pending.push(link.href);
          }
        } catch { /* Keep the source in the checked lane if its own page cannot be saved. */ }
      }
    }
    delegationCache.set(key, undefined);
  };
  const states = process.argv[3] ? [process.argv[3]] : Object.values(FIPS_TO_STATE).map(s => s.postal).sort();
  const published = selectedPointerSql.replace("WHERE p.key=$1", "WHERE p.record_class=$1 AND (p.scope ~* $2 OR reader_payload_node(p.payload)->>'state'=$3)");
  for (const state of states) {
    if (!/^[A-Z]{2}$/.test(state)) throw Error("Invalid state");
    const values: ReaderSampleValue[] = [], inventory: Row[] = [], seen = new Set<string>(), buckets: ReaderSampleValue[][] = [];
    // Keep a bounded slice of the fact table in the combined sample as well.
    const old = JSON.parse(readFileSync(resolve(directory, "..", `${state}.json`), "utf8")) as { facts?: Row[] };
    const factCount = Math.min(100, old.facts?.length ?? 0), limit = 1_000 - factCount;
    for (const family of families) {
      // Leave room for each family rather than allowing the first large directory to fill the sample.
      const familyLimit = family.recordClass === "REGISTRATION" ? 250 : 80;
      const members = family.recordClass === "BALLOT_CANDIDACY"
        ? `jsonb_each(reader_payload_node(${nodePath(["ballots"])})) ballot,LATERAL reader_payload_members(reader_payload_node(ballot.value)->'candidacies') row`
        : `reader_payload_members(${nodePath(family.path)}) row`;
      const rows = await query(`WITH pointer AS MATERIALIZED (${published}), selected AS (
        SELECT pointer.key,pointer.current_version_id,pointer.retrieved_at,row.ordinal_index,reader_payload_value(row.item) AS record
        FROM pointer,LATERAL ${members} WHERE pointer.published
        ORDER BY pointer.key,row.ordinal_index LIMIT $4
      ) SELECT * FROM selected`, [family.recordClass, `(^|[:+])(?:US-)?${state}(:|$|\\+)|(?:state|district|territory)%3A${state}(?:%2F|$)`, state, familyLimit]);
      const bucket: ReaderSampleValue[] = [];
      for (const row of rows) {
        const record = row.record as Row;
        const id = family.recordClass === "MEETING_OUTCOME" ? record.meetingId
          : family.kind === "agenda_item" ? record.id ?? record.documentUrl : record.id ?? record.ocdId ?? record.bodyId;
        if (typeof id !== "string" || !id) continue;
        const sourceUrl = at(record, "provenance.sourceUrl") ?? record.sourceUrl ?? at(record, "source.url");
        if (typeof sourceUrl !== "string" || !URL.canParse(sourceUrl)) continue;
        const observedAt = at(record, "provenance.retrievedAt") ?? at(record, "provenance.collectedAt") ?? record.capturedAt ?? row.retrieved_at;
        for (const field of family.fields) {
          const value = at(record, field);
          if (value === null || value === undefined || value === "" || typeof value === "object") continue;
          const key = JSON.stringify([id, field]);
          if (seen.has(key)) continue;
          seen.add(key);
          bucket.push({ table: "civic_data_promotions", pointer: String(row.key), version: String(row.current_version_id), recordClass: family.recordClass,
            subjectId: id, subjectKind: family.kind, subjectName: String(record.name ?? record.label ?? record.title ?? record.sourceOrg
              ?? (family.kind === "candidacy" ? [record.givenName, record.familyName].filter(Boolean).join(" ") || id : id)),
            field, value, sourceUrl, observedAt: new Date(observedAt as string).toISOString(), sourceRecord: record, sourcePath: field });
        }
      }
      buckets.push(bucket);
      inventory.push({ recordClass: family.recordClass, path: family.path, selectedRecords: rows.length, availableInSlice: bucket.length,
        bounded: rows.length === familyLimit });
    }
    for (let position = 0; values.length < limit && buckets.some(bucket => bucket.length > position); position++)
      for (const bucket of buckets) if (bucket[position] && values.length < limit) values.push(bucket[position]);
    for (const value of values) {
      const body = /:body:([^:]+)/.exec(value.pointer)?.[1];
      value.sourceBodyId = typeof value.sourceRecord.bodyId === "string" ? value.sourceRecord.bodyId : body ? decodeURIComponent(body) : undefined;
    }
    const seeds = [...new Set(values.flatMap(v => [v.subjectId, v.sourceBodyId, v.sourceRecord.governmentId, ...Array.isArray(v.sourceRecord.aliases) ? v.sourceRecord.aliases : []]).filter((v): v is string => typeof v === "string"))];
    const [contextRow] = await query(`WITH RECURSIVE seeds AS (SELECT unnest($1::text[]) id),
      anchors AS (SELECT e.id FROM entity e WHERE e.id IN(SELECT id FROM seeds)
        OR e.id IN(SELECT 'meeting:'||id FROM seeds) OR e.id IN(SELECT 'congress-api:'||substring(id FROM '^congress:([A-Z][0-9]{6})$') FROM seeds)
        OR e.id IN(SELECT entity_id FROM entity_external_id WHERE value IN(SELECT id FROM seeds))),
      members AS(SELECT id FROM anchors UNION SELECT place_id FROM entity_place WHERE entity_id IN(SELECT id FROM anchors)),
      ancestors(id) AS(SELECT id FROM members UNION SELECT e.parent_id FROM entity e JOIN ancestors a ON a.id=e.id WHERE e.parent_id IS NOT NULL)
      SELECT jsonb_build_object('entities',(SELECT jsonb_agg(e) FROM entity e WHERE id IN(SELECT id FROM ancestors)),
        'hosts',(SELECT jsonb_agg(h) FROM entity_host h WHERE entity_id IN(SELECT id FROM ancestors)),
        'externalIds',(SELECT jsonb_agg(x) FROM entity_external_id x WHERE entity_id IN(SELECT id FROM ancestors)),
        'places',(SELECT jsonb_agg(p) FROM entity_place p WHERE entity_id IN(SELECT id FROM ancestors) AND place_id IN(SELECT id FROM ancestors))) AS context`, [seeds]);
    const context = contextRow.context as Row;
    const sourceDoors = JSON.parse(readFileSync(resolve(directory, "held-api-doors.json"), "utf8")) as HeldApiDoor[];
    const entities = new Map(((context.entities ?? []) as Row[]).map(e => [String(e.id), e]));
    const aliases = (context.externalIds ?? []) as Row[], hosts = (context.hosts ?? []) as Row[];
    for (const value of values) {
      const resolveEntity = (id: string) => entities.get(id) ?? entities.get(String(aliases.find(a => a.value === id)?.entity_id))
        ?? entities.get(`meeting:${id}`) ?? entities.get(id.replace(/^congress:/, "congress-api:"));
      let entity = resolveEntity(value.subjectId);
      const parent = value.sourceBodyId ?? value.sourceRecord.governmentId;
      if (!entity && typeof parent === "string") { entity = resolveEntity(parent); value.parentId = entity ? String(entity.id) : undefined; }
      value.hosts = [];
      const seen = new Set<string>();
      while (entity && !seen.has(String(entity.id))) {
        seen.add(String(entity.id)); value.hosts.push(...hosts.filter(h => h.entity_id === entity!.id).map(h => String(h.host)));
        entity = entities.get(String(entity.parent_id));
      }
    }
    bindHeldApiSources({ values }, sourceDoors);
    const copies: ReaderSample["copies"] = {}, copyFailures: Row[] = [];
    writeFileSync(resolve(directory, `${state}.json`), JSON.stringify({ state, capturedAt: new Date().toISOString(), values, families: inventory, copies, context }), { mode: 0o600 });
    mkdirSync(resolve(directory, "pages"), { recursive: true, mode: 0o700 });
    for (const value of values) if (!isOfficialUrl(value.sourceUrl, value.hosts ?? []) && !isSourceApiUrl(value.sourceUrl))
      value.linkingPage = await delegation(value);
    for (const url of new Set(values.filter(v => !isOfficialUrl(v.sourceUrl, v.hosts ?? []) && !isSourceApiUrl(v.sourceUrl)).map(v => v.sourceUrl))) {
      if (values.filter(v => v.sourceUrl === url).every(v => v.linkingPage)) continue;
      const name = createHash("sha256").update(url).digest("hex"), metadataFile = resolve(directory, "pages", `${name}.json`);
      if (existsSync(metadataFile)) { copies[url] = JSON.parse(readFileSync(metadataFile, "utf8")); continue; }
      const response = await fetch(url, { signal: AbortSignal.timeout(30_000) }).catch(() => null);
      if (!response?.ok) { copyFailures.push({ url, reason: response ? `HTTP_${response.status}` : "FETCH_FAILED" }); continue; }
      const text = await response.text(), file = `pages/${name}.txt`;
      const metadata = { file, observedAt: new Date().toISOString(), sha256: createHash("sha256").update(text).digest("hex") };
      writeFileSync(resolve(directory, file), text, { mode: 0o600 });
      writeFileSync(metadataFile, JSON.stringify(metadata), { mode: 0o600 });
      copies[url] = metadata;
    }
    const sample: ReaderSample = { state, capturedAt: new Date().toISOString(), values, families: inventory, copies, context, copyFailures };
    writeFileSync(resolve(directory, `${state}.json`), JSON.stringify(sample), { mode: 0o600 });
    console.log(JSON.stringify({ state, factCount, readerValues: values.length, selected: factCount + values.length, families: inventory, copyFailures }));
  }
}
