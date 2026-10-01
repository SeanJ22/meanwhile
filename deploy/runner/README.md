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
| `WTP_VAULT_PROVIDER` | Keep `netlify`; copy the retained vault and portraits to the production destination in step 2 before starting the service. |
| `WTP_BLOBS_SITE_ID` and `NETLIFY_SITE_ID` | Live project → Project configuration → General → Project details → Project ID. Replace the staging ID `acafb24c-9803-4d0d-8f6c-8b9d21d96169` in both lines. |
| `WTP_BLOBS_TOKEN` and `NETLIFY_BLOBS_TOKEN` | A Netlify personal access token authorized for the live project: User settings → Applications → Personal access tokens. Paste the same authorized token into both lines. |

Keep the Linux paths, provider API keys and service user's GitHub sign-in.
Keep `WTP_VAULT_STORE` identical on the live Admin host and Linux (default:
`meanwhile-evidence`). In the live Netlify project's environment settings,
also set `WTP_VAULT_PROVIDER=netlify`, `WTP_BLOBS_SITE_ID` and
`WTP_BLOBS_TOKEN` to this same production destination, then redeploy so Admin
can send wake hints. A transfer to staging alone does not populate production.
Save nano with **Ctrl+O**, **Enter**, then **Ctrl+X**.

### 2. Copy the retained vault and portraits to production

Keep `meanwhile-runner.service` stopped. After saving the production settings
above, paste in the Linux terminal:

```sh
cd /opt/meanwhile
runuser -u meanwhile -- node --env-file=/etc/meanwhile/runner.env --experimental-strip-types scripts/pilot-runtime-transfer.mts --root=/var/lib/meanwhile/transfer
```

This existing, idempotent command reads `WTP_VAULT_PROVIDER`,
`WTP_BLOBS_SITE_ID`, `WTP_BLOBS_TOKEN`, and optional `WTP_VAULT_STORE`
(default `meanwhile-evidence`) from `/etc/meanwhile/runner.env`. It copies to
that project's evidence store and `meanwhile-portraits`, preserving the local
originals. Repeating it reuses matching immutable vault bodies and writes the
same retained portrait bytes. The staging copy does not populate this project.

For the retained source copied during S13.7, expect:

```text
Source vault entry could not be read: <missing key> (EvidenceStoreRefusal)
... fourteen separate missing-source lines ...
Transferred 10919 vault objects and 1066 portraits; 14 source vault entries failed. Local originals remain.
```

Those fourteen bodies are absent from the source; they remain failures for
S8 to recapture. Their exact keys are listed separately in the
[final transfer result](https://github.com/SeanJ22/meanwhile/pull/500#issuecomment-5925004517).
Exit 1 accompanies that summary while they remain missing. An exit code alone
does not show completion: destination failures stop before the final summary.
If S8 has restored bodies or added portraits, the counts change accordingly.

Run this hosted readback even when the transfer exits 1 for those sources.
It reads five retained vault samples and every retained portrait from the same
production destination and compares them with the original bytes:

```sh
runuser -u meanwhile -- node --env-file=/etc/meanwhile/runner.env --experimental-strip-types --input-type=module <<'NODE'
import assert from 'node:assert/strict';
import { getStore } from '@netlify/blobs';
import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { DurableEvidenceStore } from './lib/control-plane/evidence/durable-store.ts';
import { netlifyEvidenceStoreFromEnv } from './lib/control-plane/evidence/netlify-store.ts';
const env = process.env;
assert.equal(env.WTP_RUNTIME_MODE, 'production');
assert.equal(env.WTP_DB_ROLE, 'production');
assert.equal(env.WTP_VAULT_PROVIDER, 'netlify');
assert.ok(env.WTP_BLOBS_SITE_ID && env.WTP_BLOBS_SITE_ID !== 'acafb24c-9803-4d0d-8f6c-8b9d21d96169');
assert.equal(env.WTP_BLOBS_SITE_ID, env.NETLIFY_SITE_ID);
const root = '/var/lib/meanwhile/transfer';
const source = new DurableEvidenceStore(join(root, 'data/control-plane/vault'), { remote: null });
const remote = netlifyEvidenceStoreFromEnv();
const keys = await source.list('');
console.log(JSON.stringify({ retainedVaultEntries: keys.length, hostedVaultEntries: (await remote.list('')).length }));
let evidenceReads = 0, portraitReads = 0;
for (const i of new Set([0, Math.floor(keys.length / 4), Math.floor(keys.length / 2), Math.floor(keys.length * 3 / 4), keys.length - 1])) {
  let held;
  try { held = await source.get(keys[i]); }
  catch { console.log('Sample source unavailable; already reported by transfer'); continue; }
  assert.ok(held, 'SOURCE_SAMPLE_MISSING');
  const got = await remote.get(keys[i]);
  assert.ok(got && Buffer.from(got.bytes).equals(Buffer.from(held.bytes)), 'HOSTED_VAULT_READ_MISMATCH');
  evidenceReads++;
}
const portraits = getStore({ name: 'meanwhile-portraits', siteID: env.WTP_BLOBS_SITE_ID, token: env.WTP_BLOBS_TOKEN, consistency: 'strong' });
async function checkPortraits(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) { await checkPortraits(path); continue; }
    if (!/\.(avif|webp|png|jpe?g)$/i.test(entry.name)) continue;
    const held = await readFile(path);
    const got = await portraits.get(relative(join(root, 'public'), path), { type: 'arrayBuffer' });
    assert.ok(got && Buffer.from(got).equals(held), 'HOSTED_PORTRAIT_READ_MISMATCH');
    portraitReads++;
  }
}
for (const family of ['officials', 'candidates']) await checkPortraits(join(root, 'public', family));
console.log(JSON.stringify({ hostedEvidenceSamplesPassed: evidenceReads, hostedPortraitReadsPassed: portraitReads, originalsPreserved: true }));
NODE
```

With this retained source, the last line should be
`{"hostedEvidenceSamplesPassed":5,"hostedPortraitReadsPassed":1066,"originalsPreserved":true}`,
and readback should exit 0. The source lists 10,933 vault entries, including
the fourteen missing bodies. Hosted entry totals may include other objects;
that total is not a claim that every vault body was read back. Give S0 any
transfer or readback failure output. Keep originals until Sean's deletion approval.

### 3. Start continuous work and confirm it is running

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

### 4. Make the first sends in Admin's command center

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
   and ID in the S13 PR before any transfer. Keep the live site's domain and
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

When an app deploy on the separate staging project is ready, set
`WTP_VAULT_PROVIDER=netlify` in that project's build settings and redeploy.
Existing `/officials/*` and `/candidates/*` URLs then use `/api/portraits/*` and
that project's `meanwhile-portraits` store. Hosted portrait reads use Netlify's
supplied credentials. Do this after copying the objects. The live project keeps
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
