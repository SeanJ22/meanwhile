"use client";

export const ADMIN_IDLE_MS = 5 * 60_000;
export const ADMIN_ACTIVITY_EVENT = "meanwhile:admin-activity";
let lastActivityAt = Date.now();

export function adminIsActive(): boolean {
  return document.visibilityState === "visible" && Date.now() - lastActivityAt < ADMIN_IDLE_MS;
}

/** Owned by LiveRefresh. The deadline stops work; it never polls a service. */
export function watchAdminActivity(changed: () => void): () => void {
  let deadline: ReturnType<typeof setTimeout>;
  let wasActive: boolean | null = null;
  const announce = () => {
    const active = adminIsActive();
    if (active === wasActive) return;
    wasActive = active;
    window.dispatchEvent(new Event(ADMIN_ACTIVITY_EVENT));
    changed();
  };
  const activity = () => {
    if (document.visibilityState !== "visible") return;
    lastActivityAt = Date.now();
    clearTimeout(deadline);
    deadline = setTimeout(announce, ADMIN_IDLE_MS);
    announce();
  };
  const visibility = () => {
    if (document.visibilityState === "visible") activity();
    else { clearTimeout(deadline); announce(); }
  };
  const events = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart", "scroll"] as const;
  for (const name of events) document.addEventListener(name, activity, { passive: true, capture: true });
  document.addEventListener("visibilitychange", visibility);
  visibility();
  return () => {
    clearTimeout(deadline);
    for (const name of events) document.removeEventListener(name, activity, true);
    document.removeEventListener("visibilitychange", visibility);
  };
}
