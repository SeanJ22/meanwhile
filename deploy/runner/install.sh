#!/usr/bin/env bash
set -euo pipefail
# Run on an approved Ubuntu 24.04 x86-64 host. Installation leaves the runner off.
apt-get update
apt-get install -y ca-certificates curl git gh xz-utils build-essential
curl -fsSL https://deb.nodesource.com/setup_24.x -o /tmp/meanwhile-node-setup.sh
bash /tmp/meanwhile-node-setup.sh
apt-get install -y nodejs
npm install --global corepack
corepack prepare pnpm@10.33.0 --activate
id meanwhile >/dev/null 2>&1 || useradd --system --create-home --home-dir /var/lib/meanwhile --shell /bin/bash meanwhile
install -d -o meanwhile -g meanwhile -m 750 /opt/meanwhile /var/lib/meanwhile/browsers /var/lib/meanwhile/digests
install -d -o root -g meanwhile -m 750 /etc/meanwhile
if [[ ! -e /opt/meanwhile/.git ]]; then
  runuser -u meanwhile -- git clone https://github.com/SeanJ22/meanwhile.git /opt/meanwhile
fi
runuser -u meanwhile -- git config --global credential.https://github.com.helper '!gh auth git-credential'
cd /opt/meanwhile
runuser -u meanwhile -- git switch --detach origin/main
runuser -u meanwhile -- pnpm install --frozen-lockfile
PLAYWRIGHT_BROWSERS_PATH=/var/lib/meanwhile/browsers pnpm exec playwright install-deps chromium
runuser -u meanwhile -- env PLAYWRIGHT_BROWSERS_PATH=/var/lib/meanwhile/browsers pnpm exec playwright install chromium
install -o root -g root -m 644 deploy/runner/meanwhile-runner.service /etc/systemd/system/meanwhile-runner.service
ln -sfn /etc/meanwhile/runner.env /opt/meanwhile/.env.local
systemctl daemon-reload
printf '%s\n' 'Installed; service is off. Put staging settings in /etc/meanwhile/runner.env (root:meanwhile, 0640), then run the one staging pass. Production starts only after Sean resumes.'
