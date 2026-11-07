/** Lists and tests saved keys; never prints a key value and never prompts for one. */
import { productionKeysStore } from "../lib/core/keys-store.ts";
import { keysUnreachable } from "../lib/core/keys-runtime.ts";
import { testDueKeys } from "../lib/core/keys-test.ts";

try {
  const store = productionKeysStore();
  const command = process.argv[2] ?? "list";
  if (command === "test") {
    const name = process.argv[3], at = new Date().toISOString();
    if (name) await store.retest(name, at);
    await testDueKeys(store, at, name);
  }
  else if (command !== "list") throw new Error("Unknown keys command");
  const rows = await store.list();
  for (const row of rows) console.log(`${row.name}: ${row.working ? "Working" : "Not working"}; ${row.purpose}; last tested ${row.testedAt ?? "—"}`);
  if (rows.some(row => !row.working)) process.exitCode = 1;
} catch (error) {
  console.error(`${keysUnreachable(error).message} Check the Keys box in Admin Settings. No key value was printed.`);
  process.exitCode = 1;
}
