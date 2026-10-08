# Usage: source env-run.sh <label>: env.sh, with every database URL pointed at rd_<label> / cp_<label>.
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"
export DATABASE_URL=${DATABASE_URL/\/reader\?//rd_$1?}
export WTP_PRODUCTION_DATABASE_URL_READONLY=${WTP_PRODUCTION_DATABASE_URL_READONLY/\/reader\?//rd_$1?}
export WTP_CONTROL_PLANE_DATABASE_URL=${WTP_CONTROL_PLANE_DATABASE_URL/\/controlplane\?//cp_$1?}
export WTP_CONTROL_PLANE_DATABASE_URL_READONLY=${WTP_CONTROL_PLANE_DATABASE_URL_READONLY/\/controlplane\?//cp_$1?}
