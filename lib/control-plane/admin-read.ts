import { installDatabaseTransferCounter } from "../db/transfer.ts";
import { withReaderRoute } from "../db/reader-route.ts";

const SCREENS = new Set(["now", "queue", "workers", "work", "checklist", "money", "scoreboard", "reports", "data", "settings", "changes", "chat"]);

/** One attribution scope covers the route and every asynchronous database read it starts. */
export function adminRead<Q extends Request, A extends unknown[], R>(read: (request: Q, ...args: A) => R): (request: Q, ...args: A) => R {
  return (request, ...args) => {
    installDatabaseTransferCounter();
    let screen = request.headers.get("x-admin-screen");
    if (!screen || !SCREENS.has(screen)) {
      try { screen = new URL(request.headers.get("referer") ?? "").searchParams.get("view") ?? "now"; }
      catch { screen = "now"; }
    }
    if (!SCREENS.has(screen)) screen = "now";
    return withReaderRoute(`admin:${screen === "reports" ? "brief" : screen}:${new URL(request.url).pathname}`, () => read(request, ...args));
  };
}
