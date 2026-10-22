import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { sourceMeetings } from "../lib/hunt/source-meetings.ts";
import type { SitePage, SiteScope } from "../lib/hunt/site-findings.ts";

const LIST = (title: string) => `<html><head><title>Meetings - City of Example</title></head><body><main><h1>Meetings &amp; agendas</h1><table><thead><tr><th>Meeting</th><th>Date</th><th>Time</th><th>Location</th><th>Status</th></tr></thead><tbody>
  <tr><td><a href="/meetings/1">${title}</a></td><td>Sep 21, 2026</td><td>6:00 PM</td><td>City Hall, 100 Main Street</td><td>Published</td></tr>
  <tr><td><a href="/meetings/2">${title}</a></td><td>Oct 5, 2026</td><td>6:00 PM</td><td>City Hall, 100 Main Street</td><td>Published</td></tr></tbody></table></main></body></html>`;

async function walk(html: string, bodyName: string) {
  const repos = createMemoryRepositories();
  const scope: SiteScope = { governmentId: "al:city:city-of-example", name: "City of Example", state: "AL", bodyId: "al:city:city-of-example#governing", bodyName, website: "https://example.gov/" };
  const page: SitePage = { url: "https://example.gov/meetings", html, artifactId: "a-list", observedAt: "2026-09-10T12:00:00.000Z" };
  await sourceMeetings({ repos, governmentId: scope.governmentId, website: scope.website, workItemId: "wi", currentArtifacts: () => [], countyFips: "01053" })(scope, page);
  return (await repos.discoveryAttempts.read(scope.governmentId)).flatMap(attempt => attempt.found);
}

test("a page that lists the body's own dated meetings becomes a calendar door; a list of some other body's meetings does not", async () => {
  const found = await walk(LIST("City Council Regular Meeting"), "City Council");
  assert.deepEqual(found.map(find => [find.vendor, find.url, find.bodyName]), [["official-page-events", "https://example.gov/meetings", "City Council"]]);
  assert.ok((found[0]!.count ?? 0) >= 1);
  assert.deepEqual(await walk(LIST("Planning Commission Regular Meeting"), "City Council"), [], "meetings of another body are not this body's calendar");
});
