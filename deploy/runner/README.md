# Linux runner

## Resume day — Sean's click and paste checklist

Use this when all sessions are finished and you choose to resume. The server
is **146.190.74.145**, $48/month. The PC-off staging check waits for you to say
you are ready; the 24-hour observation follows the production start below.

### 1. Change the server's settings privately

In Windows PowerShell, paste:

```powershell
ssh.exe -t -i "$env:USERPROFILE\.ssh\wtp-deploy" root@146.190.74.145
```

In that Linux terminal, paste `nano /etc/meanwhile/runner.env`. Edit or add the
following lines, keeping only one of each name. Copy secret values directly
into nano; never paste them into chat, GitHub, screenshots or a shell command.

| Line | Production value and where to get it |
| --- | --- |
| `WTP_RUNTIME_MODE` | `production` |
| `WTP_DB_ROLE` | `production` |
| `NODE_ENV` | `production` |
| `DATABASE_URL` | Live site's `DATABASE_URL`: Netlify → the live Meanwhile project → Project configuration → Environment variables → production value. |
| `WTP_CONTROL_PLANE_DATABASE_URL` | Same screen, production value of this exact name. This must match the live Admin database. |
| `WTP_PRODUCTION_DATABASE_URL_WRITE` | Existing approved production writer credential, under this exact name in the live settings or Sean's saved credentials. If absent, S0 must supply its private location; do not reuse a read-only URL. |
| `WTP_PRODUCTION_DATABASE_URL_READONLY` | Existing production read-only credential of this name, from the live settings or Sean's saved credentials. |
 `WTP_VAULT_PROVIDER` | Keep `netlify`. |
| `WTP_BLOBS_SITE_ID` and `NETLIFY_SITE_ID` | Live project → Project configuration → General → Project details → Project ID. Replace the staging ID `acafb24c-9803-4d0d-8f6c-8b9d21d96169` in both lines. |
| `WTP_BLOBS_TOKEN` and `NETLIFY_BLOBS_TOKEN` | A Netlify personal access token authorized for the live project: User settings → Applications → Personal access tokens. Paste the same authorized token into both lines. |

Keep the Linux paths, provider API keys and service user's GitHub sign-in.
Keep `WTP_VAULT_STORE` identical on the live Admin host and Linux (default:
`meanwhile-evidence`). In Netlify → the live project → **Site configuration →
Environment variables**, add or edit these values with **Functions** scope and
the **Production** deploy context:

| Admin host setting | Value and private source |
| --- | --- |
| `WTP_VAULT_PROVIDER` | `netlify`, matching `/etc/meanwhile/runner.env`. |
| `WTP_BLOBS_SITE_ID` | The live project's Project ID from General → Project details; use the same ID as the Linux runner. |
| `WTP_BLOBS_TOKEN` | The authorized personal access token from User settings → Applications → Personal access tokens; use the same token as the Linux runner. |
| `WTP_VAULT_STORE` | The runner's configured store name, or `meanwhile-evidence` when it is unset. |

Enter the token privately in Netlify; never include its value in a report.
Redeploy the live site after saving. Admin and the Linux runner must point to
the same production project and evidence store so an Admin send can wake the
runner. After starting the service in step 2, send an instruction in step 3
and confirm its receipt appears on the runner's next control-plane poll and
in Admin's instruction history. Give S0 a missing receipt or refusal.
Save nano with **Ctrl+O**, **Enter**, then **Ctrl+X**.

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

To recreate a staging storage destination without importing live settings:

1. In the Netlify team, choose **Add new project → Deploy manually**. Drop a
   folder containing a plain `index.html` identifying it as staging storage.
2. In Project configuration → General → Project details, set the project name
   to `meanwhile-runner-staging` and copy its **Project ID**. Record its name
   and ID in the S13 PR. Keep the live site's domain and
   settings on the live project.
3. From User settings → Applications → Personal access tokens, choose **New
   access token**, name it **Meanwhile runner staging**, choose its expiration,
   then **Generate token** and copy the value. Enter it privately on Linux using
   `ssh.exe -t -i "$env:USERPROFILE\.ssh\wtp-deploy" root@146.190.74.145 "nano /etc/meanwhile/runner.env"`.
4. Add `WTP_VAULT_PROVIDER=netlify`, `WTP_BLOBS_SITE_ID=<staging Project ID>`,
   and `WTP_BLOBS_TOKEN=<token>`. For staging reader-artifact publication and
   Admin evidence copies, also set `NETLIFY_SITE_ID` to that same staging ID
   and `NETLIFY_BLOBS_TOKEN` to that same token. Keep
   `WTP_RUNTIME_MODE=staging` and `WTP_DB_ROLE=local`.

Save the single `nano` edit with **Ctrl+O**, **Enter**, then **Ctrl+X**. Keep the
token out of GitHub and chat; post only the staging project's name and ID.

When an app deploy on the separate staging project is ready, set
`WTP_VAULT_PROVIDER=netlify` in that project's build settings and redeploy.
Existing `/officials/*` and `/candidates/*` URLs then use `/api/portraits/*` and
that project's `meanwhile-portraits` store. Hosted portrait reads use Netlify's
supplied credentials. The live project keeps
its current provider until its own production migration is authorized.

## Installed host

The approved host is `146.190.74.145`: Ubuntu 24.04, 4 vCPU, 8 GiB, $48/month.
`setup.ps1` installs current main with Node 24, pnpm, Chromium, OCR, and the
systemd unit. It leaves `meanwhile-runner.service` disabled and stopped.

From PowerShell, run `./deploy/runner/setup.ps1`. It copies only the shared
staging settings, converts Windows paths, and signs the service user into
GitHub. The host keeps secrets in `/etc/meanwhile/runner.env`; `.env.local` in
`/opt/meanwhile` is a link to that file. Keep the GitHub credential available to
the `meanwhile` user for Engineer PRs.

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
