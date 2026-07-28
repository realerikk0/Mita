# Biyan build and promotion runbook

Biyan desktop releases separate immutable candidate creation from updater
promotion. A tag build may compile, sign, checksum, and upload versioned
artifacts; it must not overwrite a stable manifest.

## Candidate build

1. Dispatch the candidate workflow only from protected `mita-main` after its
   exact checkpoint commit is ready for release. Its `tag-cut` job creates or
   verifies the immutable lightweight tag before the candidate checks out and
   verifies that tag's version and migration metadata.
2. The candidate workflow itself runs `make test` (lint plus the TypeScript and Rust
   suites), the release policy scan, and updater contract tests. A prior PR or
   branch CI result is useful evidence, but it never substitutes for this gate.
3. macOS, Windows, and Linux builds all depend on the candidate quality gate;
   no signed artifact is produced if any required check fails.
4. Require `BIYAN_SIGNING_KEY`; formal builds fail if it is absent.
5. Upload artifacts under a versioned Biyan path and record SHA-256 values.
6. Attach signed candidate metadata to the GitHub release without changing the
   stable updater route.

### Exact tag cut and sequential dispatch

Before each A, B, or C dispatch, enable and verify an active ruleset scoped to
that phase's exact tag. The ruleset must forbid tag update and deletion while
allowing creation. Do not dispatch until the exact ruleset is active; in
particular, activate the B and C rulesets before their respective stages.

Only manually dispatch `Desktop Release Candidate` from protected
`mita-main`. The workflow accepts exactly these mappings:

| Stage | Tag        | Source commit                              |
| ----- | ---------- | ------------------------------------------ |
| A     | `v0.6.643` | `38e6d9290a8b9b0f152ff2a7eefb550e6ead7df5` |
| B     | `v0.6.644` | `d58f4e9141ee9dfc985171d13c993103dd763b01` |
| C     | `v0.6.645` | `a79c715a61057d7b78b440d90e3419dfc7e55d12` |

`tag-cut` uses only the repository `GITHUB_TOKEN`; do not provide an operator
PAT or GitHub App secret and do not directly push the tag. A missing tag is
created as the approved lightweight ref, an already exact tag is a no-op, and
any conflict fails closed. GitHub's `GITHUB_TOKEN` recursion protection means
this creation does not trigger the retired checkpoint `push.tags` workflow.

The candidate workflow creates a Draft release. Keep it Draft until the stage's
candidate, source, artifact, and acceptance gates pass, then publish it exactly
once. That publication must produce exactly one `release.published` Release
Distribution run; do not dispatch a second non-dry-run distribution in
parallel. Use manual non-dry-run distribution only as an explicit recovery for
a failed or absent publication-triggered run.

Complete and accept A before dispatching B, and complete and accept B before
dispatching C. The rollout timing and health gates below still apply between
promotion stages.

## Pre-tag exact-SHA qualification

Use `Biyan Exact-SHA Qualification` only as a pre-tag revalidation gate. It is
manually dispatched from protected `mita-main` with an exact base commit and an
exact descendant target commit. The trusted workflow validates both commits,
computes a fail-closed impact plan, and finishes its focused preflight before
starting any native x86_64 work. The fixed standard runner labels are
`ubuntu-24.04`, `windows-2022`, and `macos-15-intel`; each job records the
GitHub image and toolchain provenance.

An `auto` run takes the union of the gates required by every changed path.
Documentation and isolated test changes do not trigger desktop cold builds.
Every `auto` run must authenticate its exact base with the prior successful run
ID, source commits, and qualification-manifest SHA-256. The aggregate inherits
that complete three-platform set, replaces only rebuilt platform axes, and
emits a new hash-pinned manifest for the next hop. Platform packaging changes
build that platform. A platform candidate-verifier change also rebuilds its
affected platform so the new verifier sees a fresh real package. Runtime,
bundled legal/resource inputs, dependency, migration, classifier, unknown, or
unsafe changes run full native qualification. Use `bootstrap-full` for the
initial C baseline and whenever the trusted classifier or runner baseline
changes; missing replay evidence fails before native allocation.

A four-file A/B/C checkpoint may carry forward build artifacts only as explicit
`checkpoint-continuity-only` evidence: their embedded version/schema still
belong to the artifact-source commit, not the new checkpoint. It is never a
candidate package for the new version. The exact-tag workflow remains
responsible for building and accepting each checkpoint's real signed candidate.
Every accepted checkpoint transition must also advance to a strictly higher
SemVer precedence; repository phase adjacency never authorizes a downgrade.

Qualification packages are unsigned, non-release evidence. The workflow has
read-only permissions, uses no GitHub environment or production secret, and
cannot create tags, releases, updater objects, distribution uploads, or Docs
production deployments. A missing artifact, an extra artifact, a hash mismatch,
an invalid commit topology, or an unrecognized path fails closed.
Its final check belongs to the protected `mita-main` dispatch run and is an
operator pre-tag gate, not a required check attached to the input target PR.

Scoped PR checks are valid only while the protected branch ruleset requires
CODEOWNER review for CI-control paths and dismisses stale approvals after a
push. GitHub required-check names do not identify the workflow that emitted
them, so checked-in policy tests are defense in depth rather than a substitute
for that repository rule. PR test jobs keep a read-only token, disable checkout
credential persistence, and never comment with a write token.

Candidate builds, reusable formal-build templates, release distribution,
updater router deployment, upgrade smoke attestation, promotion, health gating,
and the kill switch all use the single GitHub environment
`release-distribution`. Every job that consumes `BIYAN_SIGNING_KEY` must obtain
it from that environment; do not create separate `release-build`,
`updater-production`, or `updater-smoke-approval` environments or generate a
second Biyan request-signing key.

The initial A/B/C tag commits are deliberately thin checkpoints over the same
reviewed remote-only source baseline. Only the release attestation and product
version files change between them; the candidate workflow compiles the
attested `dataSchema` through `BIYAN_DATA_SCHEMA`. Retired runtime source and
package graphs remain forbidden in every phase rather than being restored in
earlier checkpoints.

The authoritative active closure train is `0.6.643/A/1` →
`0.6.644/B/2` → `0.6.645/C/3`. Cut one replacement Shared → A → B → C
train only after a change to product source, product dependencies, bundled
resources, or packaged product content. Clear all known product blockers first
and keep Shared/C on the same audited source tree; preserve every prior
checkpoint commit, ref, and evidence record.

Workflow-, test-, verifier-, and distribution-only fixes belong in an
independent control-plane pull request. Such a fix preserves the existing
checkpoints, never recuts the train, and revalidates only the fail-closed
impact scope selected by protected-branch policy. If control-plane validation
reveals a product blocker, stop qualification and wait for the audited product
fix before cutting the single required replacement train.

GitHub exposes Draft releases only to principals with push access. A workflow
job that snapshots accepted Draft assets therefore needs `contents: write`
even though every step in that job is read-only. Keep that authority isolated
from signing secrets and release mutation steps, and lock the job's exact
permissions and command envelope in release-policy tests.

## GitHub-native A canary

Run `.github/workflows/biyan-a-canary.yml` twice from protected `mita-main`.
The `start` run executes one GitHub-hosted x86_64 attempt on each platform and
uploads only GitHub Actions artifacts; it does not write updater policy,
manifests, evidence, or any other object to either distribution cloud.
Windows and macOS run the exact `current-to-a` upgrade. The accepted current
release has no production Linux artifact, so Linux may run only the exact
`fresh-a` compatibility exception recorded in
`scripts/updater/a-canary-policy.json`; fabricating a Linux current installer
or widening that exception fails closed.

The later `finish` run repeats the same matrix and binds both points to their
exact workflow runs, attempts, harness tree, reports, and Actions artifact API
receipts. The observation starts at the latest `artifact.created_at` among the
three start platform artifacts and completes at the latest
`artifact.created_at` among the three finish platform artifacts. The interval
must be at least 48 hours; workflow dispatch time, runner-local clocks, and
operator-entered counters cannot shorten it. Only a valid finish aggregate may
publish the content-addressed `upgrade-smoke.json` and
`rollout-health.json` evidence objects. Those objects are immutable and must
read back byte-identically from both distribution clouds. A start run never
publishes them and cannot be used as promotion evidence.

The canary accepts only already-published, non-prerelease GitHub releases and
keeps `actions: read` plus `contents: read` as its exact token boundary. The
canary, Health Gate, and Kill Switch retain an exact reviewed job set and
whole-workflow execution-envelope digest in release-policy tests; changing a
runner, cloud writer, shared pause runner, evidence command, permission,
environment, or job requires an explicit CODEOWNER-reviewed contract update.

## Promotion

Use `.github/workflows/promote-desktop-update.yml` only after environment
approval. Promotion requires:

- an exclusive lock and expected-current compare-and-swap;
- candidate checksum and signature verification;
- real upgrade smoke evidence for the requested source/target pair;
- rollout timing and health evidence;
- a recoverable snapshot of the previous policy and manifests.

The initial A bridge also requires
`scripts/updater/legacy-a-transition-policy.json` to name the exact reviewed
`0.6.643` manifest SHA-256 and four-platform set. It intentionally remains
`approvedNext: null` until the signed A candidate exists and passes source,
candidate, and artifact acceptance. Populate that one hash through a
CODEOWNER-reviewed control-plane pull request; this verifier-only change does
not recut A/B/C. A missing or mismatched approval blocks promotion before any
production mutation.

The dynamic Biyan route returns `204` when a phase is closed, paused, outside
its cohort, or covered by the kill switch. Promotion always follows
current → A → B → C for automatic updates. Later packages retain cumulative
migrations for direct/manual installation.

The two compatibility manifests are generated from one canonical byte stream,
published together, and verified byte-identical with the same SHA-256. Existing
updater and CDN paths remain compatibility infrastructure; product names,
installer filenames, process names, and the CLI are Biyan-branded.

The updater kill switch and automatic health gate use the same fail-closed
pause transaction. They require the exact pre-A compatibility backups already
persisted and authenticated by the initial A promotion, then pause the Router
policy and replace both legacy origins with those bytes. Policy
compare-and-swap, dual-cloud journals, byte readback, and CDN purge verification
are one recovery boundary; an unknown or partially applied state leaves the
journal open and blocks later promotion. Resuming does not merely clear
`paused`: the transaction must first restore the active A compatibility
manifest to both legacy origins and verify public readback. B or C promotion
cannot bypass that recovery step.

## Rollout gates

- A: internal/manual canary for 48 hours, then at least 7 stable days before B.
- B and C: 5% → 25% → 100%, at least 48 hours per cohort.
- C: only after B is fully deployed for at least 30 days and two stable cycles.
- Pause immediately on P0/P1, data loss, or migration failures above 0.5%.

Never downgrade an installed client. Pause routing and publish a higher
forward-recovery version that carries the same cumulative migration protocol.
