"use client";

import { applyPickChanges, contestIds, emptyPicks, parsePicksFile, PRIVATE_PICK_SECRET, type PicksFile, type StoredPick } from "./picks-file.ts";

const SLOT = "wtp.private_picks";
const EVENT = "wtp:private-picks-sync";
interface Session {
  secret: string;
  created: boolean;
  pending: Record<string, string>;
  file: PicksFile;
}
interface LocalPicks { read: () => PicksFile; replace: (file: PicksFile) => void }
let local: LocalPicks | undefined;
let running: Promise<void> | undefined;
let status = "";
let openingRead: { secret: string; response: Promise<Response | null> } | undefined;
let editVersion = 0;
const visible = () => typeof document !== "undefined" && document.visibilityState === "visible";

function session(): Session | null {
  try {
    const value = JSON.parse(localStorage.getItem(SLOT) ?? "null");
    return value && PRIVATE_PICK_SECRET.test(value.secret) && parsePicksFile(value.file) ? value : null;
  } catch { return null; }
}
function announce(message: string) {
  status = message;
  window.dispatchEvent(new Event(EVENT));
}
function persist(value: Session) {
  // A failed durable outbox write must not be reported as saved.
  localStorage.setItem(SLOT, JSON.stringify(value));
}

export const privatePicksSnapshot = () => { const saved = session(); return JSON.stringify({ secret: saved?.secret ?? null, created: saved?.created ?? false, status }); };
export function subscribePrivatePicks(callback: () => void) {
  window.addEventListener(EVENT, callback);
  window.addEventListener("storage", callback);
  return () => { window.removeEventListener(EVENT, callback); window.removeEventListener("storage", callback); };
}

/** Called synchronously with every local edit, before any network request. */
export function queuePicksSync(before: PicksFile, after: PicksFile) {
  const saved = session();
  if (!saved) return;
  const changed = contestIds(before).concat(contestIds(after)).filter(key =>
    JSON.stringify([before.picks[key], before.suppressedDerived[key], before.unsure?.[key]]) !==
    JSON.stringify([after.picks[key], after.suppressedDerived[key], after.unsure?.[key]]));
  for (const key of new Set(changed)) saved.pending[key] = crypto.randomUUID();
  saved.file = applyPickChanges(saved.file, after, changed);
  try {
    persist(saved);
    editVersion += 1;
    announce("Syncing your picks…");
    void syncPicks();
  } catch { announce("Picks could not sync. Keep this page open and try again."); }
}

async function request(saved: Pick<Session, "secret">, method = "GET", body?: unknown) {
  if (!visible()) throw new Error("sync paused while hidden");
  const response = await fetch("/api/ballot/picks", {
    method, cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer",
    headers: { authorization: `Bearer ${saved.secret}`, "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(2500),
  });
  return response;
}

async function readSaved(saved: Session) {
  if (openingRead?.secret === saved.secret) {
    const pending = openingRead.response;
    openingRead = undefined;
    const response = await pending;
    if (!response) throw new Error("sync unavailable");
    return response;
  }
  return request(saved);
}

/** Rebase the persisted outbox on the current server revision; unrelated contests never overwrite each other. */
async function exchange() {
  const saved = session();
  if (!saved || !local) return;
  const sent = { ...saved.pending };
  let response: Response;
  if (!saved.created) {
    response = await request(saved, "PUT", { file: saved.file });
    if (response.status === 409) {
      // A lost create response is safe to retry with the same random capability.
      saved.created = true;
      const current = session();
      if (current?.secret === saved.secret) persist({ ...current, created: true });
      response = await readSaved(saved);
    }
  } else response = await readSaved(saved);
  if (!response.ok) throw new Error("sync unavailable");
  let remote = await response.json() as { revision: number; file: PicksFile };
  let acknowledged = !saved.created;
  if (saved.created && Object.keys(sent).length > 0) {
    const file = applyPickChanges(remote.file, saved.file, Object.keys(sent));
    response = await request(saved, "PATCH", { revision: remote.revision, file });
    if (response.status === 409) return; // Another device won; the next exchange rebases the same outbox.
    if (!response.ok) throw new Error("sync unavailable");
    remote = await response.json();
    acknowledged = true;
  }
  const file = parsePicksFile(remote.file);
  if (!file) throw new Error("invalid saved picks");
  const current = session();
  if (!current || current.secret !== saved.secret) return;
  if (acknowledged) for (const [key, operation] of Object.entries(sent)) {
    if (current.pending[key] === operation) delete current.pending[key];
  }
  const merged = applyPickChanges(file, current.file, Object.keys(current.pending));
  persist({ ...current, created: true, file: merged });
  if (JSON.stringify(local.read()) !== JSON.stringify(merged)) local.replace(merged);
  announce(Object.keys(current.pending).length ? "Syncing your picks…" : "Your picks are saved and sync across your devices.");
}

export function syncPicks(): Promise<void> {
  if (!visible()) return Promise.resolve();
  if (running) return running;
  const startedAtEdit = editVersion;
  running = exchange().catch(() => {
    if (visible()) announce("Picks could not sync. Your changes are kept on this device.");
  }).finally(() => {
    running = undefined;
    // A tap made during an existing read/write must not wait for the next poll.
    if (editVersion !== startedAtEdit) void syncPicks();
  });
  return running;
}

export async function savePrivatePicks(derived: readonly StoredPick[] = []): Promise<void> {
  if (!local) return;
  try {
    if (!session()) {
      const secret = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
      const file = local.read();
      for (const pick of derived) if (!file.picks[pick.contestId]) file.picks[pick.contestId] = pick;
      persist({ secret, created: false, pending: Object.fromEntries(contestIds(file).map(key => [key, crypto.randomUUID()])), file });
    }
    announce("Syncing your picks…");
    await syncPicks();
  } catch { announce("Saving needs browser storage. Keep this page open and try again."); }
}

export function privatePicksLink(secret: string): string {
  const link = new URL(window.location.href);
  link.hash = `picks=${secret}`;
  return link.href;
}

/** Mounted by My picks even when the current list is empty, so a fresh device can restore it. */
export function startPicksSync(io: LocalPicks): () => void {
  local = io;
  const secret = new URLSearchParams(window.location.hash.slice(1)).get("picks");
  if (secret !== null) {
    // Remove the capability from the address bar before any later navigation.
    history.replaceState(null, "", window.location.pathname + window.location.search);
    if (PRIVATE_PICK_SECRET.test(secret)) {
      const existing = session();
      try {
        if (existing?.secret !== secret) persist({ secret, created: true, pending: {}, file: emptyPicks() });
      } catch { announce("Restoring needs browser storage. Keep your private link and try again."); return () => {}; }
      announce("Restoring your picks…");
    } else announce("This private picks link is incomplete.");
  }
  const refresh = () => { if (visible()) void syncPicks(); };
  let timer: number | undefined;
  const visibilityChanged = () => {
    clearInterval(timer);
    if (visible()) {
      refresh();
      timer = window.setInterval(refresh, 30_000);
    }
  };
  visibilityChanged();
  window.addEventListener("online", refresh);
  window.addEventListener("focus", refresh);
  document.addEventListener("visibilitychange", visibilityChanged);
  return () => {
    clearInterval(timer);
    window.removeEventListener("online", refresh);
    window.removeEventListener("focus", refresh);
    document.removeEventListener("visibilitychange", visibilityChanged);
  };
}

// Start the link read while React hydrates the ballot. Waiting for the My picks
// effect would put a complete network round trip after hydration on a new phone.
if (typeof window !== "undefined" && visible()) {
  const secret = new URLSearchParams(window.location.hash.slice(1)).get("picks");
  if (secret && PRIVATE_PICK_SECRET.test(secret)) openingRead = { secret, response: request({ secret }).catch(() => null) };
}
