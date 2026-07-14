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
