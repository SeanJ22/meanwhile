import type { ArtifactRecord, ControlPlaneRepositories } from "../repository/types.ts";
import type { WorkItem } from "../work-item.ts";
import { isFundedHunt } from "../scheduler/hunt-continuation.ts";
import { expansionScopesOf } from "../expansion/scopes.ts";
import { readRuntimeAdminConfig } from "../runtime-admin-config.ts";
import { withHistoryIndex } from "../workers/streamed-history.ts";
import { adminEvidenceKey, mirrorOriginalCapture, type AdminEvidenceRemote } from "./admin-bridge.ts";
import { NetlifyAdminEvidenceRemote } from "./admin-bridge-netlify.ts";
import { findHeldCapture, readHeldBytes } from "./read-only-vault.ts";
import { openAdminMirrorCursor, type MirrorLane } from "./admin-mirror-cursor.ts";

export interface AdminMirrorReport {
  readonly state: "DISABLED" | "NOT_CONFIGURED" | "RAN";
  readonly examined: number;
  readonly copied: number;
  readonly alreadyVerified: number;
  readonly refused: number;
  /** First eight diagnostics; every failure is also emitted immediately through onFailure or the runner log. */
  readonly failures: readonly string[];
}

type Lane = MirrorLane;
const LANES: readonly Lane[] = ["original", "recent", "history"];
// Funded hunts and new captures receive more turns, while history
// still advances every six opportunities even under continuous new inflow.
const TURN_ORDER: readonly Lane[] = ["original", "recent", "original", "history", "original", "recent"];
export const ADMIN_MIRROR_BUDGET_MS = 60_000;

/** Work opened by a funded Send's instruction gets the first lane, whichever Send it is. */
function isFundedHuntWork(work: WorkItem | undefined, fundedReceipts: ReadonlySet<string>): boolean {
  if (!work || work.project !== "freshness") return false;
  return work.autonomousPlan?.ownerInstructions?.some(receipt => fundedReceipts.has(receipt)) === true ||
    (work.manualSourceGap?.instructionReceipt !== undefined && fundedReceipts.has(work.manualSourceGap.instructionReceipt));
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
  /** Each diagnostic is delivered before the next copy; the report retains only its first eight. */
  readonly onFailure?: (failure: string) => void;
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
  const config = await beforeDeadline(() => readRuntimeAdminConfig(input.repos, ["expansionScopes"]));
  const fundedReceipts = new Set(expansionScopesOf(config?.value ?? null).scopes.filter(isFundedHunt).map(scope => scope.receiptId));
  const nowMs = input.nowMs ?? Date.now();
  return withHistoryIndex(async db => {
  // This is a temporary ordering index, never an evidence store. The source
  // page and one exact owner's routing fields are released before the next.
  db.exec("CREATE TABLE owners(id TEXT PRIMARY KEY, funded INTEGER NOT NULL); CREATE TABLE queue(sequence INTEGER PRIMARY KEY, lane TEXT NOT NULL, recorded_at TEXT NOT NULL, artifact_id TEXT NOT NULL, body TEXT NOT NULL); CREATE INDEX lane_order ON queue(lane,recorded_at,artifact_id,sequence)");
  const ownerQuery = db.prepare("SELECT funded FROM owners WHERE id=?"), ownerInsert = db.prepare("INSERT INTO owners VALUES(?,?)");
  const insert = db.prepare("INSERT INTO queue VALUES(?,?,?,?,?)");
  const sizes: Record<Lane, number> = { original: 0, recent: 0, history: 0 };
  let sequence = 0;
  await beforeDeadline(() => input.repos.artifacts.readChangedSince(null, undefined, {
    projection: { artifactId: true, workItemId: true, routeTaskId: true, attemptId: true, tier: true,
      contentHash: true, byteLength: true, contentType: true, canonicalUrl: true, partial: true, recordedAt: true },
    page: async rows => {
      for (const { record } of rows) {
        if (record.tier !== "RAW" || record.partial) continue;
        let owner = ownerQuery.get(record.workItemId);
        if (!owner) {
          const row = await beforeDeadline(() => input.repos.workItems.readNarrowed(record.workItemId,
            { project: true, autonomousPlan: ["ownerInstructions"], manualSourceGap: ["instructionReceipt"] }));
          const funded = isFundedHuntWork(row?.value as WorkItem | undefined, fundedReceipts);
          ownerInsert.run(record.workItemId, funded ? 1 : 0); owner = { funded: funded ? "1" : "0" };
        }
        const lane: Lane = Number(owner.funded) === 1 ? "original" :
          Date.parse(record.recordedAt) >= nowMs - 24 * 60 * 60 * 1000 ? "recent" : "history";
        insert.run(sequence++, lane, record.recordedAt, record.artifactId, JSON.stringify(record)); sizes[lane]++;
      }
    },
  }));
  const next = Object.fromEntries(LANES.map(lane => [lane, db.prepare(`SELECT body FROM queue WHERE lane=? ORDER BY recorded_at ${lane === "history" ? "ASC" : "DESC"},artifact_id ASC,sequence ASC LIMIT 1 OFFSET ?`)]));
  const total = LANES.reduce((sum, lane) => sum + sizes[lane], 0);
  if (!total) return empty("RAN");
  const cursor = await openAdminMirrorCursor(input.cursorPath, nowMs);
  try {
  let copied = 0, alreadyVerified = 0, refused = 0, examined = 0, visited = 0;
  const failures: string[] = [];
  const fail = (record: ArtifactRecord, error: unknown) => {
    refused++;
    const detail = `${record.artifactId}:${error instanceof Error ? error.message : "UNKNOWN"}`;
    if (input.onFailure) input.onFailure(detail); else console.error(`  private Admin evidence copy remains owed: ${detail}`);
    if (failures.length < 8) failures.push(detail);
  };
  const perLaneVisited: Record<Lane, number> = { original: 0, recent: 0, history: 0 };
  const limit = input.maxExamined ?? Number.POSITIVE_INFINITY;
  while (visited < total && examined < limit && Date.now() < deadlineMs - 500) {
    const lane = TURN_ORDER[cursor.turn % TURN_ORDER.length];
    cursor.turn = (cursor.turn + 1) % TURN_ORDER.length;
    const size = sizes[lane];
    if (!size || perLaneVisited[lane] >= size) continue;
    const index = cursor.nextByLane[lane] % size;
    const record = JSON.parse(next[lane].get(lane, index)!.body) as ArtifactRecord;
    cursor.nextByLane[lane] = (index + 1) % size;
    perLaneVisited[lane]++; visited++;
    let key: string;
    try { key = adminEvidenceKey(record); }
    catch (error) { fail(record, error); continue; }
    if (cursor.hasVerified(key)) continue;
    examined++;
    try {
      const [attempt, owner] = await beforeDeadline(() => Promise.all([
        input.repos.attempts.read(record.attemptId), input.repos.workItems.readNarrowed(record.workItemId, { project: true }),
      ]));
      if (!attempt || !owner || (owner.value as Pick<WorkItem, "project">).project !== "freshness") throw new Error("ATTRIBUTION_NOT_HELD");
      const held = await beforeDeadline(() => findHeldCapture(input.vaultRoot, record));
      if (!held) throw new Error("ATTRIBUTION_NOT_HELD");
      const bytes = await beforeDeadline(() => readHeldBytes(held));
      const outcome = await mirrorOriginalCapture({ record, attempt: attempt.value, held, bytes, remote });
      if (outcome === "COPIED") copied++; else alreadyVerified++;
      cursor.markVerified(key, nowMs);
    } catch (error) {
      fail(record, error);
    }
    // Persist each completed remote result before the next operation may block.
    cursor.save();
    if (expired) break;
  }
  cursor.save();
  return { state: "RAN", examined, copied, alreadyVerified, refused, failures };
  } finally { cursor.close(); }
  });
}
