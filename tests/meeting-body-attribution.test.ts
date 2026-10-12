import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { filesThatWouldBeCommitted } from "../lib/ops/repo-files.ts";
import type { Meeting } from "../lib/sources/types.ts";
import type { Registry } from "../lib/registry/types.ts";

/** A meeting belongs to the body that held it, not to its division: the data carries `bodyId`, and no reader surface goes back to the division. */
const ROOT = process.cwd();

function snapshot(): { meetings: Meeting[] } {
  return JSON.parse(readFileSync(join(ROOT, "tests", "fixtures", "reader-upcoming-meetings-85701.json"), "utf8")) as {
    meetings: Meeting[];
  };
}

function registry(): Registry {
  return JSON.parse(readFileSync(join(ROOT, "lib", "registry", "registry.json"), "utf8")) as Registry;
}

test("every meeting in the fixture names the body that held it", () => {
  const { meetings } = snapshot();
  assert.ok(meetings.length > 0, "an empty snapshot proves nothing");

  const missing = meetings.filter((m) => !m.bodyId).map((m) => `${m.id} (${m.bodyName})`);
  assert.deepEqual(
    missing,
    [],
    `${missing.length} meeting(s) carry no bodyId, so no body card can show them and nothing says ` +
      `why. Every adapter builds inside a wiring-row loop — add \`bodyId: wiring.bodyId\` beside ` +
      `\`ocdId: wiring.ocdId\`.\n  ${missing.slice(0, 15).join("\n  ")}`,
  );
});

test("every meeting's bodyId resolves to a body the registry holds", () => {
  const { meetings } = snapshot();
  const ids = new Set(registry().bodies.map((b) => b.id));
  const dangling = meetings
    .filter((m) => m.bodyId && !ids.has(m.bodyId))
    .map((m) => `${m.id} -> ${m.bodyId}`);
  assert.deepEqual(
    dangling,
    [],
    `${dangling.length} meeting(s) name a body the registry does not hold. A dangling attribution ` +
      `renders as an empty card, which is a false absence.\n  ${dangling.slice(0, 15).join("\n  ")}`,
  );
});

test("no reader surface joins a meeting to a body by their shared division", () => {
  // Division-scoped surfaces legitimately filter by `ocdId`; this bans only the pairing that claims a body's sittings.
  const offenders: string[] = [];
  for (const file of filesThatWouldBeCommitted({ cwd: ROOT })) {
    if (!/\.(ts|tsx)$/.test(file)) continue;
    if (file === "tests/meeting-body-attribution.test.ts") continue;
    let text: string;
    try {
      text = readFileSync(join(ROOT, file), "utf8");
    } catch {
      continue;
    }
    const code = text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
    /* A meeting compared to a body's division, in any spelling. */
    if (/\bocdId\s*===\s*\w*[Bb]ody\.ocdId/.test(code) || /\b[Bb]ody\.ocdId\s*===\s*\w+\.ocdId/.test(code)) {
      offenders.push(file);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `${offenders.length} module(s) match a meeting to a body on their shared division:\n  ` +
      offenders.join("\n  ") +
      "\n\nJoin on Meeting.bodyId. `ocdId` answers WHERE and is shared by every body in the division.",
  );
});

test("CONTROL: the division join really would over-match, on the fixture", () => {
  // Replays the old join and requires it to still over-match, so the guards above are not vacuous.
  const { meetings } = snapshot();
  const reg = registry();
  const bodiesByDivision = new Map<string, number>();
  for (const b of reg.bodies) {
    if (!b.ocdId) continue;
    bodiesByDivision.set(b.ocdId, (bodiesByDivision.get(b.ocdId) ?? 0) + 1);
  }

  const overMatched = meetings.filter((m) => m.ocdId && (bodiesByDivision.get(m.ocdId) ?? 0) > 1);
  assert.ok(
    overMatched.length > 0,
    "no meeting sits on a division with more than one body, so the old join would have been " +
      "harmless and these guards would be testing nothing.",
  );

  /* Each of those meetings names exactly one body. */
  for (const m of overMatched.slice(0, 50)) {
    assert.ok(m.bodyId, `${m.id} sits on a shared division and names no body`);
  }
});
