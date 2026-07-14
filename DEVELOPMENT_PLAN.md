# Biyan Development Plan

Biyan (彼岩) is a desktop AI client for configured cloud and
OpenAI-compatible providers. The supported product is remote-only: it does not
bundle local model runtimes, model catalogs, embeddings, RAG, or vector stores.

## Versioned migration

The bridge releases use cumulative forward-only data migrations:

| Release | App version | Data schema | Purpose |
| --- | --- | --- | --- |
| A | 0.6.634 | 1 | Establish the migration substrate and activate Biyan storage |
| B | 0.6.635 | 2 | Remove retired runtime payloads and finish package branding |
| C | 0.6.636 | 3 | Restrict legacy aliases to isolated ingress and migration code |

Every later release carries all earlier migration steps. Sources remain
read-only, conversion happens in staging, integrity checks run before the
atomic switch, and failures do not advance migration markers. See
`docs/src/pages/docs/desktop/data-folder.mdx` for the user-facing contract.

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
