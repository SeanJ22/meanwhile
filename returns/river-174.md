# Returned: river-174

lane: river-174
owner: river-174
writer: the river-174 lane
check: GitHub CI
ready: RL-174 bf0394d869381d32e95a59f571c7a8e95b8a245b
river: 936ab7a6d7a7e55c618b443c00af9ba0533cfedd
at: 2026-11-02T22:36:52Z
state: returned
fix_subject: fix:2306c1cc
fix: River · stream/river-174 — GitHub CI failed for river-174: GitHub CI failed on release/175 (bb499bb27b640b237ddd61c8a5c18cf1b3439283).

## Failure

```
GitHub CI failed on release/175 (bb499bb27b640b237ddd61c8a5c18cf1b3439283).
2026-11-02T22:33:03.9206696Z Finished uploading artifact content to blob storage!
2026-11-02T22:33:03.9208783Z SHA256 digest of uploaded artifact zip is 109e03d12b8d49acf0ac0f4624aeaddf97b9afbb8b9a2d78a58402eb8f3097e4
2026-11-02T22:33:03.9211675Z Finalizing artifact upload
2026-11-02T22:33:04.5238766Z Artifact test-2-4bbec44758fd3b7e78cdfab69cd2f506556c9a73-1.zip successfully finalized. Artifact ID 13183574437
2026-11-02T22:33:04.5241581Z Artifact test-2-4bbec44758fd3b7e78cdfab69cd2f506556c9a73-1 has been successfully uploaded! Final size is 1658200 bytes. Artifact ID is 13183574437
2026-11-02T22:33:04.5246103Z Artifact download URL: https://github.com/SeanJ22/meanwhile/actions/runs/41534241327/artifacts/13183574437
2026-11-02T22:33:04.5504138Z Post job cleanup.
2026-11-02T22:33:04.6444719Z [command]/usr/bin/git version
2026-11-02T22:33:04.6495154Z git version 2.56.0
2026-11-02T22:33:04.6538476Z Temporarily overriding HOME='/home/runner/work/_temp/d01fc68a-ad10-4afc-8170-3699fa86c81f' before making global git config changes
2026-11-02T22:33:04.6541701Z Adding repository directory to the temporary git global config as a safe directory
2026-11-02T22:33:04.6544059Z [command]/usr/bin/git config --global --add safe.directory /home/runner/work/meanwhile/meanwhile
2026-11-02T22:33:04.6584836Z Removing SSH command configuration
2026-11-02T22:33:04.6593645Z [command]/usr/bin/git config --local --name-only --get-regexp core\.sshCommand
2026-11-02T22:33:04.6637899Z [command]/usr/bin/git submodule foreach --recursive sh -c "git config --local --name-only --get-regexp 'core\.sshCommand' && git config --local --unset-all 'core.sshCommand' || :"
2026-11-02T22:33:04.6985114Z Removing HTTP extra header
2026-11-02T22:33:04.6992260Z [command]/usr/bin/git config --local --name-only --get-regexp http\.https\:\/\/github\.com\/\.extraheader
2026-11-02T22:33:04.7036520Z [command]/usr/bin/git submodule foreach --recursive sh -c "git config --local --name-only --get-regexp 'http\.https\:\/\/github\.com\/\.extraheader' && git config --local --unset-all 'http.https://github.com/.extraheader' || :"
2026-11-02T22:33:04.7335687Z Removing includeIf entries pointing to credentials config files
2026-11-02T22:33:04.7345140Z [command]/usr/bin/git config --local --name-only --get-regexp ^includeIf\.gitdir:
2026-11-02T22:33:04.7377658Z includeif.gitdir:/home/runner/work/meanwhile/meanwhile/.git.path
2026-11-02T22:33:04.7379261Z includeif.gitdir:/home/runner/work/meanwhile/meanwhile/.git/worktrees/*.path
2026-11-02T22:33:04.7380752Z includeif.gitdir:/github/workspace/.git.path
2026-11-02T22:33:04.7381938Z includeif.gitdir:/github/workspace/.git/worktrees/*.path
2026-11-02T22:33:04.7387657Z [command]/usr/bin/git config --local --get-all includeif.gitdir:/home/runner/work/meanwhile/meanwhile/.git.path
2026-11-02T22:33:04.7415824Z /home/runner/work/_temp/git-credentials-9026dc2e-23bd-4086-a616-e0c130606ddf.config
2026-11-02T22:33:04.7449049Z [command]/usr/bin/git config --local --unset includeif.gitdir:/home/runner/work/meanwhile/meanwhile/.git.path \/home\/runner\/work\/_temp\/git\-credentials\-9026dc2e\-23bd\-4086\-a616\-e0c130606ddf\.config
2026-11-02T22:33:04.7514590Z [command]/usr/bin/git config --local --get-all includeif.gitdir:/home/runner/work/meanwhile/meanwhile/.git/worktrees/*.path
2026-11-02T22:33:04.7548702Z /home/runner/work/_temp/git-credentials-9026dc2e-23bd-4086-a616-e0c130606ddf.config
2026-11-02T22:33:04.7555949Z [command]/usr/bin/git config --local --unset includeif.gitdir:/home/runner/work/meanwhile/meanwhile/.git/worktrees/*.path \/home\/runner\/work\/_temp\/git\-credentials\-9026dc2e\-23bd\-4086\-a616\-e0c130606ddf\.config
2026-11-02T22:33:04.7616764Z [command]/usr/bin/git config --local --get-all includeif.gitdir:/github/workspace/.git.path
2026-11-02T22:33:04.7662932Z /github/runner_temp/git-credentials-9026dc2e-23bd-4086-a616-e0c130606ddf.config
2026-11-02T22:33:04.7696022Z [command]/usr/bin/git config --local --unset includeif.gitdir:/github/workspace/.git.path \/github\/runner_temp\/git\-credentials\-9026dc2e\-23bd\-4086\-a616\-e0c130606ddf\.config
2026-11-02T22:33:04.7874579Z [command]/usr/bin/git config --local --get-all includeif.gitdir:/github/workspace/.git/worktrees/*.path
2026-11-02T22:33:04.7901169Z /github/runner_temp/git-credentials-9026dc2e-23bd-4086-a616-e0c130606ddf.config
2026-11-02T22:33:04.7911280Z [command]/usr/bin/git config --local --unset includeif.gitdir:/github/workspace/.git/worktrees/*.path \/github\/runner_temp\/git\-credentials\-9026dc2e\-23bd\-4086\-a616\-e0c130606ddf\.config
2026-11-02T22:33:04.7952623Z [command]/usr/bin/git submodule foreach --recursive git config --local --show-origin --name-only --get-regexp remote.origin.url
2026-11-02T22:33:04.8261722Z Removing credentials config '/home/runner/work/_temp/git-credentials-9026dc2e-23bd-4086-a616-e0c130606ddf.config'
2026-11-02T22:33:04.8430428Z Cleaning up orphan processes
2026-11-02T22:33:04.9041171Z ##[warning]Node.js 20 is deprecated. The following actions target Node.js 20 but are being forced to run on Node.js 24: actions/cache@v4, actions/upload-artifact@v5. For more information see: https://github.blog/changelog/2025-09-19-deprecation-of-node-20-on-github-actions-runners/

Fix on your stream, run the full suite and pnpm lint on current river, and post a new READY.
```

## Repair

Fix on stream/river-174 and publish a new READY commit; River folds the new READY and clears this return when it integrates.
