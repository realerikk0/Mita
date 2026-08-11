# Biyan Development Plan

Biyan (彼岩) is a desktop AI client for configured cloud and
OpenAI-compatible providers. The supported product is remote-only: it does not
bundle local model runtimes, model catalogs, embeddings, RAG, or vector stores.

## Versioned migration

The supported release is one cumulative, forward-only terminal update:

| Release | App version | Migration phase | Data schema | Purpose |
| --- | --- | --- | --- | --- |
| Previous published | 0.6.650 | C | 3 | Add Seedance video generation and the improved provider/model experience |
| Active complete | 0.6.651 | C | 3 | Improve resilient video generation, task recovery, and direct downloads |

The former `0.6.643/A/1` → `0.6.644/B/2` → `0.6.645/C/3` train is
preserved as immutable audit and compatibility history, but it is not an
automatic rollout sequence. Do not recut A/B/C. Published `v0.6.650` remains
bound to `7c4f563ff8f0a7d7ab877330881f73db164cc613`. The active `v0.6.651`
terminal is bound to exact product source commit
`624c979b4cac6947af19cd5fb2dbf343960503be`; later control-plane commits may
qualify or distribute that source but may not change the tagged product tree.

The `v0.6.646`, `v0.6.647`, and `v0.6.648` tags, Draft releases, uploaded assets, and
direct-qualification failures remain immutable blocked-before-publication
evidence. None of these candidates was published or promoted; they must not be
retagged, reused, or deleted.

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

Prepare a terminal release in one protected pull request with two commits:
`P` contains product changes plus the three synchronized version files, and
`Q` contains only reviewed release-control changes that bind the new active tag
to the exact `P` SHA. Merge the PR with a merge commit after required CI and
release-policy checks pass. CODEOWNERS identifies the accountable repository
owner but does not impose an approval gate. This preserves `P` as a one-parent
ancestor while keeping the release operation atomic from the owner's
perspective. Never squash, rebase, amend, or retag a terminal release PR.

The release-train policy is a rolling terminal ledger rather than a
version-specific allowlist. `Q` appends the former active release as
`published-superseded`, requires the next active release to be the immediately
following semantic patch, and keeps all terminal entries at `C/3`. Ordinary
workflow-, test-, verifier-, and distribution-only changes after the release
remain independent control-plane changes and must not alter the bound product
source.

## Release invariants

- Only `BIYAN_SIGNING_KEY` is accepted for formal builds.
- Workspace packages and bundled extensions remain private.
- Release artifacts, process names, install paths, and the CLI use Biyan names.
- Stable bundle identifiers, legacy URL schemes, repository slugs, and updater
  hostnames may remain only as documented upgrade/ingress infrastructure; they
  must never surface as the product name or re-enable retired behavior.
- The updater installs the exact signed update object that was checked.
- The initial Direct-C cutover is immutable history: it accepted only the
  pinned `0.6.649` source, manifest, platform assets, and compatibility
  sources. It is not authority to mutate the frozen legacy handoff.
- Promotion is one 100% transaction gated by signed-candidate verification,
  GitHub-native upgrade evidence, a healthy report, compare-and-swap, and a
  kill switch. It does not create intermediate A or B cohorts.
- Every later terminal patch uses the no-input rolling recovery workflow:
  latest published terminal to active terminal on Windows, macOS, and Linux,
  with exact 3/3 attempt-scoped evidence before a `RECOVERY` promotion.
- The direct qualification matrix verifies Windows and macOS
  `0.6.633 → 0.6.649`, Linux fresh `0.6.649` under the exact no-current-Linux
  exception, and all three platforms from public `0.6.643`, `0.6.644`, and
  `0.6.645` to `0.6.649`.
- From `v0.6.652` onward, `RECOVERY` promotion publishes immutable versioned
  objects and changes only Router policy. It reads the frozen legacy manifests
  as a fail-closed invariant but never writes them.
- Kill Switch and Health Gate may pause only Router policy. They do not rewrite
  either legacy origin and cannot automatically resume service; resumption
  requires a new health-gated promotion.
- User-owned retired data is deleted only after explicit confirmation.

## Frozen legacy updater handoff

`v0.6.651` is the final compatibility handoff for public stable legacy updater
clients `0.6.611–0.6.633`. The two legacy manifests are permanent, static,
byte-identical copies of the exact signed `v0.6.651` manifest. Their Aliyun and
R2 public endpoints are pinned by
`scripts/updater/legacy-bridge-policy.json`; do not copy them into a second
configuration source.

These objects are permanently read-only for every routine release, promotion,
rollback, health, and kill-switch path. The weekly and manually dispatchable
`Verify Frozen Legacy Handoff` workflow only compares both public origins and
the published GitHub `v0.6.651` manifest with the tracked version, SHA-256, and
canonical bytes, then records verification evidence. It has no writer path.

An eligible legacy client uses this bridge once to install `v0.6.651`; the
installed client then obtains `v0.6.652` and later releases through the dynamic
Biyan Router. All later promotions, pauses, and resumptions are therefore
Router-only. Do not delete, return `404` from, or redirect either legacy
endpoint in the hope that an old binary will show a manual-download prompt: an
updater failure cannot add UI to an already shipped client. External support or
download messaging may supplement the handoff, but cannot replace it.

There is no routine break-glass legacy writer. If an integrity or availability
incident requires repair, break-glass authority is limited to restoring the
exact already-approved `v0.6.651` byte stream; it never authorizes advancing the
legacy target. The operation requires explicit repository-owner authorization,
an incident-specific reviewed plan or script, preserved pre-change evidence,
signature and digest verification, and byte-for-byte readback from both public
origins. Without that complete proof, fail closed and leave both objects
untouched.

The post-promotion Health Gate is an incident-triggered evidence consumer, not
a telemetry collector or automatic emitter. An external monitor or operator
must provide a content-addressed `rollout-health.json` by repository dispatch or
manual dispatch. A breached threshold may pause Router policy; a clear report
never resumes it automatically.

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
The protected branch ruleset must enforce the required CI gate and the existing
deletion and non-fast-forward protections. CODEOWNER review is optional and is
not a release prerequisite; checked-in policy tests remain the defense against
weakening CI-control paths through a pull request.
