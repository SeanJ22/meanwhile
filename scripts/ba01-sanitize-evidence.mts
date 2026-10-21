/** Redact incidental credentials from BA-01 captures while retaining original fingerprints. */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { credentials, SANITIZER_VERSION, sanitizeText, scanText } from "../lib/ops/fixture-credentials.ts";
import { filesThatWouldBeCommitted } from "../lib/ops/repo-files.ts";

const root = resolve(import.meta.dirname, "..");
const manifestPath = resolve(root, "data/ballot/ba01-source-redactions.json");
const sha256 = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
type BodyFingerprint = { pointer: string; rawSha256: string; sanitizedSha256: string };
type Entry = {
  rawSha256: string; sanitizedSha256: string; encoding: "identity" | "gzip";
  rawDecodedSha256: string; sanitizedDecodedSha256: string;
  redactions: ReturnType<typeof sanitizeText>["redactions"];
  embeddedBodies: BodyFingerprint[];
};
type Manifest = { sanitizerVersion: string; explanation: string; captures: Record<string, Entry> };
const manifest: Manifest = existsSync(manifestPath)
  ? JSON.parse(readFileSync(manifestPath, "utf8"))
  : {
    sanitizerVersion: SANITIZER_VERSION,
    explanation: "Only credential substrings were replaced. Original source and receipt hashes remain fingerprints of the original captures; sanitized hashes identify the archived bytes. Unsanitized originals are excluded from git under .scratch/ba01-raw-evidence/.",
    captures: {},
  };
const repair = process.argv.includes("--sanitize");
let found = 0;
for (const path of filesThatWouldBeCommitted({ cwd: root, paths: ["data/ballot"] })) {
  const absolute = resolve(root, path);
  if (!existsSync(absolute)) continue;
  const raw = readFileSync(absolute);
  const encoding = path.endsWith(".gz") ? "gzip" : "identity";
  const decoded = encoding === "gzip" ? gunzipSync(raw) : raw;
  if (decoded.subarray(0, 8192).includes(0)) continue;
  const text = decoded.toString("utf8");
  if (!Buffer.from(text).equals(decoded)) continue;
  const findings = credentials(scanText(text, sha256));
  if (!findings.length) continue;
  found += 1;
  console.log(`${path}: ${findings.reduce((n, row) => n + row.occurrences, 0)} credential substrings`);
  if (!repair) continue;
  const sanitized = sanitizeText(text, sha256);
  const embeddedBodies: BodyFingerprint[] = [];
  if (path.endsWith(".json") || path.endsWith(".json.gz")) {
    const walk = (value: unknown, pointer: string) => {
      if (typeof value === "string") {
        const cleaned = sanitizeText(value, sha256);
        if (cleaned.replaced) embeddedBodies.push({ pointer, rawSha256: sha256(value), sanitizedSha256: sha256(cleaned.text) });
      } else if (value && typeof value === "object") {
        for (const [key, child] of Object.entries(value)) walk(child, `${pointer}/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`);
      }
    };
    walk(JSON.parse(text), "");
  }
  const archived = encoding === "gzip" ? gzipSync(sanitized.text) : Buffer.from(sanitized.text);
  const privatePath = resolve(root, ".scratch/ba01-raw-evidence", path);
  mkdirSync(dirname(privatePath), { recursive: true });
  if (!existsSync(privatePath)) writeFileSync(privatePath, raw);
  const prior = manifest.captures[path];
  if (prior && sha256(raw) !== prior.sanitizedSha256) throw new Error(`Capture changed since redaction: ${path}`);
  manifest.captures[path] = {
    rawSha256: prior?.rawSha256 ?? sha256(raw), sanitizedSha256: sha256(archived), encoding,
    rawDecodedSha256: prior?.rawDecodedSha256 ?? sha256(decoded), sanitizedDecodedSha256: sha256(sanitized.text),
    redactions: [...(prior?.redactions ?? []), ...sanitized.redactions],
    embeddedBodies: [...(prior?.embeddedBodies ?? []), ...embeddedBodies],
  };
  writeFileSync(absolute, archived);
}
if (repair) writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
console.log(`${repair ? "Sanitized" : "Found"} ${found} captured artifacts.`);
if (found && !repair) process.exitCode = 1;
