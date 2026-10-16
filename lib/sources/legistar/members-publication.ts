import { createHash } from "node:crypto";
import type { BodySourceWiring } from "../../registry/source-wiring.ts";
import { subBodyId } from "../../civic-data/meeting-body-crosswalk.ts";
import { ensureEntity, learnDoorChannel } from "../../facts/entities.ts";
import { nameKey, publishRosterFacts } from "../../facts/roster-facts.ts";
import { vaultCapture } from "../../facts/capture.ts";
import { jsonValues } from "../../facts/source-copy.ts";
import type { Clocks, FactDb, Query } from "../../facts/publish.ts";
import type { EvidenceStore } from "../../control-plane/evidence/store.ts";
import { legistarMemberRosters, type LegistarMembers } from "./members.ts";

export function legistarMembersPackage(raw: LegistarMembers, rows: readonly BodySourceWiring[], now: string) {
  const own = rows.filter(row => row.config.slug === raw.slug);
  if (!own.length) throw new Error("LEGISTAR_MEMBERS_TENANT_UNBOUND");
  const jurisdictions = new Set(own.map(row => row.ocdId));
  const parent = own[0];
  const unbound: { key: string; detail: string }[] = [];
  const bound: BodySourceWiring[] = [];
  for (const body of raw.bodies) {
    const wired = own.filter(row => Number(row.config.eventBodyId) === body.BodyId || !row.config.eventBodyId &&
      (row.config.eventBodyName || row.config.insiteBodyName) === body.BodyName);
    if (wired.length > 1 || wired.length === 0 && (jurisdictions.size !== 1 || parent.ocdId === null)) {
      unbound.push({ key: `${raw.slug}:body:${body.BodyId}`, detail: "The public body has no exact government binding in this shared tenant" });
      continue;
    }
    const owner = wired[0] ?? parent;
    const id = wired[0]?.bodyId ?? subBodyId(owner.ocdId!, body.BodyName);
    if (bound.some(row => row.bodyId === id)) throw new Error("LEGISTAR_MEMBERS_BODY_ID_COLLISION");
    bound.push({ ...owner, bodyId: id, config: { ...owner.config, eventBodyId: String(body.BodyId), bodyName: body.BodyName } });
  }
  const hash = createHash("sha256");
  for (const row of bound) hash.update(JSON.stringify([row.bodyId, row.ocdId, row.timeZone]));
  hash.update(JSON.stringify(unbound));
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
  raw: LegistarMembers; rows: readonly BodySourceWiring[]; now: string;
}) {
  const prepared = legistarMembersPackage(input.raw, input.rows, input.now);
  const source = `legistar-members:${input.raw.slug}`;
  const [prior] = await input.facts.query("SELECT sha256 FROM fact_store_load WHERE source = $1", [source]);
  const unchanged = prior?.sha256 === prepared.signature;
  let records = 0;
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
      const url = new URL(reading.url);
      if (!url.pathname.endsWith("/officerecords") || url.searchParams.has("$select")) continue;
      const read = await vaultCapture({ vault: input.vault, url: reading.url, bytes: Buffer.from(reading.text),
        httpStatus: 200, contentType: "application/json", retrievedAt: reading.retrievedAt });
      if ("error" in read) throw new Error(`LEGISTAR_MEMBERS_EVIDENCE:${read.error}`);
      for (const roster of legistarMemberRosters(input.raw, prepared.bound, input.now, reading.url)) {
        const members = roster.members;
        if (!members.length) continue;
        const owner = prepared.bound.find(row => row.bodyId === roster.bodyId)!;
        const report = await publishRosterFacts(input.facts, { body: bodyFor(owner), capture: read.capture, complete: false, producedBy: source,
          shownMemberIds: new Map(members.map(member => [nameKey(member.name), member.id])),
          members: members.map(member => {
            const office = offices.get(Number(member.id.split(":office:").at(-1)))!;
            const quote = jsonValues(office).join("\n");
            return { recordId: member.id, externalIds: [[`legistar:${input.raw.slug}`, String(office.OfficeRecordPersonId)]],
              fields: { name: member.name, office: member.officeTitle, termStart: member.termStart, termEnd: member.termEnd },
              fieldSources: { termStart: { ...member.fieldSources!.name!, quote }, termEnd: { ...member.fieldSources!.name!, quote } } };
          }),
        }, input.clocks, new Date(input.now));
        if (report.held || report.blanks) {
          const reasons = [...report.outcomes.values()].flatMap(fields => [...fields].flatMap(([field, outcome]) =>
            "blank" in outcome ? [`${field}:${outcome.blank}`] : !["PUBLISH", "CONFIRM"].includes(outcome.decision) ? [`${field}:${outcome.decision}`] : []));
          throw new Error(`LEGISTAR_MEMBERS_FACTS_HELD:held=${report.held};blanks=${report.blanks};${[...new Set(reasons)].join(",")}`);
        }
        records += report.live;
      }
    }
    for (const roster of legistarMemberRosters(input.raw, prepared.bound, input.now)) {
      const departed = await input.facts.query(`UPDATE fact f SET status = 'superseded', held_reason = 'NOT_ON_CURRENT_OFFICIAL_ROSTER'
        FROM source_copy s WHERE s.id = f.source_copy_id AND starts_with(s.url, $2) AND f.entity_id = $1
          AND f.status = 'live' AND f.provenance_kind = 'OFFICIAL' AND f.field LIKE 'member:%'
          AND NOT EXISTS (SELECT 1 FROM entity_external_id x WHERE x.entity_id = substr(f.field, 8) AND x.scheme = $3 AND x.value = ANY($4::text[])) RETURNING f.id`,
      [roster.bodyId, `https://webapi.legistar.com/v1/${input.raw.slug}/officerecords?`, `legistar:${input.raw.slug}`,
        roster.members.map(member => member.nativeIds![`legistar:${input.raw.slug}`][0])]);
      if (departed.length) await input.facts.query("INSERT INTO rebuild_queue (place_id) SELECT place_id FROM entity_place WHERE entity_id = $1 ON CONFLICT DO NOTHING", [roster.bodyId]);
      records += departed.length;
    }
  }
  await input.facts.query(`INSERT INTO fact_store_load (source, sha256, loaded_at) VALUES ($1, $2, $3)
    ON CONFLICT (source) DO UPDATE SET sha256 = EXCLUDED.sha256, loaded_at = EXCLUDED.loaded_at`,
  [source, prepared.signature, input.now]);
  return { records, signature: prepared.signature, versionId: `${source}:${prepared.signature}`, checkedAt: input.now, unchanged,
    members: prepared.members, bodies: prepared.bound.length, gaps: prepared.unbound };
}
