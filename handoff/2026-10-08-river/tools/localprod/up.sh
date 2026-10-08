#!/usr/bin/env bash
# Start the local production copy: Postgres 16 on 127.0.0.1:54329 and the Neon shim on 127.0.0.1:54330.
set -euo pipefail
L="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN=/usr/lib/postgresql/16/bin
mkdir -p "$L/run"
# Postgres refuses to run as root; a user namespace maps uid 1000 inside to root outside, so the
# root-owned data dir under the private scratch path stays readable without loosening any permissions.
if ! $BIN/pg_isready -h 127.0.0.1 -p 54329 -q; then
  unshare --user --map-user=1000 --map-group=1000 $BIN/pg_ctl -D "$L/pgdata" -l "$L/run/postgres.log" -w -t 120 start >/dev/null
fi
$BIN/pg_isready -h 127.0.0.1 -p 54329
if ! curl -sf http://127.0.0.1:54330/health >/dev/null 2>&1; then
  (cd "$L/shim" && LOCALPROD_SHIM_LOG="$L/run/neon-shim.log" nohup node neon-shim.mjs >>"$L/run/neon-shim.out" 2>&1 & echo $! >"$L/run/neon-shim.pid")
  for _ in $(seq 1 50); do curl -sf http://127.0.0.1:54330/health >/dev/null 2>&1 && break; sleep 0.1; done
fi
curl -sf http://127.0.0.1:54330/health >/dev/null && echo "neon shim: http://127.0.0.1:54330 (log: $L/run/neon-shim.log)"
echo "now: source $L/env.sh"
