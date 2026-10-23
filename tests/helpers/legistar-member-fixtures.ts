import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import type { BodySourceWiring } from "../../lib/registry/source-wiring.ts";
import { legistarMemberSignature, memberReading, type LegistarMembers } from "../../lib/sources/legistar/members-model.ts";
import { recordAcquisition } from "../../lib/control-plane/evidence/artifact.ts";
import { putArtifact, type EvidenceStore } from "../../lib/control-plane/evidence/store.ts";
import { FRESHNESS_PROJECT } from "../../lib/control-plane/scheduler/durable.ts";

export const NOW = "2026-10-13T20:00:00.000Z";
const fixture = (tenant: string, file: string) => readFileSync(new URL(`../fixtures/legistar-members/${tenant}/${file}`, import.meta.url), "utf8");
export const rawFor = (slug: string): LegistarMembers => {
  const pages = ["bodies", "persons", "officerecords"].map(collection => {
    const text = fixture(slug, `${collection}.json`), meta = JSON.parse(fixture(slug, `${collection}.meta.json`));
    assert.equal(createHash("sha256").update(text).digest("hex"), meta.sha256);
    const { artifact } = recordAcquisition({ canonicalUrl: meta.sourceUrl, retrievedAt: meta.retrievedAt, httpStatus: 200, contentType: "application/json",
      sourceId: `legistar:${slug}`, methodRouteId: "legistar-members", workItemId: `legistar-members:${slug}`, attemptId: meta.retrievedAt,
      permission: "ALLOWED", transport: "REACHABLE" }, text);
    return { artifact, rows: JSON.parse(text) };
  });
  const raw = { slug, bodies: pages[0].rows, persons: pages[1].rows, offices: pages[2].rows,
    signature: "", collectedAt: pages[2].artifact.retrievedAt, readings: pages.map(page => memberReading(page.artifact, page.rows)) };
  raw.signature = legistarMemberSignature(raw);
  return raw;
};

export async function storeMemberFixtures(vault: EvidenceStore, raw: LegistarMembers): Promise<void> {
  for (const { artifact } of raw.readings) {
    const url = new URL(artifact.canonicalUrl), collection = url.pathname.split("/").at(-1)!;
    await putArtifact(vault, FRESHNESS_PROJECT, artifact, Buffer.from(fixture(raw.slug, `${collection}.json`)));
  }
}

export const wiring = (raw: LegistarMembers, state: string, zone: string): BodySourceWiring[] => raw.bodies.map(body => ({
  bodyId: `ocd-division/country:us/state:${state.toLowerCase()}/place:${raw.slug}#body:${body.BodyId}`,
  ocdId: `ocd-division/country:us/state:${state.toLowerCase()}/place:${raw.slug}`, agendaSourceType: "LEGISTAR",
  publishingOrg: raw.slug, jurisdiction: raw.slug, timeZone: zone, verifiedAt: NOW,
  config: { slug: raw.slug, eventBodyId: String(body.BodyId), sourceRoutes: "legistar" },
}));


export function recordedMemberFetch(current: () => LegistarMembers, calls: URL[]): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = new URL(String(input)); calls.push(url);
    const raw = current(), collection = url.pathname.split("/").at(-1)!;
    const field = collection === "bodies" ? "BodyId" : collection === "persons" ? "PersonId" : "OfficeRecordId";
    const filter = url.searchParams.get("$filter") ?? "";
    const cursor = Number(new RegExp(`${field} gt (\\d+)`).exec(filter)?.[1] ?? 0);
    const ids = [...filter.matchAll(/PersonId eq (\d+)/g)].map(match => Number(match[1]));
    const end = /OfficeRecordEndDate ge datetime'([^']+)'/.exec(filter)?.[1];
    let rows: unknown[] = collection === "bodies" ? raw.bodies : collection === "persons" ? raw.persons.filter(person => ids.includes(person.PersonId))
      : raw.offices.filter(office => !end || office.OfficeRecordEndDate === null || office.OfficeRecordEndDate >= end);
    rows = rows.filter(row => (row as Record<string, number>)[field] > cursor).slice(0, Number(url.searchParams.get("$top")));
    const selected = url.searchParams.get("$select")?.split(",");
    return Response.json(selected ? rows.map(row => Object.fromEntries(selected.map(key => [key, (row as Record<string, unknown>)[key]]))) : rows);
  }) as typeof fetch;
}
