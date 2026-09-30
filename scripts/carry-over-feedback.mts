import { config as loadEnv } from "dotenv";
import { carryOverFeedback } from "../lib/db/feedback-carryover.ts";
import { assertWriteAllowed } from "../lib/db/write-guard.ts";

loadEnv({ path: ".env.local" });
const source = process.env.DATABASE_URL;
const target = process.env.FEEDBACK_DATABASE_URL;
if (!source || !target) throw new Error("DATABASE_URL and FEEDBACK_DATABASE_URL must name the old and new feedback stores.");
const copy = process.argv.includes("--copy");
if (copy) assertWriteAllowed("feedback carry-over", { ...process.env, DATABASE_URL: target });
console.log(JSON.stringify(await carryOverFeedback(source, target, copy)));
