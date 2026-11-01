# Linux runner

## Resume day — Sean's click and paste checklist

Use this when all sessions are finished and you choose to resume. The server
is **146.190.74.145**, $48/month. The PC-off staging check waits for you to say
you are ready; the 24-hour observation follows the production start below.

### 1. Use the saved production settings

Service credentials, including database connections, Netlify access and GitHub
sign-in, live in **Admin → Settings → Keys**. The runner reads them directly
from the control-plane database. The private `/etc/meanwhile/runner.env` keeps
the existing `WTP_CONTROL_PLANE_DATABASE_URL` and `WTP_KEYS_ENCRYPTION_KEY`
bootstrap settings, plus host paths, runtime mode and project IDs. Manage saved
credentials in the Keys box.

Keep production mode, the live project's ID and the evidence store name matched
between the runner and website. Open the existing Linux connection from Windows
PowerShell to inspect the service:

```powershell
ssh.exe -t -i "$env:USERPROFILE\.ssh\wtp-deploy" root@146.190.74.145
```

### 2. Start continuous work and confirm it is running

In the same Linux terminal, paste:

```sh
systemctl enable --now meanwhile-runner.service
systemctl is-enabled meanwhile-runner.service
systemctl is-active meanwhile-runner.service
journalctl -u meanwhile-runner.service -n 60 --no-pager
journalctl -u meanwhile-runner.service -f
```

Expect `enabled`, `active`, then `pilot-runner · control plane postgres,`
with `running until stopped`, and `pilot-runner · cycle 1 started ...`.
Later cycles must finish successfully and new cycle numbers must appear;
`active` alone only means the process exists. **Ctrl+C** exits the live log
without stopping the service. If it repeatedly restarts or reports a refusal,
paste `systemctl stop meanwhile-runner.service` and give S0 the error lines
without secrets.

### 3. Make the first sends in Admin's command center

Open the live site's **/admin**, sign in as owner, and use the command center.
Choose **Now** → open **Direct work** → **Whole system · affects every state**.
Click **Set the daily budget**, type your dollar limit, review the preview,
then **Send**. This sets the rolling 24-hour Fleet ceiling. Next click **Turn
paid search on**, review the preview, then **Send**. These buttons arrive with
S11's PR #497; the runner confirms the settings when a round starts. Paid
research's resume button does not enable paid search.

For the first hunt, choose the ZIP in the place picker → **Now** → **Direct work** → **Start a
hunt here** → enter its **Lifetime limit in dollars** → **Send**. For several
ZIPs, use **Start many hunts**, review each hunt's allowance, then **Send**.
If existing paid research is paused, choose **Now** → **Direct work** → **Whole system · affects every state** →
**Resume paid research** → **Send**; if the runner itself is paused, also
choose **Let the workers start again** → **Send**. In **Work** → instruction history,
follow each send from **Queued** through **Read** / **Running** to **Done**.
Done means that instruction took effect; it does not mean a hunt is finished
or that every fact has reached readers. A refusal or failure shows its reason.

## Staging Blobs destination

The separate Netlify project is **`meanwhile-runner-staging`**, Project ID
**`acafb24c-9803-4d0d-8f6c-8b9d21d96169`**. Sean has entered its five Blobs
settings in `/etc/meanwhile/runner.env`. A `test` branch deploy or a Deploy
Preview of the live site is insufficient: `getStore` stores are shared across
all deploys of a project. The live project's `reader-artifacts` serves readers.
See [Netlify's store scope documentation](https://docs.netlify.com/build/data-and-storage/netlify-blobs/).

## Installed host

The approved host is `146.190.74.145`: Ubuntu 24.04, 4 vCPU, 8 GiB, $48/month.
`setup.ps1` installs current main with Node 24, pnpm, Chromium, OCR, and the
systemd unit. It leaves `meanwhile-runner.service` disabled and stopped.

`setup.ps1` provisions an isolated staging install. Production service
credentials are managed in the Keys box. The host's private configuration lives
in `/etc/meanwhile/runner.env`; `.env.local` in `/opt/meanwhile` links to it.

## PC-off staging run

S0 coordinates the shared staging slot on PR #457. Update the disabled Linux
checkout to current main before taking it. With the slot held, create this
transient timer on Linux, exit SSH, and shut the PC down before it fires:

```sh
systemd-run --unit=meanwhile-pc-off-staging --on-active=2m --service-type=exec --uid=meanwhile --gid=meanwhile --working-directory=/opt/meanwhile --property=UMask=0077 --property=KillMode=control-group --property=NoNewPrivileges=true --property=PrivateTmp=true --property=ProtectHome=true --property=ProtectSystem=full --property='ReadWritePaths=/opt/meanwhile /var/lib/meanwhile' /usr/bin/node --env-file=/etc/meanwhile/runner.env /opt/meanwhile/scripts/pilot-runtime-launch.mjs --cycles=1 --canary --max=0 --scout-max=0 --ids=freshness:campaign-finance:az-sos-cfs-2026#az-sos-cfs-bulk-ftp
```

After returning, read `journalctl -u meanwhile-pc-off-staging.service --no-pager`
and `systemctl show meanwhile-pc-off-staging.service -p Result -p ExecMainStatus`.
Post the output in the PR and release the staging slot. This zero-model canary
demonstrates independent Linux execution; it does not establish new civic
delivery. The continuous service remains off until every session finishes and
Sean resumes. The 24-hour observation follows that resume.
