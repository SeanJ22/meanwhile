"use client";

/**
 * **A RUNNER OR RESEARCH INTENT, POSTED AS JSON.** (Admin redesign,
 * 2026-09-23.)
 *
 * The pause, resume and run-now controls append an intent through
 * `/api/admin/research`, exactly as their plain forms did, with the same
 * fields (`action`, an optional `note`, `returnTo`). The difference is the
 * answer: they ask for JSON, so the route replies with a body instead of a
 * redirect built from the request URL — which on the host names the
 * deploy-permalink domain and lands the owner on a refused page. The page is
 * then refreshed from the server, so what it shows next is read back from the
 * store, never drawn from the click.
 *
 * Nothing else about the controls changed: the same actions, the same route,
 * the same append-only record; no other side effect.
 */
import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import type { ResearchIntentAction } from "@/lib/control-plane/scheduler/research-policy.ts";

export const INTENT_ROUTE = "/api/admin/research";

export function IntentButton(props: {
  readonly action: ResearchIntentAction;
  readonly label: string;
  readonly returnTo: string;
  /** Class names for the button and the words after it, so the control fits whichever page draws it. */
  readonly buttonClass: string;
  readonly okClass: string;
  readonly refusalClass: string;
  readonly noteClass?: string;
  /** An optional reason the owner may type (a pause carries one). */
  readonly note?: { readonly placeholder: string; readonly maxChars: number; readonly label: string };
}) {
  const router = useRouter();
  const noteId = useId();
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState("");
  const [said, setSaid] = useState<{ ok: boolean; says: string } | null>(null);

  function send() {
    setSaid(null);
    startTransition(async () => {
      const body = new URLSearchParams({ action: props.action, returnTo: props.returnTo });
      if (props.note && note.trim() !== "") body.set("note", note.trim());
      try {
        const res = await fetch(INTENT_ROUTE, { method: "POST", headers: { accept: "application/json" }, body });
        const out = (await res.json().catch(() => null)) as { ok?: boolean; says?: string; error?: string; detail?: string } | null;
        if (!res.ok || out?.ok !== true) {
          setSaid({ ok: false, says: `Nothing was recorded: ${out?.detail ?? out?.error ?? `the server answered ${res.status}`}.` });
          return;
        }
        setSaid({ ok: true, says: out.says ?? "Recorded." });
        router.refresh();
      } catch (e) {
        setSaid({ ok: false, says: e instanceof Error ? `Nothing was recorded: ${e.message}.` : "Nothing was recorded." });
      }
    });
  }

  return (
    <span style={{ display: "inline-flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
      {props.note && (
        <input
          id={noteId}
          type="text"
          className={props.noteClass}
          value={note}
          maxLength={props.note.maxChars}
          placeholder={props.note.placeholder}
          aria-label={props.note.label}
          disabled={pending}
          onChange={(e) => setNote(e.target.value)}
        />
      )}
      <button type="button" className={props.buttonClass} disabled={pending} onClick={send}>
        {pending ? "Recording…" : props.label}
      </button>
      {said && (
        <span className={said.ok ? props.okClass : props.refusalClass} role="status">
          {said.says}
        </span>
      )}
    </span>
  );
}
