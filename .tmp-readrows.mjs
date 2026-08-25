import { readStore } from "./scripts/tracker-core.mjs";
const want = process.argv.slice(2);
const rows = readStore("docs/tracker-working.csv", process.cwd());
for (const r of rows) if (want.includes(r.ID)) {
  console.log(`=== ${r.ID} [${r.Section} ${r.Priority}] ${r.Title}`);
  console.log("WHAT: " + String(r["What this is"] || "").slice(0, 1600));
  console.log("RES: " + r.Resolution + " | Opened by: " + r["Opened by"] + " | Notes: " + String(r.Notes || "").slice(0, 300));
  console.log("SESSION RECORD: " + String(r["Session record"] || "").slice(0, 800));
  console.log();
}
