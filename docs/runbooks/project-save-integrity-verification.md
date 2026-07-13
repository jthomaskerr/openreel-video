# Project Save Integrity Verification

Verify a confirmed save receipt against Git and Git LFS without changing project
data, the index, worktree, refs, or LFS object store.

## Safety and inputs

Never use `vintage-tokyo` as a fixture. It is user data. Use an isolated temporary
project repository under an approved test root and stop if its identity is unclear.

Record `projectId`, `sourceModifiedAt`, `commitSha`, `treeSha`, `projectBlobSha`,
`mediaManifestDigest`, and `lfsPayloads` from the receipt:

```sh
PROJECT_REPO=/absolute/path/to/isolated-project-worktree
COMMIT_SHA=<receipt.commitSha>
TREE_SHA=<receipt.treeSha>
PROJECT_BLOB_SHA=<receipt.projectBlobSha>
MANIFEST_DIGEST=<receipt.mediaManifestDigest>
```

Do not run `git add`, `commit`, `reset`, `checkout`, `clean`, `lfs pull`, or `lfs
fetch` during verification.

## Object and path verification

Capture the baseline, then resolve receipt identities from committed objects:

```sh
git -C "$PROJECT_REPO" status --porcelain=v2
git -C "$PROJECT_REPO" rev-parse HEAD
git -C "$PROJECT_REPO" diff --cached --name-status
git -C "$PROJECT_REPO" cat-file -e "$COMMIT_SHA^{commit}"
git -C "$PROJECT_REPO" rev-parse "$COMMIT_SHA^{tree}"
git -C "$PROJECT_REPO" rev-parse "$COMMIT_SHA:project.json"
git -C "$PROJECT_REPO" show "$COMMIT_SHA:project.json" | jq -e '.id and .modifiedAt'
```

The resolved tree/blob must equal `TREE_SHA`/`PROJECT_BLOB_SHA`; JSON `id` and
`modifiedAt` must equal the receipt project/source values.

```sh
git -C "$PROJECT_REPO" diff-tree --root --no-commit-id --name-status -r "$COMMIT_SHA"
git -C "$PROJECT_REPO" diff-tree --root --no-commit-id --name-only -r "$COMMIT_SHA"
git -C "$PROJECT_REPO" diff --cached --name-status
```

Committed paths must exactly equal the transaction allowlist and commit-message
path count. The cached list must be empty. Never broaden the allowlist to excuse an
extra path.

## Manifest digest

Recompute the receipt digest from the normalized committed name/status list:

```sh
PROJECT_REPO="$PROJECT_REPO" COMMIT_SHA="$COMMIT_SHA" pnpm --filter @openreel/orchestrator exec tsx -e '
import {createHash} from "node:crypto"; import {execFileSync} from "node:child_process";
const r=process.env.PROJECT_REPO,c=process.env.COMMIT_SHA;if(!r||!c)throw Error("missing inputs");
const f=execFileSync("git",["-C",r,"diff-tree","--root","--no-commit-id","--name-status","-z","-r",c]).toString().split("\0").filter(Boolean),e=[];
for(let i=0;i<f.length;){const status=f[i++].trim(),path=f[i++];if(!path)throw Error("malformed diff");e.push({status,path:path.replaceAll("\\\\","/")});}
console.log(`sha256:${createHash("sha256").update(JSON.stringify(e),"utf8").digest("hex")}`);'
```

The output must equal `MANIFEST_DIGEST`.

## LFS payload availability

```sh
git -C "$PROJECT_REPO" lfs ls-files --long "$COMMIT_SHA"
git -C "$PROJECT_REPO" lfs fsck --objects "$COMMIT_SHA"
GIT_LFS_SKIP_SMUDGE=1 git -C "$PROJECT_REPO" show "$COMMIT_SHA:<relativePhysicalPath>"
```

Each receipt LFS entry must have the same OID/pointer size and
`local.state === "verified"` with matching actual size. A configured remote must
report `durable`. `local-only` is local evidence, not remote durability;
`upload-required`/`unreachable` remains visibly incomplete.

Repeat the three baseline commands. HEAD, cached paths, and worktree state must be
unchanged.

## Recovery paths

- Object/digest mismatch: retain the prior receipt, reload the authoritative
  snapshot/receipt, preserve evidence, and retry from that base.
- Cached/unexpected path: stop saves and repair only identified transaction residue
  through an approved recovery. Never destructively clean or broaden staging.
- Missing/invalid LFS: restore/re-upload the exact OID and size. Restore remote
  connectivity/upload when applicable, then save and verify a new receipt.
- `PROJECT_CONFLICT`: reload/merge and retry from the current base.
- `DESTRUCTIVE_CHANGE_REQUIRES_INTENT`: review deltas, explicitly confirm, and retry
  with the current base.
- `MEDIA_INCOMPLETE`: retain last-good state, prove/upload or relink every named
  original, reconcile once, and verify the new receipt.

Related: [project-save regression](../spec/regressions/project-save-regression.md),
[missing-media regression](../spec/regressions/project-save-missing-media-regression.md),
and [implementation plan](../superpowers/plans/2026-07-13-project-save-archive-integrity-and-dangling-clips.md).
