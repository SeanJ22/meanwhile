"use client";

import { SYNTHETIC_RUN_BODY_KEY } from "@/lib/db/run-marker";
import { getOrCreateBrowserKey } from "@/lib/state/browser-key";

import {
  MAX_BATCH_BYTES,
  MAX_EVENTS_PER_BATCH,
  type ClientEvent,
  type ClientEventType,
  storeSafeId,
  type EventBatch,
} from "./wire";

/**
 * The browser half of behavior capture. Surfaces record through `captureEvent`;
 * this batches events and sends them to `/api/events` after a short quiet
 * period, at twenty events, or when the page is hidden or closed (`sendBeacon`).
 * A batch keeps one id across retries, so a retry never double-counts; after
 * three failures it is dropped. Nothing here throws into the page.
 *
 * Sent: the returning-reader ID (random, on the device, digested by the
 * server) and the events. No name, address or cookie.
 */

const ENDPOINT = "/api/events";
const KEY_SLOT = "wtp.ask_key";
const QUIET_MS = 3_000;
const FLUSH_AT = 20;
const MAX_ATTEMPTS = 3;
/** The events a page holds before it starts dropping the oldest: a runaway page may not grow without limit. */
const MAX_QUEUED = 512;

interface Pending {
  batchId: string;
  events: ClientEvent[];
  attempts: number;
}

let queue: ClientEvent[] = [];
let pending: Pending | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let sending = false;
let hooked = false;

function randomId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function syntheticDeclaration(): string | undefined {
  const declared = (window as { __WTP_SYNTHETIC_RUN__?: unknown }).__WTP_SYNTHETIC_RUN__;
  return typeof declared === "string" ? declared : undefined;
}

function hookLifecycle() {
  if (hooked || typeof document === "undefined") return;
  hooked = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushEvents({ closing: true });
  });
  // Agenda views: a click on any link that opens an agenda, from any card. One
  // listener for the whole site rather than one per surface, so a surface added
  // later is captured without anyone remembering to wire it.
  document.addEventListener(
    "click",
    (click) => {
      const link = (click.target as Element | null)?.closest?.("a[href]");
      if (!link || !/\bagenda\b/i.test(link.textContent ?? "")) return;
      const meeting = link.closest("[data-meeting-id]")?.getAttribute("data-meeting-id");
      captureEvent({
        type: "AGENDA_VIEW",
        ...(meeting ? { cardId: `MEETING:${meeting}`, cardKind: "MEETING" } : {}),
      });
    },
    { capture: true },
  );
  window.addEventListener("pagehide", () => flushEvents({ closing: true }));
}

/** Record one thing the reader did. Never throws; never blocks. */
export function captureEvent(event: Omit<ClientEvent, "id" | "occurredAt"> & { type: ClientEventType }): void {
  try {
    if (typeof window === "undefined") return;
    hookLifecycle();
    // The same alphabet and length the store enforces, so a card title with a space in it can never get a whole batch refused.
    const capped = event.cardId !== undefined ? { ...event, cardId: storeSafeId(event.cardId) } : event;
    queue.push({ ...capped, id: randomId(), occurredAt: new Date().toISOString() });
    if (queue.length > MAX_QUEUED) queue = queue.slice(queue.length - MAX_QUEUED);
    if (queue.length >= FLUSH_AT) {
      flushEvents();
      return;
    }
    if (timer === null) timer = setTimeout(() => flushEvents(), QUIET_MS);
  } catch {
    /* never the reader's problem */
  }
}

function buildBatch(): Pending | null {
  if (pending !== null) return pending;
  if (queue.length === 0) return null;
  const events = queue.splice(0, MAX_EVENTS_PER_BATCH);
  pending = { batchId: randomId(), events, attempts: 0 };
  return pending;
}

/** Send what is waiting. `closing` uses a beacon, which survives the page going away. */
export function flushEvents(options: { closing?: boolean } = {}): void {
  try {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (sending && !options.closing) return;
    const batch = buildBatch();
    if (batch === null) return;

    const body: EventBatch & { [SYNTHETIC_RUN_BODY_KEY]?: string } = {
      batchId: batch.batchId,
      continuityKey: getOrCreateBrowserKey(KEY_SLOT),
      events: batch.events,
    };
    const declared = syntheticDeclaration();
    if (declared !== undefined) body[SYNTHETIC_RUN_BODY_KEY] = declared;
    const json = JSON.stringify(body);
    if (json.length > MAX_BATCH_BYTES) {
      // Cannot happen at 128 events of this shape; drop rather than send what the server will refuse.
      pending = null;
      return;
    }

    if (options.closing && typeof navigator !== "undefined" && navigator.sendBeacon) {
      // A beacon has no response to read; the batch id makes a later resend harmless.
      if (navigator.sendBeacon(ENDPOINT, new Blob([json], { type: "application/json" }))) pending = null;
      return;
    }

    batch.attempts += 1;
    sending = true;
    void fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: json,
      keepalive: true,
    })
      .then((response) => {
        // 2xx counted it; 4xx will never be accepted, so it is dropped too.
        if (response.ok || (response.status >= 400 && response.status < 500)) pending = null;
        else if (batch.attempts >= MAX_ATTEMPTS) pending = null;
      })
      .catch(() => {
        if (batch.attempts >= MAX_ATTEMPTS) pending = null;
      })
      .finally(() => {
        sending = false;
        if (pending !== null || queue.length > 0) timer ??= setTimeout(() => flushEvents(), QUIET_MS);
      });
  } catch {
    /* never the reader's problem */
  }
}

/** Test seam: forget everything held in memory. */
export function resetEventClientForTests(): void {
  queue = [];
  pending = null;
  sending = false;
  if (timer !== null) clearTimeout(timer);
  timer = null;
}
