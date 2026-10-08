import assert from "node:assert/strict";
import test from "node:test";
import { section3Page, section3Record, type Section3Page } from "../lib/control-plane/promotion/section3.ts";
import { DEFAULT_SOURCE_POLICY, SOURCE_KINDS, SOURCE_KINDS_SETTING } from "../lib/control-plane/promotion/source-kinds.ts";
import { publicationSourcePolicy, readPublicationSourcePolicy } from "../lib/control-plane/promotion/source-settings.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { ADMIN_CONFIG_ID, defaultAdminConfig } from "../lib/control-plane/gateway/admin-config.ts";
import { withSetting, settingUndo } from "../lib/control-plane/settings.ts";
const NOW = "2026-10-05T12:00:00.000Z";
const source = (url: string, text = "<p>Alice Adams Clerk alice@example.test</p>"): Section3Page => ({ url, text, retrievedAt: NOW });

test("CP-02: labels preserve official links, filing documents and the known-host table", () => {
  for (const [page, recordClass, expected] of [
    [source("https://town.gov/roster"), "OFFICIAL_ROSTER", "OFFICIAL"],
    [source("https://town.gov/filing.pdf"), "CANDIDATE_FILING_DOCUMENT", "FILING"],
    [source("https://openstates.org/people/alice"), "OFFICIAL_ROSTER", "REFERENCE"],
    [source("https://www.vote411.org/guide"), "OFFICIAL_ROSTER", "VOTER_GUIDE"],
    [{ ...source("https://town.legistar.com/roster"), linkingPage: { url: "https://town.gov/", html: '<a href="https://town.legistar.com/">Meetings</a>' } }, "OFFICIAL_ROSTER", "OFFICIAL"],
  ] as const) {
    assert.deepEqual(section3Page(page, recordClass, NOW), { ok: true, kind: expected, reason: null });
  }
  assert.equal(section3Page(source("https://openstates.org.evil.test/"), "OFFICIAL_ROSTER", NOW).ok, false);
});

test("CP-02: unknown publishers must link saved, fresh evidence of each value from the same person's row", () => {
  const official = source("https://town.gov/roster", '<table><tr><td>Alice Adams</td><td>Clerk</td><td>alice@example.test</td></tr><tr><td>Bob Brown</td><td>Mayor</td><td>bob@example.test</td></tr></table>');
  const primary = { ...source("https://local-paper.example/people", '<p>Alice Adams Clerk bob@example.test</p><a href="https://town.gov/roster">Source</a>'), citations: [official] };
  const verdict = section3Record({ recordClass: "OFFICIAL_ROSTER", page: primary, now: NOW,
    fields: { name: "Alice Adams", office: "Clerk", email: "bob@example.test" } });
  assert.equal(verdict.live, true);
  assert.deepEqual(verdict.openFields, ["email"]);
  assert.equal(section3Page({ ...primary, text: "Alice Adams Clerk https://town.gov/roster" }, "OFFICIAL_ROSTER", NOW).ok, false);
  assert.equal(section3Page({ ...primary, citations: [{ ...official, retrievedAt: "2025-01-01" }] }, "OFFICIAL_ROSTER", NOW).ok, false);
  assert.equal(section3Page({ ...primary, citations: [] }, "OFFICIAL_ROSTER", NOW).kind, "OTHER");
});

test("CP-02: a campaign establishes its own candidate's facts and never its opponent's", () => {
  const page = { ...source("https://alice.example/", '<title>Alice Adams for Clerk 2026</title><p>Alice Adams Clerk alice@example.test</p><p>Bob Brown Mayor bob@example.test</p>'),
    campaign: { name: "Alice Adams", office: "Clerk", cycle: "2026" } };
  assert.equal(section3Page(page, "OFFICIAL_ROSTER", NOW).kind, "CAMPAIGN");
  assert.equal(section3Record({ recordClass: "OFFICIAL_ROSTER", page, now: NOW,
    fields: { name: "Alice Adams", office: "Clerk", email: "alice@example.test" } }).live, true);
  assert.equal(section3Record({ recordClass: "OFFICIAL_ROSTER", page, now: NOW,
    fields: { name: "Bob Brown", office: "Mayor", email: "bob@example.test" } }).live, false);
  assert.equal(section3Page({ ...page, campaign: { ...page.campaign, cycle: "2028" } }, "OFFICIAL_ROSTER", NOW).ok, false);
  assert.equal(section3Page({ ...page, campaign: undefined, sourcePolicy: { ...DEFAULT_SOURCE_POLICY, hosts: { "alice.example": "CAMPAIGN" } } }, "OFFICIAL_ROSTER", NOW).ok, false);
});

test("CP-02: all kinds start enabled; a logged setting disables publication but preserves its label", () => {
  const initial = defaultAdminConfig();
  assert.ok(SOURCE_KINDS.every(kind => publicationSourcePolicy(initial).enabled[kind]));
  const configured = withSetting(initial, { id: "disable-reference", key: SOURCE_KINDS_SETTING,
    after: { ...DEFAULT_SOURCE_POLICY.enabled, REFERENCE: false }, at: NOW, why: "source setting" });
  const verdict = section3Page({ ...source("https://openstates.org/people/alice"), sourcePolicy: publicationSourcePolicy(configured) }, "OFFICIAL_ROSTER", NOW);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.kind, "REFERENCE");
  assert.match(verdict.reason!, /SOURCE_KIND_DISABLED/);
  assert.deepEqual(settingUndo(configured, "disable-reference")?.value, DEFAULT_SOURCE_POLICY.enabled);
});

test("CP-02: workers read the policy from the Admin settings alone, the same policy the whole config gives", async () => {
  const repos = createMemoryRepositories();
  assert.deepEqual(await readPublicationSourcePolicy(repos), publicationSourcePolicy(null), "no config reads as the defaults");
  const configured = withSetting(defaultAdminConfig(), { id: "disable-reference", key: SOURCE_KINDS_SETTING,
    after: { ...DEFAULT_SOURCE_POLICY.enabled, REFERENCE: false }, at: NOW, why: "source setting" });
  await repos.adminConfig.put(ADMIN_CONFIG_ID, configured, NOW);
  let whole = 0;
  const read = repos.adminConfig.read.bind(repos.adminConfig);
  repos.adminConfig.read = async id => { whole += 1; return read(id); };
  assert.deepEqual(await readPublicationSourcePolicy(repos), publicationSourcePolicy(configured));
  assert.equal((await readPublicationSourcePolicy(repos)).enabled.REFERENCE, false);
  assert.equal(whole, 0, "the whole config is never read for it");
});
