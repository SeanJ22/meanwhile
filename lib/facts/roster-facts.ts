import type { WorkerPublicationCapture } from "../civic-data/worker-roster-publication.ts";
import type { Provenance as FieldSource } from "../sources/types.ts";
import { boundedIndexOf, normalizeText, type CheckEntity, type FieldKind, type SavedCopy } from "./check.ts";
import { captureProvenance } from "./capture.ts";
import { ensureEntity, resolvePerson } from "./entities.ts";
import { readCheckEntity } from "./entity-read.ts";
import { openBlank, publishClaim, type Clocks, type FactDb, type PublishOutcome } from "./publish.ts";
import { saveCaptureCopy } from "./source-copy.ts";
import { governingBodyNameOn } from "./body-name.ts";
import { invalidateReaderCache, readerCacheScopeForPublication, withBatchedReaderInvalidation, type ReaderCachePurger } from "../reader/cache.ts";

const rosterCopies = new WeakMap<FactDb, WeakMap<WorkerPublicationCapture, Promise<SavedCopy>>>();

async function rosterCopy(db: FactDb, capture: WorkerPublicationCapture): Promise<SavedCopy> {
  let pages = rosterCopies.get(db);
  if (!pages) { pages = new WeakMap(); rosterCopies.set(db, pages); }
  let copy = pages.get(capture);
  if (!copy) {
    copy = db.transaction(query => saveCaptureCopy(query, capture));
    pages.set(capture, copy);
    void copy.catch(() => pages.delete(capture));
  }
  return copy;
}

export interface RosterMember {
  readonly recordId: string;
  readonly fields: Readonly<Record<string, unknown>>;
  readonly externalIds?: readonly (readonly [string, string])[];
  readonly fieldSources?: Readonly<Record<string, FieldSource>>;
}

interface RosterFactsInput {
  readonly body: { readonly id: string; readonly name: string | null; readonly state: string | null; readonly parentId: string | null };
  readonly capture: WorkerPublicationCapture;
  readonly members: readonly RosterMember[];
  /** Every member row on the page was read, so a member it no longer lists has left. */
  readonly complete: boolean;
  readonly producedBy: string;
  readonly purge?: ReaderCachePurger;
  /** False when the caller publishes the body's name itself from this page. */
  readonly nameFromPage?: boolean;
  /** Member ids already shown to readers, kept so links to them still resolve. */
  readonly shownMemberIds?: ReadonlyMap<string, string>;
}

export interface RosterFactsReport {
  readonly live: number;
  readonly confirmed: number;
  readonly held: number;
  readonly blanks: number;
  readonly departed: number;
  /** The permanent person id each read member row resolved to. */
  readonly people: ReadonlyMap<string, string>;
  /** Each member row's first outcome for each of its fields (`name` is the seat itself). */
  readonly outcomes: ReadonlyMap<string, ReadonlyMap<string, PublishOutcome>>;
}

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);
export const nameKey = (name: string) => name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const NAVIGATION = new Set(["contact us", "contact information", "staff directory", "email us", "town hall", "member name"]);
/** A single word ("Actions", "Menu") or a navigation label is page furniture, never an officeholder's name. */
const personName = (name: string) => /\s/.test(name.trim()) && !NAVIGATION.has(name.trim().toLowerCase().replace(/\s+/g, " "));

const CONTACTS = [["email", "email"], ["phone", "phone"], ["websiteUrl", "website"]] as const;
const TERMS = [["termNote", "term_note"], ["termStart", "term_start"], ["termEnd", "term_end"]] as const;

/** Any other body keeps the name it was registered under when its own page writes it. */
function bodyNameAsGiven(pageText: string, name: string): { readonly name: string; readonly quote: string } | null {
  const text = normalizeText(pageText), at = boundedIndexOf(text.toLowerCase(), normalizeText(name).toLowerCase());
  if (at === -1 || name.length < 6) return null;
  return { name: text.slice(at, at + normalizeText(name).length), quote: text.slice(Math.max(0, at - 60), Math.min(text.length, at + name.length + 60)).trim() };
}

/** A governing board with no verified name takes the one its own saved page writes for it; a page that does not name it leaves the name open. */
export async function publishBodyNameFromPage(db: FactDb & { readonly query: (text: string, params?: readonly unknown[]) => Promise<readonly Record<string, unknown>[]> },
  input: { readonly entity: CheckEntity; readonly copy: SavedCopy; readonly provenance: ReturnType<typeof captureProvenance>; readonly producedBy: string; readonly purge?: ReaderCachePurger },
  clocks: Clocks, now: Date): Promise<PublishOutcome | null> {
  if ((await db.query("SELECT 1 FROM fact WHERE entity_id = $1 AND field = 'name' AND status = 'live' LIMIT 1", [input.entity.id])).length) return null;
  const found = governingBodyNameOn(input.copy.text, input.entity.id) ?? bodyNameAsGiven(input.copy.text, input.entity.fullName);
  if (!found) return null;
  return publishClaim(db, { entity: input.entity, field: "name", fieldKind: "officeholder", provenance: input.provenance, value: found.name, valueText: found.name,
    quote: found.quote, copy: input.copy, producedBy: input.producedBy, costUsd: 0 }, clocks, now, { purge: input.purge });
}

/** One saved roster page becomes facts, each on its own: who sits on the body, their title, contacts and term. */
export async function publishRosterFacts(db: FactDb & { readonly query: (text: string, params?: readonly unknown[]) => Promise<readonly Record<string, unknown>[]> },
  input: RosterFactsInput, clocks: Clocks, now: Date): Promise<RosterFactsReport> {
  return withBatchedReaderInvalidation(purge => publishRosterFields(db, { ...input, purge }, clocks, now), input.purge);
}

async function publishRosterFields(db: FactDb & { readonly query: (text: string, params?: readonly unknown[]) => Promise<readonly Record<string, unknown>[]> },
  input: RosterFactsInput, clocks: Clocks, now: Date): Promise<RosterFactsReport> {
  const { capture } = input;
  const bodyId = await ensureEntity(db.query, { id: input.body.id, kind: "body", name: input.body.name ?? input.body.id, state: input.body.state, parentId: input.body.parentId });
  const [held] = bodyId !== input.body.id ? await db.query("SELECT name, state, parent_id FROM entity WHERE id = $1", [bodyId]) : [];
  const body = held ? { id: bodyId, name: String(held.name), state: held.state as string | null, parentId: held.parent_id as string | null } : input.body;
  const bodyEntity = (await readCheckEntity(db.query, bodyId))!;
  const copy = await rosterCopy(db, capture);
  const provenance = captureProvenance(capture, bodyEntity.hosts);
  const tally = { live: 0, confirmed: 0, held: 0, blanks: 0, departed: 0, people: new Map<string, string>(), outcomes: new Map<string, Map<string, PublishOutcome>>() };
  const count = (outcome: PublishOutcome, recordId?: string, field?: string) => {
    if (recordId && field) {
      const own = tally.outcomes.get(recordId) ?? new Map<string, PublishOutcome>();
      if (!own.has(field)) own.set(field, outcome);
      tally.outcomes.set(recordId, own);
    }
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
      const reason = name ? "NAME_NOT_A_PERSON" : "NAME_NOT_READ";
      await openBlank(db.query, { entityId: body.id, field: `member-row:${member.recordId}`, stage: "READ", reason,
        detail: capture.evidence.canonicalUrl, retryMinutes: clocks.retryMinutes("officeholder") });
      count({ blank: reason }, member.recordId, "name");
      continue;
    }
    const personId = await resolvePerson(db, { name, state: body.state, placeId: place ?? body.parentId,
      externalIds: [...(member.externalIds ?? []), ["roster-name:" + body.id, nameKey(name)],
        ...(body.id !== input.body.id ? [["roster-name:" + input.body.id, nameKey(name)] as const] : []),
        ...(input.shownMemberIds?.has(nameKey(name)) ? [["roster-member", input.shownMemberIds.get(nameKey(name))!] as const] : [])] });
    seated.add(personId);
    tally.people.set(member.recordId, personId);
    const person: CheckEntity = { id: personId, fullName: written, stateName: null, hosts: bodyEntity.hosts, externalIds: [] };
    const claim = async (entity: CheckEntity, field: string, fieldKind: FieldKind, value: unknown, valueText: string, sourceField: string) => {
      const quote = member.fieldSources?.[sourceField]?.quote ?? valueText;
      count(await publishClaim(db, { entity, field, fieldKind, provenance, value, valueText, quote, copy, producedBy: input.producedBy, costUsd: 0 }, clocks, now, { purge: input.purge }),
        member.recordId, sourceField);
    };
    await claim(bodyEntity, `member:${personId}`, "officeholder", { name, office }, written, "name");
    await claim(person, "name", "officeholder", name, written, "name");
    if (office) await claim(person, `office:${body.id}`, "officeholder", office, office, "office");
    if (member.fields.contactKind !== "PERSONAL") for (const [from, field] of CONTACTS) {
      const value = text(member.fields[from]);
      if (value) await claim(person, field, "contact", value, value, from);
    }
    for (const [from, field] of TERMS) {
      const value = text(member.fields[from]);
      const quote = member.fieldSources?.[from]?.quote;
      if (!value || (from !== "termNote" && !quote)) continue;
      if (from !== "termNote" && boundedIndexOf(normalizeText(quote!).toLowerCase(), normalizeText(written).toLowerCase()) === -1) {
        await openBlank(db.query, { entityId: personId, field: `${field}:${body.id}`, stage: "CHECK", reason: "TERM_QUOTE_NOT_ABOUT_MEMBER",
          detail: quote!, retryMinutes: clocks.retryMinutes("officeholder") });
        count({ blank: "TERM_QUOTE_NOT_ABOUT_MEMBER" }, member.recordId, from);
        continue;
      }
      await claim(person, `${field}:${body.id}`, "officeholder", value, from === "termNote" ? value : quote!, from);
    }
  }
  if (input.complete && provenance === "OFFICIAL" && seated.size) {
    const gone = await db.transaction(query => query(`UPDATE fact f SET status = 'superseded', held_reason = 'NOT_ON_CURRENT_OFFICIAL_ROSTER'
      FROM source_copy s WHERE s.id = f.source_copy_id AND s.url = $2 AND f.entity_id = $1 AND f.status = 'live'
        AND f.field LIKE 'member:%' AND NOT (substr(f.field, 8) = ANY($3::text[])) RETURNING f.id`,
    [body.id, capture.evidence.canonicalUrl, [...seated]]));
    tally.departed = gone.length;
    if (gone.length) await invalidateReaderCache(readerCacheScopeForPublication(body.state ?? body.id), input.purge);
  }
  if ((tally.live || tally.confirmed) && input.nameFromPage !== false) await publishBodyNameFromPage(db, { entity: bodyEntity, copy, provenance, producedBy: input.producedBy, purge: input.purge }, clocks, now);
  return tally;
}

/** Facts about a body itself (its name, schedule, agenda link, office address and phone), each in the page's own words. */
export async function publishBodyFacts(db: FactDb & { readonly query: (text: string, params?: readonly unknown[]) => Promise<readonly Record<string, unknown>[]> },
  input: { readonly bodyId: string; readonly capture: WorkerPublicationCapture; readonly producedBy: string;
    readonly purge?: ReaderCachePurger;
    readonly facts: readonly { readonly field: "name" | "meeting_cadence" | "agenda_url" | "office_address" | "office_phone"; readonly value: string; readonly quote: string }[] },
  clocks: Clocks, now: Date): Promise<readonly PublishOutcome[]> {
  return withBatchedReaderInvalidation(async purge => {
    const entity = await readCheckEntity(db.query, input.bodyId);
    if (!entity || !input.facts.length) return [];
    const copy = await rosterCopy(db, input.capture);
    const provenance = captureProvenance(input.capture, entity.hosts);
    const out: PublishOutcome[] = [];
    for (const { field, value, quote } of input.facts) {
      out.push(await publishClaim(db, { entity, field, fieldKind: field === "name" ? "officeholder" : field.startsWith("office_") ? "contact" : "meeting", provenance, value, valueText: quote, quote, copy,
        producedBy: input.producedBy, costUsd: 0 }, clocks, now, { purge }));
    }
    if (!input.facts.some(row => row.field === "name")) await publishBodyNameFromPage(db, { entity, copy, provenance, producedBy: input.producedBy, purge }, clocks, now);
    return out;
  }, input.purge);
}
