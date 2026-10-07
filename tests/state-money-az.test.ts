import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ROOT } from "./read-code.ts";
import { officeClassOf } from "../lib/funding/state-money.ts";
import {
  CYCLE_2026,
  aggregateEntities,
  azNamesAgree,
  azOfficeKey,
  detailQuery,
  nameVariants,
  nextFilingDue,
  parseCommitteeRegister,
  parseEntityName,
  parseReportingPeriods,
  parseTableResponse,
  reconcileEntity,
  registerHoldsCandidateCommittee,
  summaryQuery,
  universeQueries,
  type SummaryRow,
} from "../lib/sources/az-seethemoney/index.ts";

/** Observed portal responses, trimmed to the entities each claim turns on. No live calls. */
const FIX = join(ROOT, "tests", "fixtures", "campaign-finance");

function summaryFixture(): { data: SummaryRow[] } {
  return JSON.parse(readFileSync(join(FIX, "azsos-seethemoney-summary-2026.json"), "utf8")) as { data: SummaryRow[] };
}

test("a 200 that is not a DataTables result is refused, never read as empty", () => {
  assert.throws(
    () => parseTableResponse('""', "GetNEWTableData"),
    /not a DataTables result/,
    "the two-byte empty-string reply must throw, not read as zero rows",
  );
  assert.throws(() => parseTableResponse("<html>gateway timeout</html>", "GetNEWTableData"), /not JSON/);
  const ok = parseTableResponse<SummaryRow>(JSON.stringify({ data: [], draw: 1, recordsTotal: 0, recordsFiltered: 0 }), "x");
  assert.equal(ok.recordsTotal, 0, "a genuine DataTables zero is a different thing and is allowed through");
});

test("the detail query refuses to be built without entityId", () => {
  assert.throws(
    () => detailQuery({ entityId: 0, kind: "income", startYear: 2025, endYear: 2026 }),
    /positive entityId/,
  );
  const q = detailQuery({ entityId: 102162, kind: "income", startYear: 2025, endYear: 2026 });
  assert.match(q, /entityId=102162/, "entityId is the load-bearing parameter and must be in the query string");
  assert.match(q, /Name=1%7E102162/, "the page's own Name form is sent as well, because the app sends both");
});

test("the universe is the union of all three of the portal's filter settings", () => {
  const qs = universeQueries(2025, 2026);
  assert.equal(qs.length, 3);
  assert.ok(qs.some((q) => q.isLessActive === false && q.showOfficeHolder === false));
  assert.ok(qs.some((q) => q.isLessActive === true && q.showOfficeHolder === false));
  assert.ok(qs.some((q) => q.showOfficeHolder === true));
  assert.match(summaryQuery(qs[1]), /IsLessActive=true/);
});

test("both vocabularies key to the same Arizona seat, and unlike seats never collide", () => {
  const pairs: [string, string][] = [
    ["State Senator, District 19", "State Senator - District No. 19"],
    ["State Representative, District 17", "State Representative - District 17"],
    ["Governor", "Governor"],
    ["Corporation Commissioner", "Corporation Commissioner"],
    ["Superintendent of Public Instruction", "Superintendent of Public Instruction"],
  ];
  for (const [ballot, filed] of pairs) {
    const a = azOfficeKey(ballot);
    assert.ok(a, `${ballot} must key to an Arizona seat`);
    assert.equal(a, azOfficeKey(filed), `${ballot} and ${filed} are one seat`);
  }
  assert.notEqual(azOfficeKey("State Senator, District 19"), azOfficeKey("State Representative, District 19"));
  assert.notEqual(azOfficeKey("State Senator - District No. 19"), azOfficeKey("State Senator - District No. 20"));
  assert.notEqual(azOfficeKey("Governor"), azOfficeKey("Secretary of State"));
  assert.equal(azOfficeKey(""), null, "an office the agency states as empty keys to nothing");
  assert.equal(azOfficeKey("U.S. Representative, District 6"), null, "a federal seat is not the Secretary of State's");
});

test("the Arizona statewide offices added to the shared classifier cannot swallow a county office", () => {
  for (const office of ["Secretary of State", "Attorney General", "State Treasurer", "Corporation Commissioner"]) {
    assert.equal(officeClassOf(office), "STATE", `${office} is an Arizona statewide seat`);
  }
  assert.equal(officeClassOf("County Treasurer"), "COUNTY");
  assert.equal(officeClassOf("County Attorney"), "COUNTY");
  assert.equal(officeClassOf("Board of County Commissioners"), "COUNTY");
  assert.equal(officeClassOf("Member of the Board of Education"), "SCHOOL");
});

test("a quoted segment in a name is an alternate name, on either end", () => {
  assert.ok(nameVariants('Nicholas "Nick" Myers').includes("Nick Myers"));
  assert.ok(nameVariants('Rachel "Jones" Keshel').includes("Rachel Jones"));
  assert.ok(nameVariants('Hollace "Holly" Lyon').includes("Hollace Lyon"));
  assert.deepEqual(nameVariants("Katie Hobbs"), ["Katie Hobbs"], "a plain name expands to itself and nothing else");
});

test("the five real ballot names whose quoting used to manufacture an absence now match", () => {
  const pairs: [string, string][] = [
    ['Nicholas "Nick" Myers', "Nick Myers"],
    ['Rachel "Jones" Keshel', "Rachel Jones"],
    ['Hollace "Holly" Lyon', "Hollace Drage Lyon"],
    ['Walter "Les" Presmyk', 'Walter "Les" Presmyk'],
    ["Ryan Slawson", 'Fred "Ryan" Slawson'],
  ];
  for (const [ballot, filed] of pairs) {
    assert.ok(azNamesAgree(filed, ballot), `${filed} and ${ballot} are one person as both publishers write them`);
  }
});

test("a diminutive is NOT a quoted alternate, and is not guessed at", () => {
  assert.equal(azNamesAgree("Thomas Chalres Horne", "Tom Horne"), false);
  assert.equal(azNamesAgree("Smith, John", "Jane Smith"), false, "a shared surname is not a person");
});

test("the entity name is parsed off the portal's own markup", () => {
  const p = parseEntityName("Accalia, Jayme <br>(102162)");
  assert.equal(p.family, "Accalia");
  assert.equal(p.given, "Jayme");
  assert.equal(p.display, "Jayme Accalia");
});

test("the several rows of one entity fold into one committee", () => {
  const rows = summaryFixture().data;
  const entities = aggregateEntities(rows);
  const accalia = entities.get(102162);
  assert.ok(accalia, "the fixture carries the three-row entity");
  assert.ok(accalia.rowCount >= 3, "a candidate returns several rows partitioned by office and party");
  assert.equal(accalia.committeeName, "Committee to Elect Jayme Accalia for State Senate LD15");
  assert.ok(
    accalia.officeKeys.includes("az:state-senate:15"),
    "an entity agrees on a seat if ANY of its rows names it — the office-empty row is a partition of the same committee",
  );
  // Float accumulation: 686.91 + 205 + 1123.97 is 2015.8799999999999 in IEEE
  // doubles, and a reconciliation comparing that to 2015.88 reports a
  // disagreement that is ours rather than theirs.
  assert.equal(accalia.income, Math.round(accalia.income * 100) / 100, "accumulated totals are rounded to cents");
});

test("CashBalance is an entity attribute, not a partition, and is never published as this cycle", () => {
  const entities = aggregateEntities(summaryFixture().data);
  for (const e of entities.values()) {
    if (e.rowCount > 1) assert.equal(typeof e.cashBalance, "number");
  }
});

test("a committee whose totals do not reproduce its own itemised ledger cannot render", () => {
  const e = aggregateEntities(summaryFixture().data).get(102162)!;
  const agrees = reconcileEntity(e, {
    income: { count: 229, sum: e.income },
    expense: { count: 5, sum: e.expense },
  });
  assert.equal(agrees.agrees, true);
  const off = reconcileEntity(e, {
    income: { count: 229, sum: e.income + 1 },
    expense: { count: 5, sum: e.expense },
  });
  assert.equal(off.agrees, false);
  assert.match(off.note, /do NOT reproduce/);
  const unread = reconcileEntity(e, undefined);
  assert.equal(unread.agrees, false, "a ledger we never read is unverified, never verified-empty");
});

test("an absence needs the portal AND the register to agree", () => {
  const register = parseCommitteeRegister(
    readFileSync(join(FIX, "azsos-cfsdata2-Committees-statewide-excerpt.tsv"), "utf8"),
  );
  assert.ok(register.size > 0, "a zero-row register parse is a failed retrieval, not an empty register");
  const horne = registerHoldsCandidateCommittee(register, "Horne", CYCLE_2026.opensOn);
  assert.ok(horne.length > 0, "the register holds a live Horne candidate committee, so no absence may be written");
  const miceli = registerHoldsCandidateCommittee(register, "Miceli", CYCLE_2026.opensOn);
  assert.equal(miceli.length, 0, "Miceli is the genuine absence: neither representation holds a committee");
});

test("the filing calendar supplies a real next-due date, never an invented one", () => {
  const periods = parseReportingPeriods(readFileSync(join(FIX, "azsos-cfsdata2-ReportingPeriods.txt"), "utf8"));
  assert.ok(periods.length > 100);
  const due = nextFilingDue(periods, "2026-08-31");
  assert.ok(due, "the state publishes a deadline after this date");
  assert.ok(due.filingPeriodEndDate > "2026-08-31");
  assert.equal(due.cycle, 2026);
  assert.equal(nextFilingDue(periods, "2099-01-01"), null, "no deadline after the calendar ends is null, never a guess");
});
