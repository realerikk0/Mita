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

### Exact terminal tag cut

Before dispatch, enable and verify an active ruleset scoped to the exact
terminal tag. The ruleset must forbid tag update and deletion while allowing
creation. Do not dispatch until the exact ruleset is active.

Only manually dispatch `Desktop Release Candidate` from protected
`mita-main`. The active terminal mapping is:

| Release | Tag | Source commit | Phase/schema |
| --- | --- | --- | --- |
| Previous published | `v0.6.650` | `7c4f563ff8f0a7d7ab877330881f73db164cc613` | `C/3` |
| Active complete | `v0.6.651` | `624c979b4cac6947af19cd5fb2dbf343960503be` | `C/3` |

The retired A/B/C mappings remain immutable history, not an authorized
automatic upgrade sequence. The trusted control plane must read the active
terminal identity from the reviewed release policy and prove that the exact
source commit is an ancestor of live `mita-main`.

Terminal releases use one protected pull request with exactly two logical
commits. The first commit (`P`) contains all product changes and the three
matching version-file updates. The second commit (`Q`) changes only reviewed
release-control paths, appends the former active release to contiguous
`published-superseded` history, and binds the next active tag to the full
40-character `P` SHA. Required CI and release-policy checks run against `Q`;
CODEOWNERS records the accountable repository owner but does not require a
separate approval. Merge this PR with a merge commit so `P` remains an immutable
one-parent ancestor; never squash or rebase a terminal release PR. The branch
rules may allow merge commits for this purpose, but required status, deletion,
and non-fast-forward protections remain mandatory.

The rolling schema does not authorize arbitrary versions. Every new active
terminal must be the next patch version after the latest contiguous terminal
history entry, must attest `C/3`, and must bind one exact source commit. The
candidate workflow reads that active identity dynamically; it does not contain
a release-specific `v0.6.649` allowlist.

The `v0.6.646`, `v0.6.647`, and `v0.6.648` tags, Draft releases, uploaded assets, and failed
direct qualifications are immutable blocked-before-publication evidence.
None of these candidates was published or promoted; preserve them exactly, do not
retag or reuse them, and do not recut A/B/C. `v0.6.649` and `v0.6.650` remain
immutable published history; `v0.6.651` is the next cumulative complete release.

`tag-cut` uses only the repository `GITHUB_TOKEN`; do not provide an operator
PAT or GitHub App secret and do not directly push the tag. A missing tag is
created as the approved lightweight ref, an already exact tag is a no-op, and
any conflict fails closed. GitHub's `GITHUB_TOKEN` recursion protection means
this creation does not trigger the retired checkpoint `push.tags` workflow.

The candidate workflow creates a Draft release. Keep it Draft until the
candidate, source, artifact, and acceptance gates pass, then publish it exactly
once. That publication must produce exactly one `release.published` Release
Distribution run; do not dispatch a second non-dry-run distribution in
parallel. Use manual non-dry-run distribution only as an explicit recovery for
a failed or absent publication-triggered run.

There is no A or B dispatch. One accepted `v0.6.651/C/3` candidate is the only
product package in this release.

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

Control-plane-only descendants may carry forward accepted evidence only within
their exact classified scope. They never change the terminal product source or
substitute reused packages for the new version. The exact-tag workflow remains
responsible for building and accepting the real signed terminal candidate.

Qualification packages are unsigned, non-release evidence. The workflow has
read-only permissions, uses no GitHub environment or production secret, and
cannot create tags, releases, updater objects, distribution uploads, or Docs
production deployments. A missing artifact, an extra artifact, a hash mismatch,
an invalid commit topology, or an unrecognized path fails closed.
Its final check belongs to the protected `mita-main` dispatch run and is an
operator pre-tag gate, not a required check attached to the input target PR.

Scoped PR checks are valid only while the protected branch ruleset requires the
PR CI Gate and blocks deletion and non-fast-forward updates. CODEOWNERS records
accountability but does not create a required approval gate. GitHub
required-check names do not identify the workflow that emitted them, so the
checked-in release-policy tests must reject attempts to weaken CI-control
paths. PR test jobs keep a read-only token, disable checkout credential
persistence, and never comment with a write token.

Candidate builds, reusable formal-build templates, release distribution,
updater router deployment, upgrade smoke attestation, promotion, health gating,
and the kill switch all use the single GitHub environment
`release-distribution`. Every job that consumes `BIYAN_SIGNING_KEY` must obtain
it from that environment; do not create separate `release-build`,
`updater-production`, or `updater-smoke-approval` environments or generate a
second Biyan request-signing key.

The terminal source carries `migrationPhase=C` and `dataSchema=3`; the
candidate workflow compiles that attestation through `BIYAN_DATA_SCHEMA`.
Retired runtime source and package graphs remain forbidden. Cut a higher
complete version only after a change to product source, product dependencies,
bundled resources, or packaged product content. Clear all known product
blockers before fixing its source identity, and preserve every prior
checkpoint commit, ref, tag, and evidence record.

Workflow-, test-, verifier-, and distribution-only fixes belong in an
independent control-plane pull request. Such a fix preserves the terminal
product commit and revalidates only the fail-closed
impact scope selected by protected-branch policy. If control-plane validation
reveals a product blocker, stop qualification and cut a higher complete
version from the audited fix.

GitHub exposes Draft releases only to principals with push access. A workflow
job that snapshots accepted Draft assets therefore needs `contents: write`
even though every step in that job is read-only. Keep that authority isolated
from signing secrets and release mutation steps, and lock the job's exact
permissions and command envelope in release-policy tests.

## GitHub-native direct qualification

Run `.github/workflows/biyan-direct-qualification.yml` once from protected
`mita-main` after the exact candidate source, manifest, and installer digests
are pinned by an owner-controlled control-plane commit. The workflow performs
real installs on GitHub-hosted x86_64 runners:

- Windows and macOS: `0.6.608 → 0.6.649` as manual-installer compatibility
  only, with the retired endpoint and old public-key generation kept explicit;
- Windows and macOS: `0.6.611 → 0.6.649` as the lowest public stable
  automatic-updater path;
- Windows and macOS: `0.6.633 → 0.6.649`;
- Linux: fresh `0.6.649`, under the exact no-current-Linux-artifact exception;
- Windows, macOS, and Linux: each of public `0.6.643`, `0.6.644`, and
  `0.6.645` → `0.6.649`.

All sixteen expected attempts must pass. Windows manual-install compatibility
keeps `/D=...` as the final argument. Automatic-updater lanes exercise the
passive `/P /UPDATE /ARGS` path and its registry-owned destination; `/R` is
omitted so the runner can prove, before first launch, that the installed
`pre-install` directory contains exactly the three reviewed Biyan extension
archives and no retired payload, then launch Biyan itself. Every attempt
uploads its report, sanitized input manifest, and snapshot even on failure.
Only a successful aggregate may emit `upgrade-smoke.json` and
`rollout-health.json` as `biyan-promotion-evidence`.

The qualification accepts only exact GitHub releases and pinned asset
digests, keeps `actions: read` plus `contents: read` as its token boundary, and
writes no production updater or download object. The former two-point A
canary and its 48-hour receipt are retired evidence and are not valid for
Direct-C promotion.

## GitHub-native rolling recovery qualification

For every terminal patch after the initial Direct-C release, publish the
verified GitHub Release and let its one automatic `Release Distribution` run
finish before dispatching `.github/workflows/biyan-upgrade-smoke.yml` from
live protected `mita-main`. The workflow accepts no version or evidence URL
input. It derives the exact source from the ledger's latest
`published-superseded` entry and the exact candidate from
`activeTerminalRelease`.

The read-only preflight verifies both tags, published Releases, independently
signed `candidate.json` documents, manifests, source commits, and installer
digests. Windows, macOS, and Linux then each run one real
`source-to-recovery` install/start/migration lane with the shipped NSIS, DMG,
or AppImage package and a sanitized deterministic snapshot. Only exact 3/3
success may upload
`biyan-promotion-evidence-<run-id>-<run-attempt>`; failed and rerun attempts
cannot be mistaken for the current evidence.

This is pre-promotion laboratory health evidence, not production telemetry.
The automatic post-promotion health gate remains required. The qualification
workflow has only `actions: read` and `contents: read`; it has no production
store credential or mutation step.

## Promotion

Use `.github/workflows/promote-desktop-update.yml` only after environment
approval. Promotion requires:

- an exclusive lock and expected-current compare-and-swap;
- candidate checksum and signature verification;
- real upgrade smoke evidence for the requested source/target pair;
- rollout timing and health evidence;
- a recoverable snapshot of the previous policy and manifests.

For `RECOVERY`, promotion accepts only the exact attempt-scoped artifact from
`Biyan Upgrade Smoke`. The candidate source must be an ancestor of the smoke
head, the smoke head must be an ancestor of current live main, and the four
reviewed recovery harness files plus the rolling ledger must not drift between
those commits. The evidence source must equal `from_version` and the latest
published terminal; its candidate must equal the active signed C/schema-3
release. Dry-run the same request first, then perform one 100% compare-and-swap
transaction.

Direct-C promotion also requires the tracked transition policy to name the
exact reviewed `0.6.649` manifest SHA-256 and four-platform set. It remains
`approvedNext: null` until the signed candidate exists and passes source,
candidate, and artifact acceptance. Populate that identity through a
repository-owner-controlled control-plane pull request; this verifier-only
change does not change the terminal product source. A missing or mismatched
candidate approval in the tracked transition policy blocks qualification and
promotion before any production mutation.

The dynamic Biyan route returns `204` when a phase is closed, paused, outside
its cohort, or covered by the kill switch. The one production transaction
publishes three exact 100% Router transitions:
`0.6.643 → 0.6.649`, `0.6.644 → 0.6.649`, and
`0.6.645 → 0.6.649`. It also replaces both legacy manifests byte-identically,
so clients `0.6.609–0.6.633` receive `0.6.649` directly. `0.6.609` and
`0.6.610` were Draft releases; the lowest public stable automatic source is
`0.6.611`. The target is always
the same signed C/schema-3 manifest; no client is routed through A or B.

The two compatibility manifests are generated from one canonical byte stream,
published together, and verified byte-identical with the same SHA-256. Existing
updater and CDN paths remain compatibility infrastructure; product names,
installer filenames, process names, and the CLI are Biyan-branded.

The updater kill switch and automatic health gate use the same fail-closed
pause transaction. They require the exact pre-update compatibility backups
persisted and authenticated by Direct-C promotion, then pause the Router
policy and replace both legacy origins with those bytes. Policy
compare-and-swap, dual-cloud journals, byte readback, and CDN purge verification
are one recovery boundary; an unknown or partially applied state leaves the
journal open and blocks later promotion. Resuming does not merely clear
`paused`: the transaction must first restore the active complete compatibility
manifest to both legacy origins and verify public readback.

## Rollout gates

- Direct-C: one 100% transaction after all sixteen GitHub-native attempts,
  signed-candidate checks, dry-run transaction, and health evidence pass.
- Recovery: one 100% transaction after the exact three-platform rolling
  qualification, attempt-scoped evidence verification, signed-candidate
  checks, and dry-run transaction pass.
- Pause immediately on P0/P1, data loss, or migration failures above 0.5%.

Public stable versions `0.6.605–0.6.608` contain
`https://updates.jingxing.uk/mita/latest.json`; that hostname currently has no
DNS. They cannot automatically discover any release until its DNS/route is
restored under separately authorized `jingxing.uk` control. Do not claim an
automatic-upgrade floor below `0.6.611` without live DNS, route, and
old-private-key proof. The `0.6.608 → 0.6.649` lanes prove manual installation
compatibility only.

Never downgrade an installed client. Pause routing and publish a higher
forward-recovery version that carries the same cumulative migration protocol.
