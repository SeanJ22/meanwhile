#!/bin/bash
# Usage: walk-set.sh <worktree> <label>: fresh databases from the templates, start the app, walk Admin, reader pages and Ask.
set -u
S=${SCRATCH:?set SCRATCH to your scratch directory}
W=$1; L=$2; OUT=$S/walk-$L; mkdir -p $OUT
$S/localprod/rundb.sh $L > $OUT/rundb.log 2>&1
fuser -k 3000/tcp >/dev/null 2>&1; sleep 2
cd $W; mkdir -p .scratch; cp $S/askcmp.mts $S/readercmp.mts .scratch/
KEY=$(cat $S/admin-session.key)
( source $S/localprod/env-run.sh $L; export WTP_ADMIN_SESSION_KEY=$KEY ANTHROPIC_API_KEY=$WTP_WORKERS_ANTHROPIC_API_KEY NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt; unset ANTHROPIC_BASE_URL; exec pnpm start -p 3000 > $OUT/server.log 2>&1 ) &
until curl -s -o /dev/null http://localhost:3000/; do sleep 2; done
PAGES="admin?view=now,admin?view=queue,admin?view=work,admin?view=workers,admin?view=checklist,admin?view=data,admin?view=money,admin?view=reports,admin?view=scoreboard,admin?view=settings,admin?view=changes,admin?view=chat"
( source $S/localprod/env-run.sh $L; unset NODE_OPTIONS; export WTP_ADMIN_SESSION_KEY=$KEY ADMIN_WALK_BASE=http://localhost:3000 ADMIN_WALK_OUT=$OUT/admin ADMIN_WALK_PAGES=$PAGES ADMIN_WALK_SETTLE_MS=8000; node --experimental-strip-types --import ./scripts/register-test-loader.mjs scripts/admin-walk.mts > $OUT/admin.log 2>&1; echo "ADMIN exit $?" >> $OUT/admin.log )
( source $S/localprod/env-run.sh $L; unset NODE_OPTIONS; READERCMP_OUT=$OUT/reader.json node --experimental-strip-types --import ./scripts/register-test-loader.mjs .scratch/readercmp.mts > $OUT/reader.log 2>&1; echo "READER exit $?" >> $OUT/reader.log )
[ -n "${SKIP_ASK:-}" ] || ( source $S/localprod/env-run.sh $L; unset NODE_OPTIONS; ASKCMP_OUT=$OUT/ask.json node --experimental-strip-types --import ./scripts/register-test-loader.mjs .scratch/askcmp.mts > $OUT/ask.log 2>&1; echo "ASK exit $?" >> $OUT/ask.log )
fuser -k 3000/tcp >/dev/null 2>&1
echo "WALKSET $L done"
