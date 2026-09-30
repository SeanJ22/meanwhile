"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { downloadVerifiedAdminEvidence } from "./evidence-download.ts";

type CopyState = "UNREQUESTED" | "PENDING" | "AVAILABLE" | "REFUSED";
interface CopyStatus { readonly state: CopyState; readonly code: string | null;
  readonly detail: string | null; readonly updatedAt: string | null }

/** A click selects one exact saved RAW capture. No copy or download starts on render. */
export function EvidenceCopyControl({ path, byteLength }: { readonly path: string; readonly byteLength: number }) {
  const [status, setStatus] = useState<CopyStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const pending = useRef(false);
  const lastCycle = useRef<string | null>(null);

  const check = useCallback(async (requestCopy: boolean) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setProblem(null);
    try {
      const response = await fetch(requestCopy ? path : `${path}/status`, {
        method: requestCopy ? "POST" : "GET", credentials: "same-origin", cache: "no-store",
        headers: { accept: "application/json" },
      });
      const body = await response.json() as Partial<CopyStatus> & { error?: string };
      if (!["UNREQUESTED", "PENDING", "AVAILABLE", "REFUSED"].includes(body.state ?? "")) {
        throw new Error(body.error ?? "INVALID_COPY_STATUS");
      }
      setStatus({ state: body.state as CopyState, code: body.code ?? null,
        detail: body.detail ?? null, updatedAt: body.updatedAt ?? null });
      if (!response.ok && body.state !== "REFUSED") setProblem("The copy status could not be confirmed just now.");
    } catch {
      setProblem("The private-copy request or status could not be read. No download was offered.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }, [path]);

  // Recheck only after a NEW completed runner cycle while this exact request is
  // pending. The Admin shell owns the pulse; this control starts no timer/poller.
  useEffect(() => {
    if (status?.state !== "PENDING") return;
    const onPulse = (event: Event) => {
      const pulse = (event as CustomEvent<unknown>).detail as { runner?: { lastCycleFinishedAt?: unknown } } | null;
      const finished = pulse?.runner?.lastCycleFinishedAt;
      if (typeof finished !== "string" || !Number.isFinite(Date.parse(finished))) return;
      if (lastCycle.current === null) { lastCycle.current = finished; return; }
      if (lastCycle.current === finished) return;
      lastCycle.current = finished;
      void check(false);
    };
    window.addEventListener("meanwhile:admin-pulse", onPulse);
    return () => window.removeEventListener("meanwhile:admin-pulse", onPulse);
  }, [status?.state, check]);

  const download = async () => {
    if (pending.current || status?.state !== "AVAILABLE") return;
    pending.current = true;
    setBusy(true);
    setProblem(null);
    try { await downloadVerifiedAdminEvidence(path); }
    catch { setProblem("The complete original could not be verified for download. No file was offered; check the copy again."); }
    finally { pending.current = false; setBusy(false); }
  };

  return <div>
    <p>Original saved capture: {byteLength.toLocaleString("en-US")} bytes. It may include personal details from its public source.</p>
    {status?.state === "PENDING" && <p role="status">Requested. The existing runner checks this exact capture during normal operation; copying and verification are still pending.</p>}
    {status?.state === "AVAILABLE" && <p role="status">Private copy verified. Download checks every byte and the complete SHA-256 hash again.</p>}
    {status?.state === "REFUSED" && <p role="status">Private copy refused. {status.detail
      ? `Reason: ${status.detail}`
      : status.code ? `Code: ${status.code}` : "The service did not provide a reason."}</p>}
    {status?.state === "UNREQUESTED" && <p role="status">No private copy has been requested for this capture.</p>}
    {problem && <p role="alert">{problem}</p>}
    <div>
      {status?.state !== "PENDING" && status?.state !== "AVAILABLE" &&
        <button type="button" disabled={busy} onClick={() => void check(true)}>Request this exact private copy</button>}
      <button type="button" disabled={busy} onClick={() => void check(false)}>Check copy status</button>
      {status?.state === "AVAILABLE" && <button type="button" disabled={busy} onClick={() => void download()}>Download verified original</button>}
    </div>
  </div>;
}
