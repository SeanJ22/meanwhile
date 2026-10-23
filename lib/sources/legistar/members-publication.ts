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

export function legistarMembersPackage(raw: LegistarMembers, rows: readonly BodySourceWiring[], now: string) {
  const own = rows.filter(row => row.config.slug === raw.slug);
  if (!own.length) throw new Error("LEGISTAR_MEMBERS_TENANT_UNBOUND");
  const jurisdictions = new Set(own.map(row => row.ocdId));
  const parent = own[0];
  const unbound: { key: string; detail: string }[] = [];
  const candidates = new Map<string, { body: LegistarMembers["bodies"][number]; row: BodySourceWiring }[]>();
  for (const body of raw.bodies) {
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
  const [prior] = await input.facts.query("SELECT sha256 FROM fact_store_load WHERE source = $1", [source]);
  const unchanged = prior?.sha256 === prepared.signature;
  let records = 0, held = 0;
  if (!unchanged) {
    const offices = new Map(input.raw.offices.map(office => [office.OfficeRecordId, office]));
    const bodyFor = (owner: BodySourceWiring) => ({ id: owner.bodyId, name: owner.config.bodyName ?? owner.bodyId,
      state: /\/state:([a-z]{2})/.exec(owner.ocdId ?? "")?.[1]?.toUpperCase() ?? null, parentId: owner.ocdId });
    for (const owner of prepared.bound) {
      const body = bodyFor(owner);
      await ensureEntity(input.facts.query, { ...body, kind: "body" });
      await learnDoorChannel(input.facts.query, body.id, `https://webapi.legistar.com/v1/${input.raw.slug}/officerecords`);
    }
    for (const reading of input.raw.readings) {
      const url = new URL(reading.artifact.canonicalUrl);
      if (!url.pathname.endsWith("/bodies") || memberProbe(url)) continue;
      const capture = await legistarMemberCapture(input.vault, reading.artifact);
      for (const owner of prepared.bound) {
        const row = reading.ids.includes(Number(owner.config.eventBodyId)) ? input.raw.bodies.find(body => body.BodyId === Number(owner.config.eventBodyId)) : undefined;
        if (!row) continue;
        const [outcome] = await publishBodyFacts(input.facts, { bodyId: owner.bodyId, capture, producedBy: source, purge: input.purge,
          facts: [{ field: "name", value: row.BodyName.trim(), quote: jsonValues(row).join("\n") }] }, input.clocks, new Date(input.now));
        if (outcome && "blank" in outcome) throw new Error(`LEGISTAR_MEMBERS_FACTS_BLANK:body name ${owner.bodyId}:${outcome.blank}`);
        if (outcome && "decision" in outcome) { if (outcome.decision === "PUBLISH") records++; else if (outcome.decision !== "CONFIRM") held++; }
      }
    }
    for (const reading of input.raw.readings) {
      const url = new URL(reading.artifact.canonicalUrl);
      if (!url.pathname.endsWith("/officerecords") || memberProbe(url)) continue;
      const capture = await legistarMemberCapture(input.vault, reading.artifact);
      for (const roster of legistarMemberRosters(input.raw, prepared.bound, input.now, reading.artifact.canonicalUrl)) {
        const members = roster.members;
        if (!members.length) continue;
        const owner = prepared.bound.find(row => row.bodyId === roster.bodyId)!;
        const report = await publishRosterFacts(input.facts, { body: bodyFor(owner), capture, complete: false, producedBy: source, purge: input.purge,
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
          throw new Error(`LEGISTAR_MEMBERS_FACTS_BLANK:blanks=${report.blanks};${[...new Set(reasons)].join(",")}`);
        }
        held += report.held;
        records += report.live;
      }
    }
    for (const roster of legistarMemberRosters(input.raw, prepared.bound, input.now)) {
      const departed = await input.facts.query(`WITH own AS MATERIALIZED (
        SELECT id, field, status, provenance_kind, source_copy_id FROM fact WHERE entity_id = $1
      ) UPDATE fact f SET status = 'superseded', held_reason = 'NOT_ON_CURRENT_OFFICIAL_ROSTER'
        FROM own WHERE f.id = own.id AND own.status = 'live' AND own.provenance_kind = 'OFFICIAL' AND own.field LIKE 'member:%'
          AND (SELECT starts_with(url, $2) FROM source_copy WHERE id = own.source_copy_id)
          AND NOT EXISTS (SELECT 1 FROM entity_external_id x WHERE x.entity_id = substr(own.field, 8) AND x.scheme = $3 AND x.value = ANY($4::text[])) RETURNING f.id`,
      [roster.bodyId, `https://webapi.legistar.com/v1/${input.raw.slug}/officerecords?`, `legistar:${input.raw.slug}`,
        roster.members.map(member => member.nativeIds![`legistar:${input.raw.slug}`][0])]);
      if (departed.length) await invalidateReaderCache(await readerCacheScopeForEntity(input.facts.query, roster.bodyId), input.purge);
      records += departed.length;
    }
  }
  await input.facts.query(`INSERT INTO fact_store_load (source, sha256, loaded_at) VALUES ($1, $2, $3)
    ON CONFLICT (source) DO UPDATE SET sha256 = EXCLUDED.sha256, loaded_at = EXCLUDED.loaded_at`,
  [source, prepared.signature, input.now]);
  return { records, held, signature: prepared.signature, versionId: `${source}:${prepared.signature}`, checkedAt: input.now, unchanged,
    members: prepared.members, bodies: prepared.bound.length, gaps: prepared.unbound };
}
