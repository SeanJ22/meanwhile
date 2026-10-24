/** Which binaries stay in the repository rather than the asset store: one list, read by both enforcer and guard. */

export const STAYS_IN_REPO: readonly RegExp[] = [
  // The application's own chrome and code.
  /^public\/favicon/i,
  /^public\/icons?\//i,
  /^app\//,
  /^components\//,

  // Walkthrough captures: an input people and sessions must reach.
  /^docs\/feedback\//,

  // One regenerated review file with a stable name, opened by a person.
  /^docs\/photo-review\//,

  // Documents a person opens, not collected artifacts.
  /^docs\/proposals\//,

  // Test inputs: real bytes whose properties only real bytes can demonstrate.
  /^tests\/fixtures\//,
];
