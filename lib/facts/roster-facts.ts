import type { WorkerPublicationCapture } from "../civic-data/worker-roster-publication.ts";
import type { Provenance as FieldSource } from "../sources/types.ts";
import { hostOf, isOfficialHost, type CheckEntity, type FieldKind, type Provenance } from "./check.ts";
import { ensureEntity, resolvePerson } from "./entities.ts";
import { readCheckEntity } from "./entity-read.ts";
import { openBlank, publishClaim, type Clocks, type FactDb, type PublishOutcome } from "./publish.ts";
import { saveCaptureCopy } from "./source-copy.ts";

export interface RosterMember {
  readonly recordId: string;
  readonly fields: Readonly<Record<string, unknown>>;
  readonly fieldSources?: Readonly<Record<string, FieldSource>>;
}

export interface RosterFactsInput {
  readonly body: { readonly id: string; readonly name: string | null; readonly state: string | null; readonly parentId: string | null };
  readonly capture: WorkerPublicationCapture;
  readonly members: readonly RosterMember[];
  /** Every member row on the page was read, so a member it no longer lists has left. */
  readonly complete: boolean;
  readonly producedBy: string;
  /** Member ids already shown to readers, kept so links to them still resolve. */
  readonly legacyMemberIds?: ReadonlyMap<string, string>;
}

export interface RosterFactsReport {
  readonly live: number;
  readonly confirmed: number;
  readonly held: number;
  readonly blanks: number;
  readonly departed: number;
}

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);
export const nameKey = (name: string) => name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const NAVIGATION = new Set(["contact us", "contact information", "staff directory", "email us", "town hall", "member name"]);
/** A single word ("Actions", "Menu") or a navigation label is page furniture, never an officeholder's name. */
const personName = (name: string) => /\s/.test(name.trim()) && !NAVIGATION.has(name.trim().toLowerCase().replace(/\s+/g, " "));

const CONTACTS = [["email", "email"], ["phone", "phone"], ["websiteUrl", "website"]] as const;
const TERMS = [["termNote", "term_note"], ["termStart", "term_start"], ["termEnd", "term_end"]] as const;

/** One saved roster page becomes facts, each on its own: who sits on the body, their title, contacts and term. */
export async function publishRosterFacts(db: FactDb & { readonly query: (text: string, params?: readonly unknown[]) => Promise<readonly Record<string, unknown>[]> },
  input: RosterFactsInput, clocks: Clocks, now: Date): Promise<RosterFactsReport> {
  const { body, capture } = input;
  await ensureEntity(db.query, { id: body.id, kind: "body", name: body.name ?? body.id, state: body.state, parentId: body.parentId });
  const bodyEntity = (await readCheckEntity(db.query, body.id))!;
  const copy = await db.transaction(query => saveCaptureCopy(query, capture));
  const provenance: Provenance = isOfficialHost(hostOf(capture.evidence.canonicalUrl), bodyEntity.hosts) ? "OFFICIAL"
    : capture.campaign ? "CAMPAIGN" : "REFERENCE";
  const tally = { live: 0, confirmed: 0, held: 0, blanks: 0, departed: 0 };
  const count = (outcome: PublishOutcome) => {
    if ("blank" in outcome) tally.blanks++;
    else if (outcome.decision === "PUBLISH") tally.live++;
    else if (outcome.decision === "CONFIRM") tally.confirmed++;
    else tally.held++;
  };
  const place = (await db.query("SELECT place_id FROM entity_place WHERE entity_id = $1 LIMIT 1", [body.id]))[0]?.place_id as string | undefined;
  const seated = new Set<string>();
  for (const member of input.members) {
    const name = text(member.fields.name), written = text(member.fields.nameAsWritten) ?? name, office = text(member.fields.office);
    if (!name || !written || !personName(name)) {
      await openBlank(db.query, { entityId: body.id, field: `member-row:${member.recordId}`, stage: "READ", reason: name ? "NAME_NOT_A_PERSON" : "NAME_NOT_READ",
        detail: capture.evidence.canonicalUrl, retryMinutes: clocks.retryMinutes("officeholder") });
      tally.blanks++;
      continue;
    }
    const native = text(member.fields.id);
    const personId = await resolvePerson(db, { name, state: body.state, placeId: place ?? body.parentId,
      externalIds: [["roster-name:" + body.id, nameKey(name)], ...(native ? [["roster-native:" + capture.evidence.canonicalUrl, native] as const] : []),
        ...(input.legacyMemberIds?.has(nameKey(name)) ? [["roster-member", input.legacyMemberIds.get(nameKey(name))!] as const] : [])] });
    seated.add(personId);
    const person: CheckEntity = { id: personId, fullName: written, stateName: null, hosts: bodyEntity.hosts, externalIds: [] };
    const claim = (entity: CheckEntity, field: string, fieldKind: FieldKind, value: unknown, valueText: string, sourceField: string) => {
      const quote = member.fieldSources?.[sourceField]?.quote ?? valueText;
      return publishClaim(db, { entity, field, fieldKind, provenance, value, valueText, quote, copy, producedBy: input.producedBy, costUsd: 0 }, clocks, now);
    };
    count(await claim(bodyEntity, `member:${personId}`, "officeholder", { name, office }, written, "name"));
    count(await claim(person, "name", "officeholder", name, written, "name"));
    if (office) count(await claim(person, `office:${body.id}`, "officeholder", office, office, "office"));
    if (member.fields.contactKind !== "PERSONAL") for (const [from, field] of CONTACTS) {
      const value = text(member.fields[from]);
      if (value) count(await claim(person, field, "contact", value, value, from));
    }
    for (const [from, field] of TERMS) {
      const value = text(member.fields[from]);
      const quote = member.fieldSources?.[from]?.quote;
      if (value && (from === "termNote" || quote)) count(await claim(person, `${field}:${body.id}`, "officeholder", value, from === "termNote" ? value : quote!, from));
    }
  }
  if (input.complete && provenance === "OFFICIAL" && seated.size) {
    const gone = await db.transaction(query => query(`UPDATE fact f SET status = 'superseded', held_reason = 'NOT_ON_CURRENT_OFFICIAL_ROSTER'
      FROM source_copy s WHERE s.id = f.source_copy_id AND s.url = $2 AND f.entity_id = $1 AND f.status = 'live'
        AND f.field LIKE 'member:%' AND NOT (substr(f.field, 8) = ANY($3::text[])) RETURNING f.id`,
    [body.id, capture.evidence.canonicalUrl, [...seated]]));
    tally.departed = gone.length;
    if (gone.length) await db.query(`INSERT INTO rebuild_queue (place_id) SELECT place_id FROM entity_place WHERE entity_id = $1 ON CONFLICT DO NOTHING`, [body.id]);
  }
  return tally;
}
