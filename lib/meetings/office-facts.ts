import { createReadStream } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { EvidenceStore } from "../control-plane/evidence/store.ts";
import type { WorkerPublicationCapture } from "../civic-data/worker-roster-publication.ts";
import { visibleText } from "../extract/visible-text.ts";
import { captureProvenance } from "../facts/capture.ts";
import { csvCells, csvWritten, isOfficialUrl, isOwnUrl, type SavedCopy } from "../facts/check.ts";
import { readCheckEntity, siteUrl, stateName } from "../facts/entity-read.ts";
import { openBlank, publishClaim, publishLoaded, type Clocks, type FactDb, type PublishOutcome, type Query } from "../facts/publish.ts";
import { pageCopy, saveCaptureCopy, saveReleaseCopy, saveSourceReference } from "../facts/source-copy.ts";
import { censusAddressQuery } from "../geo/address-query.ts";
import { isOfficeStreetAddress } from "../map/office-locator.ts";
import type { RegistryProvenance } from "../registry/types.ts";
import { readReleaseCheck } from "../sources/known-release.ts";
import { statedAgendaAddress, streetKeyOf } from "./agenda-address.ts";
import type { MeetingPinBody } from "./pin-location.ts";
import { challengeIn } from "../sources/http.ts";

const OFFICE_READER_VERSION="street-office-v2";

/** A body's office stays its own fact; an owning government's office is a separate fact and pin fallback.
 * Read only selected bodies and their exact keyed directory owners. */
export const OFFICE_FACT_TARGETS_SQL = `WITH selected AS MATERIALIZED (
  SELECT id,name,state,parent_id,kind FROM entity WHERE kind IN ('body','government') AND id=ANY($1::text[])
), owned AS (
  SELECT b.*,r.g FROM selected b LEFT JOIN LATERAL (
    SELECT reader_payload_value(value) AS g FROM (
      SELECT r.value,count(*) OVER() AS owners
      FROM civic_data_rows r JOIN civic_data_promotions p ON p.key=r.promotion_key AND p.current_version_id=r.version_id
      WHERE r.record_class='REGISTRATION' AND r.collection='governments' AND r.state=b.state
        AND r.promotion_key='REGISTRATION:US-'||b.state||':registration:v1'
        AND r.aliases && ARRAY[b.id,CASE WHEN b.id NOT LIKE 'ocd-division/%' THEN split_part(b.id,'#',1) END,
          (SELECT e.id FROM entity e WHERE e.id=b.parent_id AND e.kind='government')]
        AND (b.kind='government' OR (SELECT e.kind FROM entity e WHERE e.id=b.parent_id) IS DISTINCT FROM 'government'
          OR r.aliases @> ARRAY[b.parent_id])
    ) candidates WHERE owners=1
  ) r ON true
)
SELECT b.id,b.name,b.state,b.parent_id,
  coalesce(direct.id,registered.id) AS government_id,
  coalesce(direct.name,registered.name,b.g->>'name') AS government_name,
  b.g->>'officeAddress' AS registration_address,
  b.g#>>'{nativeIds,nces_leaid}' AS nces_leaid,
  coalesce(b.g#>'{contactProvenance,officeAddress}',b.g->'provenance') AS registration_source,
  coalesce((SELECT f.value#>>'{}' FROM fact f WHERE f.entity_id=b.id AND f.field='homepage' AND f.status='live'),
    (SELECT 'https://'||h.host FROM entity_host h WHERE h.entity_id=b.id
      AND h.host !~ 'legistar|civicclerk|boarddocs|iqm2|granicus' ORDER BY h.host LIMIT 1),
    CASE WHEN b.kind='government' THEN b.g->>'website' END) AS body_homepage,
  coalesce((SELECT f.value#>>'{}' FROM fact f WHERE f.entity_id=coalesce(direct.id,registered.id)
    AND f.field='homepage' AND f.status='live'),b.g->>'website') AS government_homepage
FROM owned b LEFT JOIN entity direct ON direct.id=CASE WHEN b.kind='government' THEN b.id ELSE b.parent_id END AND direct.kind='government'
LEFT JOIN LATERAL (SELECT e.id,e.name FROM entity e WHERE e.id=ANY(ARRAY[b.g->>'id',b.g->>'jurisdictionId']
    || ARRAY(SELECT jsonb_array_elements_text(coalesce(b.g->'aliases','[]'::jsonb))))
  AND e.kind='government' AND e.state=b.state
  ORDER BY (e.id=b.parent_id) DESC,e.id LIMIT 1) registered ON true
ORDER BY b.id`;

export function streetOfficeAddress(address: string): boolean {
  if (!isOfficeStreetAddress(address)) return false;
  const parsed = censusAddressQuery(address), street = streetKeyOf(parsed);
  return Boolean(street && street.index === 0);
}

/** Only a physical-office label or an address block can turn page text into an office claim. */
export function officeAddressesOnPage(text: string, state: string,ownerName?:string): readonly { address: string; quote: string }[] {
  const blocks = [...text.matchAll(/<address\b[^>]*>([\s\S]*?)<\/address\s*>/gi)].map(match => visibleText(match[1]!));
  const page = /<[^>]+>/.test(text) ? visibleText(text) : text;
  for (const label of page.matchAll(/\b(?:physical\s+address|office\s+address|office\s+location|main\s+office|district\s+office|city\s+hall|town\s+hall|county\s+administration|contact\s+(?:us|information))\b/gi))
    blocks.push(page.slice(label.index! + label[0].length, label.index! + label[0].length + 250));
  const scan=(sections:readonly string[])=>{
  const found = new Map<string, { address: string; quote: string }>();
  for (const section of sections) {let block=section;
    for(let street=streetKeyOf(block);street;street=streetKeyOf(block)){
    const remaining=block.slice(street.index);
    block=remaining.slice(street.length);
    const full = stateName(state);
    const normalized = full ? remaining.replace(new RegExp(`,\\s*${full}\\b`, "gi"), `, ${state}`) : remaining;
    const parsed = statedAgendaAddress(normalized);
    if (!parsed?.city || parsed.state !== state || !streetOfficeAddress(parsed.street)) continue;
    const tail = remaining.replace(/\s+/g, " ").trim();
    const end = new RegExp(`\\b(?:${state}${full ? `|${full}` : ""})(?:\\s*[, ]\\s*\\d{5}(?:-\\d{4})?)?\\b`, "i").exec(tail.slice(parsed.street.length));
    if (!end) continue;
    const quote = tail.slice(0, parsed.street.length + end.index + end[0].length);
    if (!streetOfficeAddress(quote)) continue;
    found.set(censusAddressQuery(quote), { address: quote, quote });
    }
  }
  return [...found.values()];};
  if(ownerName){
    const labels=[ownerName,ownerName.replace(/^(county|city|town|village|borough) of (.+)$/i,"$2 $1")];
    const own:string[]=[];
    for(const label of new Set(labels)){
      const pattern=new RegExp(`\\b${label.trim().split(/\s+/).map(word=>word.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")).join("\\s+")}\\b`,"gi");
      for(const match of page.matchAll(pattern)){
        const after=page.slice(match.index!+match[0].length,match.index!+match[0].length+700),street=streetKeyOf(after);
        if(street&&/^(?:[\s:,-]|office\s+address|physical\s+address|address)*$/i.test(after.slice(0,street.index)))own.push(after);
      }
    }
    const owned=scan(own);if(owned.length)return owned;
  }
  const explicit=scan(blocks);
  if(explicit.length)return explicit;
  const footer=/<footer\b|<(?:div|section|aside)\b[^>]*(?:id|class)\s*=\s*["'][^"']*footer/i.exec(text);
  return footer?scan([visibleText(text.slice(footer.index))]):[];
}

interface OfficeFactsInput {
  readonly facts: FactDb & { readonly query: Query };
  readonly vault: EvidenceStore;
  readonly clocks: Clocks;
  readonly now: string;
  readonly clock?:()=>number;
  readonly bodyIds: readonly string[];
  readonly offices?: ReadonlyMap<string, MeetingPinBody>;
  readonly more: () => boolean;
  /** Uses the caller's shared source pacer and existing retained-source reader. */
  readonly readCapture?: (url: string) => Promise<WorkerPublicationCapture | null>;
}

const HELD_NCES_SHA256 = "376539484b400c0c6d72d100766dc7acacc8725f464556062e2920b3a9b6a64c";
const NCES_ADDRESS = ["location_street1", "location_street2", "location_street3", "location_city", "location_state", "location_zip"] as const;
const ncesSource = (url: string | null | undefined): url is string => !!url && ["nces.ed.gov", "ies.ed.gov"].includes(new URL(url).hostname);

/** The directory file's own row for a native record, the address its columns make and the address exactly as the row writes it. */
interface NcesRow { readonly address: string; readonly row: string; readonly written: string | null }

/** Reads only these native records' rows from the held NCES file, one line at a time. */
async function heldNcesOfficeRows(targets: readonly Record<string, unknown>[]): Promise<{ readonly header: string; readonly rows: ReadonlyMap<string, NcesRow> }> {
  const ids = new Set(targets.flatMap(row => typeof row.nces_leaid === "string" && ncesSource((row.registration_source as RegistryProvenance | undefined)?.sourceUrl) ? [row.nces_leaid] : []));
  const rows = new Map<string, NcesRow>();
  let header = "";
  if (!ids.size) return { header, rows };
  const file = createReadStream(join(process.cwd(), "data", "reference", "nces_ccd_lea_directory_2025_26.csv"), { encoding: "utf8" });
  try {
    let names: string[] = [];
    for await (const text of createInterface({ input: file, crlfDelay: Infinity })) {
      if (!header) { header = text; names = csvCells(header); continue; }
      const id = text.slice(0, text.indexOf(","));
      if (!ids.has(id)) continue;
      const cells = csvCells(text);
      rows.set(id, { address: NCES_ADDRESS.map(field => cells[names.indexOf(field)]?.trim()).filter(Boolean).join(", "), row: text,
        written: csvWritten(header, text, NCES_ADDRESS[0], NCES_ADDRESS[5]) });
      if (rows.size === ids.size) break;
    }
  } finally { file.destroy(); }
  return { header, rows };
}

/** The NCES file as the publisher last confirmed it, carrying the rows we hold when it is the file we keep. Without a check there is no copy. */
async function ncesCopy(input: OfficeFactsInput, url: string, rows: string): Promise<SavedCopy | null> {
  const check = await readReleaseCheck(input.vault, { sourceId: "nces-ccd", releaseId: url.split("/").at(-1)!, url });
  return !check ? null : input.facts.transaction(query => saveReleaseCopy(query, { name: "nces-ccd-directory", url, sha256: check.sha256,
    checkedAt: check.checkedAt, text: check.sha256 === HELD_NCES_SHA256 ? rows : "" }));
}

/** Saved directory fields, issuing-board letterheads and the government's own contact pages become ordinary contact facts. */
export async function publishHeldOfficeFacts(input: OfficeFactsInput): Promise<{
  published: number; confirmed: number; blanks: number; failures: readonly string[];
}> {
  const report = { published: 0, confirmed: 0, blanks: 0, failures: [] as string[] };
  const checkedNow=()=>new Date(Math.max(Date.parse(input.now),input.clock?.()??Date.now()));
  if (!input.bodyIds.length) return report;
  const targets = await input.facts.query(OFFICE_FACT_TARGETS_SQL, [[...new Set(input.bodyIds)]]);
  let heldNces: Awaited<ReturnType<typeof heldNcesOfficeRows>> = { header: "", rows: new Map() };
  try { heldNces = await heldNcesOfficeRows(targets); }
  catch (error) { report.failures.push(`Held NCES office rows could not be read: ${error instanceof Error ? error.message : String(error)}`); }
  const known = new Set<string>(), processed = new Set<string>(), unchecked = new Set<string>();
  const entityIds = [...new Set(targets.flatMap(row => [String(row.id), ...(row.government_id ? [String(row.government_id)] : [])]))];
  const values = await input.facts.query("SELECT entity_id,value#>>'{}' AS address,(SELECT fetched_at FROM source_copy WHERE id=f.source_copy_id) AS fetched_at,produced_by,quote_start IS NULL AS unchecked FROM checked_fact f WHERE field='office_address' AND status='live' AND entity_id=ANY($1::text[])",
    [entityIds]);
  const capturedAt = new Map(values.map(row => [String(row.entity_id), Date.parse(String(row.fetched_at))]));
  const knownAddress = new Map(values.map(row => [String(row.entity_id), row.address]));
  for (const row of values) {
    if (typeof row.address === "string" && streetOfficeAddress(row.address)) known.add(String(row.entity_id));
    if (row.unchecked && row.produced_by === "held-office-addresses") unchecked.add(String(row.entity_id));
  }
  const routeOf = (value: unknown,upgrade=true): string | null => {
    if (typeof value !== "string" || !URL.canParse(siteUrl(value))) return null;
    const url = new URL(siteUrl(value));
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    if(upgrade&&url.protocol==="http:")url.protocol="https:";
    url.hash = "";
    return url.href;
  };
  const retries = new Map((await input.facts.query("SELECT entity_id,next_try_at,detail FROM blank WHERE field='office_address' AND entity_id=ANY($1::text[])", [entityIds]))
    .map(row => {let detail:Record<string,unknown>={};try{if(typeof row.detail==="string")detail=JSON.parse(row.detail);}catch{}
      return [String(row.entity_id), { at: Date.parse(String(row.next_try_at)),
        route: routeOf(detail?.sourceUrl??row.detail,false),readerVersion:detail?.readerVersion }];}));
  const captures = new Map<string, Promise<WorkerPublicationCapture | null>>();
  const refused = new Set<string>();
  const unavailable=new Map<string,string>();
  const read = (url: string) => {
    let capture = captures.get(url);
    if (!capture) { capture = input.readCapture?.(url) ?? Promise.resolve(null); captures.set(url, capture); }
    return capture;
  };
  const count = async (id: string, outcome: PublishOutcome) => {
    if ("blank" in outcome) { if (!refused.has(id)) report.blanks++; refused.add(id); return; }
    if (outcome.decision === "PUBLISH") report.published++;
    if (outcome.decision === "CONFIRM") report.confirmed++;
    if (outcome.decision === "PUBLISH" || outcome.decision === "CONFIRM") known.add(id);
    if(outcome.decision==="PUBLISH"){
      // A newly published office makes its existing pin work due, including aliases whose parent is a place.
      const state=targets.find(row=>row.id===id||row.government_id===id)?.state;
      await input.facts.query(`WITH owners AS MATERIALIZED (
        SELECT reader_payload_value(r.value) AS g FROM civic_data_rows r
          JOIN civic_data_promotions p ON p.key=r.promotion_key AND p.current_version_id=r.version_id
        WHERE r.record_class='REGISTRATION' AND r.collection='governments' AND r.state=$2
          AND r.promotion_key='REGISTRATION:US-'||$2::text||':registration:v1' AND r.aliases @> ARRAY[$1::text]
      ), bodies AS MATERIALIZED (
        SELECT e.id FROM entity e WHERE e.kind='body' AND e.state=$2 AND (e.id=$1 OR e.parent_id=$1
          OR split_part(e.id,'#',1)=$1 OR EXISTS(SELECT 1 FROM owners o
            WHERE o.g->>'id'=e.parent_id OR o.g->>'jurisdictionId'=e.parent_id
              OR o.g->'aliases' ? e.parent_id OR o.g->'aliases' ? e.id OR o.g->'bodyIds' ? e.id
              OR o.g->'aliases' ? (e.parent_id||'#governing') OR o.g->'aliases' ? (e.parent_id||'#board')))
      ) UPDATE blank b SET next_try_at=least(b.next_try_at,$3::timestamptz)
      WHERE b.field='map_pin' AND b.next_try_at>$3::timestamptz AND EXISTS(SELECT 1 FROM entity m JOIN bodies o ON o.id=m.parent_id WHERE m.id=b.entity_id)`,
      [id,String(state),input.now]);
    }
  };
  const publish = async (id: string, address: string, source: RegistryProvenance, structured: boolean, ncesId?: string,
    printedQuote?: string, savedSource?: NonNullable<MeetingPinBody["officeContact"]>["savedSource"]) => {
    if (!streetOfficeAddress(address) || !source.sourceUrl) return;
    const entity = await readCheckEntity(input.facts.query, id);
    if (!entity) return;
    if (structured && ncesSource(source.sourceUrl)) {
      // The row quoted is the file's own, and its address as written stands for the one registered when they agree.
      const held = ncesId === undefined ? undefined : heldNces.rows.get(ncesId);
      const copy = await ncesCopy(input, source.sourceUrl, [heldNces.header, ...[...heldNces.rows.values()].map(row => row.row)].join("\n"));
      if (copy) {
        const outcome = await publishLoaded(input.facts, { entity, field: "office_address", fieldKind: "contact", value: address,
          valueText: address, quote: address, provenance: "OFFICIAL", copy, producedBy: "held-office-addresses", costUsd: 0 },
        () => copy.text && held?.written && held.address === address ? { quote: held.row, valueText: held.written } : null, input.clocks, checkedNow());
        await count(id, "refused" in outcome ? { blank: outcome.refused } : outcome);
        return;
      }
    }
    if (savedSource?.versionId && /^[a-f0-9]{64}$/.test(savedSource.sha256) && savedSource.text && printedQuote?.trim()) {
      const held = pageCopy({ finalUrl: source.sourceUrl, body: savedSource.text, contentType: "text/plain", fetchedAt: source.collectedAt });
      const copyId = await input.facts.transaction(query => saveSourceReference(query, { key: `civic-data:${savedSource.versionId}:agenda:${savedSource.sha256}`,
        url: source.sourceUrl!, finalUrl: source.sourceUrl!, fetchedAt: source.collectedAt, httpStatus: null, contentHash: savedSource.sha256 }));
      await count(id, await publishClaim(input.facts, { entity, field: "office_address", fieldKind: "contact", value: address,
        valueText: printedQuote, quote: printedQuote, provenance: isOfficialUrl(source.sourceUrl, entity.hosts) ? "OFFICIAL" : "REFERENCE",
        acquisition: "walker", copy: { ...held, id: copyId }, producedBy: "held-office-addresses", costUsd: 0 }, input.clocks, checkedNow()));
      return;
    }
    // Calendar acquisition belongs to its source worker; only an already saved header can prove this citation here.
    if(/(?:^|[\/?&_.=-])(?:icalendar|calendar|events?|feeds?|rss|ical)(?:[\/?&_.=-]|$)|\.ics(?:\?|$)|webapi\.legistar\.com/i.test(source.sourceUrl))return;
    if(!input.readCapture)return;
    let capture:WorkerPublicationCapture|null;
    try{capture=await read(source.sourceUrl);}catch(error){
      const detail=error instanceof Error?error.message:String(error);unavailable.set(id,detail);report.failures.push(`${id}: ${detail}`);return;
    }
    if (!capture || capture.partial || capture.transport !== "REACHABLE" || capture.httpStatus === null || capture.httpStatus < 200 || capture.httpStatus >= 300){
      unavailable.set(id,`No usable saved source at ${source.sourceUrl}`);return;
    }
    const copy = await input.facts.transaction(query => saveCaptureCopy(query, capture));
    await count(id, await publishClaim(input.facts, { entity, field: "office_address", fieldKind: "contact", value: address,
      valueText: printedQuote ?? address, quote: printedQuote ?? address, provenance: captureProvenance(capture, entity.hosts), acquisition: "walker", copy,
      producedBy: "held-office-addresses", costUsd: 0 }, input.clocks, checkedNow()));
  };
  const fromSite = async (id: string, homepage: unknown, state: string) => {
    if (typeof homepage !== "string" || !URL.canParse(homepage) || !input.readCapture || !input.more()) return;
    const entity = await readCheckEntity(input.facts.query, id);
    if (!entity || !isOwnUrl(homepage, entity.hosts)) return;
    const original=new URL(homepage).href,home=routeOf(homepage)!;
    const queue = [...new Set([home,original])], visited = new Set<string>();
    let reached=false,failed=false,lastFailure="The source could not be read";
    while (queue.length && input.more() && !known.has(id)) {
      const url = queue.shift()!;
      if (visited.has(url)) continue;
      visited.add(url);
      let capture:WorkerPublicationCapture|null;
      try{capture=await read(url);}catch(error){failed=true;lastFailure=error instanceof Error?error.message:String(error);continue;}
      if (!capture || capture.partial || capture.transport !== "REACHABLE" || capture.httpStatus === null || capture.httpStatus < 200 || capture.httpStatus >= 300){
        failed=true;lastFailure=`No usable saved source at ${url}`;continue;
      }
      const challenge=challengeIn(capture.evidence.text);
      if(challenge){failed=true;lastFailure=`${challenge} at ${url}`;continue;}
      reached=true;
      if(url===original&&original!==home)failed=false;
      if(url===home&&original!==home){const fallback=queue.indexOf(original);if(fallback>=0)queue.splice(fallback,1);}
      const addresses = officeAddressesOnPage(capture.evidence.text, state,entity.fullName);
      // Multiple office addresses need the existing detective work; a branch office is never picked by order on the page.
      if (addresses.length === 1) {
        const copy = await input.facts.transaction(query => saveCaptureCopy(query, capture));
        await count(id, await publishClaim(input.facts, { entity, field: "office_address", fieldKind: "contact", value: addresses[0]!.address,
          valueText: addresses[0]!.address, quote: addresses[0]!.quote, provenance: captureProvenance(capture, entity.hosts),
          acquisition: "walker", copy, producedBy: "held-office-addresses", costUsd: 0 }, input.clocks, checkedNow()));
      }
      if (url !== home&&url!==original) continue;
      const base=URL.canParse(capture.evidence.canonicalUrl)?new URL(capture.evidence.canonicalUrl):new URL(url);
      for (const link of capture.evidence.text.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
        if (!/contact|directions|office\s+location/i.test(`${link[1]} ${visibleText(link[2]!)}`)) continue;
        const target = URL.canParse(link[1]!, base) ? new URL(link[1]!, base) : null;
        if (target && ["http:", "https:"].includes(target.protocol) && target.host === base.host && !/\.(?:pdf|zip|ics)$/i.test(target.pathname)) {
          if(base.protocol==="https:"&&target.protocol==="http:")target.protocol="https:";
          target.hash = ""; if (!visited.has(target.href)) queue.push(target.href);
        }
      }
    }
    if((!reached||failed)&&!known.has(id))unavailable.set(id,lastFailure);
  };
  for (const row of targets) {
    if (!input.more()) break;
    const bodyId = String(row.id), governmentId = typeof row.government_id === "string" ? row.government_id : null;
    for (const [id, homepage, body] of [[bodyId, row.body_homepage, input.offices?.get(bodyId)],
      ...(governmentId ? [[governmentId, row.government_homepage, null] as const] : [])] as const) {
      const source = row.registration_source as RegistryProvenance | undefined;
      const newerOffice = id === governmentId && source && row.registration_address !== knownAddress.get(id)
        && Date.parse(source.collectedAt) > (capturedAt.get(id) ?? -Infinity);
      if (processed.has(id) || known.has(id) && !newerOffice && !unchecked.has(id)) continue;
      processed.add(id);
      try {
        const retry = retries.get(id), route = routeOf(homepage);
        const due = (retry?.at ?? 0) <= Date.parse(input.now) || route !== null && (route !== retry?.route||retry?.readerVersion!==OFFICE_READER_VERSION);
        if (id === governmentId && typeof row.registration_address === "string" && row.registration_source)
          await publish(id, row.registration_address, row.registration_source as RegistryProvenance, true,
            typeof row.nces_leaid === "string" ? row.nces_leaid : undefined);
        if (id === governmentId && !known.has(id)) {
          const office = input.offices?.get(bodyId);
          for (const candidate of [office?.governmentOffice, ...office?.governmentOfficeAlternatives ?? []]) {
            if (!candidate || known.has(id)) continue;
            await publish(id, candidate.address, candidate.provenance, false,undefined,candidate.quote);
          }
        }
        if (!known.has(id) && body?.officeContact?.address)
          await publish(id, body.officeContact.address, body.officeContact.provenance, false, undefined,
            body.officeContact.quote, body.officeContact.savedSource);
        if (!known.has(id) && due) await fromSite(id, homepage, String(row.state));
        if (!known.has(id) && due && !refused.has(id)) {
          await openBlank(input.facts.query, { entityId: id, field: "office_address", stage: "ACQUIRE",
            reason: unavailable.has(id)?"OFFICE_SOURCE_UNAVAILABLE":"STREET_OFFICE_ADDRESS_NOT_FOUND",
            detail: JSON.stringify({sourceUrl:route,readerVersion:OFFICE_READER_VERSION}),
            retryMinutes: input.clocks.retryMinutes("contact") });
          report.blanks++;
          if(unavailable.has(id))report.failures.push(`${id}: ${unavailable.get(id)}`);
        }
      } catch (error) { report.failures.push(`${id}: ${error instanceof Error ? error.message : String(error)}`); }
    }
  }
  return report;
}
