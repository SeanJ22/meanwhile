"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import {
  commitStorageWrite,
  publishToListeners,
  subscribeToStorage,
} from "@/lib/state/subscribe-to-storage";
import styles from "./tutorial-overlay.module.css";

// Keep the existing device-local preference: returning readers are not forced
// through a new tour. Replaying never resets the reader's map or filter choices.
const STORAGE_KEY = "wtp.tutorial_seen";

const STEPS = [
  {
    id: "ask",
    title: "Ask",
    body: "Open Ask to ask a question in your own words. You can name a government, ask about a meeting, or find who handles an everyday concern.",
  },
  {
    id: "who-governs",
    title: "Who Governs Here",
    body: "Open Who Governs Here on the map to explore the governments for the place you’re viewing. Choose a body to see the people, contact information and meeting records we hold.",
  },
  {
    id: "levels",
    title: "Local / State / Federal",
    body: "Open the menu to find the Local, State and Federal controls. Turn a level on or off to choose which meetings appear. You can keep more than one level on.",
  },
  {
    id: "boundaries",
    title: "Boundary lines",
    body: "Open the menu, then Filters. Use Show districts to turn boundary lines off or on, or expand District types to choose individual kinds. The Boundary line key explains their patterns. All types start on.",
  },
] as const;

const listeners = new Set<() => void>();
let seenWithoutStorage = false;
const INITIAL_REPLAY = { version: 0, pending: false };
let replayRequest = INITIAL_REPLAY;
const readReplay = () => replayRequest;
const serverReplay = () => INITIAL_REPLAY;
const subscribe = (onStoreChange: () => void) =>
  subscribeToStorage(listeners, onStoreChange);

function readSeen(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return seenWithoutStorage;
  }
}

function markSeen() {
  commitStorageWrite(
    () => window.localStorage.setItem(STORAGE_KEY, "1"),
    () => publishToListeners(listeners),
    () => { seenWithoutStorage = true; },
  );
}

/** Persistent replay door in the menu, outside the collapsed filter contents. */
export function TutorialReplayButton() {
  // A visible SSR button must not accept a click before its client handler
  // exists. The server snapshot keeps that tiny hydration interval explicit.
  const hydrated = useSyncExternalStore(subscribe, () => true, () => false);
  return (
    <button
      type="button"
      className={styles.replay}
      aria-label="Replay quick tour"
      disabled={!hydrated}
      onClick={() => {
        // The menu can become usable before the lazy tutorial mounts. Keep
        // this request until it is dismissed, rather than losing a DOM event.
        replayRequest = { version: replayRequest.version + 1, pending: true };
        publishToListeners(listeners);
      }}
    >
      Quick tour
    </button>
  );
}

/** A schematic of the control being taught, never an invented civic record. */
function StepPreview({ id }: { id: (typeof STEPS)[number]["id"] }) {
  return (
    <div className={styles.preview} data-preview={id} aria-hidden="true">
      {id === "ask" && (
        <div className={styles.previewAsk}>
          <span>Ask about a meeting, a school…</span><span>↗</span>
        </div>
      )}
      {id === "who-governs" && (
        <div className={styles.previewCard}>
          <strong>Who Governs Here</strong>
          <span /><span /><span />
        </div>
      )}
      {id === "levels" && (
        <div className={styles.previewLevels}>
          {["Local", "State", "Federal"].map((label) => <span key={label}>{label}</span>)}
        </div>
      )}
      {id === "boundaries" && (
        <>
          <div className={styles.previewLines}><i /><i /><i /></div>
          <div className={styles.previewSwitch}><i />Show districts</div>
        </>
      )}
    </div>
  );
}

export function TutorialOverlay({ active }: { active: boolean }) {
  const pathname = usePathname();
  const [progress, setProgress] = useState({ version: 0, step: 0 });
  const seen = useSyncExternalStore(subscribe, readSeen, () => true);
  const replay = useSyncExternalStore(subscribe, readReplay, serverReplay);
  const [dismissed, setDismissed] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const visible = active && (pathname === null || pathname === "/") && (replay.pending || (!seen && !dismissed));
  const step = progress.version === replay.version ? progress.step : 0;
  const setStep = (next: number) => setProgress({ version: replay.version, step: next });

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!visible || !dialog) return;
    const previous = document.activeElement;
    // Native modality supplies the focus trap and makes the background inert.
    dialog.showModal();
    // A first display counts as seen even if the reader reloads mid-walk.
    // Keep this displayed request open before publishing the stored flag, so
    // remembering it does not dismiss the walk that is already on screen.
    replayRequest = { ...replayRequest, pending: true };
    markSeen();
    return () => {
      dialog.close();
      // Leaving this mounted surface must not carry an unfinished request to
      // a later visit. Deliberate replay always creates its own fresh request.
      replayRequest = { ...replayRequest, pending: false };
      publishToListeners(listeners);
      if (previous instanceof HTMLElement && previous.isConnected && previous.getClientRects().length) {
        previous.focus();
      }
    };
  }, [visible]);

  useEffect(() => {
    if (visible) titleRef.current?.focus();
  }, [step, visible]);

  const dismiss = () => {
    setDismissed(true);
    replayRequest = { ...replayRequest, pending: false };
    markSeen();
  };
  const current = STEPS[step];
  const last = step === STEPS.length - 1;

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      data-tour-ready={active}
      data-tour-requested={replay.pending}
      aria-labelledby="quick-tour-title"
      aria-describedby="quick-tour-body"
      onCancel={(event) => { event.preventDefault(); dismiss(); }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dismiss();
      }}
    >
      <div className={styles.header}>
        <p className={styles.progress} aria-live="polite">Quick tour · {step + 1} of {STEPS.length}</p>
        <button type="button" className={styles.close} onClick={dismiss} aria-label="Skip the tour">×</button>
      </div>
      <div key={current.id} className={styles.step} data-tour-step={current.id}>
        <StepPreview id={current.id} />
        <h2 id="quick-tour-title" ref={titleRef} tabIndex={-1}>{current.title}</h2>
        <p id="quick-tour-body" className={styles.body}>{current.body}</p>
      </div>
      <div className={styles.footer}>
        <button type="button" className={styles.skip} onClick={dismiss}>Skip</button>
        <span className={styles.dots} aria-hidden="true">
          {STEPS.map(({ id }, index) => <span key={id} data-current={index === step} />)}
        </span>
        <div className={styles.navigation}>
          {step > 0 && <button type="button" onClick={() => setStep(step - 1)}>Back</button>}
          <button type="button" className={styles.next} onClick={() => last ? dismiss() : setStep(step + 1)}>{last ? "Done" : "Next"}</button>
        </div>
      </div>
      <p className={styles.replayHint}>Replay anytime: menu → Quick tour</p>
    </dialog>
  );
}
