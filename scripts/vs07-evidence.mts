/** Saved VS-07 source responses live in the runner's evidence store, not the code tree.
 *
 *   node --experimental-strip-types --import ./scripts/register-test-loader.mjs scripts/vs07-evidence.mts import --from=<dir>
 *
 * walks every capture manifest under <dir> (`*captures.json`, `*manifest.json`, `*.capture.json`), checks each saved
 * body against its recorded hash, and stores it once per requested and final URL in the freshness vault the runner
 * already uses (`data/control-plane/vault`, `DurableEvidenceStore`; mirrored to Netlify Blobs when the runner's
 * WTP_VAULT_PROVIDER is set). The full documents captured for VS-07 are the saved-byte tree of commit 8ad77b9d5:
 *   git archive 8ad77b9d5 tests/fixtures/voting-sources | tar -x -C <dir>
 * The code tree keeps only trimmed test excerpts; `scripts/vs07-replay.mts` replays these saved responses.
 * A RESTRICTED_RAW body is never written to this plain store. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DurableEvidenceStore } from "../lib/control-plane/evidence/durable-store.ts";
import { classifyAcquisition } from "../lib/control-plane/evidence/artifact.ts";
import { VAULT_DIR } from "../lib/control-plane/scheduler/vault.ts";
import { contentHash } from "../lib/control-plane/ids.ts";
import { assignment } from "./cli-args.mts";

export const VS07_SOURCE_PREFIX = "project/vs07-source-replay/";

export interface SavedSourceResponse {
  url: string; key: string; status: number; contentType: string; sha256: string;
  capturedAt?: string; responseHeaders?: Record<string, string>; order: number;
}

interface ManifestRow {
  url?: string; finalUrl?: string; file?: string; path?: string; status?: number; httpStatus?: number; contentType?: string;
  responseHeaders?: Record<string, string>; savedHash?: string; savedSha256?: string; sha256?: string; capturedAt?: string; at?: string;
  attempts?: { url: string; outcome: string }[];
}

export function vs07EvidenceStore(root = process.cwd()): DurableEvidenceStore {
  return new DurableEvidenceStore(join(root, ...VAULT_DIR));
}

/** Every saved response a capture manifest under `directory` names, in walk order (a later row for a URL wins). */
export function savedManifestRows(directory: string): (ManifestRow & { url: string; status: number; localPath: string })[] {
  const rows: (ManifestRow & { url: string; status: number; localPath: string })[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) { walk(path); continue; }
      if (!/(?:^|[-.])(?:captures|manifest|capture)\.json$/.test(entry.name)) continue;
      const visit = (value: unknown): void => {
        if (Array.isArray(value)) { value.forEach(visit); return; }
        if (!value || typeof value !== "object") return;
        const row = value as ManifestRow;
        const file = row.path ?? row.file ?? (entry.name.endsWith(".capture.json") ? entry.name.replace(/\.capture\.json$/, "") : undefined);
        const status = row.status ?? row.httpStatus ?? Number(row.attempts?.findLast(attempt => [row.url, row.finalUrl].includes(attempt.url) && /^HTTP \d+/.test(attempt.outcome))?.outcome.match(/^HTTP (\d+)/)?.[1]);
        if (row.url && file && Number.isInteger(status) && status >= 100 && status <= 599) {
          const local = [resolve(dirname(path), file), resolve(directory, file), resolve(directory, "..", "..", "..", file)].find(candidate => existsSync(candidate));
          if (local) rows.push({ ...row, url: row.url, status, localPath: local });
        }
        Object.values(value).forEach(visit);
      };
      visit(JSON.parse(readFileSync(path, "utf8")));
    }
  };
  walk(directory);
  return rows;
}

const urlDirectory = (url: string) => `${VS07_SOURCE_PREFIX}${createHash("sha256").update(url).digest("hex").slice(0, 32)}/`;

export async function importSavedResponses(store: DurableEvidenceStore, directory: string): Promise<{ stored: number; urls: number; superseded: number; restricted: string[] }> {
  const rows = savedManifestRows(directory);
  let stored = 0, superseded = 0;
  const urls = new Set<string>(), restricted: string[] = [];
  for (const [order, row] of rows.entries()) {
    const bytes = new Uint8Array(readFileSync(row.localPath));
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const recorded = row.savedHash ?? row.savedSha256 ?? row.sha256;
    // Older regional manifests list superseded captures of one rewritten file; only the row naming these bytes is held.
    if (recorded && recorded !== sha256) { superseded++; continue; }
    const contentType = row.contentType ?? "application/octet-stream";
    if (/html|text|json|javascript|xml/i.test(contentType) && classifyAcquisition(new TextDecoder().decode(bytes)).tier === "RESTRICTED_RAW") {
      restricted.push(row.url); continue;
    }
    for (const url of [...new Set([row.url, row.finalUrl].filter(Boolean) as string[])]) {
      const key = `${urlDirectory(url)}${String(order).padStart(6, "0")}-${sha256}.bin`;
      if (!await store.head(key)) {
        await store.put(key, bytes, { contentType, contentHash: contentHash(bytes), byteLength: bytes.byteLength, custom: {
          url, status: String(row.status), contentType, sha256, order: String(order),
          ...(row.capturedAt ?? row.at ? { capturedAt: (row.capturedAt ?? row.at)! } : {}),
          ...(row.responseHeaders ? { responseHeaders: JSON.stringify(row.responseHeaders) } : {}),
        } });
        stored++;
      }
      urls.add(url);
    }
  }
  return { stored, urls: urls.size, superseded, restricted };
}

/** The saved response for each URL (the last imported one when a URL was captured more than once). */
export async function savedSourceResponses(store: DurableEvidenceStore): Promise<Map<string, SavedSourceResponse>> {
  const responses = new Map<string, SavedSourceResponse>();
  for (const key of await store.list(VS07_SOURCE_PREFIX)) {
    const meta = await store.head(key);
    const custom = meta?.custom;
    if (!meta || !custom?.url || !custom.sha256) continue;
    const response: SavedSourceResponse = { url: custom.url, key, status: Number(custom.status), contentType: custom.contentType ?? meta.contentType,
      sha256: custom.sha256, capturedAt: custom.capturedAt, order: Number(custom.order),
      ...(custom.responseHeaders ? { responseHeaders: JSON.parse(custom.responseHeaders) as Record<string, string> } : {}) };
    const held = responses.get(response.url);
    if (!held || held.order < response.order) responses.set(response.url, response);
  }
  return responses;
}

async function main(): Promise<void> {
  assert.equal(process.argv[2], "import", "usage: vs07-evidence.mts import --from=<directory of saved capture manifests>");
  const from = assignment(process.argv, "from");
  assert.ok(from && existsSync(from), "--from must name a directory of saved capture manifests");
  const store = vs07EvidenceStore();
  const result = await importSavedResponses(store, resolve(from));
  const held = await savedSourceResponses(store);
  console.log(`VS07_EVIDENCE stored=${result.stored} urls=${result.urls} held=${held.size} supersededRows=${result.superseded} restrictedSkipped=${result.restricted.length}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
