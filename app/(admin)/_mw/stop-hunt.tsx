"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import s from "./mw.module.css";

/** Uses the existing scope-removal receipt; it never deletes work or accounting. */
export function StopHunt({ scopeKey, label, returnTo }: { scopeKey: string; label: string; returnTo: string }) {
  const router = useRouter();
  const [state, setState] = useState<"IDLE" | "SENDING" | "SAVED" | "FAILED">("IDLE");
  const [detail, setDetail] = useState("");

  async function stop() {
    if (state === "SENDING" || state === "SAVED") return;
    if (!window.confirm(`Stop prioritizing ${label} and end its hunt budget? Work and spending history will be kept.`)) return;
    setState("SENDING");
    try {
      const response = await fetch("/api/admin/action", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          type: "expansion.scope.remove",
          subject: scopeKey,
          input: { key: scopeKey },
          idempotencyKey: `scope-stop:${scopeKey}:${crypto.randomUUID()}`,
          returnTo,
        }),
      });
      const body = (await response.json().catch(() => null)) as { receipt?: { outcome?: string; says?: string } } | null;
      if (!response.ok || !body?.receipt || body.receipt.outcome === "REFUSED") {
        setState("FAILED");
        setDetail(body?.receipt?.says ?? `Stop was not saved (${response.status}).`);
        return;
      }
      setState("SAVED");
      setDetail("Stop saved. The runner will remove this hunt from priority and paid admission at its next safe cycle boundary. Existing work and spending history remain.");
      router.refresh();
    } catch {
      setState("FAILED");
      setDetail("Stop could not be saved. Try again; the hunt was not changed.");
    }
  }

  return (
    <div className={s.stack8}>
      <button type="button" className={s.btnSecondary} disabled={state === "SENDING" || state === "SAVED"} onClick={() => void stop()}>
        {state === "SENDING" ? "Saving stop…" : state === "SAVED" ? "Stop saved" : "Stop this hunt"}
      </button>
      <p className={s.note}>Stops new hunt work and paid admission after the current cycle. It keeps existing work, published results and spending history.</p>
      {detail && <p className={state === "FAILED" ? s.goldNote : s.note} role="status">{detail}</p>}
    </div>
  );
}
