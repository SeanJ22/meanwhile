import { finishBoxFinding, holdBoxFinding, takeBoxFinding, type BoxFinding, type BoxOrigin } from "../control-plane/box.ts";
import type { EvidenceStore } from "../control-plane/evidence/store.ts";
import type { ControlPlaneRepositories } from "../control-plane/repository/types.ts";
import type { ScoutFinding, ScoutResult } from "../control-plane/scheduler/scout-result.ts";
import { heldCaptureReader } from "../civic-data/worker-publication-context.ts";
import type { WorkerPublicationCapture } from "../civic-data/worker-roster-publication.ts";
import type { ProbeFetch } from "../doors/probe.ts";
import { captureProvenance, fetchCapture } from "./capture.ts";
import { boundedIndexOf, normalizeText, type FieldKind } from "./check.ts";
import { readCheckEntity } from "./entity-read.ts";
import { FINDING_SLOTS_VERSION, slotFor, type FindingSlot } from "./finding-slots.ts";
import { openBlank, publishClaim, type Clocks, type FactDb, type PublishOutcome, type Query } from "./publish.ts";
import { nameKey, publishRosterFacts, type RosterMember } from "./roster-facts.ts";
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
  readonly refused: number;
  readonly waitingByClass: Readonly<Record<string, number>>;
  readonly failuresByReason: Readonly<Record<string, number>>;
  readonly byPlace: Readonly<Record<string, { published: number; refused: number; waiting: number }>>;
}

const KIND: Readonly<Record<string, FieldKind>> = { rosters: "officeholder", contacts: "contact", "office contacts": "contact", schedules: "meeting", "comment rules": "comment_rule" };

/** The body a hunter's subject stands for: the body itself, or a government's own governing board. */
async function bodyForSubject(query: Query, subjectId: string): Promise<{ id: string; name: string; state: string | null; parentId: string | null } | null> {
  const [row] = await query(`SELECT b.id, b.name, b.state, b.parent_id FROM entity s JOIN entity b ON b.id = s.id AND s.kind = 'body' WHERE s.id = $1
    UNION ALL SELECT b.id, b.name, b.state, b.parent_id FROM entity s JOIN entity b ON b.parent_id = s.id AND b.kind = 'body'
      AND (b.id LIKE '%#governing' OR b.id LIKE '%#board') WHERE s.id = $1 AND s.kind = 'government' LIMIT 1`, [subjectId]);
  return row ? { id: String(row.id), name: String(row.name), state: row.state as string | null, parentId: row.parent_id as string | null } : null;
}

/** Live member names on a body, so an office or contact finding can join the person its quote names. */
async function memberNames(query: Query, bodyId: string): Promise<readonly string[]> {
  return (await query("SELECT value->>'name' AS name FROM fact WHERE entity_id = $1 AND status = 'live' AND field LIKE 'member:%'", [bodyId])).map(row => String(row.name));
}

const named = (quote: string, name: string) => boundedIndexOf(normalizeText(quote).toLowerCase(), normalizeText(name).toLowerCase()) !== -1;

/** Box findings from the last month, each through its slot, checked on its own page and published; what has no slot waits with its reason. */
export async function publishBoxFindings(input: {
  readonly repos: Pick<ControlPlaneRepositories, "boxFindings" | "scoutResults" | "artifacts">;
  readonly facts: FactDb & { readonly query: Query }; readonly vault: EvidenceStore; readonly fetch: ProbeFetch;
  readonly clocks: Clocks; readonly now: string; readonly limit: number;
}): Promise<BoxPublicationReport> {
  const { repos, facts, clocks } = input;
  const now = new Date(input.now), since = now.getTime() - HUNTER_FINDING_DAYS * 86_400_000;
  const report = { looked: 0, published: 0, refused: 0, waitingByClass: {} as Record<string, number>, failuresByReason: {} as Record<string, number>,
    byPlace: {} as Record<string, { published: number; refused: number; waiting: number }> };
  const place = (subjectId: string) => report.byPlace[subjectId] ??= { published: 0, refused: 0, waiting: 0 };
  const [waiting, taken] = await Promise.all([repos.boxFindings.listWhere(["state"], "waiting"), repos.boxFindings.listWhere(["state"], "taken")]);
  const rows = [...waiting, ...taken].map(row => row.value).filter(row =>
    (row.state === "waiting" && row.waitingFor?.slots !== FINDING_SLOTS_VERSION || row.state === "taken" && row.claim !== null && row.claim.expiresAt <= input.now) &&
    row.origins.some(origin => Date.parse(origin.recordedAt) >= since)).slice(0, input.limit);
  const results = new Map<string, Promise<ScoutResult | undefined>>();
  const resultOf = (origin: BoxOrigin & { resultKey: string }) => {
    if (!results.has(origin.resultId)) results.set(origin.resultId, repos.scoutResults.readWhere(origin.resultKey, ["attemptId"], origin.resultId)
      .then(found => found.find(result => result.attemptId === origin.resultId)));
    return results.get(origin.resultId)!;
  };
  const hold = async (row: BoxFinding, slotClass: string, reason: string) => {
    await holdBoxFinding(repos.boxFindings, row.id, { class: slotClass, reason, slots: FINDING_SLOTS_VERSION }, input.now);
    report.waitingByClass[slotClass] = (report.waitingByClass[slotClass] ?? 0) + 1;
    place(row.subjectId).waiting++;
  };
  const settle = async (row: BoxFinding, outcome: PublishOutcome) => {
    const claim = await takeBoxFinding(repos.boxFindings, row.id, "fact-publisher", input.now, new Date(now.getTime() + 120_000).toISOString());
    if (!claim) return;
    if ("blank" in outcome) {
      await finishBoxFinding(repos.boxFindings, row.id, claim.token, { state: "refused", reason: outcome.blank }, input.now);
      report.refused++; place(row.subjectId).refused++;
      report.failuresByReason[outcome.blank] = (report.failuresByReason[outcome.blank] ?? 0) + 1;
    } else {
      await finishBoxFinding(repos.boxFindings, row.id, claim.token, { state: "built", publicationId: `${outcome.decision}:${outcome.factId ?? "current"}` }, input.now);
      report.published++; place(row.subjectId).published++;
    }
  };

  const ready: { finding: Finding; slot: Exclude<FindingSlot, { waiting: string }>; body: NonNullable<Awaited<ReturnType<typeof bodyForSubject>>> }[] = [];
  for (const row of rows) {
    report.looked++;
    const origin = row.origins.find(o => o.kind === "SCOUT" && (o.reported || o.resultKey) && Date.parse(o.recordedAt) >= since);
    if (!origin) { await hold(row, "detective", "DETECTIVE_SPAN_NAMES_NO_FIELD"); continue; }
    const result = origin.reported || !origin.resultKey ? undefined : await resultOf({ ...origin, resultKey: origin.resultKey });
    const raw: Partial<ScoutFinding> = origin.reported ? { field: origin.reported.field, value: origin.reported.value } : result?.findings[origin.findingIndex] ?? {};
    if (!raw.field || raw.value === undefined || raw.value === null || !row.exactQuote || !row.sourceUrl) { await hold(row, "other", "FINDING_HAS_NO_FIELD_VALUE_OR_QUOTE"); continue; }
    const slot = slotFor(raw.field, raw.value, result?.recordClass ?? null);
    if ("waiting" in slot) { await hold(row, slot.class, slot.waiting); continue; }
    const body = await bodyForSubject(facts.query, row.subjectId);
    if (!body) { await hold(row, slot.class, "SUBJECT_HAS_NO_BODY_IN_THE_FACT_STORE"); continue; }
    ready.push({ finding: { row, origin, field: raw.field, value: raw.value, exactQuote: row.exactQuote, sourceUrl: row.sourceUrl, recordClass: result?.recordClass ?? null }, slot, body });
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

  const groups = new Map<string, typeof ready>();
  for (const entry of ready) {
    const key = `${entry.body.id}|${entry.finding.origin.artifactIds[0] ?? entry.finding.sourceUrl}|${KIND[entry.slot.class]}`;
    groups.set(key, [...groups.get(key) ?? [], entry]);
  }
  for (const group of groups.values()) {
    const { body, slot } = group[0]!, kind = KIND[slot.class]!;
    const read = await captureFor(group[0]!.finding, kind);
    if ("error" in read) {
      for (const { finding, slot: own } of group) {
        await openBlank(facts.query, { entityId: body.id, field: "slot" in own ? own.slot : finding.field, stage: "ACQUIRE", reason: "SOURCE_BLOCKED",
          detail: `${finding.sourceUrl}: ${read.error}`, retryMinutes: clocks.retryMinutes(kind) });
        await settle(finding.row, { blank: `SOURCE_BLOCKED:${read.error}` });
      }
      continue;
    }
    const people = group.filter(entry => entry.slot.class === "rosters" || entry.slot.class === "contacts");
    if (people.length) {
      const known = [...people.filter(e => e.slot.slot === "member_name").map(e => String(e.finding.value)), ...await memberNames(facts.query, body.id)];
      const members = new Map<string, RosterMember & { fields: Record<string, unknown>; fieldSources: Record<string, { quote: string; sourceUrl: string; sourceOrg: string; collectedAt: string; verifiedAt: null }> }>();
      const sourceFieldOf = new Map<BoxFinding, { recordId: string; field: string }>();
      const quoteOf = (quote: string) => ({ quote, sourceUrl: read.capture.evidence.canonicalUrl, sourceOrg: "", collectedAt: read.capture.observedAt, verifiedAt: null });
      for (const { finding, slot: own } of people) {
        const name = own.slot === "member_name" ? String(finding.value) : known.find(candidate => named(finding.exactQuote, candidate));
        if (!name) { await settle(finding.row, { blank: "NO_PERSON_NAMED_IN_QUOTE" }); continue; }
        const recordId = `box:${nameKey(name)}`;
        const member = members.get(recordId) ?? { recordId, fields: {}, fieldSources: {} };
        const field = own.slot === "member_name" ? "name" : own.slot === "member_office" ? "office" : own.slot;
        if (field !== "name" && !member.fields.name) { member.fields.name = name; member.fieldSources.name = quoteOf(finding.exactQuote); }
        if (field !== "name" && member.fields[field] !== undefined && member.fields[field] !== finding.value) { await settle(finding.row, { blank: "OTHER_VALUE_ON_THE_SAME_PAGE" }); continue; }
        member.fields[field] = finding.value; member.fieldSources[field] = quoteOf(finding.exactQuote);
        members.set(recordId, member);
        sourceFieldOf.set(finding.row, { recordId, field });
      }
      const tally = await publishRosterFacts(facts, { body, capture: read.capture, members: [...members.values()], complete: false, producedBy: "box" }, clocks, now);
      for (const { finding } of people) {
        const at = sourceFieldOf.get(finding.row);
        if (at) await settle(finding.row, tally.outcomes.get(at.recordId)?.get(at.field) ?? { blank: "NOT_CLAIMED" });
      }
    }
    const own = group.filter(entry => entry.slot.class !== "rosters" && entry.slot.class !== "contacts");
    if (!own.length) continue;
    const entity = (await readCheckEntity(facts.query, body.id))!;
    const copy = await facts.transaction(query => saveCaptureCopy(query, read.capture));
    const provenance = captureProvenance(read.capture, entity.hosts);
    const claim = (field: string, value: unknown, valueText: string, quote: string) =>
      publishClaim(facts, { entity, field, fieldKind: kind, provenance, value, valueText, quote, copy, producedBy: "box", costUsd: 0 }, clocks, now);
    for (const { finding, slot: mapped } of own) {
      const field = (mapped as { slot: string }).slot, value = String(finding.value);
      const outcome = field === "comment:period" ? await claim(field, value.toUpperCase(), finding.exactQuote, finding.exactQuote) : await claim(field, value, value, finding.exactQuote);
      // A page's own words on how to comment show the body takes it.
      if (mapped.class === "comment rules" && field !== "comment:period" && !("blank" in outcome)) await claim("comment:period", "YES", finding.exactQuote, finding.exactQuote);
      await settle(finding.row, outcome);
    }
  }
  return report;
}
