import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { ROOT } from "./read-code.ts";
import { isRenderable, officeClassOf, type StateMoneySnapshot } from "../lib/funding/state-money.ts";
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

/**
 * **ARIZONA STATE CAMPAIGN MONEY.** (Session C2, 2026-08-31.)
 *
 * No live calls. Every fixture under `tests/fixtures/campaign-finance/` is a
 * response actually observed on 2026-08-31, trimmed to the entities each claim
 * turns on and otherwise byte-for-byte.
 *
 * The claims here are about SHAPE and SAFETY, never about amounts. An amount is
 * Arizona's to publish and ours to reproduce; pinning one would fail honestly
 * every time the state updated it, which teaches a session to ignore the suite.
 */

const FIX = join(ROOT, "tests", "fixtures", "campaign-finance");
const SNAPSHOT = join(ROOT, "data", "funding", "state-money-az-2026.json");
const RECONCILIATION = join(ROOT, "data", "campaign-finance", "az-seethemoney-2026-reconciliation.json");

function summaryFixture(): { data: SummaryRow[] } {
  return JSON.parse(readFileSync(join(FIX, "azsos-seethemoney-summary-2026.json"), "utf8")) as { data: SummaryRow[] };
}

/* ---------------------------------------------------------------- the route */

test("a 200 that is not a DataTables result is refused, never read as empty", () => {
  // This is the literal payload the endpoint returns for a malformed request.
  // It is valid JSON, so a bare JSON.parse succeeds and `.data ?? []` yields
  // an empty array with no error — a failed extraction wearing an absence's
  // clothes (RULING 100).
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
  /*
   * The whole Arizona blockage was this parameter. Without it the endpoint
   * answers HTTP 200 with recordsTotal 0 — which is what an earlier session
   * saw, and it is indistinguishable from a committee with no transactions.
   */
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
  /*
   * MEASURED 2026-08-31: the default view returns 255 entities, IsLessActive
   * returns 716, and ShowOfficeHolder returns a disjoint 16. Walking only the
   * default and writing "no reports on file" for everyone missing would be an
   * absence manufactured by our own query.
   */
  assert.ok(qs.some((q) => q.isLessActive === false && q.showOfficeHolder === false));
  assert.ok(qs.some((q) => q.isLessActive === true && q.showOfficeHolder === false));
  assert.ok(qs.some((q) => q.showOfficeHolder === true));
  assert.match(summaryQuery(qs[1]), /IsLessActive=true/);
});

/* ------------------------------------------------------------ the seat key */

test("both vocabularies key to the same Arizona seat, and unlike seats never collide", () => {
  // The ballot on the left, the filing on the right. They share barely a word.
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
  /*
   * The dangerous direction is a WRONG class, not a null: `officesAgree`
   * defends against one side being unrecognised and cannot defend against two
   * sides wrong in the same way. A bare \btreasurer\b would have made County
   * Treasurer a statewide seat.
   */
  for (const office of ["Secretary of State", "Attorney General", "State Treasurer", "Corporation Commissioner"]) {
    assert.equal(officeClassOf(office), "STATE", `${office} is an Arizona statewide seat`);
  }
  assert.equal(officeClassOf("County Treasurer"), "COUNTY");
  assert.equal(officeClassOf("County Attorney"), "COUNTY");
  assert.equal(officeClassOf("Board of County Commissioners"), "COUNTY");
  assert.equal(officeClassOf("Member of the Board of Education"), "SCHOOL");
});

/* ----------------------------------------------------------------- names */

test("a quoted segment in a name is an alternate name, on either end", () => {
  // Both readings appear on this one ballot and the publisher marks them the
  // same way, so both are generated.
  assert.ok(nameVariants('Nicholas "Nick" Myers').includes("Nick Myers"));
  assert.ok(nameVariants('Rachel "Jones" Keshel').includes("Rachel Jones"));
  assert.ok(nameVariants('Hollace "Holly" Lyon').includes("Hollace Lyon"));
  assert.deepEqual(nameVariants("Katie Hobbs"), ["Katie Hobbs"], "a plain name expands to itself and nothing else");
});

test("the five real ballot names whose quoting used to manufacture an absence now match", () => {
  /*
   * Every pair is the certified ballot on the left and the Secretary of
   * State's own filed name on the right, both verbatim. Before `nameVariants`
   * each of these produced NO_REPORTS_ON_FILE against a live committee —
   * Rachel Keshel's had filed $47,878.92.
   */
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
  /*
   * THE CONTROL. `Tom Horne` against the filed `Horne, Thomas Chalres` (the
   * misspelling is the state's own). Nothing marks these as the same name and
   * nothing here invents that. He resolves to an OURS GAP, which is honest,
   * rather than to a match, which would be a guess under a photograph.
   */
  assert.equal(azNamesAgree("Thomas Chalres Horne", "Tom Horne"), false);
  assert.equal(azNamesAgree("Smith, John", "Jane Smith"), false, "a shared surname is not a person");
});

test("the entity name is parsed off the portal's own markup", () => {
  const p = parseEntityName("Accalia, Jayme <br>(102162)");
  assert.equal(p.family, "Accalia");
  assert.equal(p.given, "Jayme");
  assert.equal(p.display, "Jayme Accalia");
});

/* ------------------------------------------------------------ aggregation */

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
  /*
   * Session C measured `sum(Income) - sum(Expense) == CashBalance` over 255
   * entities: it held for 134 and broke for 121, INCLUDING for single-row
   * entities where there is nothing to sum. The balance carries something from
   * before the cycle window, so it is not this cycle's cash on hand and the
   * snapshot leaves it null rather than publishing a number of unknown meaning.
   */
  if (existsSync(SNAPSHOT)) {
    const s = JSON.parse(readFileSync(SNAPSHOT, "utf8")) as StateMoneySnapshot;
    for (const r of s.records) {
      assert.equal(r.totals.cashOnHand, null, "AZ cash on hand is not established and may not be published");
    }
  }
});

/* --------------------------------------------------------- reconciliation */

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

/* --------------------------------------------------------------- absence */

test("an absence needs the portal AND the register to agree", () => {
  const register = parseCommitteeRegister(
    readFileSync(join(FIX, "azsos-cfsdata2-Committees-statewide-excerpt.tsv"), "utf8"),
  );
  assert.ok(register.size > 0, "a zero-row register parse is a failed retrieval, not an empty register");
  /*
   * Tom Horne is the case this rule exists for. The portal returned a
   * committee our matcher could not confirm, and the register holds
   * `Thomas Horne for Superintendent of Public Instruction`, live and
   * unterminated. Writing "no reports on file" on his card would be asserting
   * an absence out of our own empty result.
   */
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

/* -------------------------------------------------------------- the snapshot */

test("the AZ snapshot exists and is the shape the loader names", () => {
  assert.ok(
    existsSync(SNAPSHOT),
    "lib/funding/state-snapshot.ts names state-money-az-2026.json; without the file the ballot silently loses AZ money",
  );
  const s = JSON.parse(readFileSync(SNAPSHOT, "utf8")) as StateMoneySnapshot;
  assert.equal(s.formatVersion, 1);
  assert.equal(s.cycle, 2026);
  assert.ok(s.records.length > 0, "a snapshot with no records is a failed run, not an empty state");
  for (const r of s.records) {
    assert.equal(r.jurisdiction, "AZ", "an AZ snapshot may not carry another state's records");
    assert.ok(r.checkedAt, "every record including an absence carries the date the agency was asked");
    assert.ok(r.provenance.sourceUrl, "every record names the endpoint it was read from");
    if (r.filingState === "FILED") {
      assert.ok(r.committeeId, "a filed record joins on the agency's id, never on a name string");
      assert.notEqual(r.totals.receipts, null, "a FILED record states what was raised");
    }
    if (r.filingState === "NO_REPORTS_ON_FILE") {
      assert.equal(r.totals.receipts, null, "an absence is never $0 — that would be a claim about the campaign");
    }
    assert.ok(isRenderable(r) || r.filingState === "LEAD");
  }
});

test("every published figure is backed by a reconciliation row that agreed", () => {
  /*
   * THE BAR, ENFORCED RATHER THAN DESCRIBED. A FILED record puts a dollar
   * figure under a named person's photograph. This asserts that the committee
   * behind each one was measured against the publisher's own itemised ledger
   * and agreed — so a future run that silently stopped reconciling would fail
   * here rather than ship.
   */
  if (!existsSync(SNAPSHOT)) return;
  assert.ok(existsSync(RECONCILIATION), "a snapshot without its reconciliation artifact is an unlicensed figure");
  const s = JSON.parse(readFileSync(SNAPSHOT, "utf8")) as StateMoneySnapshot;
  const recon = JSON.parse(readFileSync(RECONCILIATION, "utf8")) as {
    reconciliation: { rows: { entityId: number; agrees: boolean }[] };
  };
  const agreed = new Set(recon.reconciliation.rows.filter((r) => r.agrees).map((r) => String(r.entityId)));
  for (const r of s.records) {
    /*
     * BOTH committee-bearing states, not just FILED. A
     * REGISTERED_NO_ACTIVITY_REPORTED record asserts that the agency's own
     * ledger holds NOTHING for a named committee, which is exactly as strong a
     * claim as a dollar figure and rests on exactly the same measurement.
     */
    if (r.filingState !== "FILED" && r.filingState !== "REGISTERED_NO_ACTIVITY_REPORTED") continue;
    assert.ok(
      agreed.has(String(r.committeeId)),
      `committee ${r.committeeId} (${r.registeredName}) renders a claim that no reconciliation row licenses`,
    );
  }
});

test("a registered committee reporting nothing renders as that, never as $0", () => {
  /*
   * The shape that rendered "No reports on file" for six named New Hampshire
   * candidates whose committees the state had named. Arizona hits it too:
   * Duwayne Collier's Secretary of State committee is registered, reconciles
   * against an itemised ledger of zero transactions, and has reported no money.
   * `$0` would be a claim about his campaign; this is a claim about his filing.
   */
  if (!existsSync(SNAPSHOT)) return;
  const s = JSON.parse(readFileSync(SNAPSHOT, "utf8")) as StateMoneySnapshot;
  for (const r of s.records) {
    if (r.filingState === "FILED") {
      assert.ok(
        (r.totals.receipts ?? 0) > 0 || (r.totals.expenditures ?? 0) > 0,
        `${r.registeredName} is FILED with nothing reported — that renders $0 under a named person`,
      );
    }
    if (r.filingState === "REGISTERED_NO_ACTIVITY_REPORTED") {
      assert.equal(r.totals.receipts, null, "a zero-activity committee publishes null, never 0");
      assert.equal(r.totals.expenditures, null);
      assert.ok(r.committeeId, "the agency NAMED this committee — that is what makes it not an absence");
    }
  }
});

test("the reconciliation artifact carries no itemised transaction", () => {
  /*
   * Itemised rows carry contributor name, occupation, employer, city and zip
   * (RULING 167). They are read to compute a sum and must never be persisted.
   */
  if (!existsSync(RECONCILIATION)) return;
  const raw = readFileSync(RECONCILIATION, "utf8");
  for (const field of [
    "TransactionOccupation",
    "TransactionEmployer",
    "TransactionFirstName",
    "TransactionLastName",
    "ReceivedFromOrPaidTo",
    "TransactionZipCode",
  ]) {
    assert.ok(!raw.includes(field), `${field} is contributor personal data and may not appear in a committed artifact`);
  }
});

test("an OURS GAP renders, carries no money at all, and names a real next filing deadline", () => {
  /*
   * RULING 224: the honest gap state is a COMPLETION, not a lesser outcome —
   * but only when it actually reaches the reader and says whose gap it is.
   * These four assertions are the whole safety of that state:
   *
   *   it renders                  -> or the card falls back to the generic
   *                                  "we don't hold a filing" line, which is
   *                                  indistinguishable from never having looked
   *   it carries NO figure        -> or it becomes the unproven attribution
   *                                  the matching bar exists to refuse
   *   it attributes NO committee  -> same reason
   *   it names a real next_due    -> or the promise is one we invented
   */
  if (!existsSync(SNAPSHOT)) return;
  const s = JSON.parse(readFileSync(SNAPSHOT, "utf8")) as StateMoneySnapshot;
  const gaps = s.records.filter((r) => r.filingState === "OURS_GAP");
  assert.ok(gaps.length > 0, "this ballot has candidates we investigated and could not settle; they must be visible");
  for (const g of gaps) {
    assert.ok(isRenderable(g), "an OURS GAP that does not render is the generic placeholder it replaced");
    assert.equal(g.totals.receipts, null);
    assert.equal(g.totals.expenditures, null);
    assert.equal(g.totals.cashOnHand, null);
    assert.equal(g.committeeId, null, "a gap attributes no committee — that is what the bar refused to do");
    assert.equal(g.registeredName, "");
    assert.ok(g.ourGap, "an OURS GAP without its gap block cannot say whose gap it is");
    assert.ok(g.ourGap.whatIsMissing.length > 20, "the sentence must say what WE could not settle");
    assert.ok(
      g.ourGap.nextDue === null || /^\d{4}-\d{2}-\d{2}$/.test(g.ourGap.nextDue),
      "next_due is a real date from the state's own calendar, or null — never a plausible guess",
    );
    if (g.ourGap.nextDue) {
      assert.ok(g.ourGap.nextDue > g.checkedAt, "a deadline already past is not a next deadline");
    }
  }
});

test("every candidacy the Secretary of State is the filing officer for ends in exactly one state", () => {
  /*
   * STATED N EQUALS RENDERED ROWS, and no candidacy may be in two states or
   * none. The denominator is the 49 non-federal candidacies on the pilot
   * ballot; the six federal ones file with the FEC and this product already
   * reads them.
   */
  if (!existsSync(RECONCILIATION)) return;
  const recon = JSON.parse(readFileSync(RECONCILIATION, "utf8")) as {
    readerStates: {
      inScope: number;
      tally: Record<string, number>;
      perCandidacy: { candidacyId: string; state: string }[];
    };
  };
  const inScope = recon.readerStates.perCandidacy.filter((p) => p.state !== "FEDERAL_NOT_IN_SCOPE");
  assert.equal(inScope.length, recon.readerStates.inScope, "stated in-scope N must equal the enumerated rows");
  assert.equal(
    new Set(inScope.map((p) => p.candidacyId)).size,
    inScope.length,
    "a candidacy in two reader states is a contradiction on one card",
  );
  const sum =
    (recon.readerStates.tally.SOURCED_FILED ?? 0) +
    (recon.readerStates.tally.SOURCED_ABSENCE ?? 0) +
    (recon.readerStates.tally.OURS_GAP ?? 0);
  assert.equal(sum, recon.readerStates.inScope, "the three states must partition the in-scope set exactly");
});

test("the stated split equals the rendered rows", () => {
  if (!existsSync(SNAPSHOT)) return;
  const s = JSON.parse(readFileSync(SNAPSHOT, "utf8")) as StateMoneySnapshot;
  const filed = new Set<string>();
  const absent = new Set<string>();
  for (const r of s.records) {
    if (r.filingState === "FILED") for (const k of r.targetKeys) filed.add(k);
    else if (r.filingState === "NO_REPORTS_ON_FILE") for (const k of r.targetKeys) absent.add(k);
  }
  for (const k of filed) absent.delete(k);
  assert.equal(s.split.filed, filed.size, "stated N must equal rendered rows");
  assert.equal(s.split.noReportsOnFile, absent.size);
  assert.equal(s.split.filedRecords, s.records.filter((r) => r.filingState === "FILED").length);
  assert.ok(
    s.split.filed <= s.split.candidaciesInScope,
    "a coverage figure that reads over 100% is how a reader learns the number is not to be trusted",
  );
});
