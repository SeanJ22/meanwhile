/*
  Drizzle schema.

  Intentionally empty. The map entry screen reads meetings through a source
  adapter (see lib/sources/) and has no persistence yet. Tables land here when
  there is something worth persisting, and every change ships as a generated
  migration — `pnpm db:generate`, never hand-edited SQL.

  When meetings do get a table, `ocdId` is the join key. Never join on
  jurisdiction or body name strings.
*/

export {};
