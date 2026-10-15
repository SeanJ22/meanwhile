import { createHash } from "node:crypto";
import type { BodySourceWiring } from "../../registry/source-wiring.ts";
import { subBodyId } from "../../civic-data/meeting-body-crosswalk.ts";
import { canonicalCivicDataJson } from "../../civic-data/changes.ts";
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
  const rosters = legistarMemberRosters(raw, bound, now);
  const signature = createHash("sha256").update(canonicalCivicDataJson({
    bindings: bound.map(row => [row.bodyId, row.ocdId, row.timeZone]), unbound,
    rosters: rosters.map(roster => ({ bodyId: roster.bodyId, bodyName: roster.bodyName,
      members: roster.members.map(member => ({ id: member.id, personId: member.personId, name: member.name, office: member.officeTitle,
        termStart: member.termStart, termEnd: member.termEnd })) })),
  })).digest("hex");
  return { rosters, bound, unbound, signature };
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
    const captures = new Map<string, Awaited<ReturnType<typeof vaultCapture>>>();
    for (const reading of input.raw.readings) {
      const url = new URL(reading.url);
      if (!url.pathname.endsWith("/officerecords") || url.searchParams.has("$select")) continue;
      captures.set(reading.url, await vaultCapture({ vault: input.vault, url: reading.url, bytes: Buffer.from(reading.text),
        httpStatus: 200, contentType: "application/json", retrievedAt: reading.retrievedAt }));
    }
    for (const roster of prepared.rosters) {
      const owner = prepared.bound.find(row => row.bodyId === roster.bodyId)!;
      const state = /\/state:([a-z]{2})/.exec(owner.ocdId ?? "")?.[1]?.toUpperCase() ?? null;
      const body = { id: roster.bodyId, name: roster.bodyName ?? roster.bodyId, state, parentId: owner.ocdId };
      await ensureEntity(input.facts.query, { ...body, kind: "body" });
      await learnDoorChannel(input.facts.query, body.id, `https://webapi.legistar.com/v1/${input.raw.slug}/officerecords`);
      const people = new Set<string>();
      for (const [url, read] of captures) {
        if ("error" in read) throw new Error(`LEGISTAR_MEMBERS_EVIDENCE:${read.error}`);
        const members = roster.members.filter(member => member.fieldSources?.name?.sourceUrl === url);
        if (!members.length) continue;
        const report = await publishRosterFacts(input.facts, { body, capture: read.capture, complete: false, producedBy: source,
          shownMemberIds: new Map(members.map(member => [nameKey(member.name), member.id])),
          members: members.map(member => {
            const office = input.raw.offices.find(office => member.id.endsWith(`:office:${office.OfficeRecordId}`))!;
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
        for (const person of report.people.values()) people.add(person);
        records += report.live;
      }
      const departed = await input.facts.query(`UPDATE fact f SET status = 'superseded', held_reason = 'NOT_ON_CURRENT_OFFICIAL_ROSTER'
        FROM source_copy s WHERE s.id = f.source_copy_id AND starts_with(s.url, $2) AND f.entity_id = $1
          AND f.status = 'live' AND f.provenance_kind = 'OFFICIAL' AND f.field LIKE 'member:%'
          AND NOT (substr(f.field, 8) = ANY($3::text[])) RETURNING f.id`,
      [body.id, `https://webapi.legistar.com/v1/${input.raw.slug}/officerecords?`, [...people]]);
      if (departed.length) await input.facts.query("INSERT INTO rebuild_queue (place_id) SELECT place_id FROM entity_place WHERE entity_id = $1 ON CONFLICT DO NOTHING", [body.id]);
      records += departed.length;
    }
  }
  await input.facts.query(`INSERT INTO fact_store_load (source, sha256, loaded_at) VALUES ($1, $2, $3)
    ON CONFLICT (source) DO UPDATE SET sha256 = EXCLUDED.sha256, loaded_at = EXCLUDED.loaded_at`,
  [source, prepared.signature, input.now]);
  return { records, signature: prepared.signature, versionId: `${source}:${prepared.signature}`, checkedAt: input.now, unchanged,
    members: prepared.rosters.reduce((total, roster) => total + roster.members.length, 0), bodies: prepared.rosters.length, gaps: prepared.unbound };
}
