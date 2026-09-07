/** Local production Reader proof. Requires an already-built local server.
 * All remote requests and browser writes are blocked before first navigation.
 * node --import ./scripts/register-test-loader.mjs --import tsx scripts/governing-record-browser-proof.mts --base http://127.0.0.1:3186
 */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { launchGuarded } from "./browser.mts";
import { ARIZONA_RECORD_CONTROLS } from "./lib/governing-record-proof.ts";
import { getStateVotesSnapshot } from "../lib/sources/legiscan/snapshot.ts";
import type { MemberRollCall } from "../components/map/popup/official-popup.tsx";

const argument = (key: string) => { const index = process.argv.indexOf(key); return index >= 0 ? process.argv[index + 1] : undefined; };
const base = new URL(argument("--base") ?? "http://127.0.0.1:3186");
assert.ok(["localhost", "127.0.0.1"].includes(base.hostname), "Proof may only target a local production server");
const directory = resolve(argument("--output") ?? ".scratch/governing-record-browser-proof");
mkdirSync(directory, { recursive: true });
const controls = [
  ...ARIZONA_RECORD_CONTROLS.map(row => ({ ...row, stateMotionId: null as string | null, federal: false })),
  { name: "Gregory M. Sargent", zip: "03255", cardKey: "ballot-nh-merrimack:state-house-merrimack-7:sargent-gregory-m-", officialId: "plural:f1292af8-a209-4ff7-87b5-086acddcc10e", switches: false, stateMotionId: "legiscan:1725386", federal: false },
  { name: "Daniel E. Innis", zip: "03255", cardKey: "ballot-nh-merrimack:state-senate-7:innis-daniel-e-", officialId: "plural:6328e7f7-d952-4d28-98b8-75a9a6f50c8d", switches: false, stateMotionId: "legiscan:1725502", federal: false },
  { name: "Juan Ciscomani", zip: "85641", cardKey: "ballot-az-pima:us-house-6|Juan Ciscomani", officialId: "congress:C001133", switches: false, stateMotionId: null, federal: true },
];
const snapshot = getStateVotesSnapshot();
const browser = await launchGuarded({ label: "governing-record-slice-a-local" });
const blockedRemote: string[] = [], blockedWrites: string[] = [], rows = [];
try {
  const context = await browser.context({ viewport: { width: 1440, height: 1100 }, serviceWorkers: "block" });
  await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== base.origin) { blockedRemote.push(url.origin); await route.abort("blockedbyclient"); return; }
    if (!["GET", "HEAD"].includes(request.method())) { blockedWrites.push(url.pathname); await route.fulfill({ status: 204, body: "" }); return; }
    await route.fallback();
  });
  const page = await context.newPage();
  for (const control of controls) {
    await page.goto(`${base.origin}/ballot?zip=${control.zip}`, { waitUntil: "networkidle" });
    const cardRow = page.locator(`[data-candidate-target=${JSON.stringify(control.cardKey)}]`);
    assert.equal(await cardRow.count(), 1, control.cardKey);
    await cardRow.locator("[data-battlecard-pill]").click();
    const card = page.locator(`[data-candidate-battlecard][data-candidate-subject=${JSON.stringify(control.cardKey)}]`);
    await card.waitFor({ state: "visible" });
    const chips = await card.locator(".account-modal-header").innerText();
    if (control.switches) assert.ok(!/\bIncumbent\b/.test(chips), `${control.name}: chamber change must not claim incumbency`);
    else assert.match(chips, /\bIncumbent\b/, control.name);
    await card.getByRole("button", { name: "Voting record", exact: true }).click();
    await card.locator("[data-recent-vote-id]").first().waitFor({ state: "visible" });
    const recordOffice = await card.locator("[data-governing-record-office]").getAttribute("data-governing-record-office");
    assert.ok(recordOffice, `${control.name}: record must identify the office in which it was produced`);
    const response = await context.request.get(`${base.origin}/api/votes?member=${encodeURIComponent(control.officialId)}`);
    assert.equal(response.status(), 200);
    const payload = await response.json() as { member: string; count: number; votes: MemberRollCall[]; attribution?: { licenceUrl: string }; generatedAt: string };
    assert.equal(payload.member, control.officialId);
    assert.equal(payload.count, payload.votes.length);
    const initial = await card.locator("[data-recent-vote-id]").count();
    assert.equal(initial, Math.min(20, payload.count));
    if (payload.count > 20) await card.locator("[data-recent-votes-expand]").click();
    const ids = await card.locator("[data-recent-vote-id]").evaluateAll(elements => elements.map(element => element.getAttribute("data-recent-vote-id")));
    assert.deepEqual(ids, payload.votes.map(vote => vote.id));
    assert.equal(await card.locator("[data-recent-vote-count]").getAttribute("data-recent-vote-count"), String(ids.length));
    for (const vote of payload.votes) {
      const row = card.locator(`[data-recent-vote-id=${JSON.stringify(vote.id)}]`);
      assert.ok((await row.innerText()).includes(vote.title));
      assert.equal(await row.locator(`a[href=${JSON.stringify(vote.rollCallUrl)}]`).count(), 1);
      assert.equal(vote.jurisdiction.level, control.federal ? "federal" : "state");
    }
    if (!control.federal) {
      assert.equal(payload.votes.length, snapshot.positions.filter(row => row.officeholderId === control.officialId).length);
      assert.equal(payload.generatedAt, snapshot.generatedAt);
      assert.ok(payload.attribution);
      assert.equal(await card.locator(`a[href=${JSON.stringify(payload.attribution.licenceUrl)}]`).count(), 1);
    }
    let motionText: string | null = null;
    if (control.stateMotionId) {
      motionText = await card.locator(`[data-recent-vote-id=${JSON.stringify(control.stateMotionId)}]`).innerText();
      assert.ok(!/president/i.test(motionText), control.name);
      assert.match(motionText, /governor/i);
      assert.ok(control.stateMotionId !== "legiscan:1725502" || !/override.*requires|two.thirds/i.test(motionText), "Veto message must not invent an override stage");
    }
    const screenshot = resolve(directory, `${control.name.toLowerCase().replace(/[^a-z]+/g, "-")}.png`);
    await card.screenshot({ path: screenshot });
    rows.push({ name: control.name, cardKey: control.cardKey, officialId: control.officialId, url: page.url(), recordOffice, initiallyVisible: initial, renderedRows: ids.length, ids, chips, motionText, screenshot });
  }
  await context.close();
  assert.equal(browser.provider.spent, 0);
  const proof = { executionLevel: "LOCAL_PRODUCTION_BALLOT_BROWSER", base: base.origin, rows, blockedRemoteOrigins: [...new Set(blockedRemote)], blockedWrites: [...new Set(blockedWrites)], providerRequestsSpent: browser.provider.spent };
  writeFileSync(resolve(directory, "proof.json"), JSON.stringify(proof, null, 2) + "\n");
  console.log(JSON.stringify(proof, null, 2));
} finally { await browser.close(); }
