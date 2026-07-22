# Biyan Development Plan

Biyan (彼岩) is a desktop AI client for configured cloud and
OpenAI-compatible providers. The supported product is remote-only: it does not
bundle local model runtimes, model catalogs, embeddings, RAG, or vector stores.

## Versioned migration

The bridge releases use cumulative forward-only data migrations:

| Release | App version | Data schema | Purpose |
| --- | --- | --- | --- |
| A | 0.6.637 | 1 | Establish the migration substrate and activate Biyan storage |
| B | 0.6.638 | 2 | Remove retired runtime payloads and finish package branding |
| C | 0.6.639 | 3 | Restrict legacy aliases to isolated ingress and migration code |

The superseded `0.6.634` candidate failed before a GitHub Release was created;
its public tag remains immutable release evidence. Versions `0.6.635` and
`0.6.636` were never tagged. The supported replacement train starts at
`0.6.637`.

Every later release carries all earlier migration steps. Sources remain
read-only, conversion happens in staging, integrity checks run before the
atomic switch, and failures do not advance migration markers. See
`docs/src/pages/docs/desktop/data-folder.mdx` for the user-facing contract.

The A, B, and C tags share one audited remote-only source baseline. Their
immutable checkpoint commits differ only in release attestation and product
version (`biyan-release.json`, `src-tauri/tauri.conf.json`,
`src-tauri/Cargo.toml`, and `src-tauri/Cargo.lock`). `BIYAN_DATA_SCHEMA`
compiles the attested target schema into each candidate. Do not resurrect
retired runtime source or package graphs to manufacture artificial phase
diffs: release policy forbids those paths for every phase.

## Release invariants

- Only `BIYAN_SIGNING_KEY` is accepted for formal builds.
- Workspace packages and bundled extensions remain private.
- Release artifacts, process names, install paths, and the CLI use Biyan names.
- Stable bundle identifiers, legacy URL schemes, repository slugs, and updater
  hostnames may remain only as documented upgrade/ingress infrastructure; they
  must never surface as the product name or re-enable retired behavior.
- The updater installs the exact signed update object that was checked.
- Promotion is gated by health evidence, rollout timing, and a kill switch.
- User-owned retired data is deleted only after explicit confirmation.

## Phase C source closure

- Normal launch, packaging, settings, CLI, and release paths use Biyan names.
- `uk.jingxing.mita`, `mita://`, the published Flatpak ID, repository slug,
  and updater hostname remain only as tested upgrade or ingress anchors.
- Retired local-runtime payloads and product claims are excluded from release
  metadata; their user-owned data is preserved by factory reset and can be
  removed only through the inspected, token-confirmed cleanup flow.
- Exact-tag candidate builds must pass the release policy, full test suite,
  updater contracts, and platform artifact checks before signing completes.

## Verification

Run the TypeScript/Rust test suites, updater contract tests, release policy
scan, package build, and platform upgrade matrix before promotion. Production
promotion is a separate approved operation and is never performed by a tag
build alone. Signed package builds, the A/B/C upgrade matrix, observation
windows, and production promotion remain release-qualification work; they are
not satisfied by source completion alone.

### Exact-SHA scoped qualification

After a complete train establishes a reusable baseline, use
`.github/workflows/biyan-exact-sha-qualification.yml` from protected
`mita-main` to qualify an exact descendant SHA against an exact base SHA. The
workflow computes its changed-file plan with the classifier stored on the
protected branch, runs focused policy and contract checks before allocating
native runners, and uses fixed GitHub-hosted x86_64 labels. It does not publish
or promote anything and does not consume a production environment or secret.

The minimum revalidation is impact-based: documentation builds only the docs;
the exact four checkpoint files run identity/topology contracts; isolated
tests and CI policy run focused checks; verifier and distribution changes must
replay a hash-pinned retained artifact set; platform packaging changes rebuild
only that platform. Platform candidate-verifier changes rebuild their affected
platform rather than authenticating only a stale filename/hash set; runtime,
bundled legal/resource inputs, dependency, migration, classifier, unknown, or
unsafe changes fail closed to full native qualification. Missing or mismatched
replay evidence fails before native work is allocated; establish fresh
evidence with an explicit `bootstrap-full` run rather than silently passing or
implicitly widening the dispatch.

Every `auto` hop authenticates the exact base through the previous successful
run and hash-pinned manifest, carries the complete three-platform evidence set
forward, and replaces only rebuilt axes. A four-file checkpoint carry-forward
is marked `checkpoint-continuity-only`; it does not claim that reused packages
have the checkpoint's new embedded version or schema, and cannot replace the
exact-tag candidate build. Checkpoint phases may cycle from C to A only when
the target also has strictly higher SemVer precedence.

The first run after this workflow lands must use `bootstrap-full` against the
accepted C checkpoint. This scoped workflow never substitutes for the exact-tag
candidate contract: every release tag still runs `make test`, all three signed
platform builds, candidate verification, and immutable updater packaging.
The protected branch ruleset must additionally enforce CODEOWNER review and
dismiss stale approvals for CI-control paths; a required check name alone does
not bind the result to an immutable workflow definition.
