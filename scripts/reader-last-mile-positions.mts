import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { launchGuarded } from "./browser.mts";
import { unifiedCorpus } from "../lib/corpus/unified.ts";
import { positionsFor, searchTerms, type PositionAnswer } from "../lib/corpus/positions.ts";
import { reconciledCandidacyIdForCard } from "../lib/identity/az-2026.ts";
import { floored } from "../lib/ops/denominator-floor.ts";

const base = process.env.SHOOT_BASE_URL ?? "http://localhost:3210";
assert.match(new URL(base).hostname, /^(localhost|127\.0\.0\.1)$/);
const inventory = JSON.parse(readFileSync("docs/evidence/reader-last-mile-candidate-corpus-map.json", "utf8")) as { records: { auditId: string; snapshotId: string; subjectId: string }[] };
const plan = JSON.parse(readFileSync("docs/evidence/reader-last-mile-ballot-plan.json", "utf8")) as { chosen: { zip: string }[] };
const corpus = unifiedCorpus();
const pending = new Map(inventory.records.map((record) => [record.snapshotId, record]));
floored("candidate corpus position controls", "every eligible candidate snapshot in the canonical census", pending.size, inventory.records.length);
const proofs: unknown[] = [];
const dispositions: unknown[] = [];
const normalize = (text: string) => text.replace(/\s+/g, " ").trim();
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const browser = await launchGuarded({ label: "reader-last-mile-positions" });
const context = await browser.context({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
try {
  for (const { zip } of plan.chosen) {
    if (!pending.size) break;
    await page.goto(`${base}/ballot?zip=${zip}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
    const cards = await page.locator("[data-candidate-target]").all();
    for (const card of cards) {
      const cardKey = (await card.getAttribute("data-candidate-target"))!;
      const canonical = reconciledCandidacyIdForCard(cardKey) ?? cardKey;
      const mine = [...pending.values()].filter((record) => record.subjectId === cardKey || (reconciledCandidacyIdForCard(record.subjectId) ?? record.subjectId) === canonical);
      if (!mine.length) continue;
      await card.locator("[data-battlecard-pill]").click();
      const modal = page.locator("[data-candidate-battlecard]");
      await modal.waitFor({ state: "visible" });
      assert.equal(await modal.getAttribute("data-candidate-subject"), cardKey);
      // The search is an existing nested disclosure inside the candidate's
      // Positions section. Open both real controls; never set React state.
      const input = modal.locator("[data-positions-search]");
      for (let depth = 0; depth < 3 && !(await input.isVisible().catch(() => false)); depth++) {
        for (const button of await modal.getByRole("button", { name: "Positions", exact: true }).all()) {
          if ((await button.getAttribute("aria-expanded")) !== "true") { await button.click(); break; }
        }
      }
      await input.waitFor({ state: "visible" });
      for (const record of mine) {
        const snapshot = corpus.snapshots.find((snapshot) => snapshot.id === record.snapshotId);
        assert.ok(snapshot?.text && snapshot.extraction === "ok", record.auditId);
        const topic = searchTerms(snapshot.text).find((word) => positionsFor(record.subjectId, word, corpus).passages.some((passage) => passage.snapshotId === record.snapshotId));
        if (!topic) {
          dispositions.push({ ...record, cardKey, state: "INTENTIONALLY_NOT_APPLICABLE", reason: "Canonical quotation selector produces no distinct quotable passage from this snapshot; extraction existence cannot make excluded text quotable." });
          pending.delete(record.snapshotId);
          continue;
        }
        await input.fill("");
        const responsePending = page.waitForResponse((response) => response.url().includes(`/api/positions/${encodeURIComponent(cardKey)}/${encodeURIComponent(topic)}`));
        await input.fill(topic);
        const response = await responsePending;
        assert.equal(response.status(), 200);
        const answer = await response.json() as PositionAnswer & { totalMatches: number };
        assert.ok(answer.passages.some((passage) => passage.snapshotId === record.snapshotId), `${record.auditId}: disappeared under actual card ${cardKey}`);
        const result = modal.locator('[data-positions-answer="MATCHED"]');
        await result.waitFor({ state: "visible" });
        const figures = result.locator("figure");
        assert.equal(answer.totalMatches, answer.passages.length);
        assert.equal(await figures.count(), answer.passages.length);
        for (const [index, passage] of answer.passages.entries()) {
          assert.ok(normalize(await figures.nth(index).innerText()).includes(normalize(passage.quote)));
          assert.equal(await figures.nth(index).locator(`a[href="${passage.url}"]`).count(), 1);
        }
        const renderedText = normalize(await result.innerText());
        assert.ok(renderedText.includes(`Showing ${answer.passages.length} of ${answer.totalMatches}`));
        proofs.push({ ...record, zip, cardKey, canonicalCandidacyId: canonical, topic, returnedRecordIds: answer.passages.map((passage) => passage.snapshotId), statedCount: answer.totalMatches, renderedCount: await figures.count(), payload: answer, payloadSha256: hash(answer), renderedTextSha256: hash(renderedText) });
        pending.delete(record.snapshotId);
      }
      await page.keyboard.press("Escape");
      await modal.waitFor({ state: "hidden" });
    }
    console.log(JSON.stringify({ zip, proved: proofs.length, remaining: pending.size }));
  }
} finally { await context.close(); await browser.close(); }
const output = { exactHead: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), buildId: readFileSync(".next/BUILD_ID", "utf8").trim(), execution: "Actual candidate battlecard gestures, typed source-grounded query, real positions HTTP route, every returned quotation/citation/count inspected in rendered DOM.", expectedCount: inventory.records.length, proofs, dispositions, unresolved: [...pending.values()] };
writeFileSync("docs/evidence/reader-last-mile-positions.json", JSON.stringify(output, null, 2) + "\n");
assert.equal(pending.size, 0, "Every current reader-eligible candidate snapshot must have an actual reader query or explicit quotation exclusion.");
console.log(JSON.stringify({ proofs: proofs.length, dispositions: dispositions.length, unresolved: pending.size }));
