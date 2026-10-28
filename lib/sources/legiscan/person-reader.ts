import { keyedReaderPointers } from "../../civic-data/keyed-reader.ts";
import type { Query } from "../../facts/publish.ts";
import type { PromotedEdgeEntry } from "../../civic-data/read-model.ts";
import { peopleIdentityKeysSql, selectedMetadataSql, selectedStateEntry } from "../../reader/selected-entry.ts";
import { personIdentityKeys } from "../../officials/people-identity.ts";
import { joinSponsors, type BillPart, type BillPartPointer, type HeldPerson, type StoredBill } from "./bills.ts";

type BillSponsor=BillPart["sponsors"][number];

export interface PersonBillPart {
  readonly entry: PromotedEdgeEntry;
  /** Full source cardinality, independent of the selected person's bill count. */
  readonly rows: number | null;
}

const pointers=keyedReaderPointers;
const metadata=selectedMetadataSql;
const header="pointer.payload";
const numericDistrict = (value: string) => (value.normalize("NFKD").replace(/\p{M}/gu, "").match(/[0-9]+/g) ?? [])
  .map(part => part.replace(/^0+(?=[0-9])/, "")).join(":");

/** This is a superset of the existing JS name/seat join. Non-ASCII districts are
 * retained so Unicode normalization can never exclude a genuine source match. */
function fallbackSeats(person: HeldPerson): readonly { chamber: string; numbers: string }[] {
  if (!person.name || !person.state || person.level && person.level !== "STATE" ||
      [...personIdentityKeys(person)].some(key => key.startsWith("legiscan:"))) return [];
  return (person.memberships ?? []).flatMap(row => row.current !== false && row.district && (row.chamber ?? person.chamber)
    ? [{ chamber: (row.chamber ?? person.chamber)!, numbers: numericDistrict(row.district) }] : []);
}

/** Select exact sponsor offsets first; only bills using those offsets cross the
 * wire afterward. Both statements use indexed canonical scopes, with the second
 * pinned to the first statement's immutable version. No raw source body is read. */
export async function readPersonBillParts(query: Query, parts: readonly BillPartPointer[], person: HeldPerson): Promise<ReadonlyMap<string, PersonBillPart>> {
  if (!parts.length) return new Map();
  const keys = parts.map(part => `STATE_BILL:${part.scope}`);
  const headers = await query(`WITH pointers AS MATERIALIZED (${pointers})
    SELECT ${metadata},${header} AS payload,
      (SELECT count(*) FROM civic_data_rows r WHERE r.promotion_key=pointer.key AND r.version_id=pointer.current_version_id AND r.collection='rp01.bills') AS full_rows,
      coalesce((SELECT jsonb_agg(jsonb_build_object('index',s.ordinal-1,'value',s.value) ORDER BY s.ordinal)
        FROM civic_data_rows s CROSS JOIN LATERAL (SELECT s.value) sponsor
        WHERE s.promotion_key=pointer.key AND s.version_id=pointer.current_version_id AND s.collection='rp01.sponsors' AND (
        ('legiscan:'||(sponsor.value->>'peopleId'))=ANY($2::text[]) OR ${peopleIdentityKeysSql("sponsor.value")} && $2::text[]
          OR sponsor.value->>'state'=$3 AND EXISTS(SELECT 1 FROM jsonb_to_recordset($4::jsonb) seat(chamber text,numbers text)
            WHERE sponsor.value->>'chamber'=seat.chamber AND
              (octet_length(coalesce(sponsor.value->>'district',''))<>char_length(coalesce(sponsor.value->>'district','')) OR seat.numbers=coalesce((
                SELECT string_agg(coalesce(nullif(ltrim(m.part[1],'0'),''),'0'),':' ORDER BY m.n)
                FROM regexp_matches(normalize(coalesce(sponsor.value->>'district',''),NFKD),'([0-9]+)','g') WITH ORDINALITY m(part,n)),''))))),'[]'::jsonb) AS sponsors
      FROM pointers pointer`,
    [keys, [...personIdentityKeys(person)], person.state?.toUpperCase() ?? null, JSON.stringify(fallbackSeats(person))]);
  const join = joinSponsors([person]), selected = new Map<string, PersonBillPart>();
  const matching: { scope: string; version: string; indices: number[] }[] = [];
  for (const row of headers) {
    const scope = String(row.key).slice("STATE_BILL:".length);
    if (row.published !== true) throw Error("READER_PUBLISHED_POINTER_INVALID");
    const sponsors = row.sponsors as readonly { index: number; value: BillSponsor }[];
    const indices = sponsors.filter(sponsor => join(sponsor.value).officeholderId === person.id).map(sponsor => sponsor.index);
    if (indices.length) matching.push({ scope, version: String(row.current_version_id), indices });
    else selected.set(scope, { entry: selectedStateEntry("STATE_BILL", scope,
      { ...row, payload: { ...row.payload as object, bills: [], sponsors: [] } }), rows: Number(row.full_rows) });
  }
  if (matching.length) {
    const rows = await query(`WITH pointers AS MATERIALIZED (${pointers}),wanted AS (
        SELECT w.scope,w.version,w.indices FROM jsonb_to_recordset($2::jsonb) w(scope text,version text,indices integer[])
      ), bills AS MATERIALIZED (
        SELECT b.promotion_key,b.ordinal,b.value,b.aliases FROM pointers pointer JOIN wanted ON pointer.scope=wanted.scope AND pointer.current_version_id=wanted.version
        JOIN civic_data_rows b ON b.promotion_key=pointer.key AND b.version_id=pointer.current_version_id
          AND b.collection='rp01.bills' AND b.aliases && ARRAY(SELECT 'sponsor:'||i FROM unnest(wanted.indices) i)
      ) SELECT ${metadata},${header} AS payload,
        coalesce((SELECT jsonb_agg(b.value ORDER BY b.ordinal) FROM bills b WHERE b.promotion_key=pointer.key),'[]'::jsonb) AS bills,
        coalesce((SELECT jsonb_agg(jsonb_build_object('index',s.ordinal-1,'value',s.value) ORDER BY s.ordinal)
          FROM civic_data_rows s WHERE s.promotion_key=pointer.key AND s.version_id=pointer.current_version_id
            AND s.collection='rp01.sponsors' AND EXISTS(SELECT 1 FROM bills b WHERE b.promotion_key=s.promotion_key
              AND b.aliases @> ARRAY['sponsor:'||(s.ordinal-1)])),'[]'::jsonb) AS sponsors
        FROM pointers pointer JOIN wanted ON pointer.scope=wanted.scope AND pointer.current_version_id=wanted.version`,
      [matching.map(part=>`STATE_BILL:${part.scope}`), JSON.stringify(matching)]);
    const byKey = new Map(rows.map(row => [String(row.key), row]));
    for (const match of matching) {
      const row = byKey.get(`STATE_BILL:${match.scope}`);
      if (!row) { selected.set(match.scope, { entry: { kind: "NOT_RECORDED", recordClass: "STATE_BILL", scope: match.scope }, rows: null }); continue; }
      const sponsors = row.sponsors as readonly { index: number; value: BillSponsor }[];
      const offsets = new Map(sponsors.map((sponsor, index) => [sponsor.index, index]));
      const bills = (row.bills as StoredBill[]).map(bill => ({ ...bill, sponsorRefs: bill.sponsorRefs.map(index => {
        const offset = offsets.get(index); if (offset === undefined) throw Error("LEGISCAN_SPONSOR_REFERENCE_INVALID"); return offset;
      }) }));
      const payload = { ...row.payload as BillPart, bills, sponsors: sponsors.map(sponsor => sponsor.value) };
      selected.set(match.scope, { entry: selectedStateEntry("STATE_BILL", match.scope, { ...row, payload }),
        rows: Number(headers.find(header => header.key === row.key)!.full_rows) });
    }
  }
  for (const part of parts) if (!selected.has(part.scope)) selected.set(part.scope,
    { entry: { kind: "NOT_RECORDED", recordClass: "STATE_BILL", scope: part.scope }, rows: null });
  return selected;
}
