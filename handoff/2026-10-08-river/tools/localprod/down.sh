#!/usr/bin/env bash
# Stop the Neon shim and the local Postgres (fast shutdown; data is kept).
set -uo pipefail
L="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$L/run/neon-shim.pid" ]; then kill "$(cat "$L/run/neon-shim.pid")" 2>/dev/null; rm -f "$L/run/neon-shim.pid"; fi
pkill -f "node neon-shim.mjs" 2>/dev/null || true
unshare --user --map-user=1000 --map-group=1000 /usr/lib/postgresql/16/bin/pg_ctl -D "$L/pgdata" -m fast -w stop 2>/dev/null || echo "postgres was not running"
