import assert from "node:assert/strict";
import { test } from "node:test";
import { CARD_WRITING_RULES, cardAmount, cardDate, cardName, cardPurpose, cardWritingInstructions, writeCardSentence, writeSourcedCardSentence } from "../lib/reader/card-writer.ts";

test("the common writer expresses money, ballot meanings and meeting actions with the same sentence plan", () => {
  assert.equal(writeCardSentence({ subject: "Pima County", action: "got", object: `a ${cardAmount(85912)} federal grant`,
    from: cardName("DEPARTMENT OF AGRICULTURE"), purpose: cardPurpose("RURAL SELF-HELP HOUSING"), on: cardDate("2003-08-14") }),
  "Pima County got a $85,912 federal grant from Department of Agriculture for rural self-help housing, on Aug 14, 2003.");
  assert.equal(writeCardSentence({ subject: "A yes vote", action: "would allow", object: "the county to borrow $5 million", purpose: "school repairs",
    clauses: ["only after a public hearing"] }), "A yes vote would allow the county to borrow $5 million for school repairs, only after a public hearing.");
  assert.equal(writeCardSentence({ subject: "The board", action: "will consider", object: "the proposed budget", on: cardDate("2026-11-03") }),
    "The board will consider the proposed budget, on Nov 3, 2026.");
});

test("shared model instructions retain MD-01's live playbook, source binding and task fields", () => {
  const prompt = cardWritingInstructions({ writerRules: "Live writer rules edited in Admin.", task: "Explain the effect of a yes and no vote.", fields: ["yesMeans", "noMeans"] });
  assert.ok(prompt.startsWith("Live writer rules edited in Admin."));
  for (const rule of CARD_WRITING_RULES) assert.ok(prompt.includes(rule));
  assert.match(prompt, /exact supporting source passage/);
  assert.match(prompt, /yesMeans, noMeans/);
  assert.match(prompt, /material conditions and qualifications/);
});

test("a sentence's sources retain every raw field for Sources without leaking them into its face", () => {
  const sources = [{ sourceUrl: "https://example.gov/award/42", fields: { UEI: "ABC123", awardType: "04", amount: -85912, district: "3", checkedAt: "2026-10-26" } }];
  const written = writeSourcedCardSentence({ subject: "Pima County", action: "had", object: `${cardAmount(-85912)} taken back from its federal grant`, sources });
  assert.equal(written.text, "Pima County had $85,912 taken back from its federal grant.");
  assert.equal(written.sources, sources);
  assert.doesNotMatch(written.text, /UEI|awardType|checkedAt|ABC123|\-\$/);
});

test("dates preserve the source day and do not invent missing days or accept rolled dates", () => {
  assert.equal(cardDate("2003-08-14T00:00:00Z"), "Aug 14, 2003");
  assert.equal(cardDate("2020-06-12", { monthOnly: true }), "June 2020");
  assert.equal(cardDate("2020-06"), "June 2020");
  assert.equal(cardDate("2020"), "2020");
  assert.equal(cardDate("2026-02-30"), null);
  assert.equal(cardDate("not published"), null);
  assert.equal(cardDate(null), null);
});

test("amounts preserve exact value without a bare negative sign or rounding to thousands", () => {
  assert.equal(cardAmount(85912), "$85,912");
  assert.equal(cardAmount(-85912.5), "$85,912.50");
  assert.equal(cardAmount(1.2345), "$1.2345");
  assert.equal(cardAmount(0), "$0");
  assert.equal(cardAmount(NaN), "");
});

test("readable names and titles change typography and explicit abbreviations only", () => {
  assert.equal(cardName("DEPARTMENT OF COMMERCE NORTH CAROLINA"), "Department of Commerce North Carolina");
  assert.equal(cardName("FEMA AND THE CITY OF PIMA"), "FEMA and the City of Pima");
  assert.equal(cardName("McAllen Housing Authority"), "McAllen Housing Authority");
  assert.equal(cardPurpose("RURAL SELF-HELP HOUSING TECHNICAL ASSIST"), "rural self-help housing technical assistance");
  assert.equal(cardPurpose("APPALACHIAN DEVELOP PROGRAM"), "appalachian development program");
  assert.equal(cardPurpose("Unknown filed purpose"), "Unknown filed purpose");
  assert.equal(cardPurpose("PHOTOMETRIC SURVEY OF THE KEPLER TARGET REGION IN RESPONSE TO AO #00-OSS-02, KEPLER DISCOVERY PROGRAM."), "photometric survey of the kepler target region");
  assert.equal(cardPurpose("BUILDING REPAIRS - NOTE: $$'S FOR BASIC THRU MOD#1"), "building repairs");
  assert.equal(cardPurpose("LEAD HAZARD REDUCT"), "lead hazard reduction");
  assert.equal(cardPurpose("MFR'D HOME ST AGEN"), "manufactured home state agency");
  assert.equal(cardPurpose("PERFORM FUNDING SYS"), "performance funding system");
  assert.doesNotMatch(cardPurpose("First phase. Second phase; final phase."), /[;.!?]/);
  assert.equal(cardPurpose("HUMAN SPACE EXP;ORATION"), "human space exploration");
});
