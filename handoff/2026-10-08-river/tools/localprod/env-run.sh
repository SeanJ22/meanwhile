# Usage: source env-run.sh <label>: env.sh, with every database URL pointed at rd_<label> / cp_<label>.
source /tmp/claude-0/-home-user-meanwhile/d66f8503-5066-5aa1-9543-6c62b6fc4036/scratchpad/localprod/env.sh
export DATABASE_URL=${DATABASE_URL/\/reader\?//rd_$1?}
export WTP_PRODUCTION_DATABASE_URL_READONLY=${WTP_PRODUCTION_DATABASE_URL_READONLY/\/reader\?//rd_$1?}
export WTP_CONTROL_PLANE_DATABASE_URL=${WTP_CONTROL_PLANE_DATABASE_URL/\/controlplane\?//cp_$1?}
export WTP_CONTROL_PLANE_DATABASE_URL_READONLY=${WTP_CONTROL_PLANE_DATABASE_URL_READONLY/\/controlplane\?//cp_$1?}
