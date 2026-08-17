import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  CALENDAR_LABELS,
  calendarLabel,
  internalSourceIds,
} from "../lib/meetings/source-labels.ts";

const ROOT = join(import.meta.dirname, "..");

/**
 * `schedulepage` must never reach a reader — 2026-08-17.
 *
 * The ids are correct in the wiring, the snapshot and the ladder, and wrong in
 * front of a person. `/api/meetings` ships them to the client in three places
 * (`sources[].source`, every meeting `id`, and `carried.source`), so the value
 * is permanently one interpolation away from a surface, and the next session
 * that wants to say WHICH calendar failed will reach for the nearest string.
 *
 * Production was checked before any of this was written, at all four zips: the
 * server HTML and `/about-area` carry none of the ten ids, and the one place a
 * source could surface renders a date and a sentence rather than the key. So
 * these guards hold a clean state clean.
 */

test("every wired adapter has a human calendar name", () => {
  // Read from the wiring, so an adapter added tomorrow fails this the day it
  // lands rather than the day someone remembers to come back here.
  const missing = internalSourceIds().filter((id) => calendarLabel(id) === null);
  assert.deepEqual(
    missing,
    [],
    `adapter(s) with no human calendar name: ${missing.join(", ")} — add them to CALENDAR_LABELS`,
  );
});

test("no label is an internal id wearing a label's clothes", () => {
  for (const [id, label] of Object.entries(CALENDAR_LABELS)) {
    assert.ok(!label.includes(id), `the label for ${id} contains the id itself`);
    assert.ok(
      /^[a-z][a-z' ,-]+$/i.test(label),
      `the label for ${id} is not plain prose: ${JSON.stringify(label)}`,
    );
    assert.ok(label.length > 8, `the label for ${id} is too terse to read as a sentence part`);
  }
});

test("an unknown id gets null, never a plausible phrase", () => {
  // A default here would describe an unlabelled adapter as something it may
  // not be, and nothing would ever catch the missing entry.
  for (const id of ["", null, undefined, "not-an-adapter", "SCHEDULEPAGE"]) {
    assert.equal(calendarLabel(id), null, `${JSON.stringify(id)} was given a label`);
  }
});

test("no reader-facing component interpolates an internal source id", () => {
  // The structural mistake, read for directly: a component reaching for
  // `.source` or `sourceId` on a meeting, a snapshot or a carried mark. The
  // provenance field `sourceOrg` is a DIFFERENT thing and is deliberately not
  // matched — it holds the body's own name ("Rockaway Township"), which is
  // exactly what should render.
  const surfaces: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".tsx")) surfaces.push(path);
    }
  };
  walk(join(ROOT, "components"));
  walk(join(ROOT, "app"));

  const offenders: string[] = [];
  for (const path of surfaces) {
    const source = readFileSync(path, "utf8");
    // A literal id typed into a component, or a render of the internal field.
    for (const id of internalSourceIds()) {
      if (new RegExp(`["'\`]${id}["'\`]`).test(source)) {
        offenders.push(`${path.slice(ROOT.length + 1)} names "${id}" literally`);
      }
    }
    if (/\{[^}]*\bcarried\.source\b[^}]*\}/.test(source)) {
      offenders.push(`${path.slice(ROOT.length + 1)} renders carried.source`);
    }
    if (/\{[^}]*\bsnapshot\.sources\b[^}]*\.source\b/.test(source)) {
      offenders.push(`${path.slice(ROOT.length + 1)} renders a snapshot source name`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `an internal adapter id can reach a reader:\n  ${offenders.join("\n  ")}\n` +
      `Use calendarLabel() from lib/meetings/source-labels.ts, or say nothing specific.`,
  );
});
