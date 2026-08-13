/**
 * `predev` gate: refuse to start when port 3000 is already serving.
 *
 * Next's default is to slide to 3001, which is the worst possible behaviour
 * here. `scripts/shoot.mts` targets a fixed `http://localhost:3000`, so the new
 * server runs on 3001 while every screenshot is taken of the old one — and the
 * old one is also serving the old `public/maplibre-gl-worker.mjs`, because this
 * same `predev` step is what regenerates that bundle. The session then reviews
 * the previous build and believes it is looking at the current one.
 *
 * Runs before build-map-worker.mjs so a refusal costs nothing.
 */

import {
  PORT,
  isSelfOrDescendantOf,
  killCommand,
  pidOnPort,
  portInUse,
  readPid,
} from "./dev-server.mjs";

if (!(await portInUse())) {
  process.exit(0);
}

const occupant = pidOnPort();
const recorded = readPid();

const lines = [
  "",
  `port ${PORT} is already in use — refusing to start a second dev server.`,
  "",
];

if (occupant === null) {
  lines.push(
    `  Something is listening on ${PORT} but its pid could not be read.`,
    `  Find it with:  netstat -ano -p tcp | findstr :${PORT}`,
  );
} else {
  lines.push(`  Occupied by pid ${occupant}.`);

  // The recorded pid is the `next dev` process; the socket may be held by a
  // child of it. Matching on identity alone would report "someone else's
  // server" for this repo's own, and withhold the kill that works.
  const ours = recorded !== null && isSelfOrDescendantOf(occupant, recorded);

  if (ours) {
    lines.push(
      `  That is this repo's own dev server (.dev-server.pid records ${recorded}).`,
      "",
      "  Stop it and start again:",
      `    ${killCommand(recorded)}`,
      "    pnpm dev",
      "",
      "  Or let the handoff do it:  pnpm handoff",
    );
  } else {
    lines.push(
      recorded === null
        ? "  No .dev-server.pid, so this repo did not start it."
        : `  .dev-server.pid records ${recorded}, which is not it — that one is gone.`,
      "",
      "  If it is yours to stop:",
      `    ${killCommand(occupant)}`,
    );
  }
}

lines.push(
  "",
  "  Serving on 3001 instead is not an option: pnpm shoot targets 3000, so the",
  "  screenshots would be of the old build, with the old map worker.",
  "",
);

console.error(lines.join("\n"));
process.exit(1);
