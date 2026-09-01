"use client";

import { useState, useSyncExternalStore } from "react";
import {
  commitStorageWrite,
  publishToListeners,
  subscribeToStorage,
} from "@/lib/state/subscribe-to-storage";

/**
 * First-run tutorial, v1 (6c, wall clock 2026-08-14 second session): a
 * skippable five-step walkthrough shown once, on the first visit after
 * the reader's zip resolves — map, who-governs, a meeting, the ballot,
 * the ask box. Skippable at EVERY step; the seen-flag is device-local
 * (`wtp.tutorial_seen`) and nothing about the walkthrough is logged or
 * transmitted. Friction check: this renders once per device, ever, and
 * every step has two ways out (Skip, ×).
 */

const STORAGE_KEY = "wtp.tutorial_seen";

const STEPS: { title: string; body: string }[] = [
  {
    title: "This is your map",
    body: "Enter a zip and upcoming local government meetings appear as pins — city councils, school boards, county boards. The governments nobody watches are the nearest ones; that's what this app is for.",
  },
  {
    title: "Who governs here",
    body: "The card on the map lists every body that governs the spot you're looking at — local first, then state, then federal — with the real people and real contact info behind each one.",
  },
  {
    title: "Meetings you can attend",
    body: "Tap a pin to see who's meeting, when, and what's on the agenda — plus how to make your voice heard there, and a one-tap add-to-calendar.",
  },
  {
    title: "What's on your ballot",
    body: "The ballot page shows everyone running near you, with a source behind every claim. We never suggest how to vote — we show what's filed and let you decide.",
  },
  {
    title: "Just ask",
    body: "The \"Who do I talk to about…?\" box routes everyday questions — a pothole, trash pickup, a noisy neighbor — to the office that actually owns the fix.",
  },
];

const listeners = new Set<() => void>();

const subscribe = (onStoreChange: () => void) =>
  subscribeToStorage(listeners, onStoreChange);

function readSeen(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    // No storage: treat as seen — never show on every visit.
    return true;
  }
}

function markSeen() {
  // Can't remember: the local override in the component still dismisses, and
  // the publish runs either way.
  commitStorageWrite(
    () => window.localStorage.setItem(STORAGE_KEY, "1"),
    () => publishToListeners(listeners),
  );
}

export function TutorialOverlay({ active }: { active: boolean }) {
  const [step, setStep] = useState(0);
  // The server snapshot says "seen", so the overlay never flashes for a
  // returning reader before hydration — the use-stored-zip pattern.
  const seen = useSyncExternalStore(subscribe, readSeen, () => true);
  // Storage-less fallback: dismissing must stick for this session even
  // when localStorage can't hold the flag.
  const [dismissed, setDismissed] = useState(false);

  if (seen || dismissed || !active) return null;

  const dismiss = () => {
    setDismissed(true);
    markSeen();
  };

  const current = STEPS[step];
  const last = step === STEPS.length - 1;

  return (
    <div
      className="pointer-events-auto fixed inset-0 z-[1300] flex items-end justify-center bg-black/30 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Quick tour"
      onClick={dismiss}
    >
      <div
        className="panel w-full max-w-sm p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <p className="font-mono text-[0.625rem] uppercase trailing-space-trimmed-20 tracking-[0.2em] text-signal">
            Quick tour · {step + 1} of {STEPS.length}
          </p>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Skip the tour"
            className="cursor-pointer p-0.5 text-muted hover:text-paper"
          >
            ✕
          </button>
        </div>
        <h2 className="mt-1.5 text-[0.9375rem] font-semibold">{current.title}</h2>
        <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-paper-dim">
          {current.body}
        </p>
        <div className="mt-3 flex items-center justify-between">
          <button
            type="button"
            onClick={dismiss}
            className="cursor-pointer text-[0.75rem] text-muted underline decoration-dotted hover:text-paper"
          >
            Skip
          </button>
          <span aria-hidden="true" className="flex gap-1">
            {STEPS.map((_, i) => (
              <span
                key={i}
                className={`h-1.5 w-1.5 rounded-full ${i === step ? "bg-[var(--signal)]" : "bg-[var(--panel-border)]"}`}
              />
            ))}
          </span>
          <button
            type="button"
            onClick={() => (last ? dismiss() : setStep(step + 1))}
            className="cursor-pointer rounded border border-[var(--panel-border)] px-3 py-1 text-[0.8125rem] text-paper hover:border-[var(--signal)]"
          >
            {last ? "Done" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}
