"use client";
import { useState } from "react";
import type { RollbackView } from "@/lib/ops/release-rollback.ts";
import s from "./v6.module.css";

export function ReleaseRollback({ view, onSend }: { readonly view: RollbackView;
  readonly onSend: (input: { type: "release.rollback"; deployId: string; sha: string; expectedVersion: string }) => Promise<void> }) {
  const [busy,setBusy] = useState(false), [failed,setFailed] = useState(false);
  async function send(deployId: string, sha: string) {
    if (!view.version) return;
    setBusy(true);setFailed(false);
    try { await onSend({ type: "release.rollback", deployId, sha, expectedVersion: view.version }); }
    catch { setFailed(true); } finally { setBusy(false); }
  }
  return <section className={s.stack}><h3>Restore an earlier release</h3><p>{view.says}</p>
    {view.choices.map(row => <div key={row.id}><p>Release {row.sha.slice(0,7)} · {row.why}</p>
      {row.allowed && <button type="button" className={s.btn} disabled={busy || !view.version} onClick={() => void send(row.id,row.sha)}>Restore this release</button>}</div>)}
    {failed && <p role="status">The request could not be sent. Refresh before trying again.</p>}
  </section>;
}
