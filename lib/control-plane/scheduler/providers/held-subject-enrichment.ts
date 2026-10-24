import { buildPlaceOwedList, missingPlaceWork, type HeldPlaceField, type PlaceSubject } from "../../../coverage/place-owed.ts";
import { FRESHNESS_HOURS } from "../../../coverage/checklist-map.ts";
import type { RegistryRuntimeReadModel } from "../../../registry/runtime-data-plane.ts";
import type { Jurisdiction } from "../../../hunt/jurisdiction-universe.ts";
import { sourceRequestHeaders } from "../../../sources/http.ts";
import type { ProvidedObligation } from "../registry.ts";
import { fingerprint } from "../../ids.ts";
import type { Officeholder } from "../../../officials/types.ts";
import { FIPS_TO_STATE } from "../../../ocd/fips.ts";

/** Canonical held identity and sources; a task acquires details for exactly this subject. */
export interface HeldSubjectDetails {
  readonly subjectId: string;
  readonly subjectKind: "body" | "official" | "government";
  readonly bodyId: string | null;
  readonly bodyName: string | null;
  readonly personId: string | null;
  readonly heldMemberId: string | null;
  readonly personName: string | null;
  readonly officeTitle: string | null;
  readonly governmentId: string | null;
  /** The government's held jurisdiction; never the provider's fallback state scope. */
  readonly governmentDivisionIds?: readonly string[];
  readonly governmentClass?: string | null;
  readonly sourceUrl: string;
  readonly sourceUrls: readonly string[];
  readonly profileUrls: readonly string[];
  readonly divisionIds: readonly string[];
  readonly checklistIds: readonly string[];
  readonly needsMembers: boolean;
  readonly label: string;
  readonly checkedAt: string | null;
}

export type HeldGovernmentDetails = Pick<Jurisdiction, "id" | "name" | "stateCode" | "ownWebAddress"> &
  Partial<Pick<Jurisdiction, "ocdId" | "bodyId" | "censusId" | "govClass">> & { readonly checkedAt?: string | null };

const publicUrl = (value: string | null | undefined): string | null => {
  try { const url = new URL(value ?? ""); return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : null; }
  catch { return null; }
};
const stateOf = (id: string) => /\/(?:state|district|territory):([a-z]{2})(?:\/|$)/i.exec(id)?.[1]?.toLowerCase();
const urls = (values: readonly (string | null | undefined)[]) => [...new Set(values.flatMap(value => publicUrl(value) ?? []))];
// An ordering, never a ceiling: every other owed item follows these reader-facing details.
const FIRST = ["OFF-04", "OFF-09", "GOV-08", "MTG-01", "MTG-04", "OFF-06", "GOV-03", "OFF-12"];
const rank = (id: string) => { const at = FIRST.indexOf(id); return at < 0 ? FIRST.length : at; };
const byItem = (a: string, b: string) => rank(a) - rank(b) || a.localeCompare(b);

/** The normal owed list supplies every missing family. Known URLs are re-read; this never discovers a new subject or place. */
export function heldSubjectDetails(registry: RegistryRuntimeReadModel, state: string, now: string,
  governments: readonly HeldGovernmentDetails[] = [], heldPeople: readonly Officeholder[] = [], liveFields: readonly HeldPlaceField[] = []): readonly HeldSubjectDetails[] {
  const own = state.toLowerCase();
  const divisions = registry.registry.divisions.filter(division => stateOf(division.ocdId) === own);
  const planningDivisions = divisions.map(division => ({ id: division.ocdId, label: division.label }));
  const ids = new Set(divisions.map(division => division.ocdId));
  const nativeStateScope = (): string | null => {
    const place = Object.values(FIPS_TO_STATE).find(place => place.postal.toLowerCase() === own);
    if (!place) return null;
    const id = `ocd-division/country:us/${place.prefix}:${own}`;
    if (!ids.has(id)) { ids.add(id); planningDivisions.push({ id, label: state.toUpperCase() }); }
    return id;
  };
  const held: HeldPlaceField[] = [], subjects: PlaceSubject[] = [];
  const targets = new Map<string, HeldSubjectDetails>();
  const field = (subjectId: string, checklistId: string, sourceUrl: string | null | undefined, checkedAt: string | null | undefined, value: unknown) => {
    if (!sourceUrl || !checkedAt || !Number.isFinite(Date.parse(checkedAt))) return;
    held.push({ subjectId, checklistId, sourceUrl, checkedAt, value, state: "published",
      freshUntil: new Date(Date.parse(checkedAt) + FRESHNESS_HOURS.registryRecord * 3_600_000).toISOString() });
  };
  const put = (input: Omit<HeldSubjectDetails, "sourceUrl" | "checklistIds">, kind: PlaceSubject["kind"], captureKind?: PlaceSubject["captureKind"]) => {
    if (!input.sourceUrls.length || !input.divisionIds.length) return;
    targets.set(input.subjectId, { ...input, sourceUrl: input.sourceUrls[0]!, checklistIds: [] });
    subjects.push({ id: input.subjectId, kind, divisionIds: input.divisionIds, label: input.label, ...(captureKind ? { captureKind } : {}) });
  };
  const bodies = new Map(registry.registry.bodies.map(body => [body.id, body]));
  for (const body of bodies.values()) {
    if (!body.name || !body.bodyClass || !body.provenance.sourceUrl) continue;
    const divisionIds = [...new Set([body.ocdId, ...body.alsoServesOcdIds ?? []].filter((id): id is string => Boolean(id && ids.has(id))))];
    const roster = registry.bodyRosters.find(roster => roster.bodyId === body.id);
    put({ subjectId: body.id, subjectKind: "body", bodyId: body.id, bodyName: body.name, personId: null, heldMemberId: null,
      personName: null, officeTitle: null, governmentId: null, sourceUrls: urls([roster?.sourceUrl, body.homepageUrl, body.provenance.sourceUrl]),
      profileUrls: [], divisionIds, needsMembers: !roster?.members.length, label: body.name, checkedAt: body.provenance.collectedAt }, "body", "registry-body");
    field(body.id, "GOV-01", body.provenance.sourceUrl, body.provenance.collectedAt, { name: body.name, type: body.bodyClass });
    if (body.homepageUrl && (body.officePhone || body.officeAddress)) field(body.id, "GOV-08", body.provenance.sourceUrl,
      body.provenance.collectedAt, { homepageUrl: body.homepageUrl, officePhone: body.officePhone, officeAddress: body.officeAddress });
    if (body.agendaSourceRef) field(`${body.id}#calendar`, "MTG-01", body.provenance.sourceUrl, body.provenance.collectedAt, body.agendaSourceRef);
    if (body.meetingCadence) field(`${body.id}#calendar`, "MTG-04", body.meetingCadenceSource?.sourceUrl ?? body.provenance.sourceUrl,
      body.meetingCadenceSource?.collectedAt ?? body.provenance.collectedAt, body.meetingCadence);
    for (const member of roster?.members ?? []) {
      if (!member.name || !member.officeTitle) continue;
      const source = member.membershipSource ?? roster!;
      put({ subjectId: member.id, subjectKind: "official", bodyId: body.id, bodyName: body.name,
        personId: member.personId ?? member.id, heldMemberId: member.id, personName: member.name, officeTitle: member.officeTitle, governmentId: null,
        sourceUrls: urls([member.websiteUrl, source.sourceUrl, roster?.sourceUrl]), profileUrls: urls([member.websiteUrl]), divisionIds,
        needsMembers: false, label: `${member.name}, ${member.officeTitle}`, checkedAt: source.collectedAt }, "seat",
      divisionIds.some(id => /\/sld[ul]:/.test(id)) ? "state-legislator" : "local-officeholder");
      field(member.id, "OFF-04", source.sourceUrl, source.collectedAt, { name: member.name, office: member.officeTitle });
      field(member.id, "OFF-08", source.sourceUrl, source.collectedAt, member.websiteUrl ?? source.sourceUrl);
      for (const key of ["email", "phone", "termNote", "termStart", "termEnd"] as const) {
        if (!member[key]) continue;
        const origin = member.fieldSources?.[key] ?? source;
        field(member.id, key.startsWith("term") ? "OFF-06" : "OFF-09", origin.sourceUrl, origin.collectedAt, member[key]);
      }
    }
  }
  for (const row of registry.statewideExecutives ?? []) {
    const holder = row.holder;
    if (!ids.has(row.stateOcdId) || !holder.name || !holder.officeTitle) continue;
    put({ subjectId: holder.id, subjectKind: "official", bodyId: null, bodyName: null, personId: holder.personId ?? holder.id,
      heldMemberId: null, personName: holder.name, officeTitle: holder.officeTitle, governmentId: null,
      sourceUrls: urls([holder.websiteUrl, row.sourceUrl]), profileUrls: urls([holder.websiteUrl, row.sourceUrl]), divisionIds: [row.stateOcdId],
      needsMembers: false, label: `${holder.name}, ${holder.officeTitle}`, checkedAt: row.collectedAt }, "seat", "executive");
    field(holder.id, "OFF-04", row.sourceUrl, row.collectedAt, { name: holder.name, office: holder.officeTitle });
    field(holder.id, "OFF-08", row.sourceUrl, row.collectedAt, holder.websiteUrl ?? row.sourceUrl);
    if (holder.email || holder.phone || holder.contactFormUrl) field(holder.id, "OFF-09", row.sourceUrl, row.collectedAt,
      { email: holder.email, phone: holder.phone, contactFormUrl: holder.contactFormUrl });
    if (holder.termEnd) field(holder.id, "OFF-06", row.sourceUrl, row.collectedAt, holder.termEnd);
  }
  for (const { holder } of registry.officialCandidacies?.rows ?? []) {
    if (targets.has(holder.id) || !holder.name || !holder.officeTitle) continue;
    const person = heldPeople.find(person => person.id === holder.id && person.state?.toLowerCase() === own);
    const divisionIds = holder.divisions.filter(id => ids.has(id));
    // A native roster's explicit state still scopes its known delegate when the bridge has no district link.
    if (!divisionIds.length && person) {
      const id = nativeStateScope();
      if (id) divisionIds.push(id);
    }
    const personSource = person?.provenance;
    put({ subjectId: holder.id, subjectKind: "official", bodyId: null, bodyName: null, personId: person?.personId ?? holder.id,
      heldMemberId: null, personName: holder.name, officeTitle: holder.officeTitle, governmentId: null,
      sourceUrls: urls([person?.websiteUrl, ...person?.profileUrls ?? [], holder.sourceUrl]),
      profileUrls: urls([person?.websiteUrl, ...person?.profileUrls ?? []]), divisionIds, needsMembers: false,
      label: `${holder.name}, ${holder.officeTitle}`, checkedAt: registry.registry.generatedAt }, "seat",
      holder.authority === "FEDERAL_DIRECTORY" ? "federal-legislator" : holder.authority === "STATE_PEOPLE" ? "state-legislator" : undefined);
    field(holder.id, "OFF-04", holder.sourceUrl, registry.registry.generatedAt, { name: holder.name, office: holder.officeTitle });
    field(holder.id, "OFF-08", holder.sourceUrl, registry.registry.generatedAt, holder.sourceUrl);
    if (personSource && (person?.phone || person?.email || person?.contactFormUrl)) field(holder.id, "OFF-09", personSource.sourceUrl,
      personSource.collectedAt, { phone: person.phone, email: person.email, contactFormUrl: person.contactFormUrl });
    if (personSource && (person?.termStart || person?.termEnd)) field(holder.id, "OFF-06", personSource.sourceUrl,
      personSource.collectedAt, { start: person.termStart, end: person.termEnd });
  }
  for (const government of governments) {
    if (government.stateCode.toLowerCase() !== own || !government.name) continue;
    const matches = government.bodyId ? [bodies.get(government.bodyId)].filter(body => body !== undefined)
      : government.censusId ? [...bodies.values()].filter(body => body.censusId === government.censusId) : [];
    const body = matches.length === 1 ? matches[0] : null;
    const divisionIds = [...new Set([government.ocdId, body?.ocdId, nativeStateScope()]
      .filter((id): id is string => Boolean(id && ids.has(id))))];
    put({ subjectId: government.id, subjectKind: "government", bodyId: body?.id ?? null, bodyName: body?.name ?? null,
      personId: null, heldMemberId: null, personName: null, officeTitle: null, governmentId: government.id,
      governmentDivisionIds: [government.ocdId ?? body?.ocdId].filter((id): id is string => Boolean(id && ids.has(id))), governmentClass: government.govClass ?? null,
      sourceUrls: urls([government.ownWebAddress]), profileUrls: [], divisionIds, needsMembers: false, label: government.name,
      checkedAt: government.checkedAt ?? null }, "body", "registry-body");
    field(government.id, "GOV-01", government.ownWebAddress, government.checkedAt, { name: government.name, type: government.govClass });
  }
  for (const live of liveFields) {
    const target = targets.get(live.subjectId) ?? targets.get(live.subjectId.replace(/#calendar$/, ""));
    if (!target || !Number.isFinite(Date.parse(live.checkedAt)) || Date.parse(live.checkedAt) > Date.parse(now)) continue;
    held.push(live);
    if (Date.parse(live.checkedAt) > (Date.parse(target.checkedAt ?? "") || 0)) targets.set(target.subjectId, { ...target, checkedAt: live.checkedAt });
  }
  const missing = missingPlaceWork(buildPlaceOwedList({ divisions: planningDivisions, subjects, held, now }));
  const owed = new Map<string, Set<string>>();
  for (const row of missing) {
    if (row.subject.id.includes("#inventory:")) continue;
    const target = targets.get(row.subject.id) ?? (row.subject.captureKind === "body-calendar" ? targets.get(row.subject.id.replace(/#calendar$/, "")) : undefined);
    if (!target || target.subjectKind === "government" && row.subject.captureKind === "body-calendar") continue;
    const items = owed.get(target.subjectId) ?? new Set<string>();
    items.add(row.checklistId); owed.set(target.subjectId, items);
  }
  return [...targets.values()].flatMap(target => {
    const checklistIds = [...owed.get(target.subjectId) ?? []].sort(byItem);
    return checklistIds.length ? [{ ...target, checklistIds }] : [];
  }).sort((a, b) => rank(a.checklistIds[0]!) - rank(b.checklistIds[0]!) || a.subjectId.localeCompare(b.subjectId));
}

export function heldSubjectEnrichmentObligations(subjects: readonly HeldSubjectDetails[]): ProvidedObligation[] {
  return subjects.map(subject => ({ recordClass: "held-subject-enrichment", subjectId: subject.subjectId,
    scopeDivisions: subject.divisionIds, readerImpactAt: null, observedChangeRateHours: null, lastWorkedAt: subject.checkedAt,
    routes: subject.sourceUrls.map(url => ({ routeId: `held-subject-details:${fingerprint([url])}`, label: `${subject.label} — remaining verified details`,
      executorClass: "DETERMINISTIC", executorReason: "read this held subject's known source and attach each verified fact with plain code",
      open: { kind: "HTTP_GET" as const, url, headers: sourceRequestHeaders() },
      citation: `Held ${subject.subjectKind} ${subject.subjectId}; owed checklist items: ${subject.checklistIds.join(", ")}; source ${url}.` })),
  }));
}
