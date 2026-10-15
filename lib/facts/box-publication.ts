import { findingFact, finishBoxFinding, holdBoxFinding, takeBoxFinding, type BoxFinding, type BoxOrigin } from "../control-plane/box.ts";
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
import { learnOfficialHost } from "./entities.ts";
import { readCheckEntity } from "./entity-read.ts";
import { CAMPAIGN_SITE_LEAD, CANDIDATE_PROFILE_LEAD, FINDING_SLOTS_VERSION, slotFor, type FindingSlot } from "./finding-slots.ts";
import { openBlank, publishClaim, type Clocks, type FactDb, type PublishOutcome, type Query } from "./publish.ts";
import { nameKey, publishRosterFacts, type RosterMember } from "./roster-facts.ts";
import { meetingEntityId } from "./meeting-read.ts";
import { saveCaptureCopy } from "./source-copy.ts";

/** How far back the Box is read for findings to publish. */
const HUNTER_FINDING_DAYS = 30;

interface Finding {
  readonly row: BoxFinding; readonly origin: BoxOrigin; readonly field: string; readonly value: string | number | boolean;
  readonly exactQuote: string; readonly sourceUrl: string; readonly recordClass: string | null;
}

interface BoxPublicationReport {
  readonly looked: number;
  readonly published: number;
  /** Published by where each went: the fact store's classes and ballot navigation. */
  readonly publishedByRoute: Readonly<Record<string, number>>;
  /** Handed to the campaign-site chain or the candidate-profile writer, which check each on their own passes. */
  readonly handed: number;
  readonly refused: number;
  readonly waitingByClass: Readonly<Record<string, number>>;
  readonly failuresByReason: Readonly<Record<string, number>>;
  readonly byPlace: Readonly<Record<string, { published: number; refused: number; waiting: number }>>;
  /** Box seats taken down for never showing the seat, and those flagged for naming a ward another member holds. */
  readonly seats: { readonly pulled: number; readonly flagged: number };
}

const MEMBER_FIELD = { member_name: "name", member_office: "office", term_note: "termNote", term_start: "termStart", term_end: "termEnd", email: "email", phone: "phone", website: "websiteUrl" } as const;

type Routed = Exclude<FindingSlot, { waiting: string } | { lead: string } | { election: string }>;
const kindOf = (slot: Routed): FieldKind => slot.class === "rosters" || slot.class === "body links" && slot.slot === "name" ? "officeholder"
  : slot.class === "schedules" || slot.class === "sittings" && slot.slot === "video_url" ? "meeting"
  : slot.class === "meeting routes" || slot.class === "sittings" ? "agenda" : slot.class === "comment rules" ? "comment_rule" : "contact";

interface Target { readonly body: { id: string; name: string; state: string | null; parentId: string | null }; readonly holder: string | null; readonly entityId: string }

const BODY_SQL = "SELECT id, name, state, parent_id FROM entity WHERE kind = 'body' AND id = $1";
const SITTING_SQL = "SELECT m.id AS meeting_id, m.parent_id AS body_id FROM entity m WHERE m.kind = 'meeting' AND m.id = $1";
const GOVERNS = "b.kind = 'body' AND (b.id LIKE '%#governing' OR b.id LIKE '%#board')";
// Each branch is one index lookup: by parent, by the government's parent, and by id prefix (`#` then `$` in C collation).
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

/** What a finding's subject stands for: a body, a body's calendar, a sitting, a seat's body and holder, or a place's or government's governing board. */
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
  const governing = bodyRow((await query(GOVERNING_SQL, [subjectId]))[0]);
  return governing ? { body: governing, holder: null, entityId: governing.id } : null;
}

const PACKET = "hunt:packet:";
const placeOf = (row: BoxFinding) => row.origins.find(origin => origin.resultKey?.startsWith(PACKET))?.resultKey!.slice(PACKET.length) ?? row.subjectId;

const STAFF_TITLE = /\b(manager|clerk|attorney|administrator|director|superintendent|engineer|planner|treasurer|secretary|coordinator|assistant|staff)\b/i;
const COUNCIL_SEAT = /\b((vice|deputy)[- ]?)?mayor\b|\bcouncil[- ]?(m[ae]n|member|woman|person|or|lor|president)s?\b|\balder(m[ae]n|woman|person)\b|\bselect(m[ae]n|woman|board)\b|\b(trustee|supervisor|freeholder|legislator|commissioner)s?\b/i;
const BOARD_SEAT = /\b(vice[- ]?)?(chair(person|man|woman)?|president)\b|\bboard members?\b|\bmember of the board\b/i;
const WARD = /\b(?:ward|district)\s*(?:no\.?\s*)?(\d+)\b/i;

/** The seat a person's own words show on this body, or null: a staff title never seats anyone, and a council seats only by its own titles. */
function seatIn(words: string, bodyId: string): { readonly ward: string | null } | null {
  const council = bodyId.endsWith("#governing"), board = bodyId.endsWith("#board");
  if (STAFF_TITLE.test(words)) return null;
  if (!COUNCIL_SEAT.test(words) && (council || !BOARD_SEAT.test(words)) && (council || board || !/\bmembers?\b/i.test(words))) return null;
  return { ward: council || board ? WARD.exec(words)?.[1] ?? null : null };
}

interface LiveMember { readonly factId: number; readonly bodyId: string; readonly name: string; readonly words: string; readonly producedBy: string }

/** Live members of the given bodies, each with the words that seated them: the member quote, and the office and its quote. */
async function liveMembers(query: Query, bodyIds: readonly string[]): Promise<readonly LiveMember[]> {
  return (await query(`SELECT f.id, f.entity_id, f.value->>'name' AS name, f.produced_by,
      concat_ws(E'\\n', f.quote, f.value->>'office', o.value #>> '{}', o.quote) AS words
    FROM fact f LEFT JOIN fact o ON o.entity_id = substr(f.field, 8) AND o.field = 'office:' || f.entity_id AND o.status = 'live'
    WHERE f.entity_id = ANY($1::text[]) AND f.status = 'live' AND f.field LIKE 'member:%'`, [bodyIds]))
    .map(row => ({ factId: Number(row.id), bodyId: String(row.entity_id), name: String(row.name), words: String(row.words), producedBy: String(row.produced_by) }));
}

/** Box seats whose words never showed the seat come down; one naming a ward another member holds is flagged for Sean. */
async function reviewBoxSeats(query: Query): Promise<{ readonly pulled: number; readonly flagged: number }> {
  const [cursor] = await query("SELECT (SELECT fact_id FROM fact_cursor WHERE name = 'box-seats') AS since, (SELECT max(id) FROM fact) AS newest");
  const since = Number(cursor?.since ?? 0), newest = Number(cursor?.newest ?? 0);
  // Only bodies whose members changed since the last pass; the pass starts where this one read up to.
  const bodies = (await query("SELECT DISTINCT entity_id FROM fact WHERE id > $1 AND id <= $2 AND field LIKE 'member:%'", [since, newest])).map(row => String(row.entity_id));
  const members = bodies.length ? await liveMembers(query, bodies) : [];
  let pulled = 0, flagged = 0;
  for (const member of members.filter(row => row.producedBy === "box")) {
    const seat = seatIn(member.words, member.bodyId);
    if (!seat) {
      await query("UPDATE fact SET status = 'pulled', held_reason = 'SEAT_NOT_IN_QUOTE' WHERE id = $1", [member.factId]);
      pulled++;
    } else if (seat.ward && members.some(other => other.bodyId === member.bodyId && nameKey(other.name) !== nameKey(member.name) && seatIn(other.words, other.bodyId)?.ward === seat.ward)) {
      flagged += (await query(`INSERT INTO owner_flag (fact_id, kind) SELECT $1, 'AUDIT_LOOKS_WRONG'
        WHERE NOT EXISTS (SELECT 1 FROM owner_flag WHERE fact_id = $1 AND resolved IS NULL) RETURNING id`, [member.factId])).length;
    }
  }
  await query("INSERT INTO fact_cursor (name, fact_id) VALUES ('box-seats', $1) ON CONFLICT (name) DO UPDATE SET fact_id = EXCLUDED.fact_id", [newest]);
  return { pulled, flagged };
}

const named = (quote: string, name: string) => boundedIndexOf(normalizeText(quote).toLowerCase(), normalizeText(name).toLowerCase()) !== -1;

const PHONE_IN_QUOTE = /\+?1?[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/;
const DATED: readonly ElectionFieldKind[] = ["registration_deadline", "early_voting", "certified_outcome"];

/** Box findings from the last month, each routed where its record publishes, checked on its own page; what has no route waits with its reason. */
export async function publishBoxFindings(input: {
  readonly repos: Pick<ControlPlaneRepositories, "boxFindings" | "artifacts">;
  readonly facts: FactDb & { readonly query: Query }; readonly vault: EvidenceStore; readonly fetch: ProbeFetch;
  readonly store: RoutineDataStore; readonly clocks: Clocks; readonly now: string; readonly limit: number;
}): Promise<BoxPublicationReport> {
  const { repos, facts, clocks } = input;
  const now = new Date(input.now), since = new Date(now.getTime() - HUNTER_FINDING_DAYS * 86_400_000).toISOString();
  const report = { looked: 0, published: 0, publishedByRoute: {} as Record<string, number>, handed: 0, refused: 0, seats: await reviewBoxSeats(facts.query),
    waitingByClass: {} as Record<string, number>, failuresByReason: {} as Record<string, number>,
    byPlace: {} as Record<string, { published: number; refused: number; waiting: number }> };
  // A packet's findings count toward its government; any other finding toward its own subject.
  const place = (row: BoxFinding) => report.byPlace[placeOf(row)] ??= { published: 0, refused: 0, waiting: 0 };
  const rows = await repos.boxFindings.due({ slots: FINDING_SLOTS_VERSION, now: input.now, since, limit: input.limit });
  const wait = (row: BoxFinding, slotClass: string, reason: string) =>
    holdBoxFinding(repos.boxFindings, row.id, { class: slotClass, reason, slots: FINDING_SLOTS_VERSION }, input.now);
  const hold = async (row: BoxFinding, slotClass: string, reason: string) => {
    await wait(row, slotClass, reason);
    report.waitingByClass[slotClass] = (report.waitingByClass[slotClass] ?? 0) + 1;
    place(row).waiting++;
  };
  const settle = async (row: BoxFinding, outcome: PublishOutcome, route: string) => {
    const claim = await takeBoxFinding(repos.boxFindings, row.id, "fact-publisher", input.now, new Date(now.getTime() + 120_000).toISOString());
    if (!claim) return;
    if ("blank" in outcome) {
      await finishBoxFinding(repos.boxFindings, row.id, claim.token, { state: "refused", reason: outcome.blank }, input.now);
      report.refused++; place(row).refused++;
      report.failuresByReason[outcome.blank] = (report.failuresByReason[outcome.blank] ?? 0) + 1;
    } else {
      await finishBoxFinding(repos.boxFindings, row.id, claim.token, { state: "built", publicationId: `${outcome.decision}:${outcome.factId ?? "current"}` }, input.now);
      report.published++; place(row).published++;
      report.publishedByRoute[route] = (report.publishedByRoute[route] ?? 0) + 1;
    }
  };

  const ready: { finding: Finding; slot: Routed; body: Target["body"]; holder: string | null; entityId: string }[] = [];
  const elections: { finding: Finding; kind: ElectionFieldKind; divisionId: string }[] = [];
  for (const row of rows) {
    report.looked++;
    if (!row.origins.some(o => o.kind === "SCOUT")) { await hold(row, "detective", "DETECTIVE_SPAN_NAMES_NO_FIELD"); continue; }
    const raw = findingFact(row);
    if (!raw || !row.exactQuote || !row.sourceUrl) { await hold(row, "other", "FINDING_HAS_NO_FIELD_VALUE_OR_QUOTE"); continue; }
    const slot = slotFor(raw.field, raw.value, raw.recordClass, row.exactQuote);
    if ("waiting" in slot) { await hold(row, slot.class, slot.waiting); continue; }
    if ("lead" in slot) { await wait(row, slot.class, slot.lead === "campaign-site" ? CAMPAIGN_SITE_LEAD : CANDIDATE_PROFILE_LEAD); report.handed++; continue; }
    const finding: Finding = { row, origin: raw.origin, field: raw.field, value: raw.value, exactQuote: row.exactQuote, sourceUrl: row.sourceUrl, recordClass: raw.recordClass };
    if ("election" in slot) {
      const divisionId = [row.subjectId, placeOf(row)].find(id => id.startsWith("ocd-division/"));
      if (divisionId) elections.push({ finding, kind: slot.election, divisionId });
      else await hold(row, slot.class, "SUBJECT_HAS_NO_DIVISION");
      continue;
    }
    const target = await targetOf(facts.query, row.subjectId);
    if (!target) { await hold(row, slot.class, "SUBJECT_HAS_NO_BODY_IN_THE_FACT_STORE"); continue; }
    if ((slot.class === "sittings") !== target.entityId.startsWith("meeting:")) { await hold(row, slot.class, slot.class === "sittings" ? "SUBJECT_IS_NOT_A_SITTING" : "SUBJECT_IS_A_SITTING"); continue; }
    ready.push({ finding, slot, body: target.body, holder: target.holder, entityId: target.entityId });
  }

  const captures = new Map<string, Promise<{ capture: WorkerPublicationCapture } | { error: string }>>();
  const readHeld = heldCaptureReader(input.vault);
  // The cited saved page proves the finding while it is inside the field's clock; otherwise code reads the address once more.
  const captureFor = (finding: Finding, kind: FieldKind) => {
    const key = `${finding.origin.artifactIds[0] ?? ""}|${finding.sourceUrl}|${kind}`;
    if (!captures.has(key)) captures.set(key, (async () => {
      const records = (await repos.artifacts.read(finding.origin.workItemId)).filter(record => finding.origin.artifactIds.includes(record.artifactId));
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
    const key = `${entry.entityId}|${entry.finding.origin.artifactIds[0] ?? entry.finding.sourceUrl}|${kindOf(entry.slot)}`;
    groups.set(key, [...groups.get(key) ?? [], entry]);
  }
  for (const group of groups.values()) {
    const { body, entityId } = group[0]!, kind = kindOf(group[0]!.slot);
    const read = await captureFor(group[0]!.finding, kind);
    if ("error" in read) {
      for (const { finding, slot } of group) await blocked(entityId, slot.slot, finding, kind, read.error, slot.class);
      continue;
    }
    const people = group.filter(entry => entry.slot.class === "rosters" || entry.slot.class === "contacts");
    if (people.length) {
      const seated = (await liveMembers(facts.query, [body.id])).map(row => row.name);
      const known = [...people.filter(e => e.slot.slot === "member_name").map(e => String(e.finding.value)), ...seated];
      const members = new Map<string, RosterMember & { fields: Record<string, unknown>; fieldSources: Record<string, { quote: string; sourceUrl: string; sourceOrg: string; collectedAt: string; verifiedAt: null }> }>();
      const sourceFieldOf = new Map<BoxFinding, { recordId: string; field: string }>();
      const quoteOf = (quote: string) => ({ quote, sourceUrl: read.capture.evidence.canonicalUrl, sourceOrg: "", collectedAt: read.capture.observedAt, verifiedAt: null });
      for (const { finding, slot: own, holder } of people) {
        const name = own.slot === "member_name" ? String(finding.value) : holder ?? known.find(candidate => named(finding.exactQuote, candidate));
        if (!name) { await settle(finding.row, { blank: "NO_PERSON_NAMED_IN_QUOTE" }, own.class); continue; }
        const recordId = `box:${nameKey(name)}`;
        const member = members.get(recordId) ?? { recordId, fields: {}, fieldSources: {} };
        const field = MEMBER_FIELD[own.slot as keyof typeof MEMBER_FIELD];
        if (field !== "name" && !member.fields.name) { member.fields.name = name; member.fieldSources.name = quoteOf(finding.exactQuote); }
        if (field !== "name" && member.fields[field] !== undefined && member.fields[field] !== finding.value) { await settle(finding.row, { blank: "OTHER_VALUE_ON_THE_SAME_PAGE" }, own.class); continue; }
        member.fields[field] = finding.value; member.fieldSources[field] = quoteOf(linkQuote(String(finding.value), finding.exactQuote));
        members.set(recordId, member);
        sourceFieldOf.set(finding.row, { recordId, field });
      }
      const unseated = new Set([...members.values()].filter(member => !seated.some(name => nameKey(name) === nameKey(String(member.fields.name))) &&
        !seatIn([member.fieldSources.name?.quote, member.fields.office, member.fieldSources.office?.quote].filter(Boolean).join("\n"), body.id)).map(member => member.recordId));
      const tally = await publishRosterFacts(facts, { body, capture: read.capture, members: [...members.values()].filter(member => !unseated.has(member.recordId)),
        complete: false, producedBy: "box" }, clocks, now);
      for (const { finding, slot } of people) {
        const at = sourceFieldOf.get(finding.row);
        if (at) await settle(finding.row, unseated.has(at.recordId) ? { blank: "SEAT_NOT_IN_QUOTE" } : tally.outcomes.get(at.recordId)?.get(at.field) ?? { blank: "NOT_CLAIMED" }, slot.class);
      }
    }
    const own = group.filter(entry => entry.slot.class !== "rosters" && entry.slot.class !== "contacts");
    if (!own.length) continue;
    const entity = (await readCheckEntity(facts.query, entityId))!;
    const copy = await facts.transaction(query => saveCaptureCopy(query, read.capture));
    const provenance = captureProvenance(read.capture, entity.hosts);
    const claim = (field: string, value: unknown, valueText: string, quote: string) =>
      publishClaim(facts, { entity, field, fieldKind: kind, provenance, value, valueText, quote, copy, producedBy: "box", costUsd: 0 }, clocks, now);
    for (const { finding, slot } of own) {
      const value = String(finding.value), quote = linkQuote(value, finding.exactQuote);
      if (slot.class === "official hosts") {
        const host = /^https?:\/\//i.test(value) ? value : `https://${value}`;
        const checked = checkFact({ entity, fieldKind: kind, provenance, valueText: value, quote, copy }, now, clocks.windowHours);
        if (checked.ok) await learnOfficialHost(facts.query, body.parentId ?? body.id, host);
        await settle(finding.row, checked.ok ? { decision: "PUBLISH", factId: null } : { blank: checked.reason }, slot.class);
        continue;
      }
      const outcome = slot.slot === "comment:period" ? await claim(slot.slot, value.toUpperCase(), finding.exactQuote, finding.exactQuote) : await claim(slot.slot, value, value, quote);
      // A page's own words on how to comment show the body takes it.
      if (slot.class === "comment rules" && slot.slot !== "comment:period" && !("blank" in outcome)) await claim("comment:period", "YES", finding.exactQuote, finding.exactQuote);
      await settle(finding.row, outcome, slot.class);
    }
  }

  const fields: { finding: Finding; field: ElectionFieldInput }[] = [];
  for (const { finding, kind, divisionId } of elections) {
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
  }
  if (fields.length) {
    let outcome: Awaited<ReturnType<typeof publishElectionFields>> | { readonly held: string };
    try { outcome = await publishElectionFields({ store: input.store, now: input.now, fields: fields.map(row => row.field), verify: section3Record }); }
    catch (error) { outcome = { held: error instanceof Error ? error.message : String(error) }; }
    for (const { finding, field } of fields) {
      if ("held" in outcome) { await settle(finding.row, { blank: outcome.held.split(":")[0]! }, "ballot navigation"); continue; }
      const gap = outcome.gaps.find(row => row.divisionId === field.divisionId && row.kind === field.kind);
      await settle(finding.row, outcome.fields.includes(electionFieldId(field)) ? { decision: "PUBLISH", factId: null }
        : { blank: `ELECTION_FIELD_GAP:${gap?.detail ?? "not published"}` }, "ballot navigation");
    }
  }
  return report;
}
