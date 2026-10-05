#!/usr/bin/env bash
set -euo pipefail
# Run on an approved Ubuntu 24.04 x86-64 host. Installation leaves the runner off.
ref=main
env_source=
script_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
unit_source="$script_directory/meanwhile-runner.service"
while (( $# )); do
  case "$1" in
    --ref) ref="$2"; shift 2 ;;
    --env-file) env_source="$2"; shift 2 ;;
    *) printf 'Unknown install argument: %s\n' "$1" >&2; exit 2 ;;
  esac
done
# Re-running setup must never leave a previously installed runner active.
if [[ -f /etc/systemd/system/meanwhile-runner.service ]]; then
  systemctl disable --now meanwhile-runner.service
fi
apt-get update
apt-get install -y ca-certificates curl git gh xz-utils build-essential tesseract-ocr poppler-utils
curl -fsSL https://deb.nodesource.com/setup_24.x -o /tmp/meanwhile-node-setup.sh
bash /tmp/meanwhile-node-setup.sh
apt-get install -y nodejs
npm install --global corepack
corepack prepare pnpm@10.33.0 --activate
id meanwhile >/dev/null 2>&1 || useradd --system --create-home --home-dir /var/lib/meanwhile --shell /bin/bash meanwhile
install -d -o meanwhile -g meanwhile -m 750 /opt/meanwhile /var/lib/meanwhile/browsers /var/lib/meanwhile/digests
install -d -o root -g meanwhile -m 750 /etc/meanwhile
if [[ -n "$env_source" ]]; then
  install -o root -g meanwhile -m 640 "$env_source" /etc/meanwhile/runner.env
fi
# Authenticate as the service user before any private-repository operation.
if ! runuser -u meanwhile -- gh auth status --hostname github.com >/dev/null 2>&1; then
  printf '\n%s\n' 'GitHub sign-in: enter the one-time code shown below at https://github.com/login/device on your PC. Press Enter when asked; approve the sign-in in your browser.'
  runuser -u meanwhile -- env BROWSER=true gh auth login --hostname github.com --git-protocol https --web
fi
runuser -u meanwhile -- gh auth setup-git --hostname github.com
if [[ ! -e /opt/meanwhile/.git ]]; then
  runuser -u meanwhile -- git clone --filter=blob:none --no-checkout https://github.com/SeanJ22/meanwhile.git /opt/meanwhile
fi
cd /opt/meanwhile
runuser -u meanwhile -- git fetch origin "$ref"
runuser -u meanwhile -- git switch --detach FETCH_HEAD
runuser -u meanwhile -- pnpm install --frozen-lockfile
PLAYWRIGHT_BROWSERS_PATH=/var/lib/meanwhile/browsers pnpm exec playwright install-deps chromium
runuser -u meanwhile -- env PLAYWRIGHT_BROWSERS_PATH=/var/lib/meanwhile/browsers pnpm exec playwright install chromium
install -o root -g root -m 644 "$unit_source" /etc/systemd/system/meanwhile-runner.service
ln -sfn /etc/meanwhile/runner.env /opt/meanwhile/.env.local
systemctl daemon-reload
printf '\n%s\n' 'SUCCESS: staging settings copied; GitHub signed in; Node 24, pnpm and Chromium installed. Runner service is DISABLED and STOPPED.'
