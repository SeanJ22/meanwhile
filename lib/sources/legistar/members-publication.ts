import { createHash } from "node:crypto";
import type { BodySourceWiring } from "../../registry/source-wiring.ts";
import { subBodyId } from "../../civic-data/meeting-body-crosswalk.ts";
import { ensureEntity, learnDoorChannel } from "../../facts/entities.ts";
import { nameKey, publishBodyFacts, publishRosterFacts } from "../../facts/roster-facts.ts";
import { jsonValues } from "../../facts/source-copy.ts";
import type { Clocks, FactDb, Query } from "../../facts/publish.ts";
import type { EvidenceStore } from "../../control-plane/evidence/store.ts";
import { invalidateReaderCache, readerCacheScopeForEntity, type ReaderCachePurger } from "../../reader/cache.ts";
import { legistarMemberRosters } from "./members.ts";
import { memberProbe, type LegistarMembers } from "./members-model.ts";
import { legistarMemberCapture } from "./members-cache.ts";
import { publishedBodyLabel } from "../../civic-data/published-body-name.ts";

export function legistarMembersPackage(raw: LegistarMembers, rows: readonly BodySourceWiring[], now: string) {
  const own = rows.filter(row => row.config.slug === raw.slug);
  if (!own.length) throw new Error("LEGISTAR_MEMBERS_TENANT_UNBOUND");
  const jurisdictions = new Set(own.map(row => row.ocdId));
  const parent = own[0];
  const unbound: { key: string; detail: string }[] = [];
  const candidates = new Map<string, { body: LegistarMembers["bodies"][number]; row: BodySourceWiring }[]>();
  for (const body of raw.bodies) {
    const label = publishedBodyLabel(body.BodyName);
    // Calendar selectors without seats are not bodies and must not hold up the roster.
    if (label.kind !== "body" && !raw.offices.some(office => office.OfficeRecordBodyId === body.BodyId)) continue;
    if (label.kind !== "body" && !label.name) {
      unbound.push({ key: `${raw.slug}:body:${body.BodyId}`, detail: "The seated calendar label does not identify a body" });
      continue;
    }
    const wired = own.filter(row => Number(row.config.eventBodyId) === body.BodyId || !row.config.eventBodyId &&
      (row.config.eventBodyName || row.config.insiteBodyName) === body.BodyName);
    if (wired.length > 1 || wired.length === 0 && (jurisdictions.size !== 1 || parent.ocdId === null)) {
      unbound.push({ key: `${raw.slug}:body:${body.BodyId}`, detail: "The public body has no exact government binding in this shared tenant" });
      continue;
    }
    const owner = wired[0] ?? parent;
    const id = wired[0]?.bodyId ?? subBodyId(owner.ocdId!, body.BodyName);
    candidates.set(id, [...candidates.get(id) ?? [], { body, row: { ...owner, bodyId: id, config: { ...owner.config, eventBodyId: String(body.BodyId), bodyName: body.BodyName } } }]);
  }
  const seated = new Set(raw.offices.map(office => office.OfficeRecordBodyId));
  const listed = new Set(raw.bodies.map(body => body.BodyId));
  for (const id of [...seated].filter(id => !listed.has(id)).sort((a, b) => a - b)) {
    unbound.push({ key: `${raw.slug}:office-body:${id}`, detail: "Current office records name a body this tenant does not list" });
  }
  const bound: BodySourceWiring[] = [];
  for (const group of candidates.values()) {
    // Two tenant bodies that read as one government body (a renamed or re-entered board) are one body only while a single one holds current seats.
    const current = group.length === 1 ? group : group.filter(candidate => seated.has(candidate.body.BodyId));
    if (current.length > 1) {
      for (const candidate of current) unbound.push({ key: `${raw.slug}:body:${candidate.body.BodyId}`, detail: "Two public bodies in this tenant carry the same name and both hold current seats" });
    } else bound.push((current[0] ?? group[0]).row);
  }
  const hash = createHash("sha256");
  for (const row of bound) hash.update(JSON.stringify([row.bodyId, row.ocdId, row.timeZone]));
  hash.update(JSON.stringify(unbound));
  hash.update("body-names/1");
  let members = 0;
  for (const roster of legistarMemberRosters(raw, bound, now)) {
    hash.update(JSON.stringify([roster.bodyId, roster.bodyName]));
    for (const member of roster.members) {
      hash.update(JSON.stringify([member.id, member.personId, member.name, member.officeTitle, member.termStart, member.termEnd]));
      members++;
    }
  }
  return { bound, unbound, signature: hash.digest("hex"), members };
}

export async function publishLegistarMembers(input: {
  facts: FactDb & { readonly query: Query }; vault: EvidenceStore; clocks: Clocks;
  raw: LegistarMembers; rows: readonly BodySourceWiring[]; now: string; purge?: ReaderCachePurger;
}) {
  const prepared = legistarMembersPackage(input.raw, input.rows, input.now);
  const source = `legistar-members:${input.raw.slug}`;
  const [prior] = await input.facts.query("SELECT sha256, loaded_at FROM fact_store_load WHERE source = $1", [source]);
  const unchanged = prior?.sha256 === prepared.signature;
  const loadedAt = prior?.loaded_at instanceof Date ? prior.loaded_at.getTime() : Date.parse(String(prior?.loaded_at ?? ""));
  // A real full reread confirms unchanged facts; a row-version probe does not redate the retained source pages.
  const fullEvidenceMoved = input.raw.readings.some(reading => !memberProbe(new URL(reading.artifact.canonicalUrl)) &&
    Date.parse(reading.artifact.retrievedAt) > loadedAt);
  let records = 0, held = 0, blanks = 0;
  const blankReasons: Record<string, number> = {};
  if (!unchanged || fullEvidenceMoved) {
    const offices = new Map(input.raw.offices.map(office => [office.OfficeRecordId, office]));
    const bodyFor = (owner: BodySourceWiring) => ({ id: owner.bodyId, name: owner.config.bodyName ?? owner.bodyId,
      state: /\/state:([a-z]{2})/.exec(owner.ocdId ?? "")?.[1]?.toUpperCase() ?? null, parentId: owner.ocdId, government: owner.config.governmentId });
    const bound: BodySourceWiring[] = [];
    // Seed named bodies before resolving calendar labels that refer to them.
    for (const owner of [...prepared.bound].sort((a, b) => Number(publishedBodyLabel(a.config.bodyName ?? "").kind !== "body") - Number(publishedBodyLabel(b.config.bodyName ?? "").kind !== "body"))) {
      const body = bodyFor(owner);
      const id = await ensureEntity(input.facts.query, { ...body, kind: "body" });
      bound.push({ ...owner, bodyId: id });
      await learnDoorChannel(input.facts.query, id, `https://webapi.legistar.com/v1/${input.raw.slug}/officerecords`);
    }
    for (const reading of input.raw.readings) {
      const url = new URL(reading.artifact.canonicalUrl);
      if (!url.pathname.endsWith("/bodies") || memberProbe(url)) continue;
      const capture = legistarMemberCapture(reading);
      for (const owner of bound) {
        const row = reading.ids.includes(Number(owner.config.eventBodyId)) ? input.raw.bodies.find(body => body.BodyId === Number(owner.config.eventBodyId)) : undefined;
        if (!row || publishedBodyLabel(row.BodyName).kind !== "body") continue;
        const [outcome] = await publishBodyFacts(input.facts, { bodyId: owner.bodyId, capture, producedBy: source, purge: input.purge, acquisition: "loader",
          facts: [{ field: "name", value: row.BodyName.trim(), quote: jsonValues(row).join("\n") }] }, input.clocks, new Date(input.now));
        if (outcome && "blank" in outcome) { blanks++; blankReasons[`name:${outcome.blank}`] = (blankReasons[`name:${outcome.blank}`] ?? 0) + 1; }
        if (outcome && "decision" in outcome) { if (outcome.decision === "PUBLISH") records++; else if (outcome.decision !== "CONFIRM") held++; }
      }
    }
    for (const reading of input.raw.readings) {
      const url = new URL(reading.artifact.canonicalUrl);
      if (!url.pathname.endsWith("/officerecords") || memberProbe(url)) continue;
      const capture = legistarMemberCapture(reading);
      for (const roster of legistarMemberRosters(input.raw, bound, input.now, reading.artifact.canonicalUrl)) {
        const members = roster.members;
        if (!members.length) continue;
        const owner = bound.find(row => row.bodyId === roster.bodyId)!;
        const report = await publishRosterFacts(input.facts, { body: bodyFor(owner), capture, complete: false, producedBy: source, purge: input.purge, acquisition: "loader", nameFromPage: false,
          shownMemberIds: new Map(members.map(member => [nameKey(member.name), member.id])),
          members: members.map(member => {
            const office = offices.get(Number(member.id.split(":office:").at(-1)))!;
            const quote = jsonValues(office).join("\n");
            return { recordId: member.id, externalIds: [[`legistar:${input.raw.slug}`, String(office.OfficeRecordPersonId)]],
              fields: { name: member.name, office: member.officeTitle, termStart: member.termStart, termEnd: member.termEnd },
              fieldSources: { termStart: { ...member.fieldSources!.name!, quote }, termEnd: { ...member.fieldSources!.name!, quote } } };
          }),
        }, input.clocks, new Date(input.now));
        if (report.blanks) {
          const reasons = [...report.outcomes.values()].flatMap(fields => [...fields].flatMap(([field, outcome]) => "blank" in outcome ? [`${field}:${outcome.blank}`] : []));
          blanks += report.blanks;
          for (const reason of reasons) blankReasons[reason] = (blankReasons[reason] ?? 0) + 1;
        }
        held += report.held;
        records += report.live;
      }
    }
    const rosters = [...legistarMemberRosters(input.raw, bound, input.now)];
    for (const bodyId of new Set(rosters.map(roster => roster.bodyId))) {
      const members = rosters.filter(roster => roster.bodyId === bodyId).flatMap(roster => roster.members);
      const departed = await input.facts.query(`WITH own AS MATERIALIZED (
        SELECT id, field, status, provenance_kind, source_copy_id FROM checked_fact WHERE entity_id = $1
      ) UPDATE fact f SET status = 'superseded', held_reason = 'NOT_ON_CURRENT_OFFICIAL_ROSTER'
        FROM own WHERE f.id = own.id AND own.status = 'live' AND own.provenance_kind = 'OFFICIAL' AND own.field LIKE 'member:%'
          AND (SELECT starts_with(url, $2) FROM source_copy WHERE id = own.source_copy_id)
          AND NOT EXISTS (SELECT 1 FROM entity_external_id x WHERE x.entity_id = substr(own.field, 8) AND x.scheme = $3 AND x.value = ANY($4::text[])) RETURNING f.id`,
      [bodyId, `https://webapi.legistar.com/v1/${input.raw.slug}/officerecords?`, `legistar:${input.raw.slug}`,
        members.map(member => member.nativeIds![`legistar:${input.raw.slug}`][0])]);
      if (departed.length) await invalidateReaderCache(await readerCacheScopeForEntity(input.facts.query, bodyId), input.purge, input.facts.query);
      records += departed.length;
    }
  }
  await input.facts.query(`INSERT INTO fact_store_load (source, sha256, loaded_at) VALUES ($1, $2, $3)
    ON CONFLICT (source) DO UPDATE SET sha256 = EXCLUDED.sha256, loaded_at = EXCLUDED.loaded_at`,
  [source, prepared.signature, input.now]);
  return { records, held, blanks, blankReasons, signature: prepared.signature, versionId: `${source}:${prepared.signature}`, checkedAt: input.now, unchanged,
    members: prepared.members, bodies: prepared.bound.length, gaps: prepared.unbound };
}
