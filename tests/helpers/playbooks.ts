export type { TestContext, TestOptions } from "node:test";
export { after, before, afterEach, beforeEach, describe } from "node:test";
import { readFileSync } from "node:fs";
import nodeTest from "node:test";
import { createHash } from "node:crypto";
import { createMemoryRepositories as emptyRepositories } from "../../lib/control-plane/repository/memory.ts";
import { rolePlaybook } from "../../lib/control-plane/playbooks.ts";
import type { FieldManualEntry, FieldManualRole } from "../../lib/control-plane/field-manual.ts";
import { withAskSettings } from "../../lib/ask/runtime-settings.ts";
import { ASK_PLAYBOOK_ROLES, type ReaderSettingsSnapshot } from "../../lib/civic-data/reader-settings-publication.ts";

/** The actual one-time data seed is the fixture; runtime code never loads this file. */
const sql = readFileSync(new URL("../../lib/db/migrations/0036_pb01_role_playbooks.sql", import.meta.url), "utf8");
export const playbookRows = [...sql.matchAll(/jsonb_set\(\$pb01\$(.*?)\$pb01\$::jsonb/g)].map(match => JSON.parse(match[1]) as FieldManualEntry);
export const fixturePlaybooks = (roles: readonly FieldManualRole[]) => playbookRows.filter(row => roles.includes(row.role));
export const fixtureRolePlaybook = async (role: "SCOUT" | "DETECTIVE") => rolePlaybook(playbookRows, role);
export function createMemoryRepositories() {
  const repos = emptyRepositories();
  for (const row of playbookRows) void repos.fieldManual.put(row.id, row, "2026-10-12T00:00:00Z");
  return repos;
}
export function askSnapshot(values: ReaderSettingsSnapshot["values"] = {}): ReaderSettingsSnapshot {
  return { formatVersion: 1, revision: 1, updatedAt: "2026-10-12T00:00:00Z", values,
    playbooks: Object.fromEntries(ASK_PLAYBOOK_ROLES.map(role => {
      const book = rolePlaybook(playbookRows, role);
      return [role, { text: book.text, version: createHash("sha256").update(book.text).digest("hex"), revision: 1 }];
    })) };
}
/** Give each test its own published snapshot, as production gives each request one. */
export const test: typeof nodeTest = Object.assign((...args: unknown[]) => {
  const body = args.at(-1);
  if (typeof body === "function") args[args.length - 1] = (...input: unknown[]) => withAskSettings(askSnapshot(), () => body(...input));
  return (nodeTest as (...input: unknown[]) => unknown)(...args);
}, nodeTest) as typeof nodeTest;
export default test;
