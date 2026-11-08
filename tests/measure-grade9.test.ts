import assert from "node:assert/strict";
import test from "node:test";
import { MODELS } from "../lib/models.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { fieldManualEntryId } from "../lib/control-plane/field-manual.ts";
import { PLAYBOOK_SEED_ROWS, ensureRolePlaybooks, seedRolePlaybooks } from "../lib/control-plane/playbook-seed.ts";
import { rolePlaybook } from "../lib/control-plane/playbooks.ts";
import { CARD_WRITING_RULES } from "../lib/reader/card-writer.ts";
import { MEASURE_WRITING_VERSION, type MeasureTranslation } from "../lib/translate/records.ts";
import { needsMeasureRewrite } from "../lib/translate/source-evidence.ts";
import { translationPlaybook } from "../lib/translate/worker.ts";

const row = (ocdId: string, writingRulesVersion: string | undefined, sourceUrl = "https://elections.example.gov/measures") =>
  ({ ocdId, sourceUrl, writingRulesVersion }) as unknown as MeasureTranslation;
const seed = (role: "MEASURE_WRITER" | "MEASURE_CHECKER") => (PLAYBOOK_SEED_ROWS.find(entry => entry.role === role)!.payload as { text: string }).text;

test("a held explainer from older writing rules needs a rewrite in any state, and a current one does not", () => {
  for (const state of ["ia", "md", "oh", "ca"]) {
    const ocd = `ocd-division/country:us/state:${state}`;
    assert.equal(needsMeasureRewrite(row(ocd, "an-older-version")), true, state);
    assert.equal(needsMeasureRewrite(row(ocd, undefined)), true, `${state} record from before versioning`);
    assert.equal(needsMeasureRewrite(row(ocd, MEASURE_WRITING_VERSION)), false, state);
  }
  assert.equal(needsMeasureRewrite(row("ocd-division/country:us/state:az", "an-older-version")), true);
  assert.equal(needsMeasureRewrite(row("ocd-division/country:us/state:co", MEASURE_WRITING_VERSION)), true, "Colorado still needs the Blue Book");
});

test("the writing rules every measure writer receives ask for a 9th-grade level and no legal wording", () => {
  const rules = CARD_WRITING_RULES.join(" ");
  assert.match(rules, /9th-grade reading level/);
  assert.match(rules, /no legal wording/);
  assert.doesNotMatch(rules, /high-school/);
});

test("the writer and checker instructions carry the 9th-grade, legal-wording and support criteria; Haiku writes and Sonnet checks", () => {
  const writer = seed("MEASURE_WRITER"), checker = seed("MEASURE_CHECKER");
  for (const text of [writer, checker]) {
    assert.match(text, /9th-grade reading level/);
    assert.match(text, /no legal wording/);
    assert.doesNotMatch(text, /high-school/);
  }
  assert.match(checker, /legal wording is left in/);
  assert.match(checker, /above a 9th-grade level/);
  assert.match(checker, /not supported by the cited official passages/);
  const book = translationPlaybook(PLAYBOOK_SEED_ROWS.filter(entry => entry.role === "MEASURE_WRITER" || entry.role === "MEASURE_CHECKER"));
  assert.equal(book.writerModel, MODELS.haiku.model);
  assert.equal(book.checkerModel, MODELS.sonnet.model);
});

test("a measure playbook still holding the shipped high-school text gets the 9th-grade text once, and an edited one is left alone", async () => {
  const shipped = (role: "MEASURE_WRITER" | "MEASURE_CHECKER") => seed(role)
    .replace(/Write clear, neutral English at a 9th-grade[^:]*: short sentences, everyday words and no legal wording\. Explain any legal term you cannot avoid in familiar words\. Include every material condition, exception, date and amount exactly\./,
      "Write clear, neutral high-school English from the supplied official text alone. Include material conditions, dates and amounts exactly.")
    .replace(" Also return a false check when legal wording is left in, when a sentence reads above a 9th-grade level, or when any claim is not supported by the cited official passages.", "");
  for (const edited of [false, true]) {
    const repos = createMemoryRepositories();
    await seedRolePlaybooks(repos, "2026-10-12T00:00:00.000Z");
    for (const role of ["MEASURE_WRITER", "MEASURE_CHECKER"] as const) {
      const id = fieldManualEntryId("role-playbook", role), held = (await repos.fieldManual.read(id))!;
      const text = edited && role === "MEASURE_CHECKER" ? "Edited in Admin." : shipped(role);
      assert.notEqual(text, seed(role));
      await repos.fieldManual.compareAndSet(id, held.revision, { ...held.value, payload: { ...(held.value.payload as object), text, history: [] } }, "2026-10-13T00:00:00.000Z");
    }
    await ensureRolePlaybooks(repos, "2026-10-14T00:00:00.000Z");
    const read = async (role: "MEASURE_WRITER" | "MEASURE_CHECKER") => rolePlaybook([(await repos.fieldManual.read(fieldManualEntryId("role-playbook", role)))!.value], role).text;
    assert.equal(await read("MEASURE_WRITER"), seed("MEASURE_WRITER"));
    assert.equal(await read("MEASURE_CHECKER"), edited ? "Edited in Admin." : seed("MEASURE_CHECKER"));
  }
});
