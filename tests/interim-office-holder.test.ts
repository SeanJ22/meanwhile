/**
 * An interim or acting holder holds this office and is who a reader needs; a deputy or vice chair holds a
 * different, junior office and is refused. Driven over the shipped rosters, asserting the class.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { topOfficesFor, rosterInReadingOrder } from "../lib/officials/top-offices.ts";
import { BODY_ROSTERS } from "./fixtures/held-body-rosters.ts";

const seat = (id: string, name: string, officeTitle: string) =>
  ({ id, name, officeTitle }) as never;

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
  /* A naive widening would put a vice chair published above the chair on every card. */
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
  /* Once both are eligible, the executive partition must still put the superintendent first. */
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

test("OFF-7: the CLASS — every body in the registry, with its denominator", async () => {
  /* Verified against cases the fix was not derived from, reported as a three-way split. */
  const { auditTopOffices } = await import("../scripts/top-office-audit.mts");
  const rows = auditTopOffices(BODY_ROSTERS);

  // A floor: a registry that failed to load would report zero wrong slots.
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
