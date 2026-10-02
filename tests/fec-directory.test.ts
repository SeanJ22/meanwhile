import assert from "node:assert/strict";
import test from "node:test";
import { parseFecDirectory } from "../lib/hunt/fec-directory.ts";

test("capitalized phone continuations keep the office URL and later report labels together", () => {
  for (const label of ["TDD", "TTY", "FAX", "TOLL FREE"]) {
    const result = parseFecDirectory([{ page: 34, text: `COLORADO SECRETARY OF STATE *
      URL https://test-office.gov * 303/111-2222 * ${label} 303/333-4444 *
      -State Campaign Finance Reports * INDEPENDENT ETHICS COMMISSION *
      URL https://test-ethics.gov * -Personal Financial Reports *` }], "TEST FICTIONAL DIRECTORY");
    assert.equal(result.outcome, "EXTRACTED");
    assert.equal(result.items.length, 2);
    assert.deepEqual(result.items[0], { state: "COLORADO", office: "SECRETARY OF STATE",
      url: "https://test-office.gov", phone: "303/111-2222", email: "", page: 34,
      recordsHeld: "State Campaign Finance Reports" });
    assert.equal(result.items[1].office, "INDEPENDENT ETHICS COMMISSION");
    assert.equal(result.items[1].url, "https://test-ethics.gov");
  }
});

test("contact-only cells never become offices, and another jurisdiction keeps its own office", () => {
  const result = parseFecDirectory([
    { page: 20, text: "ARIZONA TDD 602/111-2222 * SECRETARY OF STATE * URL https://test-az.gov * -State Campaign Finance Reports *" },
    { page: 28, text: "COLORADO SECRETARY OF STATE * URL https://test-co.gov * TTY 303/111-2222 * -State Campaign Finance Reports *" },
  ], "TEST FICTIONAL DIRECTORY");
  assert.deepEqual(result.items.map(row => [row.state, row.office, row.url]), [
    ["ARIZONA", "SECRETARY OF STATE", "https://test-az.gov"],
    ["COLORADO", "SECRETARY OF STATE", "https://test-co.gov"],
  ]);
});
