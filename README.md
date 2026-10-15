# Meanwhile

Anyone in the United States opens Meanwhile and right away understands everything government does that touches them.

- **Rules:** [docs/rulings.md](docs/rulings.md) is the only rulebook. Only Sean edits it.
- **Working guide for agents:** [CLAUDE.md](CLAUDE.md) (copied to [AGENTS.md](AGENTS.md) for Codex).

## Getting started

CI uses Node.js 24; the pnpm version is pinned in [package.json](package.json).

```bash
pnpm install --frozen-lockfile
pnpm dev        # http://localhost:3000
pnpm test
pnpm gates      # every check CI requires
```

[.env.example](.env.example) lists the settings. Never print or commit credentials, and never point a local process at the production database.

## Stack

Next.js (App Router), TypeScript and React · Tailwind · Postgres on Neon through Drizzle · Netlify · a standing runner on a server that schedules acquisition and publishing · MapLibre GL.

## Where things are

```
app/                  routes and pages
components/           UI
lib/
  sources/<name>/     one adapter per external source
  control-plane/      the runner's work, workers, Admin data
  civic-data/         acquisition, verification and publishing
  db/                 schema, migrations, queries
  ocd/                OCD-ID parsing and district resolution
scripts/              runner entry points and maintenance commands
deploy/               runner service files for the server
tests/                tests; tests/fixtures holds recorded responses, so tests make no live calls
```
