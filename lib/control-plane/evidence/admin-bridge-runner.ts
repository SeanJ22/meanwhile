import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { ArtifactRecord, ControlPlaneRepositories } from "../repository/types.ts";
import type { WorkItem } from "../work-item.ts";
import { ORIGINAL_LIFETIME_HUNT } from "../scheduler/hunt-continuation.ts";
import { adminEvidenceKey, mirrorOriginalCapture, type AdminEvidenceRemote } from "./admin-bridge.ts";
import { NetlifyAdminEvidenceRemote } from "./admin-bridge-netlify.ts";
import { findHeldCapture, readHeldBytes } from "./read-only-vault.ts";

export interface AdminMirrorReport {
  readonly state: "DISABLED" | "NOT_CONFIGURED" | "RAN";
  readonly examined: number;
  readonly copied: number;
  readonly alreadyVerified: number;
  readonly refused: number;
  readonly failures: readonly string[];
}

type Lane = "original" | "recent" | "history";
const LANES: readonly Lane[] = ["original", "recent", "history"];
// The exact active hunt and new captures receive more turns, while history
// still advances every six opportunities even under continuous new inflow.
const TURN_ORDER: readonly Lane[] = ["original", "recent", "original", "history", "original", "recent"];
const VERIFIED_RECHECK_MS = 7 * 24 * 60 * 60 * 1000;
export const ADMIN_MIRROR_BUDGET_MS = 60_000;
interface MirrorCursor {
  readonly version: 2;
  nextByLane: Record<Lane, number>;
  turn: number;
  /** A scheduling hint only. Admin downloads verify the remote copy on every read. */
  verifiedAt: Record<string, number>;
}
const freshCursor = (): MirrorCursor => ({
  version: 2, nextByLane: { original: 0, recent: 0, history: 0 }, turn: 0, verifiedAt: Object.create(null),
});

function isOriginalHunt(work: WorkItem | undefined): boolean {
  if (!work || work.project !== "freshness") return false;
  return work.autonomousPlan?.ownerInstructions?.includes(ORIGINAL_LIFETIME_HUNT.receiptId) === true ||
    work.manualSourceGap?.instructionReceipt === ORIGINAL_LIFETIME_HUNT.receiptId;
}

function partition(records: readonly ArtifactRecord[], owners: ReadonlyMap<string, WorkItem>, nowMs: number): Record<Lane, ArtifactRecord[]> {
  const lanes: Record<Lane, ArtifactRecord[]> = { original: [], recent: [], history: [] };
  for (const record of records) {
    if (record.tier !== "RAW" || record.partial) continue;
    const lane: Lane = isOriginalHunt(owners.get(record.workItemId)) ? "original" :
      Date.parse(record.recordedAt) >= nowMs - 24 * 60 * 60 * 1000 ? "recent" : "history";
    lanes[lane].push(record);
  }
  lanes.original.sort((a, b) => b.recordedAt.localeCompare(a.recordedAt) || a.artifactId.localeCompare(b.artifactId));
  lanes.recent.sort((a, b) => b.recordedAt.localeCompare(a.recordedAt) || a.artifactId.localeCompare(b.artifactId));
  lanes.history.sort((a, b) => a.recordedAt.localeCompare(b.recordedAt) || a.artifactId.localeCompare(b.artifactId));
  return lanes;
}

async function readCursor(path: string): Promise<MirrorCursor> {
  try {
    const raw = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    if (raw.version === 2 && raw.nextByLane && typeof raw.nextByLane === "object" &&
        LANES.every(lane => Number.isSafeInteger((raw.nextByLane as Record<string, unknown>)[lane]) &&
          Number((raw.nextByLane as Record<string, unknown>)[lane]) >= 0) &&
        Number.isSafeInteger(raw.turn) && Number(raw.turn) >= 0 &&
        raw.verifiedAt && typeof raw.verifiedAt === "object" && !Array.isArray(raw.verifiedAt)) {
      const verifiedAt: Record<string, number> = Object.create(null);
      for (const [key, value] of Object.entries(raw.verifiedAt)) {
        if (key.startsWith("freshness/") && typeof value === "number" && Number.isFinite(value) && value >= 0)
          verifiedAt[key] = value;
      }
      return { version: 2, nextByLane: raw.nextByLane as Record<Lane, number>, turn: Number(raw.turn), verifiedAt };
    }
    // The previous cursor covered only the oldest-first population.
    if (Number.isSafeInteger(raw.next) && Number(raw.next) >= 0) {
      const cursor = freshCursor(); cursor.nextByLane.history = Number(raw.next); return cursor;
    }
    throw new Error("ADMIN_EVIDENCE_MIRROR_CURSOR_INVALID");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return freshCursor();
    throw error;
  }
}

async function saveCursor(path: string, cursor: MirrorCursor): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(cursor) + "\n", "utf8");
  await rename(temp, path);
}

/** Rotating bounded slices prioritize the exact hunt and new captures while
 * advancing historical backfill. The cursor is operational, never evidence. */
export async function runAdminEvidenceMirror(input: {
  readonly repos: ControlPlaneRepositories;
  readonly vaultRoot: string;
  readonly cursorPath: string;
  readonly env?: Readonly<{ WTP_ADMIN_EVIDENCE_MIRROR_ENABLED?: string; NETLIFY_SITE_ID?: string; NETLIFY_BLOBS_TOKEN?: string }>;
  readonly deadlineMs?: number;
  readonly nowMs?: number;
  /** Isolated tests only. Production uses the time boundary, not a record count. */
  readonly maxExamined?: number;
  /** Isolated tests only; production uses the configured private Netlify store. */
  readonly remote?: AdminEvidenceRemote;
}): Promise<AdminMirrorReport> {
  const env = input.env ?? process.env;
  const empty = (state: AdminMirrorReport["state"]): AdminMirrorReport =>
    ({ state, examined: 0, copied: 0, alreadyVerified: 0, refused: 0, failures: [] });
  if (env.WTP_ADMIN_EVIDENCE_MIRROR_ENABLED !== "1") return empty("DISABLED");
  if (!input.remote && (!env.NETLIFY_SITE_ID || !env.NETLIFY_BLOBS_TOKEN)) return empty("NOT_CONFIGURED");
  const deadlineMs = Math.min(input.deadlineMs ?? Number.POSITIVE_INFINITY, Date.now() + ADMIN_MIRROR_BUDGET_MS);
  let expired = false;
  const beforeDeadline = async <T>(read: () => Promise<T>): Promise<T> => {
    const remaining = deadlineMs - Date.now();
    if (expired || remaining <= 0) throw new Error("ADMIN_EVIDENCE_MIRROR_DEADLINE");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([read(), new Promise<never>((_, reject) => {
        timer = setTimeout(() => { expired = true; reject(new Error("ADMIN_EVIDENCE_MIRROR_DEADLINE")); }, remaining);
      })]);
    } finally { if (timer) clearTimeout(timer); }
  };
  const source = input.remote ?? new NetlifyAdminEvidenceRemote({ siteID: env.NETLIFY_SITE_ID, token: env.NETLIFY_BLOBS_TOKEN });
  // An immutable create may settle after timeout. Its next ordinary turn reads
  // and verifies the same key; no timed-out operation is counted as a copy.
  const remote: AdminEvidenceRemote = {
    read: key => beforeDeadline(() => source.read(key)),
    create: (key, blob) => beforeDeadline(() => source.create(key, blob)),
  };
  const [records, attempts, workItems] = await beforeDeadline(() => Promise.all([
    input.repos.artifacts.readAll(), input.repos.attempts.list(), input.repos.workItems.list(),
  ]));
  const nowMs = input.nowMs ?? Date.now();
  const byAttempt = new Map(attempts.map(row => [row.id, row.value]));
  const byWorkItem = new Map(workItems.map(row => [row.id, row.value]));
  const lanes = partition(records, byWorkItem, nowMs);
  const total = LANES.reduce((sum, lane) => sum + lanes[lane].length, 0);
  if (!total) return empty("RAN");
  const cursor = await readCursor(input.cursorPath);
  for (const [key, at] of Object.entries(cursor.verifiedAt))
    if (nowMs - at >= VERIFIED_RECHECK_MS) delete cursor.verifiedAt[key];
  let copied = 0, alreadyVerified = 0, refused = 0, examined = 0, visited = 0;
  const failures: string[] = [];
  const perLaneVisited: Record<Lane, number> = { original: 0, recent: 0, history: 0 };
  const limit = input.maxExamined ?? Number.POSITIVE_INFINITY;
  while (visited < total && examined < limit && Date.now() < deadlineMs - 500) {
    const lane = TURN_ORDER[cursor.turn % TURN_ORDER.length];
    cursor.turn = (cursor.turn + 1) % TURN_ORDER.length;
    const group = lanes[lane];
    if (!group.length || perLaneVisited[lane] >= group.length) continue;
    const index = cursor.nextByLane[lane] % group.length;
    const record = group[index];
    cursor.nextByLane[lane] = (index + 1) % group.length;
    perLaneVisited[lane]++; visited++;
    let key: string;
    try { key = adminEvidenceKey(record); }
    catch (error) { refused++; failures.push(`${record.artifactId}:${error instanceof Error ? error.message : "UNKNOWN"}`); continue; }
    if (cursor.verifiedAt[key] !== undefined) continue;
    examined++;
    try {
      const attempt = byAttempt.get(record.attemptId);
      const owner = byWorkItem.get(record.workItemId);
      if (!attempt || !owner || owner.project !== "freshness") throw new Error("ATTRIBUTION_NOT_HELD");
      const held = await beforeDeadline(() => findHeldCapture(input.vaultRoot, record));
      if (!held) throw new Error("ATTRIBUTION_NOT_HELD");
      const bytes = await beforeDeadline(() => readHeldBytes(held));
      const outcome = await mirrorOriginalCapture({ record, attempt, held, bytes, remote });
      if (outcome === "COPIED") copied++; else alreadyVerified++;
      cursor.verifiedAt[key] = nowMs;
    } catch (error) {
      refused++;
      failures.push(`${record.artifactId}:${error instanceof Error ? error.message : "UNKNOWN"}`);
    }
    // Persist each completed remote result before the next operation may block.
    await saveCursor(input.cursorPath, cursor);
    if (expired) break;
  }
  await saveCursor(input.cursorPath, cursor);
  return { state: "RAN", examined, copied, alreadyVerified, refused, failures };
}
