/** File harness durations are diagnostics, not subprocess or billed runner time. */
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function normalizeFile(file, root = process.cwd()) {
  if (typeof file !== "string" || file.length === 0) return null;
  try {
    const value = file.startsWith("file:") ? fileURLToPath(file) : file.replaceAll("\\", "/");
    const normalized = relative(resolve(root), resolve(root, value)).replaceAll("\\", "/");
    return normalized && normalized !== ".." && !normalized.startsWith("../") && !isAbsolute(normalized)
      ? normalized : null;
  } catch { return null; }
}

export default async function* fileTimings(source) {
  let fileSummaryCount = 0;
  let runSummaryCount = 0;
  for await (const event of source) {
    if (event.type !== "test:summary") continue;
    const { file, duration_ms, success, counts } = event.data;
    const kind = file === undefined ? "run" : "file";
    if (kind === "file") fileSummaryCount++;
    else runSummaryCount++;
    yield `${JSON.stringify({ schemaVersion: 1, kind,
      ...(kind === "file" ? { file: normalizeFile(file) } : {}),
      durationMs: duration_ms, success, counts })}\n`;
  }
  yield `${JSON.stringify({ schemaVersion: 1, kind: "stream-end", fileSummaryCount, runSummaryCount })}\n`;
}

const COUNTS = ["tests", "failed", "passed", "cancelled", "skipped", "todo", "topLevel", "suites"];
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/** Validate the entire stream against discovery, never against display names. */
export function validateTimings(text, expectedFiles) {
  const issues = [];
  const rows = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line)); }
    catch { issues.push(`Timing line ${index + 1} is not valid JSON.`); }
  }
  const files = [];
  const runs = [];
  const ends = [];
  for (const row of rows) {
    if (!record(row) || row.schemaVersion !== 1 || !["file", "run", "stream-end"].includes(row.kind)) {
      issues.push("Unknown timing record format.");
      continue;
    }
    if (row.kind === "stream-end") { ends.push(row); continue; }
    if (!Number.isFinite(row.durationMs) || row.durationMs < 0 || typeof row.success !== "boolean" ||
      !record(row.counts) || COUNTS.some((key) => !Number.isSafeInteger(row.counts[key]) || row.counts[key] < 0)) {
      issues.push(`Invalid timing summary for ${row.kind === "file" ? row.file : "run"}.`);
    }
    if (row.kind === "file") files.push(row);
    else runs.push(row);
  }
  if (ends.length !== 1 || rows.at(-1)?.kind !== "stream-end") issues.push("Exactly one terminal stream-end record is required.");
  if (runs.length !== 1) issues.push("Exactly one overall run summary is required.");
  if (ends.length === 1 && (ends[0].fileSummaryCount !== files.length || ends[0].runSummaryCount !== runs.length)) {
    issues.push("Stream-end counts do not match the summaries.");
  }
  const seen = new Set();
  const expected = new Set(expectedFiles);
  for (const row of files) {
    if (typeof row.file !== "string" || normalizeFile(row.file) !== row.file || !expected.has(row.file)) {
      issues.push(`Unexpected or non-normalized file summary: ${String(row.file)}.`);
    }
    if (seen.has(row.file)) issues.push(`Duplicate file summary: ${String(row.file)}.`);
    seen.add(row.file);
  }
  const missing = expectedFiles.filter((file) => !seen.has(file));
  if (missing.length) issues.push(`Missing file summaries: ${missing.join(", ")}.`);
  return { complete: issues.length === 0, issues, missingFiles: missing,
    files: files.sort((a, b) => String(a.file) < String(b.file) ? -1 : String(a.file) > String(b.file) ? 1 : 0),
    run: runs.length === 1 ? runs[0] : null };
}
