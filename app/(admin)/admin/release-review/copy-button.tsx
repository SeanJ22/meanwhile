"use client";

/** A copy control for an identity string (a full SHA, a deploy id). Clipboard only; nothing else happens. */
import { useState } from "react";

export function CopyButton({ value, what }: { readonly value: string; readonly what: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <button
      type="button"
      className="copy"
      aria-label={`Copy the ${what}`}
      title={`Copy the ${what} to the clipboard`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setState("copied");
        } catch {
          setState("failed");
        }
        setTimeout(() => setState("idle"), 1500);
      }}
    >
      {state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : "Copy"}
    </button>
  );
}
