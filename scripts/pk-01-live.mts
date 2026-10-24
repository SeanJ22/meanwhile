/** River's post-ship PK-01 check. --read-only captures the live ballot without saving or emitting reader events. */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { US_JURISDICTIONS } from "../lib/coverage/states.ts";
import { neon } from "@neondatabase/serverless";
import { installPlaceMapQuery, readStateZipPlaces } from "../lib/place-map/reader.ts";
import { readZipLocations } from "../lib/place-map/locations.ts";
import { launchGuarded } from "./browser.mts";
import { isLocalBase } from "../lib/ops/live-write-guard.ts";
import { PUBLIC_SITE_ORIGIN } from "../lib/ops/origins.ts";

const readonly = process.argv.includes("--read-only");
const national = process.argv.includes("--all-states");
const base = process.env.PK01_BASE_URL ?? PUBLIC_SITE_ORIGIN;
const zip = process.env.PK01_TEST_ZIP ?? "85701";
const picksApi = process.env.PK01_PICKS_API_ORIGIN;
if (picksApi) assert.ok(isLocalBase(base) && isLocalBase(picksApi), "a split-store replay is confined to local servers");
assert.match(zip, /^\d{5}$/);
if (national) assert.ok(picksApi && !readonly, "national replay needs local read-only production and development picks servers");
const places = national ? await (async () => {
  // Geography metadata only; civic records are read one state at a time by the page.
  const connection = process.env.WTP_PRODUCTION_DATABASE_URL_READONLY;
  assert.ok(connection && new URL(connection).username === "readonly", "national geography uses the production read-only role");
  const sql = neon(connection);
  installPlaceMapQuery(async (text, params = []) =>
    (await sql.transaction([sql.query(text, [...params])], { readOnly: true }))[0]);
  const places = [];
  for (const state of US_JURISDICTIONS) {
    const entries = await readStateZipPlaces(state.usps);
    const rows = [...(await readZipLocations([...entries.keys()])).values()]
      .filter(row => row.postal?.state === state.usps).sort((a, b) => a.zip.localeCompare(b.zip));
    const place = rows.find(row => row.postal?.type === "standard") ?? rows[0];
    assert.ok(place, `${state.usps}: no held ZIP with coordinates`);
    places.push({ state: state.usps, zip: place.zip });
  }
  return places.sort((a, b) => a.state.localeCompare(b.state));
})() : [{ state: "example", zip }];
interface Result { state: string; zip: string; contests: number; choices: number; restored: number; restoreMs?: number;
  passed: boolean; reason?: string; tomorrow?: string; automaticPollingBothWays?: boolean }
const results: Result[] = [];
const browser = await launchGuarded({ label: "PK-01-live", blockWrites: readonly || Boolean(picksApi),
  ...(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY, bypass: "127.0.0.1,localhost" } } : {}) });
try {
  for (const place of places) {
    const { zip } = place;
    const result: Result = { ...place, contests: 0, choices: 0, restored: 0, passed: false };
    const first = await browser.page({ viewport: { width: 1200, height: 900 } });
    let fresh: typeof first | undefined;
    try {
      if (!readonly) await first.clock.install();
      const poll = async (page: typeof first) => {
        const response = page.waitForResponse(response => new URL(response.url()).pathname === "/api/ballot/picks" && response.request().method() === "GET");
        await page.clock.fastForward(30_000);
        await (await response).finished();
      };
      const saved = (page: typeof first) => page.getByRole("status").filter({ hasText: "Your picks are saved" }).waitFor({ timeout: 3000 });
      const bridgeLocalPicks = async (page: typeof first) => {
        if (!picksApi) return;
        // The page may use a read-only production connection; all private-list traffic
        // goes to the development instance running this exact endpoint and migration.
        await page.context().route(`${new URL(base).origin}/api/ballot/picks`, async route => {
          const request = route.request();
          const headers = { ...request.headers(), origin: new URL(picksApi).origin, host: new URL(picksApi).host };
          const response = await fetch(`${picksApi}/api/ballot/picks`, { method: request.method(), headers,
            ...(request.postData() ? { body: request.postData() } : {}) });
          await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() });
        });
      };
      await bridgeLocalPicks(first);
      if (readonly && process.env.PK01_VERIFIED_HTTP_BRIDGE === "1") {
        // Managed cloud Chromium lacks the proxy CA. Node uses the configured CA;
        // forward public GETs through that verified transport while keeping page URLs intact.
        await first.context().route(`${new URL(base).origin}/**`, async route => {
          if (route.request().method() !== "GET") { await route.fallback(); return; }
          const response = await fetch(route.request().url(), { headers: route.request().headers() });
          await route.fulfill({ status: response.status, headers: Object.fromEntries([...response.headers].filter(([name]) => !["content-encoding", "content-length", "transfer-encoding"].includes(name))),
            body: Buffer.from(await response.arrayBuffer()) });
        });
      }
      await first.goto(`${base}/ballot?zip=${zip}`, { waitUntil: "domcontentloaded" });
      const cards = first.locator("[data-contest-id]").filter({ has: first.locator("[data-kind=pick]") });
      await first.locator("main h1").waitFor();
      const capture = await cards.evaluateAll(elements => elements.map(element => {
        const pick = element.querySelector("[data-kind=pick]")!;
        return { contestId: element.getAttribute("data-contest-id"), contestOcdId: element.getAttribute("data-ocd-id"),
          contestTitle: element.querySelector("h2,h3")?.textContent?.trim() ?? "Contest",
          options: [...pick.querySelectorAll("button[aria-pressed]")].filter(button => !/not sure/i.test(button.textContent ?? ""))
            .map(button => ({ label: button.textContent!.trim().replace(/^[✓✕]\s*/, "") })) };
      }));
      result.contests = capture.length;
      result.choices = capture.reduce((sum, contest) => sum + contest.options.length, 0);
      mkdirSync(".scratch/pk-01", { recursive: true });
      if (!national) writeFileSync(`.scratch/pk-01/${readonly ? "production-ballot" : "full-page-ballot"}.json`, JSON.stringify({ observedAt: new Date().toISOString(), source: `${base}/ballot?zip=${zip}`, runId: browser.runId, contests: capture }, null, 2));
      if (readonly) {
        console.log(JSON.stringify({ mode: "read-only", contests: capture.length, runId: browser.runId, writesBlocked: browser.writesBlocked.count }));
      } else {
        assert.ok(result.choices > 0, `${place.state}: production page has ${result.contests} pickable contests and no choices; the restore/change journey cannot run at ZIP ${zip}`);
        // For the national proof, save and restore every pickable contest on this page.
        if (national) for (let index = 0; index < capture.length; index++) {
          if (capture[index]!.options.length) await cards.nth(index).locator("[data-kind=pick] button[aria-pressed]").first().click();
        }
        const race = cards.nth(Math.max(0, capture.findIndex(contest => contest.options.length > 0)));
        const contestId = await race.getAttribute("data-contest-id");
        const original = race.locator("[data-kind=pick]");
        const choices = race.locator("[data-kind=pick] button[aria-pressed]").filter({ hasNotText: /not sure/ });
        assert.ok(await choices.count() >= (national ? 1 : 2), "the test ballot needs a pickable race");
        const labelA = (await choices.nth(0).innerText()).replace(/^[✓✕]\s*/, "");
        const labelB = national ? labelA : (await choices.nth(1).innerText()).replace(/^[✓✕]\s*/, "");
        if (!national) await choices.nth(0).click();
        await first.getByRole("button", { name: "Save my picks on another device" }).click();
        await first.getByRole("status").filter({ hasText: "Your picks are saved" }).waitFor({ timeout: 3000 });
        const link = await first.getByRole("textbox", { name: "Private picks link" }).inputValue();
        const originalSummary = await first.getByRole("heading", { name: "My picks", exact: true }).locator("..").locator(":scope > ul").innerText();
        fresh = await browser.page({ viewport: { width: 390, height: 844 } });
        await fresh.clock.install();
        await bridgeLocalPicks(fresh);
        const startedAt = Date.now();
        await fresh.goto(link, { waitUntil: "domcontentloaded" });
        const restored = fresh.locator(`[data-contest-id=${JSON.stringify(contestId)}] [data-kind=pick]`);
        await restored.getByRole("button", { name: labelA, exact: true, pressed: true }).waitFor({ timeout: 3000 });
        const restoreMs = Date.now() - startedAt;
        result.restoreMs = restoreMs;
        if (!national) assert.ok(restoreMs < 3000, `first restore took ${restoreMs}ms`);
        const summary = await fresh.getByRole("heading", { name: "My picks", exact: true }).locator("..").locator(":scope > ul").innerText();
        assert.equal(summary, originalSummary, `${place.state}: the fresh browser must show the same My picks summary`);
        if (national) for (const contest of capture) {
          if (!contest.options.length) continue;
          await fresh.locator(`[data-contest-id=${JSON.stringify(contest.contestId)}] [data-kind=pick]`)
            .getByRole("button", { name: contest.options[0]!.label, exact: true, pressed: true }).waitFor({ timeout: 3000 });
          result.restored += 1;
        }
        else result.restored = 1;
        await restored.getByRole("button", { name: labelB, exact: true }).click();
        await saved(fresh);
        await poll(first);
        await original.getByRole("button", { name: labelB, exact: true, pressed: !national }).waitFor({ timeout: 3000 });
        await original.getByRole("button", { name: labelA, exact: true }).click();
        await saved(first);
        await poll(fresh);
        await restored.getByRole("button", { name: labelA, exact: true, pressed: true }).waitFor({ timeout: 3000 });
        const tomorrow = new Date();
        tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
        await first.clock.setFixedTime(tomorrow);
        await fresh.clock.setFixedTime(tomorrow);
        await restored.getByRole("button", { name: labelB, exact: true }).click();
        await saved(fresh);
        await poll(first);
        await original.getByRole("button", { name: labelB, exact: true, pressed: !national }).waitFor({ timeout: 3000 });
        await original.getByRole("button", { name: labelA, exact: true }).click();
        await saved(first);
        await fresh.evaluate(() => window.dispatchEvent(new Event("focus")));
        await restored.getByRole("button", { name: labelA, exact: true, pressed: true }).waitFor({ timeout: 3000 });
        if (!national) await fresh.getByRole("heading", { name: "My picks", exact: true }).locator("..").screenshot({ path: ".scratch/pk-01/live-picks.png", mask: [fresh.getByRole("textbox", { name: "Private picks link" })] });
        if (!national) await fresh.screenshot({ path: ".scratch/pk-01/live-phone.png", fullPage: true, mask: [fresh.getByRole("textbox", { name: "Private picks link" })] });
        Object.assign(result, { passed: restoreMs < 3000, tomorrow: tomorrow.toISOString().slice(0, 10), automaticPollingBothWays: true });
        if (restoreMs >= 3000) result.reason = `${place.state}: first full-page restore took ${restoreMs}ms, exceeding the three-second rule; restored contents and two-way sync passed, but page/hydration latency is unresolved`;
        console.log(JSON.stringify({ ...result, runId: browser.runId, origin: base, splitStoreReplay: Boolean(picksApi) }));
        // Capability links are private: never put them in logs or evidence files.
      }
    } catch (error) {
      if (!national) throw error;
      // Assertion messages describe public page behavior only. Never log request headers or capability links.
      result.reason = error instanceof Error ? error.message.split("\n")[0]!.replace(/#picks=[A-Za-z0-9_-]+/g, "#picks=[private]") : "Replay failed";
      console.log(JSON.stringify(result));
    } finally {
      await fresh?.context().close();
      await first.context().close();
    }
    results.push(result);
    if (national) writeFileSync(".scratch/pk-01/national-replay.json", JSON.stringify({ observedAt: new Date().toISOString(), runId: browser.runId,
      origin: base, productionReadOnly: true, splitStoreReplay: true, results }, null, 2));
  }
  if (national) console.log(JSON.stringify({ runId: browser.runId, jurisdictions: results.length, passed: results.filter(result => result.passed).length,
    failed: results.filter(result => !result.passed).length, contests: results.reduce((sum, result) => sum + result.contests, 0),
    choices: results.reduce((sum, result) => sum + result.choices, 0), restored: results.reduce((sum, result) => sum + result.restored, 0),
    writesBlocked: browser.writesBlocked.count }));
  if (national && results.some(result => !result.passed)) process.exitCode = 1;
} finally { await browser.close(); }
