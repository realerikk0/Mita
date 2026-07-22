# Biyan build and promotion runbook

Biyan desktop releases separate immutable candidate creation from updater
promotion. A tag build may compile, sign, checksum, and upload versioned
artifacts; it must not overwrite a stable manifest.

## Candidate build

1. Create the tag only after its exact commit is ready for release. The
   candidate workflow checks out that immutable tag and verifies its version
   and migration metadata.
2. The tag workflow itself runs `make test` (lint plus the TypeScript and Rust
   suites), the release policy scan, and updater contract tests. A prior PR or
   branch CI result is useful evidence, but it never substitutes for this gate.
3. macOS, Windows, and Linux builds all depend on the candidate quality gate;
   no signed artifact is produced if any required check fails.
4. Require `BIYAN_SIGNING_KEY`; formal builds fail if it is absent.
5. Upload artifacts under a versioned Biyan path and record SHA-256 values.
6. Attach signed candidate metadata to the GitHub release without changing the
   stable updater route.

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

## Promotion

Use `.github/workflows/promote-desktop-update.yml` only after environment
approval. Promotion requires:

- an exclusive lock and expected-current compare-and-swap;
- candidate checksum and signature verification;
- real upgrade smoke evidence for the requested source/target pair;
- rollout timing and health evidence;
- a recoverable snapshot of the previous policy and manifests.

The dynamic Biyan route returns `204` when a phase is closed, paused, outside
its cohort, or covered by the kill switch. Promotion always follows
current → A → B → C for automatic updates. Later packages retain cumulative
migrations for direct/manual installation.

The two compatibility manifests are generated from one canonical byte stream,
published together, and verified byte-identical with the same SHA-256. Existing
updater and CDN paths remain compatibility infrastructure; product names,
installer filenames, process names, and the CLI are Biyan-branded.

## Rollout gates

- A: internal/manual canary for 48 hours, then at least 7 stable days before B.
- B and C: 5% → 25% → 100%, at least 48 hours per cohort.
- C: only after B is fully deployed for at least 30 days and two stable cycles.
- Pause immediately on P0/P1, data loss, or migration failures above 0.5%.

Never downgrade an installed client. Pause routing and publish a higher
forward-recovery version that carries the same cumulative migration protocol.
