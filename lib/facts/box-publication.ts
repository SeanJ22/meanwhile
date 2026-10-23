import { findingFact, finishBoxFinding, holdBoxFinding, otherSources, PUBLISHER, reopenBoxFinding, takeBoxFinding, type BoxFinding, type BoxOrigin } from "../control-plane/box.ts";
import type { EvidenceStore } from "../control-plane/evidence/store.ts";
import type { ControlPlaneRepositories } from "../control-plane/repository/types.ts";
import { datesInQuote, electionFieldId, publishElectionFields } from "../civic-data/election-field-publication.ts";
import type { ElectionFieldInput, ElectionFieldKind } from "../civic-data/election-fields.ts";
import type { RoutineDataStore } from "../civic-data/store.ts";
import { heldCaptureReader } from "../civic-data/worker-publication-context.ts";
import { section3Record } from "../control-plane/promotion/section3.ts";
import type { WorkerPublicationCapture } from "../civic-data/worker-roster-publication.ts";
import type { ProbeFetch } from "../doors/probe.ts";
import { captureProvenance, fetchCapture } from "./capture.ts";
import { boundedIndexOf, checkFact, linkQuote, normalizeText, type FieldKind } from "./check.ts";
import { looksLikeNameCell, splitPersonTitle } from "../hunt/roster-page.ts";
import { isPlainSentence, OTHER_NOTICE, schedulePhrase } from "../hunt/page-rules.ts";
import { readPassCursor, writePassCursor } from "./db.ts";
import { bodyNamed, canonicalSubject, ensureGoverningBody, learnOfficialHost, officeNamed, splitSubject } from "./entities.ts";
import { readCheckEntity } from "./entity-read.ts";
import { CAMPAIGN_SITE_LEAD, CANDIDATE_PROFILE_LEAD, FINDING_SLOT_VERSIONS, otherOffice, COMMENT_SUMMARY_LEAD, SITE_WALK_LEAD, slotFor, slotVersion, type FindingSlot } from "./finding-slots.ts";
import { openBlank, publishClaim, type Clocks, type FactDb, type PublishOutcome, type Query } from "./publish.ts";
import { nameKey, publishRosterFacts, type RosterMember } from "./roster-facts.ts";
import { meetingEntityId } from "./meeting-read.ts";
import { saveCaptureCopy } from "./source-copy.ts";
import { invalidateReaderCache, readerCacheScopeForEntity, type ReaderCachePurger } from "../reader/cache.ts";
import { seatIn, seatQuoteOnPage, seatTitleIn } from "./seat-evidence.ts";
export { seatIn } from "./seat-evidence.ts";
import { sanitizedErrorDiagnostic } from "../ops/error-diagnostic.ts";
import { runBoundedWorkPool } from "../ops/bounded-work-pool.ts";

interface Finding {
  readonly row: BoxFinding; /** The subject under the one board name: its government's registered id, then its tail. */ readonly subject: string; readonly origin: BoxOrigin; readonly field: string; readonly value: string | number | boolean;
  readonly exactQuote: string; readonly sourceUrl: string; readonly recordClass: string | null;
}

interface BoxPublicationReport {
  readonly looked: number;
  readonly deferred: number;
  readonly published: number;
  /** Published by where each went: the fact store's classes and ballot navigation. */
  readonly publishedByRoute: Readonly<Record<string, number>>;
  /** Handed to the campaign-site chain, the candidate-profile writer or the site walk, which check or read each on their own passes. */
  readonly handed: number;
  readonly refused: number;
  readonly waitingByClass: Readonly<Record<string, number>>;
  readonly failuresByReason: Readonly<Record<string, number>>;
  readonly errorExamples: readonly { readonly findingId: string; readonly stage: string; readonly detail: string }[];
  readonly byPlace: Readonly<Record<string, { published: number; refused: number; waiting: number }>>;
  /** Published seats needing Sean's decision. */
  readonly seats: { readonly flagged: number };
  /** Box facts that read as a label, a heading, a notice or a bare link (flagged for Sean), cut to the part that states the thing, re-filed, or renamed to the name alone. */
  readonly labels: { readonly flagged: number; readonly moved: number; readonly cut: number; readonly renamed: number };
}

/** Audits read what already reached readers; the publication lane calls them separately so they cannot stop waiting facts. */
export async function reviewPublishedBoxFacts(query: Query, purge?: ReaderCachePurger) {
  return { seats: await reviewBoxSeats(query), labels: await reviewBoxFacts(query, purge) };
}

const MEMBER_FIELD = { member_name: "name", member_office: "office", term_note: "termNote", term_start: "termStart", term_end: "termEnd", email: "email", phone: "phone", website: "websiteUrl" } as const;

type Routed = Exclude<FindingSlot, { waiting: string } | { lead: string } | { handoff: string } | { election: string }>;
const kindOf = (slot: Routed): FieldKind => slot.class === "rosters" || slot.class === "bodies" || slot.class === "body links" && slot.slot === "name" ? "officeholder"
  : slot.class === "schedules" || slot.class === "sittings" && slot.slot === "video_url" ? "meeting"
  : slot.class === "meeting routes" || slot.class === "sittings" ? "agenda" : slot.class === "comment rules" ? "comment_rule" : "contact";

export interface Target { readonly body: { id: string; name: string; state: string | null; parentId: string | null }; readonly holder: string | null; readonly entityId: string }

const BODY_SQL = "SELECT id, name, state, parent_id FROM entity WHERE kind = 'body' AND id = $1";
const SITTING_SQL = "SELECT m.id AS meeting_id, m.parent_id AS body_id FROM entity m WHERE m.kind = 'meeting' AND m.id = $1";
// $2 is the board the subject names (`governing` or `board`), or null where it names none.
const GOVERNS = "b.kind = 'body' AND (b.id LIKE '%#governing' OR b.id LIKE '%#board') AND ($2::text IS NULL OR b.id LIKE '%#' || $2::text)";
// Each branch is one index lookup: by parent government, by the place's government, and by id prefix (`#` then `$` in C collation) for a board filed on its place.
const GOVERNING_SQL = `SELECT id, name, state, parent_id FROM (
    SELECT b.id, b.name, b.state, b.parent_id FROM entity b WHERE b.parent_id = $1 AND ${GOVERNS}
    UNION SELECT b.id, b.name, b.state, b.parent_id FROM entity g JOIN entity b ON b.parent_id = g.id WHERE g.parent_id = $1 AND g.kind = 'government' AND ${GOVERNS}
    UNION SELECT b.id, b.name, b.state, b.parent_id FROM entity b WHERE b.id > $1 || '#' AND b.id < $1 || '$' AND ${GOVERNS}
  ) found ORDER BY parent_id = $1 DESC, id LIMIT 1`;
const SEAT_SQL = `SELECT f.entity_id AS body_id, f.value->>'name' AS holder FROM fact f
  WHERE f.entity_id = $1 AND f.status = 'live' AND f.field IN ('member:' || $2,
    (SELECT 'member:' || x.entity_id FROM entity_external_id x WHERE x.scheme = 'roster-member' AND x.value = $3)) LIMIT 1`;

const bodyRow = (row: Record<string, unknown> | undefined) =>
  row ? { id: String(row.id), name: String(row.name), state: row.state as string | null, parentId: row.parent_id as string | null } : null;

/** What a finding's subject stands for: a body, a body's calendar, a sitting, a seat's body and holder, or a place's or government's board, found by its parent government. */
async function targetOf(query: Query, subjectId: string): Promise<Target | null> {
  if (subjectId.includes("#inventory:")) return null;
  const own = bodyRow((await query(BODY_SQL, [subjectId.replace(/#calendar$/, "")]))[0]);
  if (own) return { body: own, holder: null, entityId: own.id };
  const [sitting] = await query(SITTING_SQL, [meetingEntityId(subjectId)]);
  if (sitting) {
    const body = bodyRow((await query(BODY_SQL, [String(sitting.body_id)]))[0]);
    return body ? { body, holder: null, entityId: String(sitting.meeting_id) } : null;
  }
  const cut = subjectId.lastIndexOf("#");
  const [seat] = subjectId.startsWith("roster:") && cut > 7 ? await query(SEAT_SQL, [subjectId.slice(7, cut), subjectId.slice(cut + 1), subjectId]) : [];
  if (seat) {
    const body = bodyRow((await query(BODY_SQL, [String(seat.body_id)]))[0]);
    return body ? { body, holder: seat.holder === null ? null : String(seat.holder), entityId: body.id } : null;
  }
  // A committee is found by its own name or not at all; the council is never its stand-in.
  const { root, tail } = splitSubject(subjectId);
  if (tail.startsWith("#body:")) return null;
  const governing = bodyRow((await query(GOVERNING_SQL, [root, tail === "#governing" || tail === "#board" ? tail.slice(1) : null]))[0]);
  return governing ? { body: governing, holder: null, entityId: governing.id } : null;
}

/** The board a subject stands for: found by its parent government, or made when its government has none (a committee is never answered with the council). */
export async function boardFor(query: Query, subject: string): Promise<Target | null> {
  const found = await targetOf(query, subject);
  // Only a government, its governing board or its school board makes the board; a committee, an inventory or a sitting is found or not at all.
  if (found || !["", "#governing", "#board"].includes(splitSubject(subject).tail)) return found;
  const made = await ensureGoverningBody(query, subject);
  return made ? { body: made, holder: null, entityId: made.id } : null;
}

const PACKET = "hunt:packet:";
const placeOf = (row: BoxFinding) => row.origins.find(origin => origin.resultKey?.startsWith(PACKET))?.resultKey!.slice(PACKET.length) ?? row.subjectId;

/** These blanks can change without a software release. Source recovery and missing entities keep their own retry. */
const recoverableBlank = (reason: string) => /^(?:SOURCE_BLOCKED:|ELECTION_FIELD_PUBLICATION_HELD$|SUBJECT_HAS_NO_BODY_IN_THE_FACT_STORE$|SUBJECT_HAS_NO_DIVISION$|NAME_IS_NOT_ON_A_GOVERNMENT$|STATE_NOT_IN_THE_FACT_STORE$|COPY_OUTSIDE_FRESHNESS_WINDOW$)/.test(reason);


interface LiveMember { readonly factId: number; readonly bodyId: string; readonly name: string; readonly words: string; readonly producedBy: string }

/** Live members of the given bodies, each with the words that seated them: the member quote, and the office and its quote. */
async function liveMembers(query: Query, bodyIds: readonly string[]): Promise<readonly LiveMember[]> {
  return (await query(`SELECT f.id, f.entity_id, f.value->>'name' AS name, f.produced_by,
      concat_ws(E'\\n', f.quote, f.value->>'office', o.value #>> '{}', o.quote) AS words
    FROM fact f LEFT JOIN fact o ON o.entity_id = substr(f.field, 8) AND o.field = 'office:' || f.entity_id AND o.status = 'live'
    WHERE f.entity_id = ANY($1::text[]) AND f.status = 'live' AND f.field LIKE 'member:%'`, [bodyIds]))
    .map(row => ({ factId: Number(row.id), bodyId: String(row.entity_id), name: String(row.name), words: String(row.words), producedBy: String(row.produced_by) }));
}

/** A suspect published seat goes to Sean, including one whose quote never showed the seat. */
async function reviewBoxSeats(query: Query): Promise<{ readonly flagged: number }> {
  const since = Number(await readPassCursor(query, "box-seats") ?? 0);
  const newest = Number((await query("SELECT coalesce(max(id), 0) AS newest FROM fact"))[0]!.newest);
  // Only bodies whose members changed since the last pass; the pass starts where this one read up to.
  const bodies = (await query("SELECT DISTINCT entity_id FROM fact WHERE id > $1 AND id <= $2 AND field LIKE 'member:%'", [since, newest])).map(row => String(row.entity_id));
  const members = bodies.length ? await liveMembers(query, bodies) : [];
  let flagged = 0;
  for (const member of members.filter(row => row.producedBy === "box")) {
    const seat = seatIn(member.words, member.bodyId, member.name);
    if (!seat || seat.ward && members.some(other => other.bodyId === member.bodyId && nameKey(other.name) !== nameKey(member.name) && seatIn(other.words, other.bodyId, other.name)?.ward === seat.ward)) {
      flagged += (await query(`INSERT INTO owner_flag (fact_id, kind) SELECT $1, 'AUDIT_LOOKS_WRONG'
        WHERE NOT EXISTS (SELECT 1 FROM owner_flag WHERE fact_id = $1 AND resolved IS NULL) RETURNING id`, [member.factId])).length;
    }
  }
  await writePassCursor(query, "box-seats", String(newest));
  return { flagged };
}

const SCHEDULE_WORDS = /\b(?:mon|tues|wednes|thurs|fri|satur|sun)day|\bmonthly\b|\bweekly\b|\bbi-?weekly\b|\bquarterly\b|\bannual(?:ly)?\b/i;

/** What a Box fact that is a label, a heading, a notice, a bare link or a paragraph should become: come down, move to the field it belongs to, or be cut to the part that states the thing. */
export type Remedy = { readonly pull: string } | { readonly move: "comment:detail" } | { readonly value: string } | null;
export function remedyFor(field: string, kind: string, value: string, quote: string, name: string | null): Remedy {
  if (field.startsWith("member:")) return name !== null && !looksLikeNameCell(name) ? { pull: "NOT_A_PERSON" } : null;
  if (field === "agenda_url") return kind === "body" && normalizeText(quote) === normalizeText(value) ? { pull: "BARE_LINK" } : null;
  if (field === "meeting_cadence") {
    const phrase = schedulePhrase(value);
    if (value.length <= 160 && SCHEDULE_WORDS.test(value)) return null;
    return phrase !== null ? { value: phrase } : { pull: "NOT_A_SCHEDULE" };
  }
  // A comment period is yes or no; a sentence about how to comment is the rule itself, so it moves to the rule.
  if (field === "comment:period") return /^(yes|no)$/i.test(value) ? null : isPlainSentence(value) && !OTHER_NOTICE.test(value) ? { move: "comment:detail" } : { pull: "NOT_YES_OR_NO" };
  if (field === "comment:detail") return isPlainSentence(value) && !OTHER_NOTICE.test(value) ? null : { pull: "NOT_A_COMMENT_RULE" };
  return null;
}

/**
 * A member saved with the title written after the name ("Priscilla Alderete - President") is the name alone, and the
 * title is the seat. The person's own record, their name fact and the body's member fact all take the clean name;
 * honorifics and suffixes stay. Every live member is read once, then each new one as it arrives.
 */
async function retitleMembers(query: Query, purge?: ReaderCachePurger): Promise<number> {
  const since = Number(await readPassCursor(query, "box-names") ?? 0);
  const newest = Number((await query("SELECT coalesce(max(id), 0) AS newest FROM fact"))[0]!.newest);
  const rows = await query(`SELECT id, entity_id, field, value->>'name' AS name, value->>'office' AS office FROM fact
    WHERE id > $1 AND id <= $2 AND status = 'live' AND field LIKE 'member:%' AND value->>'name' ~ '[-–—,(]'`, [since, newest]);
  let renamed = 0;
  for (const row of rows) {
    const old = String(row.name), { name, title } = splitPersonTitle(old);
    if (title === null || !name) continue;
    const person = String(row.field).slice("member:".length);
    await query(`UPDATE fact SET value = value || jsonb_build_object('name', $2::text, 'office', coalesce(value->>'office', $3::text)), value_text = $2 WHERE id = $1 AND status = 'live'`, [row.id, name, title]);
    await query("UPDATE entity SET name = $2 WHERE id = $1 AND name = $3", [person, name, old]);
    await query("UPDATE fact SET value = to_jsonb($2::text), value_text = $2 WHERE entity_id = $1 AND field = 'name' AND status = 'live' AND value_text = $3", [person, name, old]);
    if (row.office === null) {
      await query(`INSERT INTO fact (entity_id, field, value, value_text, status, provenance_kind, source_copy_id, quote, quote_start, checked_at, live_at, produced_by, cost_usd)
        SELECT $2, $3, to_jsonb($4::text), $4, 'live', provenance_kind, source_copy_id, quote, quote_start, checked_at, live_at, produced_by, 0 FROM fact WHERE id = $1 AND quote ILIKE '%' || $4 || '%'
        AND NOT EXISTS (SELECT 1 FROM fact d WHERE d.entity_id = $2 AND d.field = $3 AND d.status = 'live')`, [row.id, person, `office:${row.entity_id}`, title]);
    }
    await invalidateReaderCache(await readerCacheScopeForEntity(query, String(row.entity_id)), purge);
    renamed++;
  }
  await writePassCursor(query, "box-names", String(newest));
  return renamed;
}

/** A fact that looks wrong is flagged for Sean (remove, keep, send the fleet, or type the value), never taken down by the system (rulings §2 step 6). */
async function flagLooksWrong(query: Query, factId: number, reason: string): Promise<number> {
  return (await query(`INSERT INTO owner_flag (fact_id, kind, reason) SELECT $1, 'AUDIT_LOOKS_WRONG', $2
    WHERE EXISTS (SELECT 1 FROM fact WHERE id = $1 AND status = 'live') AND NOT EXISTS (SELECT 1 FROM owner_flag WHERE fact_id = $1 AND resolved IS NULL) RETURNING id`, [factId, reason])).length;
}

/** Box facts that are a label, a heading, a notice, a bare link or a paragraph get their remedy, and the walk's better reading of the same page takes their place; the pass reads only facts added since its last. */
async function reviewBoxFacts(query: Query, purge?: ReaderCachePurger): Promise<{ readonly flagged: number; readonly moved: number; readonly cut: number; readonly renamed: number }> {
  const since = Number(await readPassCursor(query, "box-labels") ?? 0);
  const newest = Number((await query("SELECT coalesce(max(id), 0) AS newest FROM fact"))[0]!.newest);
  const rows = await query(`SELECT f.id, f.entity_id, f.field, e.kind, coalesce(f.value_text, '') AS value_text, coalesce(f.quote, '') AS quote, f.value->>'name' AS name
    FROM fact f JOIN entity e ON e.id = f.entity_id
    WHERE f.id > $1 AND f.id <= $2 AND f.produced_by = 'box' AND f.status = 'live'
      AND (f.field IN ('agenda_url', 'meeting_cadence', 'comment:period', 'comment:detail') OR f.field LIKE 'member:%')`, [since, newest]);
  const tally = { flagged: 0, moved: 0, cut: 0, renamed: await retitleMembers(query, purge) };
  for (const row of rows) {
    const remedy = remedyFor(String(row.field), String(row.kind), String(row.value_text), String(row.quote), row.name === null ? null : String(row.name));
    if (!remedy) continue;
    if ("move" in remedy) {
      const [moved] = await query(`UPDATE fact SET field = $2 WHERE id = $1 AND status = 'live'
        AND NOT EXISTS (SELECT 1 FROM fact d WHERE d.entity_id = fact.entity_id AND d.field = $2 AND d.status = 'live') RETURNING id`, [row.id, remedy.move]);
      if (moved) {
        // The page's own words on how to comment show the body takes it.
        await query(`INSERT INTO fact (entity_id, field, value, value_text, status, provenance_kind, source_copy_id, quote, quote_start, checked_at, live_at, produced_by, cost_usd)
          SELECT entity_id, 'comment:period', '"YES"'::jsonb, 'YES', 'live', provenance_kind, source_copy_id, quote, quote_start, checked_at, live_at, produced_by, 0 FROM fact WHERE id = $1
          AND NOT EXISTS (SELECT 1 FROM fact d WHERE d.entity_id = $2 AND d.field = 'comment:period' AND d.status = 'live')`, [row.id, row.entity_id]);
        tally.moved++;
      } else {
        tally.flagged += await flagLooksWrong(query, Number(row.id), "NOT_YES_OR_NO");
      }
    } else if ("value" in remedy) {
      await query("UPDATE fact SET value = to_jsonb($2::text), value_text = $2 WHERE id = $1 AND status = 'live'", [row.id, remedy.value]);
      tally.cut++;
    } else {
      tally.flagged += await flagLooksWrong(query, Number(row.id), remedy.pull);
    }
    await invalidateReaderCache(await readerCacheScopeForEntity(query, String(row.entity_id)), purge);
  }
  await writePassCursor(query, "box-labels", String(newest));
  return tally;
}

const named = (quote: string, name: string) => boundedIndexOf(normalizeText(quote).toLowerCase(), normalizeText(name).toLowerCase()) !== -1;

/** The office a contact belongs to as the saved page names it: in the finding's own sentence, or in the page text just before the contact. */
export function officeNameOn(pageText: string, quote: string, value: string): { readonly name: string; readonly quote: string } | undefined {
  const own = OFFICE_NAME.exec(quote)?.[0].trim();
  if (own) return { name: own, quote };
  const at = pageText.indexOf(normalizeText(value));
  if (at === -1) return undefined;
  const window = pageText.slice(Math.max(0, at - 300), at + normalizeText(value).length);
  let found: RegExpExecArray | undefined;
  for (const match of window.matchAll(new RegExp(OFFICE_NAME.source, "g"))) found = match;
  return found ? { name: found[0].trim(), quote: window.slice(found.index) } : undefined;
}

/** The office as the page names it: "Cochise County Recorder", "Elections Department", "Public Works Department". */
const OFFICE_NAME = /(?:(?:[A-Z][a-z]+\s+)County\s+|City of [A-Z][a-z]+\s+|Town of [A-Z][a-z]+\s+)?(?:Office of the\s+)?(?:Recorder|Elections?|Voter Registration|Assessor|Treasurer|Sheriff|Public Works|Police|Fire|Library|Utilities|Transportation|Transit|Airport|Human Resources|Attendance|Athletics|Nutrition|Food Services?|Help ?Desk|Business Office)(?:['’]s)?(?:\s+(?:Office|Department|Dept\.?|Division|District|Services?))?/;

const PHONE_IN_QUOTE = /\+?1?[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/;
const DATED: readonly ElectionFieldKind[] = ["registration_deadline", "early_voting", "certified_outcome"];

/** Box findings, each routed where its record publishes, checked on its own page; what has no route waits with its reason. */
export async function publishBoxFindings(input: {
  readonly repos: Pick<ControlPlaneRepositories, "boxFindings" | "artifacts">;
  readonly facts: FactDb & { readonly query: Query }; readonly vault: EvidenceStore; readonly fetch: ProbeFetch;
  readonly store: RoutineDataStore; readonly clocks: Clocks; readonly now: string; readonly limit: number;
  readonly purge?: ReaderCachePurger;
  /** The standing publisher runs audits separately from publication. */
  readonly audit?: boolean;
  /** Stop admitting work while the parent still has time to save this pass's outcome. In-flight source reads keep their transport deadlines. */
  readonly deadlineMs?: number;
}): Promise<BoxPublicationReport> {
  const { repos, facts, clocks } = input;
  const now = new Date(input.now);
  const report = { looked: 0, deferred: 0, published: 0, publishedByRoute: {} as Record<string, number>, handed: 0, refused: 0,
    seats: { flagged: 0 }, labels: { flagged: 0, moved: 0, cut: 0, renamed: 0 },
    errorExamples: [] as { findingId: string; stage: string; detail: string }[],
    waitingByClass: {} as Record<string, number>, failuresByReason: {} as Record<string, number>,
    byPlace: {} as Record<string, { published: number; refused: number; waiting: number }> };
  if (input.audit !== false) {
    try { Object.assign(report, await reviewPublishedBoxFacts(facts.query, input.purge)); }
    catch (error) {
      report.failuresByReason.BOX_AUDIT_FAILED = 1;
      report.errorExamples.push({ findingId: "published-facts", stage: "AUDIT", detail: sanitizedErrorDiagnostic(error).slice(0, 600) });
    }
  }
  // A packet's findings count toward its government; any other finding toward its own subject.
  const place = (row: BoxFinding) => report.byPlace[placeOf(row)] ??= { published: 0, refused: 0, waiting: 0 };
  const rows = await repos.boxFindings.due({ slots: FINDING_SLOT_VERSIONS, now: input.now, limit: input.limit });
  const deferred = new Set<string>(), settled = new Set<string>();
  const outOfTime = () => Date.now() >= (input.deadlineMs ?? Infinity);
  // Preparing a whole page must leave time to check its sources and publish. Otherwise the same untouched rows can consume every pass in metadata lookups.
  const preparationStartedMs = Date.now();
  const preparationDeadlineMs = input.deadlineMs === undefined ? Infinity
    : preparationStartedMs + Math.max(0, input.deadlineMs - preparationStartedMs) / 3;
  const retryAt = (reason: string) => recoverableBlank(reason) ? { retryAt: new Date(now.getTime() + 60 * 60_000).toISOString() } : {};
  const wait = (row: BoxFinding, slotClass: string, reason: string) =>
    holdBoxFinding(repos.boxFindings, row.id, { class: slotClass, reason, slots: slotVersion(slotClass), ...retryAt(reason) }, input.now);
  const hold = async (row: BoxFinding, slotClass: string, reason: string) => {
    await wait(row, slotClass, reason);
    report.waitingByClass[slotClass] = (report.waitingByClass[slotClass] ?? 0) + 1;
    place(row).waiting++;
  };
  const failed = async (row: BoxFinding, stage: string, error: unknown) => {
    const detail = sanitizedErrorDiagnostic(error).slice(0, 600);
    const claim = await takeBoxFinding(repos.boxFindings, row.id, PUBLISHER, input.now, new Date(now.getTime() + 120_000).toISOString());
    if (!claim) return;
    report.failuresByReason.BOX_PUBLICATION_EXCEPTION = (report.failuresByReason.BOX_PUBLICATION_EXCEPTION ?? 0) + 1;
    if (report.errorExamples.length < 5) report.errorExamples.push({ findingId: row.id, stage, detail });
    // A programming, source or database failure is its own retry, never a refusal of the finding's truth.
    await finishBoxFinding(repos.boxFindings, row.id, claim.token, { state: "failed", reason: `${stage}: ${detail}`,
      class: slotOfRow(row)?.class ?? "other", slots: slotVersion(slotOfRow(row)?.class ?? "other"), retryAt: new Date(now.getTime() + 5 * 60_000).toISOString() }, input.now);
  };
  // A verified page publishes at once. Only a refusal waits for the other saved pages, any of which may prove the fact.
  const sources = new Map<string, { left: number; best: PublishOutcome | null }>();
  const settle = async (row: BoxFinding, said: PublishOutcome, route: string) => {
    const pending = sources.get(row.id);
    let outcome = said;
    if (pending) {
      pending.left--;
      if (!pending.best || "blank" in pending.best) pending.best = said;
      if (pending.left > 0 && "blank" in pending.best) return;
      outcome = pending.best;
    }
    const claim = await takeBoxFinding(repos.boxFindings, row.id, PUBLISHER, input.now, new Date(now.getTime() + 120_000).toISOString());
    if (!claim) return;
    if ("blank" in outcome) {
      if (!await finishBoxFinding(repos.boxFindings, row.id, claim.token, { state: "refused", reason: outcome.blank, class: route, slots: slotVersion(route), ...retryAt(outcome.blank) }, input.now)) return;
      settled.add(row.id);
      report.refused++; place(row).refused++;
      report.failuresByReason[outcome.blank] = (report.failuresByReason[outcome.blank] ?? 0) + 1;
    } else {
      if (!await finishBoxFinding(repos.boxFindings, row.id, claim.token, { state: "built", publicationId: `${outcome.decision}:${outcome.factId ?? "current"}` }, input.now)) return;
      settled.add(row.id);
      report.published++; place(row).published++;
      report.publishedByRoute[route] = (report.publishedByRoute[route] ?? 0) + 1;
    }
  };

  // Each subject is named, and looked up, once in a pass.
  const names = new Map<string, Promise<string>>();
  const subjectOf = (id: string) => names.get(id) ?? names.set(id, canonicalSubject(facts.query, id)).get(id)!;
  const targets = new Map<string, Promise<Target | null>>();
  const targetFor = (subject: string) => targets.get(subject) ?? targets.set(subject, boardFor(facts.query, subject)).get(subject)!;
  const slotOfRow = (row: BoxFinding) => {
    const fact = findingFact(row);
    return fact && row.exactQuote && row.sourceUrl ? slotFor(fact.field, fact.value, fact.recordClass, row.exactQuote, row.sourceUrl, row.subjectId) : null;
  };
  // A committee is made by the finding that names it, so those are read first and the findings about the committee find it.
  const naming = new Set(rows.filter(row => slotOfRow(row)?.class === "bodies").map(row => row.id));

  const ready: { finding: Finding; slot: Routed; body: Target["body"]; holder: string | null; entityId: string; asNamed?: string }[] = [];
  const elections: { finding: Finding; kind: ElectionFieldKind; divisionId: string }[] = [];
  const orderedRows = [...rows.filter(row => naming.has(row.id)), ...rows.filter(row => !naming.has(row.id))];
  for (const [index, row] of orderedRows.entries()) {
    if (Date.now() >= preparationDeadlineMs) { for (const pending of orderedRows.slice(index)) deferred.add(pending.id); break; }
    report.looked++;
    try {
    if (row.state === "refused") await reopenBoxFinding(repos.boxFindings, row.id, slotVersion(slotOfRow(row)?.class ?? "other"), input.now);
    if (!row.origins.some(o => o.kind === "SCOUT")) { await hold(row, "detective", "DETECTIVE_SPAN_NAMES_NO_FIELD"); continue; }
    const raw = findingFact(row);
    if (!raw || !row.exactQuote || !row.sourceUrl) { await hold(row, "other", "FINDING_HAS_NO_FIELD_VALUE_OR_QUOTE"); continue; }
    const slot = slotFor(raw.field, raw.value, raw.recordClass, row.exactQuote, row.sourceUrl, row.subjectId);
    if ("waiting" in slot) { await hold(row, slot.class, slot.waiting); continue; }
    // A link is a page to go read: the next walk of the government's own site reads it first and turns what it holds into facts.
    if ("handoff" in slot) { await wait(row, slot.class, slot.handoff === "site-walk" ? SITE_WALK_LEAD : COMMENT_SUMMARY_LEAD); report.handed++; continue; }
    if ("lead" in slot) { await wait(row, slot.class, slot.lead === "campaign-site" ? CAMPAIGN_SITE_LEAD : CANDIDATE_PROFILE_LEAD); report.handed++; continue; }
    const subject = await subjectOf(row.subjectId);
    const finding: Finding = { row, subject, origin: raw.origin, field: raw.field, value: raw.value, exactQuote: row.exactQuote, sourceUrl: row.sourceUrl, recordClass: raw.recordClass };
    // Each page that said the fact is checked on its own saved copy.
    const findings: readonly Finding[] = [finding, ...otherSources(row).map(other => ({ ...finding, origin: other.origin, exactQuote: other.exactQuote, sourceUrl: other.sourceUrl }))];
    const queue = <T extends { finding: Finding }>(into: T[], make: (finding: Finding) => T) => {
      sources.set(row.id, { left: findings.length, best: null });
      into.push(...findings.map(make));
    };
    if ("election" in slot) {
      const divisionId = [row.subjectId, placeOf(row)].find(id => id.startsWith("ocd-division/"));
      if (divisionId) queue(elections, each => ({ finding: each, kind: slot.election, divisionId }));
      else await hold(row, slot.class, "SUBJECT_HAS_NO_DIVISION");
      continue;
    }
    const target = await targetFor(subject);
    // A body or an office is added under its government even where the government has no governing board of its own, as a state has none.
    if (slot.class === "bodies") {
      const named = await bodyNamed(facts.query, subject, target?.body ?? null, String(finding.value));
      if (named) {
        targets.delete(subject); targets.delete(named.id);
        queue(ready, each => ({ finding: each, slot, body: named, holder: null, entityId: named.id, asNamed: named.asNamed }));
      }
      else await hold(row, slot.class, "NAME_IS_NOT_ON_A_GOVERNMENT");
      continue;
    }
    if (slot.class === "other offices") {
      // The office is found or added once the saved page is read, because the page is what names it.
      queue(ready, each => ({ finding: each, slot, body: target?.body ?? { id: subject, name: "", state: null, parentId: null }, holder: null, entityId: target?.entityId ?? subject }));
      continue;
    }
    if (!target) { await hold(row, slot.class, "SUBJECT_HAS_NO_BODY_IN_THE_FACT_STORE"); continue; }
    if ((slot.class === "sittings") !== target.entityId.startsWith("meeting:")) { await hold(row, slot.class, slot.class === "sittings" ? "SUBJECT_IS_NOT_A_SITTING" : "SUBJECT_IS_A_SITTING"); continue; }
    queue(ready, each => ({ finding: each, slot, body: target.body, holder: target.holder, entityId: target.entityId }));
    } catch (error) { await failed(row, "SORT", error); }
  }

  const captures = new Map<string, Promise<{ capture: WorkerPublicationCapture } | { error: string }>>();
  const readHeld = heldCaptureReader(input.vault);
  // The cited saved page proves the finding while it is inside the field's clock; otherwise code reads the address once more.
  const captureFor = (finding: Finding, kind: FieldKind) => {
    const key = `${finding.origin.artifactIds[0] ?? ""}|${finding.sourceUrl}|${kind}`;
    if (!captures.has(key)) captures.set(key, (async () => {
      const records = (await repos.artifacts.read(finding.origin.workItemId)).filter(record => finding.origin.artifactIds.includes(record.artifactId) && record.canonicalUrl === finding.sourceUrl);
      for (const record of records) {
        const held = await readHeld(record);
        if (held && (now.getTime() - Date.parse(held.observedAt)) / 3_600_000 <= clocks.windowHours(kind)) return { capture: held };
      }
      return fetchCapture({ url: finding.sourceUrl, repos, vault: input.vault, fetch: input.fetch, now: input.now });
    })());
    return captures.get(key)!;
  };
  const blocked = async (entityId: string, field: string, finding: Finding, kind: FieldKind, error: string, route: string) => {
    await openBlank(facts.query, { entityId, field, stage: "ACQUIRE", reason: "SOURCE_BLOCKED", detail: `${finding.sourceUrl}: ${error}`, retryMinutes: clocks.retryMinutes(kind) });
    await settle(finding.row, { blank: `SOURCE_BLOCKED:${error}` }, route);
  };

  const groups = new Map<string, typeof ready>();
  for (const entry of ready) {
    const key = `${entry.entityId}|${entry.finding.origin.artifactIds[0] ?? ""}|${entry.finding.sourceUrl}|${kindOf(entry.slot)}`;
    groups.set(key, [...groups.get(key) ?? [], entry]);
  }
  // People come first: a member's phone or email names a member the same pass has to have made, or it would land on the board's own office.
  const peopleFirst = (group: typeof ready) => kindOf(group[0]!.slot) === "officeholder" ? 0 : 1;
  const byBody = new Map<string, (typeof ready)[]>();
  for (const group of [...groups.values()].sort((a, b) => peopleFirst(a) - peopleFirst(b))) {
    const id = group[0]!.body.id;
    byBody.set(id, [...byBody.get(id) ?? [], group]);
  }
  // A slow page for one government cannot hold other places. Each body keeps its own dependent records in order.
  const publications = await runBoundedWorkPool([...byBody.values()], 4, async bodyGroups => {
  for (const group of bodyGroups) {
    if (outOfTime()) { for (const entry of group) deferred.add(entry.finding.row.id); continue; }
    try {
    const { body, entityId } = group[0]!, kind = kindOf(group[0]!.slot);
    const read = await captureFor(group[0]!.finding, kind);
    if ("error" in read) {
      for (const { finding, slot } of group) await blocked(entityId, slot.slot, finding, kind, read.error, slot.class);
      continue;
    }
    const people = group.filter(entry => entry.slot.class === "rosters" || entry.slot.class === "contacts");
    const forOffice: typeof ready = [];
    if (people.length) {
      const seated = (await liveMembers(facts.query, [body.id])).map(row => row.name);
      const known = [...people.filter(e => e.slot.slot === "member_name").map(e => splitPersonTitle(String(e.finding.value)).name), ...seated];
      const titled = new Map<string, { title: string; quote: string }>();
      const members = new Map<string, RosterMember & { fields: Record<string, unknown>; fieldSources: Record<string, { quote: string; sourceUrl: string; sourceOrg: string; collectedAt: string; verifiedAt: null }> }>();
      const sourceFieldOf = new Map<Finding, { recordId: string; field: string }>();
      const quoteOf = (quote: string) => ({ quote, sourceUrl: read.capture.evidence.canonicalUrl, sourceOrg: "", collectedAt: read.capture.observedAt, verifiedAt: null });
      for (const entry of people) {
        const { finding, slot: own, holder } = entry;
        // A name is just the name: the title a page writes after it ("Priscilla Alderete - President") is the seat, and honorifics and suffixes stay.
        const written = own.slot === "member_name" ? splitPersonTitle(String(finding.value)) : null;
        const name = written ? written.name : holder ?? known.find(candidate => named(finding.exactQuote, candidate));
        // A cell that is a menu item, a heading or a place ("Date Elected", "BID PACKAGE", "Board of Education Home") is not a person, however the page laid it out.
        if (written && !looksLikeNameCell(written.name)) { await settle(finding.row, { blank: "NOT_A_PERSON" }, own.class); continue; }
        if (!name) {
          if (own.class === "contacts" && (own.slot === "phone" || own.slot === "email")) {
            const field = own.slot === "phone" ? "office_phone" : "office_email", elsewhere = otherOffice(finding.field, String(finding.value), finding.exactQuote, finding.sourceUrl);
            forOffice.push({ ...entry, slot: elsewhere ? { class: "other offices", slot: field, office: elsewhere } : { class: "office contacts", slot: field } });
          }
          else await settle(finding.row, { blank: "NO_PERSON_NAMED_IN_QUOTE" }, own.class);
          continue;
        }
        const recordId = `box:${nameKey(name)}`;
        if (written?.title && named(finding.exactQuote, written.title)) titled.set(recordId, { title: written.title, quote: finding.exactQuote });
        const member = members.get(recordId) ?? { recordId, fields: {}, fieldSources: {} };
        const field = MEMBER_FIELD[own.slot as keyof typeof MEMBER_FIELD];
        const value = written && field === "name" ? written.name : finding.value;
        if (field !== "name" && !member.fields.name) { member.fields.name = name; member.fieldSources.name = quoteOf(finding.exactQuote); }
        if (field !== "name" && member.fields[field] !== undefined && member.fields[field] !== finding.value) { await settle(finding.row, { blank: "OTHER_VALUE_ON_THE_SAME_PAGE" }, own.class); continue; }
        member.fields[field] = value; member.fieldSources[field] = quoteOf(linkQuote(String(value), finding.exactQuote));
        members.set(recordId, member);
        sourceFieldOf.set(finding, { recordId, field });
      }
      // The title that came with a name is the seat when no finding gave one.
      for (const [recordId, { title, quote }] of titled) {
        const member = members.get(recordId);
        if (member && member.fields.office === undefined) { member.fields.office = title; member.fieldSources.office = quoteOf(quote); }
      }
      const unseated = new Set<string>();
      for (const member of members.values()) {
        const name = String(member.fields.name);
        const words = [member.fieldSources.name?.quote, member.fields.office, member.fieldSources.office?.quote].filter(Boolean).join("\n");
        const quote = seatQuoteOnPage(read.capture.evidence.text, name, body.id, words);
        const namesSeat = people.some(entry => entry.slot.slot === "member_name" && nameKey(splitPersonTitle(String(entry.finding.value)).name) === nameKey(name));
        if (quote) {
          member.fieldSources.name = quoteOf(quote);
          const title = seatTitleIn(quote, body.id, name);
          if (title && member.fields.office === undefined) { member.fields.office = title; member.fieldSources.office = quoteOf(quote); }
        }
        else if (namesSeat || !seated.some(held => nameKey(held) === nameKey(name))) unseated.add(member.recordId);
      }
      const tally = await publishRosterFacts(facts, { body, capture: read.capture, members: [...members.values()].filter(member => !unseated.has(member.recordId)),
        complete: false, producedBy: "box", purge: input.purge }, clocks, now);
      for (const { finding, slot } of people) {
        const at = sourceFieldOf.get(finding);
        if (at) await settle(finding.row, unseated.has(at.recordId) ? { blank: "SEAT_NOT_IN_QUOTE" } : tally.outcomes.get(at.recordId)?.get(at.field) ?? { blank: "NOT_CLAIMED" }, slot.class);
      }
    }
    const own = [...group.filter(entry => entry.slot.class !== "rosters" && entry.slot.class !== "contacts"), ...forOffice];
    if (!own.length) continue;
    const copy = await facts.transaction(query => saveCaptureCopy(query, read.capture));
    const entities = new Map<string, NonNullable<Awaited<ReturnType<typeof readCheckEntity>>>>();
    const entityOf = async (id: string) => entities.get(id) ?? entities.set(id, (await readCheckEntity(facts.query, id))!).get(id)!;
    const pageText = normalizeText(copy.text);
    for (const { finding, slot, entityId: held, body: governing, asNamed } of own) {
      try {
      let at = held, name: { readonly name: string; readonly quote: string } | undefined;
      if (slot.class === "other offices") {
        name = officeNameOn(pageText, finding.exactQuote, String(finding.value));
        const office = name && await officeNamed(facts.query, finding.subject, governing, slot.office, name.name);
        if (!office) { await settle(finding.row, { blank: "OFFICE_NAME_NOT_ON_THE_PAGE" }, slot.class); continue; }
        at = office.id;
      }
      const entity = await entityOf(at), provenance = captureProvenance(read.capture, entity.hosts);
      const claim = (field: string, value: unknown, valueText: string, quote: string) =>
        publishClaim(facts, { entity, field, fieldKind: kind, provenance, value, valueText, quote, copy, producedBy: "box", costUsd: 0 }, clocks, now, { purge: input.purge });
      const value = String(finding.value), quote = linkQuote(value, finding.exactQuote);
      if (slot.class === "official hosts") {
        const host = /^https?:\/\//i.test(value) ? value : `https://${value}`;
        const checked = checkFact({ entity, fieldKind: kind, provenance, valueText: value, quote, copy }, now, clocks.windowHours);
        if (checked.ok) await learnOfficialHost(facts.query, body.parentId ?? body.id, host);
        await settle(finding.row, checked.ok ? { decision: "PUBLISH", factId: null } : { blank: checked.reason }, slot.class);
        continue;
      }
      // A body the Box added is shown to readers once its name is on a saved page.
      if (name) {
        const named = await claim("name", name.name, name.name, name.quote);
        if ("blank" in named) { await settle(finding.row, named, slot.class); continue; }
      }
      // The board is named as the page names it, without what the page hangs on it ("Board of Education Home" names the Board of Education).
      const shown = slot.class === "bodies" ? asNamed ?? value : value;
      const outcome = slot.class === "bodies" ? await claim("name", shown, shown, quote)
        : slot.slot === "comment:period" ? await claim(slot.slot, value.toUpperCase(), finding.exactQuote, finding.exactQuote) : await claim(slot.slot, value, value, quote);
      // A page's own words on how to comment show the body takes it.
      if (slot.class === "comment rules" && slot.slot !== "comment:period" && !("blank" in outcome)) await claim("comment:period", "YES", finding.exactQuote, finding.exactQuote);
      await settle(finding.row, outcome, slot.class);
      } catch (error) { await failed(finding.row, "PUBLISH", error); }
    }
    } catch (error) { for (const { finding } of group) await failed(finding.row, "SOURCE_GROUP", error); }
  }
  });
  const unwritten = publications.filter(result => !result.ok);
  if (unwritten.length) throw new Error(`BOX_FAILURE_RECORD_UNWRITTEN: ${unwritten.map(result => result.error).slice(0, 3).join("; ")}`);

  const fields: { finding: Finding; field: ElectionFieldInput }[] = [];
  for (const { finding, kind, divisionId } of elections) {
    if (outOfTime()) { deferred.add(finding.row.id); continue; }
    try {
    const read = await captureFor(finding, "ballot");
    if ("error" in read) { await blocked(divisionId, kind, finding, "ballot", read.error, "ballot navigation"); continue; }
    // Election authorities write about the state's elections, so the page is checked as being about the state.
    const entity = await readCheckEntity(facts.query, /^ocd-division\/country:us\/[a-z]+:[a-z]{2}/.exec(divisionId)![0]);
    if (!entity) { await settle(finding.row, { blank: "STATE_NOT_IN_THE_FACT_STORE" }, "ballot navigation"); continue; }
    const value = String(finding.value), quote = linkQuote(value, finding.exactQuote);
    const copy = await facts.transaction(query => saveCaptureCopy(query, read.capture));
    const checked = checkFact({ entity, fieldKind: "ballot", provenance: captureProvenance(read.capture, entity.hosts), valueText: value, quote, copy }, now, clocks.windowHours);
    if (!checked.ok) { await settle(finding.row, { blank: checked.reason }, "ballot navigation"); continue; }
    const url = read.capture.evidence.canonicalUrl;
    fields.push({ finding, field: { divisionId, kind, sourceUrl: url, value, quote: finding.exactQuote,
      dates: DATED.includes(kind) ? [...datesInQuote(finding.exactQuote)].sort() : [],
      ...(kind === "election_office" ? { phone: PHONE_IN_QUOTE.exec(finding.exactQuote)?.[0].trim() ?? null } : {}),
      document: { url, text: read.capture.evidence.text, collectedAt: read.capture.observedAt, capture: read.capture } } });
    } catch (error) { await failed(finding.row, "ELECTION", error); }
  }
  if (fields.length) {
    let outcome: Awaited<ReturnType<typeof publishElectionFields>> | { readonly held: string };
    try { outcome = await publishElectionFields({ store: input.store, now: input.now, fields: fields.map(row => row.field), verify: section3Record }); }
    catch (error) {
      const detail = sanitizedErrorDiagnostic(error).slice(0, 600);
      if (report.errorExamples.length < 5) report.errorExamples.push({ findingId: fields[0]!.finding.row.id, stage: "ELECTION_PUBLICATION", detail });
      outcome = { held: detail };
    }
    for (const { finding, field } of fields) {
      if ("held" in outcome) { await settle(finding.row, { blank: outcome.held.split(":")[0]! }, "ballot navigation"); continue; }
      const gap = outcome.gaps.find(row => row.divisionId === field.divisionId && row.kind === field.kind);
      await settle(finding.row, outcome.fields.includes(electionFieldId(field)) ? { decision: "PUBLISH", factId: null }
        : { blank: `ELECTION_FIELD_GAP:${gap?.detail ?? "not published"}` }, "ballot navigation");
    }
  }
  report.deferred = [...deferred].filter(id => !settled.has(id)).length;
  return report;
}
