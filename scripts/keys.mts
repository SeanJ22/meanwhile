/** Lists metadata or imports existing runtime credentials; never prints a key value and never prompts for one. */
import { productionKeysStore, readSavedKey } from "../lib/core/keys-store.ts";
import { importExistingKeys } from "../lib/core/keys-import.ts";
import { testDueKeys } from "../lib/core/keys-test.ts";

try {
  const store = productionKeysStore();
  const command = process.argv[2] ?? "list";
  if (command === "import") await importExistingKeys(process.env, store);
  else if (command === "test") await testDueKeys(store, new Date().toISOString());
  else if (command === "verify") {
    const name = process.argv[3];
    if (!name || !await readSavedKey(name)) throw new Error("Saved key unavailable");
    console.log(`${name}: the saved key is available to this session.`);
  }
  else if (command !== "list") throw new Error("Unknown keys command");
  const rows = await store.list();
  for (const row of rows) console.log(`${row.name}: ${row.working ? "Working" : "Not working"}; ${row.purpose}; last tested ${row.testedAt ?? "—"}`);
  if (rows.some(row => !row.working)) process.exitCode = 1;
} catch {
  console.error("The saved keys could not be reached. Check the Keys box in Admin Settings. No key value was printed.");
  process.exitCode = 1;
}
