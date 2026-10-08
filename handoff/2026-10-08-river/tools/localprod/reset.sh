#!/usr/bin/env bash
# Throw away every change made since the snapshot: stop, restore pgdata from pristine/, start.
set -euo pipefail
L="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[ -d "$L/pristine/pgdata" ] || { echo "no snapshot at $L/pristine/pgdata"; exit 1; }
"$L/down.sh"
rm -rf "$L/pgdata"
cp -a "$L/pristine/pgdata" "$L/pgdata"
: > "$L/run/neon-shim.log"
"$L/up.sh"
