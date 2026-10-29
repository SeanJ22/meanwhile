import { createHash } from "node:crypto";
import type { BodySourceWiring } from "../../registry/source-wiring.ts";
import { subBodyId } from "../../civic-data/meeting-body-crosswalk.ts";
import { legistarMemberRosters } from "./members.ts";
import { memberName, currentMemberOffice, memberDay, type LegistarMembers } from "./members-model.ts";
import { bodyNameKey, publishedBodyLabel } from "../../civic-data/published-body-name.ts";

export function legistarMembersPackage(raw: LegistarMembers, rows: readonly BodySourceWiring[], now: string) {
  const own = rows.filter(row => row.config.slug === raw.slug);
  if (!own.length) throw new Error("LEGISTAR_MEMBERS_TENANT_UNBOUND");
  const jurisdictions = new Set(own.map(row => row.ocdId));
  const parent = own[0];
  const unbound: { key: string; detail: string }[] = [];
  const candidates = new Map<string, { body: LegistarMembers["bodies"][number]; row: BodySourceWiring }[]>();
  const selectors = new Set<number>();
  for (const body of raw.bodies) {
    const label = publishedBodyLabel(body.BodyName);
    // A calendar's meeting-type selector without seats is not a body and holds nothing up.
    if (label.kind !== "body" && !raw.offices.some(office => office.OfficeRecordBodyId === body.BodyId)) { selectors.add(body.BodyId); continue; }
    if (label.kind !== "body" && !label.name) {
      unbound.push({ key: `${raw.slug}:body:${body.BodyId}`, detail: "The seated calendar label does not identify a body" });
      continue;
    }
    const exact = own.filter(row => Number(row.config.eventBodyId) === body.BodyId);
    const wired = exact.length ? exact : own.filter(row => !row.config.eventBodyId && (row.config.eventBodyName || row.config.insiteBodyName) === body.BodyName);
    if (wired.length > 1 || wired.length === 0 && (jurisdictions.size !== 1 || parent.ocdId === null)) {
      unbound.push({ key: `${raw.slug}:body:${body.BodyId}`, detail: "The public body has no exact government binding in this shared tenant" });
      continue;
    }
    const owner = wired[0] ?? parent;
    const id = wired[0]?.bodyId ?? subBodyId(owner.ocdId!, body.BodyName);
    candidates.set(id, [...candidates.get(id) ?? [], { body, row: { ...owner, bodyId: id, config: { ...owner.config, eventBodyId: String(body.BodyId), bodyName: body.BodyName } } }]);
  }
  const seated = new Set(raw.offices.filter(office => memberName(office) && currentMemberOffice(office,memberDay(now,(own.find(row=>Number(row.config.eventBodyId)===office.OfficeRecordBodyId) ?? parent).timeZone))).map(office => office.OfficeRecordBodyId));
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
  // A seated calendar label (a study session, an addendum) is its tenant's real body under another selector.
  const folds = new Map<string, BodySourceWiring>();
  for (const row of bound) {
    const label = publishedBodyLabel(row.config.bodyName ?? "");
    if (label.kind === "body" || !label.name) continue;
    const real = bound.filter(other => other.ocdId === row.ocdId && publishedBodyLabel(other.config.bodyName ?? "").kind === "body"
      && bodyNameKey(other.config.bodyName ?? "") === bodyNameKey(label.name!));
    if (real.length === 1) folds.set(row.bodyId, real[0]);
  }
  const hash = createHash("sha256");
  for (const row of bound) hash.update(JSON.stringify([row.bodyId, row.ocdId, row.timeZone]));
  hash.update(JSON.stringify(unbound));
  hash.update(JSON.stringify([...folds].map(([label, real]) => [label, real.bodyId]).sort()));
  hash.update("body-names/1");
  let members = 0;
  for (const roster of legistarMemberRosters(raw, bound, now)) {
    hash.update(JSON.stringify([roster.bodyId, roster.bodyName]));
    for (const member of roster.members) {
      hash.update(JSON.stringify([member.id, member.personId, member.name, member.officeTitle, member.termStart, member.termEnd]));
      members++;
    }
  }
  return { bound, unbound, selectors, folds, signature: hash.digest("hex"), members };
}
