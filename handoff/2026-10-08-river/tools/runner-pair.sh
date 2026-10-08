#!/bin/bash
# Usage: runner-pair.sh <worktree> <label>: fresh databases from the templates, run two staged runner cycles, keep logs, RSS and the byte report.
set -u
S=${SCRATCH:?set SCRATCH to your scratch directory}
W=$1; L=$2; OUT=$S/runner-$L; rm -rf $OUT; mkdir -p $OUT
$S/localprod/rundb.sh $L > $OUT/rundb.log 2>&1
for i in $(seq 1 60); do /usr/lib/postgresql/16/bin/pg_isready -h 127.0.0.1 -p 54329 -q && curl -sf http://127.0.0.1:54330/health >/dev/null && break; sleep 2; done
cd $W && rm -rf .runtime/vital-signs .runtime/control-plane/reads
cp $S/wt-16/scripts/neon-bytes-report.mts $OUT/neon-bytes-report.mts
$S/rss-sampler.sh $W $OUT/rss.log & SP=$!
date -u +%Y-%m-%dT%H:%M:%SZ > $OUT/started
( source $S/localprod/env-run.sh $L; unset WTP_ASSET_STORE WTP_WORKERS_ANTHROPIC_API_KEY ANTHROPIC_API_KEY ANTHROPIC_BASE_URL WTP_RUNTIME_MODE; export NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt; timeout 7200 node scripts/pilot-runtime-launch.mjs --cycles=${CYCLES:-2} --interval=5 > $OUT/runner.log 2>&1; echo "RUNNER exit $?" >> $OUT/runner.log )
kill $SP
echo "RUNNERPAIR $L done"
