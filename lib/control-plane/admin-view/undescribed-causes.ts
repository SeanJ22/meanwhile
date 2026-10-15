/** BR-39: unknown explanations become team repairs, with diagnostics behind the disclosure. */
import { causeOf, type StuckRowLike } from "./blocker-causes.ts";
import { addFixItem } from "../fix-list.ts";
import type { ControlPlaneRepositories } from "../repository/types.ts";
export async function recordUndescribedCauses(repos: Pick<ControlPlaneRepositories,"adminConfig">, rows: readonly StuckRowLike[], at: string): Promise<void> {
  const unknown = new Map(rows.filter(row=>causeOf(row).undescribed).map(row=>[causeOf(row).key,row]));
  for (const [key,row] of unknown) await addFixItem(repos, { where:"Admin problem descriptions", says:"Describe a problem and its next step in plain English.",
    by:"The stuck-work check",at,sourceKey:key,technical:[row.blocker??"",row.id] });
}
