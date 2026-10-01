import { config as loadEnv } from "dotenv";
import { carryOverFeedback } from "../lib/db/feedback-carryover.ts";

loadEnv({ path: ".env.local" });
const source = process.env.DATABASE_URL;
const target = process.env.FEEDBACK_DATABASE_URL;
if (!source || !target) throw new Error("DATABASE_URL and FEEDBACK_DATABASE_URL are both required; refusing to guess.");
console.log(JSON.stringify(await carryOverFeedback(source, target, process.argv.includes("--copy"))));
