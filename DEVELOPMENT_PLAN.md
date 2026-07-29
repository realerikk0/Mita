# Biyan Development Plan

Biyan (彼岩) is a desktop AI client for configured cloud and
OpenAI-compatible providers. The supported product is remote-only: it does not
bundle local model runtimes, model catalogs, embeddings, RAG, or vector stores.

## Versioned migration

The supported release is one cumulative, forward-only terminal update:

| Release | App version | Migration phase | Data schema | Purpose |
| --- | --- | --- | --- | --- |
| Complete | 0.6.647 | C | 3 | Deliver the full Biyan source, branding, packaging, and migration closure in one update |

The former `0.6.643/A/1` → `0.6.644/B/2` → `0.6.645/C/3` train is
preserved as immutable audit and compatibility history, but it is not an
automatic rollout sequence. Do not recut A/B/C. The active `v0.6.647` tag is
bound to exact terminal product source commit
`ef963bc606366220db4589352afb25aa7d1785bf`; later control-plane commits may
qualify or distribute that source but may not change the tagged product tree.

The `v0.6.646` tag, Draft release, uploaded assets, and direct-qualification
failure remain immutable blocked-before-publication evidence. That candidate
was never published or promoted and must not be retagged, reused, or deleted.

Every later release carries all earlier migration steps. Sources remain
read-only, conversion happens in staging, integrity checks run before the
atomic switch, and failures do not advance migration markers. See
`docs/src/pages/docs/desktop/data-folder.mdx` for the user-facing contract.

`BIYAN_DATA_SCHEMA` compiles the attested terminal schema into the candidate.
Do not resurrect retired runtime source or package graphs, and do not create
artificial A/B/C checkpoints: release policy accepts only the exact reviewed
terminal source identity.

## Terminal release boundary

Cut one new complete terminal version only when product source, product
dependencies, bundled resources, or packaged product content changes. Finish
the concentrated source and artifact audit and clear every product blocker
before fixing the exact terminal source commit. Preserve all prior checkpoint
commits, refs, tags, and evidence.

Workflow-, test-, verifier-, and distribution-only changes must use an
independent control-plane pull request. They preserve the terminal product
commit and revalidate only the fail-closed impact scope selected by
protected-branch policy. If a control-plane change exposes a product blocker,
stop qualification and create a higher complete version; never retag or amend
the accepted source.

## Release invariants

- Only `BIYAN_SIGNING_KEY` is accepted for formal builds.
- Workspace packages and bundled extensions remain private.
- Release artifacts, process names, install paths, and the CLI use Biyan names.
- Stable bundle identifiers, legacy URL schemes, repository slugs, and updater
  hostnames may remain only as documented upgrade/ingress infrastructure; they
  must never surface as the product name or re-enable retired behavior.
- The updater installs the exact signed update object that was checked.
- Direct-C promotion stays fail-closed until a control-plane pull request pins
  the accepted `0.6.647` source, manifest, platform assets, and the exact
  published compatibility sources.
- Promotion is one 100% transaction gated by signed-candidate verification,
  GitHub-native upgrade evidence, a healthy report, compare-and-swap, and a
  kill switch. It does not create intermediate A or B cohorts.
- The direct qualification matrix verifies Windows and macOS
  `0.6.633 → 0.6.647`, Linux fresh `0.6.647` under the exact no-current-Linux
  exception, and all three platforms from public `0.6.643`, `0.6.644`, and
  `0.6.645` to `0.6.647`.
- Kill Switch and Health Gate pause the Router and restore both legacy updater
  origins from the exact persisted pre-update backup in one journaled
  transaction. Promotion may resume only after the active complete
  compatibility manifest is restored and read back.
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
build alone. Signed package builds, direct upgrade qualification, download
distribution, and production promotion remain release-qualification work;
they are not satisfied by source completion alone.

### Exact-SHA scoped qualification

After a complete train establishes a reusable baseline, use
`.github/workflows/biyan-exact-sha-qualification.yml` from protected
`mita-main` to qualify an exact descendant SHA against an exact base SHA. The
workflow computes its changed-file plan with the classifier stored on the
protected branch, runs focused policy and contract checks before allocating
native runners, and uses fixed GitHub-hosted x86_64 labels. It does not publish
or promote anything and does not consume a production environment or secret.

The minimum revalidation is impact-based: documentation builds only the docs;
isolated tests and CI policy run focused checks; verifier and distribution
changes must replay a hash-pinned retained artifact set; platform packaging
changes rebuild only that platform. Platform candidate-verifier changes
rebuild their affected platform rather than authenticating only a stale
filename/hash set; runtime, bundled legal/resource inputs, dependency,
migration, classifier, unknown, or unsafe changes fail closed to full native
qualification. Missing or mismatched replay evidence fails before native work
is allocated; establish fresh evidence with an explicit `bootstrap-full` run
rather than silently passing or implicitly widening the dispatch.

Every `auto` hop authenticates the exact base through the previous successful
run and hash-pinned manifest, carries the complete three-platform evidence set
forward, and replaces only rebuilt axes. Control-plane carry-forward never
claims that reused packages contain a new product version and cannot replace
the exact-tag terminal candidate build.

The first run after this workflow lands must use `bootstrap-full` against the
accepted terminal source. This scoped workflow never substitutes for the
exact-tag candidate contract: every release tag still runs `make test`, all
three signed platform builds, candidate verification, and immutable updater
packaging.
The protected branch ruleset must additionally enforce CODEOWNER review and
dismiss stale approvals for CI-control paths; a required check name alone does
not bind the result to an immutable workflow definition.
