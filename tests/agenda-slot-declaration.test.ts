/**
 * **"NO SLOT" AND "NOBODY LOOKED" ARE DIFFERENT FACTS.**
 * (Session B closure, ASK-18, 2026-08-31.)
 *
 * Both produce no publisher observation and therefore render the same OURS gap
 * to a reader, which is precisely why they must be distinguishable in the
 * record. An adapter that can never observe and an adapter nobody has got to
 * yet look identical otherwise — and that is how the second silently becomes
 * the first.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  AGENDA_SLOT_BY_ADAPTER,
  AGENDA_SLOT_STATES,
  adaptersAwaitingInspection,
  agendaSlotFor,
  mayObservePerSitting,
} from "../lib/sources/agenda-slot.ts";
import { observationFromMeetingRecord } from "../lib/ask/agenda-publication.ts";

test("an undeclared adapter is UNKNOWN, never ABSENT", () => {
  const verdict = agendaSlotFor("some-adapter-nobody-declared");
  assert.equal(
    verdict.state,
    "UNKNOWN",
    "defaulting to ABSENT would turn every new adapter into a finished answer about a surface " +
      "nobody has opened",
  );
});

test("ical is ABSENT, and that is an ANSWER rather than outstanding work", () => {
  /*
   * An iCalendar VEVENT carries no agenda property. `lib/sources/ical/index.ts`
   * writes `agendaUrl: null` unconditionally because there is no field to read,
   * not because a body posted nothing — 187 of the 426 agenda-less rows in the
   * 2026-08-31 snapshot come from this one adapter.
   */
  assert.equal(agendaSlotFor("ical").state, "ABSENT");
  assert.match(agendaSlotFor("ical").basis, /no agenda property/i);
  assert.ok(
    !adaptersAwaitingInspection().includes("ical"),
    "an ABSENT adapter is not waiting on anybody",
  );
});

test("legistar is PRESENT, and its basis names the field that makes it observable", () => {
  const d = agendaSlotFor("legistar");
  assert.equal(d.state, "PRESENT");
  assert.match(d.basis, /EventAgendaFile/);
});

test("every declaration states a basis — a bare state is a guess about a vendor", () => {
  for (const [adapter, d] of Object.entries(AGENDA_SLOT_BY_ADAPTER)) {
    assert.ok(d.basis.trim().length > 0, `${adapter} declares a state with no basis`);
  }
});

test("SEEDED: a PRESENT declaration still does not license a THEIRS claim", () => {
  /*
   * The declaration is the PRECONDITION and never the evidence. Only the
   * adapter's own reading of THAT sitting, at the moment of the read, can say
   * the slot was empty — so a meeting from a PRESENT adapter that carries no
   * observation produces none.
   */
  assert.equal(agendaSlotFor("legistar").state, "PRESENT");
  const observation = observationFromMeetingRecord({
    id: "legistar:pima:9999",
    agendaUrl: null,
    /* The adapter did NOT record it. */
    provenance: {
      sourceUrl: "https://pima.legistar.com/MeetingDetail.aspx?ID=1",
      sourceOrg: "Pima County Clerk of the Board",
      collectedAt: "2026-08-31T09:00:00.000Z",
    },
  });
  assert.equal(
    observation,
    null,
    "the adapter's declaration says a slot EXISTS; only its reading can say one was empty",
  );
});

test("MEASURED: every adapter in the live snapshot has a declaration", () => {
  /*
   * A floor on the table itself. An adapter shipping rows with no declaration
   * is an adapter whose agenda-less meetings are unaccounted for, and the
   * default above would quietly call it UNKNOWN forever without anyone
   * noticing it had appeared.
   */
  const snapshot = JSON.parse(
    readFileSync(join(process.cwd(), "data", "meetings-snapshot.json"), "utf8"),
  ) as { meetings: { id: string; agendaUrl: string | null }[] };

  const adapters = new Set(
    snapshot.meetings.filter((m) => !m.agendaUrl).map((m) => String(m.id).split(":")[0]),
  );
  assert.ok(adapters.size > 0, "the snapshot holds agenda-less rows to account for");

  const undeclared = [...adapters].filter((a) => !(a in AGENDA_SLOT_BY_ADAPTER)).sort();
  assert.deepEqual(
    undeclared,
    [],
    `these adapters ship agenda-less meetings and declare nothing about their agenda slot: ${undeclared.join(", ")}`,
  );
});

/* ══════════════ ASK-18, 2026-08-31: THE ELEVEN UNKNOWNS, OPENED ══════════ */

/**
 * The row's blocker named the remaining work exactly: *open each UNKNOWN
 * adapter's surface*. Eleven were open on 2026-08-31 and none is now, and the
 * inspection changed the vocabulary as well as the rows — which is the finding
 * worth guarding, not the count.
 */

test("ASK-18: no adapter is left UNKNOWN, and the count is asserted rather than eyeballed", () => {
  const waiting = adaptersAwaitingInspection();
  assert.deepEqual(
    waiting,
    [],
    `these adapters are still undeclared: ${waiting.join(", ")}. UNKNOWN is work nobody has ` +
      "done, and it renders to a reader as the same OURS gap an ABSENT route does — which is " +
      "why the two must never be left indistinguishable.",
  );
});

test("ASK-18: every declaration's basis names what was READ, not what a vendor sells", () => {
  /*
   * The rule this file opened with: *a vendor's product having an agenda
   * feature somewhere is not evidence that the surface THIS adapter reads
   * exposes one.* So each basis must point at a file — a fixture, or the
   * adapter's own parse — rather than at a product.
   */
  for (const [adapter, decl] of Object.entries(AGENDA_SLOT_BY_ADAPTER)) {
    if (adapter === "mock") continue;
    assert.ok(
      /lib\/sources\/|tests\/fixtures\/|iCalendar VEVENT/.test(decl.basis),
      `${adapter}: the basis names no surface that was actually read — ${decl.basis.slice(0, 120)}`,
    );
  }
});

test("ASK-18: the two ABSENT routes say WHY a null is not the publisher's answer", () => {
  /*
   * `diligent` and `apptegy` are the two surfaces with no agenda field at all,
   * and each has a trap a future session would fall into: diligent's
   * `Published` boolean looks like an agenda flag and is about the meeting
   * record, and apptegy's link is scraped out of free-text prose. Both are
   * named in the basis so nobody re-reads them as observations.
   */
  for (const adapter of ["diligent", "apptegy"]) {
    const decl = AGENDA_SLOT_BY_ADAPTER[adapter];
    assert.equal(decl.state, "ABSENT", `${adapter} should be ABSENT`);
    assert.match(
      decl.basis,
      /no agenda field/i,
      `${adapter}: an ABSENT basis must say the field is not there`,
    );
  }
  assert.match(
    AGENDA_SLOT_BY_ADAPTER.diligent.basis,
    /never about an agenda/i,
    "the Published trap is named",
  );
  assert.match(
    AGENDA_SLOT_BY_ADAPTER.apptegy.basis,
    /SCRAPES free-text prose/,
    "the scraped-link trap is named",
  );
});

test("ASK-18: PRESENT_NOT_PER_SITTING exists, and is used where a slot is not per sitting", () => {
  /*
   * The vocabulary finding. Two surfaces have an agenda slot that is not
   * attached to a sitting, so an empty one is not observable FOR A SITTING —
   * and neither PRESENT nor ABSENT could say that without licensing a THEIRS
   * sentence or retiring a route that does publish agendas.
   */
  assert.ok(
    (AGENDA_SLOT_STATES as readonly string[]).includes("PRESENT_NOT_PER_SITTING"),
    "the fourth state is gone — the two surfaces it describes have nowhere honest to sit",
  );
  for (const adapter of ["clerksboards", "civicplus"]) {
    assert.equal(
      AGENDA_SLOT_BY_ADAPTER[adapter].state,
      "PRESENT_NOT_PER_SITTING",
      `${adapter} carries a slot that is not per-sitting`,
    );
  }
  assert.match(
    AGENDA_SLOT_BY_ADAPTER.civicplus.basis,
    /route portfolio/,
    "civicplus states the RULING 207 reason: two routes, and the weaker one governs the row",
  );
});

test("ASK-18: only a PRESENT adapter may ever reach a per-sitting observation", () => {
  /*
   * The whole point of the fourth state, held mechanically. A surface whose
   * slot is not per-sitting must be treated exactly like one that has none
   * when the question is *did the publisher leave THIS sitting's slot empty*.
   */
  const observable = Object.entries(AGENDA_SLOT_BY_ADAPTER)
    .filter(([, d]) => d.state === "PRESENT")
    .map(([a]) => a)
    .sort();
  assert.ok(observable.length > 0, "nothing is observable — the pipeline can never say THEIRS");
  for (const adapter of ["clerksboards", "civicplus", "diligent", "apptegy", "ical", "mock"]) {
    assert.ok(
      !observable.includes(adapter),
      `${adapter} must not be treated as per-sitting observable`,
    );
  }
});

test("ASK-18: the surface gate and the reading gate are separate walls", () => {
  /*
   * `observationFromMeetingRecord` refuses a reading the adapter did not make.
   * `mayObservePerSitting` refuses a SURFACE that cannot answer per sitting,
   * however carefully an adapter reads it. Both are needed: the first cannot
   * see that clerksboards' one current agenda is not this sitting's, and the
   * second cannot see that a particular row was carried forward.
   */
  assert.equal(mayObservePerSitting("civicclerk"), true);
  assert.equal(mayObservePerSitting("legistar"), true);
  assert.equal(mayObservePerSitting("clerksboards"), false, "a slot, and not per sitting");
  assert.equal(mayObservePerSitting("civicplus"), false, "two routes, one of them blind");
  assert.equal(mayObservePerSitting("ical"), false, "no slot at all");
  assert.equal(mayObservePerSitting("nobody-declared-this"), false, "nobody has looked");
});
