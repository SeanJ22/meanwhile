/**
 * OFF-7 — AN INTERIM HOLDS THE OFFICE. A DEPUTY HOLDS A DIFFERENT ONE.
 * (2026-08-25, the author's `17-51-51` and `17-53-26`. Second pass on OFF-4,
 * 2026-08-24.)
 *
 * **The reconciliation, because this is a second sighting and the brief asks
 * for the verdict before the fix.**
 *
 * OFF-4 shipped `topOfficesFor` and `rosterInReadingOrder` on 2026-08-24 and
 * **neither regressed** — Vail Unified still resolves John Carruth,
 * *Superintendent*, into the day-to-day slot and still leads its roster with
 * him, which is the card the author names as the reference pattern. The
 * verdict is **(b): the predicate is too narrow — or rather too WIDE, in the
 * one place it excludes.**
 *
 * `DEPUTY` read `/\b(vice|deputy|acting|assistant|interim)\b/i` and was used to
 * REFUSE. Kearsarge publishes **Michael Bessette, Interim Superintendent of
 * Schools**, so he was refused; the next executive pattern is
 * `administrator|manager`, which matched **Lawrence LeBoeuf, Business
 * Administrator**. A school district's card then said *runs it day to day ·
 * Business Administrator*, and the roster list led with him too.
 *
 * **The conflation is the defect.** A deputy or a vice chair holds a
 * DIFFERENT, JUNIOR office and is correctly refused. An interim or acting
 * holder holds THIS office, right now, and is exactly who a reader needs. The
 * feedback document says it in as many words: *the superintendent OR INTERIM
 * SUPERINTENDENT is always at the top.*
 *
 * **Why OFF-4's verification could not have caught it.** It was checked against
 * Tucson Unified and Vail, whose superintendents carry plain titles. No shipped
 * roster in that pass held a temporary holder of a top office, so the branch
 * that refuses one was never executed. This test drives the SHIPPED rosters
 * (RULING 147 — the anchor is data this session did not author) and asserts the
 * class rather than the instance.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { topOfficesFor, rosterInReadingOrder } from "../lib/officials/top-offices.ts";
import { BODY_ROSTERS } from "../lib/registry/body-rosters.ts";

const seat = (id: string, name: string, officeTitle: string) =>
  ({ id, name, officeTitle }) as never;

/* -------------------------------------------------------------------------- */
/* The reported instance, on the shipped roster                               */
/* -------------------------------------------------------------------------- */

function kearsargeBoard() {
  const body = BODY_ROSTERS.find((b) =>
    b.members?.some((m) => /Michael Bessette/i.test(m.name ?? "")),
  );
  return body;
}

test("OFF-7: the shipped Kearsarge roster still holds the interim superintendent", () => {
  const body = kearsargeBoard();
  assert.ok(body, "no shipped roster holds Michael Bessette — the reported case cannot be checked");
  const bessette = body.members!.find((m) => /Michael Bessette/i.test(m.name ?? ""))!;
  assert.match(
    bessette.officeTitle ?? "",
    /\binterim\b/i,
    "Bessette's title no longer says interim — the district's own word, carried verbatim, " +
      "and the precondition this whole case rests on",
  );
  assert.match(bessette.officeTitle ?? "", /\bsuperintendent\b/i);
});

test("OFF-7: the interim superintendent — not the business administrator — runs it day to day", () => {
  const body = kearsargeBoard()!;
  const top = topOfficesFor(body.members as never);
  const dayToDay = top.find((o) => o.role === "Runs it day to day");
  assert.ok(dayToDay, "Kearsarge resolves nobody into the day-to-day slot");
  assert.match(
    dayToDay.holder.name ?? "",
    /Bessette/,
    `the day-to-day slot holds "${dayToDay.holder.name}" (${dayToDay.holder.officeTitle}). ` +
      `A school district is run by its superintendent — interim or not — never by its ` +
      `business administrator.`,
  );
});

test("OFF-7: the interim superintendent leads the roster, ahead of the administrator", () => {
  const body = kearsargeBoard()!;
  const ordered = rosterInReadingOrder(body.members as never) as Array<{
    name: string;
    officeTitle: string | null;
  }>;
  assert.match(
    ordered[0]!.name,
    /Bessette/,
    `the roster still opens with "${ordered[0]!.name}" (${ordered[0]!.officeTitle}). ` +
      `OFF-4's rule is that the person who runs the district reads first.`,
  );
  const bessette = ordered.findIndex((h) => /Bessette/.test(h.name));
  const leBoeuf = ordered.findIndex((h) => /LeBoeuf/i.test(h.name));
  if (leBoeuf >= 0) {
    assert.ok(
      bessette < leBoeuf,
      "the business administrator still reads above the interim superintendent",
    );
  }
});

/* -------------------------------------------------------------------------- */
/* The class                                                                  */
/* -------------------------------------------------------------------------- */

test("OFF-7: an interim fills a slot the substantive holder has left empty", () => {
  const top = topOfficesFor([
    seat("a", "A Clerk", "District Clerk"),
    seat("b", "An Administrator", "Business Administrator"),
    seat("c", "An Interim", "Interim Superintendent of Schools"),
  ]);
  const dayToDay = top.find((o) => o.role === "Runs it day to day");
  assert.equal(dayToDay?.holder.name, "An Interim");
});

test("OFF-7: an ACTING mayor presides where there is no substantive one", () => {
  /* The same rule, on the other pattern table — the fix is about the WORD, not
     about school districts. */
  const top = topOfficesFor([
    seat("a", "A Councillor", "Council Member"),
    seat("b", "An Acting Mayor", "Acting Mayor"),
  ]);
  assert.equal(top[0]?.role, "Mayor");
  assert.equal(top[0]?.holder.name, "An Acting Mayor");
});

test("OFF-7: a SUBSTANTIVE holder still outranks a temporary one for the same office", () => {
  const top = topOfficesFor([
    seat("a", "The Interim", "Interim Superintendent"),
    seat("b", "The Superintendent", "Superintendent"),
  ]);
  assert.equal(
    top.find((o) => o.role === "Runs it day to day")?.holder.name,
    "The Superintendent",
    "a body publishing both should show the person actually holding the office",
  );
  const ordered = rosterInReadingOrder([
    { officeTitle: "Interim Superintendent", name: "The Interim" },
    { officeTitle: "Superintendent", name: "The Superintendent" },
  ]) as Array<{ officeTitle: string | null; name: string }>;
  assert.equal(ordered[0]!.name, "The Superintendent");
});

test("OFF-7: a deputy, a vice chair and an assistant are STILL refused", () => {
  /*
   * The half most easily lost. Pima publishes its vice chair ABOVE its chair,
   * and a naive widening would have put the vice chair on every card.
   */
  const presiding = topOfficesFor([
    seat("a", "The Vice Chair", "County Supervisor, District 2 (Vice Chair)"),
    seat("b", "The Chair", "County Supervisor, District 3 (Chair)"),
  ]);
  assert.equal(presiding[0]?.holder.name, "The Chair");

  const exec = topOfficesFor([
    seat("a", "A Deputy", "Deputy Superintendent"),
    seat("b", "An Assistant", "Assistant Superintendent"),
  ]);
  assert.equal(
    exec.find((o) => o.role === "Runs it day to day"),
    undefined,
    "a deputy or assistant superintendent must never fill the day-to-day slot",
  );
});

test("OFF-7: a junior word still binds through a temporary qualifier", () => {
  /* "Acting Deputy Superintendent" is still a deputy. The temporary word does
     not launder the junior one. */
  const top = topOfficesFor([seat("a", "An Acting Deputy", "Acting Deputy Superintendent")]);
  assert.equal(
    top.find((o) => o.role === "Runs it day to day"),
    undefined,
  );
});

test("OFF-7: a superintendent outranks an administrator in the roster order", () => {
  /*
   * The second defect, which the eligibility fix alone would NOT have closed:
   * the executive partition was flat, so once both were eligible the roster's
   * own published order still put the administrator first.
   */
  const ordered = rosterInReadingOrder([
    { officeTitle: "Business Administrator", name: "Administrator" },
    { officeTitle: "School Board Chair", name: "Chair" },
    { officeTitle: "Interim Superintendent of Schools", name: "Interim Supt" },
  ]) as Array<{ officeTitle: string | null; name: string }>;
  assert.deepEqual(
    ordered.map((h) => h.name),
    ["Interim Supt", "Administrator", "Chair"],
    "the superintendent leads, the administrator follows, and everyone else keeps " +
      "the body's own published order",
  );
});

test("OFF-7: Vail — OFF-4's reference card — is unchanged", () => {
  const vail = BODY_ROSTERS.find((b) =>
    b.members?.some((m) => /John Carruth/i.test(m.name ?? "")),
  );
  if (!vail) return; /* not a shipped roster; the class tests above still hold */
  const top = topOfficesFor(vail.members as never);
  assert.match(
    top.find((o) => o.role === "Runs it day to day")?.holder.name ?? "",
    /Carruth/,
    "Vail's superintendent must still fill the day-to-day slot — it is the card the " +
      "author names as the reference pattern and OFF-7 must not have cost it",
  );
});

test("OFF-7: no shipped roster puts a non-superintendent above a superintendent", () => {
  /*
   * The class denominator, swept rather than sampled. Any body holding someone
   * whose title says superintendent must lead its roster with a superintendent.
   */
  const offenders: string[] = [];
  for (const body of BODY_ROSTERS) {
    const members = (body.members ?? []) as Array<{ name: string; officeTitle: string | null }>;
    const hasSupt = members.some(
      (m) => /\bsuperintendent\b/i.test(m.officeTitle ?? "") && !/\b(deputy|assistant|vice)\b/i.test(m.officeTitle ?? ""),
    );
    if (!hasSupt) continue;
    const first = rosterInReadingOrder(members as never)[0] as { name: string; officeTitle: string | null };
    if (!/\bsuperintendent\b/i.test(first.officeTitle ?? "")) {
      offenders.push(`${body.bodyName}: leads with ${first.name} (${first.officeTitle})`);
    }
  }
  assert.deepEqual(offenders, [], "a district holding a superintendent does not lead with one");
});

/* ========================================================================== */
/* RULING 157 — the class, verified against cases the fix was NOT derived from */
/* ========================================================================== */

test("OFF-7: the CLASS — every body in the registry, with its denominator", async () => {
  /*
   * **RULING 136: the id names an instance, the defect is the class.**
   * **RULING 157: a fix verified only against the case it was derived from has
   * not closed anything** — the predicate was shaped by that case, so it is
   * guaranteed to pass there.
   *
   * Kearsarge is the DERIVED case. The independent cases are **Tucson Unified**
   * and **Vail Unified**, and they are named here rather than described,
   * because "audited across the class" is a claim with no case in it.
   *
   * Reported as a three-way split (RULING 105): a bare "0 wrong" says nothing
   * about how many bodies were even eligible to be wrong.
   */
  const { auditTopOffices } = await import("../scripts/top-office-audit.mts");
  const rows = auditTopOffices();

  // The floor (RULING 159). A registry that failed to load reports zero wrong
  // slots and reads as a clean bill of health.
  assert.ok(rows.length >= 20, `the audit read only ${rows.length} roster(s) — it did not reach the registry`);

  const wrong = rows.filter((r) => r.verdict === "WRONG");
  assert.deepEqual(
    wrong.map((r) => `${r.bodyName}: ${r.reason}`),
    [],
    "a body has the wrong person in the runs-it-day-to-day slot",
  );

  const inScope = rows.filter((r) => r.verdict !== "OUT_OF_SCOPE");
  assert.ok(
    inScope.length >= 3,
    `only ${inScope.length} body publishes an executive title — the class check is about nothing`,
  );

  // THE INDEPENDENT CASES, by name.
  for (const name of ["Tucson Unified School District Governing Board", "Vail Unified School District Governing Board"]) {
    const row = rows.find((r) => r.bodyName === name);
    assert.ok(row, `${name} is not in the registry — the independent case for OFF-7 is gone`);
    assert.equal(row.verdict, "CORRECT", `${name} — an independent case regressed`);
  }
});
