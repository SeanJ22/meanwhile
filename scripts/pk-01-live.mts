/** River's post-ship PK-01 check. --read-only captures the live ballot without saving or emitting reader events. */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { launchGuarded } from "./browser.mts";
import { isLocalBase } from "../lib/ops/live-write-guard.ts";

const readonly = process.argv.includes("--read-only");
const base = process.env.PK01_BASE_URL ?? "https://meanwhileusa.com";
const zip = process.env.PK01_TEST_ZIP ?? "85701";
const picksApi = process.env.PK01_PICKS_API_ORIGIN;
if (picksApi) assert.ok(isLocalBase(base) && isLocalBase(picksApi), "a split-store replay is confined to local servers");
assert.match(zip, /^\d{5}$/);
const browser = await launchGuarded({ label: "PK-01-live", blockWrites: readonly || Boolean(picksApi),
  ...(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY, bypass: "127.0.0.1,localhost" } } : {}) });
try {
  const first = await browser.page({ viewport: { width: 1200, height: 900 } });
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
  await cards.first().waitFor();
  const capture = await cards.evaluateAll(elements => elements.map(element => {
    const pick = element.querySelector("[data-kind=pick]")!;
    return { contestId: element.getAttribute("data-contest-id"), contestOcdId: element.getAttribute("data-ocd-id"),
      contestTitle: element.querySelector("h2,h3")?.textContent?.trim() ?? "Contest",
      options: [...pick.querySelectorAll("button[aria-pressed]")].filter(button => !/not sure/i.test(button.textContent ?? ""))
        .map(button => ({ label: button.textContent!.trim().replace(/^[✓✕]\s*/, "") })) };
  }));
  mkdirSync(".scratch/pk-01", { recursive: true });
  writeFileSync(`.scratch/pk-01/${readonly ? "production-ballot" : "full-page-ballot"}.json`, JSON.stringify({ observedAt: new Date().toISOString(), source: `${base}/ballot?zip=${zip}`, runId: browser.runId, contests: capture }, null, 2));
  if (readonly) {
    console.log(JSON.stringify({ mode: "read-only", contests: capture.length, runId: browser.runId, writesBlocked: browser.writesBlocked.count }));
  } else {
    const race = cards.filter({ has: first.locator("[data-kind=pick] button[aria-pressed]") }).first();
    const contestId = await race.getAttribute("data-contest-id");
    const choices = race.locator("[data-kind=pick] button[aria-pressed]").filter({ hasNotText: /not sure/ });
    assert.ok(await choices.count() >= 2, "the test ballot needs a race with two choices");
    const labelA = (await choices.nth(0).innerText()).replace(/^[✓✕]\s*/, "");
    const labelB = (await choices.nth(1).innerText()).replace(/^[✓✕]\s*/, "");
    await choices.nth(0).click();
    await first.getByRole("button", { name: "Save my picks on another device" }).click();
    await first.getByRole("status").filter({ hasText: "Your picks are saved" }).waitFor({ timeout: 3000 });
    const link = await first.getByRole("textbox", { name: "Private picks link" }).inputValue();
    const fresh = await browser.page({ viewport: { width: 390, height: 844 } });
    await bridgeLocalPicks(fresh);
    const startedAt = Date.now();
    await fresh.goto(link, { waitUntil: "domcontentloaded" });
    const restored = fresh.locator(`[data-contest-id=${JSON.stringify(contestId)}] [data-kind=pick]`);
    await restored.getByRole("button", { name: labelA, exact: true, pressed: true }).waitFor({ timeout: 3000 });
    const restoreMs = Date.now() - startedAt;
    const restoreTiming = await fresh.evaluate(() => {
      const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
      const picks = performance.getEntriesByType("resource").filter(entry => new URL(entry.name).pathname === "/api/ballot/picks");
      return { documentMs: Math.round(navigation.responseEnd), privateReadMs: picks.map(entry => Math.round(entry.duration)) };
    });
    console.log(JSON.stringify({ restoreMs, ...restoreTiming }));
    assert.ok(restoreMs < 3000, `first restore took ${restoreMs}ms`);
    await restored.getByRole("button", { name: labelB, exact: true }).click();
    await race.getByRole("button", { name: labelB, exact: true, pressed: true }).waitFor({ timeout: 3000 });
    await race.getByRole("button", { name: labelA, exact: true }).click();
    await restored.getByRole("button", { name: labelA, exact: true, pressed: true }).waitFor({ timeout: 3000 });
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    await first.clock.setFixedTime(tomorrow);
    await fresh.clock.setFixedTime(tomorrow);
    await restored.getByRole("button", { name: labelB, exact: true }).click();
    await race.getByRole("button", { name: labelB, exact: true, pressed: true }).waitFor({ timeout: 3000 });
    await race.getByRole("button", { name: labelA, exact: true }).click();
    await restored.getByRole("button", { name: labelA, exact: true, pressed: true }).waitFor({ timeout: 3000 });
    await fresh.getByRole("heading", { name: "My picks", exact: true }).locator("..").screenshot({ path: ".scratch/pk-01/live-picks.png" });
    await fresh.screenshot({ path: ".scratch/pk-01/live-phone.png", fullPage: true });
    console.log(JSON.stringify({ passed: true, zip, restoreMs, runId: browser.runId, origin: base,
      tomorrow: tomorrow.toISOString().slice(0, 10), automaticPollingBothWays: true, splitStoreReplay: Boolean(picksApi) }));
    // Capability links are private: never put them in logs or evidence files.
  }
} finally { await browser.close(); }
