/** BR-04: carry legacy queued gaps into the live repair list through the ordinary gateway, once. */
import { readDecisions } from "../admin-data.ts";
import { collapseDecisionLog } from "../decision-log.ts";
import { fixQueueView } from "../fix-queue.ts";
import { markFixQueueImported } from "../fix-list.ts";
import { ADMIN_CONFIG_ID, isAdminConfig } from "./admin-config.ts";
import { submit } from "./gateway.ts";
import type { GatewayDeps } from "./registry.ts";

export async function migrateQueuedFixes(deps: GatewayDeps, at: string): Promise<void> {
  const held = await deps.repos.adminConfig.read(ADMIN_CONFIG_ID);
  if (held && isAdminConfig(held.value) && held.value.legacyFixQueueImportedAt) return;
  const decisions = await readDecisions(deps.repos);
  if (decisions.kind === "STORE_UNREACHABLE") return;
  const queue = fixQueueView(collapseDecisionLog(decisions.kind === "HELD" ? decisions.value : []));
  for (const item of queue.items) {
    if (item.state === "OPENED") continue;
    const saved = await submit({ type: "queue.add", subject: item.subjectId,
      input: { where: item.where, says: item.says }, stateVersion: null,
      idempotencyKey: `import-${item.subjectId}`.replace(/[^A-Za-z0-9_.:-]/g, "-").slice(0, 120),
      caller: "OWNER_SESSION", actorRef: "legacy-fix-queue" }, deps);
    if (!saved.ok) return;
  }
  await markFixQueueImported(deps.repos, at);
}
