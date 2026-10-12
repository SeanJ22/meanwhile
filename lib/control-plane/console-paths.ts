/**
 * Where a console form may return to. A redirect target read off a request
 * body is validated against a closed list (the console itself), never an
 * arbitrary URL. Shared by both admin routes.
 */

export const CONSOLE_VIEWS: readonly string[] = [
  "/admin",
];

export function isConsolePath(path: string): boolean {
  return CONSOLE_VIEWS.includes(path);
}

/** The validated destination, or the fallback when the field names nothing on the console. */
export function consoleReturnPath(raw: string | null | undefined, fallback: string): string {
  const path = (raw ?? "").trim();
  return isConsolePath(path) ? path : fallback;
}
