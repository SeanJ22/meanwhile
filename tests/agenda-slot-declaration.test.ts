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
  adaptersAwaitingInspection,
  agendaSlotFor,
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
