"use client";

import { useEffect, useRef, useState } from "react";
import s from "./mw.module.css";

type CopyStatus = {
  state: "UNREQUESTED" | "PENDING" | "AVAILABLE" | "REFUSED";
  detail?: string;
  updatedAt?: string;
};

/** A click requests only an exact held capture. Availability comes from the
 * authenticated byte-verifying endpoint, never from the request receipt. */
export function EvidenceCaptureControl(props: {
  workItemId: string; attemptId: string; artifactId: string;
}) {
  const path = `/api/admin/evidence/${encodeURIComponent(props.workItemId)}/${encodeURIComponent(props.attemptId)}/${encodeURIComponent(props.artifactId)}`;
  const [status, setStatus] = useState<CopyStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);
  const current = useRef<AbortController | null>(null);
  const started = useRef<number | null>(null);
  const attempted = useRef(false);

  useEffect(() => () => { current.current?.abort(); current.current = null; }, []);
  useEffect(() => {
    if (status?.state !== "PENDING") return;
    const timer = setTimeout(() => { void read(false); }, 1_000);
    return () => clearTimeout(timer);
    // One outstanding read, scheduled after the previous response.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  async function read(request: boolean) {
    if (current.current) return;
    const controller = new AbortController();
    current.current = controller;
    if (started.current === null) started.current = performance.now();
    setBusy(true);
    setProblem(null);
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const delayed = setTimeout(() => setSlow(true), Math.max(0, 3_000 - (performance.now() - started.current)));
    try {
      // A lost POST response is ambiguous. The next click reads its durable
      // status rather than claiming that nothing was recorded.
      if (request) attempted.current = true;
      const response = await fetch(request ? path : `${path}/status`, {
        method: request ? "POST" : "GET", cache: "no-store", credentials: "same-origin",
        headers: { accept: "application/json" }, signal: controller.signal,
      });
      const result: unknown = await response.json();
      if (!result || typeof result !== "object" || !("state" in result) ||
        !["UNREQUESTED", "PENDING", "AVAILABLE", "REFUSED"].includes(String(result.state)) ||
        (!response.ok && !(response.status === 409 && result.state === "REFUSED"))) {
        throw new Error("unconfirmed status");
      }
      const value = result as CopyStatus;
      setStatus({ state: value.state, detail: typeof value.detail === "string" ? value.detail : undefined,
        updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : undefined });
      if (value.state === "UNREQUESTED") attempted.current = false;
    } catch {
      if (controller.signal.aborted && current.current !== controller) return;
      setProblem("The copy status could not be confirmed. Your request may already be saved. Check again to read its recorded status.");
      // Stop automatic polling after a failed read; preserve any earlier
      // receipt, but do not keep showing an earlier AVAILABLE as current.
      setStatus(null);
    } finally {
      clearTimeout(timeout);
      clearTimeout(delayed);
      if (current.current === controller) current.current = null;
      setBusy(false);
    }
  }

  return <div className={s.stack8} style={{ overflowWrap: "anywhere" }}>
    {status?.state === "AVAILABLE"
      ? <a className={s.btnLink} href={path}>Download verified original</a>
      : <button type="button" className={s.btnLink} disabled={busy || status?.state === "PENDING"}
          onClick={() => { void read(!attempted.current); }}>
          {busy ? "Checking saved capture…" : status?.state === "PENDING" ? "Private copy pending" : attempted.current ? "Check copy status" : "Open saved capture"}
        </button>}
    <span className={`${s.note} ${s.cText}`} role="status" aria-live="polite">
      {problem ?? (status?.state === "AVAILABLE" ? "The private copy has been verified. The download checks the saved bytes again."
        : status?.state === "REFUSED" ? `The original is unavailable through this download. ${status.detail ?? "The recorded copy did not pass its access checks."}`
          : status?.state === "PENDING" ? `The request is saved; the original is not available yet. ${status.detail ?? "The runner must copy and verify the held bytes."}`
            : status?.state === "UNREQUESTED" ? "No copy request is recorded. Choose Open saved capture to request one."
              : "Opens the held original after its private copy is verified.")}
      {slow && status?.state !== "AVAILABLE" && " This has taken more than three seconds; access is delayed."}
    </span>
    {status?.updatedAt && Number.isFinite(Date.parse(status.updatedAt)) && <span className={`${s.note} ${s.cText}`}>
      Status recorded {new Date(status.updatedAt).toLocaleString("en-US", { timeZone: "America/Phoenix", timeZoneName: "short" })}.
    </span>}
  </div>;
}
