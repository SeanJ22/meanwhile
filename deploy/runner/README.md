# Linux runner

The approved host is `146.190.74.145`: Ubuntu 24.04, 4 vCPU, 8 GiB, $48/month.
`setup.ps1` installs current main with Node 24, pnpm, Chromium, OCR, and the
systemd unit. It leaves `meanwhile-runner.service` disabled and stopped.

From PowerShell, run `./deploy/runner/setup.ps1`. It copies only the shared
staging settings, converts Windows paths, and signs the service user into
GitHub. The host keeps secrets in `/etc/meanwhile/runner.env`; `.env.local` in
`/opt/meanwhile` is a link to that file. Keep the GitHub credential available to
the `meanwhile` user for Engineer PRs.

## Staging Blobs destination

Use a **separate Netlify project**, proposed name `meanwhile-runner-staging`.
No staging Project ID is recorded yet. Sean must create or identify this
project before entering its ID on the host. A `test` branch deploy or a Deploy
Preview of the live site is insufficient: `getStore` stores are shared across
all deploys of a project. The live project's `reader-artifacts` serves readers.
See [Netlify's store scope documentation](https://docs.netlify.com/build/data-and-storage/netlify-blobs/).

To create a storage project without importing live settings:

1. In the Netlify team, choose **Add new project → Deploy manually**. Drop a
   folder containing a plain `index.html` identifying it as staging storage.
2. In Project configuration → General → Project details, set the project name
   to `meanwhile-runner-staging` and copy its **Project ID**. Record its name
   and ID in the S13 PR before any transfer. Keep the live site's domain and
   settings on the live project.
3. From User settings → Applications → Personal access tokens, create the
   runner token. Enter it privately on Linux using
   `ssh.exe -t -i "$env:USERPROFILE\.ssh\wtp-deploy" root@146.190.74.145 "nano /etc/meanwhile/runner.env"`.
4. Add `WTP_VAULT_PROVIDER=netlify`, `WTP_BLOBS_SITE_ID=<staging Project ID>`,
   and `WTP_BLOBS_TOKEN=<token>`. For staging reader-artifact publication and
   Admin evidence copies, also set `NETLIFY_SITE_ID` to that same staging ID
   and `NETLIFY_BLOBS_TOKEN` to that same token. Keep
   `WTP_RUNTIME_MODE=staging` and `WTP_DB_ROLE=local`.

The transfer uses `meanwhile-evidence` and `meanwhile-portraits` in that staging
project. After the retained source has been uploaded and extracted into
`/var/lib/meanwhile/transfer`, run on Linux:

```sh
cd /opt/meanwhile
runuser -u meanwhile -- node --env-file=/etc/meanwhile/runner.env --experimental-strip-types scripts/pilot-runtime-transfer.mts --root=/var/lib/meanwhile/transfer
```

Keep the source originals until Sean's deletion approval. A later production
cutover must use the live project's own settings and data; a staging transfer
does not authorize that cutover.

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
