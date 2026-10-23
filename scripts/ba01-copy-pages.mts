/** Inspect the requested ballot pages on a local server connected to the BA-01 production copy. */
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { launchGuarded } from "./browser.mts";

const origin = new URL(process.env.BA01_COPY_ORIGIN ?? "http://127.0.0.1:3091");
assert.ok(["127.0.0.1", "localhost"].includes(origin.hostname), "This inspection only runs against a local copy server.");
assert.equal(process.env.WTP_RUNTIME_MODE, "staging");
assert.equal(new URL(process.env.DATABASE_URL!).hostname, "ep-ancient-cherry-axl201ul-pooler.c-4.us-east-2.aws.neon.tech");
const requested = JSON.parse(await readFile("data/ballot/reports/ba01-zip-acceptance.json", "utf8")) as { zips: { zip: string }[] };
const typed = JSON.parse(await readFile("data/ballot/reports/ba01-production-copy.json", "utf8")) as {
  zips: { zip: string; contests: { id: string; type: string; title: string }[] }[];
};
const reportPath = "data/ballot/reports/ba01-production-copy-pages.json";
const selection = process.argv.find(arg => arg.startsWith("--zips="))?.slice(7).split(",");
const allZips = [...requested.zips.map(row => row.zip), "85701"];
assert.ok(!selection || selection.every(zip => allZips.includes(zip)));
const baseline = JSON.parse(await readFile("data/ballot/ba01-west-evidence/az-reader-baseline.json", "utf8")) as { tucsonContestIds: string[] };
let previous: { zips?: { zip: string; error?: string }[] } = {};
if (selection) try { previous = JSON.parse(await readFile(reportPath, "utf8")); } catch { /* first inspection */ }
const browser = await launchGuarded({ label: "ba01-production-copy-pages", blockWrites: true, headless: true });
const rows: Record<string, unknown>[] = [...previous.zips ?? []];
await mkdir(".scratch/ba01-copy-pages", { recursive: true });
try {
  for (const zip of selection ?? allZips) {
    const previousRow = rows.find(row => row.zip === zip);
    const previousIndex = rows.findIndex(row => row.zip === zip);
    if (previousIndex >= 0) rows.splice(previousIndex, 1);
    const page = await browser.page({ viewport: { width: 1280, height: 900 } });
    const began = Date.now();
    try {
      const response = await page.goto(new URL(`/ballot?zip=${zip}`, origin).href, { waitUntil: "domcontentloaded", timeout: 60_000 });
      const expected = typed.zips.find(row => row.zip === zip)?.contests ?? [];
      const expectedIds = expected.filter(row => row.type !== "RETENTION").map(row => row.id);
      await page.locator("[data-contest-id]").first().waitFor({ timeout: 60_000 });
      if (expectedIds.length) await page.waitForFunction(ids => ids.every(id =>
        [...document.querySelectorAll("[data-contest-id]")].some(element => element.getAttribute("data-contest-id") === id)), expectedIds,
      { timeout: 60_000 });
      const elapsedMs = Date.now() - began;
      const pageData = await page.evaluate(() => ({
        title: document.title,
        contests: [...document.querySelectorAll("[data-contest-id]")].map(element => ({
          id: element.getAttribute("data-contest-id")!,
          title: element.querySelector("h2,h3,h4")?.textContent ?? "",
          candidates: [...element.querySelectorAll("[data-candidate-target]")].map(candidate => candidate.getAttribute("data-candidate-target")!),
        })),
        gaps: [...new Set((document.body.innerText.match(/[^\n]*We're working on getting[^\n]*/g) ?? []))],
      }));
      const contests = [...new Map(pageData.contests.map(row => [row.id, row])).values()];
      const candidateCount = new Set(contests.flatMap(row => row.candidates)).size;
      const ids = new Set(contests.map(row => row.id));
      const missingHeldContests = expected.filter(row => !ids.has(row.id));
      const priorTucsonIdsMissing = zip === "85701" ? baseline.tucsonContestIds.filter(id => !ids.has(id)) : [];
      assert.deepEqual(priorTucsonIdsMissing, [], "Every original Tucson contest must remain visible.");
      rows.push({ zip, checkedAt: new Date().toISOString(), httpStatus: response?.status(), elapsedMs,
        underThreeSeconds: elapsedMs < 3000, missingHeldContests, priorTucsonIdsMissing,
        ...(previousRow?.error ? { priorInspectionError: previousRow.error,
          explanation: "The first inspection waited for retention cards that the current page filters out. This inspection records those actual missing cards explicitly." } : {}),
        ...pageData, contests, contestCount: contests.length, candidateCount });
      await page.screenshot({ path: `.scratch/ba01-copy-pages/${zip}.png`, fullPage: zip === "85701" });
      console.log(`${zip}: HTTP ${response?.status()}, ${contests.length} contests, ${candidateCount} candidate targets, ${elapsedMs}ms`);
    } catch (error) {
      rows.push({ zip, error: error instanceof Error ? error.message : String(error), elapsedMs: Date.now() - began });
      console.log(`${zip}: page inspection failed`);
    } finally { await page.close(); }
  }
} finally { await browser.close(); }
rows.sort((a, b) => allZips.indexOf(String(a.zip)) - allZips.indexOf(String(b.zip)));
await writeFile(reportPath, JSON.stringify({
  checkedAt: new Date().toISOString(), branchId: "br-wandering-shape-ax3ranho", parentBranchId: "br-delicate-lab-ax02xuo5",
  runId: browser.runId, origin: origin.origin, syntheticWritesBlocked: browser.writesBlocked.count,
  runtime: "Next development server using the real route and copied production database; timings are local development observations.",
  meaning: "Actual local /ballot pages connected to an isolated production database copy after publication; official completeness and live publication are reported separately.",
  zips: rows,
}, null, 2) + "\n");
assert.ok(rows.length === allZips.length && rows.every(row => row.httpStatus === 200 && Number(row.contestCount) > 0), "Every requested page must render contests.");
