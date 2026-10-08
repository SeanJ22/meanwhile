import { q } from "./neonsrc.mjs";
import fs from "node:fs";
const r = await q("cp", "SELECT updated_at, value FROM cp_runner_heartbeat WHERE id = 'pilot-runner'", [], { raw: true });
const [updated, value] = r.rows[0];
const v = typeof value === "string" ? JSON.parse(value) : value;
fs.writeFileSync(process.argv[2], JSON.stringify({ updated, value: v }, null, 2));
const walk = (o, p = "", d = 0) => { if (d > 2 || o === null || typeof o !== "object") return; for (const [k, x] of Object.entries(o)) { console.log(p + k, Array.isArray(x) ? `[${x.length}]` : typeof x === "object" && x ? "{…}" : JSON.stringify(x)?.slice(0, 80)); if (!Array.isArray(x)) walk(x, p + "  ", d + 1); } };
console.log("updated", updated); walk(v);
