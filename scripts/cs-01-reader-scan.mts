/**
 * CS-01's real-page reader sweep. Uses the serving app and its real records,
 * never fixture answers. Run again against meanwhileusa.com after shipping.
 *
 * NODE_USE_ENV_PROXY=1 WTP_CHROMIUM_EXECUTABLE=/usr/bin/chromium node \
 *   --experimental-strip-types scripts/cs-01-reader-scan.mts --base=http://localhost:3000
 * --base=https://meanwhileusa.com checks the deployed site. --zips=53202 is diagnostic.
 * The default checks twenty states both now and with tomorrow's reader clock.
 * The clock replay checks the reader; upstream scheduling needs its own real
 * routine-task clock replay and must not be inferred from this result.
 *
 * Remote public responses pass through Node's TLS-verifying fetch when the
 * managed proxy is configured. This task-scoped bridge leaves browser trust
 * unchanged. Local HTML, JavaScript, styles, and APIs remain native browser reads.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Page, Response as BrowserResponse } from "playwright";
import { launchGuarded, seedZip } from "./browser.mts";
import { READER_CAPITAL_WORDS } from "../lib/text/reader-names.ts";
import { isLiveWriteRequest } from "../lib/ops/live-write-guard.ts";
import { PUBLIC_SITE_ORIGIN } from "../lib/ops/origins.ts";
import { syntheticRunHeaders } from "../lib/db/run-marker.ts";

type Probe = { state: string; zip: string; address: string };
// Physical house/apartment addresses rather than ZIP centroids or government offices.
export const CS01_PLACES: readonly Probe[] = [
  { state: "WI", zip: "53202", address: "777 N Van Buren St, Milwaukee, WI 53202" },
  { state: "TX", zip: "77005", address: "2043 Wroxton Rd, Houston, TX 77005" },
  { state: "PA", zip: "19107", address: "1212 Spruce St, Philadelphia, PA 19107" },
  { state: "CA", zip: "94118", address: "100 Lake St, San Francisco, CA 94118" },
  { state: "AZ", zip: "85701", address: "1 E Broadway Blvd, Tucson, AZ 85701" },
  { state: "NY", zip: "10023", address: "1 W 72nd St, New York, NY 10023" },
  { state: "MA", zip: "02116", address: "1 Huntington Ave, Boston, MA 02116" },
  { state: "IL", zip: "60614", address: "1827 N Sheffield Ave, Chicago, IL 60614" },
  { state: "WA", zip: "98102", address: "1212 10th Ave E, Seattle, WA 98102" },
  { state: "OR", zip: "97209", address: "1380 NW 14th Ave, Portland, OR 97209" },
  { state: "CO", zip: "80204", address: "1250 Cherokee St, Denver, CO 80204" },
  { state: "NV", zip: "89101", address: "901 Fremont St, Las Vegas, NV 89101" },
  { state: "GA", zip: "30309", address: "1080 Peachtree St NE, Atlanta, GA 30309" },
  { state: "FL", zip: "33139", address: "1500 Ocean Dr, Miami Beach, FL 33139" },
  { state: "LA", zip: "70112", address: "212 Loyola Ave, New Orleans, LA 70112" },
  { state: "TN", zip: "37212", address: "1620 21st Ave S, Nashville, TN 37212" },
  { state: "MI", zip: "48202", address: "15 E Kirby St, Detroit, MI 48202" },
  { state: "MN", zip: "55102", address: "291 7th St W, Saint Paul, MN 55102" },
  { state: "NJ", zip: "07102", address: "2 Center St, Newark, NJ 07102" },
  { state: "RI", zip: "02903", address: "1 Park Row W, Providence, RI 02903" },
];

const arg = (name: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const base = (arg("base") ?? "http://localhost:3000").replace(/\/$/, "");
const apiBase = arg("api-base")?.replace(/\/$/, "");
const assetsBase = arg("assets-base")?.replace(/\/$/, "");
const votingBase = arg("voting-base")?.replace(/\/$/, "");
const output = resolve(arg("out") ?? ".scratch/cs-01/reader-scan");
const selected = arg("zips")?.split(",");
const probes = CS01_PLACES.filter(place => !selected || selected.includes(place.zip));
const passes = (arg("passes") ?? "now,tomorrow").split(",");
const concurrency = Number(arg("concurrency") ?? "1");
assert.ok(probes.length, "At least one real place must be checked");
if (!selected) assert.equal(new Set(probes.map(place => place.state)).size, 20);
assert.ok(passes.every(pass => pass === "now" || pass === "tomorrow"));
assert.ok(Number.isInteger(concurrency) && concurrency >= 1 && concurrency <= 4, "Use one to four isolated reader contexts");

type Offender = { word: string; text: string; selector: string; transform: string };
type Stage = { name: string; ms: number; words: number; offenders: Offender[]; text: string; screenshot: string };
type ReadEvidence = { path: string; method: string; status: number; sha256: string; bytes: number; capture: string; capitals: string[] };
type Result = Probe & { pass: string; readerClock: string; complete: boolean; stages: Stage[]; errors: string[]; limitations: string[]; reads: ReadEvidence[]; auxiliaryResponses: { path: string; status: number }[]; heldBodies?: number; board?: string; voting?: { precision: unknown; point: unknown; sites: number }; moore?: string[]; partyLabels?: string[] };

/** Tests computed reader text as well as source capitals, including CSS transforms. */
export async function visibleCapitals(page: Page): Promise<{ words: number; offenders: Offender[]; text: string }> {
  const entries = await page.evaluate(() => {
    const entries: { text: string; selector: string; transform: string }[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode, element = node.parentElement;
      if (!element || !node.textContent?.trim() || element.closest("script,style,noscript,template")) continue;
      if (!element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
      let hidden = false;
      for (let ancestor: HTMLElement | null = element; ancestor; ancestor = ancestor.parentElement) {
        if (ancestor.hidden || getComputedStyle(ancestor).opacity === "0") { hidden = true; break; }
        if (ancestor instanceof HTMLDetailsElement && !ancestor.open && !ancestor.querySelector(":scope > summary")?.contains(node)) { hidden = true; break; }
      }
      if (hidden) continue;
      const range = document.createRange(); range.selectNodeContents(node);
      if (![...range.getClientRects()].some(rect => rect.width > 0 && rect.height > 0)) continue;
      const transform = getComputedStyle(element).textTransform;
      const text = transform === "uppercase" ? node.textContent.toUpperCase() : transform === "lowercase" ? node.textContent.toLowerCase() : node.textContent;
      const selector = `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}${[...element.classList].slice(0, 3).map(name => `.${name}`).join("")}`;
      entries.push({ text, selector, transform });
    }
    // Input values are reader-visible too, although they are not text nodes.
    for (const element of document.querySelectorAll<HTMLInputElement>("input:not([type=hidden]),textarea")) {
      if (element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) && element.value) entries.push({ text: element.value, selector: element.tagName.toLowerCase(), transform: "none" });
    }
    return entries;
  });
  const offenders: Offender[] = [];
  let words = 0;
  for (const entry of entries) {
    const tokens = entry.text.match(/(?<![\p{L}\p{M}\p{N}])[\p{L}\p{M}]+(?![\p{L}\p{M}\p{N}])/gu) ?? [];
    words += tokens.length;
    for (const word of tokens) {
      if (word.length >= 3 && word === word.toUpperCase() && word !== word.toLowerCase() && !READER_CAPITAL_WORDS.has(word)) offenders.push({ word, text: entry.text.trim(), selector: entry.selector, transform: entry.transform });
    }
  }
  return { words, offenders, text: entries.map(entry => entry.text).join("\n") };
}

function rawCapitals(value: unknown, found = new Set<string>()): string[] {
  if (typeof value === "string") {
    for (const token of value.match(/(?<![\p{L}\p{M}\p{N}])[\p{L}\p{M}]+(?![\p{L}\p{M}\p{N}])/gu) ?? []) if (token.length >= 3 && token === token.toUpperCase() && token !== token.toLowerCase() && !READER_CAPITAL_WORDS.has(token)) found.add(token);
  } else if (Array.isArray(value)) for (const child of value) rawCapitals(child, found);
  else if (value && typeof value === "object") for (const child of Object.values(value)) rawCapitals(child, found);
  return [...found];
}

async function closeCards(page: Page) {
  for (let index = 0; index < 8; index++) {
    const close = page.locator('[data-reader-card]:visible [data-mw="card-close"]');
    if (!await close.count()) return;
    await close.click();
  }
  throw new Error("Reader card did not close using its visible control");
}

async function showSources(page: Page) {
  const control = page.locator('[data-reader-card]:visible [data-card-sources] button[aria-expanded="false"]');
  if (await control.count()) await control.last().click();
}

/** Inspect each source panel once; opening a panel may close its sibling. */
export async function inspectSourceSections(page: Page): Promise<Awaited<ReturnType<typeof visibleCapitals>> | undefined> {
  const sources = page.locator("[data-card-sources]").filter({ visible: true });
  const inspections: Awaited<ReturnType<typeof visibleCapitals>>[] = [];
  for (const section of await sources.all()) {
    const button = section.locator("button[aria-expanded]").first();
    if (!await button.count() || !await button.isVisible()) continue;
    if (await button.getAttribute("aria-expanded") !== "true") await button.click();
    inspections.push(await visibleCapitals(page));
  }
  return inspections.length ? {
    words: inspections.reduce((sum, inspection) => sum + inspection.words, 0),
    offenders: inspections.flatMap(inspection => inspection.offenders),
    text: inspections.map((inspection, index) => `Source section ${index + 1}\n${inspection.text}`).join("\n\n"),
  } : undefined;
}

async function bounded<T>(promise: Promise<T>, label: string, milliseconds = 30_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error(`${label} exceeded ${milliseconds}ms`)), milliseconds); })]);
  } finally { clearTimeout(timer); }
}

async function scan() {
  await mkdir(output, { recursive: true });
  const now = new Date();
  const browser = await launchGuarded({ label: "cs-01-reader-scan", headless: true, blockWrites: true, args: ["--no-sandbox"] });
  const results: Result[] = [];
  const bridgeErrors: string[] = [], extraWritesBlocked: string[] = [];
  const marker = syntheticRunHeaders({ WTP_RUN_ID: browser.runId });
  const bridgeRemote = Boolean(process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY);
  let pendingSave = Promise.resolve();
  const persist = () => pendingSave = pendingSave.then(() => writeFile(`${output}/summary.json`, JSON.stringify({ checkedAt: now.toISOString(), base, apiBase: apiBase ?? null, assetsBase: assetsBase ?? null, votingBase: votingBase ?? null, productionOrigin: PUBLIC_SITE_ORIGIN,
    fullTwentyStateScan: !selected, passes, concurrency, runId: browser.runId, acronymList: [...READER_CAPITAL_WORDS],
    transport: bridgeRemote ? "Remote public responses use Node TLS-verifying fetch; local responses use native Chromium" : "Native Chromium",
    upstreamScheduleProven: false, writesBlocked: browser.writesBlocked.count + extraWritesBlocked.length,
    blockedPaths: [...new Set([...browser.writesBlocked.paths, ...extraWritesBlocked])], provider: { spent: browser.provider.spent, blocked: browser.provider.blocked }, bridgeErrors, results,
  }, null, 2) + "\n"));
  try {
    const runProbe = async (pass: string, probe: Probe) => {
      const readerClock = new Date(now.getTime() + (pass === "tomorrow" ? 86_400_000 : 0));
      const folder = `${output}/${pass}/${probe.state}-${probe.zip}`;
      await mkdir(`${folder}/responses`, { recursive: true });
      const result: Result = { ...probe, pass, readerClock: readerClock.toISOString(), complete: false, stages: [], errors: [], limitations: [], reads: [], auxiliaryResponses: [] };
      results.push(result);
      const pendingReads: Promise<void>[] = [];
      const page = await browser.page({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
      const safeLookups = new Set(["/api/voting-sites", "/api/address/resolve", "/api/ballot/scope"]);
      await page.route("**/*", async route => {
        const request = route.request(), url = new URL(request.url());
        if (isLiveWriteRequest(request.url(), request.method())) { extraWritesBlocked.push(url.pathname); return route.abort("blockedbyclient"); }
        if (!["GET", "HEAD", "OPTIONS"].includes(request.method()) && !safeLookups.has(url.pathname)) {
          extraWritesBlocked.push(url.pathname); return route.abort("blockedbyclient");
        }
        const apiReplay = Boolean(apiBase && url.origin === new URL(base).origin && (url.pathname.startsWith("/api/") || url.pathname.startsWith("/geo/reader-zips/")));
        const assetReplay = Boolean(assetsBase && url.origin === new URL(base).origin && url.pathname.startsWith("/geo/reader-zips/"));
        const votingReplay = Boolean(votingBase && url.origin === new URL(base).origin && url.pathname === "/api/voting-sites");
        const remoteUrl = apiReplay ? new URL(url.pathname + url.search, apiBase).href : assetReplay ? new URL(url.pathname + url.search, assetsBase).href : votingReplay ? new URL(url.pathname + url.search, votingBase).href : request.url();
        if (!apiReplay && !assetReplay && !votingReplay && (!bridgeRemote || url.protocol !== "https:" || ![new URL(base).origin, PUBLIC_SITE_ORIGIN, "https://tiles.meanwhilemaps.com"].includes(url.origin))) return route.fallback();
        try {
          const headers = { ...request.headers(), ...(url.origin === PUBLIC_SITE_ORIGIN || url.origin === new URL(base).origin ? marker : {}) };
          for (const name of ["host", "connection", "accept-encoding", "content-length"]) delete headers[name];
          if (url.origin !== PUBLIC_SITE_ORIGIN && url.origin !== new URL(base).origin) for (const name of Object.keys(marker)) delete headers[name];
          // The unchanged lookup endpoint offers the same answer as JSON and
          // NDJSON. A proxy bridge requests its complete JSON representation.
          if (votingReplay) headers.accept = "application/json";
          const response = await fetch(remoteUrl, { method: request.method(), headers, ...(request.postData() ? { body: request.postData()! } : {}), redirect: "manual", signal: AbortSignal.timeout(45_000) });
          const responseHeaders = Object.fromEntries(response.headers);
          for (const name of ["content-encoding", "content-length", "transfer-encoding"]) delete responseHeaders[name];
          await route.fulfill({ status: response.status, headers: responseHeaders, body: Buffer.from(await response.arrayBuffer()) });
        } catch (error) { bridgeErrors.push(`${request.method()} ${url.pathname}: ${String(error)}`); await route.abort("failed").catch(() => {}); }
      });
      await seedZip(page, probe.zip);
      await page.clock.setFixedTime(readerClock);
      page.on("pageerror", error => result.errors.push(`Page error: ${error.message}`));
      const capture = async (response: BrowserResponse) => {
        const url = new URL(response.url());
        if (!url.pathname.startsWith("/api/") || isLiveWriteRequest(url.href, response.request().method()) || response.status() === 304) return;
        if (/^\/api\/reader\/(?:settings|link-health)$/.test(url.pathname)) {
          result.auxiliaryResponses.push({ path: url.pathname, status: response.status() });
          return;
        }
        if (!/json/i.test(response.headers()["content-type"] ?? "")) return;
        try {
          const bytes = await bounded(response.body(), `Capture ${url.pathname}`), sha256 = createHash("sha256").update(bytes).digest("hex");
          const path = `${folder}/responses/${sha256}.txt`;
          await writeFile(path, bytes);
          let payload: unknown;
          const text = bytes.toString("utf8");
          try { payload = JSON.parse(text); } catch { payload = text.split("\n").filter(Boolean).map(line => { try { return JSON.parse(line); } catch { return line; } }); }
          result.reads.push({ path: url.pathname + url.search, method: response.request().method(), status: response.status(), sha256, bytes: bytes.length, capture: path, capitals: rawCapitals(payload).slice(0, 60) });
          if (url.pathname === "/api/meetings" && payload && typeof payload === "object" && "stateResponse" in payload) {
            const nested = (payload as { stateResponse?: { status: number; value: unknown } }).stateResponse;
            if (nested) result.reads.push({ path: "/api/reader/state (included in meetings)", method: "GET", status: nested.status, sha256: createHash("sha256").update(JSON.stringify(nested.value)).digest("hex"), bytes: Buffer.byteLength(JSON.stringify(nested.value)), capture: path, capitals: rawCapitals(nested.value).slice(0, 60) });
          }
          if (url.pathname === "/api/voting-sites") {
            const answer = Array.isArray(payload) ? payload.find(row => row && typeof row === "object" && "answer" in row)?.answer : payload;
            if (answer && typeof answer === "object") {
              const voting = answer as { precision?: string; point?: unknown; jurisdictions?: { sites?: unknown[] }[] };
              result.voting = { precision: voting.precision, point: voting.point ?? null, sites: voting.jurisdictions?.reduce((sum, row) => sum + (row.sites?.length ?? 0), 0) ?? 0 };
            }
          }
        } catch (error) { result.errors.push(`Could not capture ${url.pathname}: ${String(error)}`); }
      };
      page.on("response", response => { pendingReads.push(capture(response)); });
      const stage = async (name: string, started: number, inspected?: Awaited<ReturnType<typeof visibleCapitals>>) => {
        const ms = Math.round(performance.now() - started);
        const snapshot = inspected ?? await visibleCapitals(page);
        const text = `${folder}/${name}.txt`, screenshot = `${folder}/${name}.png`;
        await writeFile(text, snapshot.text + "\n");
        result.stages.push({ name, ms, words: snapshot.words, offenders: snapshot.offenders, text, screenshot });
        await persist();
        await page.screenshot({ path: screenshot, fullPage: false, animations: "disabled", timeout: 10_000 });
      };
      const attempt = async (name: string, operation: () => Promise<void>) => {
        try { await operation(); } catch (error) { result.errors.push(`${name}: ${String(error)}`); }
      };
      try {
        await attempt("place", async () => {
          const started = performance.now();
          const placeRead = page.waitForResponse(response => {
            const url = new URL(response.url());
            return url.pathname === "/api/meetings" && url.searchParams.get("zip") === probe.zip;
          }, { timeout: 30_000 });
          await page.goto(`${base}/?zip=${probe.zip}`, { waitUntil: "domcontentloaded", timeout: 45_000 });
          const response = await placeRead;
          if (!response.ok()) throw new Error(`The real place response returned HTTP ${response.status()}`);
          const held = await bounded(response.json(), "Held place response") as { coverage?: { bodies?: { bodyId: string }[] }; stateResponse?: { value?: { coverage?: { bodies?: { bodyId: string }[] } } } };
          const bodyIds = new Set([...(held.coverage?.bodies ?? []), ...(held.stateResponse?.value?.coverage?.bodies ?? [])].map(body => body.bodyId));
          result.heldBodies = bodyIds.size;
          await page.waitForFunction(expected => Number(document.querySelector('[data-stat="bodies here"] .num')?.textContent) === expected
            && Number(document.querySelector('[data-stat="officials"] .num')?.textContent) > 0, bodyIds.size, { timeout: 10_000 });
          await page.getByRole("button", { name: "Who governs here?", exact: true }).filter({ visible: true }).click();
          await page.locator("[data-reader-card]:visible .coverage-notice-body").waitFor({ timeout: 20_000 });
          await stage("governs", started);
          await showSources(page);
          await stage("governs-sources", performance.now());
        });
        await attempt("board", async () => {
          await closeCards(page);
          const heldCount = result.heldBodies ?? Number(await page.locator('[data-stat="bodies here"] .num').textContent());
          if (heldCount === 0) throw new Error("This ZIP's held place response contains no board/body record, so the required board card cannot be opened");
          await page.locator('[data-stat="bodies here"]').click();
          const buttons = page.locator('[data-reader-card="door:bodies"] button[title^="More about "]');
          await buttons.first().waitFor({ timeout: 20_000 });
          const chosen = probe.zip === "53202" ? buttons.filter({ hasText: /^Common Council/ }).first() : buttons.first();
          result.board = (await chosen.innerText()).replace(/\s+/g, " ").trim();
          const started = performance.now();
          await chosen.click();
          await page.locator("[data-reader-card]:visible .account-modal-title").waitFor({ timeout: 20_000 });
          const representation = page.locator('[data-reader-card]:visible button.card-section-header').filter({ hasText: /^Who sits on it/ });
          if (await representation.count() && await representation.first().getAttribute("aria-expanded") !== "true") await representation.first().click();
          await stage("board", started);
          if (probe.zip === "53202") {
            const moore = await page.locator('[data-roster-holder]').allTextContents().then(rows => rows.filter(row => /moore/i.test(row)));
            result.moore = moore;
            if (!moore.some(row => /Ald\. Moore/.test(row))) result.errors.push('Milwaukee Common Council does not visibly show "Ald. Moore"');
          }
          // Read the held contact, jurisdiction, meeting, and money sections too.
          // Their controls exist only when that body has readable content.
          const sectionTitles = await page.locator('[data-reader-card]:visible .card-section-title').filter({ visible: true }).allTextContents();
          for (const title of [...new Set(sectionTitles)].filter(title => title !== "Sources" && title !== "Who sits on it")) {
            const header = page.locator('[data-reader-card]:visible button.card-section-header').filter({ has: page.locator(".card-section-title", { hasText: title }) }).first();
            if (!await header.count()) continue;
            const opened = performance.now();
            if (await header.getAttribute("aria-expanded") !== "true") await header.click();
            await stage(`board-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-$/, "")}`, opened);
          }
          await showSources(page);
          await stage("board-sources", performance.now());
        });
        await attempt("voting", async () => {
          await closeCards(page);
          await page.getByRole("button", { name: "Where can I vote?", exact: true }).filter({ visible: true }).click();
          await page.getByLabel("Your street address or ZIP").fill(probe.address);
          const started = performance.now();
          const response = page.waitForResponse(response => new URL(response.url()).pathname === "/api/voting-sites", { timeout: 30_000 });
          await page.getByRole("button", { name: "Show me", exact: true }).click();
          await bounded((await response).finished(), "Voting answer stream");
          await page.locator("[data-voting-jurisdiction], [data-voting-coverage-gap], [data-reader-card] [data-card-gap]").first().waitFor({ timeout: 20_000 });
          await stage("voting", started);
          await showSources(page);
          await stage("voting-sources", performance.now());
        });
        await attempt("ballot", async () => {
          const started = performance.now();
          await page.goto(`${base}/ballot?zip=${probe.zip}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
          await page.locator("[data-ballot-complete]").waitFor({ timeout: 45_000 });
          if (!await page.locator("[data-contest-id]").count()) result.errors.push("The ballot page contains no real contest or measure to exercise casing");
          const partyLabels = (await page.locator(".candidate-row .text-right").allTextContents()).map(text => text.trim());
          result.partyLabels = partyLabels;
          if (partyLabels.some(text => /\bPND\b/i.test(text))) result.errors.push("A candidate party label still abbreviates Party Not Designated");
          if (probe.state === "AZ" && !partyLabels.some(text => /\bParty Not Designated\b/.test(text))) result.errors.push("Arizona's real candidate party labels do not visibly expand Party Not Designated");
          await stage("ballot", started);
          const sourceStarted = performance.now();
          await stage("ballot-sources", sourceStarted, await inspectSourceSections(page));
        });
      } finally {
        await Promise.allSettled(pendingReads);
        const required = ["governs", "governs-sources", "board", "board-sources", "voting", "voting-sources", "ballot", "ballot-sources"];
        const missing = required.filter(name => !result.stages.some(stage => stage.name === name));
        if (missing.length) result.errors.push(`Required reader paths not completed: ${missing.join(", ")}`);
        if (!result.voting) result.errors.push("The real home voting lookup produced no inspectable answer");
        else if (!result.voting.point) result.limitations.push("The public voting lookup accepted the real residence input but supplied no address point");
        for (const name of ["/api/meetings", "/api/reader/state"]) if (!result.reads.some(read => read.path.startsWith(name) && read.status === 200)) result.errors.push(`No successful real ${name} read reached the browser`);
        await page.context().close();
        result.complete = true;
        await persist();
        const caps = result.stages.reduce((sum, item) => sum + item.offenders.length, 0);
        console.log(`${pass} ${probe.state} ${probe.zip}: ${result.stages.length} snapshots, ${caps} unapproved capital words; ${result.errors.join("; ") || "reader paths completed"}`);
      }
    };
    const work = passes.flatMap(pass => probes.map(probe => ({ pass, probe })));
    let cursor = 0;
    await Promise.all(Array.from({ length: concurrency }, async () => {
      while (cursor < work.length) {
        const item = work[cursor++];
        await runProbe(item.pass, item.probe);
      }
    }));
  } finally { await browser.close(); await persist(); }
  const failures = results.filter(result => !result.complete || result.errors.length || result.stages.some(stage => stage.offenders.length));
  if (failures.length || bridgeErrors.length || results.length !== probes.length * passes.length) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) await scan();
